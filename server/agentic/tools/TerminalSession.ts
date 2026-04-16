/**
 * TerminalSession
 *
 * Persistent shell sessions per conversation / user.
 *
 * Features:
 *   - Create named sessions (one per chatId by default)
 *   - Run commands with timeout and output streaming
 *   - Maintain working directory state across commands
 *   - Safety filtering (block dangerous commands)
 *   - Auto-expire idle sessions (default 30 min)
 *   - Output capture with ring buffer
 *   - EventEmitter for streaming output to SSE
 */

import path             from 'path';
import os               from 'os';
import fs               from 'fs/promises';
import { spawn }        from 'child_process';
import { EventEmitter } from 'events';
import { randomUUID }   from 'crypto';
import { Logger }       from '../../lib/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TerminalSessionRecord {
  id          : string;
  userId      : string;
  chatId      : string;
  cwd         : string;
  createdAt   : number;
  lastUsedAt  : number;
  commandCount: number;
  env         : Record<string, string>;
}

export interface CommandResult {
  stdout    : string;
  stderr    : string;
  exitCode  : number;
  cwd       : string;
  durationMs: number;
  killed    : boolean;
}

export interface RunOptions {
  timeoutMs? : number;
  env?       : Record<string, string>;
  onChunk?   : (stream: 'stdout' | 'stderr', data: string) => void;
  signal?    : AbortSignal;
}

// ─── Safety filter ────────────────────────────────────────────────────────────

const BLOCKED_PATTERNS: RegExp[] = [
  /\brm\s+-rf?\s+\/(?!\S)/,        // rm -rf /
  /\bmkfs\b/,                       // format filesystem
  /\bdd\s+if=\/dev/,               // dd device write
  /\bchmod\s+777\s+\/(?!\S)/,      // chmod 777 /
  /\bsudo\s+su\b/,                  // sudo su
  />\s*\/etc\/(?:passwd|shadow)/,  // overwrite critical files
  /\bkillall\b/,                    // kill all processes
  /\bshutdown\b|\breboot\b/,       // system shutdown
  /\biptables\s+-F\b/,             // flush firewall
];

function isCommandBlocked(command: string): { blocked: boolean; reason?: string } {
  for (const re of BLOCKED_PATTERNS) {
    if (re.test(command)) {
      return { blocked: true, reason: `Command matches safety pattern: ${re.source}` };
    }
  }
  return { blocked: false };
}

// ─── Session store ────────────────────────────────────────────────────────────

const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const MAX_SESSIONS_PER_USER   = 5;
const MAX_OUTPUT_BYTES        = 200_000;
const DEFAULT_TIMEOUT_MS      = 30_000;

export class TerminalSessionManager extends EventEmitter {
  private readonly sessions = new Map<string, TerminalSessionRecord>();

  // ── Create / get session ────────────────────────────────────────────────────

  async create(userId: string, chatId: string, cwd?: string): Promise<TerminalSessionRecord> {
    // Enforce per-user session limit
    const userSessions = [...this.sessions.values()].filter(s => s.userId === userId);
    if (userSessions.length >= MAX_SESSIONS_PER_USER) {
      // Evict oldest session
      userSessions.sort((a, b) => a.lastUsedAt - b.lastUsedAt);
      this.sessions.delete(userSessions[0]!.id);
    }

    const workDir = cwd ?? path.join(os.tmpdir(), 'ilia-terminal', userId, randomUUID());
    await fs.mkdir(workDir, { recursive: true });

    const session: TerminalSessionRecord = {
      id          : `term_${randomUUID()}`,
      userId,
      chatId,
      cwd         : workDir,
      createdAt   : Date.now(),
      lastUsedAt  : Date.now(),
      commandCount: 0,
      env         : {
        HOME : workDir,
        PATH : process.env['PATH'] ?? '/usr/local/bin:/usr/bin:/bin',
        LANG : 'en_US.UTF-8',
        TERM : 'xterm-256color',
      },
    };

    this.sessions.set(session.id, session);
    this._scheduleExpiry(session.id);

    Logger.debug('[Terminal] session created', { id: session.id, cwd: workDir });
    return session;
  }

  getOrCreate(userId: string, chatId: string): Promise<TerminalSessionRecord> {
    const existing = [...this.sessions.values()].find(
      s => s.userId === userId && s.chatId === chatId,
    );
    if (existing) {
      existing.lastUsedAt = Date.now();
      return Promise.resolve(existing);
    }
    return this.create(userId, chatId);
  }

  get(sessionId: string): TerminalSessionRecord | undefined {
    return this.sessions.get(sessionId);
  }

  list(userId: string): TerminalSessionRecord[] {
    return [...this.sessions.values()].filter(s => s.userId === userId);
  }

  close(sessionId: string): boolean {
    const removed = this.sessions.delete(sessionId);
    if (removed) Logger.debug('[Terminal] session closed', { id: sessionId });
    return removed;
  }

  // ── Command execution ────────────────────────────────────────────────────────
  // Uses spawn with a tmpfile — same safe pattern as execTool.ts in this codebase.

  async runCommand(
    sessionId: string,
    command  : string,
    opts     : RunOptions = {},
  ): Promise<CommandResult> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Terminal session ${sessionId} not found`);

    // Safety check
    const safety = isCommandBlocked(command);
    if (safety.blocked) {
      return {
        stdout   : '',
        stderr   : `[BLOCKED] ${safety.reason}`,
        exitCode : 126,
        cwd      : session.cwd,
        durationMs: 0,
        killed   : false,
      };
    }

    session.lastUsedAt = Date.now();
    session.commandCount++;
    const start   = Date.now();
    const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    // Write command + dir capture to tmpfile.
    // We capture `pwd` after execution to track cwd state.
    const scriptContent = `${command}\n__EXIT__=$?\necho "__CWD__:$(pwd)"\nexit $__EXIT__\n`;
    const tmpFile = path.join(os.tmpdir(), `ilia_term_${randomUUID()}.sh`);

    try {
      await fs.writeFile(tmpFile, scriptContent, 'utf8');

      const bufs = { o: [] as Buffer[], e: [] as Buffer[] };
      let killed = false;

      // spawn(bin, [argsArray]) — no shell string interpolation
      const proc = spawn('sh', [tmpFile], {
        cwd: session.cwd,
        env: { ...session.env, ...opts.env },
        signal: opts.signal,
      });

      const timer = setTimeout(() => {
        killed = true;
        proc.kill('SIGKILL');
      }, timeout);

      proc.stdout.on('data', (chunk: Buffer) => {
        bufs.o.push(chunk);
        opts.onChunk?.('stdout', chunk.toString());
        this.emit('output', { sessionId, stream: 'stdout', chunk: chunk.toString() });
      });
      proc.stderr.on('data', (chunk: Buffer) => {
        bufs.e.push(chunk);
        opts.onChunk?.('stderr', chunk.toString());
        this.emit('output', { sessionId, stream: 'stderr', chunk: chunk.toString() });
      });

      const exitCode = await new Promise<number>(resolve => {
        proc.on('close', code => { clearTimeout(timer); resolve(code ?? -1); });
        proc.on('error', () => { clearTimeout(timer); resolve(-1); });
      });

      let stdout = Buffer.concat(bufs.o).toString('utf8').slice(0, MAX_OUTPUT_BYTES);
      const stderr = Buffer.concat(bufs.e).toString('utf8').slice(0, MAX_OUTPUT_BYTES);

      // Extract cwd from stdout marker
      const cwdMatch = stdout.match(/__CWD__:(.+)$/m);
      if (cwdMatch?.[1]) {
        const newCwd = cwdMatch[1].trim();
        if (newCwd && newCwd !== session.cwd) {
          try { await fs.access(newCwd); session.cwd = newCwd; } catch { /* path gone */ }
        }
        stdout = stdout.replace(/__CWD__:.+\n?/m, '');
      }

      if (killed) {
        return {
          stdout,
          stderr: stderr + `\n[TIMEOUT] Command killed after ${timeout}ms`,
          exitCode: -1,
          cwd    : session.cwd,
          durationMs: Date.now() - start,
          killed: true,
        };
      }

      Logger.debug('[Terminal] command run', {
        sessionId, exitCode, durationMs: Date.now() - start,
      });

      return { stdout, stderr, exitCode, cwd: session.cwd, durationMs: Date.now() - start, killed: false };
    } finally {
      fs.unlink(tmpFile).catch(() => {});
    }
  }

  // ── Change directory ─────────────────────────────────────────────────────────

  async changeDir(sessionId: string, newDir: string): Promise<{ success: boolean; cwd: string }> {
    const session = this.sessions.get(sessionId);
    if (!session) return { success: false, cwd: '' };

    const resolved = path.isAbsolute(newDir)
      ? newDir
      : path.resolve(session.cwd, newDir);

    try {
      await fs.access(resolved);
      session.cwd = resolved;
      return { success: true, cwd: resolved };
    } catch {
      return { success: false, cwd: session.cwd };
    }
  }

  // ── Env vars ─────────────────────────────────────────────────────────────────

  setEnv(sessionId: string, key: string, value: string): void {
    const session = this.sessions.get(sessionId);
    if (session) session.env[key] = value;
  }

  // ── Session expiry ───────────────────────────────────────────────────────────

  private _scheduleExpiry(sessionId: string): void {
    setTimeout(() => {
      const session = this.sessions.get(sessionId);
      if (!session) return;
      if (Date.now() - session.lastUsedAt > SESSION_IDLE_TIMEOUT_MS) {
        this.close(sessionId);
        Logger.debug('[Terminal] session expired (idle)', { id: sessionId });
      } else {
        this._scheduleExpiry(sessionId); // reschedule
      }
    }, SESSION_IDLE_TIMEOUT_MS);
  }

  stats(): { total: number; byUser: Record<string, number> } {
    const byUser: Record<string, number> = {};
    for (const s of this.sessions.values()) {
      byUser[s.userId] = (byUser[s.userId] ?? 0) + 1;
    }
    return { total: this.sessions.size, byUser };
  }
}

export const terminalSessionManager = new TerminalSessionManager();
