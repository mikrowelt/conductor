/**
 * Workspace Manager
 *
 * Manages git repositories for agent execution.
 */

import { spawn } from 'child_process';
import { mkdir, access, rm } from 'fs/promises';
import { join } from 'path';
import {
  createLogger,
  generateBranchName,
  parseRepoFullName,
} from '@conductor/core';
import type { Task } from '@conductor/core';
import type { Octokit } from '@octokit/rest';
import { getInstallationToken } from './github-client.js';

const logger = createLogger('workspace');

const WORKSPACES_DIR = process.env.WORKSPACES_DIR || '/tmp/conductor-workspaces';

export interface Workspace {
  path: string;
  branchName: string;
  baseBranch: string;
}

export async function prepareWorkspace(options: {
  task: Task;
  octokit: Octokit;
}): Promise<Workspace> {
  const { task, octokit } = options;
  const { owner, repo } = parseRepoFullName(task.repositoryFullName);

  // Create workspaces directory if it doesn't exist
  await mkdir(WORKSPACES_DIR, { recursive: true });

  const workspacePath = join(WORKSPACES_DIR, task.id);

  // Check if workspace already exists
  const exists = await access(workspacePath)
    .then(() => true)
    .catch(() => false);

  // Get repository info
  const { data: repoData } = await octokit.repos.get({ owner, repo });
  const baseBranch = repoData.default_branch;

  // Generate branch name
  const branchName =
    task.branchName ||
    generateBranchName(
      'conductor/{task_id}/{short_description}',
      task.id,
      task.title
    );

  if (exists) {
    logger.info({ taskId: task.id, path: workspacePath }, 'Using existing workspace');

    // Fetch latest changes and checkout our branch
    await execGit(workspacePath, ['fetch', 'origin']);

    try {
      await execGit(workspacePath, ['checkout', branchName]);
    } catch {
      // Branch doesn't exist yet, create it from base
      await execGit(workspacePath, ['checkout', baseBranch]);
      await execGit(workspacePath, ['checkout', '-b', branchName]);
    }
  } else {
    logger.info({ taskId: task.id, path: workspacePath }, 'Creating new workspace');

    // Get installation token for cloning
    const token = await getInstallationToken(task.installationId);

    // Clone the repository
    const cloneUrl = `https://x-access-token:${token}@github.com/${task.repositoryFullName}.git`;

    await execCommand('git', ['clone', '--depth', '100', cloneUrl, workspacePath]);

    // Configure git user
    await execGit(workspacePath, [
      'config',
      'user.name',
      'Conductor Bot',
    ]);
    await execGit(workspacePath, [
      'config',
      'user.email',
      'conductor@users.noreply.github.com',
    ]);

    // Create and checkout our branch
    await execGit(workspacePath, ['checkout', '-b', branchName]);
  }

  return {
    path: workspacePath,
    branchName,
    baseBranch,
  };
}

export async function cleanupWorkspace(taskId: string): Promise<void> {
  const workspacePath = join(WORKSPACES_DIR, taskId);

  try {
    await rm(workspacePath, { recursive: true, force: true });
    logger.info({ taskId, path: workspacePath }, 'Workspace cleaned up');
  } catch (err) {
    logger.warn({ taskId, err }, 'Failed to cleanup workspace');
  }
}

export async function commitAndPush(
  workspace: Workspace,
  message: string
): Promise<string> {
  // Stage all changes
  await execGit(workspace.path, ['add', '-A']);

  // Check if there are changes to commit
  const status = await execGit(workspace.path, ['status', '--porcelain']);
  if (!status.trim()) {
    logger.info('No changes to commit');
    return '';
  }

  // Commit
  await execGit(workspace.path, [
    'commit',
    '-m',
    message,
    '--author',
    'Conductor Bot <conductor@users.noreply.github.com>',
  ]);

  // Get the commit SHA
  const sha = (await execGit(workspace.path, ['rev-parse', 'HEAD'])).trim();

  // Push
  await execGit(workspace.path, [
    'push',
    '-u',
    'origin',
    workspace.branchName,
  ]);

  logger.info({ branchName: workspace.branchName, sha }, 'Changes pushed');

  return sha;
}

async function execGit(cwd: string, args: string[]): Promise<string> {
  return execCommand('git', args, cwd);
}

function execCommand(
  command: string,
  args: string[],
  cwd?: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`Command failed: ${command} ${args.join(' ')}\n${stderr}`));
      }
    });

    proc.on('error', reject);
  });
}
