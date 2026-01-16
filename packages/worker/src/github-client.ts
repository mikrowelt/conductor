/**
 * GitHub Client Factory
 *
 * Creates authenticated Octokit instances for GitHub App installations.
 */

import { Octokit } from '@octokit/rest';
import { createAppAuth } from '@octokit/auth-app';
import { readFileSync } from 'fs';
import { createLogger } from '@conductor/core';

const logger = createLogger('github-client');

let privateKey: string | null = null;
let appId: string | null = null;

function getAppCredentials() {
  if (!privateKey || !appId) {
    const privateKeyPath = process.env.GITHUB_PRIVATE_KEY_PATH;
    privateKey = privateKeyPath
      ? readFileSync(privateKeyPath, 'utf-8')
      : process.env.GITHUB_PRIVATE_KEY || null;

    appId = process.env.GITHUB_APP_ID || null;

    if (!privateKey) {
      throw new Error('GitHub private key not configured');
    }

    if (!appId) {
      throw new Error('GitHub App ID not configured');
    }
  }

  return { privateKey, appId };
}

export async function createGitHubClient(
  installationId: number
): Promise<Octokit> {
  const { privateKey, appId } = getAppCredentials();

  logger.debug({ installationId }, 'Creating GitHub client');

  const octokit = new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId,
      privateKey,
      installationId,
    },
  });

  return octokit;
}

export async function getInstallationToken(
  installationId: number
): Promise<string> {
  const { privateKey, appId } = getAppCredentials();

  const auth = createAppAuth({
    appId,
    privateKey,
    installationId,
  });

  const { token } = await auth({ type: 'installation' });

  return token;
}
