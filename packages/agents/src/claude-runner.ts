/**
 * Claude Code CLI Runner
 *
 * Spawns and manages Claude Code as a child process.
 */

import { spawn, type ChildProcess } from 'child_process';
import { createLogger, CLAUDE_CODE_SETTINGS, calculateTokenCost } from '@conductor/core';

const logger = createLogger('claude-runner');

export interface ClaudeRunnerOptions {
  workDir: string;
  prompt: string;
  model?: string;
  maxTurns?: number;
  timeout?: number;
  allowedTools?: string[];
  disallowedTools?: string[];
  systemPrompt?: string;
  onOutput?: (output: string) => void;
  onProgress?: (message: string) => void;
}

export interface AgentOutput {
  success: boolean;
  output: string;
  exitCode: number | null;
  inputTokens: number;
  outputTokens: number;
  totalCost: number;
  filesModified: string[];
  duration: number;
}

export class ClaudeRunner {
  private process: ChildProcess | null = null;
  private killed = false;

  constructor(private options: ClaudeRunnerOptions) {}

  async run(): Promise<AgentOutput> {
    const startTime = Date.now();
    const args = this.buildArgs();

    logger.info(
      {
        workDir: this.options.workDir,
        model: this.options.model,
        maxTurns: this.options.maxTurns,
      },
      'Starting Claude Code'
    );

    return new Promise((resolve, reject) => {
      this.process = spawn(CLAUDE_CODE_SETTINGS.binary, args, {
        cwd: this.options.workDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
        },
      });

      let stdout = '';
      let stderr = '';
      let inputTokens = 0;
      let outputTokens = 0;
      const filesModified: string[] = [];

      // Handle stdout
      this.process.stdout?.on('data', (data: Buffer) => {
        const chunk = data.toString();
        stdout += chunk;

        // Try to parse JSON output for token counts
        this.parseJsonOutput(chunk, {
          onTokens: (input, output) => {
            inputTokens += input;
            outputTokens += output;
          },
          onFileModified: (file) => {
            if (!filesModified.includes(file)) {
              filesModified.push(file);
            }
          },
          onProgress: (message) => {
            this.options.onProgress?.(message);
          },
        });

        this.options.onOutput?.(chunk);
      });

      // Handle stderr
      this.process.stderr?.on('data', (data: Buffer) => {
        const chunk = data.toString();
        stderr += chunk;
        logger.debug({ stderr: chunk }, 'Claude Code stderr');
      });

      // Set timeout
      const timeout = this.options.timeout || CLAUDE_CODE_SETTINGS.defaultTimeout;
      const timer = setTimeout(() => {
        logger.warn({ timeout }, 'Claude Code timeout, killing process');
        this.kill();
      }, timeout);

      // Handle process exit
      this.process.on('close', (code) => {
        clearTimeout(timer);

        const duration = Date.now() - startTime;
        const model = this.options.model || 'claude-sonnet-4-20250514';
        const totalCost = calculateTokenCost(model, inputTokens, outputTokens);

        logger.info(
          {
            exitCode: code,
            duration,
            inputTokens,
            outputTokens,
            totalCost,
            filesModified: filesModified.length,
          },
          'Claude Code completed'
        );

        resolve({
          success: code === 0 && !this.killed,
          output: stdout,
          exitCode: code,
          inputTokens,
          outputTokens,
          totalCost,
          filesModified,
          duration,
        });
      });

      this.process.on('error', (err) => {
        clearTimeout(timer);
        logger.error({ err }, 'Claude Code process error');
        reject(err);
      });

      // Send prompt to stdin
      this.process.stdin?.write(this.options.prompt);
      this.process.stdin?.end();
    });
  }

  kill(): void {
    if (this.process && !this.killed) {
      this.killed = true;
      this.process.kill('SIGTERM');

      // Force kill after 5 seconds
      setTimeout(() => {
        if (this.process && !this.process.killed) {
          this.process.kill('SIGKILL');
        }
      }, 5000);
    }
  }

  private buildArgs(): string[] {
    const args = [...CLAUDE_CODE_SETTINGS.defaultFlags];

    if (this.options.model) {
      args.push('--model', this.options.model);
    }

    if (this.options.maxTurns) {
      args.push('--max-turns', this.options.maxTurns.toString());
    }

    if (this.options.systemPrompt) {
      args.push('--system-prompt', this.options.systemPrompt);
    }

    if (this.options.allowedTools?.length) {
      args.push('--allowedTools', this.options.allowedTools.join(','));
    }

    if (this.options.disallowedTools?.length) {
      args.push('--disallowedTools', this.options.disallowedTools.join(','));
    }

    // Read prompt from stdin
    args.push('-p', '-');

    return args;
  }

  private parseJsonOutput(
    chunk: string,
    callbacks: {
      onTokens: (input: number, output: number) => void;
      onFileModified: (file: string) => void;
      onProgress: (message: string) => void;
    }
  ): void {
    // Try to parse each line as JSON
    const lines = chunk.split('\n').filter((line) => line.trim());

    for (const line of lines) {
      try {
        const json = JSON.parse(line);

        // Handle token usage updates
        if (json.type === 'usage') {
          callbacks.onTokens(
            json.input_tokens || 0,
            json.output_tokens || 0
          );
        }

        // Handle file modification events
        if (json.type === 'tool_use' && json.tool === 'write' && json.file) {
          callbacks.onFileModified(json.file);
        }

        if (json.type === 'tool_use' && json.tool === 'edit' && json.file) {
          callbacks.onFileModified(json.file);
        }

        // Handle progress messages
        if (json.type === 'assistant' && json.message) {
          callbacks.onProgress(json.message.slice(0, 100));
        }
      } catch {
        // Not JSON, ignore
      }
    }
  }
}

/**
 * Spawn a Claude Code agent with the given options
 */
export async function spawnClaudeAgent(
  options: ClaudeRunnerOptions
): Promise<AgentOutput> {
  const runner = new ClaudeRunner(options);
  return runner.run();
}
