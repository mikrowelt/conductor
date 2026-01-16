/**
 * Grafana Dashboard Generator
 *
 * Generates a Grafana dashboard JSON for Conductor metrics.
 */

export interface DashboardPanel {
  title: string;
  type: string;
  gridPos: { x: number; y: number; w: number; h: number };
  targets: Array<{
    expr: string;
    legendFormat?: string;
  }>;
}

export class GrafanaDashboard {
  /**
   * Generate a complete Grafana dashboard JSON
   */
  generateDashboardJson(): object {
    return {
      annotations: { list: [] },
      editable: true,
      fiscalYearStartMonth: 0,
      graphTooltip: 0,
      id: null,
      links: [],
      liveNow: false,
      panels: this.generatePanels(),
      refresh: '30s',
      schemaVersion: 38,
      style: 'dark',
      tags: ['conductor', 'automation'],
      templating: { list: [] },
      time: { from: 'now-24h', to: 'now' },
      timepicker: {},
      timezone: '',
      title: 'Conductor Dashboard',
      uid: 'conductor-main',
      version: 1,
      weekStart: '',
    };
  }

  private generatePanels(): DashboardPanel[] {
    return [
      // Row 1: Overview stats
      {
        title: 'Active Tasks',
        type: 'stat',
        gridPos: { x: 0, y: 0, w: 4, h: 4 },
        targets: [
          {
            expr: 'conductor_tasks_total{status="executing"}',
            legendFormat: 'Active',
          },
        ],
      },
      {
        title: 'Completed Tasks (24h)',
        type: 'stat',
        gridPos: { x: 4, y: 0, w: 4, h: 4 },
        targets: [
          {
            expr: 'increase(conductor_tasks_total{status="done"}[24h])',
            legendFormat: 'Completed',
          },
        ],
      },
      {
        title: 'Failed Tasks (24h)',
        type: 'stat',
        gridPos: { x: 8, y: 0, w: 4, h: 4 },
        targets: [
          {
            expr: 'increase(conductor_tasks_total{status="failed"}[24h])',
            legendFormat: 'Failed',
          },
        ],
      },
      {
        title: 'Total Cost (24h)',
        type: 'stat',
        gridPos: { x: 12, y: 0, w: 4, h: 4 },
        targets: [
          {
            expr: 'increase(conductor_cost_total_dollars[24h])',
            legendFormat: 'Cost',
          },
        ],
      },
      {
        title: 'Avg Task Duration',
        type: 'stat',
        gridPos: { x: 16, y: 0, w: 4, h: 4 },
        targets: [
          {
            expr: 'conductor_task_duration_seconds_avg',
            legendFormat: 'Duration',
          },
        ],
      },
      {
        title: 'Total Tokens (24h)',
        type: 'stat',
        gridPos: { x: 20, y: 0, w: 4, h: 4 },
        targets: [
          {
            expr: 'increase(conductor_tokens_total[24h])',
            legendFormat: 'Tokens',
          },
        ],
      },

      // Row 2: Task status over time
      {
        title: 'Tasks by Status',
        type: 'timeseries',
        gridPos: { x: 0, y: 4, w: 12, h: 8 },
        targets: [
          {
            expr: 'conductor_tasks_total',
            legendFormat: '{{status}}',
          },
        ],
      },
      {
        title: 'Subtasks by Status',
        type: 'timeseries',
        gridPos: { x: 12, y: 4, w: 12, h: 8 },
        targets: [
          {
            expr: 'conductor_subtasks_total',
            legendFormat: '{{status}}',
          },
        ],
      },

      // Row 3: Token usage
      {
        title: 'Token Usage Over Time',
        type: 'timeseries',
        gridPos: { x: 0, y: 12, w: 12, h: 8 },
        targets: [
          {
            expr: 'rate(conductor_tokens_input[5m])',
            legendFormat: 'Input Tokens/s',
          },
          {
            expr: 'rate(conductor_tokens_output[5m])',
            legendFormat: 'Output Tokens/s',
          },
        ],
      },
      {
        title: 'Cost Over Time',
        type: 'timeseries',
        gridPos: { x: 12, y: 12, w: 12, h: 8 },
        targets: [
          {
            expr: 'increase(conductor_cost_total_dollars[1h])',
            legendFormat: 'Cost/hour',
          },
        ],
      },

      // Row 4: Agent runs
      {
        title: 'Agent Runs by Type',
        type: 'piechart',
        gridPos: { x: 0, y: 20, w: 8, h: 8 },
        targets: [
          {
            expr: 'conductor_agent_runs_total',
            legendFormat: '{{agent_type}}',
          },
        ],
      },
      {
        title: 'Agent Run Rate',
        type: 'timeseries',
        gridPos: { x: 8, y: 20, w: 16, h: 8 },
        targets: [
          {
            expr: 'rate(conductor_agent_runs_total[5m])',
            legendFormat: '{{agent_type}}',
          },
        ],
      },
    ];
  }

  /**
   * Export dashboard as JSON string
   */
  export(): string {
    return JSON.stringify(this.generateDashboardJson(), null, 2);
  }
}
