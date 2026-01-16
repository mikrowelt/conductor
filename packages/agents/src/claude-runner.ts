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
        args: args.slice(0, -1), // Log args without the prompt for brevity
        promptLength: this.options.prompt.length,
        hasApiKey: !!process.env.ANTHROPIC_API_KEY,
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
        logger.info({ chunkLength: chunk.length, preview: chunk.slice(0, 200) }, 'Claude Code stdout chunk');

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

        // Log raw output lengths for debugging
        logger.info({
          stdoutLength: stdout.length,
          stderrLength: stderr.length,
          stdoutPreview: stdout.slice(0, 500),
          stderrPreview: stderr.slice(0, 500),
        }, 'Claude Code raw output');

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

      // Close stdin (prompt is passed as argument)
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
    const args: string[] = [...CLAUDE_CODE_SETTINGS.defaultFlags];

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

    // Print mode for non-interactive output
    args.push('-p');

    // Add the prompt as the final argument
    args.push(this.options.prompt);

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

        // Handle final result (--output-format json)
        if (json.type === 'result' && json.usage) {
          const inputTokens = (json.usage.input_tokens || 0) +
            (json.usage.cache_creation_input_tokens || 0) +
            (json.usage.cache_read_input_tokens || 0);
          const outputTokens = json.usage.output_tokens || 0;
          callbacks.onTokens(inputTokens, outputTokens);
          logger.debug({ inputTokens, outputTokens, cost: json.total_cost_usd }, 'Claude Code result');
        }

        // Handle streaming token usage updates (--output-format stream-json)
        if (json.type === 'usage') {
          callbacks.onTokens(
            json.input_tokens || 0,
            json.output_tokens || 0
          );
        }

        // Handle file modification events from streaming output
        if (json.type === 'tool_use' && json.tool === 'write' && json.file) {
          callbacks.onFileModified(json.file);
        }

        if (json.type === 'tool_use' && json.tool === 'edit' && json.file) {
          callbacks.onFileModified(json.file);
        }

        // Handle tool result for file modifications (stream-json format)
        if (json.type === 'tool_result' && json.tool) {
          if ((json.tool === 'Write' || json.tool === 'Edit') && json.file_path) {
            callbacks.onFileModified(json.file_path);
          }
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
