/**
 * GitHub Projects V2 API Service
 *
 * Provides functions for interacting with GitHub Projects V2 via GraphQL.
 */

import type { Octokit } from '@octokit/rest';
import { createLogger, PROJECT_COLUMNS } from '@conductor/core';

const logger = createLogger('github-projects');

interface ProjectField {
  id: string;
  name: string;
  options?: { id: string; name: string }[];
}

interface ProjectInfo {
  id: string;
  statusFieldId: string;
  statusOptions: Map<string, string>; // name -> option ID
}

/**
 * Get project information including status field and options
 */
export async function getProjectInfo(
  octokit: Octokit,
  projectNodeId: string
): Promise<ProjectInfo | null> {
  try {
    const response = await octokit.graphql<{
      node: {
        id: string;
        fields: {
          nodes: ProjectField[];
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

    const statusField = response.node.fields.nodes.find(
      (f) => f.name === 'Status'
    );

    if (!statusField || !statusField.options) {
      logger.warn('Status field not found in project');
      return null;
    }

    const statusOptions = new Map<string, string>();
    for (const option of statusField.options) {
      statusOptions.set(option.name, option.id);
    }

    return {
      id: response.node.id,
      statusFieldId: statusField.id,
      statusOptions,
    };
  } catch (err) {
    logger.error({ err, projectNodeId }, 'Failed to get project info');
    return null;
  }
}

/**
 * Move a project item to a different column (status)
 */
export async function moveProjectItem(
  octokit: Octokit,
  projectNodeId: string,
  itemNodeId: string,
  targetColumn: keyof typeof PROJECT_COLUMNS
): Promise<boolean> {
  const targetColumnName = PROJECT_COLUMNS[targetColumn];

  logger.info(
    { projectNodeId, itemNodeId, targetColumn: targetColumnName },
    'Moving project item'
  );

  try {
    // Get project info
    const projectInfo = await getProjectInfo(octokit, projectNodeId);
    if (!projectInfo) {
      logger.error('Could not get project info');
      return false;
    }

    // Find the target status option ID
    const optionId = projectInfo.statusOptions.get(targetColumnName);
    if (!optionId) {
      logger.error(
        { targetColumn: targetColumnName, available: Array.from(projectInfo.statusOptions.keys()) },
        'Target column not found in project'
      );
      return false;
    }

    // Update the item's status
    await octokit.graphql(
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
        projectId: projectInfo.id,
        itemId: itemNodeId,
        fieldId: projectInfo.statusFieldId,
        optionId,
      }
    );

    logger.info(
      { itemNodeId, targetColumn: targetColumnName },
      'Project item moved successfully'
    );

    return true;
  } catch (err) {
    logger.error({ err, itemNodeId, targetColumn: targetColumnName }, 'Failed to move project item');
    return false;
  }
}

/**
 * Post a comment on a linked issue
 */
export async function postCommentOnIssue(
  octokit: Octokit,
  owner: string,
  repo: string,
  issueNumber: number,
  body: string
): Promise<boolean> {
  try {
    await octokit.issues.createComment({
      owner,
      repo,
      issue_number: issueNumber,
      body,
    });

    logger.info({ owner, repo, issueNumber }, 'Comment posted on issue');
    return true;
  } catch (err) {
    logger.error({ err, owner, repo, issueNumber }, 'Failed to post comment on issue');
    return false;
  }
}

/**
 * Get the issue number linked to a project item
 */
export async function getLinkedIssueNumber(
  octokit: Octokit,
  itemNodeId: string
): Promise<{ owner: string; repo: string; number: number } | null> {
  try {
    const response = await octokit.graphql<{
      node: {
        content: {
          __typename: string;
          number?: number;
          repository?: {
            owner: { login: string };
            name: string;
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
                number
                repository {
                  owner { login }
                  name
                }
              }
            }
          }
        }
      }
    `,
      { nodeId: itemNodeId }
    );

    const content = response.node?.content;
    if (!content || content.__typename !== 'Issue' || !content.number || !content.repository) {
      return null;
    }

    return {
      owner: content.repository.owner.login,
      repo: content.repository.name,
      number: content.number,
    };
  } catch (err) {
    logger.error({ err, itemNodeId }, 'Failed to get linked issue');
    return null;
  }
}

/**
 * Add a label to an issue
 */
export async function addLabelToIssue(
  octokit: Octokit,
  owner: string,
  repo: string,
  issueNumber: number,
  labels: string[]
): Promise<boolean> {
  try {
    // First, ensure the labels exist (create if needed)
    for (const label of labels) {
      try {
        await octokit.issues.getLabel({ owner, repo, name: label });
      } catch {
        // Label doesn't exist, create it
        await octokit.issues.createLabel({
          owner,
          repo,
          name: label,
          color: label === 'epic' ? '8B5CF6' : 'ededed', // Purple for epic, gray for others
          description: label === 'epic' ? 'Epic task with child issues' : undefined,
        });
      }
    }

    // Add labels to issue
    await octokit.issues.addLabels({
      owner,
      repo,
      issue_number: issueNumber,
      labels,
    });

    logger.info({ owner, repo, issueNumber, labels }, 'Labels added to issue');
    return true;
  } catch (err) {
    logger.error({ err, owner, repo, issueNumber, labels }, 'Failed to add labels to issue');
    return false;
  }
}

/**
 * Create a GitHub issue
 */
export async function createGitHubIssue(
  octokit: Octokit,
  owner: string,
  repo: string,
  title: string,
  body: string,
  labels?: string[]
): Promise<{ number: number; nodeId: string } | null> {
  try {
    const { data: issue } = await octokit.issues.create({
      owner,
      repo,
      title,
      body,
      labels: labels || [],
    });

    logger.info({ owner, repo, issueNumber: issue.number }, 'GitHub issue created');

    return {
      number: issue.number,
      nodeId: issue.node_id,
    };
  } catch (err) {
    logger.error({ err, owner, repo, title }, 'Failed to create GitHub issue');
    return null;
  }
}

/**
 * Add an issue to a GitHub Projects board
 */
export async function addIssueToProject(
  octokit: Octokit,
  projectNodeId: string,
  issueNodeId: string
): Promise<{ itemId: string } | null> {
  try {
    const response = await octokit.graphql<{
      addProjectV2ItemById: {
        item: {
          id: string;
        };
      };
    }>(
      `
      mutation($projectId: ID!, $contentId: ID!) {
        addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
          item {
            id
          }
        }
      }
    `,
      {
        projectId: projectNodeId,
        contentId: issueNodeId,
      }
    );

    const itemId = response.addProjectV2ItemById.item.id;
    logger.info({ projectNodeId, issueNodeId, itemId }, 'Issue added to project');

    return { itemId };
  } catch (err) {
    logger.error({ err, projectNodeId, issueNodeId }, 'Failed to add issue to project');
    return null;
  }
}
