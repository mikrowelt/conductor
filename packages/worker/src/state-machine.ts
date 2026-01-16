/**
 * Task State Machine
 *
 * Manages valid state transitions for tasks and subtasks.
 */

import { eq } from 'drizzle-orm';
import {
  createLogger,
  getDb,
  tasks,
  subtasks,
  TASK_STATUS_TRANSITIONS,
  SUBTASK_STATUS_TRANSITIONS,
} from '@conductor/core';
import type { TaskStatus, SubtaskStatus } from '@conductor/core';

const logger = createLogger('state-machine');

export class InvalidStateTransitionError extends Error {
  constructor(
    public entityType: 'task' | 'subtask',
    public entityId: string,
    public currentStatus: string,
    public targetStatus: string
  ) {
    super(
      `Invalid ${entityType} state transition: ${currentStatus} -> ${targetStatus}`
    );
    this.name = 'InvalidStateTransitionError';
  }
}

export async function transitionTaskStatus(
  taskId: string,
  targetStatus: TaskStatus,
  options: {
    errorMessage?: string;
    branchName?: string;
    pullRequestNumber?: number;
    pullRequestUrl?: string;
  } = {}
): Promise<void> {
  const db = getDb();

  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));

  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }

  const validTransitions = TASK_STATUS_TRANSITIONS[task.status] || [];

  if (!validTransitions.includes(targetStatus)) {
    throw new InvalidStateTransitionError(
      'task',
      taskId,
      task.status,
      targetStatus
    );
  }

  const updateData: Record<string, unknown> = {
    status: targetStatus,
    updatedAt: new Date(),
  };

  if (options.errorMessage !== undefined) {
    updateData.errorMessage = options.errorMessage;
  }

  if (options.branchName !== undefined) {
    updateData.branchName = options.branchName;
  }

  if (options.pullRequestNumber !== undefined) {
    updateData.pullRequestNumber = options.pullRequestNumber;
  }

  if (options.pullRequestUrl !== undefined) {
    updateData.pullRequestUrl = options.pullRequestUrl;
  }

  // Set timestamps based on status
  if (targetStatus === 'decomposing' && !task.startedAt) {
    updateData.startedAt = new Date();
  }

  if (targetStatus === 'done' || targetStatus === 'failed') {
    updateData.completedAt = new Date();
  }

  await db.update(tasks).set(updateData).where(eq(tasks.id, taskId));

  logger.info(
    { taskId, from: task.status, to: targetStatus },
    'Task status transitioned'
  );
}

export async function transitionSubtaskStatus(
  subtaskId: string,
  targetStatus: SubtaskStatus,
  options: {
    errorMessage?: string;
    filesModified?: string[];
    agentRunId?: string;
  } = {}
): Promise<void> {
  const db = getDb();

  const [subtask] = await db
    .select()
    .from(subtasks)
    .where(eq(subtasks.id, subtaskId));

  if (!subtask) {
    throw new Error(`Subtask not found: ${subtaskId}`);
  }

  const validTransitions = SUBTASK_STATUS_TRANSITIONS[subtask.status] || [];

  if (!validTransitions.includes(targetStatus)) {
    throw new InvalidStateTransitionError(
      'subtask',
      subtaskId,
      subtask.status,
      targetStatus
    );
  }

  const updateData: Record<string, unknown> = {
    status: targetStatus,
    updatedAt: new Date(),
  };

  if (options.errorMessage !== undefined) {
    updateData.errorMessage = options.errorMessage;
  }

  if (options.filesModified !== undefined) {
    updateData.filesModified = options.filesModified;
  }

  if (options.agentRunId !== undefined) {
    updateData.agentRunId = options.agentRunId;
  }

  // Set timestamps based on status
  if (targetStatus === 'running' && !subtask.startedAt) {
    updateData.startedAt = new Date();
  }

  if (targetStatus === 'completed' || targetStatus === 'failed') {
    updateData.completedAt = new Date();
  }

  await db.update(subtasks).set(updateData).where(eq(subtasks.id, subtaskId));

  logger.info(
    { subtaskId, from: subtask.status, to: targetStatus },
    'Subtask status transitioned'
  );
}

export async function getTaskProgress(taskId: string): Promise<{
  total: number;
  completed: number;
  failed: number;
  running: number;
  pending: number;
}> {
  const db = getDb();

  const taskSubtasks = await db
    .select()
    .from(subtasks)
    .where(eq(subtasks.taskId, taskId));

  return {
    total: taskSubtasks.length,
    completed: taskSubtasks.filter((s) => s.status === 'completed').length,
    failed: taskSubtasks.filter((s) => s.status === 'failed').length,
    running: taskSubtasks.filter((s) => s.status === 'running').length,
    pending: taskSubtasks.filter(
      (s) => s.status === 'pending' || s.status === 'queued'
    ).length,
  };
}

export async function areAllSubtasksComplete(taskId: string): Promise<boolean> {
  const progress = await getTaskProgress(taskId);
  return progress.completed === progress.total && progress.total > 0;
}

export async function hasAnySubtaskFailed(taskId: string): Promise<boolean> {
  const progress = await getTaskProgress(taskId);
  return progress.failed > 0;
}
