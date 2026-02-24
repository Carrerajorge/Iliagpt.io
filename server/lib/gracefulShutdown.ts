import type { Server } from "http";
import type { WebSocketServer } from "ws";
import { createLogger } from "./structuredLogger";

const logger = createLogger("graceful-shutdown");

export interface ShutdownConfig {
  timeout?: number;
  signals?: NodeJS.Signals[];
  onShutdown?: () => Promise<void>;
  forceExitCode?: number;
}

interface ConnectionTracker {
  httpConnections: Set<any>;
  wsConnections: Set<any>;
}

type CleanupFn = () => Promise<void>;

const DEFAULT_TIMEOUT = 10000; // Reduced from 30s to 10s for faster deployments
const DEFAULT_SIGNALS: NodeJS.Signals[] = ["SIGTERM", "SIGINT", "SIGHUP"];

let isShuttingDown = false;
let shutdownPromise: Promise<void> | null = null;
const cleanupFunctions: CleanupFn[] = [];
const connectionTrackers: ConnectionTracker[] = [];

export function registerCleanup(fn: CleanupFn): () => void {
  cleanupFunctions.push(fn);
  return () => {
    const index = cleanupFunctions.indexOf(fn);
    if (index > -1) {
      cleanupFunctions.splice(index, 1);
    }
  };
}

export function trackConnections(server: Server): () => void {
  const tracker: ConnectionTracker = {
    httpConnections: new Set(),
    wsConnections: new Set(),
  };

  server.on("connection", (socket) => {
    tracker.httpConnections.add(socket);
    socket.on("close", () => {
      tracker.httpConnections.delete(socket);
    });
  });

  connectionTrackers.push(tracker);

  return () => {
    const index = connectionTrackers.indexOf(tracker);
    if (index > -1) {
      connectionTrackers.splice(index, 1);
    }
  };
}

export function trackWebSocketConnections(wss: WebSocketServer): () => void {
  const tracker: ConnectionTracker = {
    httpConnections: new Set(),
    wsConnections: new Set(),
  };

  wss.on("connection", (ws) => {
    tracker.wsConnections.add(ws);
    ws.on("close", () => {
      tracker.wsConnections.delete(ws);
    });
  });

  connectionTrackers.push(tracker);

  return () => {
    const index = connectionTrackers.indexOf(tracker);
    if (index > -1) {
      connectionTrackers.splice(index, 1);
    }
  };
}

async function drainConnections(timeoutMs: number): Promise<void> {
  const startTime = Date.now();
  const deadline = startTime + timeoutMs;

  logger.info("Draining connections", {
    totalTrackers: connectionTrackers.length,
  });

  for (const tracker of connectionTrackers) {
    for (const ws of tracker.wsConnections) {
      try {
        ws.close(1001, "Server shutting down");
      } catch (error) {
        logger.debug("Error closing WebSocket", { error });
      }
    }
  }

  const checkInterval = 100;
  while (Date.now() < deadline) {
    let activeConnections = 0;
    for (const tracker of connectionTrackers) {
      activeConnections += tracker.httpConnections.size;
      activeConnections += tracker.wsConnections.size;
    }

    if (activeConnections === 0) {
      logger.info("All connections drained successfully");
      return;
    }

    logger.debug("Waiting for connections to drain", { activeConnections });
    await new Promise(resolve => setTimeout(resolve, checkInterval));
  }

  let remainingConnections = 0;
  for (const tracker of connectionTrackers) {
    for (const socket of tracker.httpConnections) {
      try {
        socket.destroy();
      } catch (error) {
        logger.debug("Error destroying socket", { error });
      }
    }
    remainingConnections += tracker.httpConnections.size;
    remainingConnections += tracker.wsConnections.size;
  }

  logger.warn("Force closed remaining connections", { remainingConnections });
}

async function runCleanupFunctions(): Promise<void> {
  logger.info("Running cleanup functions", { count: cleanupFunctions.length });

  const results = await Promise.allSettled(
    cleanupFunctions.map(async (fn, index) => {
      try {
        await fn();
        logger.debug(`Cleanup function ${index + 1} completed`);
      } catch (error: any) {
        logger.error(`Cleanup function ${index + 1} failed`, { error: error.message });
        throw error;
      }
    })
  );

  const failed = results.filter(r => r.status === "rejected").length;
  if (failed > 0) {
    logger.warn(`${failed} cleanup functions failed`);
  }
}

async function performShutdown(
  servers: Server[],
  config: Required<ShutdownConfig>
): Promise<void> {
  if (isShuttingDown) {
    logger.debug("Shutdown already in progress");
    return shutdownPromise!;
  }

  isShuttingDown = true;
  const startTime = Date.now();
  logger.info("Graceful shutdown initiated", { timeout: config.timeout });

  shutdownPromise = (async () => {
    try {
      const serverClosePromises = servers.map(server => {
        return new Promise<void>((resolve, reject) => {
          server.close((err) => {
            if (err) {
              logger.error("Error closing server", { error: err.message });
              reject(err);
            } else {
              logger.info("HTTP server closed");
              resolve();
            }
          });
        });
      });

      const drainTimeout = Math.floor(config.timeout * 0.6);
      await drainConnections(drainTimeout);

      await Promise.race([
        Promise.all(serverClosePromises),
        new Promise<void>((_, reject) => {
          setTimeout(() => reject(new Error("Server close timeout")), config.timeout * 0.3);
        }),
      ]).catch(err => {
        logger.warn("Server close warning", { error: err.message });
      });

      await runCleanupFunctions();

      if (config.onShutdown) {
        logger.info("Running custom shutdown handler");
        await config.onShutdown();
      }

      const duration = Date.now() - startTime;
      logger.info("Graceful shutdown completed", { durationMs: duration });

    } catch (error: any) {
      logger.error("Error during shutdown", { error: error.message });
      throw error;
    }
  })();

  return shutdownPromise;
}

export function setupGracefulShutdown(
  servers: Server | Server[],
  config: ShutdownConfig = {}
): void {
  const serverArray = Array.isArray(servers) ? servers : [servers];

  const mergedConfig: Required<ShutdownConfig> = {
    timeout: config.timeout ?? DEFAULT_TIMEOUT,
    signals: config.signals ?? DEFAULT_SIGNALS,
    onShutdown: config.onShutdown ?? (async () => { }),
    forceExitCode: config.forceExitCode ?? 0,
  };

  for (const server of serverArray) {
    trackConnections(server);
  }

  const handleSignal = async (signal: NodeJS.Signals) => {
    logger.info(`Received ${signal}, initiating graceful shutdown`);

    const forceExitTimer = setTimeout(() => {
      logger.error("Forced shutdown due to timeout");
      process.exit(1);
    }, mergedConfig.timeout + 5000);
    forceExitTimer.unref();

    try {
      await performShutdown(serverArray, mergedConfig);
      clearTimeout(forceExitTimer);
      process.exit(mergedConfig.forceExitCode);
    } catch (error: any) {
      logger.error("Shutdown failed", { error: error.message });
      clearTimeout(forceExitTimer);
      process.exit(1);
    }
  };

  for (const signal of mergedConfig.signals) {
    process.on(signal, () => handleSignal(signal));
  }

  process.on("uncaughtException", (error) => {
    logger.error("Uncaught exception, initiating shutdown", {
      error: error.message,
      stack: error.stack,
    });
    handleSignal("SIGTERM");
  });

  process.on("unhandledRejection", (reason, promise) => {
    logger.error("Unhandled rejection", {
      reason: reason instanceof Error ? reason.message : String(reason),
    });
  });

  logger.info("Graceful shutdown handler configured", {
    signals: mergedConfig.signals,
    timeout: mergedConfig.timeout,
  });
}

export function isShutdownInProgress(): boolean {
  return isShuttingDown;
}

export function getConnectionStats(): { http: number; websocket: number } {
  let http = 0;
  let websocket = 0;

  for (const tracker of connectionTrackers) {
    http += tracker.httpConnections.size;
    websocket += tracker.wsConnections.size;
  }

  return { http, websocket };
}
