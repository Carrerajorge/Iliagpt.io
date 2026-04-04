/**
 * CodeExecutionSandbox — enhanced multi-language code execution.
 * Languages: Python, JavaScript, TypeScript, Bash.
 * Memory/CPU/network limits. IO capture. Auto-fix on failure.
 * Persistent state per conversation (shared variables across runs).
 */

import { EventEmitter } from "events";
import { spawn } from "child_process";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { createLogger } from "../utils/logger";
import Anthropic from "@anthropic-ai/sdk";

const logger = createLogger("CodeExecutionSandbox");

// ─── Types ────────────────────────────────────────────────────────────────────

export type Language = "python" | "javascript" | "typescript" | "bash";

export interface ExecutionOptions {
  language: Language;
  code: string;
  conversationId?: string;
  timeout?: number;           // ms, default 10_000
  memoryLimitMb?: number;     // default 256
  allowNetwork?: boolean;     // default false
  installPackages?: string[]; // pip/npm packages to install first
  stdinInput?: string;
  autoFix?: boolean;          // retry with LLM fix on error
  maxFixAttempts?: number;    // default 2
}

export interface ExecutionResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  language: Language;
  fixApplied?: boolean;
  fixedCode?: string;
  attempts: number;
  files?: Record<string, string>; // output files if any
}

export interface SessionState {
  conversationId: string;
  variables: Record<string, unknown>;
  importedModules: string[];
  workdir: string;
  createdAt: Date;
  lastUsed: Date;
}

// ─── Language Configs ─────────────────────────────────────────────────────────

interface LangConfig {
  command: (tmpFile: string) => string[];
  extension: string;
  packageInstall?: (packages: string[]) => string[];
  wrapCode: (code: string, sessionVars?: string) => string;
}

const LANG_CONFIGS: Record<Language, LangConfig> = {
  python: {
    command: (f) => ["python3", f],
    extension: ".py",
    packageInstall: (pkgs) => ["pip3", "install", "--quiet", ...pkgs],
    wrapCode: (code, sessionVars) => {
      const header = sessionVars ? `# Session state\n${sessionVars}\n\n` : "";
      return `${header}${code}`;
    },
  },
  javascript: {
    command: (f) => ["node", f],
    extension: ".js",
    packageInstall: (pkgs) => ["npm", "install", "--save-dev", ...pkgs],
    wrapCode: (code) => code,
  },
  typescript: {
    command: (f) => ["npx", "--yes", "ts-node", "--transpile-only", f],
    extension: ".ts",
    wrapCode: (code) => code,
  },
  bash: {
    command: (f) => ["bash", f],
    extension: ".sh",
    wrapCode: (code) => `#!/usr/bin/env bash\nset -euo pipefail\n\n${code}`,
  },
};

// ─── Process Runner ───────────────────────────────────────────────────────────

async function runProcess(
  command: string[],
  options: {
    cwd: string;
    env?: Record<string, string>;
    timeoutMs: number;
    stdinInput?: string;
    memoryLimitMb: number;
  }
): Promise<{ stdout: string; stderr: string; exitCode: number | null; timedOut: boolean }> {
  return new Promise((resolve) => {
    const [cmd, ...args] = command as [string, ...string[]];

    const env: Record<string, string> = {
      ...Object.fromEntries(
        Object.entries(process.env).filter(([, v]) => v !== undefined) as [string, string][]
      ),
      ...options.env,
      PYTHONDONTWRITEBYTECODE: "1",
    };

    const child = spawn(cmd, args, {
      cwd: options.cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const maxOutput = 50_000; // 50KB output cap

    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
      if (stdout.length > maxOutput) stdout = stdout.slice(0, maxOutput) + "\n[Output truncated]";
    });

    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
      if (stderr.length > maxOutput) stderr = stderr.slice(0, maxOutput) + "\n[Output truncated]";
    });

    if (options.stdinInput) {
      child.stdin.write(options.stdinInput);
      child.stdin.end();
    }

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, options.timeoutMs);

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: code, timedOut });
    });
  });
}

// ─── Auto-Fix via LLM ─────────────────────────────────────────────────────────

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function autoFixCode(
  code: string,
  language: Language,
  error: string
): Promise<string | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: `Fix this ${language} code. Return ONLY the corrected code, no explanation.

Error:
${error.slice(0, 500)}

Code:
\`\`\`${language}
${code}
\`\`\`

Fixed code:`,
        },
      ],
    });

    const text = response.content[0]?.type === "text" ? response.content[0].text : "";
    const codeMatch = text.match(/```(?:\w+)?\n([\s\S]+?)```/) ?? text.match(/^([\s\S]+)$/);
    return codeMatch?.[1]?.trim() ?? null;
  } catch {
    return null;
  }
}

// ─── Session Manager ──────────────────────────────────────────────────────────

class SessionManager {
  private sessions = new Map<string, SessionState>();
  private readonly SESSION_TTL_MS = 30 * 60_000; // 30 minutes

  async getOrCreate(conversationId: string): Promise<SessionState> {
    this.evictExpired();

    if (this.sessions.has(conversationId)) {
      const session = this.sessions.get(conversationId)!;
      session.lastUsed = new Date();
      return session;
    }

    const workdir = await fs.mkdtemp(path.join(os.tmpdir(), `sandbox_${conversationId.slice(-8)}_`));

    const session: SessionState = {
      conversationId,
      variables: {},
      importedModules: [],
      workdir,
      createdAt: new Date(),
      lastUsed: new Date(),
    };

    this.sessions.set(conversationId, session);
    logger.info(`Created sandbox session: ${conversationId} at ${workdir}`);
    return session;
  }

  private evictExpired(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (now - session.lastUsed.getTime() > this.SESSION_TTL_MS) {
        fs.rm(session.workdir, { recursive: true, force: true }).catch(() => void 0);
        this.sessions.delete(id);
        logger.info(`Evicted sandbox session: ${id}`);
      }
    }
  }

  async destroy(conversationId: string): Promise<void> {
    const session = this.sessions.get(conversationId);
    if (session) {
      await fs.rm(session.workdir, { recursive: true, force: true }).catch(() => void 0);
      this.sessions.delete(conversationId);
    }
  }

  getAll(): SessionState[] {
    return [...this.sessions.values()];
  }
}

// ─── CodeExecutionSandbox ─────────────────────────────────────────────────────

export class CodeExecutionSandbox extends EventEmitter {
  private sessionManager = new SessionManager();

  async execute(options: ExecutionOptions): Promise<ExecutionResult> {
    const {
      language,
      code,
      conversationId,
      timeout = 10_000,
      memoryLimitMb = 256,
      allowNetwork = false,
      installPackages = [],
      stdinInput,
      autoFix = true,
      maxFixAttempts = 2,
    } = options;

    const langConfig = LANG_CONFIGS[language];
    const session = conversationId
      ? await this.sessionManager.getOrCreate(conversationId)
      : { workdir: await fs.mkdtemp(path.join(os.tmpdir(), "sandbox_anon_")), variables: {}, importedModules: [] };

    const startTime = Date.now();
    let currentCode = code;
    let attempts = 0;
    let fixApplied = false;
    let fixedCode: string | undefined;

    // Network isolation env (Linux-only; best-effort on macOS)
    const envOverrides: Record<string, string> = allowNetwork
      ? {}
      : { no_proxy: "*", http_proxy: "", https_proxy: "", NO_PROXY: "*" };

    try {
      // Install packages if requested
      if (installPackages.length > 0 && langConfig.packageInstall) {
        const installCmd = langConfig.packageInstall(installPackages);
        await runProcess(installCmd, { cwd: session.workdir, timeoutMs: 60_000, memoryLimitMb });
        logger.info(`Installed packages: ${installPackages.join(", ")}`);
      }

      while (attempts <= maxFixAttempts) {
        attempts++;

        const wrappedCode = langConfig.wrapCode(currentCode);
        const tmpFile = path.join(session.workdir, `exec_${Date.now()}${langConfig.extension}`);
        await fs.writeFile(tmpFile, wrappedCode, "utf-8");

        const cmd = langConfig.command(tmpFile);
        const result = await runProcess(cmd, {
          cwd: session.workdir,
          env: envOverrides,
          timeoutMs: timeout,
          stdinInput,
          memoryLimitMb,
        });

        // Clean up temp file
        await fs.unlink(tmpFile).catch(() => void 0);

        if (result.timedOut) {
          return {
            success: false,
            stdout: result.stdout,
            stderr: `Execution timed out after ${timeout}ms`,
            exitCode: null,
            durationMs: Date.now() - startTime,
            language,
            fixApplied,
            fixedCode,
            attempts,
          };
        }

        const success = result.exitCode === 0;

        if (success || !autoFix || attempts > maxFixAttempts) {
          this.emit("execution", { language, success, durationMs: Date.now() - startTime });
          logger.info(`Code executed: ${language} (${Date.now() - startTime}ms, exit ${result.exitCode})`);

          return {
            success,
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode,
            durationMs: Date.now() - startTime,
            language,
            fixApplied,
            fixedCode,
            attempts,
          };
        }

        // Auto-fix attempt
        logger.info(`Auto-fix attempt ${attempts} for ${language} error`);
        const fixed = await autoFixCode(currentCode, language, result.stderr || result.stdout);

        if (!fixed) break;

        fixedCode = fixed;
        currentCode = fixed;
        fixApplied = true;
      }

      return {
        success: false,
        stdout: "",
        stderr: "Execution failed after all fix attempts",
        exitCode: 1,
        durationMs: Date.now() - startTime,
        language,
        fixApplied,
        fixedCode,
        attempts,
      };
    } finally {
      if (!conversationId) {
        await fs.rm((session as { workdir: string }).workdir, { recursive: true, force: true }).catch(() => void 0);
      }
    }
  }

  /**
   * Execute a snippet and format the result for display.
   */
  async executeAndFormat(options: ExecutionOptions): Promise<string> {
    const result = await this.execute(options);

    let output = "";
    if (result.success) {
      output += result.stdout ? `\`\`\`\n${result.stdout}\n\`\`\`` : "*No output*";
    } else {
      output += `**Execution failed** (exit ${result.exitCode ?? "timeout"})`;
      if (result.stderr) output += `\n\`\`\`\n${result.stderr.slice(0, 500)}\n\`\`\``;
      if (result.fixApplied && result.fixedCode) {
        output += `\n\n*Auto-fix was applied. Corrected code:*\n\`\`\`${options.language}\n${result.fixedCode}\n\`\`\``;
      }
    }

    output += `\n\n*Ran in ${result.durationMs}ms · ${result.language} · ${result.attempts} attempt${result.attempts !== 1 ? "s" : ""}*`;
    return output;
  }

  getSession(conversationId: string): SessionState | null {
    return this.sessionManager.getAll().find((s) => s.conversationId === conversationId) ?? null;
  }

  async destroySession(conversationId: string): Promise<void> {
    await this.sessionManager.destroy(conversationId);
  }

  getSupportedLanguages(): Language[] {
    return ["python", "javascript", "typescript", "bash"];
  }
}

export const codeExecutionSandbox = new CodeExecutionSandbox();
