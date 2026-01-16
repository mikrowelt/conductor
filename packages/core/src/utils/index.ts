/**
 * Shared utilities
 */

import { randomBytes } from 'crypto';
import { TOKEN_COSTS } from '../constants/index.js';

/**
 * Generate a short ID for branch names
 */
export function generateShortId(length = 8): string {
  return randomBytes(length).toString('hex').slice(0, length);
}

/**
 * Sanitize a string for use in branch names
 */
export function sanitizeBranchName(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
}

/**
 * Generate a branch name from a task ID and description
 */
export function generateBranchName(
  pattern: string,
  taskId: string,
  description: string
): string {
  const shortId = taskId.slice(0, 8);
  const shortDescription = sanitizeBranchName(description);

  return pattern
    .replace('{task_id}', shortId)
    .replace('{short_description}', shortDescription);
}

/**
 * Calculate token cost for a model
 */
export function calculateTokenCost(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const costs = TOKEN_COSTS[model as keyof typeof TOKEN_COSTS];
  if (!costs) {
    // Default to Sonnet pricing
    return (inputTokens * 0.003 + outputTokens * 0.015) / 1000;
  }
  return (inputTokens * costs.input + outputTokens * costs.output) / 1000;
}

/**
 * Sleep for a given number of milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry a function with exponential backoff
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
    backoffMultiplier?: number;
    shouldRetry?: (error: unknown) => boolean;
  } = {}
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelayMs = 1000,
    maxDelayMs = 60000,
    backoffMultiplier = 2,
    shouldRetry = () => true,
  } = options;

  let lastError: unknown;
  let delay = initialDelayMs;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt === maxRetries || !shouldRetry(error)) {
        throw error;
      }

      await sleep(delay);
      delay = Math.min(delay * backoffMultiplier, maxDelayMs);
    }
  }

  throw lastError;
}

/**
 * Truncate a string to a maximum length
 */
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + '...';
}

/**
 * Parse a GitHub repository full name
 */
export function parseRepoFullName(fullName: string): {
  owner: string;
  repo: string;
} {
  const [owner, repo] = fullName.split('/');
  if (!owner || !repo) {
    throw new Error(`Invalid repository full name: ${fullName}`);
  }
  return { owner, repo };
}

/**
 * Check if a file path matches any of the blocked patterns
 */
export function isBlockedFile(
  filePath: string,
  blockedPatterns: string[]
): boolean {
  return blockedPatterns.some((pattern) => {
    // Simple glob matching
    const regex = new RegExp(
      '^' +
        pattern
          .replace(/\*\*/g, '.*')
          .replace(/\*/g, '[^/]*')
          .replace(/\?/g, '.') +
        '$'
    );
    return regex.test(filePath);
  });
}

/**
 * Group an array by a key function
 */
export function groupBy<T, K extends string | number>(
  array: T[],
  keyFn: (item: T) => K
): Record<K, T[]> {
  return array.reduce(
    (acc, item) => {
      const key = keyFn(item);
      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key].push(item);
      return acc;
    },
    {} as Record<K, T[]>
  );
}

/**
 * Format duration in milliseconds to human readable string
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`;
  return `${(ms / 3600000).toFixed(1)}h`;
}
