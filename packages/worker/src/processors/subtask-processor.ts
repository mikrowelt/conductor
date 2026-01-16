/**
 * Subtask Processor
 *
 * Executes individual subtasks using Sub-Agents.
 */

import type { Job } from 'bullmq';
import { eq } from 'drizzle-orm';
import {
  createLogger,
  getDb,
  tasks,
  subtasks,
  agentRuns,
} from '@conductor/core';
import type { SubtaskJob } from '@conductor/core';
import { transitionSubtaskStatus } from '../state-machine.js';
import { SubAgent } from '@conductor/agents';
import { createGitHubClient } from '../github-client.js';
import { prepareWorkspace } from '../workspace.js';

const logger = createLogger('subtask-processor');

export async function subtaskProcessor(job: Job<SubtaskJob>) {
  const { subtaskId, taskId } = job.data;

  logger.info({ subtaskId, taskId, jobId: job.id }, 'Processing subtask');

  const db = getDb();

  // Get subtask and task details
  const [subtask] = await db
    .select()
    .from(subtasks)
    .where(eq(subtasks.id, subtaskId));

  if (!subtask) {
    throw new Error(`Subtask not found: ${subtaskId}`);
  }

  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));

  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }

  try {
    // Transition to running
    await transitionSubtaskStatus(subtaskId, 'queued');
    await transitionSubtaskStatus(subtaskId, 'running');

    // Create agent run record
    const [agentRun] = await db
      .insert(agentRuns)
      .values({
        taskId,
        subtaskId,
        agentType: 'sub_agent',
        status: 'starting',
        model: process.env.SUB_AGENT_MODEL || 'claude-sonnet-4-20250514',
      })
      .returning();

    // Update subtask with agent run ID
    await transitionSubtaskStatus(subtaskId, 'running', {
      agentRunId: agentRun.id,
    });

    // Create GitHub client
    const octokit = await createGitHubClient(task.installationId);

    // Prepare workspace (clone repo if needed, checkout branch)
    const workspace = await prepareWorkspace({
      task,
      octokit,
    });

    // Store branch name on task if not already set
    if (!task.branchName && workspace.branchName) {
      await db
        .update(tasks)
        .set({ branchName: workspace.branchName })
        .where(eq(tasks.id, taskId));
      logger.info({ taskId, branchName: workspace.branchName }, 'Updated task with branch name');
    }

    // Update agent run status
    await db
      .update(agentRuns)
      .set({ status: 'running' })
      .where(eq(agentRuns.id, agentRun.id));

    // Create and run Sub-Agent
    const subAgent = new SubAgent({
      task,
      subtask,
      workspace,
      onProgress: (message) => {
        job.updateProgress({ subtaskId, message });
      },
      onOutput: async (output) => {
        // Append to agent logs
        await db
          .update(agentRuns)
          .set({ logs: agentRun.logs + output + '\n' })
          .where(eq(agentRuns.id, agentRun.id));
      },
    });

    const result = await subAgent.execute();

    // Update agent run with final stats
    await db
      .update(agentRuns)
      .set({
        status: 'completed',
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        totalCost: result.totalCost,
        completedAt: new Date(),
      })
      .where(eq(agentRuns.id, agentRun.id));

    // Mark subtask as complete
    await transitionSubtaskStatus(subtaskId, 'completed', {
      filesModified: result.filesModified,
    });

    logger.info(
      {
        subtaskId,
        filesModified: result.filesModified.length,
        tokens: result.inputTokens + result.outputTokens,
      },
      'Subtask completed'
    );
  } catch (err) {
    logger.error({ subtaskId, err }, 'Subtask execution failed');

    await transitionSubtaskStatus(subtaskId, 'failed', {
      errorMessage: err instanceof Error ? err.message : String(err),
    });

    throw err;
  }
}
