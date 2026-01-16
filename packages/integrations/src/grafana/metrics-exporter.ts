/**
 * Metrics Exporter for Grafana
 *
 * Exports Prometheus-compatible metrics for Grafana dashboards.
 */

import { createLogger, getDb, tasks, subtasks, agentRuns } from '@conductor/core';
import { count, sum, avg, eq } from 'drizzle-orm';

const logger = createLogger('metrics-exporter');

export interface Metric {
  name: string;
  help: string;
  type: 'counter' | 'gauge' | 'histogram';
  value: number;
  labels?: Record<string, string>;
}

export class MetricsExporter {
  /**
   * Export all metrics in Prometheus format
   */
  async exportPrometheus(): Promise<string> {
    const metrics = await this.collectMetrics();
    return this.formatPrometheus(metrics);
  }

  /**
   * Collect all metrics
   */
  async collectMetrics(): Promise<Metric[]> {
    const metrics: Metric[] = [];
    const db = getDb();

    try {
      // Task counts by status
      const taskCounts = await this.getTaskCountsByStatus();
      for (const [status, count] of Object.entries(taskCounts)) {
        metrics.push({
          name: 'conductor_tasks_total',
          help: 'Total number of tasks by status',
          type: 'gauge',
          value: count,
          labels: { status },
        });
      }

      // Subtask counts by status
      const subtaskCounts = await this.getSubtaskCountsByStatus();
      for (const [status, count] of Object.entries(subtaskCounts)) {
        metrics.push({
          name: 'conductor_subtasks_total',
          help: 'Total number of subtasks by status',
          type: 'gauge',
          value: count,
          labels: { status },
        });
      }

      // Token usage
      const tokenStats = await this.getTokenUsageStats();
      metrics.push({
        name: 'conductor_tokens_total',
        help: 'Total tokens used',
        type: 'counter',
        value: tokenStats.totalTokens,
      });

      metrics.push({
        name: 'conductor_tokens_input',
        help: 'Total input tokens used',
        type: 'counter',
        value: tokenStats.inputTokens,
      });

      metrics.push({
        name: 'conductor_tokens_output',
        help: 'Total output tokens used',
        type: 'counter',
        value: tokenStats.outputTokens,
      });

      // Cost
      metrics.push({
        name: 'conductor_cost_total_dollars',
        help: 'Total cost in dollars',
        type: 'counter',
        value: tokenStats.totalCost,
      });

      // Agent run counts by type
      const agentRunCounts = await this.getAgentRunCountsByType();
      for (const [type, count] of Object.entries(agentRunCounts)) {
        metrics.push({
          name: 'conductor_agent_runs_total',
          help: 'Total agent runs by type',
          type: 'counter',
          value: count,
          labels: { agent_type: type },
        });
      }

      // Average task duration
      const avgDuration = await this.getAverageTaskDuration();
      metrics.push({
        name: 'conductor_task_duration_seconds_avg',
        help: 'Average task duration in seconds',
        type: 'gauge',
        value: avgDuration,
      });

    } catch (err) {
      logger.error({ err }, 'Failed to collect metrics');
    }

    return metrics;
  }

  private async getTaskCountsByStatus(): Promise<Record<string, number>> {
    const db = getDb();
    const result = await db
      .select({
        status: tasks.status,
        count: count(),
      })
      .from(tasks)
      .groupBy(tasks.status);

    const counts: Record<string, number> = {};
    for (const row of result) {
      counts[row.status] = row.count;
    }
    return counts;
  }

  private async getSubtaskCountsByStatus(): Promise<Record<string, number>> {
    const db = getDb();
    const result = await db
      .select({
        status: subtasks.status,
        count: count(),
      })
      .from(subtasks)
      .groupBy(subtasks.status);

    const counts: Record<string, number> = {};
    for (const row of result) {
      counts[row.status] = row.count;
    }
    return counts;
  }

  private async getTokenUsageStats(): Promise<{
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    totalCost: number;
  }> {
    const db = getDb();
    const result = await db
      .select({
        inputTokens: sum(agentRuns.inputTokens),
        outputTokens: sum(agentRuns.outputTokens),
        totalCost: sum(agentRuns.totalCost),
      })
      .from(agentRuns);

    const row = result[0];
    const inputTokens = Number(row?.inputTokens) || 0;
    const outputTokens = Number(row?.outputTokens) || 0;

    return {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      totalCost: Number(row?.totalCost) || 0,
    };
  }

  private async getAgentRunCountsByType(): Promise<Record<string, number>> {
    const db = getDb();
    const result = await db
      .select({
        agentType: agentRuns.agentType,
        count: count(),
      })
      .from(agentRuns)
      .groupBy(agentRuns.agentType);

    const counts: Record<string, number> = {};
    for (const row of result) {
      counts[row.agentType] = row.count;
    }
    return counts;
  }

  private async getAverageTaskDuration(): Promise<number> {
    const db = getDb();
    const completedTasks = await db
      .select({
        startedAt: tasks.startedAt,
        completedAt: tasks.completedAt,
      })
      .from(tasks)
      .where(eq(tasks.status, 'done'))
      .limit(100);

    if (completedTasks.length === 0) return 0;

    let totalDuration = 0;
    let count = 0;

    for (const task of completedTasks) {
      if (task.startedAt && task.completedAt) {
        totalDuration +=
          task.completedAt.getTime() - task.startedAt.getTime();
        count++;
      }
    }

    return count > 0 ? totalDuration / count / 1000 : 0;
  }

  private formatPrometheus(metrics: Metric[]): string {
    const lines: string[] = [];
    const seenMetrics = new Set<string>();

    for (const metric of metrics) {
      // Add help and type only once per metric name
      if (!seenMetrics.has(metric.name)) {
        lines.push(`# HELP ${metric.name} ${metric.help}`);
        lines.push(`# TYPE ${metric.name} ${metric.type}`);
        seenMetrics.add(metric.name);
      }

      // Format labels
      let labelStr = '';
      if (metric.labels && Object.keys(metric.labels).length > 0) {
        const labelPairs = Object.entries(metric.labels)
          .map(([k, v]) => `${k}="${v}"`)
          .join(',');
        labelStr = `{${labelPairs}}`;
      }

      lines.push(`${metric.name}${labelStr} ${metric.value}`);
    }

    return lines.join('\n');
  }
}
