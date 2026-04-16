import { WebSocket } from 'ws';
import { RPCMessage, serialize, deserialize } from './protocol';

export class RPCClient {
    private ws!: WebSocket;
    private url: string;

    private reconnectAttempts = 0;
    private maxReconnectAttempts = 10;
    private baseDelay = 1000;
    private maxDelay = 30000;
    private isReconnecting = false;
    private messageBuffer: Buffer[] = [];

    // Callbacks
    private messageHandlers = new Map<string, (result: any) => void>();
    private errorHandlers = new Map<string, (error: any) => void>();

    constructor(url: string) {
        this.url = url;
    }

    public connect() {
        this.ws = new WebSocket(this.url);
        this.ws.on('open', () => {
            console.log(`[RPCClient] Connected to ${this.url}`);
            this.isReconnecting = false;
            this.reconnectAttempts = 0;
            this.setupMessageHandler();
            this.setupReconnect();
            this.flushBuffer();
        });
    }

    private setupMessageHandler() {
        this.ws.on('message', (data: any) => {
            try {
                const msg = deserialize(data);
                if ((msg.type === 'response' || msg.type === 'error') && msg.id) {
                    if (msg.error) {
                        const errorHandler = this.errorHandlers.get(msg.id);
                        if (errorHandler) {
                            errorHandler(msg.error);
                            this.errorHandlers.delete(msg.id);
                            this.messageHandlers.delete(msg.id);
                        }
                    } else {
                        const handler = this.messageHandlers.get(msg.id);
                        if (handler) {
                            handler(msg.result);
                            this.messageHandlers.delete(msg.id);
                            this.errorHandlers.delete(msg.id);
                        }
                    }
                }
            } catch (e) {
                console.error('[RPCClient] Error parsing message:', e);
            }
        });
    }

    private setupReconnect() {
        this.ws.on('close', (code: number) => {
            if (code === 1000) return; // Normal close
            console.warn(`[RPCClient] Connection lost (code ${code}), reconnecting...`);
            this.scheduleReconnect();
        });

        this.ws.on('error', (err: Error) => {
            console.error(`[RPCClient] WebSocket error:`, err.message);
        });
    }

    private scheduleReconnect() {
        if (this.isReconnecting || this.reconnectAttempts >= this.maxReconnectAttempts) return;
        this.isReconnecting = true;

        const delay = Math.min(this.baseDelay * Math.pow(2, this.reconnectAttempts), this.maxDelay);
        const jitter = delay * (0.5 + Math.random() * 0.5);

        setTimeout(() => {
            this.reconnectAttempts++;
            console.log(`[RPCClient] Reconnect attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);

            const newWs = new WebSocket(this.url);
            newWs.on('open', () => {
                this.ws = newWs;
                this.isReconnecting = false;
                this.reconnectAttempts = 0;
                this.setupMessageHandler();
                this.setupReconnect();
                this.flushBuffer();
                console.log(`[RPCClient] Reconnected successfully`);
            });
            newWs.on('error', () => {
                this.isReconnecting = false;
                this.scheduleReconnect();
            });
        }, jitter);
    }

    private flushBuffer() {
        while (this.messageBuffer.length > 0) {
            const msg = this.messageBuffer.shift()!;
            if (this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(msg);
            }
        }
    }

    public async request(method: string, params: any, channel?: 'control' | 'vision' | 'telemetry'): Promise<any> {
        return new Promise((resolve, reject) => {
            const { randomUUID } = require('crypto');
            const id = randomUUID();
            const msg: RPCMessage = {
                id,
                type: 'request',
                method,
                channel,
                params,
                timestamp: Date.now()
            };

            this.messageHandlers.set(id, resolve);
            this.errorHandlers.set(id, reject);

            const serialized = serialize(msg);
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(serialized);
            } else {
                this.messageBuffer.push(Buffer.isBuffer(serialized) ? serialized : Buffer.from(serialized));
            }
        });
    }
}
