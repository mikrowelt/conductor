/**
 * Express server with Probot integration
 */

import express, { type Express } from 'express';
import { Probot, createNodeMiddleware } from 'probot';
import { readFileSync } from 'fs';
import { createLogger, GITHUB_APP_SETTINGS } from '@conductor/core';
import { conductorApp } from './app.js';
import { healthRouter } from './routes/health.js';
import { triggerRouter } from './routes/trigger.js';

const logger = createLogger('server');

export async function createServer(): Promise<Express> {
  const app = express();

  // Health check endpoint (no body parsing needed)
  app.use(GITHUB_APP_SETTINGS.healthPath, healthRouter);

  // Manual trigger endpoint (needs JSON parsing)
  app.use(GITHUB_APP_SETTINGS.manualTriggerPath, express.json(), triggerRouter);

  // Create Probot instance
  const privateKeyPath = process.env.GITHUB_PRIVATE_KEY_PATH;
  const privateKey = privateKeyPath
    ? readFileSync(privateKeyPath, 'utf-8')
    : process.env.GITHUB_PRIVATE_KEY;

  if (!privateKey) {
    throw new Error(
      'GitHub private key is required (GITHUB_PRIVATE_KEY_PATH or GITHUB_PRIVATE_KEY)'
    );
  }

  const appId = process.env.GITHUB_APP_ID;
  if (!appId) {
    throw new Error('GITHUB_APP_ID environment variable is required');
  }

  const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!webhookSecret) {
    throw new Error('GITHUB_WEBHOOK_SECRET environment variable is required');
  }

  const probot = new Probot({
    appId,
    privateKey,
    secret: webhookSecret,
  });

  // Load our Probot app
  await probot.load(conductorApp);

  // Mount Probot's webhook handler using createNodeMiddleware
  // Note: createNodeMiddleware defaults to /api/github/webhooks, so we mount at root
  // and let it handle its own path
  app.use(createNodeMiddleware(conductorApp, { probot }));

  // Error handler
  app.use(
    (
      err: Error,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      logger.error({ err }, 'Unhandled error');
      res.status(500).json({ error: 'Internal server error' });
    }
  );

  logger.info('Server created');

  return app;
}
