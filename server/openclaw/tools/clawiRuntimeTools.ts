import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { z } from "zod";
import type { ToolDefinition, ToolResult } from "../../agent/toolRegistry";
import { getClawiCatalog } from "../fusion/clawiCatalog";

const DEFAULT_CLAWI_ROOT = path.join(os.homedir(), "Desktop", "clawi", "openclaw");
const MAX_CAPTURE_BYTES = 1_000_000;

function resolveClawiRoot(): string {
  return process.env.CLAWI_ROOT_DIR
    ? path.resolve(process.env.CLAWI_ROOT_DIR)
    : DEFAULT_CLAWI_ROOT;
}

async function existsAsFile(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function existsAsDir(dirPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

function fail(code: string, message: string, retryable = false): ToolResult {
  return {
    success: false,
    output: null,
    error: { code, message, retryable },
  };
}

function capText(input: string): string {
  if (input.length <= MAX_CAPTURE_BYTES) return input;
  return `${input.slice(0, MAX_CAPTURE_BYTES)}\n...(truncated)`;
}

async function runClawiCommand(params: {
  rootDir: string;
  args: string[];
  timeoutMs: number;
}): Promise<{ ok: boolean; code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn("node", ["openclaw.mjs", ...params.args], {
      cwd: params.rootDir,
      env: {
        ...process.env,
        OPENCLAW_PROFILE: process.env.OPENCLAW_PROFILE || "dev",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let killedByTimeout = false;

    const timeout = setTimeout(() => {
      killedByTimeout = true;
      proc.kill("SIGTERM");
    }, params.timeoutMs);

    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf-8");
      if (stdout.length > MAX_CAPTURE_BYTES) {
        stdout = stdout.slice(-MAX_CAPTURE_BYTES);
      }
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf-8");
      if (stderr.length > MAX_CAPTURE_BYTES) {
        stderr = stderr.slice(-MAX_CAPTURE_BYTES);
      }
    });

    proc.on("close", (code) => {
      clearTimeout(timeout);
      resolve({
        ok: !killedByTimeout && code === 0,
        code,
        stdout: capText(stdout),
        stderr: capText(stderr),
      });
    });
  });
}

const clawiStatusTool: ToolDefinition = {
  name: "openclaw_clawi_status",
  description:
    "Inspect local Clawi/OpenClaw fusion status (repo availability, build artifacts, skills/extensions/tools counts).",
  inputSchema: z.object({}),
  execute: async (): Promise<ToolResult> => {
    try {
      const rootDir = resolveClawiRoot();
      const openclawEntry = path.join(rootDir, "openclaw.mjs");
      const distEntryJs = path.join(rootDir, "dist", "entry.js");
      const distEntryMjs = path.join(rootDir, "dist", "entry.mjs");
      const nodeModulesDir = path.join(rootDir, "node_modules");

      const [repoExists, entryExists, distJsExists, distMjsExists, nodeModulesExists] =
        await Promise.all([
          existsAsDir(rootDir),
          existsAsFile(openclawEntry),
          existsAsFile(distEntryJs),
          existsAsFile(distEntryMjs),
          existsAsDir(nodeModulesDir),
        ]);

      const catalog = await getClawiCatalog();

      return {
        success: true,
        output: {
          rootDir,
          repoExists,
          openclawEntryExists: entryExists,
          distReady: distJsExists || distMjsExists,
          nodeModulesExists,
          skillsCount: catalog.skills.length,
          extensionsCount: catalog.extensions.length,
          agentToolsCount: catalog.agentTools.length,
          loadedAt: catalog.loadedAt,
        },
      };
    } catch (error: any) {
      return fail("CLAWI_STATUS_ERROR", error?.message || "Failed to inspect Clawi status", true);
    }
  },
};

const clawiExecTool: ToolDefinition = {
  name: "openclaw_clawi_exec",
  description:
    "Execute OpenClaw CLI commands from the local fused Clawi repo (no HTTP API). Example args: ['agent','--mode','rpc','--json'].",
  inputSchema: z.object({
    args: z.array(z.string().min(1)).min(1).max(32),
    timeoutMs: z.number().int().min(1_000).max(300_000).optional().default(120_000),
  }),
  capabilities: ["long_running", "high_risk"],
  execute: async (input: any): Promise<ToolResult> => {
    try {
      const rootDir = resolveClawiRoot();
      if (!(await existsAsDir(rootDir))) {
        return fail("CLAWI_ROOT_NOT_FOUND", `Clawi root not found: ${rootDir}`, false);
      }

      const openclawEntry = path.join(rootDir, "openclaw.mjs");
      if (!(await existsAsFile(openclawEntry))) {
        return fail("CLAWI_ENTRY_NOT_FOUND", `openclaw.mjs not found in ${rootDir}`, false);
      }

      const result = await runClawiCommand({
        rootDir,
        args: input.args,
        timeoutMs: input.timeoutMs,
      });

      if (!result.ok) {
        return fail(
          "CLAWI_EXEC_FAILED",
          `OpenClaw CLI failed (code=${String(result.code)}). stderr: ${result.stderr || "(empty)"}`,
          true,
        );
      }

      return {
        success: true,
        output: {
          code: result.code,
          stdout: result.stdout,
          stderr: result.stderr,
          args: input.args,
        },
      };
    } catch (error: any) {
      return fail("CLAWI_EXEC_ERROR", error?.message || "Failed to execute Clawi runtime", true);
    }
  },
};

export function createClawiRuntimeTools(): ToolDefinition[] {
  return [clawiStatusTool, clawiExecTool];
}
