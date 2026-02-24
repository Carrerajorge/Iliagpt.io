/**
 * macOS Native Screenshot
 */

import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import os from "os";

const execFileAsync = promisify(execFile);

export interface ScreenshotOptions {
  region?: { x: number; y: number; width: number; height: number };
  display?: number; // display index
  windowId?: number;
  interactive?: boolean; // user selects region
  format?: "png" | "jpg" | "pdf" | "tiff";
  hideCursor?: boolean;
  shadow?: boolean; // window shadow
  delay?: number; // seconds
  outputPath?: string;
}

export interface ScreenshotResult {
  success: boolean;
  path: string;
  base64?: string;
  error?: string;
}

export async function takeScreenshot(options: ScreenshotOptions = {}): Promise<ScreenshotResult> {
  const format = options.format || "png";
  const outputPath = options.outputPath ||
    path.join(os.tmpdir(), `iliagpt-screenshot-${Date.now()}.${format}`);

  const args: string[] = [];

  if (options.interactive) {
    args.push("-i"); // interactive selection
  } else if (options.windowId) {
    args.push("-l", String(options.windowId));
  } else if (options.region) {
    args.push("-R", `${options.region.x},${options.region.y},${options.region.width},${options.region.height}`);
  }

  if (options.display !== undefined) {
    args.push("-D", String(options.display));
  }

  if (options.hideCursor) {
    args.push("-C"); // no cursor (default in some modes)
  }

  if (options.shadow === false) {
    args.push("-o"); // no shadow
  }

  if (options.delay) {
    args.push("-T", String(Math.round(options.delay)));
  }

  args.push("-t", format);
  args.push(outputPath);

  try {
    await execFileAsync("/usr/sbin/screencapture", args, { timeout: 15000 });

    // Verify file exists
    await fs.access(outputPath);
    const stats = await fs.stat(outputPath);

    if (stats.size === 0) {
      return { success: false, path: outputPath, error: "Screenshot file is empty (cancelled?)" };
    }

    // Read as base64
    const buffer = await fs.readFile(outputPath);
    const base64 = buffer.toString("base64");

    return { success: true, path: outputPath, base64 };
  } catch (err: any) {
    return { success: false, path: outputPath, error: err.message };
  }
}

export async function takeWindowScreenshot(appName: string, windowIndex = 0): Promise<ScreenshotResult> {
  // First get the window ID
  const { execFile: ef } = require("child_process");
  const execAsync = promisify(ef);

  try {
    // Get window list with IDs
    const { stdout } = await execAsync("/usr/bin/osascript", [
      "-e", `tell application "System Events" to tell process "${appName.replace(/"/g, '')}"
        set wid to id of window ${windowIndex + 1}
        return wid
      end tell`
    ], { timeout: 5000 });

    const windowId = parseInt(stdout.trim(), 10);
    if (isNaN(windowId)) {
      // Fallback: take full screenshot
      return takeScreenshot();
    }

    return takeScreenshot({ windowId, shadow: false });
  } catch {
    // Fallback to full screenshot
    return takeScreenshot();
  }
}

export async function cleanupScreenshots(maxAge = 3600000): Promise<number> {
  const tmpDir = os.tmpdir();
  let cleaned = 0;
  try {
    const files = await fs.readdir(tmpDir);
    const now = Date.now();
    for (const file of files) {
      if (file.startsWith("iliagpt-screenshot-")) {
        const filePath = path.join(tmpDir, file);
        const stat = await fs.stat(filePath);
        if (now - stat.mtimeMs > maxAge) {
          await fs.unlink(filePath).catch(() => {});
          cleaned++;
        }
      }
    }
  } catch { /* ignore */ }
  return cleaned;
}
