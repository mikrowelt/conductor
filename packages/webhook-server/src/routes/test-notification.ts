/**
 * Test Notification Route
 *
 * Allows testing notifications via the API.
 * POST /api/test-notification
 */

import { Router, type Router as RouterType } from 'express';
import { createLogger } from '@conductor/core';
import type { NotificationType } from '@conductor/core';

const logger = createLogger('test-notification');

export const testNotificationRouter: RouterType = Router();

interface TestNotificationRequest {
  channel: 'telegram' | 'slack' | 'webhook';
  type?: NotificationType;
  message?: string;
  // Telegram specific
  botToken?: string;
  chatId?: string;
  // Slack/Webhook specific
  webhookUrl?: string;
}

testNotificationRouter.post('/', async (req, res) => {
  const body = req.body as TestNotificationRequest;

  logger.info({ channel: body.channel }, 'Test notification requested');

  try {
    const { channel } = body;

    if (!channel) {
      return res.status(400).json({ error: 'channel is required' });
    }

    switch (channel) {
      case 'telegram': {
        const botToken = body.botToken || process.env.TELEGRAM_BOT_TOKEN;
        const chatId = body.chatId || process.env.TELEGRAM_CHAT_ID;

        if (!botToken) {
          return res.status(400).json({
            error: 'Telegram bot token not configured',
            hint: 'Set TELEGRAM_BOT_TOKEN in .env or provide botToken in request body',
          });
        }

        if (!chatId) {
          return res.status(400).json({
            error: 'Telegram chat ID not configured',
            hint: 'Set TELEGRAM_CHAT_ID in .env or provide chatId in request body',
          });
        }

        const message =
          body.message ||
          `*Conductor Test Notification*\n\nThis is a test message from Conductor.\n\nTimestamp: ${new Date().toISOString()}`;

        const response = await fetch(
          `https://api.telegram.org/bot${botToken}/sendMessage`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: message,
              parse_mode: 'Markdown',
            }),
          }
        );

        const result = (await response.json()) as {
          ok: boolean;
          result?: { message_id?: number };
          description?: string;
        };

        if (!response.ok) {
          return res.status(400).json({
            error: 'Telegram API error',
            details: result,
          });
        }

        logger.info({ chatId }, 'Test Telegram notification sent');
        return res.json({
          success: true,
          channel: 'telegram',
          chatId,
          messageId: result.result?.message_id,
        });
      }

      case 'slack': {
        const webhookUrl = body.webhookUrl;

        if (!webhookUrl) {
          return res.status(400).json({
            error: 'Slack webhook URL not provided',
            hint: 'Provide webhookUrl in request body',
          });
        }

        const message = body.message || 'Conductor Test Notification - This is a test message.';

        const response = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: message }),
        });

        if (!response.ok) {
          return res.status(400).json({
            error: 'Slack webhook error',
            status: response.status,
          });
        }

        logger.info('Test Slack notification sent');
        return res.json({ success: true, channel: 'slack' });
      }

      case 'webhook': {
        const webhookUrl = body.webhookUrl;

        if (!webhookUrl) {
          return res.status(400).json({
            error: 'Webhook URL not provided',
            hint: 'Provide webhookUrl in request body',
          });
        }

        const response = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: body.type || 'test',
            message: body.message || 'Conductor test notification',
            timestamp: new Date().toISOString(),
          }),
        });

        if (!response.ok) {
          return res.status(400).json({
            error: 'Webhook error',
            status: response.status,
          });
        }

        logger.info({ url: webhookUrl }, 'Test webhook notification sent');
        return res.json({ success: true, channel: 'webhook' });
      }

      default:
        return res.status(400).json({
          error: `Unknown channel: ${channel}`,
          hint: 'Valid channels: telegram, slack, webhook',
        });
    }
  } catch (err) {
    logger.error({ err }, 'Test notification failed');
    return res.status(500).json({
      error: 'Failed to send test notification',
      details: err instanceof Error ? err.message : String(err),
    });
  }
});
