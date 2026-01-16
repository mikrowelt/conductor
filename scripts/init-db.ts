/**
 * Initialize database schema
 */
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

const { Pool } = pg;

async function initDb() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://conductor:conductor@localhost:5432/conductor'
  });
  
  const db = drizzle(pool);

  // Create tables
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tasks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      github_project_item_id TEXT NOT NULL,
      github_project_id TEXT NOT NULL,
      repository_id INTEGER NOT NULL,
      repository_full_name TEXT NOT NULL,
      installation_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      branch_name TEXT,
      pull_request_number INTEGER,
      pull_request_url TEXT,
      error_message TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      started_at TIMESTAMP,
      completed_at TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS subtasks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      subproject_path TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      depends_on JSONB NOT NULL DEFAULT '[]',
      agent_run_id UUID,
      files_modified JSONB NOT NULL DEFAULT '[]',
      error_message TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      started_at TIMESTAMP,
      completed_at TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS agent_runs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      subtask_id UUID REFERENCES subtasks(id) ON DELETE SET NULL,
      agent_type VARCHAR(20) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'starting',
      model TEXT NOT NULL,
      input_tokens BIGINT NOT NULL DEFAULT 0,
      output_tokens BIGINT NOT NULL DEFAULT 0,
      total_cost REAL NOT NULL DEFAULT 0,
      logs TEXT NOT NULL DEFAULT '',
      started_at TIMESTAMP NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS pull_requests (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      repository_full_name TEXT NOT NULL,
      number INTEGER NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      branch_name TEXT NOT NULL,
      head_sha TEXT NOT NULL,
      url TEXT NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'open',
      reviews_passed BOOLEAN NOT NULL DEFAULT FALSE,
      checks_status VARCHAR(20),
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      merged_at TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS code_reviews (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      agent_run_id UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
      result VARCHAR(20) NOT NULL,
      iteration INTEGER NOT NULL,
      summary TEXT NOT NULL,
      issues JSONB NOT NULL DEFAULT '[]',
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      type VARCHAR(30) NOT NULL,
      channel VARCHAR(20) NOT NULL,
      payload JSONB NOT NULL,
      sent_at TIMESTAMP,
      error TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS tasks_github_project_item_idx ON tasks(github_project_item_id);
    CREATE INDEX IF NOT EXISTS tasks_status_idx ON tasks(status);
    CREATE INDEX IF NOT EXISTS tasks_repository_idx ON tasks(repository_full_name);
    CREATE INDEX IF NOT EXISTS subtasks_task_id_idx ON subtasks(task_id);
    CREATE INDEX IF NOT EXISTS subtasks_status_idx ON subtasks(status);
    CREATE INDEX IF NOT EXISTS agent_runs_task_id_idx ON agent_runs(task_id);
    CREATE INDEX IF NOT EXISTS agent_runs_subtask_id_idx ON agent_runs(subtask_id);
    CREATE INDEX IF NOT EXISTS pull_requests_task_id_idx ON pull_requests(task_id);
    CREATE INDEX IF NOT EXISTS pull_requests_repository_idx ON pull_requests(repository_full_name);
    CREATE INDEX IF NOT EXISTS code_reviews_task_id_idx ON code_reviews(task_id);
    CREATE INDEX IF NOT EXISTS notifications_task_id_idx ON notifications(task_id);
  `);

  console.log('Database schema initialized');
  await pool.end();
}

initDb().catch(console.error);
