/**
 * Handler for GitHub Projects V2 item events
 *
 * When a project item (card) moves to the "Todo" column, we create a task
 * and queue it for processing.
 */

import type { Context } from 'probot';
import { Queue } from 'bullmq';
import { eq } from 'drizzle-orm';
import {
  createLogger,
  getDb,
  getRedisUrl,
  tasks,
  QUEUE_NAMES,
  JOB_TYPES,
  PROJECT_COLUMNS,
} from '@conductor/core';
import type { TaskJob } from '@conductor/core';

const logger = createLogger('handler:projects-v2-item');

// Column names that trigger task processing (configurable per repo)
const DEFAULT_START_COLUMN = PROJECT_COLUMNS.TODO;
const REDO_COLUMN = PROJECT_COLUMNS.REDO;

export async function handleProjectsV2Item(
  context: Context<'projects_v2_item.edited' | 'projects_v2_item.created'>
) {
  const { payload } = context;
  const projectItem = payload.projects_v2_item;
  const changes = 'changes' in payload ? payload.changes : null;

  logger.info(
    {
      itemId: projectItem.id,
      projectId: projectItem.project_node_id,
      contentType: projectItem.content_type,
    },
    'Processing projects_v2_item event'
  );

  // Only process if this is a status field change
  if (changes && !('field_value' in changes)) {
    logger.debug('Not a field value change, skipping');
    return;
  }

  // Get the current status of the item
  const status = await getProjectItemStatus(context, projectItem.node_id);

  if (!status) {
    logger.warn('Could not determine project item status');
    return;
  }

  logger.info({ status }, 'Project item status');

  // Check if this is a task returning from Human Review
  const isStartColumn = status.toLowerCase() === DEFAULT_START_COLUMN.toLowerCase();
  const isRedoColumn = status.toLowerCase() === REDO_COLUMN.toLowerCase();

  if (!isStartColumn && !isRedoColumn) {
    logger.debug(
      { status, expected: [DEFAULT_START_COLUMN, REDO_COLUMN] },
      'Item not in start or redo column, skipping'
    );
    return;
  }

  // Check if there's an existing task for this project item
  const db = getDb();
  const [existingTask] = await db
    .select()
    .from(tasks)
    .where(eq(tasks.githubProjectItemId, projectItem.node_id));

  // If task exists and was in human_review, this is a return from human review
  if (existingTask && existingTask.status === 'human_review') {
    logger.info(
      { taskId: existingTask.id, status },
      'Task returning from human review'
    );

    // Get the latest comment from linked issue as the human's answer
    const itemDetails = await getProjectItemDetails(context, projectItem.node_id);
    let humanAnswer: string | null = null;

    if (itemDetails?.contentType === 'Issue' && itemDetails.issueNumber && itemDetails.repositoryFullName) {
      humanAnswer = await getLatestHumanComment(
        context,
        itemDetails.repositoryFullName,
        itemDetails.issueNumber
      );
    }

    // Update task with human answer and reset for re-decomposition
    await db
      .update(tasks)
      .set({
        status: 'pending',
        humanReviewAnswer: humanAnswer,
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, existingTask.id));

    // Queue for re-decomposition
    const queue = new Queue<TaskJob>(QUEUE_NAMES.TASKS, {
      connection: { url: getRedisUrl() },
    });

    await queue.add(
      JOB_TYPES.DECOMPOSE_TASK,
      {
        taskId: existingTask.id,
        action: 'decompose',
      },
      {
        jobId: `decompose-${existingTask.id}-retry-${Date.now()}`,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
      }
    );

    logger.info(
      { taskId: existingTask.id, hasAnswer: !!humanAnswer },
      'Task re-queued with human answer'
    );

    // Post confirmation comment
    if (itemDetails?.contentType === 'Issue' && itemDetails.issueNumber && itemDetails.repositoryFullName) {
      const [owner, repo] = itemDetails.repositoryFullName.split('/');
      try {
        await context.octokit.issues.createComment({
          owner,
          repo,
          issue_number: itemDetails.issueNumber,
          body: `🤖 **Conductor** received your answer and is resuming work!\n\n${humanAnswer ? `> ${humanAnswer.split('\n').join('\n> ')}` : '_No answer detected_'}`,
        });
      } catch (err) {
        logger.warn({ err }, 'Failed to post confirmation comment');
      }
    }

    return;
  }

  // If task exists and was in pr_created status + card moved to Redo, this is PR feedback
  if (existingTask && existingTask.status === 'pr_created' && isRedoColumn) {
    logger.info(
      { taskId: existingTask.id, prNumber: existingTask.pullRequestNumber },
      'Task moved to Redo - PR feedback flow'
    );

    // Get PR comments as feedback
    let feedback: string | null = null;
    if (existingTask.pullRequestNumber && existingTask.repositoryFullName) {
      feedback = await getPRFeedback(
        context,
        existingTask.repositoryFullName,
        existingTask.pullRequestNumber
      );
    }

    // Update task with feedback and reset for re-processing
    await db
      .update(tasks)
      .set({
        status: 'pending',
        humanReviewAnswer: feedback, // Reuse this field for PR feedback
        errorMessage: null,
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, existingTask.id));

    // Queue for re-decomposition (will use the feedback context)
    const queue = new Queue<TaskJob>(QUEUE_NAMES.TASKS, {
      connection: { url: getRedisUrl() },
    });

    await queue.add(
      JOB_TYPES.DECOMPOSE_TASK,
      {
        taskId: existingTask.id,
        action: 'decompose',
      },
      {
        jobId: `decompose-${existingTask.id}-redo-${Date.now()}`,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
      }
    );

    logger.info(
      { taskId: existingTask.id, hasFeedback: !!feedback },
      'Task re-queued with PR feedback'
    );

    // Post confirmation comment on linked issue
    const itemDetails = await getProjectItemDetails(context, projectItem.node_id);
    if (itemDetails?.contentType === 'Issue' && itemDetails.issueNumber && itemDetails.repositoryFullName) {
      const [owner, repo] = itemDetails.repositoryFullName.split('/');
      try {
        await context.octokit.issues.createComment({
          owner,
          repo,
          issue_number: itemDetails.issueNumber,
          body: `🔄 **Conductor** received your feedback and is addressing the issues!\n\n${feedback ? `**Feedback:**\n> ${feedback.split('\n').slice(0, 5).join('\n> ')}${feedback.split('\n').length > 5 ? '\n> ...' : ''}` : '_No specific feedback detected_'}`,
        });
      } catch (err) {
        logger.warn({ err }, 'Failed to post redo confirmation comment');
      }
    }

    return;
  }

  // If task exists but not in expected status, skip (don't create duplicate)
  if (existingTask) {
    logger.debug(
      { taskId: existingTask.id, status: existingTask.status },
      'Task already exists for this project item'
    );
    return;
  }

  // Get item details (title, body, linked issue/PR)
  const itemDetails = await getProjectItemDetails(context, projectItem.node_id);

  if (!itemDetails) {
    logger.warn('Could not get project item details');
    return;
  }

  // Get repository information
  const repo = await getLinkedRepository(context, itemDetails);

  if (!repo) {
    logger.warn('Could not determine linked repository');
    return;
  }

  // Create task in database (db already declared above)
  const [task] = await db
    .insert(tasks)
    .values({
      githubProjectItemId: projectItem.node_id,
      githubProjectId: projectItem.project_node_id,
      repositoryId: repo.id,
      repositoryFullName: repo.fullName,
      installationId: payload.installation?.id ?? 0,
      title: itemDetails.title,
      description: itemDetails.body,
      status: 'pending',
    })
    .returning();

  logger.info({ taskId: task.id, title: task.title }, 'Task created');

  // Queue task for decomposition
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
      jobId: `decompose-${task.id}`,
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
    }
  );

  logger.info({ taskId: task.id }, 'Task queued for decomposition');

  // Post a comment on the linked issue (if any)
  if (itemDetails.contentType === 'Issue' && itemDetails.issueNumber) {
    try {
      await context.octokit.issues.createComment({
        owner: repo.owner,
        repo: repo.name,
        issue_number: itemDetails.issueNumber,
        body: `🤖 **Conductor** is picking up this task!\n\nTask ID: \`${task.id}\`\n\nI'll analyze the requirements and create a PR when ready.`,
      });
    } catch (err) {
      logger.warn({ err }, 'Failed to post comment on issue');
    }
  }
}

async function getProjectItemStatus(
  context: Context<'projects_v2_item.edited' | 'projects_v2_item.created'>,
  nodeId: string
): Promise<string | null> {
  try {
    const response = await context.octokit.graphql<{
      node: {
        fieldValueByName: {
          name: string;
        } | null;
      };
    }>(
      `
      query($nodeId: ID!) {
        node(id: $nodeId) {
          ... on ProjectV2Item {
            fieldValueByName(name: "Status") {
              ... on ProjectV2ItemFieldSingleSelectValue {
                name
              }
            }
          }
        }
      }
    `,
      { nodeId }
    );

    return response.node?.fieldValueByName?.name ?? null;
  } catch (err) {
    logger.error({ err }, 'Failed to get project item status');
    return null;
  }
}

interface ProjectItemDetails {
  title: string;
  body: string | null;
  contentType: 'Issue' | 'PullRequest' | 'DraftIssue';
  issueNumber?: number;
  repositoryId?: number;
  repositoryFullName?: string;
}

async function getProjectItemDetails(
  context: Context<'projects_v2_item.edited' | 'projects_v2_item.created'>,
  nodeId: string
): Promise<ProjectItemDetails | null> {
  try {
    const response = await context.octokit.graphql<{
      node: {
        content: {
          __typename: string;
          title: string;
          body?: string;
          number?: number;
          repository?: {
            databaseId: number;
            nameWithOwner: string;
          };
        } | null;
      };
    }>(
      `
      query($nodeId: ID!) {
        node(id: $nodeId) {
          ... on ProjectV2Item {
            content {
              __typename
              ... on Issue {
                title
                body
                number
                repository {
                  databaseId
                  nameWithOwner
                }
              }
              ... on PullRequest {
                title
                body
                number
                repository {
                  databaseId
                  nameWithOwner
                }
              }
              ... on DraftIssue {
                title
                body
              }
            }
          }
        }
      }
    `,
      { nodeId }
    );

    const content = response.node?.content;
    if (!content) return null;

    return {
      title: content.title,
      body: content.body ?? null,
      contentType: content.__typename as ProjectItemDetails['contentType'],
      issueNumber: content.number,
      repositoryId: content.repository?.databaseId,
      repositoryFullName: content.repository?.nameWithOwner,
    };
  } catch (err) {
    logger.error({ err }, 'Failed to get project item details');
    return null;
  }
}

interface RepoInfo {
  id: number;
  name: string;
  owner: string;
  fullName: string;
}

async function getLinkedRepository(
  _context: Context<'projects_v2_item.edited' | 'projects_v2_item.created'>,
  itemDetails: ProjectItemDetails
): Promise<RepoInfo | null> {
  // If the item has a linked issue/PR, use its repository
  if (itemDetails.repositoryId && itemDetails.repositoryFullName) {
    const [owner, name] = itemDetails.repositoryFullName.split('/');
    return {
      id: itemDetails.repositoryId,
      name,
      owner,
      fullName: itemDetails.repositoryFullName,
    };
  }

  // For draft issues, try to get the repository from the project's linked repositories
  // This requires additional GraphQL queries
  logger.warn('Draft issue without linked repository - not yet supported');
  return null;
}

/**
 * Get the latest non-bot comment from an issue
 */
async function getLatestHumanComment(
  context: Context<'projects_v2_item.edited' | 'projects_v2_item.created'>,
  repositoryFullName: string,
  issueNumber: number
): Promise<string | null> {
  try {
    const [owner, repo] = repositoryFullName.split('/');

    // Get recent comments on the issue
    const { data: comments } = await context.octokit.issues.listComments({
      owner,
      repo,
      issue_number: issueNumber,
      per_page: 10,
      sort: 'created',
      direction: 'desc',
    });

    // Find the first comment that isn't from a bot (doesn't start with bot indicators)
    for (const comment of comments) {
      // Skip bot comments
      if (
        comment.user?.type === 'Bot' ||
        comment.body?.startsWith('🤖') ||
        comment.user?.login?.endsWith('[bot]')
      ) {
        continue;
      }

      // Found a human comment
      return comment.body || null;
    }

    return null;
  } catch (err) {
    logger.error({ err, repositoryFullName, issueNumber }, 'Failed to get latest human comment');
    return null;
  }
}

/**
 * Get PR review comments and issue comments as feedback
 */
async function getPRFeedback(
  context: Context<'projects_v2_item.edited' | 'projects_v2_item.created'>,
  repositoryFullName: string,
  prNumber: number
): Promise<string | null> {
  try {
    const [owner, repo] = repositoryFullName.split('/');
    const feedbackParts: string[] = [];

    // Get PR review comments
    try {
      const { data: reviews } = await context.octokit.pulls.listReviews({
        owner,
        repo,
        pull_number: prNumber,
      });

      for (const review of reviews) {
        if (
          review.user?.type !== 'Bot' &&
          !review.user?.login?.endsWith('[bot]') &&
          review.body &&
          review.body.trim()
        ) {
          feedbackParts.push(`[Review by ${review.user?.login}]: ${review.body}`);
        }
      }
    } catch (err) {
      logger.warn({ err }, 'Failed to fetch PR reviews');
    }

    // Get PR issue comments
    try {
      const { data: comments } = await context.octokit.issues.listComments({
        owner,
        repo,
        issue_number: prNumber,
        per_page: 20,
        sort: 'created',
        direction: 'desc',
      });

      for (const comment of comments) {
        if (
          comment.user?.type !== 'Bot' &&
          !comment.user?.login?.endsWith('[bot]') &&
          !comment.body?.startsWith('🤖') &&
          comment.body
        ) {
          feedbackParts.push(`[Comment by ${comment.user?.login}]: ${comment.body}`);
        }
      }
    } catch (err) {
      logger.warn({ err }, 'Failed to fetch PR comments');
    }

    if (feedbackParts.length === 0) {
      return null;
    }

    // Return combined feedback (limit to reasonable size)
    return feedbackParts.slice(0, 10).join('\n\n');
  } catch (err) {
    logger.error({ err, repositoryFullName, prNumber }, 'Failed to get PR feedback');
    return null;
  }
}
