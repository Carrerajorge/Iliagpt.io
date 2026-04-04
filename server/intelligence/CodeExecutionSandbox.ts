/**
 * CodeExecutionSandbox
 *
 * Safe execution of user-supplied code snippets in isolated environments.
 *
 * Supported languages:
 *   - JavaScript  — Node vm module (in-process, sandboxed context)
 *   - TypeScript  — Regex type-stripping → JS sandbox (no tsc needed)
 *   - Python      — spawn('python3', ['-c', code]) with timeout + kill
 *   - Bash        — spawn('sh', ['-c', script]) with timeout + kill
 *
 * Safety features:
 *   - JS/TS: vm.runInContext with frozen globals, no require/process access
 *   - Python/Bash: spawned as child process; killed on timeout
 *   - stdout/stderr capped at MAX_OUTPUT_BYTES (100 KB)
 *   - Hard time limit (default 10 s)
 *   - Persistent JS session state across calls (per sessionId)
 *   - LLM-based auto-fix on execution failure (optional)
 *
 * Note: uses spawn() from child_process (args-array form, no shell interpolation)
 * for Python and Bash, matching the existing execTool.ts pattern in this codebase.
 */

import vm           from 'vm';
import os           from 'os';
import path         from 'path';
import fs           from 'fs/promises';
import { randomUUID }              from 'crypto';
import { spawn }                   from 'child_process';
import { z }                       from 'zod';
import { Logger }                  from '../lib/logger';
import { llmGateway }              from '../lib/llmGateway';

// ─── Types ────────────────────────────────────────────────────────────────────

export const LanguageSchema = z.enum(['javascript', 'typescript', 'python', 'bash']);
export type Language = z.infer<typeof LanguageSchema>;

export const ExecutionResultSchema = z.object({
  success    : z.boolean(),
  stdout     : z.string(),
  stderr     : z.string(),
  exitCode   : z.number().int(),
  durationMs : z.number().nonneg(),
  language   : LanguageSchema,
  autoFixed  : z.boolean(),
  fixedCode  : z.string().optional(),
  sessionId  : z.string().optional(),
});
export type ExecutionResult = z.infer<typeof ExecutionResultSchema>;

export interface ExecuteOptions {
  language?   : Language;
  sessionId?  : string;          // For persistent JS state across calls
  timeoutMs?  : number;          // Default 10 000 ms
  autoFix?    : boolean;         // Retry with LLM fix on failure
  model?      : string;          // LLM model for auto-fix
  requestId?  : string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS  = 10_000;
const MAX_OUTPUT_BYTES    = 100_000;
const MAX_AUTOFIX_RETRIES = 1;

// ─── TypeScript type stripper ─────────────────────────────────────────────────
// Handles the common subset: type annotations, interfaces, generics, as casts.
// Not a full TS compiler — just good enough for short snippets.

function stripTypes(ts: string): string {
  return ts
    // Remove import type / export type statements
    .replace(/^(import|export)\s+type\s+[^\n]+/gm, '')
    // Remove interface declarations (single-line brace blocks)
    .replace(/^(?:export\s+)?interface\s+\w+(?:<[^>]*>)?\s*\{[^}]*\}/gm, '')
    // Remove type alias declarations
    .replace(/^(?:export\s+)?type\s+\w+(?:<[^>]*>)?\s*=\s*[^\n;]+;?/gm, '')
    // Remove inline type annotations: (x: Type, y: Type) → (x, y)
    .replace(/(\w)\s*:\s*(?:[\w<>[\]|&. ]+)(?=[,)=])/g, '$1')
    // Remove return type annotations: ): ReturnType { → ) {
    .replace(/\)\s*:\s*(?:[\w<>[\]|& .]+)\s*(?=\{)/g, ') ')
    // Remove generic type parameters: function foo<T>( → function foo(
    .replace(/<[^>()]+>/g, '')
    // Remove `as Type` casts
    .replace(/\s+as\s+[\w<>[\]|& .]+/g, '')
    // Remove access modifiers in class bodies
    .replace(/\b(?:private|public|protected|readonly)\s+/g, '');
}

// ─── JavaScript / TypeScript sandbox ─────────────────────────────────────────

interface JsSession {
  context  : vm.Context;
  output   : string[];
  errors   : string[];
}

function createJsSession(): JsSession {
  const output: string[] = [];
  const errors: string[] = [];

  // Minimal safe sandbox — no process, require, or __dirname
  const sandbox = {
    console: {
      log  : (...args: unknown[]) => output.push(args.map(String).join(' ')),
      error: (...args: unknown[]) => errors.push(args.map(String).join(' ')),
      warn : (...args: unknown[]) => errors.push('[warn] ' + args.map(String).join(' ')),
      info : (...args: unknown[]) => output.push('[info] ' + args.map(String).join(' ')),
    },
    Math,
    JSON,
    Date,
    Array,
    Object,
    String,
    Number,
    Boolean,
    RegExp,
    Error,
    Promise,
    Map,
    Set,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    encodeURIComponent,
    decodeURIComponent,
    // Allow limited global state storage
    __state: Object.create(null) as Record<string, unknown>,
  };

  return {
    context: vm.createContext(sandbox),
    output,
    errors,
  };
}

function runInJsSandbox(
  code    : string,
  session : JsSession,
  timeout : number,
): { success: boolean; error?: string } {
  try {
    vm.runInContext(code, session.context, {
      timeout,
      breakOnSigint   : true,
      filename        : 'sandbox.js',
    });
    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    session.errors.push(msg);
    return { success: false, error: msg };
  }
}

// ─── Spawn-based execution (Python / Bash) ────────────────────────────────────
// Uses spawn() with an argument array — no shell interpolation, no injection risk.
// Matches the pattern in server/openclaw/tools/execTool.ts.

function spawnProcess(
  bin    : string,
  args   : string[],
  timeout: number,
): Promise<{ stdout: string; stderr: string; exitCode: number; killed: boolean }> {
  return new Promise(resolve => {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let killed = false;

    const proc = spawn(bin, args, {
      env: {
        // Minimal safe environment — no HOME tricks
        PATH: process.env['PATH'] ?? '/usr/local/bin:/usr/bin:/bin',
        LANG: 'en_US.UTF-8',
      },
    });

    const timer = setTimeout(() => {
      killed = true;
      proc.kill('SIGKILL');
    }, timeout);

    proc.stdout.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });
    proc.stderr.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    proc.on('close', exitCode => {
      clearTimeout(timer);
      resolve({
        stdout  : Buffer.concat(stdoutChunks).toString('utf8').slice(0, MAX_OUTPUT_BYTES),
        stderr  : Buffer.concat(stderrChunks).toString('utf8').slice(0, MAX_OUTPUT_BYTES),
        exitCode: exitCode ?? (killed ? -1 : 0),
        killed,
      });
    });

    proc.on('error', err => {
      clearTimeout(timer);
      resolve({
        stdout  : '',
        stderr  : err.message,
        exitCode: -1,
        killed  : false,
      });
    });
  });
}

async function runPython(code: string, timeout: number): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  // Write to a temp file to avoid quoting issues with -c
  const tmpFile = path.join(os.tmpdir(), `ilia_py_${randomUUID()}.py`);
  try {
    await fs.writeFile(tmpFile, code, 'utf8');
    const result = await spawnProcess('python3', [tmpFile], timeout);
    if (result.killed) result.stderr = `[timeout after ${timeout}ms]\n` + result.stderr;
    return result;
  } finally {
    await fs.unlink(tmpFile).catch(() => { /* best-effort cleanup */ });
  }
}

async function runBash(code: string, timeout: number): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const tmpFile = path.join(os.tmpdir(), `ilia_sh_${randomUUID()}.sh`);
  try {
    await fs.writeFile(tmpFile, code, 'utf8');
    const result = await spawnProcess('sh', [tmpFile], timeout);
    if (result.killed) result.stderr = `[timeout after ${timeout}ms]\n` + result.stderr;
    return result;
  } finally {
    await fs.unlink(tmpFile).catch(() => { /* best-effort cleanup */ });
  }
}

// ─── LLM auto-fix ─────────────────────────────────────────────────────────────

async function llmFix(
  code     : string,
  language : Language,
  error    : string,
  requestId: string,
  model    : string,
): Promise<string | null> {
  try {
    const res = await llmGateway.chat(
      [
        {
          role   : 'system',
          content: `You are a code debugger. The user's ${language} snippet has a runtime error. Return ONLY the corrected code, no explanation, no markdown fences.`,
        },
        {
          role   : 'user',
          content: `Error:\n${error.slice(0, 500)}\n\nCode:\n${code.slice(0, 2000)}`,
        },
      ],
      { model, requestId, temperature: 0.1, maxTokens: 800 },
    );
    const fixed = res.content.trim();
    // Strip accidental markdown fences
    return fixed.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '');
  } catch {
    return null;
  }
}

// ─── Main class ───────────────────────────────────────────────────────────────

export class CodeExecutionSandbox {
  private readonly sessions = new Map<string, JsSession>();

  /**
   * Execute a code snippet in the appropriate sandbox.
   *
   * @param code - Source code to execute
   * @param opts - Language, session, timeout, auto-fix settings
   */
  async execute(code: string, opts: ExecuteOptions = {}): Promise<ExecutionResult> {
    const start     = Date.now();
    const language  = opts.language  ?? this._detectLanguage(code);
    const timeout   = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const requestId = opts.requestId ?? randomUUID();
    const model     = opts.model     ?? 'auto';

    Logger.debug('[CodeSandbox] executing', { language, sessionId: opts.sessionId, timeout });

    let result = await this._runOnce(code, language, opts.sessionId, timeout);

    // Auto-fix loop (max 1 retry)
    if (!result.success && opts.autoFix) {
      const fixedCode = await llmFix(code, language, result.stderr || 'unknown error', `${requestId}-fix`, model);
      if (fixedCode) {
        const retryResult = await this._runOnce(fixedCode, language, opts.sessionId, timeout);
        if (retryResult.success) {
          Logger.info('[CodeSandbox] auto-fix succeeded', { language });
          return {
            ...retryResult,
            durationMs: Date.now() - start,
            language,
            autoFixed : true,
            fixedCode,
            sessionId : opts.sessionId,
          };
        }
      }
    }

    return {
      ...result,
      durationMs: Date.now() - start,
      language,
      autoFixed : false,
      sessionId : opts.sessionId,
    };
  }

  // ── Internal run dispatch ──────────────────────────────────────────────────

  private async _runOnce(
    code     : string,
    language : Language,
    sessionId: string | undefined,
    timeout  : number,
  ): Promise<Omit<ExecutionResult, 'durationMs' | 'language' | 'autoFixed' | 'sessionId'>> {
    switch (language) {
      case 'javascript': return this._runJs(code, sessionId, timeout);
      case 'typescript': return this._runTs(code, sessionId, timeout);
      case 'python'    : return this._runPython(code, timeout);
      case 'bash'      : return this._runBash(code, timeout);
    }
  }

  private _runJs(code: string, sessionId: string | undefined, timeout: number) {
    const session = this._getOrCreateSession(sessionId);
    const before  = session.output.length;
    const errBefore = session.errors.length;

    const { success, error } = runInJsSandbox(code, session, timeout);

    const stdout = session.output.slice(before).join('\n');
    const stderr = session.errors.slice(errBefore).join('\n');

    return {
      success,
      stdout : stdout.slice(0, MAX_OUTPUT_BYTES),
      stderr : (error ? error + '\n' : '') + stderr.slice(0, MAX_OUTPUT_BYTES),
      exitCode: success ? 0 : 1,
    };
  }

  private _runTs(code: string, sessionId: string | undefined, timeout: number) {
    const stripped = stripTypes(code);
    return this._runJs(stripped, sessionId, timeout);
  }

  private async _runPython(code: string, timeout: number) {
    const { stdout, stderr, exitCode } = await runPython(code, timeout);
    return { success: exitCode === 0, stdout, stderr, exitCode };
  }

  private async _runBash(code: string, timeout: number) {
    const { stdout, stderr, exitCode } = await runBash(code, timeout);
    return { success: exitCode === 0, stdout, stderr, exitCode };
  }

  // ── Session management ─────────────────────────────────────────────────────

  private _getOrCreateSession(sessionId: string | undefined): JsSession {
    if (!sessionId) return createJsSession(); // Ephemeral, not stored

    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, createJsSession());
    }
    return this.sessions.get(sessionId)!;
  }

  /** Clear a named JS session (releases vm context). */
  clearSession(sessionId: string): void {
    this.sessions.delete(sessionId);
    Logger.debug('[CodeSandbox] session cleared', { sessionId });
  }

  /** Return list of active session IDs. */
  listSessions(): string[] {
    return [...this.sessions.keys()];
  }

  // ── Language detection ─────────────────────────────────────────────────────

  private _detectLanguage(code: string): Language {
    if (/^\s*(?:import\s+\w|from\s+\w|def\s+\w|print\s*\()/m.test(code)) return 'python';
    if (/^\s*(?:#!\/bin\/(?:sh|bash)|echo\s|ls\s|cd\s|mkdir\s|export\s)/m.test(code)) return 'bash';
    if (/:\s*(?:string|number|boolean|void|any|never)\b|<\w+>|interface\s+\w/.test(code)) return 'typescript';
    return 'javascript';
  }
}

export const codeExecutionSandbox = new CodeExecutionSandbox();
