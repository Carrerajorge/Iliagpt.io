import * as os from 'os';
import * as net from 'net';
import { randomUUID } from 'crypto';

export interface UIElement {
    id: string;
    role: string;
    title?: string;
    value?: string;
    position: { x: number; y: number };
    size: { x: number; y: number; width: number; height: number };
}

export interface WindowInfo {
    id: number;
    title: string;
    appName: string;
    isFocused: boolean;
    bounds: { x: number; y: number; width: number; height: number };
}

export interface ClickOptions {
    button?: 'left' | 'right' | 'middle';
    doubleClick?: boolean;
}

const IPC_PATH = os.platform() === 'win32'
    ? '\\\\.\\pipe\\iliagpt-ipc'
    : '/var/run/iliagpt.sock';

export class DesktopController {
    public readonly platform = os.platform();
    private client: net.Socket | null = null;
    private responseHandlers: Map<string, { resolve: (val: any) => void; reject: (err: any) => void }> = new Map();
    private isConnected = false;

    constructor() {
        this.connectIPC();
    }

    private connectIPC(retryCount = 0) {
        this.client = net.createConnection(IPC_PATH);

        this.client.on('connect', () => {
            console.log(`[DesktopController] Conectado al Daemon IPC en ${IPC_PATH}`);
            this.isConnected = true;
            retryCount = 0; // Reset backoff

            // Phase 0: RPC Heartbeat (Ping/pong) every 5s
            const pingInterval = setInterval(() => {
                const c = this.client;
                if (this.isConnected && c && !c.destroyed) {
                    c.write(JSON.stringify({ id: 'PING', action: 'ping' }) + '\n');
                } else {
                    clearInterval(pingInterval);
                }
            }, 5000);

            // Setup cleanup for ping
            this.client.on('close', () => clearInterval(pingInterval));
        });

        this.client.on('data', (data) => {
            try {
                const msgs = data.toString().split('\n').filter(s => s.trim().length > 0);
                for (const msg of msgs) {
                    const parsed = JSON.parse(msg);
                    if (parsed.id === 'PONG') {
                        // Heartbeat successful
                        continue;
                    }
                    if (parsed.id && this.responseHandlers.has(parsed.id)) {
                        const { resolve, reject } = this.responseHandlers.get(parsed.id)!;
                        this.responseHandlers.delete(parsed.id);
                        if (parsed.success) resolve(parsed.payload);
                        else reject(new Error(parsed.error || 'Daemon Payload Error'));
                    }
                }
            } catch (e: any) {
                console.warn('[DesktopController] IPC parsing err:', e.message);
            }
        });

        this.client.on('error', (err: NodeJS.ErrnoException) => {
            if (err.code !== 'ENOENT' && err.code !== 'ECONNREFUSED') {
                console.error('[DesktopController] Daemon IPC error:', err.message);
            }
            this.isConnected = false;

            // Phase 0: RPC Auto-reconnect with exponential backoff (max 30s delay)
            const delay = Math.min(1000 * Math.pow(2, retryCount), 30000);
            setTimeout(() => this.connectIPC(retryCount + 1), delay);
        });

        this.client.on('close', () => {
            this.isConnected = false;
        });
    }

    private async callDaemon(action: string, payload: any = {}): Promise<any> {
        if (!this.isConnected || !this.client) {
            throw new Error(`[DesktopController] IPC Daemon Socket cerrado en ${IPC_PATH}`);
        }

        return new Promise((resolve, reject) => {
            const reqId = randomUUID();

            // Setup timeout
            const timeout = setTimeout(() => {
                if (this.responseHandlers.has(reqId)) {
                    this.responseHandlers.delete(reqId);
                    reject(new Error(`[DesktopController] Daemon Timeout (action: ${action})`));
                }
            }, 10000);

            this.responseHandlers.set(reqId, {
                resolve: (val) => { clearTimeout(timeout); resolve(val); },
                reject: (err) => { clearTimeout(timeout); reject(err); }
            });

            const buf = JSON.stringify({ id: reqId, action, payload }) + '\n';
            this.client!.write(buf);
        });
    }

    async click(x: number, y: number, opts?: ClickOptions): Promise<void> {
        await this.callDaemon("mouse_click", { x, y, button: opts?.button === 'right' ? 2 : 1 });
    }

    async type(text: string): Promise<void> {
        await this.callDaemon("keyboard_type", { text });
    }

    async hotkey(...keys: string[]): Promise<void> {
        await this.callDaemon("keyboard_press", { keyName: keys.join('+') });
    }

    async screenshot(): Promise<Buffer> {
        const b64 = await this.callDaemon("capture_screen");
        return b64 ? Buffer.from(b64, 'base64') : Buffer.from('');
    }

    async getFocusedElement(): Promise<UIElement> {
        return await this.callDaemon("get_focused_element");
    }

    async getElementTree(): Promise<any> {
        return await this.callDaemon("get_element_tree");
    }

    async listWindows(): Promise<WindowInfo[]> {
        return await this.callDaemon("list_windows");
    }

    async executeSystemScript(script: string): Promise<string> {
        return await this.callDaemon("execute_applescript", { script });
    }
}

export const nativeDesktop = new DesktopController();
