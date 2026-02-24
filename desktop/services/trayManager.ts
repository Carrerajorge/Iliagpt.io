import { app, Tray, Menu, nativeImage, shell } from 'electron';
import * as path from 'path';
import { getOverlayWindow, getMainWindow } from '../main';

export function setupTray(): Tray {
    const iconPath = path.join(__dirname, '..', '..', 'build', 'icon.png');

    let icon;
    try {
        icon = nativeImage.createFromPath(iconPath);
        icon = icon.resize({ width: 16, height: 16 });
    } catch (e) {
        icon = nativeImage.createEmpty();
    }

    const tray = new Tray(icon);
    const version = app.getVersion();
    tray.setToolTip(`ILIAGPT v${version} — Agente Autónomo`);

    const contextMenu = Menu.buildFromTemplate([
        {
            label: '🧠 Abrir Panel Administrativo',
            click: () => {
                const main = getMainWindow();
                if (main) {
                    main.show();
                    main.focus();
                } else {
                    // Re-create if closed
                    const { createMainWindow } = require('../main');
                    if (typeof createMainWindow === 'function') createMainWindow();
                }
            }
        },
        {
            label: '🌐 Panel en Navegador',
            click: () => {
                const panelUrl = process.env.ILIAGPT_PANEL_URL || 'https://iliagpt.com';
                shell.openExternal(panelUrl);
            }
        },
        { type: 'separator' },
        {
            label: '👁 Toggle Overlay HUD',
            click: () => {
                const overlay = getOverlayWindow();
                if (overlay) {
                    if (overlay.isVisible()) overlay.hide();
                    else overlay.showInactive();
                }
            }
        },
        {
            label: '🤖 Iniciar Agente Autónomo',
            click: () => {
                const main = getMainWindow();
                if (main) {
                    main.webContents.executeJavaScript(`
                        fetch('/api/agent/start', { method: 'POST' })
                            .then(r => r.json())
                            .then(d => console.log('Agent started:', d))
                            .catch(e => console.error('Agent start failed:', e));
                    `);
                }
            }
        },
        { type: 'separator' },
        {
            label: `ILIAGPT v${app.getVersion()}`,
            enabled: false
        },
        {
            label: 'Salir',
            click: () => app.quit()
        }
    ]);

    tray.setContextMenu(contextMenu);

    // Double-click tray opens main window
    tray.on('double-click', () => {
        const main = getMainWindow();
        if (main) {
            main.show();
            main.focus();
        }
    });

    return tray;
}
