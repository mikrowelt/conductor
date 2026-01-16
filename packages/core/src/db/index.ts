/**
 * Database connection and utilities
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';
import { createLogger } from '../logger/index.js';

const logger = createLogger('database');

let db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let pool: pg.Pool | null = null;

export function getDb() {
  if (!db) {
    throw new Error('Database not initialized. Call initDb() first.');
  }
  return db;
}

export async function initDb(connectionString?: string) {
  const dbUrl = connectionString || process.env.DATABASE_URL;

  if (!dbUrl) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  logger.info('Initializing database connection');

  pool = new pg.Pool({
    connectionString: dbUrl,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  });

  pool.on('error', (err) => {
    logger.error({ err }, 'Unexpected database pool error');
  });

  db = drizzle(pool, { schema });

  // Test connection
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
    logger.info('Database connection established');
  } finally {
    client.release();
  }

  return db;
}

export async function closeDb() {
  if (pool) {
    logger.info('Closing database connection');
    await pool.end();
    pool = null;
    db = null;
  }
}

export { schema };
export * from './schema.js';
