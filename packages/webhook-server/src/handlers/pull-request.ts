/**
 * Handler for GitHub Pull Request events
 *
 * Tracks PR status for tasks created by Conductor.
 */

import type { Context } from 'probot';
import { eq } from 'drizzle-orm';
import { createLogger, getDb, pullRequests, tasks, PROJECT_COLUMNS } from '@conductor/core';

const logger = createLogger('handler:pull-request');

/**
 * Move a project item to a different column using GraphQL
 */
async function moveProjectItemToDone(
  context: Context<PREvent>,
  projectNodeId: string,
  itemNodeId: string
): Promise<void> {
  try {
    // Get project info to find the status field and Done option
    const projectResponse = await context.octokit.graphql<{
      node: {
        id: string;
        fields: {
          nodes: Array<{
            id: string;
            name: string;
            options?: Array<{ id: string; name: string }>;
          }>;
        };
      };
    }>(
      `
      query($projectId: ID!) {
        node(id: $projectId) {
          ... on ProjectV2 {
            id
            fields(first: 20) {
              nodes {
                ... on ProjectV2SingleSelectField {
                  id
                  name
                  options {
                    id
                    name
                  }
                }
              }
            }
          }
        }
      }
    `,
      { projectId: projectNodeId }
    );

    const statusField = projectResponse.node?.fields?.nodes?.find(
      (f) => f.name === 'Status'
    );

    if (!statusField?.options) {
      logger.warn('Status field not found in project');
      return;
    }

    const doneOption = statusField.options.find(
      (o) => o.name === PROJECT_COLUMNS.DONE
    );

    if (!doneOption) {
      logger.warn({ available: statusField.options.map(o => o.name) }, 'Done column not found');
      return;
    }

    // Move the item to Done
    await context.octokit.graphql(
      `
      mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
        updateProjectV2ItemFieldValue(
          input: {
            projectId: $projectId
            itemId: $itemId
            fieldId: $fieldId
            value: { singleSelectOptionId: $optionId }
          }
        ) {
          projectV2Item {
            id
          }
        }
      }
    `,
      {
        projectId: projectResponse.node.id,
        itemId: itemNodeId,
        fieldId: statusField.id,
        optionId: doneOption.id,
      }
    );

    logger.info({ itemNodeId }, 'Project item moved to Done');
  } catch (err) {
    logger.error({ err, projectNodeId, itemNodeId }, 'Failed to move project item to Done');
  }
}

type PREvent =
  | 'pull_request.opened'
  | 'pull_request.closed'
  | 'pull_request.synchronize';

export async function handlePullRequest(context: Context<PREvent>) {
  const { payload } = context;
  const pr = payload.pull_request;
  const action = payload.action;

  // Check if this is a Conductor-created PR by branch name pattern
  if (!pr.head.ref.startsWith('conductor/')) {
    return;
  }

  logger.info(
    {
      prNumber: pr.number,
      action,
      branch: pr.head.ref,
    },
    'Processing Conductor PR event'
  );

  const db = getDb();

  // Find the PR record
  const [prRecord] = await db
    .select()
    .from(pullRequests)
    .where(eq(pullRequests.branchName, pr.head.ref))
    .limit(1);

  if (!prRecord) {
    logger.debug({ branch: pr.head.ref }, 'PR not found in database');
    return;
  }

  switch (action) {
    case 'closed':
      if (pr.merged) {
        // PR was merged
        await db
          .update(pullRequests)
          .set({
            status: 'merged',
            mergedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(pullRequests.id, prRecord.id));

        // Update task status
        await db
          .update(tasks)
          .set({
            status: 'done',
            completedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(tasks.id, prRecord.taskId));

        // Get task to access project item ID for card movement
        const [task] = await db
          .select()
          .from(tasks)
          .where(eq(tasks.id, prRecord.taskId));

        // Move project card to "Done" column
        if (task && task.githubProjectId && task.githubProjectItemId) {
          await moveProjectItemToDone(
            context,
            task.githubProjectId,
            task.githubProjectItemId
          );
        }

        logger.info({ taskId: prRecord.taskId, prNumber: pr.number }, 'Task completed - PR merged');
      } else {
        // PR was closed without merge
        await db
          .update(pullRequests)
          .set({
            status: 'closed',
            updatedAt: new Date(),
          })
          .where(eq(pullRequests.id, prRecord.id));

        logger.info({ prNumber: pr.number }, 'PR closed without merge');
      }
      break;

    case 'synchronize':
      // New commits pushed
      await db
        .update(pullRequests)
        .set({
          headSha: pr.head.sha,
          updatedAt: new Date(),
        })
        .where(eq(pullRequests.id, prRecord.id));

      logger.debug({ prNumber: pr.number, sha: pr.head.sha }, 'PR updated with new commits');
      break;
  }
}
