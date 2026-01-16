/**
 * Redis connection for BullMQ queues
 */

import Redis from 'ioredis';
import { createLogger } from '../logger/index.js';

const logger = createLogger('redis');

let redisClient: Redis | null = null;

export function getRedis(): Redis {
  if (!redisClient) {
    throw new Error('Redis not initialized. Call initRedis() first.');
  }
  return redisClient;
}

export async function initRedis(url?: string): Promise<Redis> {
  const redisUrl = url || process.env.REDIS_URL || 'redis://localhost:6379';

  logger.info({ url: redisUrl.replace(/\/\/.*@/, '//*****@') }, 'Initializing Redis connection');

  redisClient = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    retryStrategy(times) {
      const delay = Math.min(times * 50, 2000);
      logger.warn({ times, delay }, 'Redis connection retry');
      return delay;
    },
  });

  redisClient.on('error', (err) => {
    logger.error({ err }, 'Redis connection error');
  });

  redisClient.on('connect', () => {
    logger.info('Redis connected');
  });

  redisClient.on('ready', () => {
    logger.info('Redis ready');
  });

  // Test connection
  await redisClient.ping();

  return redisClient;
}

export async function closeRedis(): Promise<void> {
  if (redisClient) {
    logger.info('Closing Redis connection');
    await redisClient.quit();
    redisClient = null;
  }
}

export function createRedisConnection(url?: string): Redis {
  const redisUrl = url || process.env.REDIS_URL || 'redis://localhost:6379';

  return new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}
