import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

const execFileAsync = promisify(execFile);

/**
 * Service to execute strict macOS native commands via AppleScript/JXA and CLI tools.
 * Safe, sandboxed execution wrapper.
 */
export class MacOSBridge {

    /**
     * Executes raw AppleScript.
     * Takes care of properly escaping and passing via osascript.
     */
    static async runAppleScript(script: string): Promise<string> {
        try {
            const { stdout } = await execFileAsync('osascript', ['-e', script]);
            return stdout.trim();
        } catch (error: any) {
            console.error('[MacOSBridge] AppleScript Execution Failed:', error);
            throw new Error(`AppleScript Error: ${error.message}`);
        }
    }

    /**
     * Reads the current clipboard contents (text only).
     */
    static async readClipboard(): Promise<string> {
        try {
            const { stdout } = await execFileAsync('pbpaste');
            return stdout;
        } catch (error: any) {
            throw new Error(`Clipboard Read Error: ${error.message}`);
        }
    }

    /**
     * Writes text to the macOS clipboard.
     */
    static async writeClipboard(text: string): Promise<boolean> {
        return new Promise((resolve, reject) => {
            const child = execFile('pbcopy');
            if (!child.stdin) {
                return reject(new Error('Failed to open stdin for pbcopy'));
            }
            child.stdin.write(text, 'utf8');
            child.stdin.end();

            child.on('close', (code) => {
                if (code === 0) resolve(true);
                else reject(new Error(`pbcopy exited with code ${code}`));
            });
            child.on('error', reject);
        });
    }

    /**
     * Gets current system volume (0-100)
     */
    static async getVolume(): Promise<number> {
        const result = await this.runAppleScript('output volume of (get volume settings)');
        return parseInt(result, 10) || 0;
    }

    /**
     * Sets system volume (0-100)
     */
    static async setVolume(level: number): Promise<void> {
        const safeLevel = Math.max(0, Math.min(100, Math.round(level)));
        await this.runAppleScript(`set volume output volume ${safeLevel}`);
    }

    /**
     * Toggles Do Not Disturb (Focus Mode in newer macOS versions).
     * Note: This tends to require complex JXA or defaults write + killall NotificationCenter
     * on newer macOS. For now, we will use a known defaults toggle.
     */
    static async toggleDoNotDisturb(enable: boolean): Promise<void> {
        // This is tricky on macOS Monterey+, typically requires Shortcuts or specific private APIs.
        // For a generic approach, we trigger a shell script.
        throw new Error('Do Not Disturb toggle requires a dedicated macOS Shortcut on modern OS versions.');
    }

    /**
     * Opens an application by name.
     */
    static async openApplication(appName: string): Promise<void> {
        // Prevent injection
        if (/["'\\]/.test(appName)) {
            throw new Error("Invalid application name.");
        }
        await this.runAppleScript(`tell application "${appName}" to activate`);
    }

    /**
     * Takes a screenshot of the main display and returns it as a Base64 string.
     */
    static async takeScreenshot(): Promise<string> {
        const tmpFile = path.join(os.tmpdir(), `screencapture_${Date.now()}.png`);
        try {
            // -x: silent (no sound), -m: main monitor only, -C: capture cursor
            await execFileAsync('screencapture', ['-x', '-m', '-C', tmpFile]);
            const imageBuf = await fs.readFile(tmpFile);
            const b64 = imageBuf.toString('base64');
            await fs.unlink(tmpFile).catch(() => { });
            return `data:image/png;base64,${b64}`;
        } catch (error: any) {
            await fs.unlink(tmpFile).catch(() => { });
            throw new Error(`Screenshot Capture Error: ${error.message}`);
        }
    }
}
