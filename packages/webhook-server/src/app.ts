/**
 * Probot application - main webhook routing
 */

import type { Probot } from 'probot';
import { createLogger } from '@conductor/core';
import { handleProjectsV2Item } from './handlers/projects-v2-item.js';
import { handlePullRequest } from './handlers/pull-request.js';
import { handleIssueComment } from './handlers/issue-comment.js';

const logger = createLogger('probot-app');

export function conductorApp(app: Probot) {
  logger.info('Loading Conductor Probot app');

  // Projects V2 item events - triggered when cards move between columns
  app.on('projects_v2_item.edited', handleProjectsV2Item);
  app.on('projects_v2_item.created', handleProjectsV2Item);

  // Pull request events - for tracking PR status
  // Note: 'merged' is not a separate event; it's a property of 'closed' events
  app.on('pull_request.opened', handlePullRequest);
  app.on('pull_request.closed', handlePullRequest);
  app.on('pull_request.synchronize', handlePullRequest);

  // Issue comment events - for manual commands
  app.on('issue_comment.created', handleIssueComment);

  // Check run events - for monitoring CI status
  app.on('check_run.completed', async (context) => {
    logger.debug(
      { checkRunId: context.payload.check_run.id },
      'Check run completed'
    );
    // TODO: Update PR status based on check results
  });

  // Log all received events in debug mode
  app.onAny(async (context) => {
    logger.debug(
      { event: context.name, action: (context.payload as { action?: string }).action },
      'Received webhook event'
    );
  });

  logger.info('Conductor Probot app loaded');
}
