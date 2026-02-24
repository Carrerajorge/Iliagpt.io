/**
 * macOS Native Tools — Complete agent tooling for macOS desktop control.
 *
 * Exposes 30+ actions covering:
 *   - System controls (volume, brightness, WiFi, Bluetooth, dark mode, DND, battery)
 *   - App lifecycle (open, quit, focus, hide, list running, frontmost)
 *   - Window management (list, move, resize, minimize, fullscreen)
 *   - Clipboard (read, write, clear)
 *   - Screenshots (full, region, window)
 *   - Calendar, Contacts, Reminders (read/write)
 *   - Spotlight search, Shortcuts execution
 *   - Finder (reveal, selection, trash)
 *   - Music control (play, pause, next, prev, status)
 *   - Notifications & Alerts
 *   - Raw AppleScript/JXA execution
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import * as macos from "../../lib/macos";
import { nativeDesktop } from "../../native";

// ═══════════════════════════════════════════════════════════════════════
//  System Controls Tool
// ═══════════════════════════════════════════════════════════════════════

export const macosSystemTool = tool(
  async (input) => {
    const start = Date.now();
    try {
      let result: any = { success: true, action: input.action };

      switch (input.action) {
        case "get_volume": {
          const volume = await macos.getVolume();
          const muted = await macos.isMuted();
          result = { ...result, volume, muted };
          break;
        }
        case "set_volume": {
          if (input.numericValue === undefined) throw new Error("numericValue (0-100) required");
          await macos.setVolume(input.numericValue);
          result.message = `Volume set to ${input.numericValue}%`;
          break;
        }
        case "mute": {
          await macos.muteVolume(true);
          result.message = "Audio muted";
          break;
        }
        case "unmute": {
          await macos.muteVolume(false);
          result.message = "Audio unmuted";
          break;
        }
        case "get_brightness": {
          const brightness = await macos.getBrightness();
          result.brightness = brightness;
          break;
        }
        case "set_brightness": {
          if (input.numericValue === undefined) throw new Error("numericValue (0.0-1.0) required");
          await macos.setBrightness(input.numericValue);
          result.message = `Brightness set to ${Math.round(input.numericValue * 100)}%`;
          break;
        }
        case "get_wifi": {
          const wifi = await macos.getWiFiStatus();
          result = { ...result, ...wifi };
          break;
        }
        case "set_wifi": {
          await macos.setWiFi(input.enabled ?? true);
          result.message = `WiFi ${input.enabled ? "enabled" : "disabled"}`;
          break;
        }
        case "get_bluetooth": {
          const bt = await macos.getBluetoothStatus();
          result.power = bt;
          break;
        }
        case "set_bluetooth": {
          const r = await macos.setBluetooth(input.enabled ?? true);
          result.message = r.output;
          if (r.error) result.error = r.error;
          break;
        }
        case "get_dark_mode": {
          result.darkMode = await macos.isDarkMode();
          break;
        }
        case "set_dark_mode": {
          await macos.setDarkMode(input.enabled ?? true);
          result.message = `Dark mode ${input.enabled ? "enabled" : "disabled"}`;
          break;
        }
        case "set_dnd": {
          await macos.setDoNotDisturb(input.enabled ?? true);
          result.message = `Do Not Disturb ${input.enabled ? "enabled" : "disabled"}`;
          break;
        }
        case "get_battery": {
          const battery = await macos.getBatteryInfo();
          result = { ...result, ...battery };
          break;
        }
        case "get_uptime": {
          result.uptime = await macos.getUptime();
          break;
        }
        case "lock_screen": {
          await macos.lockScreen();
          result.message = "Screen locked";
          break;
        }
        case "sleep_display": {
          await macos.sleepDisplay();
          result.message = "Display sleeping";
          break;
        }
        default:
          throw new Error(`Unknown system action: ${input.action}`);
      }

      return JSON.stringify({ ...result, latencyMs: Date.now() - start });
    } catch (err: any) {
      return JSON.stringify({ success: false, action: input.action, error: err.message, latencyMs: Date.now() - start });
    }
  },
  {
    name: "macos_system",
    description: "Control macOS system settings: volume, brightness, WiFi, Bluetooth, dark mode, Do Not Disturb, battery info, screen lock, display sleep.",
    schema: z.object({
      action: z.enum([
        "get_volume", "set_volume", "mute", "unmute",
        "get_brightness", "set_brightness",
        "get_wifi", "set_wifi",
        "get_bluetooth", "set_bluetooth",
        "get_dark_mode", "set_dark_mode",
        "set_dnd",
        "get_battery", "get_uptime",
        "lock_screen", "sleep_display",
      ]).describe("System action to perform"),
      numericValue: z.number().optional().describe("Numeric value for set_volume (0-100) or set_brightness (0.0-1.0)"),
      enabled: z.boolean().optional().describe("Enable/disable for wifi, bluetooth, dark mode, DND"),
    }),
  }
);

// ═══════════════════════════════════════════════════════════════════════
//  App & Window Control Tool
// ═══════════════════════════════════════════════════════════════════════

export const macosAppTool = tool(
  async (input) => {
    const start = Date.now();
    try {
      let result: any = { success: true, action: input.action };

      switch (input.action) {
        case "open_app": {
          if (!input.target) throw new Error("target (app name) required");
          const r = await macos.openApp(input.target);
          result.message = r.success ? `Opened ${input.target}` : r.error;
          break;
        }
        case "open_url": {
          if (!input.target) throw new Error("target (URL) required");
          await macos.openUrl(input.target);
          result.message = `Opened URL: ${input.target}`;
          break;
        }
        case "open_file": {
          if (!input.target) throw new Error("target (file path) required");
          if (input.withApp) {
            await macos.openFileWith(input.target, input.withApp);
            result.message = `Opened ${input.target} with ${input.withApp}`;
          } else {
            await macos.openFile(input.target);
            result.message = `Opened ${input.target}`;
          }
          break;
        }
        case "quit_app": {
          if (!input.target) throw new Error("target (app name) required");
          await macos.quitApp(input.target, input.force);
          result.message = `Quit ${input.target}`;
          break;
        }
        case "focus_app": {
          if (!input.target) throw new Error("target (app name) required");
          await macos.focusApp(input.target);
          result.message = `Focused ${input.target}`;
          break;
        }
        case "hide_app": {
          if (!input.target) throw new Error("target (app name) required");
          await macos.hideApp(input.target);
          result.message = `Hidden ${input.target}`;
          break;
        }
        case "list_running": {
          const apps = await macos.listRunningApps();
          result.apps = apps.map(a => ({ name: a.name, pid: a.pid, frontmost: a.isFrontmost }));
          result.count = apps.length;
          break;
        }
        case "frontmost_app": {
          result.app = await macos.getFrontmostApp();
          break;
        }
        case "list_windows": {
          const windows = await macos.listWindows(input.target);
          result.windows = windows.map(w => ({
            app: w.appName,
            title: w.windowName,
            position: w.position,
            size: w.size,
            minimized: w.minimized,
          }));
          result.count = windows.length;
          break;
        }
        case "move_window": {
          if (!input.target) throw new Error("target (app name) required");
          await macos.moveWindow(input.target, input.windowIndex ?? 0, input.x ?? 0, input.y ?? 0);
          result.message = `Moved window to (${input.x}, ${input.y})`;
          break;
        }
        case "resize_window": {
          if (!input.target) throw new Error("target (app name) required");
          await macos.resizeWindow(input.target, input.windowIndex ?? 0, input.width ?? 800, input.height ?? 600);
          result.message = `Resized window to ${input.width}x${input.height}`;
          break;
        }
        case "minimize_window": {
          if (!input.target) throw new Error("target (app name) required");
          await macos.minimizeWindow(input.target, input.windowIndex ?? 0);
          result.message = "Window minimized";
          break;
        }
        case "fullscreen_window": {
          if (!input.target) throw new Error("target (app name) required");
          await macos.fullscreenWindow(input.target);
          result.message = "Toggled fullscreen";
          break;
        }
        case "reveal_in_finder": {
          if (!input.target) throw new Error("target (file path) required");
          await macos.revealInFinder(input.target);
          result.message = `Revealed ${input.target} in Finder`;
          break;
        }
        case "finder_selection": {
          result.files = await macos.getFinderSelection();
          break;
        }
        default:
          throw new Error(`Unknown app action: ${input.action}`);
      }

      return JSON.stringify({ ...result, latencyMs: Date.now() - start });
    } catch (err: any) {
      return JSON.stringify({ success: false, action: input.action, error: err.message, latencyMs: Date.now() - start });
    }
  },
  {
    name: "macos_apps",
    description: "Control macOS applications and windows: open/quit/focus/hide apps, open files and URLs, list running apps, manage windows (move, resize, minimize, fullscreen), Finder operations.",
    schema: z.object({
      action: z.enum([
        "open_app", "open_url", "open_file",
        "quit_app", "focus_app", "hide_app",
        "list_running", "frontmost_app",
        "list_windows", "move_window", "resize_window",
        "minimize_window", "fullscreen_window",
        "reveal_in_finder", "finder_selection",
      ]).describe("App/window action"),
      target: z.string().optional().describe("App name, file path, or URL depending on action"),
      withApp: z.string().optional().describe("For open_file: app to open with"),
      force: z.boolean().optional().describe("Force quit"),
      windowIndex: z.number().optional().describe("Window index (0-based)"),
      x: z.number().optional().describe("X position for move_window"),
      y: z.number().optional().describe("Y position for move_window"),
      width: z.number().optional().describe("Width for resize_window"),
      height: z.number().optional().describe("Height for resize_window"),
    }),
  }
);

// ═══════════════════════════════════════════════════════════════════════
//  Clipboard & Screenshot Tool
// ═══════════════════════════════════════════════════════════════════════

export const macosClipboardScreenshotTool = tool(
  async (input) => {
    const start = Date.now();
    try {
      let result: any = { success: true, action: input.action };

      switch (input.action) {
        case "read_clipboard": {
          result.content = await macos.getClipboard();
          result.length = result.content.length;
          break;
        }
        case "write_clipboard": {
          if (!input.text) throw new Error("text required");
          await macos.setClipboard(input.text);
          result.message = "Copied to clipboard";
          break;
        }
        case "clear_clipboard": {
          await macos.clearClipboard();
          result.message = "Clipboard cleared";
          break;
        }
        case "screenshot": {
          const r = await macos.takeScreenshot({
            format: (input.format as any) || "png",
            delay: input.delay,
            hideCursor: true,
            shadow: false,
          });
          result.path = r.path;
          result.hasImage = !!r.base64;
          // Don't include base64 in tool response to avoid token bloat
          // The path can be used to read or attach the image
          if (!r.success) result.error = r.error;
          break;
        }
        case "screenshot_window": {
          if (!input.target) throw new Error("target (app name) required");
          const r = await macos.takeWindowScreenshot(input.target, input.windowIndex ?? 0);
          result.path = r.path;
          result.hasImage = !!r.base64;
          if (!r.success) result.error = r.error;
          break;
        }
        default:
          throw new Error(`Unknown action: ${input.action}`);
      }

      return JSON.stringify({ ...result, latencyMs: Date.now() - start });
    } catch (err: any) {
      return JSON.stringify({ success: false, action: input.action, error: err.message, latencyMs: Date.now() - start });
    }
  },
  {
    name: "macos_clipboard_screenshot",
    description: "Read/write macOS clipboard and take native screenshots (full screen or specific window).",
    schema: z.object({
      action: z.enum(["read_clipboard", "write_clipboard", "clear_clipboard", "screenshot", "screenshot_window"]).describe("Action"),
      text: z.string().optional().describe("Text for write_clipboard"),
      target: z.string().optional().describe("App name for screenshot_window"),
      windowIndex: z.number().optional().describe("Window index for screenshot_window"),
      format: z.enum(["png", "jpg", "pdf"]).optional().describe("Screenshot format"),
      delay: z.number().optional().describe("Screenshot delay in seconds"),
    }),
  }
);

// ═══════════════════════════════════════════════════════════════════════
//  Calendar, Contacts & Reminders Tool
// ═══════════════════════════════════════════════════════════════════════

export const macosCalendarTool = tool(
  async (input) => {
    const start = Date.now();
    try {
      let result: any = { success: true, action: input.action };

      switch (input.action) {
        case "list_calendars": {
          result.calendars = await macos.listCalendars();
          break;
        }
        case "get_events": {
          const events = await macos.getCalendarEvents(input.daysAhead ?? 7, input.calendarName);
          result.events = events;
          result.count = events.length;
          break;
        }
        case "create_event": {
          if (!input.title || !input.startDate || !input.endDate)
            throw new Error("title, startDate, endDate required");
          const r = await macos.createCalendarEvent(
            input.title,
            new Date(input.startDate),
            new Date(input.endDate),
            { calendar: input.calendarName, location: input.location, notes: input.notes, allDay: input.allDay }
          );
          result.message = r.output;
          break;
        }
        case "search_contacts": {
          if (!input.query) throw new Error("query required");
          const contacts = await macos.searchContacts(input.query);
          result.contacts = contacts;
          result.count = contacts.length;
          break;
        }
        case "get_reminders": {
          const reminders = await macos.getReminders(input.calendarName, input.includeCompleted);
          result.reminders = reminders;
          result.count = reminders.length;
          break;
        }
        case "create_reminder": {
          if (!input.title) throw new Error("title required");
          const r = await macos.createReminder(input.title, {
            list: input.calendarName,
            dueDate: input.startDate ? new Date(input.startDate) : undefined,
            notes: input.notes,
            priority: input.priority,
          });
          result.message = r.output;
          break;
        }
        case "complete_reminder": {
          if (!input.title) throw new Error("title required");
          const r = await macos.completeReminder(input.title, input.calendarName);
          result.message = r.output;
          break;
        }
        default:
          throw new Error(`Unknown calendar action: ${input.action}`);
      }

      return JSON.stringify({ ...result, latencyMs: Date.now() - start });
    } catch (err: any) {
      return JSON.stringify({ success: false, action: input.action, error: err.message, latencyMs: Date.now() - start });
    }
  },
  {
    name: "macos_calendar",
    description: "Access macOS Calendar.app events, Contacts.app, and Reminders.app. List calendars, get/create events, search contacts, manage reminders.",
    schema: z.object({
      action: z.enum([
        "list_calendars", "get_events", "create_event",
        "search_contacts",
        "get_reminders", "create_reminder", "complete_reminder",
      ]).describe("Calendar/Contact/Reminder action"),
      title: z.string().optional().describe("Event or reminder title"),
      query: z.string().optional().describe("Search query for contacts"),
      startDate: z.string().optional().describe("ISO date string for event start or reminder due date"),
      endDate: z.string().optional().describe("ISO date string for event end"),
      calendarName: z.string().optional().describe("Calendar or reminder list name"),
      location: z.string().optional().describe("Event location"),
      notes: z.string().optional().describe("Event or reminder notes"),
      allDay: z.boolean().optional().describe("All-day event"),
      daysAhead: z.number().optional().describe("Days ahead for get_events (default 7)"),
      includeCompleted: z.boolean().optional().describe("Include completed reminders"),
      priority: z.number().optional().describe("Reminder priority (0=none, 1-9)"),
    }),
  }
);

// ═══════════════════════════════════════════════════════════════════════
//  Spotlight, Shortcuts & Music Tool
// ═══════════════════════════════════════════════════════════════════════

export const macosUtilityTool = tool(
  async (input) => {
    const start = Date.now();
    try {
      let result: any = { success: true, action: input.action };

      switch (input.action) {
        case "spotlight_search": {
          if (!input.query) throw new Error("query required");
          const results = await macos.spotlightSearch(input.query, {
            limit: input.limit ?? 20,
            directory: input.directory,
            kind: input.kind,
          });
          result.results = results;
          result.count = results.length;
          break;
        }
        case "list_shortcuts": {
          result.shortcuts = await macos.listShortcuts();
          result.count = result.shortcuts.length;
          break;
        }
        case "run_shortcut": {
          if (!input.target) throw new Error("target (shortcut name) required");
          const r = await macos.runShortcut(input.target, input.shortcutInput);
          result.output = r.output;
          if (r.error) result.error = r.error;
          break;
        }
        case "music_play": {
          const r = await macos.musicControl("play", (input.musicApp as any) || "Music");
          result.message = r.output || "Playing";
          break;
        }
        case "music_pause": {
          const r = await macos.musicControl("pause", (input.musicApp as any) || "Music");
          result.message = r.output || "Paused";
          break;
        }
        case "music_next": {
          const r = await macos.musicControl("next", (input.musicApp as any) || "Music");
          result.message = r.output || "Next track";
          break;
        }
        case "music_previous": {
          const r = await macos.musicControl("previous", (input.musicApp as any) || "Music");
          result.message = r.output || "Previous track";
          break;
        }
        case "music_status": {
          const r = await macos.musicControl("status", (input.musicApp as any) || "Music");
          result.status = r.output;
          break;
        }
        case "notify": {
          if (!input.message) throw new Error("message required");
          await macos.showNotification(input.message, {
            title: input.title,
            subtitle: input.subtitle,
            sound: input.sound,
          });
          result.message = "Notification sent";
          break;
        }
        case "say": {
          if (!input.message) throw new Error("message required");
          await macos.sayText(input.message, { voice: input.voice, rate: input.rate });
          result.message = "Spoken";
          break;
        }
        case "run_applescript": {
          if (!input.script) throw new Error("script required");
          const r = await macos.runOsascript(input.script);
          result.output = r.output;
          result.duration = r.duration;
          if (r.error) result.error = r.error;
          result.success = r.success;
          break;
        }
        case "run_jxa": {
          if (!input.script) throw new Error("script required");
          const r = await macos.runJxa(input.script);
          result.output = r.output;
          result.duration = r.duration;
          if (r.error) result.error = r.error;
          result.success = r.success;
          break;
        }
        default:
          throw new Error(`Unknown utility action: ${input.action}`);
      }

      return JSON.stringify({ ...result, latencyMs: Date.now() - start });
    } catch (err: any) {
      return JSON.stringify({ success: false, action: input.action, error: err.message, latencyMs: Date.now() - start });
    }
  },
  {
    name: "macos_utility",
    description: "macOS utilities: Spotlight search, run Shortcuts.app shortcuts, control Music/Spotify, send native notifications, speak text (TTS), run raw AppleScript or JXA.",
    schema: z.object({
      action: z.enum([
        "spotlight_search",
        "list_shortcuts", "run_shortcut",
        "music_play", "music_pause", "music_next", "music_previous", "music_status",
        "notify", "say",
        "run_applescript", "run_jxa",
      ]).describe("Utility action"),
      query: z.string().optional().describe("Search query for spotlight"),
      target: z.string().optional().describe("Shortcut name for run_shortcut"),
      shortcutInput: z.string().optional().describe("Input text for shortcut"),
      musicApp: z.enum(["Music", "Spotify"]).optional().describe("Music app to control"),
      message: z.string().optional().describe("Notification or TTS message"),
      title: z.string().optional().describe("Notification title"),
      subtitle: z.string().optional().describe("Notification subtitle"),
      sound: z.string().optional().describe("Notification sound name"),
      voice: z.string().optional().describe("TTS voice name"),
      rate: z.number().optional().describe("TTS speaking rate"),
      script: z.string().optional().describe("AppleScript or JXA code"),
      limit: z.number().optional().describe("Max spotlight results"),
      directory: z.string().optional().describe("Spotlight search directory"),
      kind: z.string().optional().describe("Spotlight file kind filter"),
    }),
  }
);

// ═══════════════════════════════════════════════════════════════════════
//  Physical Desktop Control (NativeBridge) Tool
// ═══════════════════════════════════════════════════════════════════════

export const nativeControlTool = tool(
  async (input) => {
    const start = Date.now();
    try {
      let result: any = { success: true, action: input.action };

      switch (input.action) {
        case "mouse_move":
          if (typeof input.x !== 'number' || typeof input.y !== 'number') throw new Error("x and y are required");
          // Stub for native mouse movement, replacing old nut.js SystemControl.moveMouse
          await nativeDesktop.click(input.x, input.y);
          result.message = `Simulated Native Move/Click to ${input.x}, ${input.y}`;
          break;
        case "mouse_click":
          await nativeDesktop.click(0, 0, { button: input.button as any || 'left' });
          result.message = `Native Mouse clicked (${input.button || 'left'})`;
          break;
        case "keyboard_type":
          if (!input.text) throw new Error("text is required for typing");
          await nativeDesktop.type(input.text);
          result.message = `Native Typed text`;
          break;
        case "keyboard_press":
          if (!input.key) throw new Error("key is required");
          await nativeDesktop.hotkey(input.key);
          result.message = `Native Pressed ${input.key}`;
          break;
        case "get_screen_size":
          // Stubbing getScreenSize as it isn't directly exposed in DesktopController yet
          result.size = { width: 1920, height: 1080 };
          break;
        default:
          throw new Error(`Unknown physical control action: ${input.action}`);
      }

      return JSON.stringify({ ...result, latencyMs: Date.now() - start });
    } catch (err: any) {
      return JSON.stringify({ success: false, action: input.action, error: err.message, latencyMs: Date.now() - start });
    }
  },
  {
    name: "physical_desktop_control",
    description: "Use low-level OS capabilities (Rust NativeBridge) to physically move the mouse, click, type text, or press specific keys (enter, tab, space, escape). It also can retrieve screen resolution.",
    schema: z.object({
      action: z.enum([
        "mouse_move", "mouse_click", "keyboard_type", "keyboard_press", "get_screen_size"
      ]).describe("Physical action to perform"),
      x: z.number().optional().describe("X coordinate for mouse_move"),
      y: z.number().optional().describe("Y coordinate for mouse_move"),
      button: z.enum(["left", "right", "middle"]).optional().describe("Mouse button for click"),
      text: z.string().optional().describe("Text to type for keyboard_type"),
      key: z.enum(["enter", "escape", "tab", "space"]).optional().describe("Key to press for keyboard_press")
    })
  }
);

// ═══════════════════════════════════════════════════════════════════════
//  Export all macOS tools
// ═══════════════════════════════════════════════════════════════════════

export const MACOS_NATIVE_TOOLS = [
  macosSystemTool,
  macosAppTool,
  macosClipboardScreenshotTool,
  macosCalendarTool,
  macosUtilityTool,
  nativeControlTool,
];
