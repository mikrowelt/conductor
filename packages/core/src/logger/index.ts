/**
 * Structured logging for Conductor
 */

import pino from 'pino';

export interface LogContext {
  taskId?: string;
  subtaskId?: string;
  agentRunId?: string;
  repositoryFullName?: string;
  installationId?: number;
}

const baseLogger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport:
    process.env.NODE_ENV === 'development'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss',
            ignore: 'pid,hostname',
          },
        }
      : undefined,
  base: {
    service: 'conductor',
  },
  formatters: {
    level: (label) => ({ level: label }),
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

export type Logger = pino.Logger;
