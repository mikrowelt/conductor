/**
 * Sub-Agent
 *
 * Executes a single subtask using Claude Code.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { createLogger, loadConfig } from '@conductor/core';
import type { Task, Subtask } from '@conductor/core';
import { ClaudeRunner } from './claude-runner.js';

const execAsync = promisify(exec);

const logger = createLogger('sub-agent');

export interface SubAgentOptions {
  task: Task;
  subtask: Subtask;
  workspace: {
    path: string;
    branchName: string;
    baseBranch: string;
  };
  onProgress?: (message: string) => void;
  onOutput?: (output: string) => void;
}

export interface SubAgentResult {
  success: boolean;
  filesModified: string[];
  inputTokens: number;
  outputTokens: number;
  totalCost: number;
  duration: number;
  output: string;
}

export class SubAgent {
  private runner: ClaudeRunner | null = null;

  constructor(private options: SubAgentOptions) {}

  async execute(): Promise<SubAgentResult> {
    const { task, subtask, workspace } = this.options;

    logger.info(
      {
        taskId: task.id,
        subtaskId: subtask.id,
        subproject: subtask.subprojectPath,
      },
      'Sub-Agent starting execution'
    );

    // Load repository config
    const config = await loadConfig(workspace.path);

    // Build the prompt for this subtask
    const prompt = this.buildPrompt();

    // Determine model and settings
    const model = config?.agents.subAgent.model || 'claude-sonnet-4-20250514';
    const maxTurns = config?.agents.subAgent.maxTurns || 50;
    const timeout = (config?.agents.subAgent.timeoutMinutes || 30) * 60 * 1000;

    // Create and run Claude
    this.runner = new ClaudeRunner({
      workDir: workspace.path,
      prompt,
      model,
      maxTurns,
      timeout,
      systemPrompt: this.buildSystemPrompt(),
      onOutput: this.options.onOutput,
      onProgress: this.options.onProgress,
    });

    const result = await this.runner.run();

    // Detect modified files using git
    const gitModifiedFiles = await this.detectModifiedFiles(workspace.path);
    // Combine with any files detected from Claude's output
    const allModifiedFiles = [...new Set([...result.filesModified, ...gitModifiedFiles])];

    logger.info(
      {
        taskId: task.id,
        subtaskId: subtask.id,
        success: result.success,
        filesModified: allModifiedFiles.length,
        tokens: result.inputTokens + result.outputTokens,
        cost: result.totalCost,
      },
      'Sub-Agent completed'
    );

    return {
      success: result.success,
      filesModified: allModifiedFiles,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      totalCost: result.totalCost,
      duration: result.duration,
      output: result.output,
    };
  }

  private async detectModifiedFiles(workspacePath: string): Promise<string[]> {
    try {
      // Get list of modified, added, and untracked files
      const { stdout: modified } = await execAsync(
        'git diff --name-only && git diff --cached --name-only',
        { cwd: workspacePath }
      );
      const { stdout: untracked } = await execAsync(
        'git ls-files --others --exclude-standard',
        { cwd: workspacePath }
      );

      const files = [...modified.split('\n'), ...untracked.split('\n')]
        .filter((f) => f.trim().length > 0);

      logger.info({ fileCount: files.length, files }, 'Git detected modified files');
      return [...new Set(files)];
    } catch (err) {
      logger.warn({ err }, 'Failed to detect modified files via git');
      return [];
    }
  }

  stop(): void {
    if (this.runner) {
      this.runner.kill();
    }
  }

  private buildPrompt(): string {
    const { task, subtask, workspace } = this.options;

    return `
# Task Context

You are a Sub-Agent working on part of a larger task. Your job is to implement changes for a specific subproject.

## Main Task
**Title:** ${task.title}
**Description:** ${task.description || 'No description provided'}

## Your Subtask
**Title:** ${subtask.title}
**Description:** ${subtask.description}
**Subproject Path:** ${subtask.subprojectPath}

## Branch Information
- Working branch: ${workspace.branchName}
- Base branch: ${workspace.baseBranch}

## Instructions

1. Focus ONLY on the subtask assigned to you
2. Work within the subproject path: ${subtask.subprojectPath}
3. Make minimal, focused changes to complete the subtask
4. Follow existing code patterns and conventions
5. Add or update tests if appropriate
6. Do NOT modify files outside your subproject unless absolutely necessary
7. If you encounter issues that require changes outside your scope, document them clearly

## Completion Criteria

Your subtask is complete when:
- The described functionality is implemented
- Code follows project conventions
- No obvious bugs or issues
- Tests pass (if applicable)

Please begin implementing the subtask now.
    `.trim();
  }

  private buildSystemPrompt(): string {
    const { subtask } = this.options;

    return `
You are a focused Sub-Agent working on a specific part of a larger development task.

Your scope is limited to: ${subtask.subprojectPath}

Guidelines:
- Be efficient and focused
- Make minimal changes needed to complete the task
- Follow existing patterns in the codebase
- Write clean, maintainable code
- Document complex logic with comments
- Do not make unnecessary refactoring changes

If you need to read REQUIREMENTS.md or CLAUDE.md files in the repository, do so to understand project conventions.
    `.trim();
  }
}
