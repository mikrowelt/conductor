/**
 * Handler for GitHub Pull Request events
 *
 * Tracks PR status for tasks created by Conductor.
 */

import type { Context } from 'probot';
import { eq } from 'drizzle-orm';
import { createLogger, getDb, pullRequests, tasks } from '@conductor/core';

const logger = createLogger('handler:pull-request');

type PREvent =
  | 'pull_request.opened'
  | 'pull_request.closed'
  | 'pull_request.merged'
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
