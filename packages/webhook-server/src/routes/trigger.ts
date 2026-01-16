/**
 * Manual trigger endpoint
 *
 * Allows manually triggering a task without moving a GitHub Project card.
 * Useful for testing and debugging.
 */

import { Router } from 'express';
import { Queue } from 'bullmq';
import { z } from 'zod';
import {
  createLogger,
  getDb,
  getRedis,
  tasks,
  QUEUE_NAMES,
  JOB_TYPES,
} from '@conductor/core';
import type { TaskJob } from '@conductor/core';

const logger = createLogger('trigger');

export const triggerRouter = Router();

const triggerSchema = z.object({
  repositoryFullName: z.string().regex(/^[\w-]+\/[\w-]+$/),
  installationId: z.number().int().positive(),
  title: z.string().min(1).max(500),
  description: z.string().optional(),
});

triggerRouter.post('/', async (req, res) => {
  try {
    const body = triggerSchema.parse(req.body);

    logger.info({ body }, 'Manual task trigger received');

    const db = getDb();

    // Create task
    const [task] = await db
      .insert(tasks)
      .values({
        githubProjectItemId: `manual-${Date.now()}`,
        githubProjectId: 'manual',
        repositoryId: 0,
        repositoryFullName: body.repositoryFullName,
        installationId: body.installationId,
        title: body.title,
        description: body.description ?? null,
        status: 'pending',
      })
      .returning();

    // Queue for processing
    const queue = new Queue<TaskJob>(QUEUE_NAMES.TASKS, {
      connection: getRedis(),
    });

    await queue.add(
      JOB_TYPES.DECOMPOSE_TASK,
      {
        taskId: task.id,
        action: 'decompose',
      },
      {
        jobId: `manual-${task.id}`,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
      }
    );

    logger.info({ taskId: task.id }, 'Manual task created and queued');

    res.status(201).json({
      taskId: task.id,
      status: task.status,
      message: 'Task created and queued for processing',
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({
        error: 'Invalid request body',
        details: err.errors,
      });
      return;
    }

    logger.error({ err }, 'Failed to create manual task');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get task status
triggerRouter.get('/:taskId', async (req, res) => {
  try {
    const { taskId } = req.params;

    const db = getDb();
    const [task] = await db.select().from(tasks).where(
      // Using raw SQL for UUID comparison
      tasks.id.equals(taskId)
    );

    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    res.json(task);
  } catch (err) {
    logger.error({ err }, 'Failed to get task');
    res.status(500).json({ error: 'Internal server error' });
  }
});
