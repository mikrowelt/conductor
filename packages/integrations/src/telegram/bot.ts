/**
 * Telegram Bot
 *
 * Interactive Telegram bot for Conductor notifications and commands.
 */

import { Telegraf } from 'telegraf';
import { eq } from 'drizzle-orm';
import { createLogger, getDb, tasks, subtasks } from '@conductor/core';

const logger = createLogger('telegram-bot');

export class TelegramBot {
  private bot: Telegraf;
  private running = false;

  constructor(token: string) {
    this.bot = new Telegraf(token);
    this.setupHandlers();
  }

  private setupHandlers() {
    // Start command
    this.bot.start((ctx) => {
      ctx.reply(
        'Welcome to Conductor Bot! 🤖\n\n' +
          'I will notify you about task progress and PR creation.\n\n' +
          'Commands:\n' +
          '/status - Show active tasks\n' +
          '/tasks - List recent tasks\n' +
          '/help - Show this help message'
      );

      logger.info(
        { chatId: ctx.chat.id, user: ctx.from?.username },
        'Bot started'
      );
    });

    // Help command
    this.bot.help((ctx) => {
      ctx.reply(
        'Conductor Bot Commands:\n\n' +
          '/status - Show currently active tasks\n' +
          '/tasks - List recent tasks (last 10)\n' +
          '/task <id> - Get details of a specific task\n' +
          '/help - Show this help message\n\n' +
          'You will automatically receive notifications when:\n' +
          '- A task is picked up\n' +
          '- Subtasks are completed\n' +
          '- Code review finishes\n' +
          '- A PR is created\n' +
          '- A task fails'
      );
    });

    // Status command
    this.bot.command('status', async (ctx) => {
      try {
        const db = getDb();
        const activeTasks = await db
          .select()
          .from(tasks)
          .where(eq(tasks.status, 'executing'))
          .limit(5);

        if (activeTasks.length === 0) {
          ctx.reply('No active tasks at the moment.');
          return;
        }

        const statusLines = await Promise.all(
          activeTasks.map(async (task) => {
            const taskSubtasks = await db
              .select()
              .from(subtasks)
              .where(eq(subtasks.taskId, task.id));

            const completed = taskSubtasks.filter(
              (s) => s.status === 'completed'
            ).length;
            const total = taskSubtasks.length;

            return `📋 *${this.escapeMarkdown(task.title)}*\n   Progress: ${completed}/${total} subtasks`;
          })
        );

        ctx.reply(`*Active Tasks*\n\n${statusLines.join('\n\n')}`, {
          parse_mode: 'Markdown',
        });
      } catch (err) {
        logger.error({ err }, 'Failed to get status');
        ctx.reply('Failed to fetch task status.');
      }
    });

    // Tasks command
    this.bot.command('tasks', async (ctx) => {
      try {
        const db = getDb();
        const recentTasks = await db
          .select()
          .from(tasks)
          .orderBy(tasks.createdAt)
          .limit(10);

        if (recentTasks.length === 0) {
          ctx.reply('No tasks found.');
          return;
        }

        const taskLines = recentTasks.map((task) => {
          const emoji = this.getStatusEmoji(task.status);
          return `${emoji} *${this.escapeMarkdown(task.title)}*\n   Status: ${task.status} | ID: \`${task.id.slice(0, 8)}\``;
        });

        ctx.reply(`*Recent Tasks*\n\n${taskLines.join('\n\n')}`, {
          parse_mode: 'Markdown',
        });
      } catch (err) {
        logger.error({ err }, 'Failed to get tasks');
        ctx.reply('Failed to fetch tasks.');
      }
    });

    // Task detail command
    this.bot.command('task', async (ctx) => {
      const taskId = ctx.message.text.split(' ')[1];

      if (!taskId) {
        ctx.reply('Usage: /task <task_id>');
        return;
      }

      try {
        const db = getDb();
        const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));

        if (!task) {
          ctx.reply(`Task not found: ${taskId}`);
          return;
        }

        const taskSubtasks = await db
          .select()
          .from(subtasks)
          .where(eq(subtasks.taskId, task.id));

        const subtaskLines = taskSubtasks
          .map((s) => {
            const emoji = this.getStatusEmoji(s.status);
            return `   ${emoji} ${this.escapeMarkdown(s.title)}`;
          })
          .join('\n');

        const message = `
*Task: ${this.escapeMarkdown(task.title)}*

📊 Status: ${task.status}
🏷️ Repository: ${task.repositoryFullName}
${task.pullRequestUrl ? `🔗 PR: ${task.pullRequestUrl}` : ''}

*Subtasks:*
${subtaskLines || '   No subtasks'}
        `.trim();

        ctx.reply(message, { parse_mode: 'Markdown' });
      } catch (err) {
        logger.error({ err, taskId }, 'Failed to get task');
        ctx.reply('Failed to fetch task details.');
      }
    });

    // Error handler
    this.bot.catch((err, ctx) => {
      logger.error({ err, updateType: ctx.updateType }, 'Bot error');
    });
  }

  async start(): Promise<void> {
    if (this.running) return;

    logger.info('Starting Telegram bot');
    await this.bot.launch();
    this.running = true;

    // Graceful shutdown
    process.once('SIGINT', () => this.stop());
    process.once('SIGTERM', () => this.stop());
  }

  async stop(): Promise<void> {
    if (!this.running) return;

    logger.info('Stopping Telegram bot');
    this.bot.stop('SIGTERM');
    this.running = false;
  }

  private getStatusEmoji(status: string): string {
    const emojis: Record<string, string> = {
      pending: '⏳',
      decomposing: '🔍',
      executing: '🔄',
      queued: '📋',
      running: '🔄',
      review: '🔍',
      pr_created: '📝',
      completed: '✅',
      done: '✅',
      failed: '❌',
    };
    return emojis[status] || '❓';
  }

  private escapeMarkdown(text: string): string {
    return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
  }
}
