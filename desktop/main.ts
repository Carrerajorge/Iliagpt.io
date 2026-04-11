import { app, BrowserWindow, Tray } from 'electron';
import * as path from 'path';
import { fork, ChildProcess } from 'child_process';
import { setupTray } from './services/trayManager';
import { setupGlobalShortcuts } from './services/globalShortcuts';
import { registerIpcHandlers } from './ipc/handlers';
import { setupAutoUpdater } from './services/autoUpdater';

let overlayWindow: BrowserWindow | null = null;
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let backendProcess: ChildProcess | null = null;

const DEV_PANEL_URL = process.env.ILIAGPT_DEV_PANEL_URL || 'http://localhost:5050/openclaw';
const DESKTOP_BACKEND_PORT = Number(process.env.PORT || 5000);
const LOCAL_PANEL_ORIGIN =
    process.env.ILIAGPT_LOCAL_PANEL_ORIGIN || `http://127.0.0.1:${DESKTOP_BACKEND_PORT}`;
const LOCAL_PANEL_URL =
    process.env.ILIAGPT_LOCAL_PANEL_URL || `${LOCAL_PANEL_ORIGIN}/openclaw`;
const BACKEND_HEALTH_URL =
    process.env.ILIAGPT_DESKTOP_HEALTH_URL || `${LOCAL_PANEL_ORIGIN}/api/openclaw/runtime/health`;

export function getOverlayWindow() {
    return overlayWindow;
}

export function getMainWindow() {
    return mainWindow;
}

function delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForBackendReady(timeoutMs = 30_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        try {
            const response = await fetch(BACKEND_HEALTH_URL, { method: 'GET' });
            if (response.ok) {
                return true;
            }
        } catch {
            // Retry until the bundled backend is healthy.
        }

        await delay(500);
    }

    return false;
}

export async function createMainWindow() {
    const isDev = !app.isPackaged;
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 850,
        minWidth: 900,
        minHeight: 600,
        title: 'ILIAGPT — OpenClaw',
        titleBarStyle: 'hiddenInset',
        trafficLightPosition: { x: 15, y: 15 },
        backgroundColor: '#09090b',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
        }
    });

    const panelUrl = isDev ? DEV_PANEL_URL : LOCAL_PANEL_URL;
    const backendReady = isDev ? true : await waitForBackendReady();

    if (backendReady) {
        await mainWindow.loadURL(panelUrl);
    } else {
        await mainWindow.loadURL(
            `data:text/html,${encodeURIComponent(`
                <html>
                  <body style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; background:#09090b; color:#fafafa; display:flex; align-items:center; justify-content:center; height:100vh; margin:0; padding:32px;">
                    <div style="max-width:720px; line-height:1.5;">
                      <h1 style="margin:0 0 12px;">ILIAGPT no pudo iniciar el runtime local</h1>
                      <p style="margin:0 0 8px;">Se intentó levantar el backend embebido y esperar el healthcheck en <code>${BACKEND_HEALTH_URL}</code>.</p>
                      <p style="margin:0;">Revisa el empaquetado del servidor y los logs del proceso local antes de continuar.</p>
                    </div>
                  </body>
                </html>
            `)}`,
        );
    }

    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    // Show window when ready to avoid white flash
    mainWindow.once('ready-to-show', () => {
        mainWindow?.show();
    });
}

function createOverlayWindow() {
    overlayWindow = new BrowserWindow({
        width: 400, // HUD Dimensions
        height: 800,
        x: 0,
        y: 100,
        transparent: true,
        frame: false,
        alwaysOnTop: true, // HUD is always above
        hasShadow: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'), // compiled preload
            nodeIntegration: false,
            contextIsolation: true,
        }
    });

    // Make window click-through so user can interact with their desktop
    overlayWindow.setIgnoreMouseEvents(true, { forward: true });

    const isDev = !app.isPackaged;
    const url = isDev ? `${DEV_PANEL_URL}?mode=overlay` : `${LOCAL_PANEL_URL}?mode=overlay`;

    overlayWindow.loadURL(url);

    // Permitir clics SOLO en la ventana, gobernado temporalmente por React via IPC (luego)
    // overlayWindow.setIgnoreMouseEvents(false);
}

function startBackendServer() {
    const isPackaged = app.isPackaged;
    if (isPackaged) {
        const serverPath = path.join(process.resourcesPath, 'app.asar', 'dist', 'index.cjs');
        console.log("Iniciando backend embebido de ILIAGPT/OpenClaw en:", serverPath);
        backendProcess = fork(serverPath, [], {
            env: {
                ...process.env,
                NODE_ENV: 'production',
                PORT: String(DESKTOP_BACKEND_PORT),
                BASE_URL: LOCAL_PANEL_ORIGIN,
            },
            stdio: 'inherit'
        });
    } else {
        console.log("Entorno de desarrollo: Se espera que 'npm run dev' esté corriendo el servidor.");
    }
}

app.whenReady().then(async () => {
    if (app.isPackaged) {
        setupAutoUpdater();
    }

    startBackendServer();
    await createMainWindow();

    // Overlay HUD para control autónomo (opcional, activable desde tray)
    // createOverlayWindow();

    tray = setupTray();
    setupGlobalShortcuts(overlayWindow);
    registerIpcHandlers(overlayWindow);

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            void createMainWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
    // cleanup global shortcuts
    if (backendProcess) {
        backendProcess.kill();
    }
});
