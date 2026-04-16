import { ToolDefinition, ExecutionContext, ToolResult } from "../types";
import { execFile } from "child_process";
import * as fs from "fs";
import * as path from "path";

const ALLOWED_COMMANDS = new Set([
  "ls", "cat", "head", "tail", "grep", "find", "echo", "pwd", "wc",
  "sort", "uniq", "cut", "sed", "awk", "tr", "mkdir", "touch", "cp",
  "mv", "rm", "chmod", "date", "env", "printenv", "whoami",
  "node", "npm", "npx", "python", "python3", "pip", "pip3",
  "git", "curl", "jq", "tar", "gzip", "gunzip", "zip", "unzip"
]);

const DANGEROUS_CHARS = /[;&|`$(){}[\]<>\\!]/;

const BLOCKED_ARGS_PATTERNS = [
  /^-rf?$/i,
  /^\.\./,
  /^\/(?!tmp\/agent-)/,
  /^~\//,
];

function getSandboxPath(runId: string): string {
  return `/tmp/agent-${runId}`;
}

function ensureSandbox(runId: string): string {
  const sandboxPath = getSandboxPath(runId);
  if (!fs.existsSync(sandboxPath)) {
    fs.mkdirSync(sandboxPath, { recursive: true });
  }
  return sandboxPath;
}

function parseCommand(commandStr: string): { cmd: string; args: string[] } | null {
  const trimmed = commandStr.trim();
  if (!trimmed) return null;
  
  const parts: string[] = [];
  let current = "";
  let inQuote = false;
  let quoteChar = "";
  
  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i];
    
    if (inQuote) {
      if (char === quoteChar) {
        inQuote = false;
      } else {
        current += char;
      }
    } else if (char === '"' || char === "'") {
      inQuote = true;
      quoteChar = char;
    } else if (char === " " || char === "\t") {
      if (current) {
        parts.push(current);
        current = "";
      }
    } else {
      current += char;
    }
  }
  
  if (current) {
    parts.push(current);
  }
  
  if (parts.length === 0) return null;
  
  return { cmd: parts[0], args: parts.slice(1) };
}

function validateCommand(commandStr: string): { valid: boolean; error?: string } {
  if (DANGEROUS_CHARS.test(commandStr)) {
    return { valid: false, error: "Command contains forbidden characters (shell metacharacters not allowed)" };
  }
  
  const parsed = parseCommand(commandStr);
  if (!parsed) {
    return { valid: false, error: "Empty command" };
  }
  
  if (!ALLOWED_COMMANDS.has(parsed.cmd)) {
    return { valid: false, error: `Command '${parsed.cmd}' is not in the allowed list` };
  }
  
  if (parsed.cmd === "rm") {
    for (const arg of parsed.args) {
      if (arg.startsWith("-") && (arg.includes("r") || arg.includes("f"))) {
        if (parsed.args.some(a => a === "/" || a.startsWith("/") && !a.startsWith("/tmp/agent-"))) {
          return { valid: false, error: "Dangerous rm command blocked" };
        }
      }
    }
  }
  
  for (const arg of parsed.args) {
    for (const pattern of BLOCKED_ARGS_PATTERNS) {
      if (pattern.test(arg) && !arg.startsWith("/tmp/agent-")) {
        if (arg.startsWith("..") || (arg.startsWith("/") && !arg.startsWith("/tmp/agent-"))) {
          return { valid: false, error: `Argument '${arg}' is not allowed (path escapes sandbox)` };
        }
      }
    }
  }
  
  return { valid: true };
}

async function executeCommand(
  cmd: string,
  args: string[],
  cwd: string,
  timeout: number
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const proc = execFile(cmd, args, {
      cwd,
      timeout,
      maxBuffer: 1024 * 1024,
      env: {
        PATH: process.env.PATH,
        HOME: cwd,
        TMPDIR: cwd,
        NODE_ENV: "sandbox"
      }
    }, (error, stdout, stderr) => {
      if (error) {
        resolve({
          stdout: stdout?.slice(0, 50000) || "",
          stderr: (stderr || error.message).slice(0, 10000),
          exitCode: error.code === "ETIMEDOUT" ? -1 : (error as any).code || 1
        });
      } else {
        resolve({
          stdout: stdout.slice(0, 50000),
          stderr: stderr.slice(0, 10000),
          exitCode: 0
        });
      }
    });
  });
}

export const shellExecuteTool: ToolDefinition = {
  id: "shell_execute",
  name: "Shell Execute",
  description: "Execute shell commands in a sandboxed environment with strict security restrictions. Only whitelisted commands are allowed.",
  category: "utility",
  capabilities: ["shell", "execute", "command", "run"],
  timeout: 30000,
  inputSchema: {
    action: {
      type: "string",
      description: "The action to perform",
      enum: ["execute", "script"],
      required: true
    },
    command: {
      type: "string",
      description: "The command to execute (for 'execute' action). Must be from allowed list: ls, cat, grep, find, echo, node, npm, python, git, etc.",
    },
    commands: {
      type: "array",
      description: "List of commands to execute sequentially (for 'script' action)",
      items: { type: "string", description: "A shell command" }
    },
    timeout: {
      type: "number",
      description: "Timeout in milliseconds (max 30000)",
      default: 30000
    }
  },
  outputSchema: {
    stdout: { type: "string", description: "Standard output" },
    stderr: { type: "string", description: "Standard error" },
    exitCode: { type: "number", description: "Exit code" },
    results: { type: "array", description: "Results for each command (script action)" }
  },

  validate(params: Record<string, any>) {
    const { action, command, commands } = params;
    const errors: string[] = [];

    if (action === "execute" && !command) {
      errors.push("Command is required for 'execute' action");
    }

    if (action === "script" && (!commands || !Array.isArray(commands) || commands.length === 0)) {
      errors.push("Commands array is required for 'script' action");
    }

    if (action === "execute" && command) {
      const validation = validateCommand(command);
      if (!validation.valid) {
        errors.push(validation.error!);
      }
    }

    if (action === "script" && commands) {
      for (const cmd of commands) {
        const validation = validateCommand(cmd);
        if (!validation.valid) {
          errors.push(`Command '${cmd.slice(0, 30)}...': ${validation.error}`);
        }
      }
    }

    return { valid: errors.length === 0, errors };
  },

  async execute(context: ExecutionContext, params: Record<string, any>): Promise<ToolResult> {
    const { action, command, commands, timeout: userTimeout } = params;
    const timeout = Math.min(userTimeout || 30000, 30000);

    try {
      const sandboxPath = ensureSandbox(context.runId);

      if (action === "execute") {
        const validation = validateCommand(command);
        if (!validation.valid) {
          return { success: false, error: validation.error };
        }

        const parsed = parseCommand(command)!;
        const result = await executeCommand(parsed.cmd, parsed.args, sandboxPath, timeout);

        return {
          success: result.exitCode === 0,
          data: {
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode,
            sandboxPath
          },
          metadata: {
            command: parsed.cmd,
            args: parsed.args,
            sandboxPath
          }
        };
      }

      if (action === "script") {
        const results: Array<{ command: string; stdout: string; stderr: string; exitCode: number }> = [];
        let allSuccess = true;

        for (const cmdStr of commands) {
          const validation = validateCommand(cmdStr);
          if (!validation.valid) {
            results.push({
              command: cmdStr,
              stdout: "",
              stderr: validation.error!,
              exitCode: 1
            });
            allSuccess = false;
            continue;
          }

          const parsed = parseCommand(cmdStr)!;
          const result = await executeCommand(parsed.cmd, parsed.args, sandboxPath, timeout);
          results.push({
            command: cmdStr,
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode
          });

          if (result.exitCode !== 0) {
            allSuccess = false;
          }
        }

        return {
          success: allSuccess,
          data: {
            results,
            sandboxPath
          },
          metadata: {
            commandCount: commands.length,
            successCount: results.filter(r => r.exitCode === 0).length,
            sandboxPath
          }
        };
      }

      return { success: false, error: `Unknown action: ${action}` };
    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
    }
  }
};
