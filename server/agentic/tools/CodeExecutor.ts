/**
 * CodeExecutor
 *
 * Multi-language code execution with isolated environments and persistent state.
 *
 * Supported languages:
 *   - JavaScript  — Node.js vm module sandbox (persistent sessions)
 *   - TypeScript  — Type-strip → JS sandbox
 *   - Python      — spawn python3 with tmpfile
 *   - Bash        — spawn sh with tmpfile
 *   - Ruby        — spawn ruby with tmpfile (if installed)
 *   - Go          — spawn go run with tmpfile (if installed)
 *
 * Features:
 *   - Persistent JS/TS session state across invocations (REPL-like)
 *   - Package install for Python (pip) and Node (npm) via on-demand sandbox dirs
 *   - Output streaming callback
 *   - Time + output limits
 *   - LLM-based auto-fix on failure
 *   - Execution history per session
 */

import vm           from 'vm';
import os           from 'os';
import path         from 'path';
import fs           from 'fs/promises';
import { spawn }    from 'child_process';
import { randomUUID }   from 'crypto';
import { z }            from 'zod';
import { Logger }       from '../../lib/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

export const SupportedLanguageSchema = z.enum([
  'javascript', 'typescript', 'python', 'bash', 'ruby', 'go',
]);
export type SupportedLanguage = z.infer<typeof SupportedLanguageSchema>;

export interface CodeExecutionResult {
  success   : boolean;
  stdout    : string;
  stderr    : string;
  exitCode  : number;
  language  : SupportedLanguage;
  durationMs: number;
  sessionId?: string;
  autoFixed : boolean;
  fixedCode?: string;
}

export interface CodeExecutorOptions {
  language?        : SupportedLanguage;
  sessionId?       : string;
  timeoutMs?       : number;
  autoFix?         : boolean;
  model?           : string;
  onChunk?         : (chunk: string) => void;
  installPackages? : string[];   // pip or npm packages to install before running
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_OUTPUT_BYTES   = 100_000;
const SANDBOX_BASE_DIR   = path.join(os.tmpdir(), 'ilia-code-sandbox');

// ─── TypeScript type stripper ─────────────────────────────────────────────────
// Handles common patterns in short snippets (not a full TS compiler).

function stripTypeAnnotations(ts: string): string {
  return ts
    .replace(/^(import|export)\s+type\s+[^\n]+/gm, '')
    .replace(/^(?:export\s+)?interface\s+\w+(?:<[^>]*>)?\s*\{[^}]*\}/gm, '')
    .replace(/^(?:export\s+)?type\s+\w+(?:<[^>]*>)?\s*=\s*[^\n;]+;?/gm, '')
    .replace(/(\w)\s*:\s*(?:[\w<>[\]|&. ]+)(?=[,)=])/g, '$1')
    .replace(/\)\s*:\s*(?:[\w<>[\]|& .]+)\s*(?=\{)/g, ') ')
    .replace(/<[^>()]+>/g, '')
    .replace(/\s+as\s+[\w<>[\]|& .]+/g, '')
    .replace(/\b(?:private|public|protected|readonly)\s+/g, '');
}

// ─── JS/TS persistent sessions ────────────────────────────────────────────────

interface JsSession {
  ctx    : vm.Context;
  logs   : string[];
  history: string[];
  created: number;
}

const jsSessions = new Map<string, JsSession>();

function getOrCreateJsSession(sessionId?: string): { session: JsSession; ephemeral: boolean } {
  if (sessionId && jsSessions.has(sessionId)) {
    return { session: jsSessions.get(sessionId)!, ephemeral: false };
  }

  const logs: string[] = [];
  const ctx = vm.createContext({
    console: {
      log  : (...a: unknown[]) => logs.push(a.map(String).join(' ')),
      error: (...a: unknown[]) => logs.push('[err] ' + a.map(String).join(' ')),
      warn : (...a: unknown[]) => logs.push('[warn] ' + a.map(String).join(' ')),
      info : (...a: unknown[]) => logs.push('[info] ' + a.map(String).join(' ')),
      dir  : (...a: unknown[]) => logs.push('[dir] ' + JSON.stringify(a[0], null, 2)),
    },
    Math, JSON, Date, Array, Object, String, Number, Boolean,
    RegExp, Error, Promise, Map, Set, parseInt, parseFloat,
    isNaN, isFinite, encodeURIComponent, decodeURIComponent,
    setTimeout: (fn: Function, ms: number) => setTimeout(fn, Math.min(ms, 5000)),
    clearTimeout,
    __state: Object.create(null) as Record<string, unknown>,
  });

  const session: JsSession = { ctx, logs, history: [], created: Date.now() };
  if (sessionId) jsSessions.set(sessionId, session);
  return { session, ephemeral: !sessionId };
}

function runJs(code: string, sessionId: string | undefined, timeout: number): CodeExecutionResult {
  const start  = Date.now();
  const { session } = getOrCreateJsSession(sessionId);
  const before = session.logs.length;

  try {
    vm.runInContext(code, session.ctx, {
      timeout,
      filename        : 'sandbox.js',
      breakOnSigint   : true,
    });
    session.history.push(code);
    const stdout = session.logs.slice(before).join('\n');
    return {
      success: true, stdout, stderr: '', exitCode: 0,
      language: 'javascript', durationMs: Date.now() - start,
      sessionId, autoFixed: false,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    session.logs.push('[error] ' + msg);
    return {
      success: false, stdout: '', stderr: msg, exitCode: 1,
      language: 'javascript', durationMs: Date.now() - start,
      sessionId, autoFixed: false,
    };
  }
}

// ─── Process-based runner ─────────────────────────────────────────────────────

async function runProcess(
  bin    : string,
  args   : string[],
  opts   : { timeout: number; cwd?: string; env?: Record<string, string>; onChunk?: (s: string) => void },
): Promise<{ stdout: string; stderr: string; exitCode: number; killed: boolean }> {
  return new Promise(resolve => {
    const bufs = { o: [] as Buffer[], e: [] as Buffer[] };
    let killed = false;

    const proc = spawn(bin, args, {
      cwd: opts.cwd,
      env: {
        PATH: process.env['PATH'] ?? '/usr/local/bin:/usr/bin:/bin',
        LANG: 'en_US.UTF-8',
        ...opts.env,
      },
    });

    const timer = setTimeout(() => { killed = true; proc.kill('SIGKILL'); }, opts.timeout);

    proc.stdout.on('data', (c: Buffer) => {
      bufs.o.push(c);
      opts.onChunk?.(c.toString());
    });
    proc.stderr.on('data', (c: Buffer) => { bufs.e.push(c); });

    proc.on('close', code => {
      clearTimeout(timer);
      resolve({
        stdout  : Buffer.concat(bufs.o).toString('utf8').slice(0, MAX_OUTPUT_BYTES),
        stderr  : Buffer.concat(bufs.e).toString('utf8').slice(0, MAX_OUTPUT_BYTES),
        exitCode: code ?? (killed ? -1 : 0),
        killed,
      });
    });

    proc.on('error', err => {
      clearTimeout(timer);
      resolve({ stdout: '', stderr: err.message, exitCode: -1, killed: false });
    });
  });
}

/** Write code to tmpfile, run with given binary, return result. */
async function runCodeFile(
  code    : string,
  ext     : string,
  bin     : string,
  extraArgs: string[],
  lang    : SupportedLanguage,
  opts    : CodeExecutorOptions,
): Promise<CodeExecutionResult> {
  const start   = Date.now();
  const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const tmpDir  = path.join(SANDBOX_BASE_DIR, randomUUID());
  const tmpFile = path.join(tmpDir, `main${ext}`);

  await fs.mkdir(tmpDir, { recursive: true });
  try {
    await fs.writeFile(tmpFile, code, 'utf8');

    // Optional package install
    if (opts.installPackages?.length) {
      if (lang === 'python') {
        await runProcess('pip3', ['install', '--quiet', ...opts.installPackages], {
          timeout: 60_000,
          cwd    : tmpDir,
        });
      } else if (lang === 'javascript' || lang === 'typescript') {
        await fs.writeFile(
          path.join(tmpDir, 'package.json'),
          JSON.stringify({ name: 'sandbox', version: '1.0.0', type: 'module' }),
        );
        await runProcess('npm', ['install', '--save', ...opts.installPackages], {
          timeout: 60_000,
          cwd    : tmpDir,
        });
      }
    }

    const { stdout, stderr, exitCode, killed } = await runProcess(
      bin,
      [...extraArgs, tmpFile],
      { timeout, cwd: tmpDir, onChunk: opts.onChunk },
    );

    if (killed) {
      return {
        success: false, stdout, stderr: `[TIMEOUT after ${timeout}ms]\n${stderr}`,
        exitCode: -1, language: lang, durationMs: Date.now() - start,
        sessionId: opts.sessionId, autoFixed: false,
      };
    }

    return {
      success: exitCode === 0, stdout, stderr, exitCode, language: lang,
      durationMs: Date.now() - start, sessionId: opts.sessionId, autoFixed: false,
    };
  } finally {
    fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ─── LLM auto-fix ─────────────────────────────────────────────────────────────

async function autoFixCode(
  code    : string,
  language: SupportedLanguage,
  error   : string,
  model   : string,
): Promise<string | null> {
  try {
    const { llmGateway } = await import('../../lib/llmGateway');
    const res = await llmGateway.chat(
      [
        {
          role   : 'system',
          content: `You are a code debugger. Fix the ${language} code. Return ONLY the corrected code, no explanations, no markdown fences.`,
        },
        {
          role   : 'user',
          content: `Error: ${error.slice(0, 400)}\n\nCode:\n${code.slice(0, 2000)}`,
        },
      ],
      { model, temperature: 0.1, maxTokens: 800 },
    );
    return res.content
      .replace(/^```[\w]*\n?/, '')
      .replace(/\n?```$/, '')
      .trim();
  } catch {
    return null;
  }
}

// ─── Language detector ────────────────────────────────────────────────────────

function detectLanguage(code: string): SupportedLanguage {
  if (/^\s*(?:import\s+\w|from\s+\w|def\s+\w|print\s*\(|#!.*python)/m.test(code)) return 'python';
  if (/^\s*(?:#!\/bin\/(?:sh|bash)|echo\s|ls\s|cd\s|mkdir\s|export\s)/m.test(code)) return 'bash';
  if (/:\s*(?:string|number|boolean|void|any|never)\b|<\w+>|interface\s+\w/.test(code)) return 'typescript';
  if (/^package\s+main|func\s+main\s*\(\s*\)/m.test(code)) return 'go';
  if (/^(?:def|class)\s+\w|puts\s+['"]|require\s+['"]/.test(code)) return 'ruby';
  return 'javascript';
}

// ─── Main class ───────────────────────────────────────────────────────────────

export class CodeExecutor {
  async run(code: string, opts: CodeExecutorOptions = {}): Promise<CodeExecutionResult> {
    const language = opts.language ?? detectLanguage(code);
    const model    = opts.model    ?? 'auto';

    Logger.debug('[CodeExecutor] running', { language, sessionId: opts.sessionId });

    let result: CodeExecutionResult;

    switch (language) {
      case 'javascript':
        result = runJs(code, opts.sessionId, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
        break;
      case 'typescript': {
        const stripped = stripTypeAnnotations(code);
        result = runJs(stripped, opts.sessionId, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
        result.language = 'typescript';
        break;
      }
      case 'python':
        result = await runCodeFile(code, '.py', 'python3', [], 'python', opts);
        break;
      case 'bash':
        result = await runCodeFile(code, '.sh', 'sh', [], 'bash', opts);
        break;
      case 'ruby':
        result = await runCodeFile(code, '.rb', 'ruby', [], 'ruby', opts);
        break;
      case 'go': {
        // Go requires a package + main boilerplate if missing
        const goCode = code.includes('package main') ? code : `package main\nimport "fmt"\nfunc main() {\n${code}\n}`;
        result = await runCodeFile(goCode, '.go', 'go', ['run'], 'go', opts);
        break;
      }
    }

    // Auto-fix on failure
    if (!result.success && opts.autoFix) {
      const errorMsg = result.stderr || result.stdout || 'unknown error';
      const fixedCode = await autoFixCode(code, language, errorMsg, model);
      if (fixedCode) {
        const retry = await this.run(fixedCode, { ...opts, autoFix: false });
        if (retry.success) {
          Logger.info('[CodeExecutor] auto-fix succeeded', { language });
          return { ...retry, autoFixed: true, fixedCode };
        }
      }
    }

    return result;
  }

  /** Clear a named JS session. */
  clearSession(sessionId: string): void {
    jsSessions.delete(sessionId);
    Logger.debug('[CodeExecutor] session cleared', { sessionId });
  }

  /** Return JS session IDs. */
  listSessions(): string[] {
    return [...jsSessions.keys()];
  }

  /** Check which languages are installed. */
  async checkLanguageAvailability(): Promise<Record<SupportedLanguage, boolean>> {
    const check = async (bin: string): Promise<boolean> => {
      try {
        const { exitCode } = await runProcess(bin, ['--version'], { timeout: 3000 });
        return exitCode === 0;
      } catch { return false; }
    };

    const [py, ruby, go] = await Promise.all([
      check('python3'),
      check('ruby'),
      check('go'),
    ]);

    return {
      javascript: true,
      typescript: true,
      python    : py,
      bash      : true,
      ruby,
      go,
    };
  }
}

export const codeExecutor = new CodeExecutor();
