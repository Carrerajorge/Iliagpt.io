import pino from 'pino';
import { WebSocket, WebSocketServer } from 'ws';

const logger = pino({ name: 'MeshCommunication', level: process.env.LOG_LEVEL ?? 'info' });

export interface MessageEnvelope {
  from: string;
  to: string;
  type: string;
  payload: unknown;
  correlationId: string;
  timestamp: number;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 5_000;
const RETRY_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = 500;
const WS_RECONNECT_DELAY_MS = 2_000;
const PING_INTERVAL_MS = 20_000;

export class MeshCommunication {
  public readonly nodeId: string;

  private connections: Map<string, WebSocket> = new Map();
  private nodeUrls: Map<string, string> = new Map(); // nodeId -> base URL
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private messageHandlers: Map<string, (message: MessageEnvelope) => void | Promise<void>> = new Map();
  private wss: WebSocketServer | null = null;
  private pingTimers: Map<string, ReturnType<typeof setInterval>> = new Map();

  constructor(nodeId: string) {
    this.nodeId = nodeId;
  }

  startServer(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.wss = new WebSocketServer({ port });

      this.wss.on('listening', () => {
        logger.info({ nodeId: this.nodeId, port }, 'MeshCommunication WebSocket server listening');
        resolve();
      });

      this.wss.on('error', (err) => {
        logger.error({ err, port }, 'WebSocket server error');
        reject(err);
      });

      this.wss.on('connection', (ws: WebSocket, req) => {
        const remoteAddr = req.socket.remoteAddress ?? 'unknown';
        logger.info({ nodeId: this.nodeId, remoteAddr }, 'Incoming WebSocket connection');

        ws.on('message', (rawData) => {
          try {
            const message = JSON.parse(rawData.toString()) as MessageEnvelope;
            this.handleMessage(message);
          } catch (err) {
            logger.warn({ err, remoteAddr }, 'Failed to parse incoming WebSocket message');
          }
        });

        ws.on('close', () => {
          logger.debug({ remoteAddr }, 'Incoming WebSocket connection closed');
        });

        ws.on('error', (err) => {
          logger.warn({ err, remoteAddr }, 'Incoming WebSocket connection error');
        });
      });
    });
  }

  async connect(nodeUrl: string, nodeId?: string): Promise<void> {
    const wsUrl = nodeUrl.replace(/^http/, 'ws') + '/mesh/ws';
    const targetId = nodeId ?? nodeUrl;

    if (this.connections.has(targetId)) {
      const existing = this.connections.get(targetId)!;
      if (existing.readyState === WebSocket.OPEN) {
        logger.debug({ targetId, wsUrl }, 'Already connected to node');
        return;
      }
      this.disconnect(targetId);
    }

    this.nodeUrls.set(targetId, nodeUrl);

    return new Promise((resolve, reject) => {
      logger.info({ targetId, wsUrl }, 'Connecting to mesh node via WebSocket');

      let ws: WebSocket;
      try {
        ws = new WebSocket(wsUrl);
      } catch (err) {
        logger.warn({ targetId, wsUrl, err }, 'WebSocket constructor failed, will use HTTP fallback');
        reject(err);
        return;
      }

      const connectTimeout = setTimeout(() => {
        ws.terminate();
        reject(new Error(`WebSocket connection to ${wsUrl} timed out`));
      }, 5_000);

      ws.on('open', () => {
        clearTimeout(connectTimeout);
        this.connections.set(targetId, ws);
        logger.info({ targetId, wsUrl }, 'WebSocket connection established');

        // Start ping to keep connection alive
        const pingTimer = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.ping();
          } else {
            clearInterval(pingTimer);
          }
        }, PING_INTERVAL_MS);
        this.pingTimers.set(targetId, pingTimer);

        resolve();
      });

      ws.on('message', (rawData) => {
        try {
          const message = JSON.parse(rawData.toString()) as MessageEnvelope;
          this.handleMessage(message);
        } catch (err) {
          logger.warn({ err, targetId }, 'Failed to parse WebSocket message from node');
        }
      });

      ws.on('close', (code, reason) => {
        logger.warn({ targetId, code, reason: reason.toString() }, 'WebSocket connection closed');
        this.connections.delete(targetId);
        const pingTimer = this.pingTimers.get(targetId);
        if (pingTimer) {
          clearInterval(pingTimer);
          this.pingTimers.delete(targetId);
        }

        // Reject any pending requests for this node
        for (const [correlationId, pending] of this.pendingRequests.entries()) {
          // We can't easily map correlationId to nodeId here, so we leave them to timeout
          void correlationId;
          void pending;
        }

        // Schedule reconnect
        setTimeout(() => {
          if (!this.connections.has(targetId)) {
            logger.info({ targetId }, 'Attempting WebSocket reconnection');
            this.connect(nodeUrl, nodeId).catch((err) => {
              logger.warn({ targetId, err }, 'Reconnection attempt failed');
            });
          }
        }, WS_RECONNECT_DELAY_MS);
      });

      ws.on('error', (err) => {
        clearTimeout(connectTimeout);
        logger.warn({ targetId, wsUrl, err }, 'WebSocket connection error');
        reject(err);
      });
    });
  }

  disconnect(nodeId: string): void {
    const ws = this.connections.get(nodeId);
    if (ws) {
      ws.terminate();
      this.connections.delete(nodeId);
      logger.info({ nodeId }, 'Disconnected from mesh node');
    }

    const pingTimer = this.pingTimers.get(nodeId);
    if (pingTimer) {
      clearInterval(pingTimer);
      this.pingTimers.delete(nodeId);
    }
  }

  async send(nodeId: string, message: MessageEnvelope): Promise<void> {
    const ws = this.connections.get(nodeId);

    if (ws && ws.readyState === WebSocket.OPEN) {
      const serialized = JSON.stringify(message);
      ws.send(serialized);
      logger.debug({ from: message.from, to: message.to, type: message.type, correlationId: message.correlationId }, 'Message sent via WebSocket');
      return;
    }

    // Fallback to HTTP
    logger.debug({ nodeId, type: message.type }, 'WebSocket not available, falling back to HTTP');
    await this.sendHttp(nodeId, message);
  }

  private async sendHttp(nodeId: string, message: MessageEnvelope, attempt = 1): Promise<void> {
    const nodeUrl = this.nodeUrls.get(nodeId);
    if (!nodeUrl) {
      throw new Error(`No URL known for node: ${nodeId}`);
    }

    const url = `${nodeUrl}/mesh/message`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message),
        signal: AbortSignal.timeout(DEFAULT_REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        throw new Error(`HTTP send failed with status ${response.status}`);
      }

      logger.debug({ nodeId, type: message.type, correlationId: message.correlationId }, 'Message sent via HTTP fallback');
    } catch (err) {
      if (attempt < RETRY_ATTEMPTS) {
        logger.warn({ nodeId, attempt, err }, 'HTTP send failed, retrying');
        await new Promise((resolve) => setTimeout(resolve, RETRY_BACKOFF_MS * attempt));
        return this.sendHttp(nodeId, message, attempt + 1);
      }

      logger.error({ nodeId, attempt, err }, 'HTTP send exhausted retries');
      throw err;
    }
  }

  async request(nodeId: string, message: MessageEnvelope, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(message.correlationId);
        reject(new Error(`Request to ${nodeId} timed out after ${timeoutMs}ms (correlationId: ${message.correlationId})`));
      }, timeoutMs);

      this.pendingRequests.set(message.correlationId, { resolve, reject, timeout });

      this.send(nodeId, message).catch((err) => {
        clearTimeout(timeout);
        this.pendingRequests.delete(message.correlationId);
        reject(err);
      });

      logger.debug(
        { nodeId, type: message.type, correlationId: message.correlationId, timeoutMs },
        'Request sent, awaiting response',
      );
    });
  }

  async broadcast(message: MessageEnvelope, nodeIds: string[]): Promise<void> {
    const sendPromises = nodeIds
      .filter((id) => id !== this.nodeId)
      .map(async (nodeId) => {
        try {
          await this.send(nodeId, { ...message, to: nodeId });
        } catch (err) {
          logger.warn({ nodeId, type: message.type, err }, 'Broadcast to node failed');
        }
      });

    await Promise.allSettled(sendPromises);
    logger.info({ type: message.type, targets: nodeIds.length, correlationId: message.correlationId }, 'Broadcast complete');
  }

  handleMessage(message: MessageEnvelope): void {
    logger.debug(
      { from: message.from, to: message.to, type: message.type, correlationId: message.correlationId },
      'Message received',
    );

    // Check if this is a response to a pending request
    const pending = this.pendingRequests.get(message.correlationId);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(message.correlationId);

      if (message.type === 'ERROR') {
        const errorPayload = message.payload as { error?: string };
        pending.reject(new Error(errorPayload?.error ?? 'Remote node returned error'));
      } else {
        pending.resolve(message.payload);
      }
      return;
    }

    // Route to registered handler
    const handler = this.messageHandlers.get(message.type) ?? this.messageHandlers.get('*');
    if (handler) {
      Promise.resolve(handler(message)).catch((err) => {
        logger.error({ err, type: message.type, correlationId: message.correlationId }, 'Message handler threw error');
      });
    } else {
      logger.warn({ type: message.type, from: message.from }, 'No handler registered for message type');
    }
  }

  registerHandler(messageType: string, handler: (message: MessageEnvelope) => void | Promise<void>): void {
    this.messageHandlers.set(messageType, handler);
    logger.debug({ messageType }, 'Message handler registered');
  }

  createEnvelope(to: string, type: string, payload: unknown): MessageEnvelope {
    return {
      from: this.nodeId,
      to,
      type,
      payload,
      correlationId: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      timestamp: Date.now(),
    };
  }

  getConnectionStatus(): { nodeId: string; connected: boolean; state: string }[] {
    return Array.from(this.connections.entries()).map(([nodeId, ws]) => ({
      nodeId,
      connected: ws.readyState === WebSocket.OPEN,
      state: ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'][ws.readyState] ?? 'UNKNOWN',
    }));
  }

  async shutdown(): Promise<void> {
    logger.info({ nodeId: this.nodeId }, 'Shutting down MeshCommunication');

    // Clear all pending requests
    for (const [correlationId, pending] of this.pendingRequests.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('MeshCommunication shutting down'));
      this.pendingRequests.delete(correlationId);
    }

    // Close all outgoing connections
    for (const nodeId of Array.from(this.connections.keys())) {
      this.disconnect(nodeId);
    }

    // Close WebSocket server
    if (this.wss) {
      await new Promise<void>((resolve) => {
        this.wss!.close(() => {
          logger.info({ nodeId: this.nodeId }, 'WebSocket server closed');
          resolve();
        });
      });
    }
  }
}
