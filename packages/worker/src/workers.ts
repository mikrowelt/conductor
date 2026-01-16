/**
 * BullMQ Workers setup
 */

import { Worker } from 'bullmq';
import {
  createLogger,
  getRedis,
  QUEUE_NAMES,
} from '@conductor/core';
import { taskProcessor } from './processors/task-processor.js';
import { subtaskProcessor } from './processors/subtask-processor.js';
import { notificationProcessor } from './processors/notification-processor.js';

const logger = createLogger('workers');

const workers: Worker[] = [];

export async function startWorkers() {
  const connection = getRedis();

  // Task processor - handles task decomposition, review, and PR creation
  const taskWorker = new Worker(QUEUE_NAMES.TASKS, taskProcessor, {
    connection,
    concurrency: 2,
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 50 },
  });

  taskWorker.on('completed', (job) => {
    logger.info({ jobId: job.id, taskId: job.data.taskId }, 'Task job completed');
  });

  taskWorker.on('failed', (job, err) => {
    logger.error(
      { jobId: job?.id, taskId: job?.data.taskId, err },
      'Task job failed'
    );
  });

  workers.push(taskWorker);

  // Subtask processor - executes individual subtasks using Sub-Agents
  const subtaskWorker = new Worker(QUEUE_NAMES.SUBTASKS, subtaskProcessor, {
    connection,
    concurrency: parseInt(process.env.MAX_CONCURRENT_AGENTS || '5', 10),
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 100 },
  });

  subtaskWorker.on('completed', (job) => {
    logger.info(
      { jobId: job.id, subtaskId: job.data.subtaskId },
      'Subtask job completed'
    );
  });

  subtaskWorker.on('failed', (job, err) => {
    logger.error(
      { jobId: job?.id, subtaskId: job?.data.subtaskId, err },
      'Subtask job failed'
    );
  });

  workers.push(subtaskWorker);

  // Notification processor - sends notifications to Telegram, Slack, etc.
  const notificationWorker = new Worker(
    QUEUE_NAMES.NOTIFICATIONS,
    notificationProcessor,
    {
      connection,
      concurrency: 5,
      removeOnComplete: { count: 500 },
      removeOnFail: { count: 100 },
    }
  );

  notificationWorker.on('completed', (job) => {
    logger.debug({ jobId: job.id }, 'Notification job completed');
  });

  notificationWorker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Notification job failed');
  });

  workers.push(notificationWorker);

  logger.info({ workerCount: workers.length }, 'All workers started');
}

export async function stopWorkers() {
  await Promise.all(
    workers.map(async (worker) => {
      await worker.close();
    })
  );
  workers.length = 0;
  logger.info('All workers stopped');
}
