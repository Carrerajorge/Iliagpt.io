/**
 * macOS Control Router
 *
 * REST API for all macOS native integrations.
 * All endpoints require admin authentication.
 */

import { Router, type Request, type Response } from "express";
import * as macos from "../lib/macos";

function requireMacOS(_req: Request, res: Response, next: Function) {
  if (!macos.isMacOS()) {
    return res.status(400).json({ success: false, error: "This endpoint is only available on macOS" });
  }
  next();
}

export function createMacOSControlRouter(): Router {
  const router = Router();
  router.use(requireMacOS);

  // ═══════════════════════════════════════════
  //  System Controls
  // ═══════════════════════════════════════════

  router.get("/system/volume", async (_req, res) => {
    const volume = await macos.getVolume();
    const muted = await macos.isMuted();
    res.json({ success: true, volume, muted });
  });

  router.post("/system/volume", async (req, res) => {
    const { level, mute } = req.body;
    if (mute !== undefined) {
      const r = await macos.muteVolume(Boolean(mute));
      return res.json({ success: r.success, muted: mute });
    }
    if (level !== undefined) {
      const r = await macos.setVolume(level);
      return res.json({ success: r.success, volume: level });
    }
    res.status(400).json({ success: false, error: "Provide 'level' (0-100) or 'mute' (boolean)" });
  });

  router.get("/system/brightness", async (_req, res) => {
    const brightness = await macos.getBrightness();
    res.json({ success: true, brightness });
  });

  router.post("/system/brightness", async (req, res) => {
    const { level } = req.body;
    if (level === undefined) return res.status(400).json({ success: false, error: "Provide 'level' (0.0-1.0)" });
    const r = await macos.setBrightness(level);
    res.json({ success: r.success, brightness: level });
  });

  router.get("/system/wifi", async (_req, res) => {
    const wifi = await macos.getWiFiStatus();
    res.json({ success: true, ...wifi });
  });

  router.post("/system/wifi", async (req, res) => {
    const { on } = req.body;
    const r = await macos.setWiFi(Boolean(on));
    res.json({ success: r.success, message: r.output, error: r.error });
  });

  router.get("/system/bluetooth", async (_req, res) => {
    const on = await macos.getBluetoothStatus();
    res.json({ success: true, power: on });
  });

  router.post("/system/bluetooth", async (req, res) => {
    const { on } = req.body;
    const r = await macos.setBluetooth(Boolean(on));
    res.json({ success: r.success, message: r.output, error: r.error });
  });

  router.get("/system/darkmode", async (_req, res) => {
    const dark = await macos.isDarkMode();
    res.json({ success: true, darkMode: dark });
  });

  router.post("/system/darkmode", async (req, res) => {
    const { enabled } = req.body;
    const r = await macos.setDarkMode(Boolean(enabled));
    res.json({ success: r.success });
  });

  router.post("/system/dnd", async (req, res) => {
    const { enabled } = req.body;
    const r = await macos.setDoNotDisturb(Boolean(enabled));
    res.json({ success: r.success, error: r.error });
  });

  router.get("/system/battery", async (_req, res) => {
    const battery = await macos.getBatteryInfo();
    res.json({ success: true, ...battery });
  });

  router.post("/system/lock", async (_req, res) => {
    const r = await macos.lockScreen();
    res.json({ success: r.success });
  });

  router.post("/system/sleep", async (req, res) => {
    const { display } = req.body;
    const r = display ? await macos.sleepDisplay() : await macos.sleepComputer();
    res.json({ success: r.success });
  });

  // ═══════════════════════════════════════════
  //  App Control
  // ═══════════════════════════════════════════

  router.get("/apps/running", async (_req, res) => {
    const apps = await macos.listRunningApps();
    res.json({ success: true, apps });
  });

  router.get("/apps/frontmost", async (_req, res) => {
    const app = await macos.getFrontmostApp();
    res.json({ success: true, app });
  });

  router.post("/apps/open", async (req, res) => {
    const { name, url, file, withApp } = req.body;
    if (url) {
      const r = await macos.openUrl(url);
      return res.json({ success: r.success, error: r.error });
    }
    if (file && withApp) {
      const r = await macos.openFileWith(file, withApp);
      return res.json({ success: r.success, error: r.error });
    }
    if (file) {
      const r = await macos.openFile(file);
      return res.json({ success: r.success, error: r.error });
    }
    if (name) {
      const r = await macos.openApp(name);
      return res.json({ success: r.success, error: r.error });
    }
    res.status(400).json({ success: false, error: "Provide 'name', 'url', or 'file'" });
  });

  router.post("/apps/quit", async (req, res) => {
    const { name, force } = req.body;
    if (!name) return res.status(400).json({ success: false, error: "Provide 'name'" });
    const r = await macos.quitApp(name, force);
    res.json({ success: r.success, error: r.error });
  });

  router.post("/apps/focus", async (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ success: false, error: "Provide 'name'" });
    const r = await macos.focusApp(name);
    res.json({ success: r.success });
  });

  router.post("/apps/hide", async (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ success: false, error: "Provide 'name'" });
    const r = await macos.hideApp(name);
    res.json({ success: r.success });
  });

  // ═══════════════════════════════════════════
  //  Windows
  // ═══════════════════════════════════════════

  router.get("/windows", async (req, res) => {
    const app = req.query.app as string | undefined;
    const windows = await macos.listWindows(app);
    res.json({ success: true, windows });
  });

  router.post("/windows/move", async (req, res) => {
    const { app, index, x, y } = req.body;
    if (!app) return res.status(400).json({ success: false, error: "Provide 'app'" });
    const r = await macos.moveWindow(app, index || 0, x || 0, y || 0);
    res.json({ success: r.success });
  });

  router.post("/windows/resize", async (req, res) => {
    const { app, index, width, height } = req.body;
    if (!app) return res.status(400).json({ success: false, error: "Provide 'app'" });
    const r = await macos.resizeWindow(app, index || 0, width || 800, height || 600);
    res.json({ success: r.success });
  });

  router.post("/windows/minimize", async (req, res) => {
    const { app, index } = req.body;
    if (!app) return res.status(400).json({ success: false, error: "Provide 'app'" });
    const r = await macos.minimizeWindow(app, index || 0);
    res.json({ success: r.success });
  });

  router.post("/windows/fullscreen", async (req, res) => {
    const { app } = req.body;
    if (!app) return res.status(400).json({ success: false, error: "Provide 'app'" });
    const r = await macos.fullscreenWindow(app);
    res.json({ success: r.success });
  });

  // ═══════════════════════════════════════════
  //  Clipboard
  // ═══════════════════════════════════════════

  router.get("/clipboard", async (_req, res) => {
    const content = await macos.getClipboard();
    res.json({ success: true, content, length: content.length });
  });

  router.post("/clipboard", async (req, res) => {
    const { text } = req.body;
    if (text === undefined) return res.status(400).json({ success: false, error: "Provide 'text'" });
    const ok = await macos.setClipboard(text);
    res.json({ success: ok });
  });

  router.delete("/clipboard", async (_req, res) => {
    const ok = await macos.clearClipboard();
    res.json({ success: ok });
  });

  // ═══════════════════════════════════════════
  //  Notifications & TTS
  // ═══════════════════════════════════════════

  router.post("/notify", async (req, res) => {
    const { message, title, subtitle, sound } = req.body;
    if (!message) return res.status(400).json({ success: false, error: "Provide 'message'" });
    const r = await macos.showNotification(message, { title, subtitle, sound });
    res.json({ success: r.success });
  });

  router.post("/alert", async (req, res) => {
    const { message, title, buttons, icon } = req.body;
    if (!message) return res.status(400).json({ success: false, error: "Provide 'message'" });
    const r = await macos.showAlert(message, { title, buttons, icon });
    res.json({ success: r.success, buttonReturned: r.buttonReturned });
  });

  router.post("/say", async (req, res) => {
    const { text, voice, rate } = req.body;
    if (!text) return res.status(400).json({ success: false, error: "Provide 'text'" });
    const r = await macos.sayText(text, { voice, rate });
    res.json({ success: r.success });
  });

  // ═══════════════════════════════════════════
  //  Screenshot
  // ═══════════════════════════════════════════

  router.post("/screenshot", async (req, res) => {
    const { region, display, format, delay, hideCursor } = req.body || {};
    const r = await macos.takeScreenshot({ region, display, format, delay, hideCursor, shadow: false });
    if (!r.success) return res.status(500).json({ success: false, error: r.error });
    res.json({ success: true, path: r.path, base64: r.base64 });
  });

  // ═══════════════════════════════════════════
  //  Calendar
  // ═══════════════════════════════════════════

  router.get("/calendar/events", async (req, res) => {
    const days = parseInt(req.query.days as string) || 7;
    const calendar = req.query.calendar as string | undefined;
    const events = await macos.getCalendarEvents(days, calendar);
    res.json({ success: true, events, count: events.length });
  });

  router.post("/calendar/events", async (req, res) => {
    const { title, startDate, endDate, calendar, location, notes, allDay } = req.body;
    if (!title || !startDate || !endDate) {
      return res.status(400).json({ success: false, error: "Provide title, startDate, endDate" });
    }
    const r = await macos.createCalendarEvent(title, new Date(startDate), new Date(endDate), {
      calendar, location, notes, allDay,
    });
    res.json({ success: r.success, error: r.error });
  });

  router.get("/calendar/list", async (_req, res) => {
    const calendars = await macos.listCalendars();
    res.json({ success: true, calendars });
  });

  // ═══════════════════════════════════════════
  //  Contacts
  // ═══════════════════════════════════════════

  router.get("/contacts/search", async (req, res) => {
    const q = req.query.q as string;
    if (!q) return res.status(400).json({ success: false, error: "Provide 'q' query param" });
    const contacts = await macos.searchContacts(q);
    res.json({ success: true, contacts, count: contacts.length });
  });

  // ═══════════════════════════════════════════
  //  Reminders
  // ═══════════════════════════════════════════

  router.get("/reminders", async (req, res) => {
    const list = req.query.list as string | undefined;
    const includeCompleted = req.query.completed === "true";
    const reminders = await macos.getReminders(list, includeCompleted);
    res.json({ success: true, reminders, count: reminders.length });
  });

  router.post("/reminders", async (req, res) => {
    const { name, list, dueDate, notes, priority } = req.body;
    if (!name) return res.status(400).json({ success: false, error: "Provide 'name'" });
    const r = await macos.createReminder(name, {
      list, dueDate: dueDate ? new Date(dueDate) : undefined, notes, priority,
    });
    res.json({ success: r.success, error: r.error });
  });

  router.post("/reminders/complete", async (req, res) => {
    const { name, list } = req.body;
    if (!name) return res.status(400).json({ success: false, error: "Provide 'name'" });
    const r = await macos.completeReminder(name, list);
    res.json({ success: r.success, output: r.output });
  });

  // ═══════════════════════════════════════════
  //  Spotlight & Search
  // ═══════════════════════════════════════════

  router.get("/spotlight", async (req, res) => {
    const q = req.query.q as string;
    const limit = parseInt(req.query.limit as string) || 20;
    const directory = req.query.dir as string | undefined;
    const kind = req.query.kind as string | undefined;
    if (!q) return res.status(400).json({ success: false, error: "Provide 'q' query param" });
    const results = await macos.spotlightSearch(q, { limit, directory, kind });
    res.json({ success: true, results, count: results.length });
  });

  // ═══════════════════════════════════════════
  //  Shortcuts
  // ═══════════════════════════════════════════

  router.get("/shortcuts", async (_req, res) => {
    const shortcuts = await macos.listShortcuts();
    res.json({ success: true, shortcuts, count: shortcuts.length });
  });

  router.post("/shortcuts/run", async (req, res) => {
    const { name, input } = req.body;
    if (!name) return res.status(400).json({ success: false, error: "Provide 'name'" });
    const r = await macos.runShortcut(name, input);
    res.json({ success: r.success, output: r.output, error: r.error });
  });

  // ═══════════════════════════════════════════
  //  Finder
  // ═══════════════════════════════════════════

  router.post("/finder/reveal", async (req, res) => {
    const { path } = req.body;
    if (!path) return res.status(400).json({ success: false, error: "Provide 'path'" });
    const r = await macos.revealInFinder(path);
    res.json({ success: r.success });
  });

  router.get("/finder/selection", async (_req, res) => {
    const files = await macos.getFinderSelection();
    res.json({ success: true, files });
  });

  router.post("/finder/trash", async (_req, res) => {
    const r = await macos.emptyTrash();
    res.json({ success: r.success });
  });

  // ═══════════════════════════════════════════
  //  Music
  // ═══════════════════════════════════════════

  router.post("/music", async (req, res) => {
    const { action, app } = req.body;
    if (!action) return res.status(400).json({ success: false, error: "Provide 'action' (play/pause/next/previous/status)" });
    const r = await macos.musicControl(action, app || "Music");
    res.json({ success: r.success, output: r.output, error: r.error });
  });

  // ═══════════════════════════════════════════
  //  AppleScript execution (advanced)
  // ═══════════════════════════════════════════

  router.post("/osascript", async (req, res) => {
    const { script, language } = req.body;
    if (!script) return res.status(400).json({ success: false, error: "Provide 'script'" });
    const r = await macos.runOsascript(script, { language });
    res.json({
      success: r.success,
      output: r.output,
      error: r.error,
      duration: r.duration,
    });
  });

  return router;
}
