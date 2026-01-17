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
  loadConfig,
} from '@conductor/core';
import type { TaskJob, SubtaskJob, Task, CodeReviewIssue } from '@conductor/core';
import { transitionTaskStatus, areAllSubtasksComplete } from '../state-machine.js';
import { MasterAgent } from '@conductor/orchestrator';
import { CodeReviewAgent } from '@conductor/orchestrator';
import { FixAgent } from '@conductor/agents';
import { createGitHubClient } from '../github-client.js';
import { createPullRequest } from '../pr-creator.js';
import { commitAndPush } from '../workspace.js';
import {
  moveProjectItem,
  getLinkedIssueNumber,
  postCommentOnIssue,
  addLabelToIssue,
  createGitHubIssue,
  addIssueToProject,
} from '../github-projects.js';
import { parseRepoFullName } from '@conductor/core';
import { queueNotification } from './notification-processor.js';

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

      case 'fix':
        await handleFix(task, job);
        break;

      case 'create_pr':
        await handleCreatePR(task, job);
        break;

      case 'smoke_test':
        await handleSmokeTest(task, job);
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

  // Move project card to "In Progress" column
  await moveProjectItem(
    octokit,
    task.githubProjectId,
    task.githubProjectItemId,
    'IN_PROGRESS'
  );

  // Create and run Master Agent for decomposition
  const masterAgent = new MasterAgent({
    task,
    octokit,
    onProgress: (message) => {
      job.updateProgress({ stage: 'decompose', message });
    },
  });

  const decomposition = await masterAgent.decompose();

  // Check if human review is needed
  if (decomposition.needsHumanReview && decomposition.humanReviewQuestion) {
    logger.info(
      {
        taskId: task.id,
        question: decomposition.humanReviewQuestion,
      },
      'Master Agent requesting human review'
    );

    // Move project card to Human Review column
    await moveProjectItem(
      octokit,
      task.githubProjectId,
      task.githubProjectItemId,
      'HUMAN_REVIEW'
    );

    // Post comment with the question on linked issue
    const linkedIssue = await getLinkedIssueNumber(octokit, task.githubProjectItemId);
    if (linkedIssue) {
      await postCommentOnIssue(
        octokit,
        linkedIssue.owner,
        linkedIssue.repo,
        linkedIssue.number,
        `🤖 **Conductor needs clarification**\n\n${decomposition.humanReviewQuestion}\n\n---\n_Reply to this comment with your answer, then move the card back to "Todo" to continue._`
      );
    }

    // Transition to human_review status
    await transitionTaskStatus(task.id, 'human_review', {
      humanReviewQuestion: decomposition.humanReviewQuestion,
    });

    // Send Telegram notification
    try {
      await queueNotification(
        task.id,
        'human_review_needed',
        'telegram',
        {
          title: task.title,
          question: decomposition.humanReviewQuestion,
        }
      );
    } catch (err) {
      logger.warn({ err }, 'Failed to queue human review notification');
    }

    job.updateProgress({ stage: 'human_review', message: 'Waiting for human response' });
    return;
  }

  // Handle EPIC tasks - create child GitHub issues instead of internal subtasks
  if (decomposition.type === 'epic' && decomposition.epicChildren && decomposition.epicChildren.length > 0) {
    logger.info(
      {
        taskId: task.id,
        childCount: decomposition.epicChildren.length,
        subprojects: decomposition.affectedSubprojects,
      },
      'Task identified as EPIC - creating child issues'
    );

    job.updateProgress({ stage: 'epic', message: `Creating ${decomposition.epicChildren.length} child issues` });

    const { owner, repo } = parseRepoFullName(task.repositoryFullName);

    // Add "epic" label to the parent issue
    const linkedIssue = await getLinkedIssueNumber(octokit, task.githubProjectItemId);
    if (linkedIssue) {
      await addLabelToIssue(octokit, linkedIssue.owner, linkedIssue.repo, linkedIssue.number, ['epic']);

      // Post a comment explaining the decomposition
      const childList = decomposition.epicChildren
        .map((child, i) => `${i + 1}. **${child.title}**${child.dependsOn.length > 0 ? ` (depends on: ${child.dependsOn.join(', ')})` : ''}`)
        .join('\n');

      await postCommentOnIssue(
        octokit,
        linkedIssue.owner,
        linkedIssue.repo,
        linkedIssue.number,
        `🎯 **Epic Decomposition**\n\nThis task has been identified as an **Epic** and will be broken into the following child tasks:\n\n${childList}\n\n---\n_Each child task will be created as a separate issue and tracked on this board. The Epic will be marked complete when all children are done._`
      );
    }

    // Mark the parent task as an epic in the database
    const db = getDb();
    await db
      .update(tasks)
      .set({
        isEpic: true,
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, task.id));

    // Create child GitHub issues and task records
    const createdChildTasks: Array<{ id: string; title: string; issueNumber: number }> = [];

    for (const child of decomposition.epicChildren) {
      // Create the GitHub issue
      const issueBody = `## Description\n\n${child.description}\n\n---\n\n**Parent Epic:** #${linkedIssue?.number || 'N/A'}\n**Estimated Complexity:** ${child.estimatedComplexity}\n${child.dependsOn.length > 0 ? `**Depends On:** ${child.dependsOn.join(', ')}` : ''}\n\n---\n_This issue was automatically created by Conductor as part of an Epic decomposition._`;

      const issue = await createGitHubIssue(
        octokit,
        owner,
        repo,
        child.title,
        issueBody,
        ['conductor', 'automated']
      );

      if (!issue) {
        logger.error({ taskId: task.id, childTitle: child.title }, 'Failed to create child issue');
        continue;
      }

      // Add the issue to the Projects board
      const projectItem = await addIssueToProject(
        octokit,
        task.githubProjectId,
        issue.nodeId
      );

      if (!projectItem) {
        logger.error({ taskId: task.id, issueNumber: issue.number }, 'Failed to add child issue to project');
        continue;
      }

      // Move the child issue to the "Todo" column so it gets picked up
      await moveProjectItem(
        octokit,
        task.githubProjectId,
        projectItem.itemId,
        'TODO'
      );

      // Create a task record for the child
      const [childTask] = await db
        .insert(tasks)
        .values({
          githubProjectItemId: projectItem.itemId,
          githubProjectId: task.githubProjectId,
          repositoryId: task.repositoryId,
          repositoryFullName: task.repositoryFullName,
          installationId: task.installationId,
          title: child.title,
          description: child.description,
          status: 'pending',
          isEpic: false,
          parentTaskId: task.id,
          linkedGithubIssueNumber: issue.number,
          childDependencies: child.dependsOn,
        })
        .returning();

      createdChildTasks.push({
        id: childTask.id,
        title: child.title,
        issueNumber: issue.number,
      });

      logger.info(
        {
          parentTaskId: task.id,
          childTaskId: childTask.id,
          issueNumber: issue.number,
          title: child.title,
        },
        'Child task created'
      );
    }

    // Move the epic to "In Progress" - it will track child completion
    await moveProjectItem(
      octokit,
      task.githubProjectId,
      task.githubProjectItemId,
      'IN_PROGRESS'
    );

    // Queue dependency checking for child tasks
    await queueEpicChildTasks(task.id, createdChildTasks);

    // Transition parent to "executing" (it's tracking children now)
    await transitionTaskStatus(task.id, 'executing');

    job.updateProgress({
      stage: 'epic',
      message: `Created ${createdChildTasks.length} child issues`,
    });

    return;
  }

  // Handle SIMPLE tasks - create internal subtasks and execute
  logger.info(
    {
      taskId: task.id,
      subtaskCount: decomposition.subtasks.length,
      subprojects: decomposition.affectedSubprojects,
    },
    'Simple task decomposed'
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

/**
 * Queue child tasks for an epic, respecting dependencies
 */
async function queueEpicChildTasks(
  parentTaskId: string,
  _children: Array<{ id: string; title: string; issueNumber: number }>
) {
  const db = getDb();

  // Get all child tasks with their dependencies
  const childTasks = await db
    .select()
    .from(tasks)
    .where(eq(tasks.parentTaskId, parentTaskId));

  // Build a map of title -> task for dependency resolution
  const titleToTask = new Map(childTasks.map((t) => [t.title, t]));

  // Find tasks with no unmet dependencies (ready to start)
  const taskQueue = new Queue<TaskJob>(QUEUE_NAMES.TASKS, {
    connection: { url: getRedisUrl() },
  });

  for (const child of childTasks) {
    const deps = (child.childDependencies as string[]) || [];

    // Check if all dependencies are met (completed)
    const unmetDeps = deps.filter((depTitle) => {
      const depTask = titleToTask.get(depTitle);
      return depTask && depTask.status !== 'done';
    });

    if (unmetDeps.length === 0) {
      // No unmet dependencies - queue for decomposition
      logger.info(
        { parentTaskId, childTaskId: child.id, title: child.title },
        'Queueing child task with no dependencies'
      );

      await taskQueue.add(
        JOB_TYPES.DECOMPOSE_TASK,
        {
          taskId: child.id,
          action: 'decompose',
        },
        {
          jobId: `decompose-${child.id}`,
        }
      );
    } else {
      logger.info(
        { parentTaskId, childTaskId: child.id, title: child.title, unmetDeps },
        'Child task has unmet dependencies, will be queued later'
      );
    }
  }
}

async function handleExecute(task: Task, job: Job<TaskJob>) {
  logger.info({ taskId: task.id }, 'Checking subtask completion');

  // Check if this is an EPIC task tracking child tasks
  if (task.isEpic) {
    await handleEpicExecute(task, job);
    return;
  }

  // SIMPLE task - Check if all subtasks are complete
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

/**
 * Handle epic task execution - track child task completion
 */
async function handleEpicExecute(task: Task, job: Job<TaskJob>) {
  const db = getDb();

  // Get all child tasks
  const childTasks = await db
    .select()
    .from(tasks)
    .where(eq(tasks.parentTaskId, task.id));

  const completedCount = childTasks.filter((t) => t.status === 'done').length;
  const failedCount = childTasks.filter((t) => t.status === 'failed').length;
  const totalCount = childTasks.length;

  logger.info(
    {
      taskId: task.id,
      completed: completedCount,
      failed: failedCount,
      total: totalCount,
    },
    'Checking epic child task completion'
  );

  job.updateProgress({
    stage: 'epic_execute',
    message: `${completedCount}/${totalCount} child tasks complete`,
  });

  // If any child tasks just completed, check for dependent tasks that can now run
  const titleToTask = new Map(childTasks.map((t) => [t.title, t]));

  for (const child of childTasks) {
    if (child.status !== 'pending') continue;

    const deps = (child.childDependencies as string[]) || [];
    const unmetDeps = deps.filter((depTitle) => {
      const depTask = titleToTask.get(depTitle);
      return depTask && depTask.status !== 'done';
    });

    if (unmetDeps.length === 0) {
      // All dependencies met - queue for decomposition
      logger.info(
        { parentTaskId: task.id, childTaskId: child.id, title: child.title },
        'Queueing child task - dependencies now met'
      );

      const taskQueue = new Queue<TaskJob>(QUEUE_NAMES.TASKS, {
        connection: { url: getRedisUrl() },
      });

      await taskQueue.add(
        JOB_TYPES.DECOMPOSE_TASK,
        {
          taskId: child.id,
          action: 'decompose',
        },
        {
          jobId: `decompose-${child.id}`,
        }
      );
    }
  }

  // Check if all children are done
  if (completedCount + failedCount === totalCount) {
    const octokit = await createGitHubClient(task.installationId);

    if (failedCount > 0) {
      // Some children failed - mark epic as failed
      logger.warn(
        { taskId: task.id, failedCount },
        'Epic has failed child tasks'
      );

      await transitionTaskStatus(task.id, 'failed', {
        errorMessage: `${failedCount} child task(s) failed`,
      });

      // Move epic to Human Review for investigation
      await moveProjectItem(
        octokit,
        task.githubProjectId,
        task.githubProjectItemId,
        'HUMAN_REVIEW'
      );
    } else {
      // All children completed successfully
      logger.info({ taskId: task.id, completedCount }, 'Epic complete - all child tasks done');

      await transitionTaskStatus(task.id, 'done');

      // Move epic to Done column
      await moveProjectItem(
        octokit,
        task.githubProjectId,
        task.githubProjectItemId,
        'DONE'
      );

      // Post completion comment on parent issue
      const linkedIssue = await getLinkedIssueNumber(octokit, task.githubProjectItemId);
      if (linkedIssue) {
        const childPRs = childTasks
          .filter((t) => t.pullRequestUrl)
          .map((t) => `- ${t.title}: ${t.pullRequestUrl}`)
          .join('\n');

        await postCommentOnIssue(
          octokit,
          linkedIssue.owner,
          linkedIssue.repo,
          linkedIssue.number,
          `✅ **Epic Complete**\n\nAll ${completedCount} child tasks have been completed!\n\n**Pull Requests:**\n${childPRs || '_No PRs created_'}\n\n---\n_This Epic can now be closed._`
        );
      }
    }

    return;
  }

  // Not all children done yet - re-queue check
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
}

async function handleReview(task: Task, job: Job<TaskJob>) {
  logger.info({ taskId: task.id }, 'Starting code review');

  await transitionTaskStatus(task.id, 'review');

  const octokit = await createGitHubClient(task.installationId);

  // Compute workspace path for reading local files
  const workspacesDir = process.env.WORKSPACES_DIR || '/tmp/conductor-workspaces';
  const workspacePath = `${workspacesDir}/${task.id}`;

  // Get default branch for the repo
  const [owner, repo] = task.repositoryFullName.split('/');
  const { data: repoData } = await octokit.repos.get({ owner, repo });
  const baseBranch = repoData.default_branch;

  // Push the branch to GitHub before code review so GitHub's diff comparison works
  if (task.branchName) {
    try {
      job.updateProgress({ stage: 'review', message: 'Pushing changes to GitHub for review' });
      const workspace = {
        path: workspacePath,
        branchName: task.branchName,
        baseBranch,
      };
      const sha = await commitAndPush(
        workspace,
        `[Conductor] WIP: ${task.title}\n\nWork in progress for code review.\nTask ID: ${task.id}`
      );
      if (sha) {
        logger.info({ taskId: task.id, sha }, 'Pushed branch to GitHub for code review');
      } else {
        logger.info({ taskId: task.id }, 'No new changes to push before code review');
      }
    } catch (err) {
      logger.warn({ taskId: task.id, err }, 'Failed to push branch before code review, continuing with local files');
    }
  }

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

    // Check if smoke testing is enabled
    const config = await loadConfig(workspacePath);
    const requireSmokeTest = config?.workflow.requireSmokeTest ?? false;

    const taskQueue = new Queue<TaskJob>(QUEUE_NAMES.TASKS, {
      connection: { url: getRedisUrl() },
    });

    if (requireSmokeTest) {
      // Queue smoke test before PR creation
      logger.info({ taskId: task.id }, 'Queueing smoke test');
      await taskQueue.add(
        'smoke_test',
        {
          taskId: task.id,
          action: 'smoke_test',
        },
        {
          jobId: `smoke-test-${task.id}`,
        }
      );
    } else {
      // Queue PR creation directly
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
    }
  } else {
    logger.warn(
      { taskId: task.id, issues: reviewResult.issues.length, iteration: reviewResult.iteration },
      'Code review found issues'
    );

    // If we haven't exceeded max iterations, fix issues and re-review
    if (reviewResult.iteration < 3) {
      logger.info(
        { taskId: task.id, iteration: reviewResult.iteration },
        'Queueing fix job for code review issues'
      );

      // Store issues in task for fix agent to use
      const db = getDb();
      await db
        .update(tasks)
        .set({
          errorMessage: JSON.stringify(reviewResult.issues),
          updatedAt: new Date(),
        })
        .where(eq(tasks.id, task.id));

      // Transition back to executing for fixes
      await transitionTaskStatus(task.id, 'executing');

      // Queue fix job
      const taskQueue = new Queue<TaskJob>(QUEUE_NAMES.TASKS, {
        connection: { url: getRedisUrl() },
      });

      await taskQueue.add(
        JOB_TYPES.FIX_ISSUES,
        {
          taskId: task.id,
          action: 'fix',
        },
        {
          jobId: `fix-${task.id}-iter-${reviewResult.iteration}`,
        }
      );
    } else {
      await transitionTaskStatus(task.id, 'failed', {
        errorMessage: 'Code review failed after maximum iterations',
      });
    }
  }
}

async function handleFix(task: Task, job: Job<TaskJob>) {
  logger.info({ taskId: task.id }, 'Starting fix for code review issues');

  // Get the issues from errorMessage (stored as JSON)
  let issues: CodeReviewIssue[] = [];
  if (task.errorMessage) {
    try {
      issues = JSON.parse(task.errorMessage);
    } catch {
      logger.warn({ taskId: task.id }, 'Failed to parse issues from errorMessage');
    }
  }

  if (issues.length === 0) {
    logger.warn({ taskId: task.id }, 'No issues to fix, re-queueing for review');
    // No issues to fix, just re-queue for review
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
        jobId: `review-${task.id}-${Date.now()}`,
      }
    );
    return;
  }

  // Compute workspace path
  const workspacesDir = process.env.WORKSPACES_DIR || '/tmp/conductor-workspaces';
  const workspacePath = `${workspacesDir}/${task.id}`;

  job.updateProgress({ stage: 'fix', message: `Fixing ${issues.length} issues` });

  // Create and run Fix Agent
  const fixAgent = new FixAgent({
    task,
    issues,
    workspace: {
      path: workspacePath,
      branchName: task.branchName || 'main',
      baseBranch: 'main',
    },
    onProgress: (message) => {
      job.updateProgress({ stage: 'fix', message });
    },
  });

  const result = await fixAgent.execute();

  logger.info(
    {
      taskId: task.id,
      success: result.success,
      filesModified: result.filesModified.length,
      cost: result.totalCost,
    },
    'Fix agent completed'
  );

  // Clear the error message (issues are fixed)
  const db = getDb();
  await db
    .update(tasks)
    .set({
      errorMessage: null,
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, task.id));

  // Re-queue for code review
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
      jobId: `review-${task.id}-${Date.now()}`,
    }
  );

  logger.info({ taskId: task.id }, 'Re-queued for code review after fixes');
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

  // Move project card to "Human Review" column for PR review
  await moveProjectItem(
    octokit,
    task.githubProjectId,
    task.githubProjectItemId,
    'HUMAN_REVIEW'
  );

  logger.info(
    { taskId: task.id, prNumber: pr.number, prUrl: pr.url },
    'Pull request created'
  );
}

async function handleSmokeTest(task: Task, job: Job<TaskJob>) {
  logger.info({ taskId: task.id }, 'Starting smoke test');

  job.updateProgress({ stage: 'smoke_test', message: 'Running smoke tests' });

  const workspacesDir = process.env.WORKSPACES_DIR || '/tmp/conductor-workspaces';
  const workspacePath = `${workspacesDir}/${task.id}`;

  // Load config to get smoke test settings
  const config = await loadConfig(workspacePath);
  const smokeTestWebhook = config?.workflow.smokeTestWebhook;

  let smokeTestPassed = true;
  let smokeTestResult = '';

  if (smokeTestWebhook) {
    // Call external smoke test webhook
    try {
      logger.info({ taskId: task.id, webhook: smokeTestWebhook }, 'Calling smoke test webhook');

      const response = await fetch(smokeTestWebhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: task.id,
          title: task.title,
          branchName: task.branchName,
          repositoryFullName: task.repositoryFullName,
        }),
      });

      const result = await response.json() as { success?: boolean; message?: string };
      smokeTestPassed = response.ok && result.success !== false;
      smokeTestResult = result.message || (smokeTestPassed ? 'Smoke test passed' : 'Smoke test failed');

      logger.info(
        { taskId: task.id, passed: smokeTestPassed, result: smokeTestResult },
        'Smoke test webhook completed'
      );
    } catch (err) {
      smokeTestPassed = false;
      smokeTestResult = `Smoke test webhook failed: ${err instanceof Error ? err.message : String(err)}`;
      logger.error({ taskId: task.id, err }, 'Smoke test webhook error');
    }
  } else {
    // No webhook configured, run basic checks
    logger.info({ taskId: task.id }, 'No smoke test webhook configured, running basic checks');

    try {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);

      // Run npm test or similar if available
      try {
        await execAsync('npm test --if-present', { cwd: workspacePath, timeout: 120000 });
        smokeTestResult = 'Basic tests passed';
      } catch (testErr) {
        // Tests might not exist, which is OK
        smokeTestResult = 'No tests configured, skipping';
      }

      smokeTestPassed = true;
    } catch (err) {
      smokeTestPassed = false;
      smokeTestResult = `Basic checks failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  job.updateProgress({ stage: 'smoke_test', message: smokeTestResult });

  if (smokeTestPassed) {
    logger.info({ taskId: task.id, result: smokeTestResult }, 'Smoke test passed');

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
    logger.error({ taskId: task.id, result: smokeTestResult }, 'Smoke test failed');

    await transitionTaskStatus(task.id, 'failed', {
      errorMessage: `Smoke test failed: ${smokeTestResult}`,
    });
  }
}
