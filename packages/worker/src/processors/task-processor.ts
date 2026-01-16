/**
 * Task Processor
 *
 * Handles task jobs: decomposition, code review, and PR creation.
 */

import type { Job } from 'bullmq';
import { Queue } from 'bullmq';
import { eq } from 'drizzle-orm';
import {
  createLogger,
  getDb,
  getRedisUrl,
  tasks,
  QUEUE_NAMES,
  JOB_TYPES,
} from '@conductor/core';
import type { TaskJob, SubtaskJob, Task } from '@conductor/core';
import { transitionTaskStatus, areAllSubtasksComplete } from '../state-machine.js';
import { MasterAgent } from '@conductor/orchestrator';
import { CodeReviewAgent } from '@conductor/orchestrator';
import { createGitHubClient } from '../github-client.js';
import { createPullRequest } from '../pr-creator.js';

const logger = createLogger('task-processor');

export async function taskProcessor(job: Job<TaskJob>) {
  const { taskId, action } = job.data;

  logger.info({ taskId, action, jobId: job.id }, 'Processing task job');

  const db = getDb();
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));

  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }

  try {
    switch (action) {
      case 'decompose':
        await handleDecompose(task, job);
        break;

      case 'execute':
        await handleExecute(task, job);
        break;

      case 'review':
        await handleReview(task, job);
        break;

      case 'create_pr':
        await handleCreatePR(task, job);
        break;

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  } catch (err) {
    logger.error({ taskId, action, err }, 'Task processing failed');

    await transitionTaskStatus(taskId, 'failed', {
      errorMessage: err instanceof Error ? err.message : String(err),
    });

    throw err;
  }
}

async function handleDecompose(task: Task, job: Job<TaskJob>) {
  logger.info({ taskId: task.id }, 'Starting task decomposition');

  await transitionTaskStatus(task.id, 'decomposing');

  // Create GitHub client for this installation
  const octokit = await createGitHubClient(task.installationId);

  // Create and run Master Agent for decomposition
  const masterAgent = new MasterAgent({
    task,
    octokit,
    onProgress: (message) => {
      job.updateProgress({ stage: 'decompose', message });
    },
  });

  const decomposition = await masterAgent.decompose();

  logger.info(
    {
      taskId: task.id,
      subtaskCount: decomposition.subtasks.length,
      subprojects: decomposition.affectedSubprojects,
    },
    'Task decomposed'
  );

  // Queue subtasks for execution
  const subtaskQueue = new Queue<SubtaskJob>(QUEUE_NAMES.SUBTASKS, {
    connection: { url: getRedisUrl() },
  });

  for (const subtask of decomposition.subtasks) {
    await subtaskQueue.add(
      JOB_TYPES.EXECUTE_SUBTASK,
      {
        subtaskId: subtask.id,
        taskId: task.id,
      },
      {
        jobId: `subtask-${subtask.id}`,
        attempts: 2,
        backoff: {
          type: 'exponential',
          delay: 10000,
        },
      }
    );
  }

  // Transition to executing
  await transitionTaskStatus(task.id, 'executing');

  // Schedule a check for when subtasks are complete
  const taskQueue = new Queue<TaskJob>(QUEUE_NAMES.TASKS, {
    connection: { url: getRedisUrl() },
  });

  await taskQueue.add(
    JOB_TYPES.DECOMPOSE_TASK,
    {
      taskId: task.id,
      action: 'execute',
    },
    {
      jobId: `check-complete-${task.id}`,
      delay: 30000, // Check after 30 seconds
    }
  );
}

async function handleExecute(task: Task, job: Job<TaskJob>) {
  logger.info({ taskId: task.id }, 'Checking subtask completion');

  // Check if all subtasks are complete
  const allComplete = await areAllSubtasksComplete(task.id);

  if (!allComplete) {
    // Re-queue this check for later
    const taskQueue = new Queue<TaskJob>(QUEUE_NAMES.TASKS, {
      connection: { url: getRedisUrl() },
    });

    await taskQueue.add(
      JOB_TYPES.DECOMPOSE_TASK,
      {
        taskId: task.id,
        action: 'execute',
      },
      {
        jobId: `check-complete-${task.id}-${Date.now()}`,
        delay: 30000, // Check again in 30 seconds
      }
    );

    job.updateProgress({ stage: 'execute', message: 'Waiting for subtasks' });
    return;
  }

  logger.info({ taskId: task.id }, 'All subtasks complete, starting review');

  // Queue for code review
  const taskQueue = new Queue<TaskJob>(QUEUE_NAMES.TASKS, {
    connection: { url: getRedisUrl() },
  });

  await taskQueue.add(
    JOB_TYPES.RUN_CODE_REVIEW,
    {
      taskId: task.id,
      action: 'review',
    },
    {
      jobId: `review-${task.id}`,
    }
  );
}

async function handleReview(task: Task, job: Job<TaskJob>) {
  logger.info({ taskId: task.id }, 'Starting code review');

  await transitionTaskStatus(task.id, 'review');

  const octokit = await createGitHubClient(task.installationId);

  // Compute workspace path for reading local files
  const workspacesDir = process.env.WORKSPACES_DIR || '/tmp/conductor-workspaces';
  const workspacePath = `${workspacesDir}/${task.id}`;

  const reviewAgent = new CodeReviewAgent({
    task,
    octokit,
    workspacePath,
    onProgress: (message) => {
      job.updateProgress({ stage: 'review', message });
    },
  });

  const reviewResult = await reviewAgent.review();

  if (reviewResult.result === 'approved') {
    logger.info({ taskId: task.id }, 'Code review passed');

    // Queue PR creation
    const taskQueue = new Queue<TaskJob>(QUEUE_NAMES.TASKS, {
      connection: { url: getRedisUrl() },
    });

    await taskQueue.add(
      JOB_TYPES.CREATE_PR,
      {
        taskId: task.id,
        action: 'create_pr',
      },
      {
        jobId: `create-pr-${task.id}`,
      }
    );
  } else {
    logger.warn(
      { taskId: task.id, issues: reviewResult.issues.length },
      'Code review found issues'
    );

    // If we haven't exceeded max iterations, fix issues and re-review
    if (reviewResult.iteration < 3) {
      // TODO: Queue fixes and re-review
      // For now, just fail the task
      await transitionTaskStatus(task.id, 'failed', {
        errorMessage: `Code review failed: ${reviewResult.summary}`,
      });
    } else {
      await transitionTaskStatus(task.id, 'failed', {
        errorMessage: 'Code review failed after maximum iterations',
      });
    }
  }
}

async function handleCreatePR(task: Task, _job: Job<TaskJob>) {
  logger.info({ taskId: task.id }, 'Creating pull request');

  const octokit = await createGitHubClient(task.installationId);

  // Compute workspace path for pushing changes
  const workspacesDir = process.env.WORKSPACES_DIR || '/tmp/conductor-workspaces';
  const workspacePath = `${workspacesDir}/${task.id}`;

  const pr = await createPullRequest({
    task,
    octokit,
    workspacePath,
  });

  await transitionTaskStatus(task.id, 'pr_created', {
    pullRequestNumber: pr.number,
    pullRequestUrl: pr.url,
  });

  logger.info(
    { taskId: task.id, prNumber: pr.number, prUrl: pr.url },
    'Pull request created'
  );
}
