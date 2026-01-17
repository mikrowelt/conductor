/**
 * Metrics Route
 *
 * Exposes Prometheus-compatible metrics for Grafana scraping.
 * GET /metrics
 */

import { Router, type Router as RouterType } from 'express';
import { createLogger } from '@conductor/core';
import { MetricsExporter } from '@conductor/integrations';

const logger = createLogger('metrics-route');

export const metricsRouter: RouterType = Router();

const metricsExporter = new MetricsExporter();

metricsRouter.get('/', async (_req, res) => {
  try {
    const metrics = await metricsExporter.exportPrometheus();

    res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.send(metrics);

    logger.debug('Metrics exported');
  } catch (err) {
    logger.error({ err }, 'Failed to export metrics');
    res.status(500).send('Failed to export metrics');
  }
});
