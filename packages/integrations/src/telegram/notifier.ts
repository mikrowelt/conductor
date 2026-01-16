/**
 * Telegram Notifier
 *
 * Sends formatted notifications to Telegram.
 */

import { createLogger, NOTIFICATION_TEMPLATES } from '@conductor/core';
import type { NotificationType } from '@conductor/core';

const logger = createLogger('telegram-notifier');

export interface TelegramNotifierOptions {
  botToken: string;
  chatId: string;
}

export class TelegramNotifier {
  private botToken: string;
  private chatId: string;
  private apiBase = 'https://api.telegram.org';

  constructor(options: TelegramNotifierOptions) {
    this.botToken = options.botToken;
    this.chatId = options.chatId;
  }

  async send(
    type: NotificationType,
    payload: Record<string, unknown>
  ): Promise<void> {
    const message = this.formatMessage(type, payload);

    try {
      const response = await fetch(
        `${this.apiBase}/bot${this.botToken}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: this.chatId,
            text: message,
            parse_mode: 'Markdown',
            disable_web_page_preview: true,
          }),
        }
      );

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Telegram API error: ${error}`);
      }

      logger.info({ type, chatId: this.chatId }, 'Telegram notification sent');
    } catch (err) {
      logger.error({ err, type }, 'Failed to send Telegram notification');
      throw err;
    }
  }

  private formatMessage(
    type: NotificationType,
    payload: Record<string, unknown>
  ): string {
    const template = NOTIFICATION_TEMPLATES[type];
    let message = template.replace(/\{(\w+)\}/g, (_match, key) => {
      const value = payload[key];
      return value !== undefined ? String(value) : `{${key}}`;
    });

    // Add additional context based on type
    switch (type) {
      case 'task_started':
        message += `\n\nTask ID: \`${payload.taskId || 'unknown'}\``;
        if (payload.repository) {
          message += `\nRepo: ${payload.repository}`;
        }
        break;

      case 'pr_created':
        if (payload.title) {
          message += `\n*${this.escapeMarkdown(String(payload.title))}*`;
        }
        break;

      case 'task_failed':
        if (payload.taskId) {
          message += `\n\nTask ID: \`${payload.taskId}\``;
        }
        break;

      case 'task_completed':
        if (payload.prUrl) {
          message += `\n[View PR](${payload.prUrl})`;
        }
        break;
    }

    return message;
  }

  private escapeMarkdown(text: string): string {
    return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
  }
}
