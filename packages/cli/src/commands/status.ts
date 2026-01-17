/**
 * Status Command
 *
 * Checks the status of Conductor services.
 */

import chalk from 'chalk';
import ora from 'ora';

export async function statusCommand(): Promise<void> {
  console.log(chalk.blue.bold('\n🎵 Conductor Status\n'));

  // Check webhook server via health endpoint
  const webhookSpinner = ora('Checking webhook server...').start();
  try {
    const port = process.env.PORT || '3000';
    const response = await fetch(`http://localhost:${port}/health`);
    const data = await response.json() as { status: string; checks?: Record<string, boolean> };

    if (data.status === 'ok') {
      webhookSpinner.succeed(`Webhook server: ${chalk.green('Running')}`);
      if (data.checks) {
        console.log(chalk.gray('  └─ Database: ') + (data.checks.database ? chalk.green('Connected') : chalk.red('Disconnected')));
        console.log(chalk.gray('  └─ Redis: ') + (data.checks.redis ? chalk.green('Connected') : chalk.red('Disconnected')));
      }
    } else {
      webhookSpinner.warn(`Webhook server: ${chalk.yellow('Degraded')}`);
    }
  } catch {
    webhookSpinner.fail(`Webhook server: ${chalk.red('Not running')}`);
    console.log(chalk.gray('  (Health endpoint not responding)'));
  }

  console.log('');
  console.log(chalk.gray('Tip: Start services with "conductor start"'));
  console.log('');
}
