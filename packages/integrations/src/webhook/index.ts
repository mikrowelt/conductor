/**
 * Generic Webhook Integration
 *
 * Sends notifications to arbitrary webhook endpoints.
 */

import { createLogger } from '@conductor/core';
import type { NotificationType, ConductorEvent } from '@conductor/core';

const logger = createLogger('webhook-integration');

export interface WebhookConfig {
  url: string;
  headers?: Record<string, string>;
  secret?: string;
}

export class WebhookNotifier {
  private config: WebhookConfig;

  constructor(config: WebhookConfig) {
    this.config = config;
  }

  async send(
    type: NotificationType,
    payload: Record<string, unknown>
  ): Promise<void> {
    const webhookPayload = {
      type,
      timestamp: new Date().toISOString(),
      payload,
    };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.config.headers,
    };

    // Add signature if secret is configured
    if (this.config.secret) {
      const signature = await this.computeSignature(
        JSON.stringify(webhookPayload)
      );
      headers['X-Conductor-Signature'] = signature;
    }

    try {
      const response = await fetch(this.config.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(webhookPayload),
      });

      if (!response.ok) {
        throw new Error(`Webhook failed: ${response.status}`);
      }

      logger.info({ type, url: this.config.url }, 'Webhook notification sent');
    } catch (err) {
      logger.error({ err, type, url: this.config.url }, 'Webhook failed');
      throw err;
    }
  }

  async sendEvent(event: ConductorEvent): Promise<void> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.config.headers,
    };

    const eventPayload = {
      ...event,
      timestamp: new Date().toISOString(),
    };

    if (this.config.secret) {
      const signature = await this.computeSignature(
        JSON.stringify(eventPayload)
      );
      headers['X-Conductor-Signature'] = signature;
    }

    try {
      const response = await fetch(this.config.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(eventPayload),
      });

      if (!response.ok) {
        throw new Error(`Webhook failed: ${response.status}`);
      }

      logger.info(
        { eventType: event.type, url: this.config.url },
        'Webhook event sent'
      );
    } catch (err) {
      logger.error(
        { err, eventType: event.type, url: this.config.url },
        'Webhook failed'
      );
      throw err;
    }
  }

  private async computeSignature(payload: string): Promise<string> {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(this.config.secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const signature = await crypto.subtle.sign(
      'HMAC',
      key,
      encoder.encode(payload)
    );

    return `sha256=${Buffer.from(signature).toString('hex')}`;
  }
}

/**
 * Smoke test webhook trigger
 *
 * Triggers a smoke test on a staging environment via webhook.
 */
export class SmokeTestTrigger {
  private webhookUrl: string;

  constructor(webhookUrl: string) {
    this.webhookUrl = webhookUrl;
  }

  async trigger(options: {
    taskId: string;
    branchName: string;
    repositoryFullName: string;
    commitSha: string;
  }): Promise<{ triggered: boolean; pollUrl?: string }> {
    logger.info(
      { taskId: options.taskId, branch: options.branchName },
      'Triggering smoke test'
    );

    try {
      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'smoke_test',
          ...options,
        }),
      });

      if (!response.ok) {
        throw new Error(`Smoke test trigger failed: ${response.status}`);
      }

      const result = (await response.json()) as { poll_url?: string };

      return {
        triggered: true,
        pollUrl: result.poll_url,
      };
    } catch (err) {
      logger.error({ err }, 'Failed to trigger smoke test');
      return { triggered: false };
    }
  }

  async pollStatus(pollUrl: string): Promise<{
    status: 'pending' | 'running' | 'passed' | 'failed';
    details?: string;
  }> {
    try {
      const response = await fetch(pollUrl);

      if (!response.ok) {
        throw new Error(`Poll failed: ${response.status}`);
      }

      return (await response.json()) as {
        status: 'pending' | 'running' | 'passed' | 'failed';
        details?: string;
      };
    } catch (err) {
      logger.error({ err, pollUrl }, 'Failed to poll smoke test status');
      return { status: 'pending' };
    }
  }
}
