import { z } from 'zod';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import type { ToolDefinition, ToolContext, ToolResult } from '../../agent/toolRegistry';
import { ToolPolicyEngine } from './toolPolicies';

const ExecInputSchema = z.object({
  command: z.string().min(1).describe('Shell command to execute'),
  cwd: z.string().optional().describe('Working directory (within workspace)'),
  timeout: z.number().optional().describe('Timeout in ms (overrides default)'),
  env: z.record(z.string()).optional().describe('Additional environment variables'),
});

export function createExecTool(
  policy: ToolPolicyEngine,
  workspaceRoot: string,
): ToolDefinition {
  return {
    name: 'openclaw_exec',
    description: 'Execute a shell command securely with safe-bins policy and workspace isolation. Supports python, node, git, npm, curl, and more.',
    inputSchema: ExecInputSchema,
    capabilities: ['executes_code', 'high_risk'],
    execute: async (input: z.infer<typeof ExecInputSchema>, context: ToolContext): Promise<ToolResult> => {
      const { command, cwd, timeout: overrideTimeout, env: extraEnv } = input;

      // Policy check
      const check = policy.isCommandAllowed(command);
      if (!check.allowed) {
        return {
          success: false,
          output: null,
          error: {
            code: 'BLOCKED',
            message: `Command blocked: ${check.reason}`,
            retryable: false,
            details: { binary: check.binary, command },
          },
        };
      }

      // Ensure workspace exists
      await fs.mkdir(workspaceRoot, { recursive: true });

      // Resolve working directory within workspace
      const effectiveCwd = cwd
        ? path.resolve(workspaceRoot, cwd)
        : workspaceRoot;

      if (!effectiveCwd.startsWith(path.resolve(workspaceRoot))) {
        return {
          success: false,
          output: null,
          error: {
            code: 'BLOCKED',
            message: 'Working directory escapes workspace root',
            retryable: false,
          },
        };
      }

      await fs.mkdir(effectiveCwd, { recursive: true });

      const effectiveTimeout = overrideTimeout || policy.timeout;
      const startedAt = Date.now();

      return new Promise<ToolResult>((resolve) => {
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        let killed = false;

        const proc = spawn('sh', ['-c', command], {
          cwd: effectiveCwd,
          env: { ...process.env, ...extraEnv, HOME: workspaceRoot },
          signal: context.signal,
        });

        const timer = setTimeout(() => {
          killed = true;
          proc.kill('SIGKILL');
        }, effectiveTimeout);

        proc.stdout.on('data', (chunk: Buffer) => {
          stdout.push(chunk);
          context.onStream?.({ stream: 'stdout', chunk: chunk.toString() });
        });

        proc.stderr.on('data', (chunk: Buffer) => {
          stderr.push(chunk);
          context.onStream?.({ stream: 'stderr', chunk: chunk.toString() });
        });

        proc.on('close', (exitCode, signal) => {
          clearTimeout(timer);
          const durationMs = Date.now() - startedAt;
          const stdoutStr = Buffer.concat(stdout).toString().slice(0, 100_000);
          const stderrStr = Buffer.concat(stderr).toString().slice(0, 50_000);

          context.onExit?.({
            exitCode: exitCode ?? -1,
            signal: signal ?? null,
            wasKilled: killed,
            durationMs,
          });

          if (killed) {
            resolve({
              success: false,
              output: stdoutStr,
              error: {
                code: 'TIMEOUT',
                message: `Command timed out after ${effectiveTimeout}ms`,
                retryable: true,
                details: { stderr: stderrStr },
              },
              metrics: { durationMs: effectiveTimeout },
            });
            return;
          }

          resolve({
            success: exitCode === 0,
            output: stdoutStr || stderrStr,
            error: exitCode !== 0 ? {
              code: 'EXIT_CODE',
              message: `Command exited with code ${exitCode}`,
              retryable: true,
              details: { exitCode, stderr: stderrStr },
            } : undefined,
            metrics: { durationMs },
          });
        });

        proc.on('error', (err: Error) => {
          clearTimeout(timer);
          resolve({
            success: false,
            output: null,
            error: {
              code: 'SPAWN_ERROR',
              message: err.message,
              retryable: false,
            },
          });
        });
      });
    },
  };
}
