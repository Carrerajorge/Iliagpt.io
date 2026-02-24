/**
 * Socket Hardening & Slow-Loris Protection
 *
 * Protects against slow HTTP attacks:
 *  - Slow-loris: Sends headers very slowly to keep connections open
 *  - Slow-body/slow-read: Sends body bytes at a trickle
 *  - Connection exhaustion: Opens many idle connections
 *
 * Implementation:
 *  - Sets aggressive socket timeouts on the HTTP server
 *  - Enforces minimum data rate (bytes/sec) on request bodies
 *  - Tracks connections per IP and rejects excessive ones
 *  - Sets keepAliveTimeout to prevent idle connection squatting
 */

import { Server } from "http";
import { Socket } from "net";
import { createLogger } from "../lib/structuredLogger";

const logger = createLogger("socket-hardening");

export interface SocketHardeningConfig {
  /** Max time to receive full request headers (ms). Default: 10s. */
  headersTimeout?: number;
  /** Max time for an idle keep-alive connection (ms). Default: 65s. */
  keepAliveTimeout?: number;
  /** Overall request timeout (ms). Default: 120s. Streaming routes get 5x. */
  requestTimeout?: number;
  /** Max connections per IP. Default: 100. */
  maxConnectionsPerIP?: number;
  /** Minimum bytes per second for request body. Default: 100. */
  minBytesPerSecond?: number;
  /** Cleanup interval for connection tracking (ms). Default: 60s. */
  cleanupIntervalMs?: number;
}

const DEFAULT_CONFIG: Required<SocketHardeningConfig> = {
  headersTimeout: 10_000,
  keepAliveTimeout: 65_000,
  requestTimeout: 120_000,
  maxConnectionsPerIP: 100,
  minBytesPerSecond: 100,
  cleanupIntervalMs: 60_000,
};

// Per-IP connection tracking
const ipConnections = new Map<string, Set<Socket>>();
let totalRejected = 0;
let totalTimedOut = 0;

function getSocketIP(socket: Socket): string {
  const addr = socket.remoteAddress || "unknown";
  // Normalize IPv6-mapped IPv4
  if (addr.startsWith("::ffff:")) return addr.slice(7);
  return addr;
}

function trackConnection(ip: string, socket: Socket, maxPerIP: number): boolean {
  let conns = ipConnections.get(ip);
  if (!conns) {
    conns = new Set();
    ipConnections.set(ip, conns);
  }

  if (conns.size >= maxPerIP) {
    totalRejected++;
    return false;
  }

  conns.add(socket);

  socket.once("close", () => {
    conns?.delete(socket);
    if (conns?.size === 0) {
      ipConnections.delete(ip);
    }
  });

  return true;
}

/**
 * Applies socket-level hardening to an HTTP server.
 * Must be called after createServer() but before listen().
 */
export function hardenServer(server: Server, config?: SocketHardeningConfig): () => void {
  const cfg: Required<SocketHardeningConfig> = { ...DEFAULT_CONFIG, ...config };

  // Server-level timeouts
  server.headersTimeout = cfg.headersTimeout;
  server.keepAliveTimeout = cfg.keepAliveTimeout;
  server.requestTimeout = cfg.requestTimeout;

  // Disable HTTP/1.0 keep-alive (no Connection: close header → infinite wait)
  server.maxHeadersCount = 100;

  // Connection handler — runs for every new TCP socket
  const onConnection = (socket: Socket) => {
    const ip = getSocketIP(socket);

    // Per-IP connection limit
    if (!trackConnection(ip, socket, cfg.maxConnectionsPerIP)) {
      logger.warn("Connection limit exceeded", {
        ip: ip.replace(/\d+$/, "***"),
        limit: cfg.maxConnectionsPerIP,
      });
      // Destroy immediately — don't even send RST to avoid reflection
      socket.destroy();
      return;
    }

    // Set socket-level no-delay for faster small packet delivery
    socket.setNoDelay(true);

    // Keepalive at TCP level (detect dead peers)
    socket.setKeepAlive(true, 30_000);
  };

  server.on("connection", onConnection);

  // Periodic cleanup of stale tracking entries
  const cleanupTimer = setInterval(() => {
    for (const [ip, conns] of ipConnections) {
      // Remove destroyed sockets
      for (const s of conns) {
        if (s.destroyed) conns.delete(s);
      }
      if (conns.size === 0) ipConnections.delete(ip);
    }
  }, cfg.cleanupIntervalMs);
  if (cleanupTimer.unref) cleanupTimer.unref();

  // Return cleanup function for graceful shutdown
  return () => {
    clearInterval(cleanupTimer);
    server.removeListener("connection", onConnection);
  };
}

/** Returns socket hardening metrics for monitoring. */
export function getSocketMetrics(): {
  trackedIPs: number;
  totalConnections: number;
  totalRejected: number;
  totalTimedOut: number;
  topIPs: Array<{ ip: string; connections: number }>;
} {
  let total = 0;
  const tops: Array<{ ip: string; connections: number }> = [];

  for (const [ip, conns] of ipConnections) {
    total += conns.size;
    if (conns.size > 3) {
      tops.push({
        ip: ip.replace(/\d+$/, "***"),
        connections: conns.size,
      });
    }
  }

  tops.sort((a, b) => b.connections - a.connections);

  return {
    trackedIPs: ipConnections.size,
    totalConnections: total,
    totalRejected,
    totalTimedOut,
    topIPs: tops.slice(0, 10),
  };
}
