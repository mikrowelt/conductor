/**
 * Workspace Manager
 *
 * Manages git repositories for agent execution.
 */

import { spawn } from 'child_process';
import { mkdir, access, rm, writeFile } from 'fs/promises';
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

// In-memory locks to prevent race conditions between concurrent subtasks
const workspaceLocks = new Map<string, Promise<void>>();

/**
 * Acquire a lock for a workspace to prevent concurrent access
 */
async function acquireWorkspaceLock(taskId: string): Promise<() => void> {
  // Wait for any existing lock to release
  while (workspaceLocks.has(taskId)) {
    await workspaceLocks.get(taskId);
    // Small delay to prevent tight loop
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  // Create our lock
  let releaseLock: () => void;
  const lockPromise = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });

  workspaceLocks.set(taskId, lockPromise);

  return () => {
    workspaceLocks.delete(taskId);
    releaseLock!();
  };
}

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

  // Acquire lock to prevent race conditions when multiple subtasks start simultaneously
  const releaseLock = await acquireWorkspaceLock(task.id);

  try {
    // Create workspaces directory if it doesn't exist
    await mkdir(WORKSPACES_DIR, { recursive: true });

    const workspacePath = join(WORKSPACES_DIR, task.id);

    // Check if workspace already exists (and is a valid git repo)
    const exists = await access(join(workspacePath, '.git'))
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

      // Remove any partial workspace that might exist
      await rm(workspacePath, { recursive: true, force: true });

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
  } finally {
    // Always release the lock
    releaseLock();
  }
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

/**
 * Ensure CLAUDE.md and REQUIREMENTS.md exist in the workspace.
 * Creates them from templates if missing.
 */
export async function ensureProjectDocs(
  workspacePath: string,
  repoName: string
): Promise<{ claudeCreated: boolean; requirementsCreated: boolean }> {
  const result = { claudeCreated: false, requirementsCreated: false };

  const claudePath = join(workspacePath, 'CLAUDE.md');
  const requirementsPath = join(workspacePath, 'REQUIREMENTS.md');

  // Check and create CLAUDE.md
  const claudeExists = await access(claudePath)
    .then(() => true)
    .catch(() => false);

  if (!claudeExists) {
    const template = generateClaudeTemplate(repoName);
    await writeFile(claudePath, template, 'utf-8');
    result.claudeCreated = true;
    logger.info({ path: claudePath }, 'Created CLAUDE.md template');
  }

  // Check and create REQUIREMENTS.md
  const requirementsExists = await access(requirementsPath)
    .then(() => true)
    .catch(() => false);

  if (!requirementsExists) {
    const template = generateRequirementsTemplate(repoName);
    await writeFile(requirementsPath, template, 'utf-8');
    result.requirementsCreated = true;
    logger.info({ path: requirementsPath }, 'Created REQUIREMENTS.md template');
  }

  return result;
}

function generateClaudeTemplate(repoName: string): string {
  return `# ${repoName}

## Project Overview

<!-- Describe what this project does -->

---

## Project Structure

\`\`\`
${repoName}/
├── src/           # Source code
├── tests/         # Test files
└── ...
\`\`\`

---

## Development Commands

\`\`\`bash
# Install dependencies
npm install  # or pnpm install, yarn install

# Run development server
npm run dev

# Run tests
npm test

# Build for production
npm run build
\`\`\`

---

## Key Files

<!-- List important files and their purposes -->

---

## Coding Conventions

- Follow existing code patterns
- Write tests for new features
- Keep functions small and focused
- Use meaningful variable names

---

## Related Documentation

- See [REQUIREMENTS.md](./REQUIREMENTS.md) for technical specifications
`;
}

function generateRequirementsTemplate(repoName: string): string {
  return `# ${repoName} - Technical Requirements

## Overview

<!-- Brief description of what this project/module does -->

---

## Dependencies

### Internal Dependencies
<!-- List other internal packages/modules this depends on -->

### External Dependencies
<!-- Key external libraries and their purposes -->

---

## APIs and Interfaces

### Exported Functions/Classes
<!-- Document the public API -->

### Events
<!-- Any events this module publishes or subscribes to -->

---

## Configuration

<!-- Environment variables and configuration options -->

---

## Build and Run

\`\`\`bash
# How to build
npm run build

# How to run
npm start

# How to test
npm test
\`\`\`

---

## Notes

<!-- Any additional technical notes -->

---

*This file should be updated whenever interfaces or dependencies change.*
`;
}
