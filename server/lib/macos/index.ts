/**
 * macOS Native Integration - Index
 *
 * Re-exports all macOS control modules for convenient access.
 */

// Core
export { runOsascript, runJxa, runOsascriptFile, isMacOS } from "./osascriptBridge";
export type { OsascriptOptions, OsascriptResult } from "./osascriptBridge";

// System Controls
export {
  getVolume, setVolume, muteVolume, isMuted,
  getBrightness, setBrightness,
  getWiFiStatus, setWiFi,
  getBluetoothStatus, setBluetooth,
  isDarkMode, setDarkMode,
  setDoNotDisturb,
  lockScreen, sleepDisplay, sleepComputer,
  getBatteryInfo, getUptime,
} from "./systemControl";

// App Control
export {
  openApp, openUrl, openFile, openFileWith,
  quitApp, hideApp, focusApp,
  listRunningApps, getFrontmostApp,
  listWindows, moveWindow, resizeWindow, minimizeWindow, fullscreenWindow,
  revealInFinder, emptyTrash, getFinderSelection,
} from "./appControl";
export type { RunningApp, WindowInfo } from "./appControl";

// Clipboard
export { getClipboard, setClipboard, clearClipboard } from "./clipboard";

// Notifications
export { showNotification, showAlert, showDialog, sayText } from "./notifications";

// Screenshot
export { takeScreenshot, takeWindowScreenshot, cleanupScreenshots } from "./screenshot";
export type { ScreenshotOptions, ScreenshotResult } from "./screenshot";

// Calendar, Contacts, Reminders
export {
  getCalendarEvents, createCalendarEvent, listCalendars,
  searchContacts,
  getReminders, createReminder, completeReminder,
} from "./calendar";
export type { CalendarEvent, Contact, Reminder } from "./calendar";

// Spotlight, Shortcuts, Keychain, Music, Dialogs
export {
  spotlightSearch,
  listShortcuts, runShortcut,
  getKeychainPassword,
  chooseFile, chooseFolder,
  musicControl,
} from "./spotlight";
export type { SpotlightResult } from "./spotlight";
