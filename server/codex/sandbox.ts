/**
 * Secure sandbox for Codex VC coding agent code execution.
 *
 * Each sandbox gets an isolated workspace directory under /tmp/codex-{sessionId}/
 * with path traversal protection, command validation, and disk limits.
 *
 * NOTE: Uses child_process.spawn with explicit /bin/bash -c to run shell commands
 * within an isolated workspace. Command validation via BLOCKED_COMMANDS prevents
 * dangerous operations. This matches the pattern in server/agent/claw/terminalTool.ts.
 */

import * as fs from "fs/promises";
import * as path from "path";
import { spawn } from "child_process";

// --- Types ---

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
}

export interface FileEntry {
  name: string;
  relativePath: string;
  type: "file" | "directory";
  size?: number;
}

// --- Constants ---

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const MAX_DISK_BYTES = 500 * 1024 * 1024; // 500 MB
const MAX_CONCURRENT_PROCESSES = 10;
const INACTIVITY_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour

const BLOCKED_COMMANDS: Array<[RegExp, string]> = [
  [/\brm\s+(-[^\s]*)?-r[f]?\s+\/(?:\s|$)/, "Recursive delete on root filesystem"],
  [/\brm\s+(-[^\s]*)?-fr\s+\/(?:\s|$)/, "Recursive delete on root filesystem"],
  [/\bsudo\b/, "Elevated privilege command"],
  [/\bchmod\s+777\b/, "Insecure permission change"],
  [/\bmkfs\b/, "Filesystem format command"],
  [/\bdd\s+/, "Direct disk operation"],
  [/:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, "Fork bomb detected"],
];

// --- Path validation ---

function validatePath(relativePath: string, workspace: string): string {
  const resolved = path.resolve(workspace, relativePath);
  if (!resolved.startsWith(workspace + path.sep) && resolved !== workspace) {
    throw new Error(`Path escapes workspace: ${relativePath}`);
  }
  return resolved;
}

// --- Sandbox class ---

export class Sandbox {
  public readonly workspace: string;
  public readonly sessionId: string;

  /** Timestamp of the most recent exec / file operation (ms since epoch). */
  private _lastActivity: number;
  /** Number of child processes currently running inside this sandbox. */
  private _activeProcesses = 0;
  /** Timer handle for the inactivity auto-cleanup. */
  private _inactivityTimer: ReturnType<typeof setTimeout> | null = null;
  /** Callback invoked when the sandbox is cleaned up due to inactivity. */
  onInactivityCleanup: (() => void) | null = null;

  constructor(sessionId: string, workspace: string) {
    this.sessionId = sessionId;
    this.workspace = workspace;
    this._lastActivity = Date.now();
    this._resetInactivityTimer();
  }

  // --- Inactivity tracking ---

  private _touch(): void {
    this._lastActivity = Date.now();
    this._resetInactivityTimer();
  }

  private _resetInactivityTimer(): void {
    if (this._inactivityTimer) clearTimeout(this._inactivityTimer);
    this._inactivityTimer = setTimeout(() => {
      this.cleanup().then(() => this.onInactivityCleanup?.()).catch(() => {});
    }, INACTIVITY_TIMEOUT_MS);
    // Don't let the timer keep the process alive
    if (this._inactivityTimer && typeof this._inactivityTimer === "object" && "unref" in this._inactivityTimer) {
      this._inactivityTimer.unref();
    }
  }

  /** Milliseconds since the last sandbox activity. */
  get idleMs(): number {
    return Date.now() - this._lastActivity;
  }

  /** Number of child processes currently running. */
  get activeProcesses(): number {
    return this._activeProcesses;
  }

  /** Execute a shell command inside the sandbox workspace. */
  async exec(command: string, timeout: number = DEFAULT_TIMEOUT_MS): Promise<ExecResult> {
    // Validate command against blocked patterns
    for (const [pattern, reason] of BLOCKED_COMMANDS) {
      if (pattern.test(command)) {
        throw new Error(`Blocked command: ${reason}`);
      }
    }

    if (this._activeProcesses >= MAX_CONCURRENT_PROCESSES) {
      throw new Error(
        `Process limit reached: max ${MAX_CONCURRENT_PROCESSES} simultaneous processes per sandbox`,
      );
    }

    this._touch();
    this._activeProcesses++;
    const start = Date.now();

    return new Promise((resolve, reject) => {
      const proc = spawn("/bin/bash", ["-c", command], {
        shell: false,
        cwd: this.workspace,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, HOME: this.workspace, LANG: "en_US.UTF-8" },
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

      proc.on("close", (exitCode) => {
        clearTimeout(timer);
        this._activeProcesses--;
        this._touch();
        if (killed) {
          resolve({ stdout, stderr: stderr + "\n[killed: timeout]", exitCode: -1, durationMs: Date.now() - start });
        } else {
          resolve({ stdout, stderr, exitCode, durationMs: Date.now() - start });
        }
      });

      proc.on("error", (err) => {
        clearTimeout(timer);
        this._activeProcesses--;
        reject(err);
      });
    });
  }

  /** Read a file from the sandbox workspace. */
  async readFile(relativePath: string): Promise<string> {
    this._touch();
    const resolved = validatePath(relativePath, this.workspace);
    return fs.readFile(resolved, "utf-8");
  }

  /** Write a file to the sandbox workspace, enforcing disk limit. */
  async writeFile(relativePath: string, content: string): Promise<void> {
    this._touch();
    const resolved = validatePath(relativePath, this.workspace);

    // Check disk usage before writing
    const currentUsage = await this.getDiskUsage();
    const newBytes = Buffer.byteLength(content, "utf-8");
    if (currentUsage + newBytes > MAX_DISK_BYTES) {
      throw new Error(
        `Disk limit exceeded: current ${(currentUsage / 1024 / 1024).toFixed(1)}MB + ` +
        `${(newBytes / 1024 / 1024).toFixed(1)}MB would exceed ${MAX_DISK_BYTES / 1024 / 1024}MB limit`
      );
    }

    await fs.mkdir(path.dirname(resolved), { recursive: true });
    await fs.writeFile(resolved, content, "utf-8");
  }

  /** Recursively list files in the workspace. */
  async listFiles(relativePath?: string): Promise<FileEntry[]> {
    const base = relativePath ? validatePath(relativePath, this.workspace) : this.workspace;
    const entries: FileEntry[] = [];

    const walk = async (dir: string) => {
      const items = await fs.readdir(dir, { withFileTypes: true });
      for (const item of items) {
        if (item.name === "node_modules" || item.name === ".git") continue;
        const fullPath = path.join(dir, item.name);
        const rel = path.relative(this.workspace, fullPath);
        if (item.isDirectory()) {
          entries.push({ name: item.name, relativePath: rel, type: "directory" });
          await walk(fullPath);
        } else {
          const stat = await fs.stat(fullPath).catch(() => null);
          entries.push({ name: item.name, relativePath: rel, type: "file", size: stat?.size });
        }
      }
    };

    await walk(base);
    return entries;
  }

  /** Remove the workspace directory entirely. */
  async cleanup(): Promise<void> {
    if (this._inactivityTimer) {
      clearTimeout(this._inactivityTimer);
      this._inactivityTimer = null;
    }
    await fs.rm(this.workspace, { recursive: true, force: true });
  }

  /** Calculate total disk usage of the workspace in bytes. */
  private async getDiskUsage(): Promise<number> {
    let total = 0;
    const walk = async (dir: string) => {
      const items = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const item of items) {
        const fullPath = path.join(dir, item.name);
        if (item.isDirectory()) {
          await walk(fullPath);
        } else {
          const stat = await fs.stat(fullPath).catch(() => null);
          if (stat) total += stat.size;
        }
      }
    };
    await walk(this.workspace);
    return total;
  }
}

/** Create a new sandbox with an isolated workspace directory. */
export async function createSandbox(sessionId: string): Promise<Sandbox> {
  const workspace = path.join("/tmp", `codex-${sessionId}`);
  await fs.mkdir(workspace, { recursive: true });
  return new Sandbox(sessionId, workspace);
}
