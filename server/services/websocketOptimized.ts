/**
 * WebSocket Optimization Service - ILIAGPT PRO 3.0
 * 
 * Enhanced WebSocket with compression, batching,
 * reconnection, and multiplexing.
 */

// ============== Types ==============

export interface WSConfig {
    url: string;
    reconnectAttempts?: number;
    reconnectDelay?: number;
    heartbeatInterval?: number;
    batchInterval?: number;
    maxBatchSize?: number;
    compression?: boolean;
    debug?: boolean;
}

export interface WSMessage {
    id: string;
    type: string;
    channel: string;
    payload: any;
    timestamp: number;
    compressed?: boolean;
}

export interface WSChannel {
    name: string;
    handlers: Set<(msg: WSMessage) => void>;
    subscribed: boolean;
}

export type WSState = "connecting" | "connected" | "disconnected" | "reconnecting";

export interface WSStats {
    state: WSState;
    messagesSent: number;
    messagesReceived: number;
    bytesSent: number;
    bytesReceived: number;
    reconnectCount: number;
    latency: number;
    compressionRatio: number;
}

// ============== WebSocket Service ==============

export class OptimizedWebSocket {
    private socket: WebSocket | null = null;
    private config: Required<WSConfig>;
    private state: WSState = "disconnected";
    private channels: Map<string, WSChannel> = new Map();
    private messageQueue: WSMessage[] = [];
    private batchTimeout: NodeJS.Timeout | null = null;
    private heartbeatInterval: NodeJS.Timeout | null = null;
    private reconnectTimeout: NodeJS.Timeout | null = null;
    private reconnectAttempt = 0;
    private pendingAcks: Map<string, { resolve: () => void; reject: (e: Error) => void }> = new Map();

    // Stats
    private stats: WSStats = {
        state: "disconnected",
        messagesSent: 0,
        messagesReceived: 0,
        bytesSent: 0,
        bytesReceived: 0,
        reconnectCount: 0,
        latency: 0,
        compressionRatio: 1,
    };

    private stateListeners: Set<(state: WSState) => void> = new Set();
    private messageListeners: Set<(msg: WSMessage) => void> = new Set();

    constructor(config: WSConfig) {
        this.config = {
            url: config.url,
            reconnectAttempts: config.reconnectAttempts ?? 5,
            reconnectDelay: config.reconnectDelay ?? 500,
            heartbeatInterval: config.heartbeatInterval ?? 30000,
            batchInterval: config.batchInterval ?? 10,
            maxBatchSize: config.maxBatchSize ?? 50,
            compression: config.compression ?? true,
            debug: config.debug ?? false,
        };
    }

    // ======== Connection ========

    connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            if (this.socket?.readyState === WebSocket.OPEN) {
                resolve();
                return;
            }

            this.setState("connecting");

            try {
                this.socket = new WebSocket(this.config.url);

                this.socket.onopen = () => {
                    this.setState("connected");
                    this.reconnectAttempt = 0;
                    this.startHeartbeat();
                    this.resubscribeChannels();
                    resolve();
                };

                this.socket.onmessage = (event) => {
                    this.handleMessage(event.data);
                };

                this.socket.onerror = (error) => {
                    this.log("WebSocket error:", error);
                };

                this.socket.onclose = () => {
                    this.setState("disconnected");
                    this.stopHeartbeat();
                    this.attemptReconnect();
                };
            } catch (error) {
                reject(error);
            }
        });
    }

    disconnect(): void {
        this.stopHeartbeat();
        if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
        if (this.batchTimeout) clearTimeout(this.batchTimeout);

        if (this.socket) {
            this.socket.close(1000, "Client disconnect");
            this.socket = null;
        }

        this.setState("disconnected");
    }

    // ======== Messaging ========

    send(channel: string, type: string, payload: any): Promise<void> {
        return new Promise((resolve, reject) => {
            const msg: WSMessage = {
                id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                type,
                channel,
                payload,
                timestamp: Date.now(),
            };

            this.messageQueue.push(msg);
            this.pendingAcks.set(msg.id, { resolve, reject });

            // Reduced ack timeout for faster failure detection
            setTimeout(() => {
                const pending = this.pendingAcks.get(msg.id);
                if (pending) {
                    this.pendingAcks.delete(msg.id);
                    pending.reject(new Error(`Message ${msg.id} timed out`));
                }
            }, 5000);

            this.scheduleBatch();
        });
    }

    sendImmediate(channel: string, type: string, payload: any): void {
        const msg: WSMessage = {
            id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            type,
            channel,
            payload,
            timestamp: Date.now(),
        };

        this.transmit([msg]);
    }

    private scheduleBatch(): void {
        if (this.batchTimeout) return;

        if (this.messageQueue.length >= this.config.maxBatchSize) {
            this.flushBatch();
            return;
        }

        this.batchTimeout = setTimeout(() => {
            this.flushBatch();
        }, this.config.batchInterval);
    }

    private flushBatch(): void {
        if (this.batchTimeout) {
            clearTimeout(this.batchTimeout);
            this.batchTimeout = null;
        }

        if (this.messageQueue.length === 0) return;

        const batch = this.messageQueue.splice(0, this.config.maxBatchSize);
        this.transmit(batch);
    }

    private transmit(messages: WSMessage[]): void {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
            this.log("Cannot send, socket not open");
            return;
        }

        let data = JSON.stringify({ batch: messages });
        let compressed = false;

        // Simple compression (in production use pako/lz-string)
        if (this.config.compression && data.length > 1000) {
            data = this.compress(data);
            compressed = true;
        }

        this.socket.send(data);

        this.stats.messagesSent += messages.length;
        this.stats.bytesSent += data.length;

        if (compressed) {
            this.stats.compressionRatio = data.length / JSON.stringify({ batch: messages }).length;
        }

        this.log(`Sent ${messages.length} messages (${data.length} bytes)`);
    }

    private handleMessage(data: string): void {
        try {
            const decompressed = this.decompress(data);
            const parsed = JSON.parse(decompressed);

            if (parsed.batch) {
                for (const msg of parsed.batch) {
                    this.processMessage(msg);
                }
            } else if (parsed.ack) {
                const pending = this.pendingAcks.get(parsed.ack);
                if (pending) {
                    this.pendingAcks.delete(parsed.ack);
                    pending.resolve();
                }
            } else if (parsed.ping) {
                this.sendImmediate("system", "pong", { timestamp: Date.now() });
            } else {
                this.processMessage(parsed);
            }

            this.stats.messagesReceived++;
            this.stats.bytesReceived += data.length;
        } catch (error) {
            this.log("Failed to parse message:", error);
        }
    }

    private processMessage(msg: WSMessage): void {
        // Update latency
        if (msg.timestamp) {
            this.stats.latency = Date.now() - msg.timestamp;
        }

        // Notify channel handlers
        const channel = this.channels.get(msg.channel);
        if (channel) {
            for (const handler of channel.handlers) {
                try {
                    handler(msg);
                } catch (error) {
                    this.log(`Handler error for ${msg.channel}:`, error);
                }
            }
        }

        // Notify global listeners
        for (const listener of this.messageListeners) {
            listener(msg);
        }
    }

    // ======== Channels ========

    subscribe(channel: string, handler: (msg: WSMessage) => void): () => void {
        let channelData = this.channels.get(channel);

        if (!channelData) {
            channelData = {
                name: channel,
                handlers: new Set(),
                subscribed: false,
            };
            this.channels.set(channel, channelData);
        }

        channelData.handlers.add(handler);

        if (!channelData.subscribed && this.state === "connected") {
            this.sendImmediate("system", "subscribe", { channel });
            channelData.subscribed = true;
        }

        return () => {
            channelData!.handlers.delete(handler);
            if (channelData!.handlers.size === 0) {
                this.sendImmediate("system", "unsubscribe", { channel });
                this.channels.delete(channel);
            }
        };
    }

    private resubscribeChannels(): void {
        for (const [name, channel] of this.channels) {
            if (channel.handlers.size > 0) {
                this.sendImmediate("system", "subscribe", { channel: name });
                channel.subscribed = true;
            }
        }
    }

    // ======== Heartbeat ========

    private startHeartbeat(): void {
        this.heartbeatInterval = setInterval(() => {
            if (this.socket?.readyState === WebSocket.OPEN) {
                this.sendImmediate("system", "ping", { timestamp: Date.now() });
            }
        }, this.config.heartbeatInterval);
    }

    private stopHeartbeat(): void {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }

    // ======== Reconnection ========

    private attemptReconnect(): void {
        if (this.reconnectAttempt >= this.config.reconnectAttempts) {
            this.log("Max reconnect attempts reached");
            return;
        }

        this.setState("reconnecting");
        this.reconnectAttempt++;
        this.stats.reconnectCount++;

        const delay = this.config.reconnectDelay * Math.pow(2, this.reconnectAttempt - 1);
        this.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempt})`);

        this.reconnectTimeout = setTimeout(() => {
            this.connect().catch(() => {
                this.attemptReconnect();
            });
        }, delay);
    }

    // ======== Compression ========

    private compress(data: string): string {
        // Simple RLE-like compression for demo
        // In production, use pako or lz-string
        return `compressed:${btoa(data)}`;
    }

    private decompress(data: string): string {
        if (data.startsWith("compressed:")) {
            return atob(data.slice(11));
        }
        return data;
    }

    // ======== State & Events ========

    private setState(state: WSState): void {
        this.state = state;
        this.stats.state = state;

        for (const listener of this.stateListeners) {
            listener(state);
        }
    }

    onStateChange(listener: (state: WSState) => void): () => void {
        this.stateListeners.add(listener);
        return () => this.stateListeners.delete(listener);
    }

    onMessage(listener: (msg: WSMessage) => void): () => void {
        this.messageListeners.add(listener);
        return () => this.messageListeners.delete(listener);
    }

    // ======== Stats ========

    getStats(): WSStats {
        return { ...this.stats };
    }

    getState(): WSState {
        return this.state;
    }

    // ======== Debug ========

    private log(...args: any[]): void {
        if (this.config.debug) {
            console.log("[WS]", ...args);
        }
    }
}

// ============== Factory ==============

let wsInstance: OptimizedWebSocket | null = null;

export function getOptimizedWebSocket(config?: WSConfig): OptimizedWebSocket {
    if (!wsInstance && config) {
        wsInstance = new OptimizedWebSocket(config);
    }
    return wsInstance!;
}

export default OptimizedWebSocket;
