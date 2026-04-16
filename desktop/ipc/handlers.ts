import { ipcMain, BrowserWindow } from 'electron';

export function registerIpcHandlers(overlayWindow: BrowserWindow | null) {
    if (!overlayWindow) return;

    ipcMain.handle('system:getVolume', async () => {
        // En Fase 4 hicimos Node Fetch, aquí se usaría un daemon bridge o similar
        // Para este HUD, servirá de ping test
        return 100;
    });

    ipcMain.on('set-ignore-mouse-events', (event, ignore: boolean) => {
        // Si el usuario posiciona el MOUSE sobre un Widget de React en el HUD, 
        // cancelamos click-through para que pueda presionarlo. 
        // Si sale de él, devolvemos a "ignore" (transparente a clicks de atrás).

        let win = BrowserWindow.fromWebContents(event.sender);
        if (win) {
            win.setIgnoreMouseEvents(ignore, { forward: true });
            console.log(`[IPC] HUD Click-Through Ignored = ${ignore}`);
        }
    });

    ipcMain.on('agent:started', () => {
        console.log('[IPC] Renderer reports: Agent ACTIVE');
        // Tray icon podría pintarse rojo
    });

    ipcMain.on('agent:stopped', () => {
        console.log('[IPC] Renderer reports: Agent STOPPED');
        // Tray icon podría volver a neutro
    });
}
