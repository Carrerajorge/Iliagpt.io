let mouse: any, keyboard: any, screen: any, Point: any, Key: any;
try { const nut = require('@nut-tree-fork/nut-js'); mouse = nut.mouse; keyboard = nut.keyboard; screen = nut.screen; Point = nut.Point; Key = nut.Key; } catch {}
let MacOSBridge: any;
try { MacOSBridge = require('./macOSBridge').MacOSBridge; } catch {}
import * as os from 'os';

/**
 * Enhanced System Control Service.
 * Combines macOS-specific AppleScripts with cross-platform Nut.js for universal High-Speed control.
 */
export class SystemControl {

    /**
     * Get platform identifier
     */
    static getPlatform() {
        return os.platform(); // 'darwin', 'win32', etc.
    }

    /**
     * Mouse: Move to (x, y) coordinates
     */
    static async moveMouse(x: number, y: number): Promise<void> {
        await mouse.setPosition(new Point(x, y));
    }

    /**
     * Mouse: Click at current position
     */
    static async clickMouse(button: 'left' | 'right' | 'middle' = 'left'): Promise<void> {
        // nut.js uses left click by default on mouse.leftClick()
        if (button === 'left') await mouse.leftClick();
        if (button === 'right') await mouse.rightClick();
    }

    /**
     * Keyboard: Type a string of text at high speed
     */
    static async typeText(text: string): Promise<void> {
        await keyboard.type(text);
    }

    /**
     * Keyboard: Press a specific key (e.g. Enter, Escape)
     */
    static async pressKey(keyName: string): Promise<void> {
        // Simple mapping, nut.js has Key enum
        switch (keyName.toLowerCase()) {
            case 'enter': await keyboard.pressKey(Key.Enter); await keyboard.releaseKey(Key.Enter); break;
            case 'escape': await keyboard.pressKey(Key.Escape); await keyboard.releaseKey(Key.Escape); break;
            case 'tab': await keyboard.pressKey(Key.Tab); await keyboard.releaseKey(Key.Tab); break;
            case 'space': await keyboard.pressKey(Key.Space); await keyboard.releaseKey(Key.Space); break;
            default: throw new Error(`Key ${keyName} not mapped yet.`);
        }
    }

    /**
     * Screen: Get dimensions
     */
    static async getScreenSize(): Promise<{ width: number, height: number }> {
        const width = await screen.width();
        const height = await screen.height();
        return { width, height };
    }

    // --- Legacy / OS-Specific Fallbacks ---

    /**
     * Open Application (macOS specific for now, fallback to generic shell execution on Windows later)
     */
    static async openApplication(appName: string): Promise<void> {
        if (this.getPlatform() === 'darwin') {
            await MacOSBridge.openApplication(appName);
        } else {
            // TODO: Add Windows support via powershell `Start-Process`
            throw new Error(`openApplication not implemented for platform ${this.getPlatform()}`);
        }
    }

    /**
     * Set Volume
     */
    static async setVolume(level: number): Promise<void> {
        if (this.getPlatform() === 'darwin') {
            await MacOSBridge.setVolume(level);
        } else {
            throw new Error(`setVolume not implemented for platform ${this.getPlatform()}`);
        }
    }

    /**
     * Take an instant screenshot
     */
    static async takeScreenshot(): Promise<string> {
        if (this.getPlatform() === 'darwin') {
            return await MacOSBridge.takeScreenshot();
        } else {
            // Nut.js can also take screenshots if needed: screen.capture(), but it requires external binaries sometimes.
            throw new Error(`takeScreenshot not implemented for platform ${this.getPlatform()}`);
        }
    }
}
