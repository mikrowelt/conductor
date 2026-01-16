/**
 * Conductor Worker - Entry point
 *
 * Processes jobs from BullMQ queues using Claude Code agents.
 */

import { config } from 'dotenv';
import { resolve } from 'path';

// Load .env from project root (2 levels up from dist/index.js)
config({ path: resolve(process.cwd(), '.env') });

import { createLogger, initDb, initRedis } from '@conductor/core';
import { startWorkers, stopWorkers } from './workers.js';

const logger = createLogger('worker');

async function main() {
  logger.info({
    anthropicKeySet: !!process.env.ANTHROPIC_API_KEY,
    cwd: process.cwd(),
  }, 'Starting Conductor Worker');

  // Initialize database
  await initDb();
  logger.info('Database connection established');

  // Initialize Redis
  await initRedis();
  logger.info('Redis connection established');

  // Start all workers
  await startWorkers();
  logger.info('Workers started');

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down workers...');
    await stopWorkers();
    logger.info('Workers stopped');
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  logger.error({ err }, 'Failed to start worker');
  process.exit(1);
});
