#!/usr/bin/env node
/**
 * Conductor CLI
 *
 * CLI tool for self-hosted Conductor setup and management.
 */

import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { startCommand } from './commands/start.js';
import { statusCommand } from './commands/status.js';

const program = new Command();

program
  .name('conductor')
  .description('CLI tool for Conductor - Claude Code orchestration system')
  .version('0.1.0');

program
  .command('init')
  .description('Initialize a new Conductor installation')
  .option('-d, --dir <directory>', 'Installation directory', '.')
  .action(initCommand);

program
  .command('start')
  .description('Start Conductor services')
  .option('--webhook-only', 'Start only the webhook server')
  .option('--worker-only', 'Start only the worker')
  .action(startCommand);

program
  .command('status')
  .description('Check status of Conductor services')
  .action(statusCommand);

program.parse();
