import { z } from "zod";
import { spawn } from "child_process";
import { writeFile, unlink, mkdtemp } from "fs/promises";
import path from "path";
import os from "os";

const MAX_OUTPUT_BYTES = 100 * 1024; // 100KB

const CodeExecOptionsSchema = z.object({
  language: z.enum(["python", "javascript", "typescript", "bash"]),
  code: z.string().min(1),
  timeout: z.number().int().positive().default(15_000),
  signal: z.instanceof(AbortSignal).optional(),
});

export type CodeExecOptions = z.infer<typeof CodeExecOptionsSchema>;

export interface CodeExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
}

function truncate(text: string): { value: string; truncated: boolean } {
  if (Buffer.byteLength(text, "utf-8") <= MAX_OUTPUT_BYTES) {
    return { value: text, truncated: false };
  }
  const buf = Buffer.from(text, "utf-8").subarray(0, MAX_OUTPUT_BYTES);
  return { value: buf.toString("utf-8") + "\n...[truncated]", truncated: true };
}

export async function executeCode(opts: CodeExecOptions): Promise<CodeExecResult> {
  const { language, code, timeout, signal } = CodeExecOptionsSchema.parse(opts);

  let tempFile: string | undefined;

  const resolveCommand = async (): Promise<{ cmd: string; args: string[] }> => {
    switch (language) {
      case "python": {
        const dir = await mkdtemp(path.join(os.tmpdir(), "claw-py-"));
        tempFile = path.join(dir, "script.py");
        await writeFile(tempFile, code, "utf-8");
        return { cmd: "python3", args: [tempFile] };
      }
      case "javascript":
      case "typescript": return { cmd: "node", args: ["-e", code] };
      case "bash": return { cmd: "sh", args: ["-c", code] };
    }
  };

  const { cmd, args } = await resolveCommand();

  return new Promise<CodeExecResult>((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let killed = false;

    const proc = spawn(cmd, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NODE_OPTIONS: "--max-old-space-size=256" },
      timeout: 0, // handled manually below
    });

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGKILL");
    }, timeout);

    const onAbort = () => {
      killed = true;
      proc.kill("SIGKILL");
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    proc.stdout!.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf-8");
    });
    proc.stderr!.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf-8");
    });

    proc.on("close", async (exitCode) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);

      if (tempFile) {
        await unlink(tempFile).catch(() => {});
      }

      const out = truncate(stdout);
      const err = truncate(stderr);

      resolve({
        exitCode: exitCode ?? (timedOut || killed ? 137 : 1),
        stdout: out.value,
        stderr: err.value,
        timedOut,
        truncated: out.truncated || err.truncated,
      });
    });

    proc.on("error", async (e) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (tempFile) await unlink(tempFile).catch(() => {});
      resolve({ exitCode: 1, stdout: "", stderr: e.message, timedOut: false, truncated: false });
    });
  });
}

export const CODE_EXECUTOR_TOOL_DEFINITION = {
  name: "code_executor",
  description: "Execute code in a sandboxed environment. Supports Python, JS, TS, and Bash. Returns stdout, stderr, exit code. Output truncated at 100KB.",
  inputSchema: z.object({
    language: z.enum(["python", "javascript", "typescript", "bash"]).describe("Programming language to execute"),
    code: z.string().describe("Source code to execute"),
    timeout: z.number().int().positive().optional().describe("Execution timeout in milliseconds (default 15000)"),
  }),
  capabilities: ["code_execution" as const],
  safetyPolicy: "requires_confirmation" as const,
  timeoutMs: 30_000,
  execute: async (input: { language: string; code: string; timeout?: number }) => {
    const result = await executeCode({
      language: input.language as CodeExecOptions["language"],
      code: input.code,
      timeout: input.timeout,
    });
    return {
      success: result.exitCode === 0,
      output: result.stdout || result.stderr,
      data: result,
    };
  },
};
