/**
 * Redis-backed SSE streaming for scalable event fan-out.
 * Enables stateless backend with session state in Redis.
 */
import { Response } from "express";
import { createClient, RedisClientType } from "redis";
import { randomUUID } from "crypto";
import { getHeartbeatManager, getConnectionStats as getHBStats } from "./connectionHeartbeat";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const SESSION_TTL = parseInt(process.env.SESSION_TTL_SECONDS || "3600", 10);
const SSE_HEARTBEAT_INTERVAL = parseFloat(process.env.SSE_HEARTBEAT_INTERVAL || "15") * 1000;
const SSE_CLIENT_TIMEOUT = parseFloat(process.env.SSE_CLIENT_TIMEOUT || "300") * 1000;
const SSE_MAX_QUEUE_SIZE = parseInt(process.env.SSE_MAX_QUEUE_SIZE || "100", 10);

interface SessionState {
  sessionId: string;
  userId?: string;
  status: "idle" | "processing" | "completed" | "error";
  taskId?: string;
  messageCount: number;
  context: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface SSEEvent {
  type: string;
  data: unknown;
  eventId?: string;
}

class RedisSSEManager {
  private static instance: RedisSSEManager | null = null;
  private pubClient: RedisClientType | null = null;
  private subClient: RedisClientType | null = null;
  private stateClient: RedisClientType | null = null;
  private initialized = false;
  private activeConnections = new Map<string, Set<Response>>();
  private heartbeatIntervals = new Map<string, NodeJS.Timeout>();
  private connectionTimeouts = new Map<Response, NodeJS.Timeout>();

  private constructor() { }

  static getInstance(): RedisSSEManager {
    if (!RedisSSEManager.instance) {
      RedisSSEManager.instance = new RedisSSEManager();
    }
    return RedisSSEManager.instance;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Skip Redis if no URL configured - operate in local-only mode
    if (!process.env.REDIS_URL) {
      console.log("[RedisSSE] No REDIS_URL configured, operating in local-only mode (no persistence)");
      return;
    }

    try {
      this.pubClient = createClient({ url: REDIS_URL });
      this.subClient = createClient({ url: REDIS_URL });
      this.stateClient = createClient({ url: REDIS_URL });

      // Add error handlers to prevent crash on connection issues
      this.pubClient.on('error', (err) => console.warn('[RedisSSE] Pub client error:', err.message));
      this.subClient.on('error', (err) => console.warn('[RedisSSE] Sub client error:', err.message));
      this.stateClient.on('error', (err) => console.warn('[RedisSSE] State client error:', err.message));

      await Promise.all([
        this.pubClient.connect(),
        this.subClient.connect(),
        this.stateClient.connect(),
      ]);

      this.initialized = true;
      console.log("[RedisSSE] Initialized with Redis at", REDIS_URL);
    } catch (error: any) {
      console.warn("[RedisSSE] Failed to initialize (non-fatal, running in local-only mode):", error.message);
      this.pubClient = null;
      this.subClient = null;
      this.stateClient = null;
      this.initialized = false;
    }
  }

  async close(): Promise<void> {
    for (const [sessionId] of this.activeConnections) {
      await this.unsubscribeSession(sessionId);
    }

    if (this.pubClient) await this.pubClient.quit();
    if (this.subClient) await this.subClient.quit();
    if (this.stateClient) await this.stateClient.quit();

    this.initialized = false;
    console.log("[RedisSSE] Closed");
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  private channelKey(sessionId: string): string {
    return `sse:events:${sessionId}`;
  }

  private sessionKey(sessionId: string): string {
    return `sse:session:${sessionId}`;
  }

  async getSession(sessionId: string): Promise<SessionState | null> {
    if (!this.stateClient) return null;
    const data = await this.stateClient.get(this.sessionKey(sessionId));
    return data ? JSON.parse(data) : null;
  }

  async setSession(sessionId: string, state: Partial<SessionState>): Promise<void> {
    if (!this.stateClient) return;

    const existing = await this.getSession(sessionId);
    const now = new Date().toISOString();

    const newState: SessionState = {
      sessionId,
      status: "idle",
      messageCount: 0,
      context: {},
      createdAt: now,
      ...existing,
      ...state,
      updatedAt: now,
    };

    await this.stateClient.setEx(
      this.sessionKey(sessionId),
      SESSION_TTL,
      JSON.stringify(newState)
    );
  }

  async touchSession(sessionId: string): Promise<void> {
    if (!this.stateClient) return;
    await this.stateClient.expire(this.sessionKey(sessionId), SESSION_TTL);
  }

  async deleteSession(sessionId: string): Promise<void> {
    if (!this.stateClient) return;
    await this.stateClient.del(this.sessionKey(sessionId));
  }

  async publishEvent(sessionId: string, event: SSEEvent): Promise<number> {
    if (!this.pubClient) return 0;

    const message = JSON.stringify(event);
    return await this.pubClient.publish(this.channelKey(sessionId), message);
  }

  async publishTrace(sessionId: string, traceData: unknown): Promise<number> {
    return this.publishEvent(sessionId, {
      type: "trace",
      data: traceData,
      eventId: randomUUID(),
    });
  }

  async publishFinal(sessionId: string, result: unknown): Promise<number> {
    return this.publishEvent(sessionId, {
      type: "final",
      data: result,
      eventId: randomUUID(),
    });
  }

  async publishError(sessionId: string, error: string): Promise<number> {
    return this.publishEvent(sessionId, {
      type: "error",
      data: { message: error },
      eventId: randomUUID(),
    });
  }

  private formatSSE(event: SSEEvent): string {
    const lines: string[] = [];
    if (event.eventId) {
      lines.push(`id: ${event.eventId}`);
    }
    lines.push(`event: ${event.type}`);
    lines.push(`data: ${JSON.stringify(event.data)}`);
    lines.push("");
    lines.push("");
    return lines.join("\n");
  }

  private writeSSE(res: Response, event: SSEEvent): boolean {
    try {
      const chunk = this.formatSSE(event);
      res.write(chunk);
      if (typeof (res as any).flush === "function") {
        (res as any).flush();
      }
      return true;
    } catch (error) {
      return false;
    }
  }

  async subscribeSession(sessionId: string, res: Response): Promise<void> {
    if (!this.subClient) {
      res.status(503).json({ error: "Redis not initialized" });
      return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.flushHeaders();

    this.writeSSE(res, {
      type: "connected",
      data: { sessionId, timestamp: Date.now() },
    });

    if (!this.activeConnections.has(sessionId)) {
      this.activeConnections.set(sessionId, new Set());

      await this.subClient.subscribe(this.channelKey(sessionId), (message) => {
        const connections = this.activeConnections.get(sessionId);
        if (!connections) return;

        try {
          const event: SSEEvent = JSON.parse(message);

          for (const conn of connections) {
            if (!this.writeSSE(conn, event)) {
              this.disconnectClient(sessionId, conn, "write_failed");
            }
          }

          if (event.type === "final" || event.type === "error") {
            setTimeout(() => {
              this.unsubscribeSession(sessionId);
            }, 1000);
          }
        } catch (error) {
          console.error("[RedisSSE] Failed to parse message:", error);
        }
      });

      const heartbeat = setInterval(() => {
        const connections = this.activeConnections.get(sessionId);
        if (!connections || connections.size === 0) {
          clearInterval(heartbeat);
          return;
        }

        for (const conn of connections) {
          if (!this.writeSSE(conn, { type: "heartbeat", data: { ts: Date.now() } })) {
            this.disconnectClient(sessionId, conn, "heartbeat_failed");
          }
        }
      }, SSE_HEARTBEAT_INTERVAL);

      this.heartbeatIntervals.set(sessionId, heartbeat);
    }

    this.activeConnections.get(sessionId)!.add(res);

    const connectionId = `sse:${sessionId}:${Date.now()}`;
    getHeartbeatManager().registerConnection(
      connectionId,
      "sse",
      () => this.disconnectClient(sessionId, res, "zombie_detected"),
      res
    );

    const timeout = setTimeout(() => {
      this.disconnectClient(sessionId, res, "timeout");
    }, SSE_CLIENT_TIMEOUT);

    this.connectionTimeouts.set(res, timeout);

    res.on("close", () => {
      getHeartbeatManager().unregisterConnection(connectionId);
      this.disconnectClient(sessionId, res, "client_closed");
    });

    console.log(
      `[RedisSSE] Client subscribed to ${sessionId}, total: ${this.activeConnections.get(sessionId)!.size}`
    );
  }

  private disconnectClient(sessionId: string, res: Response, reason: string): void {
    const connections = this.activeConnections.get(sessionId);
    if (connections) {
      connections.delete(res);
      console.log(`[RedisSSE] Client disconnected from ${sessionId}: ${reason}`);

      if (connections.size === 0) {
        this.unsubscribeSession(sessionId);
      }
    }

    const timeout = this.connectionTimeouts.get(res);
    if (timeout) {
      clearTimeout(timeout);
      this.connectionTimeouts.delete(res);
    }

    try {
      if (!res.writableEnded) {
        res.end();
      }
    } catch { }
  }

  private async unsubscribeSession(sessionId: string): Promise<void> {
    const connections = this.activeConnections.get(sessionId);
    if (connections) {
      for (const conn of connections) {
        try {
          if (!conn.writableEnded) {
            conn.end();
          }
        } catch { }
      }
      this.activeConnections.delete(sessionId);
    }

    const heartbeat = this.heartbeatIntervals.get(sessionId);
    if (heartbeat) {
      clearInterval(heartbeat);
      this.heartbeatIntervals.delete(sessionId);
    }

    if (this.subClient) {
      try {
        await this.subClient.unsubscribe(this.channelKey(sessionId));
      } catch { }
    }

    console.log(`[RedisSSE] Unsubscribed from ${sessionId}`);
  }

  getActiveConnectionCount(sessionId: string): number {
    return this.activeConnections.get(sessionId)?.size || 0;
  }

  getTotalActiveConnections(): number {
    let total = 0;
    for (const connections of this.activeConnections.values()) {
      total += connections.size;
    }
    return total;
  }
}

export const redisSSE = RedisSSEManager.getInstance();

export async function initializeRedisSSE(): Promise<void> {
  await redisSSE.initialize();
}

export function isRedisSSEAvailable(): boolean {
  return redisSSE.isInitialized();
}

export function getSSEConnectionStats() {
  return {
    redis: {
      totalConnections: redisSSE.getTotalActiveConnections(),
    },
    heartbeat: getHBStats(),
  };
}
