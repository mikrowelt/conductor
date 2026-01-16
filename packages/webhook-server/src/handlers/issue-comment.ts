/**
 * Handler for GitHub Issue Comment events
 *
 * Supports manual commands like `/conductor retry` or `/conductor status`.
 */

import type { Context } from 'probot';
import { eq } from 'drizzle-orm';
import { Queue } from 'bullmq';
import {
  createLogger,
  getDb,
  getRedisUrl,
  tasks,
  subtasks,
  QUEUE_NAMES,
  JOB_TYPES,
} from '@conductor/core';
import type { TaskJob } from '@conductor/core';

const logger = createLogger('handler:issue-comment');

const COMMAND_PREFIX = '/conductor';

interface Command {
  name: string;
  args: string[];
}

export async function handleIssueComment(
  context: Context<'issue_comment.created'>
) {
  const { payload } = context;
  const comment = payload.comment;
  const issue = payload.issue;

  // Only process comments that start with our command prefix
  if (!comment.body.trim().startsWith(COMMAND_PREFIX)) {
    return;
  }

  const command = parseCommand(comment.body);
  if (!command) {
    return;
  }

  logger.info(
    {
      command: command.name,
      args: command.args,
      issueNumber: issue.number,
      user: comment.user.login,
    },
    'Processing Conductor command'
  );

  switch (command.name) {
    case 'status':
      await handleStatusCommand(context, issue.number);
      break;

    case 'retry':
      await handleRetryCommand(context, issue.number);
      break;

    case 'cancel':
      await handleCancelCommand(context, issue.number);
      break;

    case 'help':
      await handleHelpCommand(context);
      break;

    default:
      await context.octokit.issues.createComment({
        owner: payload.repository.owner.login,
        repo: payload.repository.name,
        issue_number: issue.number,
        body: `❓ Unknown command: \`${command.name}\`\n\nUse \`/conductor help\` for available commands.`,
      });
  }
}

function parseCommand(body: string): Command | null {
  const lines = body.trim().split('\n');
  const firstLine = lines[0].trim();

  if (!firstLine.startsWith(COMMAND_PREFIX)) {
    return null;
  }

  const parts = firstLine.slice(COMMAND_PREFIX.length).trim().split(/\s+/);
  const name = parts[0]?.toLowerCase();

  if (!name) {
    return null;
  }

  return {
    name,
    args: parts.slice(1),
  };
}

async function handleStatusCommand(
  context: Context<'issue_comment.created'>,
  issueNumber: number
) {
  const { payload } = context;
  const db = getDb();

  // Find tasks linked to this issue
  // Note: We'd need to track this relationship - for now, search by title match
  const taskList = await db
    .select()
    .from(tasks)
    .where(eq(tasks.repositoryFullName, payload.repository.full_name))
    .limit(10);

  if (taskList.length === 0) {
    await context.octokit.issues.createComment({
      owner: payload.repository.owner.login,
      repo: payload.repository.name,
      issue_number: issueNumber,
      body: '📋 No Conductor tasks found for this repository.',
    });
    return;
  }

  const statusLines = await Promise.all(
    taskList.map(async (task) => {
      const taskSubtasks = await db
        .select()
        .from(subtasks)
        .where(eq(subtasks.taskId, task.id));

      const completed = taskSubtasks.filter((s) => s.status === 'completed').length;
      const total = taskSubtasks.length;

      return `- **${task.title}** (${task.status}) - ${completed}/${total} subtasks`;
    })
  );

  await context.octokit.issues.createComment({
    owner: payload.repository.owner.login,
    repo: payload.repository.name,
    issue_number: issueNumber,
    body: `📊 **Conductor Task Status**\n\n${statusLines.join('\n')}`,
  });
}

async function handleRetryCommand(
  context: Context<'issue_comment.created'>,
  issueNumber: number
) {
  const { payload } = context;
  const db = getDb();

  // Find failed tasks for this repo
  const failedTasks = await db
    .select()
    .from(tasks)
    .where(eq(tasks.status, 'failed'))
    .limit(1);

  if (failedTasks.length === 0) {
    await context.octokit.issues.createComment({
      owner: payload.repository.owner.login,
      repo: payload.repository.name,
      issue_number: issueNumber,
      body: '✅ No failed tasks to retry.',
    });
    return;
  }

  const task = failedTasks[0];

  // Reset task status and increment retry count
  await db
    .update(tasks)
    .set({
      status: 'pending',
      retryCount: task.retryCount + 1,
      errorMessage: null,
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, task.id));

  // Queue for reprocessing
  const queue = new Queue<TaskJob>(QUEUE_NAMES.TASKS, {
    connection: { url: getRedisUrl() },
  });

  await queue.add(
    JOB_TYPES.DECOMPOSE_TASK,
    {
      taskId: task.id,
      action: 'decompose',
    },
    {
      jobId: `retry-${task.id}-${task.retryCount + 1}`,
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
    }
  );

  await context.octokit.issues.createComment({
    owner: payload.repository.owner.login,
    repo: payload.repository.name,
    issue_number: issueNumber,
    body: `🔄 Retrying task: **${task.title}**\n\nTask ID: \`${task.id}\`\nRetry #${task.retryCount + 1}`,
  });

  logger.info({ taskId: task.id }, 'Task retry triggered');
}

async function handleCancelCommand(
  context: Context<'issue_comment.created'>,
  issueNumber: number
) {
  const { payload } = context;

  // TODO: Implement task cancellation
  // - Find running tasks
  // - Signal agents to stop
  // - Update task status

  await context.octokit.issues.createComment({
    owner: payload.repository.owner.login,
    repo: payload.repository.name,
    issue_number: issueNumber,
    body: '⚠️ Task cancellation is not yet implemented.',
  });
}

async function handleHelpCommand(context: Context<'issue_comment.created'>) {
  const { payload } = context;

  const helpText = `
# 🤖 Conductor Commands

| Command | Description |
|---------|-------------|
| \`/conductor status\` | Show status of recent tasks |
| \`/conductor retry\` | Retry the most recent failed task |
| \`/conductor cancel\` | Cancel running tasks (coming soon) |
| \`/conductor help\` | Show this help message |

## How it works

1. Move a card to the "Todo" column in your GitHub Project
2. Conductor picks it up and breaks it into subtasks
3. Sub-Agents work on each subtask in parallel
4. Code review checks all changes
5. A PR is created for human review
  `.trim();

  await context.octokit.issues.createComment({
    owner: payload.repository.owner.login,
    repo: payload.repository.name,
    issue_number: payload.issue.number,
    body: helpText,
  });
}
