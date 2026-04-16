import { dialog } from 'electron';

export function setupAutoUpdater() {
    const localRequire: NodeRequire | undefined =
        typeof require === 'function' ? require : undefined;

    if (!localRequire) {
        console.warn('CommonJS require is unavailable; auto-update disabled.');
        return;
    }

    try {
        const { autoUpdater } = localRequire('electron-updater') as {
            autoUpdater: {
                autoDownload: boolean;
                on: (event: string, listener: (...args: any[]) => void) => void;
                downloadUpdate: () => Promise<unknown>;
                quitAndInstall: () => void;
                checkForUpdatesAndNotify: () => Promise<unknown>;
            };
        };

        autoUpdater.autoDownload = false;

        autoUpdater.on('update-available', (info: { version?: string }) => {
            dialog.showMessageBox({
                type: 'info',
                title: 'Update Available',
                message: `Version ${info.version || 'nueva'} of the Autonomous Brain is available.`,
                detail: 'Would you like to download it now?',
                buttons: ['Download', 'Later']
            }).then((result) => {
                if (result.response === 0) {
                    void autoUpdater.downloadUpdate();
                }
            });
        });

        autoUpdater.on('update-downloaded', () => {
            dialog.showMessageBox({
                title: 'Install Updates',
                message: 'Updates downloaded. The application will restart to apply them.',
            }).then(() => {
                setImmediate(() => autoUpdater.quitAndInstall());
            });
        });

        autoUpdater.on('error', (err: unknown) => {
            console.error('Error in auto-updater.', err);
        });

        void autoUpdater
            .checkForUpdatesAndNotify()
            .catch((err: unknown) => console.error("Update Check Failed", err));
    } catch (error: unknown) {
        console.warn('electron-updater is not installed in this build; auto-update disabled.', error);
    }
}
