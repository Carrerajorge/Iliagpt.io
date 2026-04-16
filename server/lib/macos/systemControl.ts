/**
 * macOS System Controls
 *
 * Volume, brightness, WiFi, Bluetooth, Do Not Disturb, dark mode, sleep, lock, etc.
 */

import { runOsascript, runJxa, isMacOS, type OsascriptResult } from "./osascriptBridge";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

// ── Volume ─────────────────────────────────────────────────────────────

export async function getVolume(): Promise<number> {
  const r = await runOsascript('output volume of (get volume settings)');
  return r.success ? parseInt(r.output, 10) : -1;
}

export async function setVolume(level: number): Promise<OsascriptResult> {
  const safe = Math.min(100, Math.max(0, Math.round(level)));
  return runOsascript(`set volume output volume ${safe}`);
}

export async function muteVolume(mute: boolean): Promise<OsascriptResult> {
  return runOsascript(`set volume ${mute ? "with" : "without"} output muted`);
}

export async function isMuted(): Promise<boolean> {
  const r = await runOsascript('output muted of (get volume settings)');
  return r.output === "true";
}

// ── Brightness ─────────────────────────────────────────────────────────

export async function getBrightness(): Promise<number> {
  const r = await runJxa(`
    ObjC.import('CoreGraphics');
    const displayId = $.CGMainDisplayID();
    $.CGDisplayBrightness(displayId);
  `);
  return r.success ? parseFloat(r.output) : -1;
}

export async function setBrightness(level: number): Promise<OsascriptResult> {
  const safe = Math.min(1, Math.max(0, level));
  return runJxa(`
    ObjC.import('CoreGraphics');
    const displayId = $.CGMainDisplayID();
    $.CGDisplaySetBrightness(displayId, ${safe});
    ${safe};
  `);
}

// ── WiFi ───────────────────────────────────────────────────────────────

export async function getWiFiStatus(): Promise<{ power: boolean; ssid: string | null }> {
  try {
    const { stdout } = await execFileAsync("/usr/sbin/networksetup", ["-getairportpower", "en0"], { timeout: 5000 });
    const power = stdout.toLowerCase().includes("on");

    let ssid: string | null = null;
    if (power) {
      try {
        const { stdout: ssidOut } = await execFileAsync("/usr/sbin/networksetup", ["-getairportnetwork", "en0"], { timeout: 5000 });
        const match = ssidOut.match(/Current Wi-Fi Network:\s*(.+)/);
        ssid = match?.[1]?.trim() || null;
      } catch { /* not connected */ }
    }

    return { power, ssid };
  } catch {
    return { power: false, ssid: null };
  }
}

export async function setWiFi(on: boolean): Promise<OsascriptResult> {
  try {
    await execFileAsync("/usr/sbin/networksetup", ["-setairportpower", "en0", on ? "on" : "off"], { timeout: 5000 });
    return { success: true, output: `WiFi ${on ? "enabled" : "disabled"}`, duration: 0 };
  } catch (err: any) {
    return { success: false, output: "", error: err.message, duration: 0 };
  }
}

// ── Bluetooth ──────────────────────────────────────────────────────────

export async function getBluetoothStatus(): Promise<boolean> {
  // Requires blueutil: brew install blueutil
  try {
    const { stdout } = await execFileAsync("blueutil", ["--power"], { timeout: 5000 });
    return stdout.trim() === "1";
  } catch {
    // Fallback to system_profiler
    try {
      const { stdout } = await execFileAsync("/usr/sbin/system_profiler", ["SPBluetoothDataType"], { timeout: 10000 });
      return stdout.includes("State: On") || stdout.includes("Bluetooth Power: On");
    } catch {
      return false;
    }
  }
}

export async function setBluetooth(on: boolean): Promise<OsascriptResult> {
  try {
    await execFileAsync("blueutil", ["--power", on ? "1" : "0"], { timeout: 5000 });
    return { success: true, output: `Bluetooth ${on ? "enabled" : "disabled"}`, duration: 0 };
  } catch (err: any) {
    return { success: false, output: "", error: `blueutil not found. Install with: brew install blueutil. ${err.message}`, duration: 0 };
  }
}

// ── Dark Mode ──────────────────────────────────────────────────────────

export async function isDarkMode(): Promise<boolean> {
  const r = await runOsascript(
    'tell application "System Events" to tell appearance preferences to get dark mode'
  );
  return r.output === "true";
}

export async function setDarkMode(dark: boolean): Promise<OsascriptResult> {
  return runOsascript(
    `tell application "System Events" to tell appearance preferences to set dark mode to ${dark}`
  );
}

// ── Do Not Disturb ─────────────────────────────────────────────────────

export async function setDoNotDisturb(on: boolean): Promise<OsascriptResult> {
  // macOS Sonoma+: Focus mode via shortcuts
  if (on) {
    return runOsascript(`
      do shell script "defaults -currentHost write ~/Library/Preferences/ByHost/com.apple.notificationcenterui doNotDisturb -boolean true"
      do shell script "killall NotificationCenter 2>/dev/null || true"
    `);
  } else {
    return runOsascript(`
      do shell script "defaults -currentHost write ~/Library/Preferences/ByHost/com.apple.notificationcenterui doNotDisturb -boolean false"
      do shell script "killall NotificationCenter 2>/dev/null || true"
    `);
  }
}

// ── Screen Lock & Sleep ────────────────────────────────────────────────

export async function lockScreen(): Promise<OsascriptResult> {
  return runJxa(`
    ObjC.import('Cocoa');
    ObjC.import('CoreGraphics');
    const kCGSessionOnConsoleKey = $.CGSessionCopyCurrentDictionary();
    $.NSWorkspace.sharedWorkspace;
    Application("System Events").keystroke("q", { using: ["command down", "control down"] });
  `).catch(() =>
    runOsascript('do shell script "/System/Library/CoreServices/Menu\\ Extras/User.menu/Contents/Resources/CGSession -suspend"')
  );
}

export async function sleepDisplay(): Promise<OsascriptResult> {
  return runOsascript('do shell script "pmset displaysleepnow"');
}

export async function sleepComputer(): Promise<OsascriptResult> {
  return runOsascript('tell application "System Events" to sleep');
}

// ── System Info ────────────────────────────────────────────────────────

export async function getBatteryInfo(): Promise<{ percent: number; charging: boolean; timeRemaining: string }> {
  try {
    const { stdout } = await execFileAsync("pmset", ["-g", "batt"], { timeout: 5000 });
    const percentMatch = stdout.match(/(\d+)%/);
    const charging = stdout.includes("charging") || stdout.includes("AC Power");
    const timeMatch = stdout.match(/(\d+:\d+)\s+remaining/);
    return {
      percent: percentMatch ? parseInt(percentMatch[1], 10) : -1,
      charging,
      timeRemaining: timeMatch?.[1] || (charging ? "Charging" : "Unknown"),
    };
  } catch {
    return { percent: -1, charging: false, timeRemaining: "Unknown" };
  }
}

export async function getUptime(): Promise<string> {
  try {
    const { stdout } = await execFileAsync("uptime", [], { timeout: 5000 });
    return stdout.trim();
  } catch {
    return "Unknown";
  }
}
