import { app, BrowserWindow, Menu, Tray, nativeImage } from 'electron';
import * as path from 'path';
import { setupTray } from './services/trayManager';
import { setupGlobalShortcuts } from './services/globalShortcuts';
import { registerIpcHandlers } from './ipc/handlers';
import { setupAutoUpdater } from './services/autoUpdater';

let overlayWindow: BrowserWindow | null = null;
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

const PANEL_URL = process.env.ILIAGPT_PANEL_URL || 'https://iliagpt.com';

export function getOverlayWindow() {
    return overlayWindow;
}

export function getMainWindow() {
    return mainWindow;
}

function createMainWindow() {
    const isDev = !app.isPackaged;
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 850,
        minWidth: 900,
        minHeight: 600,
        title: 'ILIAGPT — Panel Administrativo',
        titleBarStyle: 'hiddenInset',
        trafficLightPosition: { x: 15, y: 15 },
        backgroundColor: '#09090b',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
        }
    });

    const panelUrl = isDev ? 'http://localhost:5050' : PANEL_URL;
    mainWindow.loadURL(panelUrl);

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

    // En producción, conecta al panel administrativo real (iliagpt.com)
    // En desarrollo, usa el servidor local
    const isDev = !app.isPackaged;
    const PANEL_URL = process.env.ILIAGPT_PANEL_URL || 'https://iliagpt.com';
    const url = isDev ? 'http://localhost:5050?mode=overlay' : `${PANEL_URL}?mode=overlay`;

    overlayWindow.loadURL(url);

    // Permitir clics SOLO en la ventana, gobernado temporalmente por React via IPC (luego)
    // overlayWindow.setIgnoreMouseEvents(false);
}

import { fork, ChildProcess } from 'child_process';

let backendProcess: ChildProcess | null = null;

function startBackendServer() {
    const isPackaged = app.isPackaged;
    if (isPackaged) {
        // En producción, el servidor compilado está en dist/index.cjs relativo al asar
        const serverPath = path.join(process.resourcesPath, 'app.asar', 'dist', 'index.cjs');
        console.log("Iniciando MICHAT Backend en:", serverPath);
        backendProcess = fork(serverPath, [], {
            env: { ...process.env, NODE_ENV: 'production' },
            stdio: 'inherit'
        });
    } else {
        console.log("Entorno de desarrollo: Se espera que 'npm run dev' esté corriendo el servidor.");
    }
}

app.whenReady().then(() => {
    if (app.isPackaged) {
        setupAutoUpdater();
    }

    // Crear ventana principal conectada al panel administrativo
    createMainWindow();

    // Overlay HUD para control autónomo (opcional, activable desde tray)
    // createOverlayWindow();

    tray = setupTray();
    setupGlobalShortcuts(overlayWindow);
    registerIpcHandlers(overlayWindow);

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createMainWindow();
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
