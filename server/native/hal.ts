import os from 'os';

export interface PlatformHAL {
    // Input
    mouseMove(x: number, y: number): Promise<void>;
    mouseClick(x: number, y: number, button?: number): Promise<void>;
    mouseDrag(fromX: number, fromY: number, toX: number, toY: number): Promise<void>;
    mouseScroll(x: number, y: number, deltaX: number, deltaY: number): Promise<void>;
    keyboardType(text: string): Promise<void>;
    // Modifiers can be: "shift", "control", "alt", "win", "command", "option"
    keyboardPress(key: string, modifiers?: string[]): Promise<void>;
    keyboardHotkey(keys: string[]): Promise<void>;

    // Screen Capture
    captureScreen(displayId?: number): Promise<Buffer>;
    captureRegion(x: number, y: number, w: number, h: number): Promise<Buffer>;
    captureWindow(windowId: number): Promise<Buffer>;

    // UI Accessibility Tree
    getFocusedElement(): Promise<UIElement>;
    getElementTree(pid?: number): Promise<UIElement[]>;
    getElementAtPosition(x: number, y: number): Promise<UIElement>;
    performAction(elementId: string, action: string): Promise<boolean>;

    // Window Management
    getActiveWindow(): Promise<WindowInfo>;
    listWindows(): Promise<WindowInfo[]>;
    focusWindow(id: number): Promise<boolean>;
    closeWindow(id: number): Promise<boolean>;

    // System APIs
    getBatteryLevel(): Promise<number>;
    getOSVersion(): Promise<string>;
    getFreeMemory?(): Promise<number>;
    getCPUUsage?(): Promise<number>;
}

export interface UIElement {
    id: string;
    role: string;
    title?: string;
    value?: string;
    position: { x: number; y: number };
    size: { width: number; height: number };
    isEnabled: boolean;
    isFocused: boolean;
    children?: UIElement[];
    attributes?: Record<string, string>;
}

export interface WindowInfo {
    id: number;
    title: string;
    appName: string;
    isFocused: boolean;
    bounds: { x: number; y: number; width: number; height: number };
}

class MacOSHAL implements PlatformHAL {
    private native: any;

    constructor() {
        try {
            // Attempting to load native bindings
            this.native = require('../../native/iliagpt-native.node');
        } catch (e) {
            console.warn('[HAL][macOS] Native bindings not found, running in mock mode.', e);
            this.native = this.createMockNative();
        }
    }

    private createMockNative() {
        return {
            capture_screen_fast: async () => Buffer.from('Mock MacOS Screenshot'),
            start_continuous_capture: async () => ({ id: 1, active: true }),
            get_element_tree: async () => ([]),
            keyboard_press_win: async () => { }
        };
    }

    async mouseMove(x: number, y: number) { await this.native.mouseMove(x, y); }
    async mouseClick(x: number, y: number, button = 0) { await this.native.mouseClick(x, y, button); }
    async mouseDrag(fx: number, fy: number, tx: number, ty: number) { await this.native.mouseDrag(fx, fy, tx, ty); }
    async mouseScroll(x: number, y: number, dx: number, dy: number) { await this.native.mouseScroll(x, y, dx, dy); }
    async keyboardType(text: string) { await this.native.keyboardType(text); }
    async keyboardPress(key: string, mods: string[] = []) { await this.native.keyboardPress(key, mods); }
    async keyboardHotkey(keys: string[]) { await this.native.keyboardHotkey(keys); }
    async captureScreen(displayId = 0): Promise<Buffer> { return this.native.capture_screen_fast(displayId); }
    async captureRegion(x: number, y: number, w: number, h: number): Promise<Buffer> { return Buffer.from(""); } // Implemented later
    async captureWindow(windowId: number): Promise<Buffer> { return Buffer.from(""); } // Implemented later
    async getFocusedElement(): Promise<UIElement> { return this.native.getFocusedElement(); }
    async getElementTree(pid = 0): Promise<UIElement[]> { return this.native.get_element_tree(pid); }
    async getElementAtPosition(x: number, y: number): Promise<UIElement> { return this.native.getElementAtPosition(x, y); }
    async performAction(id: string, action: string) { return this.native.performAction(id, action); }
    async getActiveWindow(): Promise<WindowInfo> { throw new Error('Not implemented'); }
    async listWindows(): Promise<WindowInfo[]> { throw new Error('Not implemented'); }
    async focusWindow(id: number) { return false; }
    async closeWindow(id: number) { return false; }
    async getBatteryLevel() { return 100; }
    async getOSVersion() { return os.release(); }
}

class WindowsHAL implements PlatformHAL {
    private native: any;

    constructor() {
        try {
            this.native = require('../../native/iliagpt-native.node');
        } catch (e) {
            console.warn('[HAL][Windows] Native bindings not found, running in mock mode.', e);
            this.native = this.createMockNative();
        }
    }

    private createMockNative() {
        return {
            keyboard_press_win: async (k: string, m: string[]) => { },
            get_battery_level_win: async () => 100,
            get_os_version_win: async () => "Windows (Mock)",
            get_cpu_info_win: async () => "Mock CPU",
            get_total_memory_win: async () => 16000000000
        };
    }

    // Bindings mapping specifically to Windows C ABI
    async mouseMove(x: number, y: number) { }
    async mouseClick(x: number, y: number, button = 0) { }
    async mouseDrag(fx: number, fy: number, tx: number, ty: number) { }
    async mouseScroll(x: number, y: number, dx: number, dy: number) { }
    async keyboardType(text: string) { }
    async keyboardPress(key: string, mods: string[] = []) { await this.native.keyboard_press_win(key, mods); }
    async keyboardHotkey(keys: string[]) { await this.native.keyboard_press_win(keys[keys.length - 1], keys.slice(0, -1)); } // Basic mapping

    // Other functions mirror PlatformHAL interface but defer to rust NAPI _win variants
    async captureScreen(displayId = 0) { return Buffer.from(''); }
    async captureRegion(x: number, y: number, w: number, h: number) { return Buffer.from(''); }
    async captureWindow(windowId: number) { return Buffer.from(''); }
    async getFocusedElement() { throw new Error('Not implemented'); }
    async getElementTree(pid = 0) { return []; }
    async getElementAtPosition(x: number, y: number) { throw new Error('Not implemented'); }
    async performAction(id: string, action: string) { return false; }
    async getActiveWindow() { throw new Error('Not implemented'); }
    async listWindows() { return []; }
    async focusWindow(id: number) { return false; }
    async closeWindow(id: number) { return false; }

    async getBatteryLevel() { return this.native.get_battery_level_win(); }
    async getOSVersion() { return this.native.get_os_version_win(); }
}

class LinuxHAL implements PlatformHAL {
    // Linux implementation using xdotool, scrot / at-spi2
    async mouseMove(x: number, y: number) { }
    async mouseClick(x: number, y: number, button = 0) { }
    async mouseDrag(fx: number, fy: number, tx: number, ty: number) { }
    async mouseScroll(x: number, y: number, dx: number, dy: number) { }
    async keyboardType(text: string) { }
    async keyboardPress(key: string, mods: string[] = []) { }
    async keyboardHotkey(keys: string[]) { }
    async captureScreen(displayId = 0) { return Buffer.from(''); }
    async captureRegion(x: number, y: number, w: number, h: number) { return Buffer.from(''); }
    async captureWindow(windowId: number) { return Buffer.from(''); }
    async getFocusedElement() { throw new Error('Not implemented'); }
    async getElementTree(pid = 0) { return []; }
    async getElementAtPosition(x: number, y: number) { throw new Error('Not implemented'); }
    async performAction(id: string, action: string) { return false; }
    async getActiveWindow() { throw new Error('Not implemented'); }
    async listWindows() { return []; }
    async focusWindow(id: number) { return false; }
    async closeWindow(id: number) { return false; }
    async getBatteryLevel() { return 100; }
    async getOSVersion() { return os.release(); }
}

export function createHAL(): PlatformHAL {
    const platform = os.platform();
    console.log(`[HAL] Initializing PlatformHAL for architecture: ${platform}`);
    switch (platform) {
        case 'darwin': return new MacOSHAL();
        case 'win32': return new WindowsHAL();
        case 'linux': return new LinuxHAL();
        default:
            console.error(`[HAL] Platform ${platform} unsupported, attempting fallback via Linux wrapper`);
            return new LinuxHAL();
    }
}

export const hal = createHAL();
