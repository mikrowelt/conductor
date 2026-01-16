/**
 * Agent Pool
 *
 * Manages parallel execution of Claude Code agents with concurrency limits.
 */

import pLimit from 'p-limit';
import { createLogger } from '@conductor/core';
import { ClaudeRunner, type ClaudeRunnerOptions, type AgentOutput } from './claude-runner.js';

const logger = createLogger('agent-pool');

export interface PooledAgent {
  id: string;
  options: ClaudeRunnerOptions;
  runner?: ClaudeRunner;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: AgentOutput;
  error?: Error;
}

export class AgentPool {
  private agents: Map<string, PooledAgent> = new Map();
  private limiter: ReturnType<typeof pLimit>;
  private running = false;

  constructor(maxConcurrency: number = 5) {
    this.limiter = pLimit(maxConcurrency);
    logger.info({ maxConcurrency }, 'Agent pool created');
  }

  /**
   * Add an agent to the pool
   */
  add(id: string, options: ClaudeRunnerOptions): void {
    if (this.agents.has(id)) {
      throw new Error(`Agent with id ${id} already exists`);
    }

    this.agents.set(id, {
      id,
      options,
      status: 'pending',
    });

    logger.debug({ agentId: id }, 'Agent added to pool');
  }

  /**
   * Run all agents in the pool with concurrency limits
   */
  async runAll(
    onProgress?: (agentId: string, status: string, result?: AgentOutput) => void
  ): Promise<Map<string, AgentOutput | Error>> {
    this.running = true;
    const results = new Map<string, AgentOutput | Error>();

    const promises = Array.from(this.agents.entries()).map(([id, agent]) =>
      this.limiter(async () => {
        if (!this.running) {
          return; // Pool was stopped
        }

        agent.status = 'running';
        agent.runner = new ClaudeRunner(agent.options);
        onProgress?.(id, 'running');

        logger.info({ agentId: id }, 'Agent starting');

        try {
          const result = await agent.runner.run();
          agent.status = 'completed';
          agent.result = result;
          results.set(id, result);
          onProgress?.(id, 'completed', result);

          logger.info(
            { agentId: id, success: result.success },
            'Agent completed'
          );
        } catch (err) {
          agent.status = 'failed';
          agent.error = err instanceof Error ? err : new Error(String(err));
          results.set(id, agent.error);
          onProgress?.(id, 'failed');

          logger.error({ agentId: id, err }, 'Agent failed');
        }
      })
    );

    await Promise.all(promises);

    this.running = false;
    return results;
  }

  /**
   * Stop all running agents
   */
  stop(): void {
    this.running = false;

    for (const agent of this.agents.values()) {
      if (agent.runner && agent.status === 'running') {
        agent.runner.kill();
        agent.status = 'failed';
        agent.error = new Error('Agent pool stopped');
      }
    }

    logger.info('Agent pool stopped');
  }

  /**
   * Get the status of all agents
   */
  getStatus(): Map<string, PooledAgent['status']> {
    const status = new Map<string, PooledAgent['status']>();
    for (const [id, agent] of this.agents) {
      status.set(id, agent.status);
    }
    return status;
  }

  /**
   * Get agent by ID
   */
  get(id: string): PooledAgent | undefined {
    return this.agents.get(id);
  }

  /**
   * Clear all agents from the pool
   */
  clear(): void {
    this.stop();
    this.agents.clear();
  }

  /**
   * Get the number of agents in the pool
   */
  get size(): number {
    return this.agents.size;
  }

  /**
   * Get counts by status
   */
  getCounts(): Record<PooledAgent['status'], number> {
    const counts = {
      pending: 0,
      running: 0,
      completed: 0,
      failed: 0,
    };

    for (const agent of this.agents.values()) {
      counts[agent.status]++;
    }

    return counts;
  }
}
