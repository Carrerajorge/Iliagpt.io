import { WebSocket, WebSocketServer } from 'ws';
import { IncomingMessage } from 'http';
import { randomUUID } from 'crypto';
import { RPCMessage, serialize, deserialize } from './protocol';

export class RPCServer {
    private wss: WebSocketServer;
    private clients: Set<WebSocket> = new Set();

    // T01-002: RPC Server Heartbeat Ping/Pong
    private clientAlive: Map<WebSocket, boolean> = new Map();
    private heartbeatTimer!: NodeJS.Timeout;

    // T01-005: RPC Multiplexing
    private channelHandlers: Map<string, Map<string, (params: any) => Promise<any>>> = new Map();
    private globalHandlers = new Map<string, (params: any) => Promise<any>>();

    // T01-003: RPC Streaming Channel
    private streamHandlers = new Map<string, (params: any, callback: (chunk: any, done: boolean) => void) => Promise<void>>();

    constructor(port: number) {
        this.wss = new WebSocketServer({ port });

        this.wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
            this.clients.add(ws);
            this.clientAlive.set(ws, true);

            ws.on('pong', () => {
                this.clientAlive.set(ws, true);
            });

            ws.on('message', async (data: Buffer) => {
                try {
                    const msg = deserialize(data);
                    await this.handleMessage(ws, msg);
                } catch (e) {
                    console.error('[RPCServer] Error handling message:', e);
                }
            });

            ws.on('close', () => {
                this.clients.delete(ws);
                this.clientAlive.delete(ws);
            });
        });

        this.startHeartbeat();
    }

    private startHeartbeat() {
        this.heartbeatTimer = setInterval(() => {
            for (const ws of this.clients) {
                if (this.clientAlive.get(ws) === false) {
                    console.log('[RPCServer] Client unresponsive, terminating');
                    ws.terminate();
                    this.clients.delete(ws);
                    this.clientAlive.delete(ws);
                    continue;
                }
                this.clientAlive.set(ws, false);
                ws.ping();
            }
        }, 5000);
    }

    public registerChannelHandler(channel: string, method: string, handler: (params: any) => Promise<any>) {
        if (!this.channelHandlers.has(channel)) {
            this.channelHandlers.set(channel, new Map());
        }
        this.channelHandlers.get(channel)!.set(method, handler);
    }

    public registerGlobalHandler(method: string, handler: (params: any) => Promise<any>) {
        this.globalHandlers.set(method, handler);
    }

    public registerStreamHandler(method: string, handler: (params: any, callback: (chunk: any, done: boolean) => void) => Promise<void>) {
        this.streamHandlers.set(method, handler);
    }

    private async handleMessage(ws: WebSocket, msg: RPCMessage) {
        if (msg.type === 'stream') {
            const handler = this.streamHandlers.get(msg.method);
            if (!handler) {
                ws.send(serialize({
                    id: msg.id, type: 'response', method: msg.method,
                    error: { code: 404, message: `Stream ${msg.method} not found` },
                    timestamp: Date.now()
                }));
                return;
            }

            let sequence = 0;
            const streamCallback = (chunk: any, done: boolean) => {
                const streamMsg: Omit<RPCMessage, 'signature'> = {
                    id: msg.id,
                    type: 'stream',
                    method: msg.method,
                    result: { sequence: sequence++, chunk, done },
                    timestamp: Date.now()
                };
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(serialize(streamMsg as RPCMessage));
                }
            };

            await handler(msg.params, streamCallback);
            return;
        }

        if (msg.type === 'request') {
            try {
                let handler;
                if (msg.channel) {
                    const channelHandlers = this.channelHandlers.get(msg.channel);
                    handler = channelHandlers?.get(msg.method);
                }

                if (!handler) {
                    handler = this.globalHandlers.get(msg.method);
                }

                if (!handler) {
                    throw new Error(`Handler for method ${msg.method} on channel ${msg.channel || 'global'} not found`);
                }

                const result = await handler(msg.params);
                ws.send(serialize({
                    id: msg.id,
                    type: 'response',
                    method: msg.method,
                    result,
                    timestamp: Date.now()
                }));
            } catch (err: any) {
                ws.send(serialize({
                    id: msg.id,
                    type: 'response',
                    method: msg.method,
                    error: { code: 500, message: err.message },
                    timestamp: Date.now()
                }));
            }
        }
    }

    // T01-004: RPC Backpressure
    public broadcast(method: string, params: any, opts?: { maxBufferedAmount?: number; dropPolicy?: 'drop' | 'pause' }) {
        const maxBuffered = opts?.maxBufferedAmount ?? 1024 * 1024; // 1MB default
        const msg = serialize({
            id: randomUUID(), type: 'event', method, params, timestamp: Date.now()
        });

        for (const client of this.clients) {
            if (client.readyState !== WebSocket.OPEN) continue;

            if (client.bufferedAmount > maxBuffered) {
                if (opts?.dropPolicy === 'pause') {
                    // Skip this client until buffer drains
                    continue;
                }
                // Default: drop frame for this client
                console.warn(`[RPCServer] Dropping frame for client (buffered: ${client.bufferedAmount})`);
                continue;
            }

            client.send(msg);
        }
    }

    public stop() {
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        this.wss.close();
    }
}
