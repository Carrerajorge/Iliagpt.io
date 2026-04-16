import { spawn } from "child_process";
import path from "path";

export const bashToolSchema = {
  type: "function" as const,
  function: {
    name: "bash",
    description: "Execute a shell command on the server. Use for running scripts, installing packages, listing files, compiling code, or any terminal operation. Commands run in a sandboxed environment.",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The shell command to execute"
        },
        workdir: {
          type: "string",
          description: "Working directory for the command (defaults to project root)"
        },
        timeout: {
          type: "number",
          description: "Timeout in seconds (default 30, max 120)"
        }
      },
      required: ["command"]
    }
  }
};

const BLOCKED_COMMANDS = [
  /\brm\s+-rf\s+\/(?!\w)/,
  /\bsudo\b/,
  /\bshutdown\b/,
  /\breboot\b/,
  /\bmkfs\b/,
  /\bdd\s+if=/,
  /\b:()\s*\{/,
  /\bfork\s*bomb/i,
  /\bchmod\s+777\b/,
  /\bcurl\b.*\|\s*\bbash\b/,
  /\bwget\b.*\|\s*\bsh\b/,
  /\bcurl\b.*\|\s*\bsh\b/,
  /\bwget\b.*\|\s*\bbash\b/,
  /\bpkill\b/,
  /\bkillall\b/,
  /\biptables\b/,
  /\bnft\b/,
  /\bufw\b/,
  /\bsystemctl\s+(stop|disable|mask)\b/,
  /\bchown\s+-R\s+.*\//,
  /\brm\s+-rf\s+~\//,
  /\brm\s+-rf\s+\.\//,
  /\bpasswd\b/,
  /\buseradd\b/,
  /\buserdel\b/,
  /\bgroupadd\b/,
  /\bvisudo\b/,
  /\bcrontab\s+-r\b/,
  /\beval\s*\$\(/,
  />\s*\/dev\/sd/,
  />\s*\/etc\//,
  /\bmount\b/,
  /\bumount\b/,
  /\bmodprobe\b/,
  /\binsmod\b/,
  /\brmmod\b/,
  /\bnc\s+-l/,
  /\bexport\s+LD_PRELOAD\b/,
  /\bchattr\b/,
  /\bswapon\b/,
  /\bswapoff\b/,
  /\bfdisk\b/,
  /\bparted\b/,
  /\bhalt\b/,
  /\binit\s+0\b/,
];

const MAX_OUTPUT = 50000;
const DEFAULT_TIMEOUT = 30;
const MAX_TIMEOUT = 120;

const ULIMIT_PREFIX = "ulimit -v 1048576 -u 256 -f 102400 -n 1024 2>/dev/null; ";

export type BashStatusCallback = (status: {
  type: "stdout" | "stderr";
  chunk: string;
  elapsed: number;
}) => void;

const auditLog: Array<{
  timestamp: string;
  command: string;
  workdir: string;
  exitCode: number;
  durationMs: number;
  blocked: boolean;
  error?: string;
}> = [];

export function getAuditLog() {
  return auditLog;
}

export async function executeBashTool(params: {
  command: string;
  workdir?: string;
  timeout?: number;
  onStatus?: BashStatusCallback;
}): Promise<{ output: string; exitCode: number; error?: string }> {
  const { command, workdir, timeout: rawTimeout, onStatus } = params;
  const startTime = Date.now();
  const cwd = workdir ? path.resolve(workdir) : process.cwd();

  for (const pattern of BLOCKED_COMMANDS) {
    if (pattern.test(command)) {
      const entry = {
        timestamp: new Date().toISOString(),
        command,
        workdir: cwd,
        exitCode: 1,
        durationMs: 0,
        blocked: true,
        error: "Blocked by safety filter",
      };
      auditLog.push(entry);
      if (auditLog.length > 1000) auditLog.shift();

      return {
        output: "",
        exitCode: 1,
        error: `Command blocked for safety: matches restricted pattern`
      };
    }
  }

  const timeoutSec = Math.min(Math.max(rawTimeout || DEFAULT_TIMEOUT, 1), MAX_TIMEOUT);
  const wrappedCommand = ULIMIT_PREFIX + command;

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";

    const proc = spawn("bash", ["-c", wrappedCommand], {
      cwd,
      timeout: timeoutSec * 1000,
      env: {
        ...process.env,
        TERM: "dumb",
        NO_COLOR: "1",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    proc.stdout?.on("data", (data: Buffer) => {
      const chunk = data.toString();
      if (stdout.length + chunk.length <= MAX_OUTPUT) {
        stdout += chunk;
      } else if (stdout.length < MAX_OUTPUT) {
        stdout += chunk.slice(0, MAX_OUTPUT - stdout.length);
        stdout += "\n... [output truncated]";
      }

      if (onStatus) {
        try {
          onStatus({ type: "stdout", chunk, elapsed: Date.now() - startTime });
        } catch {}
      }
    });

    proc.stderr?.on("data", (data: Buffer) => {
      const chunk = data.toString();
      if (stderr.length + chunk.length <= MAX_OUTPUT) {
        stderr += chunk;
      } else if (stderr.length < MAX_OUTPUT) {
        stderr += chunk.slice(0, MAX_OUTPUT - stderr.length);
      }

      if (onStatus) {
        try {
          onStatus({ type: "stderr", chunk, elapsed: Date.now() - startTime });
        } catch {}
      }
    });

    proc.on("error", (err) => {
      const durationMs = Date.now() - startTime;
      auditLog.push({
        timestamp: new Date().toISOString(),
        command,
        workdir: cwd,
        exitCode: 1,
        durationMs,
        blocked: false,
        error: err.message,
      });
      if (auditLog.length > 1000) auditLog.shift();

      resolve({
        output: stderr || err.message,
        exitCode: 1,
        error: err.message
      });
    });

    proc.on("close", (code, signal) => {
      const durationMs = Date.now() - startTime;
      const exitCode = signal === "SIGTERM" || signal === "SIGKILL" ? 137 : (code ?? 0);

      auditLog.push({
        timestamp: new Date().toISOString(),
        command,
        workdir: cwd,
        exitCode,
        durationMs,
        blocked: false,
        error: signal ? `Killed by ${signal}` : undefined,
      });
      if (auditLog.length > 1000) auditLog.shift();

      const combined = stdout + (stderr ? `\n[stderr]\n${stderr}` : "");
      if (signal === "SIGTERM" || signal === "SIGKILL") {
        resolve({
          output: combined + `\n[Process killed: timeout after ${timeoutSec}s]`,
          exitCode: 137,
          error: `Process timed out after ${timeoutSec} seconds`
        });
      } else {
        resolve({
          output: combined || "(no output)",
          exitCode: code ?? 0
        });
      }
    });

    proc.stdin?.end();
  });
}
