/**
 * PostgreSQL schema using Drizzle ORM
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  bigint,
  real,
  varchar,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// Task status enum values
export const taskStatusValues = [
  'pending',
  'decomposing',
  'executing',
  'review',
  'pr_created',
  'done',
  'failed',
] as const;

export const subtaskStatusValues = [
  'pending',
  'queued',
  'running',
  'completed',
  'failed',
] as const;

export const agentRunStatusValues = [
  'starting',
  'running',
  'completed',
  'failed',
  'timeout',
] as const;

export const codeReviewResultValues = [
  'approved',
  'changes_requested',
  'failed',
] as const;

// Tasks table - main work items from GitHub Projects
export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    githubProjectItemId: text('github_project_item_id').notNull(),
    githubProjectId: text('github_project_id').notNull(),
    repositoryId: integer('repository_id').notNull(),
    repositoryFullName: text('repository_full_name').notNull(),
    installationId: integer('installation_id').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    status: varchar('status', { length: 20 })
      .notNull()
      .default('pending')
      .$type<(typeof taskStatusValues)[number]>(),
    branchName: text('branch_name'),
    pullRequestNumber: integer('pull_request_number'),
    pullRequestUrl: text('pull_request_url'),
    errorMessage: text('error_message'),
    retryCount: integer('retry_count').notNull().default(0),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
    startedAt: timestamp('started_at'),
    completedAt: timestamp('completed_at'),
  },
  (table) => ({
    githubProjectItemIdx: index('tasks_github_project_item_idx').on(
      table.githubProjectItemId
    ),
    statusIdx: index('tasks_status_idx').on(table.status),
    repositoryIdx: index('tasks_repository_idx').on(table.repositoryFullName),
  })
);

// Subtasks table - decomposed work items per sub-project
export const subtasks = pgTable(
  'subtasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    subprojectPath: text('subproject_path').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull(),
    status: varchar('status', { length: 20 })
      .notNull()
      .default('pending')
      .$type<(typeof subtaskStatusValues)[number]>(),
    dependsOn: jsonb('depends_on').$type<string[]>().notNull().default([]),
    agentRunId: uuid('agent_run_id'),
    filesModified: jsonb('files_modified').$type<string[]>().notNull().default([]),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
    startedAt: timestamp('started_at'),
    completedAt: timestamp('completed_at'),
  },
  (table) => ({
    taskIdIdx: index('subtasks_task_id_idx').on(table.taskId),
    statusIdx: index('subtasks_status_idx').on(table.status),
  })
);

// Agent runs table - execution logs with token usage
export const agentRuns = pgTable(
  'agent_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    subtaskId: uuid('subtask_id').references(() => subtasks.id, {
      onDelete: 'set null',
    }),
    agentType: varchar('agent_type', { length: 20 })
      .notNull()
      .$type<'master' | 'sub_agent' | 'code_review'>(),
    status: varchar('status', { length: 20 })
      .notNull()
      .default('starting')
      .$type<(typeof agentRunStatusValues)[number]>(),
    model: text('model').notNull(),
    inputTokens: bigint('input_tokens', { mode: 'number' }).notNull().default(0),
    outputTokens: bigint('output_tokens', { mode: 'number' }).notNull().default(0),
    totalCost: real('total_cost').notNull().default(0),
    logs: text('logs').notNull().default(''),
    startedAt: timestamp('started_at').notNull().defaultNow(),
    completedAt: timestamp('completed_at'),
  },
  (table) => ({
    taskIdIdx: index('agent_runs_task_id_idx').on(table.taskId),
    subtaskIdIdx: index('agent_runs_subtask_id_idx').on(table.subtaskId),
  })
);

// Pull requests table - PRs created by Conductor
export const pullRequests = pgTable(
  'pull_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    repositoryFullName: text('repository_full_name').notNull(),
    number: integer('number').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    branchName: text('branch_name').notNull(),
    headSha: text('head_sha').notNull(),
    url: text('url').notNull(),
    status: varchar('status', { length: 20 })
      .notNull()
      .default('open')
      .$type<'open' | 'merged' | 'closed'>(),
    reviewsPassed: boolean('reviews_passed').notNull().default(false),
    checksStatus: varchar('checks_status', { length: 20 }).$type<
      'pending' | 'success' | 'failure'
    >(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
    mergedAt: timestamp('merged_at'),
  },
  (table) => ({
    taskIdIdx: index('pull_requests_task_id_idx').on(table.taskId),
    repositoryIdx: index('pull_requests_repository_idx').on(
      table.repositoryFullName
    ),
  })
);

// Code reviews table - review results and issues found
export const codeReviews = pgTable(
  'code_reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    agentRunId: uuid('agent_run_id')
      .notNull()
      .references(() => agentRuns.id, { onDelete: 'cascade' }),
    result: varchar('result', { length: 20 })
      .notNull()
      .$type<(typeof codeReviewResultValues)[number]>(),
    iteration: integer('iteration').notNull(),
    summary: text('summary').notNull(),
    issues: jsonb('issues')
      .$type<
        Array<{
          file: string;
          line: number | null;
          severity: 'error' | 'warning' | 'suggestion';
          message: string;
          suggestion: string | null;
        }>
      >()
      .notNull()
      .default([]),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    taskIdIdx: index('code_reviews_task_id_idx').on(table.taskId),
  })
);

// Notifications table - sent notifications tracking
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 30 })
      .notNull()
      .$type<
        | 'task_started'
        | 'task_decomposed'
        | 'subtask_completed'
        | 'review_started'
        | 'review_completed'
        | 'pr_created'
        | 'task_completed'
        | 'task_failed'
      >(),
    channel: varchar('channel', { length: 20 })
      .notNull()
      .$type<'telegram' | 'slack' | 'webhook'>(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    sentAt: timestamp('sent_at'),
    error: text('error'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    taskIdIdx: index('notifications_task_id_idx').on(table.taskId),
  })
);

// Define relations
export const tasksRelations = relations(tasks, ({ many }) => ({
  subtasks: many(subtasks),
  agentRuns: many(agentRuns),
  pullRequests: many(pullRequests),
  codeReviews: many(codeReviews),
  notifications: many(notifications),
}));

export const subtasksRelations = relations(subtasks, ({ one, many }) => ({
  task: one(tasks, {
    fields: [subtasks.taskId],
    references: [tasks.id],
  }),
  agentRuns: many(agentRuns),
}));

export const agentRunsRelations = relations(agentRuns, ({ one }) => ({
  task: one(tasks, {
    fields: [agentRuns.taskId],
    references: [tasks.id],
  }),
  subtask: one(subtasks, {
    fields: [agentRuns.subtaskId],
    references: [subtasks.id],
  }),
}));

export const pullRequestsRelations = relations(pullRequests, ({ one }) => ({
  task: one(tasks, {
    fields: [pullRequests.taskId],
    references: [tasks.id],
  }),
}));

export const codeReviewsRelations = relations(codeReviews, ({ one }) => ({
  task: one(tasks, {
    fields: [codeReviews.taskId],
    references: [tasks.id],
  }),
  agentRun: one(agentRuns, {
    fields: [codeReviews.agentRunId],
    references: [agentRuns.id],
  }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  task: one(tasks, {
    fields: [notifications.taskId],
    references: [tasks.id],
  }),
}));
