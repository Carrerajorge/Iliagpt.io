import { spawn } from "child_process";
import { writeFile, unlink, mkdtemp } from "fs/promises";
import path from "path";
import os from "os";

export const codeToolSchema = {
  type: "function" as const,
  function: {
    name: "run_code",
    description: "Execute Python or Node.js code in an isolated environment. Safer than raw bash for computation, data analysis, and scripting tasks. Captures stdout, stderr, and exit code.",
    parameters: {
      type: "object",
      properties: {
        language: {
          type: "string",
          enum: ["python", "javascript"],
          description: "Programming language to execute"
        },
        code: {
          type: "string",
          description: "The source code to execute"
        },
        timeout: {
          type: "number",
          description: "Timeout in seconds (default 30, max 120)"
        }
      },
      required: ["language", "code"]
    }
  }
};

const MAX_OUTPUT = 50000;
const DEFAULT_TIMEOUT = 30;
const MAX_TIMEOUT = 120;

const BLOCKED_PATTERNS_PYTHON = [
  /\bos\.system\s*\(/,
  /\bsubprocess\.(call|run|Popen)\s*\(/,
  /\b__import__\s*\(\s*['"]os['"]\s*\)/,
  /\bexec\s*\(\s*__import__/,
  /\bshutil\.rmtree\s*\(\s*['"]\/(?!tmp)/,
  /\bopen\s*\(\s*['"](\/etc|\/proc|\/sys)/,
];

const BLOCKED_PATTERNS_JS = [
  /\bchild_process\b/,
  /\brequire\s*\(\s*['"]child_process['"]\s*\)/,
  /\bexecSync\b/,
  /\bspawnSync\b/,
  /\bprocess\.exit\b/,
  /\bfs\.(unlink|rmdir|rm)Sync\s*\(\s*['"]\/(?!tmp)/,
];

function checkBlockedPatterns(code: string, language: string): string | null {
  const patterns = language === "python" ? BLOCKED_PATTERNS_PYTHON : BLOCKED_PATTERNS_JS;
  for (const pattern of patterns) {
    if (pattern.test(code)) {
      return `Blocked: code contains unsafe pattern matching ${pattern}`;
    }
  }
  return null;
}

export async function executeCodeTool(params: {
  language: string;
  code: string;
  timeout?: number;
}): Promise<{ output: string; exitCode: number; error?: string; language: string }> {
  const { language, code, timeout: rawTimeout } = params;

  if (!["python", "javascript"].includes(language)) {
    return { output: "", exitCode: 1, error: "Unsupported language. Use 'python' or 'javascript'.", language };
  }

  if (!code || code.trim().length === 0) {
    return { output: "", exitCode: 1, error: "No code provided.", language };
  }

  if (code.length > 100000) {
    return { output: "", exitCode: 1, error: "Code too large (max 100KB).", language };
  }

  const blocked = checkBlockedPatterns(code, language);
  if (blocked) {
    return { output: "", exitCode: 1, error: blocked, language };
  }

  const timeout = Math.min(Math.max(rawTimeout || DEFAULT_TIMEOUT, 1), MAX_TIMEOUT);

  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "code-exec-"));
  const ext = language === "python" ? ".py" : ".mjs";
  const filePath = path.join(tmpDir, `script${ext}`);

  try {
    await writeFile(filePath, code, "utf-8");

    const cmd = language === "python" ? "python3" : "node";
    const args = language === "python" ? ["-u", filePath] : ["--experimental-vm-modules", filePath];

    return await new Promise<{ output: string; exitCode: number; error?: string; language: string }>((resolve) => {
      let stdout = "";
      let stderr = "";
      let killed = false;

      const proc = spawn(cmd, args, {
        cwd: tmpDir,
        timeout: timeout * 1000,
        env: {
          ...process.env,
          PYTHONDONTWRITEBYTECODE: "1",
          PYTHONUNBUFFERED: "1",
          NODE_OPTIONS: "--max-old-space-size=256",
        },
        stdio: ["pipe", "pipe", "pipe"],
      });

      proc.stdin?.end();

      proc.stdout?.on("data", (data: Buffer) => {
        stdout += data.toString();
        if (stdout.length > MAX_OUTPUT) {
          stdout = stdout.slice(0, MAX_OUTPUT);
          killed = true;
          proc.kill("SIGKILL");
        }
      });

      proc.stderr?.on("data", (data: Buffer) => {
        stderr += data.toString();
        if (stderr.length > MAX_OUTPUT) {
          stderr = stderr.slice(0, MAX_OUTPUT);
        }
      });

      proc.on("error", (err) => {
        resolve({
          output: "",
          exitCode: 1,
          error: `Failed to start ${language} runtime: ${err.message}`,
          language,
        });
      });

      proc.on("close", (exitCode, signal) => {
        let output = stdout;
        if (stderr.trim()) {
          output += (output ? "\n" : "") + "[stderr]\n" + stderr;
        }

        if (killed) {
          output += "\n... [output truncated at 50KB]";
        }

        if (signal === "SIGTERM" || signal === "SIGKILL") {
          resolve({
            output: output || "",
            exitCode: exitCode ?? 137,
            error: `Process killed: timeout exceeded (${timeout}s) or output too large`,
            language,
          });
        } else {
          resolve({
            output,
            exitCode: exitCode ?? 1,
            error: exitCode !== 0 ? `Process exited with code ${exitCode}` : undefined,
            language,
          });
        }
      });
    });
  } finally {
    try {
      await unlink(filePath);
    } catch {}
    try {
      const { rmdir } = await import("fs/promises");
      await rmdir(tmpDir);
    } catch {}
  }
}
