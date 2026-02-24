/**
 * osascript Bridge - Core AppleScript/JXA execution engine for macOS
 *
 * Provides safe, audited execution of AppleScript and JavaScript for Automation (JXA)
 * scripts via the macOS `osascript` binary.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import os from "os";
import fs from "fs/promises";
import path from "path";

const execFileAsync = promisify(execFile);

// ── Types ──────────────────────────────────────────────────────────────

export interface OsascriptOptions {
  language?: "AppleScript" | "JavaScript";
  timeout?: number; // ms, default 10_000, max 60_000
}

export interface OsascriptResult {
  success: boolean;
  output: string;
  error?: string;
  duration: number;
}

// ── Constants ──────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT = 10_000;
const MAX_TIMEOUT = 60_000;
const AUDIT_LOG_PATH = path.join(os.homedir(), ".iliagpt-macos-audit.log");

// ── Helpers ────────────────────────────────────────────────────────────

export function isMacOS(): boolean {
  return os.platform() === "darwin";
}

async function appendAudit(action: string, details: Record<string, unknown>): Promise<void> {
  const entry = `${new Date().toISOString()} ${action} ${JSON.stringify(details)}\n`;
  await fs.appendFile(AUDIT_LOG_PATH, entry, "utf-8").catch(() => {});
}

// ── Core Execution ─────────────────────────────────────────────────────

/**
 * Execute an AppleScript or JXA script via osascript.
 */
export async function runOsascript(
  script: string,
  options: OsascriptOptions = {}
): Promise<OsascriptResult> {
  if (!isMacOS()) {
    return { success: false, output: "", error: "Not running on macOS", duration: 0 };
  }

  const language = options.language ?? "AppleScript";
  const timeout = Math.min(Math.max(options.timeout ?? DEFAULT_TIMEOUT, 1000), MAX_TIMEOUT);

  const start = Date.now();

  const args: string[] = [];
  if (language === "JavaScript") {
    args.push("-l", "JavaScript");
  }
  args.push("-e", script);

  try {
    const { stdout, stderr } = await execFileAsync("/usr/bin/osascript", args, {
      timeout,
      maxBuffer: 5 * 1024 * 1024, // 5MB
      env: { ...process.env, PATH: "/usr/bin:/usr/local/bin:/opt/homebrew/bin" },
    });

    const duration = Date.now() - start;

    await appendAudit("osascript_exec", {
      language,
      scriptPreview: script.slice(0, 200),
      success: true,
      duration,
    });

    return {
      success: true,
      output: stdout.trim(),
      error: stderr.trim() || undefined,
      duration,
    };
  } catch (err: any) {
    const duration = Date.now() - start;

    await appendAudit("osascript_error", {
      language,
      scriptPreview: script.slice(0, 200),
      error: err.message?.slice(0, 300),
      duration,
    });

    return {
      success: false,
      output: err.stdout?.trim() ?? "",
      error: err.stderr?.trim() || err.message || "Unknown error",
      duration,
    };
  }
}

/**
 * Shortcut to run JXA (JavaScript for Automation).
 */
export async function runJxa(
  jsCode: string,
  timeout?: number
): Promise<OsascriptResult> {
  return runOsascript(jsCode, { language: "JavaScript", timeout });
}

/**
 * Run an AppleScript file.
 */
export async function runOsascriptFile(
  filePath: string,
  timeout?: number
): Promise<OsascriptResult> {
  if (!isMacOS()) {
    return { success: false, output: "", error: "Not running on macOS", duration: 0 };
  }

  const resolvedPath = path.resolve(filePath);
  const safeTimeout = Math.min(Math.max(timeout ?? DEFAULT_TIMEOUT, 1000), MAX_TIMEOUT);
  const start = Date.now();

  try {
    const { stdout, stderr } = await execFileAsync("/usr/bin/osascript", [resolvedPath], {
      timeout: safeTimeout,
      maxBuffer: 5 * 1024 * 1024,
    });

    const duration = Date.now() - start;
    await appendAudit("osascript_file", { filePath: resolvedPath, success: true, duration });

    return { success: true, output: stdout.trim(), error: stderr.trim() || undefined, duration };
  } catch (err: any) {
    const duration = Date.now() - start;
    await appendAudit("osascript_file_error", { filePath: resolvedPath, error: err.message?.slice(0, 300), duration });
    return { success: false, output: err.stdout?.trim() ?? "", error: err.stderr?.trim() || err.message, duration };
  }
}
