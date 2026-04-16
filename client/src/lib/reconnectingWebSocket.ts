/**
 * Reconnecting WebSocket Client
 * Automatically reconnects with exponential backoff
 */

type MessageHandler = (data: any) => void;
type EventHandler = () => void;

interface ReconnectingWebSocketOptions {
    maxReconnectAttempts?: number;
    initialReconnectDelay?: number;
    maxReconnectDelay?: number;
    reconnectDecay?: number;
    heartbeatInterval?: number;
    messageQueueSize?: number;
}

export class ReconnectingWebSocket {
    private url: string;
    private ws: WebSocket | null = null;
    private options: Required<ReconnectingWebSocketOptions>;

    private reconnectAttempts = 0;
    private reconnectTimer: NodeJS.Timeout | null = null;
    private heartbeatTimer: NodeJS.Timeout | null = null;
    private lastHeartbeat: number = 0;

    private messageQueue: any[] = [];
    private isConnecting = false;
    private forcedClose = false;

    private messageHandlers: Set<MessageHandler> = new Set();
    private onOpenHandlers: Set<EventHandler> = new Set();
    private onCloseHandlers: Set<EventHandler> = new Set();
    private onErrorHandlers: Set<(error: Event) => void> = new Set();
    private onReconnectHandlers: Set<(attempt: number) => void> = new Set();

    constructor(url: string, options: ReconnectingWebSocketOptions = {}) {
        this.url = url;
        this.options = {
            maxReconnectAttempts: options.maxReconnectAttempts ?? 10,
            initialReconnectDelay: options.initialReconnectDelay ?? 1000,
            maxReconnectDelay: options.maxReconnectDelay ?? 30000,
            reconnectDecay: options.reconnectDecay ?? 1.5,
            heartbeatInterval: options.heartbeatInterval ?? 30000,
            messageQueueSize: options.messageQueueSize ?? 100,
        };
    }

    /**
     * Connect to WebSocket server
     */
    connect(): void {
        if (this.isConnecting || (this.ws && this.ws.readyState === WebSocket.OPEN)) {
            return;
        }

        this.isConnecting = true;
        this.forcedClose = false;

        try {
            this.ws = new WebSocket(this.url);
            this.setupEventHandlers();
        } catch (error) {
            this.isConnecting = false;
            this.handleError(error as Event);
        }
    }

    /**
     * Disconnect and don't reconnect
     */
    disconnect(): void {
        this.forcedClose = true;
        this.clearTimers();

        if (this.ws) {
            this.ws.close(1000, 'User disconnected');
            this.ws = null;
        }

        this.messageQueue = [];
    }

    /**
     * Send message (queues if not connected)
     */
    send(data: any): boolean {
        const message = typeof data === 'string' ? data : JSON.stringify(data);

        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(message);
            return true;
        }

        // Queue message for when connection is restored
        if (this.messageQueue.length < this.options.messageQueueSize) {
            this.messageQueue.push(message);
        }

        // Try to connect if not already
        this.connect();
        return false;
    }

    /**
     * Get connection state
     */
    get readyState(): number {
        return this.ws?.readyState ?? WebSocket.CLOSED;
    }

    get isConnected(): boolean {
        return this.ws?.readyState === WebSocket.OPEN;
    }

    /**
     * Add message handler
     */
    onMessage(handler: MessageHandler): () => void {
        this.messageHandlers.add(handler);
        return () => this.messageHandlers.delete(handler);
    }

    /**
     * Add open handler
     */
    onOpen(handler: EventHandler): () => void {
        this.onOpenHandlers.add(handler);
        return () => this.onOpenHandlers.delete(handler);
    }

    /**
     * Add close handler
     */
    onClose(handler: EventHandler): () => void {
        this.onCloseHandlers.add(handler);
        return () => this.onCloseHandlers.delete(handler);
    }

    /**
     * Add error handler
     */
    onError(handler: (error: Event) => void): () => void {
        this.onErrorHandlers.add(handler);
        return () => this.onErrorHandlers.delete(handler);
    }

    /**
     * Add reconnect handler
     */
    onReconnect(handler: (attempt: number) => void): () => void {
        this.onReconnectHandlers.add(handler);
        return () => this.onReconnectHandlers.delete(handler);
    }

    private setupEventHandlers(): void {
        if (!this.ws) return;

        this.ws.onopen = () => {
            this.isConnecting = false;
            this.reconnectAttempts = 0;

            // Start heartbeat
            this.startHeartbeat();

            // Flush queued messages
            this.flushQueue();

            // Notify handlers
            this.onOpenHandlers.forEach(handler => handler());
        };

        this.ws.onclose = (event) => {
            this.isConnecting = false;
            this.stopHeartbeat();

            this.onCloseHandlers.forEach(handler => handler());

            // Reconnect unless forced close or max attempts
            if (!this.forcedClose) {
                this.scheduleReconnect();
            }
        };

        this.ws.onerror = (error) => {
            this.handleError(error);
        };

        this.ws.onmessage = (event) => {
            this.lastHeartbeat = Date.now();

            try {
                const data = JSON.parse(event.data);

                // Handle pong
                if (data.type === 'pong') return;

                this.messageHandlers.forEach(handler => handler(data));
            } catch {
                // Non-JSON message
                this.messageHandlers.forEach(handler => handler(event.data));
            }
        };
    }

    private handleError(error: Event): void {
        this.onErrorHandlers.forEach(handler => handler(error));
    }

    private scheduleReconnect(): void {
        if (this.reconnectAttempts >= this.options.maxReconnectAttempts) {
            console.error('Max reconnect attempts reached');
            return;
        }

        this.reconnectAttempts++;

        // Calculate delay with exponential backoff
        const delay = Math.min(
            this.options.initialReconnectDelay * Math.pow(this.options.reconnectDecay, this.reconnectAttempts - 1),
            this.options.maxReconnectDelay
        );

        console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

        this.onReconnectHandlers.forEach(handler => handler(this.reconnectAttempts));

        this.reconnectTimer = setTimeout(() => {
            this.connect();
        }, delay);
    }

    private startHeartbeat(): void {
        this.stopHeartbeat();

        this.heartbeatTimer = setInterval(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                // Send ping
                this.ws.send(JSON.stringify({ type: 'ping' }));

                // Check if we've received a response recently
                const timeSinceLastHeartbeat = Date.now() - this.lastHeartbeat;
                if (this.lastHeartbeat > 0 && timeSinceLastHeartbeat > this.options.heartbeatInterval * 2) {
                    console.warn('Heartbeat timeout, reconnecting...');
                    this.ws.close();
                }
            }
        }, this.options.heartbeatInterval);
    }

    private stopHeartbeat(): void {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }

    private flushQueue(): void {
        while (this.messageQueue.length > 0 && this.ws?.readyState === WebSocket.OPEN) {
            const message = this.messageQueue.shift();
            if (message) {
                this.ws.send(message);
            }
        }
    }

    private clearTimers(): void {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        this.stopHeartbeat();
    }
}

/**
 * Create a singleton WebSocket instance
 */
let wsInstance: ReconnectingWebSocket | null = null;

export function getWebSocket(): ReconnectingWebSocket {
    if (!wsInstance) {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws`;
        wsInstance = new ReconnectingWebSocket(wsUrl);
        wsInstance.connect();
    }
    return wsInstance;
}

/**
 * React hook for WebSocket
 */
import { useEffect, useState, useCallback } from 'react';

export function useWebSocket() {
    const [isConnected, setIsConnected] = useState(false);
    const [lastMessage, setLastMessage] = useState<any>(null);
    const [reconnectAttempt, setReconnectAttempt] = useState(0);

    const ws = getWebSocket();

    useEffect(() => {
        const removeOpen = ws.onOpen(() => setIsConnected(true));
        const removeClose = ws.onClose(() => setIsConnected(false));
        const removeMessage = ws.onMessage((data) => setLastMessage(data));
        const removeReconnect = ws.onReconnect((attempt) => setReconnectAttempt(attempt));

        setIsConnected(ws.isConnected);

        return () => {
            removeOpen();
            removeClose();
            removeMessage();
            removeReconnect();
        };
    }, []);

    const send = useCallback((data: any) => ws.send(data), []);

    return {
        isConnected,
        lastMessage,
        reconnectAttempt,
        send,
    };
}
