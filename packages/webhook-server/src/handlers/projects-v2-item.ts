/**
 * Handler for GitHub Projects V2 item events
 *
 * When a project item (card) moves to the "Todo" column, we create a task
 * and queue it for processing.
 */

import type { Context } from 'probot';
import { Queue } from 'bullmq';
import {
  createLogger,
  getDb,
  getRedis,
  tasks,
  QUEUE_NAMES,
  JOB_TYPES,
} from '@conductor/core';
import type { TaskJob, GitHubProjectItem } from '@conductor/core';

const logger = createLogger('handler:projects-v2-item');

// Column names that trigger task processing (configurable per repo)
const DEFAULT_START_COLUMN = 'Todo';

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

  // Check if the item moved to the start column
  if (status.toLowerCase() !== DEFAULT_START_COLUMN.toLowerCase()) {
    logger.debug(
      { status, expected: DEFAULT_START_COLUMN },
      'Item not in start column, skipping'
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

  // Create task in database
  const db = getDb();
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
    connection: getRedis(),
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
  context: Context<'projects_v2_item.edited' | 'projects_v2_item.created'>,
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
