/**
 * Master Agent
 *
 * Analyzes tasks and decomposes them into subtasks for sub-agents.
 */

import type { Octokit } from '@octokit/rest';
import Anthropic from '@anthropic-ai/sdk';
import {
  createLogger,
  getDb,
  subtasks,
  parseRepoFullName,
} from '@conductor/core';
import type { Task, TaskDecomposition, Subtask } from '@conductor/core';
import { SubprojectDetector } from './subproject-detector.js';
import { MASTER_PROMPT } from './prompts/master.js';

const logger = createLogger('master-agent');

export interface MasterAgentOptions {
  task: Task;
  octokit: Octokit;
  onProgress?: (message: string) => void;
}

interface DecompositionResult {
  subtasks: Subtask[];
  affectedSubprojects: string[];
  summary: string;
}

export class MasterAgent {
  private anthropic: Anthropic;
  private task: Task;
  private octokit: Octokit;
  private onProgress?: (message: string) => void;

  constructor(options: MasterAgentOptions) {
    this.task = options.task;
    this.octokit = options.octokit;
    this.onProgress = options.onProgress;
    this.anthropic = new Anthropic();
  }

  async decompose(): Promise<DecompositionResult> {
    const { owner, repo } = parseRepoFullName(this.task.repositoryFullName);

    logger.info({ taskId: this.task.id }, 'Master Agent starting decomposition');
    this.onProgress?.('Analyzing repository structure');

    // Get repository file structure
    const repoStructure = await this.getRepositoryStructure(owner, repo);

    // Load repository config
    const config = await this.getRepoConfig(owner, repo);

    // Detect subprojects
    const detector = new SubprojectDetector(config);
    const detectedSubprojects = detector.detectFromFileList(repoStructure);

    this.onProgress?.(`Found ${detectedSubprojects.length} subprojects`);

    logger.info(
      { taskId: this.task.id, subprojects: detectedSubprojects },
      'Subprojects detected'
    );

    // Get relevant files content for context
    const contextFiles = await this.getContextFiles(owner, repo);

    // Use Claude to analyze and decompose the task
    this.onProgress?.('Analyzing task and creating subtasks');

    const decomposition = await this.analyzeWithClaude(
      repoStructure,
      detectedSubprojects,
      contextFiles
    );

    // Create subtask records in database
    const db = getDb();
    const createdSubtasks: Subtask[] = [];

    for (const subtaskDef of decomposition.subtasks) {
      const [created] = await db
        .insert(subtasks)
        .values({
          taskId: this.task.id,
          subprojectPath: subtaskDef.subprojectPath,
          title: subtaskDef.title,
          description: subtaskDef.description,
          status: 'pending',
          dependsOn: subtaskDef.dependsOn,
        })
        .returning();

      createdSubtasks.push(created);
    }

    logger.info(
      {
        taskId: this.task.id,
        subtaskCount: createdSubtasks.length,
        affectedSubprojects: decomposition.affectedSubprojects,
      },
      'Task decomposition complete'
    );

    return {
      subtasks: createdSubtasks,
      affectedSubprojects: decomposition.affectedSubprojects,
      summary: decomposition.summary,
    };
  }

  private async getRepositoryStructure(
    owner: string,
    repo: string
  ): Promise<string[]> {
    const files: string[] = [];

    const fetchTree = async (path = '') => {
      try {
        const { data } = await this.octokit.repos.getContent({
          owner,
          repo,
          path,
        });

        if (Array.isArray(data)) {
          for (const item of data) {
            if (item.type === 'file') {
              files.push(item.path);
            } else if (item.type === 'dir' && !item.name.startsWith('.')) {
              // Recursively fetch directories, but skip hidden ones
              await fetchTree(item.path);
            }
          }
        }
      } catch (err) {
        logger.warn({ path, err }, 'Failed to fetch directory contents');
      }
    };

    await fetchTree();
    return files;
  }

  private async getRepoConfig(owner: string, repo: string) {
    try {
      const { data } = await this.octokit.repos.getContent({
        owner,
        repo,
        path: '.conductor.yml',
      });

      if ('content' in data) {
        const content = Buffer.from(data.content, 'base64').toString('utf-8');
        const { parseConfig } = await import('@conductor/core');
        return parseConfig(content);
      }
    } catch {
      // Config file doesn't exist
    }

    return null;
  }

  private async getContextFiles(
    owner: string,
    repo: string
  ): Promise<Map<string, string>> {
    const contextFiles = new Map<string, string>();
    const filesToFetch = [
      'README.md',
      'CLAUDE.md',
      'REQUIREMENTS.md',
      'package.json',
      'pnpm-workspace.yaml',
      'turbo.json',
    ];

    for (const file of filesToFetch) {
      try {
        const { data } = await this.octokit.repos.getContent({
          owner,
          repo,
          path: file,
        });

        if ('content' in data) {
          const content = Buffer.from(data.content, 'base64').toString('utf-8');
          contextFiles.set(file, content);
        }
      } catch {
        // File doesn't exist
      }
    }

    return contextFiles;
  }

  private async analyzeWithClaude(
    repoStructure: string[],
    subprojects: string[],
    contextFiles: Map<string, string>
  ): Promise<TaskDecomposition> {
    const contextContent = Array.from(contextFiles.entries())
      .map(([file, content]) => `### ${file}\n\`\`\`\n${content}\n\`\`\``)
      .join('\n\n');

    const prompt = `
# Task Analysis Request

## Task Information
**Title:** ${this.task.title}
**Description:** ${this.task.description || 'No description provided'}

## Repository Structure
The repository has the following file structure:
\`\`\`
${repoStructure.slice(0, 500).join('\n')}
${repoStructure.length > 500 ? `\n... and ${repoStructure.length - 500} more files` : ''}
\`\`\`

## Detected Subprojects
${subprojects.length > 0 ? subprojects.join('\n') : 'No subprojects detected (single project repository)'}

## Context Files
${contextContent || 'No context files found'}

## Your Task

Analyze the task and break it down into subtasks. For each subtask:
1. Identify which subproject it belongs to
2. Provide a clear title and detailed description
3. Identify dependencies between subtasks

Respond with a JSON object in this exact format:
\`\`\`json
{
  "summary": "Brief summary of the overall approach",
  "affectedSubprojects": ["path/to/subproject1", "path/to/subproject2"],
  "subtasks": [
    {
      "subprojectPath": "packages/api",
      "title": "Add user endpoint",
      "description": "Create a new REST endpoint for user management with GET/POST/PUT/DELETE operations",
      "dependsOn": [],
      "files": ["src/routes/users.ts", "src/models/user.ts"]
    }
  ],
  "estimatedComplexity": "medium"
}
\`\`\`

Important:
- Each subtask should be focused and achievable by a single agent
- Include dependencies if subtasks must be completed in a specific order
- If the task affects shared code, create a subtask for that first
- Keep subtask descriptions actionable and specific
    `;

    const response = await this.anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: MASTER_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    });

    // Extract JSON from response
    const content = response.content[0];
    if (content.type !== 'text') {
      throw new Error('Unexpected response type from Claude');
    }

    const jsonMatch = content.text.match(/```json\n([\s\S]*?)\n```/);
    if (!jsonMatch) {
      throw new Error('Could not parse decomposition response');
    }

    const decomposition = JSON.parse(jsonMatch[1]) as TaskDecomposition;

    // Validate the response
    if (!decomposition.subtasks || decomposition.subtasks.length === 0) {
      // If no subtasks, create a single task for the whole repo
      decomposition.subtasks = [
        {
          subprojectPath: '.',
          title: this.task.title,
          description: this.task.description || this.task.title,
          dependsOn: [],
          files: [],
        },
      ];
    }

    return decomposition;
  }
}
