/**
 * Terminal/Bash execution tool with safety validation for the Claw agent system.
 */

import { spawn } from "child_process";
import { z } from "zod";
import type { ToolDefinition, ToolResult, ToolContext } from "../toolTypes";
import { createError } from "../toolTypes";

// --- Types ---

export interface TerminalOptions {
  command: string;
  timeout?: number;
  cwd?: string;
  signal?: AbortSignal;
}

export interface TerminalResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  killed: boolean;
  durationMs: number;
}

export interface ValidationResult {
  safe: boolean;
  warnings: string[];
  blocked: boolean;
  reason?: string;
}

// --- Validation ---

const DESTRUCTIVE_PATTERNS: Array<[RegExp, string]> = [
  [/\brm\s+(-[^\s]*)?-r[f]?\s+\/(?:\s|$)/, "Recursive delete on root filesystem"],
  [/\brm\s+(-[^\s]*)?-fr\s+\/(?:\s|$)/, "Recursive delete on root filesystem"],
  [/\bdd\s+.*\bof=\/dev\//, "Direct disk write via dd"],
  [/\bmkfs\b/, "Filesystem format command"],
  [/:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, "Fork bomb detected"],
  [/>\s*\/dev\/(sd[a-z]|nvme)/, "Direct write to block device"],
  [/\bch(mod|own)\s+(-R\s+)?.*\s+\/(?:\s|$)/, "Recursive permission change on root"],
  [/\b(wget|curl)\b.*\|\s*\b(sh|bash)\b/, "Remote code execution via pipe"],
];

const PATH_ESCAPE_PATTERN = /(?:^|\s|[;|&])(?:\.\.\/){2,}(?:etc|dev|proc|sys|boot|root)\b/;

const WARN_PATTERNS: Array<[RegExp, string]> = [
  [/\bsudo\b/, "Command uses sudo (elevated privileges)"],
  [/\brm\b/, "Command removes files"],
  [/\bkill\b/, "Command kills processes"],
  [/>\s*\//, "Command writes to absolute path"],
  [/\bchmod\b/, "Command changes file permissions"],
];

export function validateCommand(command: string): ValidationResult {
  const warnings: string[] = [];

  for (const [pattern, reason] of DESTRUCTIVE_PATTERNS) {
    if (pattern.test(command)) {
      return { safe: false, warnings: [], blocked: true, reason };
    }
  }

  // Check path traversal escapes
  if (PATH_ESCAPE_PATTERN.test(command)) {
    return { safe: false, warnings: [], blocked: true, reason: "Path traversal escape detected" };
  }

  for (const [pattern, warning] of WARN_PATTERNS) {
    if (pattern.test(command)) warnings.push(warning);
  }

  return { safe: warnings.length === 0, warnings, blocked: false };
}

// --- Execution ---

export async function executeCommand(opts: TerminalOptions): Promise<TerminalResult> {
  const { command, timeout = 30_000, cwd, signal } = opts;
  const start = Date.now();

  return new Promise((resolve, reject) => {
    const proc = spawn(command, [], {
      shell: true,
      cwd: cwd || process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, LANG: "en_US.UTF-8" },
    });

    let stdout = "";
    let stderr = "";
    let killed = false;

    proc.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

    const timer = setTimeout(() => {
      killed = true;
      proc.kill("SIGKILL");
    }, timeout);

    const onAbort = () => { killed = true; proc.kill("SIGKILL"); };
    signal?.addEventListener("abort", onAbort, { once: true });

    proc.on("close", (exitCode) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve({ exitCode, stdout, stderr, killed, durationMs: Date.now() - start });
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(err);
    });
  });
}

// --- Tool Definition ---

const inputSchema = z.object({
  command: z.string().min(1).describe("The shell command to execute"),
  timeout: z.number().int().min(1000).max(300_000).optional().describe("Timeout in ms (default 30000)"),
  cwd: z.string().optional().describe("Working directory for the command"),
});

export const TERMINAL_TOOL_DEFINITION: ToolDefinition = {
  name: "terminal",
  description: "Execute a shell/bash command with safety validation. Captures stdout and stderr separately. Enforces timeout and blocks destructive commands.",
  inputSchema,
  capabilities: ["executes_code"],
  async execute(input: z.infer<typeof inputSchema>, context: ToolContext): Promise<ToolResult> {
    const { command, timeout, cwd } = input;

    const validation = validateCommand(command);
    if (validation.blocked) {
      return {
        success: false,
        output: null,
        error: createError("COMMAND_BLOCKED", `Blocked: ${validation.reason}`, false),
      };
    }

    try {
      const result = await executeCommand({ command, timeout, cwd, signal: context.signal });

      if (result.killed) {
        return {
          success: false,
          output: { stdout: result.stdout, stderr: result.stderr },
          metrics: { durationMs: result.durationMs },
          error: createError("TIMEOUT", "Command was killed (timeout or abort)", false),
        };
      }

      return {
        success: result.exitCode === 0,
        output: {
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
          ...(validation.warnings.length > 0 ? { warnings: validation.warnings } : {}),
        },
        metrics: { durationMs: result.durationMs },
        ...(result.exitCode !== 0
          ? { error: createError("NON_ZERO_EXIT", `Exit code: ${result.exitCode}`, true) }
          : {}),
      };
    } catch (err: any) {
      return {
        success: false,
        output: null,
        error: createError("SPAWN_ERROR", err.message ?? "Failed to spawn process", false),
      };
    }
  },
};
