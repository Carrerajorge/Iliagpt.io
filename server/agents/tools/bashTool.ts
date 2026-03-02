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
];

const MAX_OUTPUT = 50000;
const DEFAULT_TIMEOUT = 30;
const MAX_TIMEOUT = 120;

export async function executeBashTool(params: {
  command: string;
  workdir?: string;
  timeout?: number;
}): Promise<{ output: string; exitCode: number; error?: string }> {
  const { command, workdir, timeout: rawTimeout } = params;

  for (const pattern of BLOCKED_COMMANDS) {
    if (pattern.test(command)) {
      return {
        output: "",
        exitCode: 1,
        error: `Command blocked for safety: matches restricted pattern`
      };
    }
  }

  const timeoutSec = Math.min(Math.max(rawTimeout || DEFAULT_TIMEOUT, 1), MAX_TIMEOUT);
  const cwd = workdir ? path.resolve(workdir) : process.cwd();

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let killed = false;

    const proc = spawn("bash", ["-c", command], {
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
    });

    proc.stderr?.on("data", (data: Buffer) => {
      const chunk = data.toString();
      if (stderr.length + chunk.length <= MAX_OUTPUT) {
        stderr += chunk;
      } else if (stderr.length < MAX_OUTPUT) {
        stderr += chunk.slice(0, MAX_OUTPUT - stderr.length);
      }
    });

    proc.on("error", (err) => {
      resolve({
        output: stderr || err.message,
        exitCode: 1,
        error: err.message
      });
    });

    proc.on("close", (code, signal) => {
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
