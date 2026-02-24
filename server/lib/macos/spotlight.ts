/**
 * macOS Spotlight Search & Shortcuts
 */

import { runOsascript, runJxa, type OsascriptResult } from "./osascriptBridge";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

// ── Spotlight / mdfind ─────────────────────────────────────────────────

export interface SpotlightResult {
  path: string;
  name: string;
  kind: string;
}

export async function spotlightSearch(
  query: string,
  options: { limit?: number; directory?: string; kind?: string } = {}
): Promise<SpotlightResult[]> {
  const args: string[] = [];

  if (options.directory) {
    args.push("-onlyin", options.directory);
  }

  let mdfindQuery = query;
  if (options.kind) {
    mdfindQuery = `kMDItemKind == '*${options.kind}*' && kMDItemDisplayName == '*${query}*'`;
  }

  args.push(mdfindQuery);

  try {
    const { stdout } = await execFileAsync("mdfind", args, {
      timeout: 10000,
      maxBuffer: 5 * 1024 * 1024,
    });

    const paths = stdout.trim().split("\n").filter(Boolean);
    const limit = options.limit || 20;
    const results: SpotlightResult[] = [];

    for (const p of paths.slice(0, limit)) {
      const parts = p.split("/");
      results.push({
        path: p,
        name: parts[parts.length - 1] || p,
        kind: getFileKind(p),
      });
    }

    return results;
  } catch {
    return [];
  }
}

function getFileKind(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  const kinds: Record<string, string> = {
    pdf: "PDF", doc: "Word", docx: "Word", xls: "Excel", xlsx: "Excel",
    ppt: "PowerPoint", pptx: "PowerPoint", txt: "Text", md: "Markdown",
    jpg: "Image", jpeg: "Image", png: "Image", gif: "Image", webp: "Image",
    mp3: "Audio", wav: "Audio", mp4: "Video", mov: "Video", avi: "Video",
    py: "Python", js: "JavaScript", ts: "TypeScript", html: "HTML", css: "CSS",
    json: "JSON", xml: "XML", zip: "Archive", dmg: "Disk Image", app: "Application",
  };
  return kinds[ext] || "File";
}

// ── Shortcuts.app ──────────────────────────────────────────────────────

export async function listShortcuts(): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync("shortcuts", ["list"], { timeout: 10000 });
    return stdout.trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

export async function runShortcut(
  name: string,
  input?: string
): Promise<OsascriptResult> {
  const args = ["run", name];
  if (input) {
    args.push("-i", input);
  }

  try {
    const { stdout, stderr } = await execFileAsync("shortcuts", args, { timeout: 30000 });
    return { success: true, output: stdout.trim(), error: stderr.trim() || undefined, duration: 0 };
  } catch (err: any) {
    return { success: false, output: "", error: err.message, duration: 0 };
  }
}

// ── Keychain ───────────────────────────────────────────────────────────

export async function getKeychainPassword(
  service: string,
  account: string
): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("security", [
      "find-generic-password",
      "-s", service,
      "-a", account,
      "-w",
    ], { timeout: 5000 });
    return stdout.trim();
  } catch {
    return null;
  }
}

// ── System Dialogs ─────────────────────────────────────────────────────

export async function chooseFile(
  options: { prompt?: string; fileTypes?: string[]; multiple?: boolean } = {}
): Promise<string[]> {
  const prompt = options.prompt ? `with prompt "${options.prompt.replace(/"/g, '\\"')}"` : "";
  const types = options.fileTypes?.length
    ? `of type {${options.fileTypes.map((t) => `"${t}"`).join(", ")}}`
    : "";
  const multiple = options.multiple ? "with multiple selections allowed" : "";

  const r = await runOsascript(`
    set chosenFiles to choose file ${prompt} ${types} ${multiple}
    if class of chosenFiles is list then
      set paths to {}
      repeat with f in chosenFiles
        set end of paths to POSIX path of f
      end repeat
      return paths as text
    else
      return POSIX path of chosenFiles
    end if
  `, { timeout: 60000 });

  if (!r.success || !r.output) return [];
  return r.output.split(", ").filter(Boolean);
}

export async function chooseFolder(prompt?: string): Promise<string | null> {
  const promptStr = prompt ? `with prompt "${prompt.replace(/"/g, '\\"')}"` : "";
  const r = await runOsascript(`
    set chosenFolder to choose folder ${promptStr}
    return POSIX path of chosenFolder
  `, { timeout: 60000 });

  return r.success ? r.output : null;
}

// ── Music / Spotify ────────────────────────────────────────────────────

export async function musicControl(
  action: "play" | "pause" | "next" | "previous" | "status",
  app: "Music" | "Spotify" = "Music"
): Promise<OsascriptResult> {
  switch (action) {
    case "play":
      return runOsascript(`tell application "${app}" to play`);
    case "pause":
      return runOsascript(`tell application "${app}" to pause`);
    case "next":
      return runOsascript(`tell application "${app}" to next track`);
    case "previous":
      return runOsascript(`tell application "${app}" to previous track`);
    case "status": {
      if (app === "Spotify") {
        return runOsascript(`
          tell application "Spotify"
            set trackName to name of current track
            set artistName to artist of current track
            set playerState to player state as text
            return playerState & ": " & artistName & " - " & trackName
          end tell
        `);
      }
      return runOsascript(`
        tell application "Music"
          set trackName to name of current track
          set artistName to artist of current track
          set playerState to player state as text
          return playerState & ": " & artistName & " - " & trackName
        end tell
      `);
    }
    default:
      return { success: false, output: "", error: `Unknown action: ${action}`, duration: 0 };
  }
}
