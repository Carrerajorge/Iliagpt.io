/**
 * macOS App Control
 *
 * Open, close, focus, hide, list running apps, and control specific apps.
 */

import { runOsascript, runJxa, type OsascriptResult } from "./osascriptBridge";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

// ── Types ──────────────────────────────────────────────────────────────

export interface RunningApp {
  name: string;
  bundleId: string;
  pid: number;
  isHidden: boolean;
  isFrontmost: boolean;
}

export interface WindowInfo {
  appName: string;
  windowName: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  minimized: boolean;
  fullscreen: boolean;
  index: number;
}

// ── App Lifecycle ──────────────────────────────────────────────────────

export async function openApp(appName: string): Promise<OsascriptResult> {
  // Sanitize app name
  const safe = appName.replace(/[";\\]/g, "").trim();
  return runOsascript(`tell application "${safe}" to activate`);
}

export async function openUrl(url: string): Promise<OsascriptResult> {
  const safe = url.replace(/[";]/g, "").trim();
  return runOsascript(`open location "${safe}"`);
}

export async function openFile(filePath: string): Promise<OsascriptResult> {
  try {
    await execFileAsync("open", [filePath], { timeout: 10000 });
    return { success: true, output: `Opened: ${filePath}`, duration: 0 };
  } catch (err: any) {
    return { success: false, output: "", error: err.message, duration: 0 };
  }
}

export async function openFileWith(filePath: string, appName: string): Promise<OsascriptResult> {
  try {
    await execFileAsync("open", ["-a", appName, filePath], { timeout: 10000 });
    return { success: true, output: `Opened ${filePath} with ${appName}`, duration: 0 };
  } catch (err: any) {
    return { success: false, output: "", error: err.message, duration: 0 };
  }
}

export async function quitApp(appName: string, force = false): Promise<OsascriptResult> {
  const safe = appName.replace(/[";\\]/g, "").trim();
  if (force) {
    try {
      await execFileAsync("killall", [safe], { timeout: 5000 });
      return { success: true, output: `Force quit: ${safe}`, duration: 0 };
    } catch (err: any) {
      return { success: false, output: "", error: err.message, duration: 0 };
    }
  }
  return runOsascript(`tell application "${safe}" to quit`);
}

export async function hideApp(appName: string): Promise<OsascriptResult> {
  const safe = appName.replace(/[";\\]/g, "").trim();
  return runOsascript(
    `tell application "System Events" to set visible of process "${safe}" to false`
  );
}

export async function focusApp(appName: string): Promise<OsascriptResult> {
  const safe = appName.replace(/[";\\]/g, "").trim();
  return runOsascript(`tell application "${safe}" to activate`);
}

// ── Running Apps ───────────────────────────────────────────────────────

export async function listRunningApps(): Promise<RunningApp[]> {
  const r = await runJxa(`
    const se = Application("System Events");
    const procs = se.processes.whose({ backgroundOnly: false })();
    const result = procs.map(p => ({
      name: p.name(),
      bundleId: p.bundleIdentifier() || "",
      pid: p.unixId(),
      isHidden: p.visible() === false,
      isFrontmost: p.frontmost(),
    }));
    JSON.stringify(result);
  `);

  if (!r.success) return [];
  try {
    return JSON.parse(r.output);
  } catch {
    return [];
  }
}

export async function getFrontmostApp(): Promise<{ name: string; bundleId: string } | null> {
  const r = await runJxa(`
    const se = Application("System Events");
    const front = se.processes.whose({ frontmost: true })()[0];
    JSON.stringify({ name: front.name(), bundleId: front.bundleIdentifier() || "" });
  `);

  if (!r.success) return null;
  try {
    return JSON.parse(r.output);
  } catch {
    return null;
  }
}

// ── Window Management ──────────────────────────────────────────────────

export async function listWindows(appName?: string): Promise<WindowInfo[]> {
  const filter = appName
    ? `const apps = se.processes.whose({ name: "${appName.replace(/[";\\]/g, "")}" })();`
    : `const apps = se.processes.whose({ backgroundOnly: false })();`;

  const r = await runJxa(`
    const se = Application("System Events");
    ${filter}
    const result = [];
    for (const app of apps) {
      try {
        const wins = app.windows();
        for (let i = 0; i < wins.length; i++) {
          const w = wins[i];
          try {
            const pos = w.position();
            const sz = w.size();
            result.push({
              appName: app.name(),
              windowName: w.name() || "(untitled)",
              position: { x: pos[0], y: pos[1] },
              size: { width: sz[0], height: sz[1] },
              minimized: w.minimized ? w.minimized() : false,
              fullscreen: false,
              index: i,
            });
          } catch(e) {}
        }
      } catch(e) {}
    }
    JSON.stringify(result);
  `, 15000);

  if (!r.success) return [];
  try {
    return JSON.parse(r.output);
  } catch {
    return [];
  }
}

export async function moveWindow(
  appName: string,
  windowIndex: number,
  x: number,
  y: number
): Promise<OsascriptResult> {
  const safe = appName.replace(/[";\\]/g, "").trim();
  return runOsascript(`
    tell application "System Events"
      tell process "${safe}"
        set position of window ${windowIndex + 1} to {${Math.round(x)}, ${Math.round(y)}}
      end tell
    end tell
  `);
}

export async function resizeWindow(
  appName: string,
  windowIndex: number,
  width: number,
  height: number
): Promise<OsascriptResult> {
  const safe = appName.replace(/[";\\]/g, "").trim();
  return runOsascript(`
    tell application "System Events"
      tell process "${safe}"
        set size of window ${windowIndex + 1} to {${Math.round(width)}, ${Math.round(height)}}
      end tell
    end tell
  `);
}

export async function minimizeWindow(appName: string, windowIndex = 0): Promise<OsascriptResult> {
  const safe = appName.replace(/[";\\]/g, "").trim();
  return runJxa(`
    const app = Application("${safe}");
    app.windows[${windowIndex}].miniaturized = true;
    "minimized";
  `);
}

export async function fullscreenWindow(appName: string): Promise<OsascriptResult> {
  const safe = appName.replace(/[";\\]/g, "").trim();
  return runOsascript(`
    tell application "${safe}" to activate
    tell application "System Events"
      keystroke "f" using {command down, control down}
    end tell
  `);
}

// ── Finder ─────────────────────────────────────────────────────────────

export async function revealInFinder(filePath: string): Promise<OsascriptResult> {
  const safe = filePath.replace(/"/g, '\\"');
  return runOsascript(`
    tell application "Finder"
      reveal POSIX file "${safe}"
      activate
    end tell
  `);
}

export async function emptyTrash(): Promise<OsascriptResult> {
  return runOsascript(`tell application "Finder" to empty trash`);
}

export async function getFinderSelection(): Promise<string[]> {
  const r = await runOsascript(`
    tell application "Finder"
      set sel to selection as alias list
      set paths to {}
      repeat with f in sel
        set end of paths to POSIX path of f
      end repeat
      return paths as text
    end tell
  `);
  if (!r.success || !r.output) return [];
  return r.output.split(", ").filter(Boolean);
}
