/**
 * Notification Processor
 *
 * Sends notifications to Telegram, Slack, and webhooks.
 */

import type { Job } from 'bullmq';
import { eq } from 'drizzle-orm';
import {
  createLogger,
  getDb,
  notifications,
  tasks,
  NOTIFICATION_TEMPLATES,
} from '@conductor/core';
import type { NotificationJob, Notification, NotificationType } from '@conductor/core';

const logger = createLogger('notification-processor');

export async function notificationProcessor(job: Job<NotificationJob>) {
  const { notificationId } = job.data;

  logger.debug({ notificationId, jobId: job.id }, 'Processing notification');

  const db = getDb();

  const [notification] = await db
    .select()
    .from(notifications)
    .where(eq(notifications.id, notificationId));

  if (!notification) {
    throw new Error(`Notification not found: ${notificationId}`);
  }

  try {
    switch (notification.channel) {
      case 'telegram':
        await sendTelegramNotification(notification);
        break;

      case 'slack':
        await sendSlackNotification(notification);
        break;

      case 'webhook':
        await sendWebhookNotification(notification);
        break;

      default:
        throw new Error(`Unknown notification channel: ${notification.channel}`);
    }

    // Mark as sent
    await db
      .update(notifications)
      .set({ sentAt: new Date() })
      .where(eq(notifications.id, notificationId));

    logger.info(
      { notificationId, channel: notification.channel },
      'Notification sent'
    );
  } catch (err) {
    logger.error({ notificationId, err }, 'Failed to send notification');

    await db
      .update(notifications)
      .set({
        error: err instanceof Error ? err.message : String(err),
      })
      .where(eq(notifications.id, notificationId));

    throw err;
  }
}

async function sendTelegramNotification(notification: Notification) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = notification.payload.chatId || process.env.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) {
    throw new Error('Telegram bot token or chat ID not configured');
  }

  const message = formatNotificationMessage(
    notification.type as NotificationType,
    notification.payload
  );

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

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Telegram API error: ${error}`);
  }
}

async function sendSlackNotification(notification: Notification) {
  const webhookUrl = notification.payload.webhookUrl as string | undefined;

  if (!webhookUrl) {
    throw new Error('Slack webhook URL not configured');
  }

  const message = formatNotificationMessage(
    notification.type as NotificationType,
    notification.payload
  );

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: message,
      unfurl_links: false,
    }),
  });

  if (!response.ok) {
    throw new Error(`Slack webhook error: ${response.status}`);
  }
}

async function sendWebhookNotification(notification: Notification) {
  const url = notification.payload.url as string | undefined;

  if (!url) {
    throw new Error('Webhook URL not configured');
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: notification.type,
      taskId: notification.taskId,
      timestamp: new Date().toISOString(),
      payload: notification.payload,
    }),
  });

  if (!response.ok) {
    throw new Error(`Webhook error: ${response.status}`);
  }
}

function formatNotificationMessage(
  type: NotificationType,
  payload: Record<string, unknown>
): string {
  const template = NOTIFICATION_TEMPLATES[type] || '{type}';

  return template.replace(/\{(\w+)\}/g, (_match, key) => {
    return String(payload[key] ?? `{${key}}`);
  });
}

// Helper to queue a notification
export async function queueNotification(
  taskId: string,
  type: NotificationType,
  channel: 'telegram' | 'slack' | 'webhook',
  payload: Record<string, unknown>
) {
  const db = getDb();
  const { Queue } = await import('bullmq');
  const { getRedis, QUEUE_NAMES } = await import('@conductor/core');

  const [notification] = await db
    .insert(notifications)
    .values({
      taskId,
      type,
      channel,
      payload,
    })
    .returning();

  const queue = new Queue(QUEUE_NAMES.NOTIFICATIONS, {
    connection: getRedis(),
  });

  await queue.add(
    'send-notification',
    { notificationId: notification.id },
    { attempts: 3, backoff: { type: 'exponential', delay: 5000 } }
  );

  return notification;
}
