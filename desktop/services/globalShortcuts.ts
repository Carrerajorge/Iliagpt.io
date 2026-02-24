import { globalShortcut, BrowserWindow } from 'electron';

export function setupGlobalShortcuts(overlayWindow: BrowserWindow | null) {
    // Cmd+Shift+I (Mac) or Ctrl+Shift+I (Win) formats
    const toggleShortcut = process.platform === 'darwin' ? 'Command+Shift+I' : 'Control+Shift+I';

    globalShortcut.register(toggleShortcut, () => {
        if (!overlayWindow) return;

        if (overlayWindow.isVisible()) {
            overlayWindow.hide();
            console.log('[Shortcuts] HUD Hidden');
        } else {
            overlayWindow.showInactive(); // Show without taking focus from user apps
            console.log('[Shortcuts] HUD Shown');
        }
    });

    const panicShortcut = process.platform === 'darwin' ? 'Command+Shift+E' : 'Control+Shift+E';
    globalShortcut.register(panicShortcut, () => {
        console.warn('[EMERGENCY] Agent Emergency Halt Triggered via Global Shortcut!');
        // Despacharía evento de stop por IPC o HTTP
    });

    console.log(`[Shortcuts] Registered Toggle HUD: ${toggleShortcut}`);
    console.log(`[Shortcuts] Registered Panic Stop: ${panicShortcut}`);
}
