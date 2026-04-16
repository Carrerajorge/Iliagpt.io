/**
 * macOS Clipboard
 */

import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export async function getClipboard(): Promise<string> {
  try {
    const { stdout } = await execFileAsync("pbpaste", [], { timeout: 5000, maxBuffer: 10 * 1024 * 1024 });
    return stdout;
  } catch {
    return "";
  }
}

export async function setClipboard(text: string): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = require("child_process").spawn("pbcopy", [], { timeout: 5000 });
    proc.stdin.write(text);
    proc.stdin.end();
    proc.on("close", (code: number) => resolve(code === 0));
    proc.on("error", () => resolve(false));
  });
}

export async function clearClipboard(): Promise<boolean> {
  return setClipboard("");
}
