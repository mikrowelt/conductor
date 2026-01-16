/**
 * Core constants for the Conductor system
 */

// Task state machine transitions
export const TASK_STATUS_TRANSITIONS: Record<string, string[]> = {
  pending: ['decomposing', 'failed'],
  decomposing: ['executing', 'failed'],
  executing: ['review', 'failed'],
  review: ['pr_created', 'executing', 'failed'],
  pr_created: ['done', 'failed'],
  done: [],
  failed: ['pending'], // Allow retry
};

export const SUBTASK_STATUS_TRANSITIONS: Record<string, string[]> = {
  pending: ['queued', 'failed'],
  queued: ['running', 'failed'],
  running: ['completed', 'failed'],
  completed: [],
  failed: ['pending'], // Allow retry
};

// Queue names
export const QUEUE_NAMES = {
  TASKS: 'conductor:tasks',
  SUBTASKS: 'conductor:subtasks',
  NOTIFICATIONS: 'conductor:notifications',
  CODE_REVIEW: 'conductor:code-review',
} as const;

// Job types
export const JOB_TYPES = {
  DECOMPOSE_TASK: 'decompose-task',
  EXECUTE_SUBTASK: 'execute-subtask',
  RUN_CODE_REVIEW: 'run-code-review',
  CREATE_PR: 'create-pr',
  SEND_NOTIFICATION: 'send-notification',
} as const;

// Default configuration values
export const DEFAULT_CONFIG = {
  agents: {
    master: {
      model: 'claude-sonnet-4-20250514',
      maxTurns: 30,
    },
    subAgent: {
      model: 'claude-sonnet-4-20250514',
      maxParallel: 5,
      timeoutMinutes: 30,
    },
    codeReview: {
      model: 'claude-sonnet-4-20250514',
      maxTurns: 10,
    },
  },
  workflow: {
    branchPattern: 'conductor/{task_id}/{short_description}',
    autoMerge: false,
    requireSmokeTest: false,
  },
  security: {
    blockedPatterns: [
      '**/.env',
      '**/.env.*',
      '**/secrets/**',
      '**/*.pem',
      '**/*.key',
      '**/credentials.json',
      '**/.git/**',
    ],
    maxFilesPerPr: 50,
    maxLinesPerPr: 2000,
  },
  subprojects: {
    autoDetect: {
      enabled: true,
      patterns: ['packages/*', 'apps/*', 'services/*'],
    },
  },
} as const;

// Claude Code CLI settings
export const CLAUDE_CODE_SETTINGS = {
  binary: 'claude',
  defaultFlags: ['--print', '--output-format', 'json'],
  maxOutputSize: 1024 * 1024, // 1MB
  defaultTimeout: 30 * 60 * 1000, // 30 minutes
} as const;

// GitHub App settings
export const GITHUB_APP_SETTINGS = {
  webhookPath: '/api/github/webhooks',
  healthPath: '/health',
  manualTriggerPath: '/api/trigger',
} as const;

// Retry settings
export const RETRY_SETTINGS = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 60000,
  backoffMultiplier: 2,
} as const;

// Code review settings
export const CODE_REVIEW_SETTINGS = {
  maxIterations: 3,
  passThreshold: 0, // 0 errors to pass
} as const;

// Token costs (per 1K tokens)
export const TOKEN_COSTS = {
  'claude-sonnet-4-20250514': { input: 0.003, output: 0.015 },
  'claude-opus-4-20250514': { input: 0.015, output: 0.075 },
  'claude-haiku-3-20240307': { input: 0.00025, output: 0.00125 },
} as const;

// Notification templates
export const NOTIFICATION_TEMPLATES = {
  task_started: '🚀 Task started: {title}',
  task_decomposed: '📋 Task decomposed into {count} subtasks',
  subtask_completed: '✅ Subtask completed: {title}',
  review_started: '🔍 Code review started (iteration {iteration})',
  review_completed: '📝 Code review {result}: {summary}',
  pr_created: '🔗 PR created: {url}',
  task_completed: '🎉 Task completed: {title}',
  task_failed: '❌ Task failed: {title} - {error}',
} as const;
