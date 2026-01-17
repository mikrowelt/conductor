/**
 * Fix Agent
 *
 * Fixes code review issues using Claude Code.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { createLogger, loadConfig } from '@conductor/core';
import type { Task, CodeReviewIssue } from '@conductor/core';
import { ClaudeRunner } from './claude-runner.js';

const execAsync = promisify(exec);

const logger = createLogger('fix-agent');

export interface FixAgentOptions {
  task: Task;
  issues: CodeReviewIssue[];
  workspace: {
    path: string;
    branchName: string;
    baseBranch: string;
  };
  onProgress?: (message: string) => void;
  onOutput?: (output: string) => void;
}

export interface FixAgentResult {
  success: boolean;
  filesModified: string[];
  inputTokens: number;
  outputTokens: number;
  totalCost: number;
  duration: number;
  output: string;
}

export class FixAgent {
  private runner: ClaudeRunner | null = null;

  constructor(private options: FixAgentOptions) {}

  async execute(): Promise<FixAgentResult> {
    const { task, issues, workspace } = this.options;

    logger.info(
      {
        taskId: task.id,
        issueCount: issues.length,
      },
      'Fix Agent starting execution'
    );

    // Load repository config
    const config = await loadConfig(workspace.path);

    // Build the prompt for fixing issues
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
    const allModifiedFiles = [...new Set([...result.filesModified, ...gitModifiedFiles])];

    logger.info(
      {
        taskId: task.id,
        success: result.success,
        filesModified: allModifiedFiles.length,
        tokens: result.inputTokens + result.outputTokens,
        cost: result.totalCost,
      },
      'Fix Agent completed'
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
    const { task, issues, workspace } = this.options;

    const issuesList = issues
      .map((issue, i) => {
        const location = issue.line ? `${issue.file}:${issue.line}` : issue.file;
        const suggestion = issue.suggestion ? `\n   Suggestion: ${issue.suggestion}` : '';
        return `${i + 1}. [${issue.severity.toUpperCase()}] ${location}\n   ${issue.message}${suggestion}`;
      })
      .join('\n\n');

    return `
# Code Review Fix Request

You are fixing issues found during code review.

## Task Context
**Title:** ${task.title}
**Description:** ${task.description || 'No description provided'}

## Branch Information
- Working branch: ${workspace.branchName}
- Base branch: ${workspace.baseBranch}

## Issues to Fix

The code review found the following issues that need to be addressed:

${issuesList}

## Instructions

1. Address each issue listed above
2. For errors: These MUST be fixed
3. For warnings: Fix these unless there's a good reason not to
4. For suggestions: Consider implementing these improvements
5. Make minimal changes needed to fix the issues
6. Follow existing code patterns and conventions
7. Run tests if available to ensure your fixes don't break anything

## Important

- Focus ONLY on fixing the identified issues
- Do NOT make other changes or improvements
- If an issue is unclear, make a reasonable fix based on the suggestion
- After fixing, stage your changes with git add

Please begin fixing the issues now.
    `.trim();
  }

  private buildSystemPrompt(): string {
    return `
You are a Fix Agent focused on addressing code review issues.

Your task is to fix specific issues identified during code review.

Guidelines:
- Be precise and targeted in your fixes
- Make minimal changes needed to address each issue
- Follow existing patterns in the codebase
- Ensure your fixes don't introduce new issues
- Stage your changes with git add after making them
- Do not make unnecessary refactoring changes

Focus only on the issues provided - do not make other changes.
    `.trim();
  }
}
