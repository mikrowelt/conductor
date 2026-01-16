/**
 * Conductor Webhook Server - Entry point
 *
 * This server receives GitHub webhooks via Probot and queues tasks for processing.
 */

import { createLogger, initDb, initRedis } from '@conductor/core';
import { createServer } from './server.js';

const logger = createLogger('webhook-server');

async function main() {
  logger.info('Starting Conductor Webhook Server');

  // Initialize database
  await initDb();
  logger.info('Database connection established');

  // Initialize Redis
  await initRedis();
  logger.info('Redis connection established');

  // Create and start server
  const port = parseInt(process.env.PORT || '3000', 10);
  const server = await createServer();

  server.listen(port, () => {
    logger.info({ port }, 'Webhook server listening');
  });

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down...');
    server.close();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  logger.error({ err }, 'Failed to start webhook server');
  process.exit(1);
});
