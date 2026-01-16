/**
 * Structured logging for Conductor
 */

// Use require for pino due to ESM/CJS interop issues
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pino = require('pino') as typeof import('pino').default;

export interface LogContext {
  taskId?: string;
  subtaskId?: string;
  agentRunId?: string;
  repositoryFullName?: string;
  installationId?: number;
}

const baseLogger = pino({
  level: process.env.LOG_LEVEL || 'info',
  base: {
    service: 'conductor',
  },
  formatters: {
    level: (label: string) => ({ level: label }),
  },
});

export function createLogger(name: string, context?: LogContext) {
  return baseLogger.child({ component: name, ...context });
}

export function createTaskLogger(taskId: string, name: string) {
  return baseLogger.child({ component: name, taskId });
}

export function createAgentLogger(
  taskId: string,
  agentType: 'master' | 'sub_agent' | 'code_review',
  subtaskId?: string
) {
  return baseLogger.child({
    component: `agent:${agentType}`,
    taskId,
    subtaskId,
  });
}

export { baseLogger as logger };

export type Logger = ReturnType<typeof pino>;
