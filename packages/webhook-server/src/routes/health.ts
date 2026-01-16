/**
 * Health check endpoint
 */

import { Router, type Router as RouterType } from 'express';
import { sql } from 'drizzle-orm';
import { getDb, getRedis, createLogger } from '@conductor/core';

const logger = createLogger('health');

export const healthRouter: RouterType = Router();

healthRouter.get('/', async (_req, res) => {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    checks: {
      database: false,
      redis: false,
    },
  };

  try {
    // Check database
    const db = getDb();
    await db.execute(sql`SELECT 1`);
    health.checks.database = true;
  } catch (err) {
    logger.error({ err }, 'Database health check failed');
  }

  try {
    // Check Redis
    const redis = getRedis();
    await redis.ping();
    health.checks.redis = true;
  } catch (err) {
    logger.error({ err }, 'Redis health check failed');
  }

  const allHealthy = Object.values(health.checks).every(Boolean);
  health.status = allHealthy ? 'ok' : 'degraded';

  res.status(allHealthy ? 200 : 503).json(health);
});

healthRouter.get('/ready', async (_req, res) => {
  // Readiness check - are we ready to receive traffic?
  try {
    const db = getDb();
    await db.execute(sql`SELECT 1`);
    const redis = getRedis();
    await redis.ping();
    res.status(200).json({ ready: true });
  } catch {
    res.status(503).json({ ready: false });
  }
});

healthRouter.get('/live', (_req, res) => {
  // Liveness check - is the process alive?
  res.status(200).json({ alive: true });
});
