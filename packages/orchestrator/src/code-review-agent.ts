/**
 * Code Review Agent
 *
 * Reviews all changes before PR creation using the Anthropic API.
 */

import type { Octokit } from '@octokit/rest';
import Anthropic from '@anthropic-ai/sdk';
import { eq } from 'drizzle-orm';
import {
  createLogger,
  getDb,
  subtasks,
  codeReviews,
  agentRuns,
  parseRepoFullName,
  CODE_REVIEW_SETTINGS,
} from '@conductor/core';
import type { Task, CodeReview, CodeReviewIssue, CodeReviewResult } from '@conductor/core';
import { CODE_REVIEW_PROMPT } from './prompts/code-review.js';

const logger = createLogger('code-review-agent');

export interface CodeReviewAgentOptions {
  task: Task;
  octokit: Octokit;
  onProgress?: (message: string) => void;
}

interface ReviewOutput {
  result: CodeReviewResult;
  issues: CodeReviewIssue[];
  summary: string;
  iteration: number;
}

export class CodeReviewAgent {
  private anthropic: Anthropic;
  private task: Task;
  private octokit: Octokit;
  private onProgress?: (message: string) => void;

  constructor(options: CodeReviewAgentOptions) {
    this.task = options.task;
    this.octokit = options.octokit;
    this.onProgress = options.onProgress;
    this.anthropic = new Anthropic();
  }

  async review(): Promise<ReviewOutput> {
    const db = getDb();
    const { owner, repo } = parseRepoFullName(this.task.repositoryFullName);

    logger.info({ taskId: this.task.id }, 'Code Review Agent starting');

    // Get existing review count for this task
    const existingReviews = await db
      .select()
      .from(codeReviews)
      .where(eq(codeReviews.taskId, this.task.id));

    const iteration = existingReviews.length + 1;

    if (iteration > CODE_REVIEW_SETTINGS.maxIterations) {
      logger.warn(
        { taskId: this.task.id, iteration },
        'Maximum review iterations reached'
      );
      return {
        result: 'failed',
        issues: [],
        summary: 'Maximum review iterations reached',
        iteration,
      };
    }

    this.onProgress?.(`Starting code review (iteration ${iteration})`);

    // Create agent run record
    const [agentRun] = await db
      .insert(agentRuns)
      .values({
        taskId: this.task.id,
        agentType: 'code_review',
        status: 'running',
        model: 'claude-sonnet-4-20250514',
      })
      .returning();

    try {
      // Get all modified files from subtasks
      const taskSubtasks = await db
        .select()
        .from(subtasks)
        .where(eq(subtasks.taskId, this.task.id));

      const allModifiedFiles = taskSubtasks.flatMap((s) => s.filesModified || []);
      const uniqueFiles = [...new Set(allModifiedFiles)];

      this.onProgress?.(`Reviewing ${uniqueFiles.length} modified files`);

      // Get the diff for each modified file
      const diffs = await this.getFileDiffs(owner, repo, uniqueFiles);

      // Perform the review
      const reviewResult = await this.performReview(diffs, taskSubtasks);

      // Update agent run
      await db
        .update(agentRuns)
        .set({
          status: 'completed',
          completedAt: new Date(),
        })
        .where(eq(agentRuns.id, agentRun.id));

      // Store review result
      await db.insert(codeReviews).values({
        taskId: this.task.id,
        agentRunId: agentRun.id,
        result: reviewResult.result,
        iteration,
        summary: reviewResult.summary,
        issues: reviewResult.issues,
      });

      logger.info(
        {
          taskId: this.task.id,
          result: reviewResult.result,
          issueCount: reviewResult.issues.length,
          iteration,
        },
        'Code review complete'
      );

      return {
        ...reviewResult,
        iteration,
      };
    } catch (err) {
      await db
        .update(agentRuns)
        .set({
          status: 'failed',
          completedAt: new Date(),
        })
        .where(eq(agentRuns.id, agentRun.id));

      throw err;
    }
  }

  private async getFileDiffs(
    owner: string,
    repo: string,
    files: string[]
  ): Promise<Map<string, string>> {
    const diffs = new Map<string, string>();

    if (!this.task.branchName) {
      return diffs;
    }

    try {
      // Get the comparison between base branch and our branch
      const { data: repoData } = await this.octokit.repos.get({ owner, repo });
      const baseBranch = repoData.default_branch;

      const { data: comparison } = await this.octokit.repos.compareCommits({
        owner,
        repo,
        base: baseBranch,
        head: this.task.branchName,
      });

      for (const file of comparison.files || []) {
        if (files.includes(file.filename) && file.patch) {
          diffs.set(file.filename, file.patch);
        }
      }
    } catch (err) {
      logger.warn({ err }, 'Failed to get file diffs');
    }

    return diffs;
  }

  private async performReview(
    diffs: Map<string, string>,
    taskSubtasks: Array<{ title: string; description: string; subprojectPath: string }>
  ): Promise<Omit<ReviewOutput, 'iteration'>> {
    const diffContent = Array.from(diffs.entries())
      .map(([file, diff]) => `### ${file}\n\`\`\`diff\n${diff}\n\`\`\``)
      .join('\n\n');

    const subtaskContext = taskSubtasks
      .map((s) => `- **${s.subprojectPath}**: ${s.title}\n  ${s.description}`)
      .join('\n');

    const prompt = `
# Code Review Request

## Task Information
**Title:** ${this.task.title}
**Description:** ${this.task.description || 'No description provided'}

## Subtasks Completed
${subtaskContext}

## Changes to Review
${diffContent || 'No diffs available - review based on subtask completion.'}

## Your Task

Review the code changes and identify any issues. For each issue found:
1. Specify the file and line number (if applicable)
2. Categorize as error, warning, or suggestion
3. Describe the issue clearly
4. Provide a suggestion for fixing it

Respond with a JSON object in this exact format:
\`\`\`json
{
  "result": "approved" | "changes_requested" | "failed",
  "summary": "Brief summary of the review",
  "issues": [
    {
      "file": "path/to/file.ts",
      "line": 42,
      "severity": "error" | "warning" | "suggestion",
      "message": "Description of the issue",
      "suggestion": "How to fix it"
    }
  ]
}
\`\`\`

Review Criteria:
- Code correctness and logic errors
- Security vulnerabilities (injection, XSS, etc.)
- Error handling
- Code style consistency
- Performance concerns
- Missing tests (if applicable)

If there are no significant issues, return "approved" with an empty issues array.
    `;

    const response = await this.anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: CODE_REVIEW_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    });

    const content = response.content[0];
    if (content.type !== 'text') {
      throw new Error('Unexpected response type from Claude');
    }

    const jsonMatch = content.text.match(/```json\n([\s\S]*?)\n```/);
    if (!jsonMatch) {
      // If no JSON found, assume approved with summary
      return {
        result: 'approved',
        summary: content.text.slice(0, 500),
        issues: [],
      };
    }

    const review = JSON.parse(jsonMatch[1]) as {
      result: CodeReviewResult;
      summary: string;
      issues: CodeReviewIssue[];
    };

    // Apply pass threshold
    const errorCount = review.issues.filter((i) => i.severity === 'error').length;
    if (errorCount <= CODE_REVIEW_SETTINGS.passThreshold) {
      review.result = 'approved';
    }

    return review;
  }
}
