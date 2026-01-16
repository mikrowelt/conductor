/**
 * Configuration loading and validation
 */

import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { parse as parseYaml } from 'yaml';
import { conductorConfigSchema, type ConductorConfigOutput } from './schema.js';
import type { ConductorConfig } from '../types/index.js';
import { createLogger } from '../logger/index.js';

const logger = createLogger('config');

export const CONFIG_FILE_NAMES = [
  '.conductor.yml',
  '.conductor.yaml',
  'conductor.yml',
  'conductor.yaml',
];

export async function loadConfig(
  repoPath: string
): Promise<ConductorConfig | null> {
  for (const fileName of CONFIG_FILE_NAMES) {
    const configPath = join(repoPath, fileName);
    if (existsSync(configPath)) {
      logger.info({ configPath }, 'Found config file');
      const content = await readFile(configPath, 'utf-8');
      return parseConfig(content);
    }
  }

  logger.warn({ repoPath }, 'No config file found, using defaults');
  return null;
}

export function parseConfig(content: string): ConductorConfig {
  const raw = parseYaml(content);
  const parsed = conductorConfigSchema.parse(raw);
  return transformConfig(parsed);
}

export function validateConfig(config: unknown): ConductorConfig {
  const parsed = conductorConfigSchema.parse(config);
  return transformConfig(parsed);
}

function transformConfig(parsed: ConductorConfigOutput): ConductorConfig {
  return {
    version: parsed.version,
    project: parsed.project,
    subprojects: {
      autoDetect: parsed.subprojects.autoDetect,
      explicit: parsed.subprojects.explicit,
    },
    agents: {
      master: parsed.agents.master,
      subAgent: parsed.agents.subAgent,
      codeReview: parsed.agents.codeReview,
    },
    workflow: {
      triggers: parsed.workflow.triggers,
      branchPattern: parsed.workflow.branchPattern,
      autoMerge: parsed.workflow.autoMerge,
      requireSmokeTest: parsed.workflow.requireSmokeTest,
      smokeTestWebhook: parsed.workflow.smokeTestWebhook,
    },
    notifications: {
      telegram: parsed.notifications.telegram,
      slack: parsed.notifications.slack,
      webhook: parsed.notifications.webhook,
    },
    security: parsed.security,
  };
}

export { conductorConfigSchema } from './schema.js';
