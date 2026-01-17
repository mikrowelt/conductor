/**
 * Start Command
 *
 * Starts Conductor services.
 */

import { spawn } from 'child_process';
import { access } from 'fs/promises';
import { join } from 'path';
import chalk from 'chalk';
import ora from 'ora';

interface StartOptions {
  webhookOnly?: boolean;
  workerOnly?: boolean;
}

export async function startCommand(options: StartOptions): Promise<void> {
  console.log(chalk.blue.bold('\n🎵 Starting Conductor\n'));

  // Check if .env exists
  const envExists = await access(join(process.cwd(), '.env'))
    .then(() => true)
    .catch(() => false);

  if (!envExists) {
    console.log(chalk.red('Error: No .env file found. Run "conductor init" first.'));
    process.exit(1);
  }

  // Load environment variables
  const { config } = await import('dotenv');
  config();

  const services: Array<{ name: string; command: string; args: string[] }> = [];

  if (!options.workerOnly) {
    services.push({
      name: 'Webhook Server',
      command: 'node',
      args: ['packages/webhook-server/dist/index.js'],
    });
  }

  if (!options.webhookOnly) {
    services.push({
      name: 'Worker',
      command: 'node',
      args: ['packages/worker/dist/index.js'],
    });
  }

  console.log(chalk.white(`Starting ${services.length} service(s)...\n`));

  const processes: Array<{ name: string; proc: ReturnType<typeof spawn> }> = [];

  for (const service of services) {
    const spinner = ora(`Starting ${service.name}...`).start();

    const proc = spawn(service.command, service.args, {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    processes.push({ name: service.name, proc });

    proc.stdout?.on('data', (data) => {
      // Log output with service prefix
      const lines = data.toString().split('\n').filter((l: string) => l.trim());
      for (const line of lines) {
        console.log(chalk.gray(`[${service.name}] `) + line);
      }
    });

    proc.stderr?.on('data', (data) => {
      const lines = data.toString().split('\n').filter((l: string) => l.trim());
      for (const line of lines) {
        console.log(chalk.red(`[${service.name}] `) + line);
      }
    });

    proc.on('error', (err) => {
      spinner.fail(`${service.name} failed to start: ${err.message}`);
    });

    proc.on('exit', (code) => {
      if (code !== 0) {
        console.log(chalk.red(`${service.name} exited with code ${code}`));
      }
    });

    // Wait a bit to check if it started successfully
    await new Promise((resolve) => setTimeout(resolve, 1000));

    if (proc.killed || proc.exitCode !== null) {
      spinner.fail(`${service.name} failed to start`);
    } else {
      spinner.succeed(`${service.name} started`);
    }
  }

  console.log(chalk.green('\n✅ Conductor is running\n'));
  console.log(chalk.gray('Press Ctrl+C to stop all services\n'));

  // Handle shutdown
  const shutdown = () => {
    console.log(chalk.yellow('\nShutting down...'));
    for (const { name, proc } of processes) {
      if (!proc.killed) {
        console.log(chalk.gray(`Stopping ${name}...`));
        proc.kill('SIGTERM');
      }
    }
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Keep the process alive
  await new Promise(() => {});
}
