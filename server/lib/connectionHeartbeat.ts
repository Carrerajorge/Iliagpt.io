/**
 * Connection Heartbeat Manager for WebSocket/SSE with zombie detection.
 * Provides health monitoring, automatic cleanup, and Prometheus metrics.
 */
import { EventEmitter } from "events";
import { Response } from "express";
import WebSocket from "ws";
import { Counter, Gauge, Histogram, Registry } from "prom-client";

export type ConnectionType = "ws" | "sse";

export interface HeartbeatConfig {
  heartbeatIntervalMs: number;
  responseTimeoutMs: number;
  maxMissedHeartbeats: number;
  cleanupIntervalMs: number;
}

export interface ConnectionInfo {
  id: string;
  type: ConnectionType;
  onClose: () => void;
  createdAt: number;
  lastHeartbeatSent: number;
  lastResponseReceived: number;
  missedHeartbeats: number;
  isZombie: boolean;
  ws?: WebSocket;
  res?: Response;
  latencies: number[];
}

export interface ConnectionStats {
  total: number;
  zombies: number;
  healthy: number;
  byType: {
    ws: { total: number; zombies: number; healthy: number };
    sse: { total: number; zombies: number; healthy: number };
  };
}

const DEFAULT_CONFIG: HeartbeatConfig = {
  heartbeatIntervalMs: 15000,
  responseTimeoutMs: 5000,
  maxMissedHeartbeats: 3,
  cleanupIntervalMs: 60000,
};

export class HeartbeatManager extends EventEmitter {
  private connections: Map<string, ConnectionInfo> = new Map();
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private config: HeartbeatConfig;
  private started: boolean = false;

  private activeConnectionsGauge: Gauge;
  private zombieConnectionsGauge: Gauge;
  private heartbeatLatencyHistogram: Histogram;
  private heartbeatsSentCounter: Counter;
  private zombiesDetectedCounter: Counter;

  constructor(config: Partial<HeartbeatConfig> = {}, registry?: Registry) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };

    const reg = registry || new Registry();

    this.activeConnectionsGauge = new Gauge({
      name: "connection_heartbeat_active_total",
      help: "Total number of active connections",
      labelNames: ["type"],
      registers: [reg],
    });

    this.zombieConnectionsGauge = new Gauge({
      name: "connection_heartbeat_zombies_total",
      help: "Total number of zombie connections",
      labelNames: ["type"],
      registers: [reg],
    });

    this.heartbeatLatencyHistogram = new Histogram({
      name: "connection_heartbeat_latency_ms",
      help: "Heartbeat round-trip latency in milliseconds",
      labelNames: ["type"],
      buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
      registers: [reg],
    });

    this.heartbeatsSentCounter = new Counter({
      name: "connection_heartbeats_sent_total",
      help: "Total number of heartbeats sent",
      labelNames: ["type"],
      registers: [reg],
    });

    this.zombiesDetectedCounter = new Counter({
      name: "connection_zombies_detected_total",
      help: "Total number of zombie connections detected",
      labelNames: ["type"],
      registers: [reg],
    });
  }

  start(): void {
    if (this.started) return;
    this.started = true;

    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeats();
    }, this.config.heartbeatIntervalMs);

    this.cleanupTimer = setInterval(() => {
      this.cleanupZombies();
    }, this.config.cleanupIntervalMs);

    console.log("[HeartbeatManager] Started with config:", this.config);
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    console.log("[HeartbeatManager] Stopped");
  }

  registerConnection(
    id: string,
    type: ConnectionType,
    onClose: () => void,
    transport?: WebSocket | Response
  ): void {
    const now = Date.now();

    const info: ConnectionInfo = {
      id,
      type,
      onClose,
      createdAt: now,
      lastHeartbeatSent: 0,
      lastResponseReceived: now,
      missedHeartbeats: 0,
      isZombie: false,
      latencies: [],
    };

    if (type === "ws" && transport instanceof WebSocket) {
      info.ws = transport;
      this.setupWebSocketListeners(info);
    } else if (type === "sse" && transport && "write" in transport) {
      info.res = transport as Response;
    }

    this.connections.set(id, info);
    this.updateMetrics();

    console.log(`[HeartbeatManager] Registered ${type} connection: ${id}`);
    this.emit("connection_registered", { id, type });
  }

  unregisterConnection(id: string): void {
    const conn = this.connections.get(id);
    if (conn) {
      this.connections.delete(id);
      this.updateMetrics();
      console.log(`[HeartbeatManager] Unregistered connection: ${id}`);
      this.emit("connection_unregistered", { id, type: conn.type });
    }
  }

  recordPong(id: string): void {
    const conn = this.connections.get(id);
    if (conn) {
      const now = Date.now();
      const latency = now - conn.lastHeartbeatSent;

      conn.lastResponseReceived = now;
      conn.missedHeartbeats = 0;

      if (conn.isZombie) {
        conn.isZombie = false;
        console.log(`[HeartbeatManager] Connection ${id} recovered from zombie state`);
        this.emit("connection_recovered", { id, type: conn.type });
      }

      conn.latencies.push(latency);
      if (conn.latencies.length > 100) {
        conn.latencies.shift();
      }

      this.heartbeatLatencyHistogram.observe({ type: conn.type }, latency);
      this.updateMetrics();
    }
  }

  getConnectionStats(): ConnectionStats {
    const stats: ConnectionStats = {
      total: 0,
      zombies: 0,
      healthy: 0,
      byType: {
        ws: { total: 0, zombies: 0, healthy: 0 },
        sse: { total: 0, zombies: 0, healthy: 0 },
      },
    };

    for (const conn of this.connections.values()) {
      stats.total++;
      stats.byType[conn.type].total++;

      if (conn.isZombie) {
        stats.zombies++;
        stats.byType[conn.type].zombies++;
      } else {
        stats.healthy++;
        stats.byType[conn.type].healthy++;
      }
    }

    return stats;
  }

  getConnectionInfo(id: string): ConnectionInfo | undefined {
    return this.connections.get(id);
  }

  private setupWebSocketListeners(conn: ConnectionInfo): void {
    if (!conn.ws) return;

    conn.ws.on("pong", () => {
      this.recordPong(conn.id);
    });

    conn.ws.on("close", () => {
      this.unregisterConnection(conn.id);
    });

    conn.ws.on("error", () => {
      this.markAsZombie(conn.id, "ws_error");
    });
  }

  private sendHeartbeats(): void {
    const now = Date.now();

    for (const conn of this.connections.values()) {
      if (conn.isZombie) continue;

      const timeSinceLastResponse = now - conn.lastResponseReceived;
      if (timeSinceLastResponse > this.config.responseTimeoutMs && conn.lastHeartbeatSent > 0) {
        conn.missedHeartbeats++;

        if (conn.missedHeartbeats >= this.config.maxMissedHeartbeats) {
          this.markAsZombie(conn.id, "missed_heartbeats");
          continue;
        }
      }

      conn.lastHeartbeatSent = now;
      this.heartbeatsSentCounter.inc({ type: conn.type });

      if (conn.type === "ws" && conn.ws) {
        this.sendWebSocketHeartbeat(conn);
      } else if (conn.type === "sse" && conn.res) {
        this.sendSSEHeartbeat(conn);
      }
    }
  }

  private sendWebSocketHeartbeat(conn: ConnectionInfo): void {
    if (!conn.ws || conn.ws.readyState !== WebSocket.OPEN) {
      this.markAsZombie(conn.id, "ws_not_open");
      return;
    }

    try {
      conn.ws.ping();
    } catch (error) {
      console.error(`[HeartbeatManager] Failed to send WS ping to ${conn.id}:`, error);
      this.markAsZombie(conn.id, "ping_failed");
    }
  }

  private sendSSEHeartbeat(conn: ConnectionInfo): void {
    if (!conn.res || conn.res.writableEnded) {
      this.markAsZombie(conn.id, "sse_closed");
      return;
    }

    try {
      conn.res.write(": heartbeat\n\n");

      if (typeof (conn.res as any).flush === "function") {
        (conn.res as any).flush();
      }

      this.recordPong(conn.id);
    } catch (error) {
      console.error(`[HeartbeatManager] Failed to send SSE heartbeat to ${conn.id}:`, error);
      this.markAsZombie(conn.id, "write_failed");
    }
  }

  private markAsZombie(id: string, reason: string): void {
    const conn = this.connections.get(id);
    if (!conn || conn.isZombie) return;

    conn.isZombie = true;
    this.zombiesDetectedCounter.inc({ type: conn.type });
    this.updateMetrics();

    console.log(`[HeartbeatManager] Connection ${id} marked as zombie: ${reason}`);
    this.emit("zombie_detected", { id, type: conn.type, reason });

    try {
      conn.onClose();
    } catch (error) {
      console.error(`[HeartbeatManager] Error calling onClose for ${id}:`, error);
    }
  }

  private cleanupZombies(): void {
    const zombieIds: string[] = [];

    for (const [id, conn] of this.connections.entries()) {
      if (conn.isZombie) {
        zombieIds.push(id);
      }
    }

    for (const id of zombieIds) {
      const conn = this.connections.get(id);
      if (conn) {
        if (conn.ws && conn.ws.readyState !== WebSocket.CLOSED) {
          try {
            conn.ws.terminate();
          } catch {}
        }

        if (conn.res && !conn.res.writableEnded) {
          try {
            conn.res.end();
          } catch {}
        }

        this.connections.delete(id);
      }
    }

    if (zombieIds.length > 0) {
      console.log(`[HeartbeatManager] Cleaned up ${zombieIds.length} zombie connections`);
      this.emit("zombie_cleanup", { count: zombieIds.length, ids: zombieIds });
    }

    this.updateMetrics();
  }

  private updateMetrics(): void {
    const stats = this.getConnectionStats();

    this.activeConnectionsGauge.set({ type: "ws" }, stats.byType.ws.total);
    this.activeConnectionsGauge.set({ type: "sse" }, stats.byType.sse.total);
    this.zombieConnectionsGauge.set({ type: "ws" }, stats.byType.ws.zombies);
    this.zombieConnectionsGauge.set({ type: "sse" }, stats.byType.sse.zombies);
  }

  getAverageLatency(id?: string): number {
    if (id) {
      const conn = this.connections.get(id);
      if (!conn || conn.latencies.length === 0) return 0;
      return conn.latencies.reduce((a, b) => a + b, 0) / conn.latencies.length;
    }

    let total = 0;
    let count = 0;
    for (const conn of this.connections.values()) {
      for (const lat of conn.latencies) {
        total += lat;
        count++;
      }
    }
    return count > 0 ? total / count : 0;
  }
}

let heartbeatManagerInstance: HeartbeatManager | null = null;

export function getHeartbeatManager(config?: Partial<HeartbeatConfig>): HeartbeatManager {
  if (!heartbeatManagerInstance) {
    heartbeatManagerInstance = new HeartbeatManager(config);
    heartbeatManagerInstance.start();
  }
  return heartbeatManagerInstance;
}

export function registerConnection(
  id: string,
  type: ConnectionType,
  onClose: () => void,
  transport?: WebSocket | Response
): void {
  getHeartbeatManager().registerConnection(id, type, onClose, transport);
}

export function unregisterConnection(id: string): void {
  getHeartbeatManager().unregisterConnection(id);
}

export function getConnectionStats(): ConnectionStats {
  return getHeartbeatManager().getConnectionStats();
}

export function recordPong(id: string): void {
  getHeartbeatManager().recordPong(id);
}
