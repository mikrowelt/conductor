/**
 * Zod schema for .conductor.yml configuration validation
 */

import { z } from 'zod';

export const agentConfigSchema = z.object({
  model: z.string().default('claude-sonnet-4-20250514'),
  maxTurns: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(1).optional(),
});

export const subAgentConfigSchema = agentConfigSchema.extend({
  maxParallel: z.number().int().min(1).max(10).default(5),
  timeoutMinutes: z.number().int().min(1).max(120).default(30),
});

export const subprojectDefinitionSchema = z.object({
  path: z.string(),
  name: z.string(),
  language: z.string().optional(),
  testCommand: z.string().optional(),
  buildCommand: z.string().optional(),
});

export const conductorConfigSchema = z.object({
  version: z.string().regex(/^\d+\.\d+$/),
  project: z.object({
    name: z.string().min(1),
    description: z.string().optional(),
  }),
  subprojects: z.object({
    autoDetect: z
      .object({
        enabled: z.boolean().default(true),
        patterns: z.array(z.string()).default(['packages/*', 'apps/*']),
      })
      .default({}),
    explicit: z.array(subprojectDefinitionSchema).optional(),
  }),
  agents: z
    .object({
      master: agentConfigSchema.default({}),
      subAgent: subAgentConfigSchema.default({}),
      codeReview: agentConfigSchema.default({}),
    })
    .default({}),
  workflow: z.object({
    triggers: z.object({
      startColumn: z.string().default('Todo'),
      reviewColumn: z.string().optional(),
    }),
    branchPattern: z
      .string()
      .default('conductor/{task_id}/{short_description}'),
    autoMerge: z.boolean().default(false),
    requireSmokeTest: z.boolean().default(false),
    smokeTestWebhook: z.string().url().optional(),
  }),
  notifications: z
    .object({
      telegram: z
        .object({
          enabled: z.boolean().default(false),
          botToken: z.string().optional(),
          chatId: z.string().optional(),
        })
        .optional(),
      slack: z
        .object({
          enabled: z.boolean().default(false),
          webhookUrl: z.string().url().optional(),
        })
        .optional(),
      webhook: z
        .object({
          enabled: z.boolean().default(false),
          url: z.string().url().optional(),
        })
        .optional(),
    })
    .default({}),
  security: z
    .object({
      blockedPatterns: z
        .array(z.string())
        .default([
          '**/.env',
          '**/.env.*',
          '**/secrets/**',
          '**/*.pem',
          '**/*.key',
        ]),
      maxFilesPerPr: z.number().int().positive().default(50),
      maxLinesPerPr: z.number().int().positive().default(2000),
      allowedCommands: z.array(z.string()).optional(),
    })
    .default({}),
});

export type ConductorConfigInput = z.input<typeof conductorConfigSchema>;
export type ConductorConfigOutput = z.output<typeof conductorConfigSchema>;
