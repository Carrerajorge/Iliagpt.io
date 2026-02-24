import { autoUpdater } from 'electron-updater';
import { dialog } from 'electron';

export function setupAutoUpdater() {
    autoUpdater.autoDownload = false; // Ask user before downloading

    autoUpdater.on('update-available', (info) => {
        dialog.showMessageBox({
            type: 'info',
            title: 'Update Available',
            message: `Version ${info.version} of the Autonomous Brain is available.`,
            detail: 'Would you like to download it now?',
            buttons: ['Download', 'Later']
        }).then((result) => {
            if (result.response === 0) {
                autoUpdater.downloadUpdate();
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

    autoUpdater.on('error', (err) => {
        console.error('Error in auto-updater.', err);
    });

    // Initiate check
    autoUpdater.checkForUpdatesAndNotify().catch(err => console.error("Update Check Failed", err));
}
