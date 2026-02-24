import { Response } from "express";
import { TraceEvent } from "./types";
import { TraceBus } from "./TraceBus";
import { getEventStore } from "./EventStore";
import { randomUUID } from "crypto";

interface StreamClient {
  id: string;
  res: Response;
  runId: string;
  lastEventId: number;
  connected: boolean;
  createdAt: number;
}

interface StreamGatewayOptions {
  heartbeatIntervalMs?: number;
  maxEventsPerSecond?: number;
  bufferSize?: number;
  compressionEnabled?: boolean;
  clientTimeout?: number;
}

type EventCallback = (event: TraceEvent) => void;

export class StreamGateway {
  private clients: Map<string, StreamClient> = new Map();
  private runBuses: Map<string, TraceBus> = new Map();
  private heartbeatTimers: Map<string, NodeJS.Timeout> = new Map();
  private subscribers: Map<string, Set<EventCallback>> = new Map();
  private options: Required<StreamGatewayOptions>;

  constructor(options: StreamGatewayOptions = {}) {
    this.options = {
      heartbeatIntervalMs: options.heartbeatIntervalMs ?? 800,
      maxEventsPerSecond: options.maxEventsPerSecond ?? 100,
      bufferSize: options.bufferSize ?? 1000,
      compressionEnabled: options.compressionEnabled ?? true,
      clientTimeout: options.clientTimeout ?? 300000,
    };
  }

  registerRun(runId: string, traceBus: TraceBus): void {
    this.runBuses.set(runId, traceBus);

    traceBus.on("trace", (event: TraceEvent) => {
      this.broadcastToRun(runId, event);
      
      getEventStore().append(event).catch((err) => {
        console.error("[StreamGateway] EventStore append error:", err);
      });
    });

    const heartbeatTimer = setInterval(() => {
      const clients = this.getClientsForRun(runId);
      if (clients.length > 0) {
        traceBus.heartbeat();
      }
    }, this.options.heartbeatIntervalMs);

    this.heartbeatTimers.set(runId, heartbeatTimer);
  }

  unregisterRun(runId: string): void {
    const timer = this.heartbeatTimers.get(runId);
    if (timer) {
      clearInterval(timer);
      this.heartbeatTimers.delete(runId);
    }

    const bus = this.runBuses.get(runId);
    if (bus) {
      bus.destroy();
      this.runBuses.delete(runId);
    }

    for (const [clientId, client] of this.clients) {
      if (client.runId === runId) {
        this.disconnectClient(clientId);
      }
    }
  }

  async connect(res: Response, runId: string, lastEventId?: number): Promise<string> {
    const clientId = randomUUID();

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    if (this.options.compressionEnabled) {
      res.setHeader("Content-Encoding", "identity");
    }

    const client: StreamClient = {
      id: clientId,
      res,
      runId,
      lastEventId: lastEventId ?? 0,
      connected: true,
      createdAt: Date.now(),
    };

    this.clients.set(clientId, client);

    res.on("close", () => {
      this.disconnectClient(clientId);
    });

    res.on("error", () => {
      this.disconnectClient(clientId);
    });

    const timeout = setTimeout(() => {
      this.disconnectClient(clientId);
    }, this.options.clientTimeout);

    res.on("close", () => clearTimeout(timeout));

    this.sendEvent(client, {
      schema_version: "v1",
      run_id: runId,
      seq: 0,
      trace_id: "system",
      span_id: "system",
      parent_span_id: null,
      node_id: "connection",
      attempt_id: 1,
      agent: "gateway",
      event_type: "heartbeat",
      message: "Connected to stream",
      ts: Date.now(),
    });

    if (lastEventId && lastEventId > 0) {
      await this.replayEvents(client, lastEventId);
    }

    console.log(`[StreamGateway] Client ${clientId} connected to run ${runId}`);
    return clientId;
  }

  private async replayEvents(client: StreamClient, fromSeq: number): Promise<void> {
    try {
      const events = await getEventStore().getEvents(client.runId, fromSeq);
      
      for (const event of events) {
        if (!client.connected) break;
        this.sendEvent(client, event);
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    } catch (error) {
      console.error("[StreamGateway] Replay error:", error);
    }
  }

  private sendEvent(client: StreamClient, event: TraceEvent): void {
    if (!client.connected) return;

    try {
      const data = JSON.stringify(event);
      client.res.write(`id: ${event.seq}\n`);
      client.res.write(`event: ${event.event_type}\n`);
      client.res.write(`data: ${data}\n\n`);
      client.lastEventId = event.seq;
    } catch (error) {
      console.error("[StreamGateway] Send error:", error);
      this.disconnectClient(client.id);
    }
  }

  private broadcastToRun(runId: string, event: TraceEvent): void {
    const clients = this.getClientsForRun(runId);
    
    for (const client of clients) {
      this.sendEvent(client, event);
    }
  }

  private getClientsForRun(runId: string): StreamClient[] {
    return Array.from(this.clients.values()).filter(c => c.runId === runId && c.connected);
  }

  disconnectClient(clientId: string): void {
    const client = this.clients.get(clientId);
    if (client) {
      client.connected = false;
      try {
        client.res.end();
      } catch (endError) {
        // Response already closed - this is expected during client disconnection
        // Log at debug level for troubleshooting
        if (process.env.NODE_ENV === 'development') {
          console.debug(`[StreamGateway] res.end() failed for client ${clientId}:`, endError);
        }
      }
      this.clients.delete(clientId);
      console.log(`[StreamGateway] Client ${clientId} disconnected`);
    }
  }

  getClientCount(runId?: string): number {
    if (runId) {
      return this.getClientsForRun(runId).length;
    }
    return this.clients.size;
  }

  getRunBus(runId: string): TraceBus | undefined {
    return this.runBuses.get(runId);
  }

  publish(runId: string, event: TraceEvent): void {
    this.broadcastToRun(runId, event);
    
    const subs = this.subscribers.get(runId);
    if (subs) {
      for (const callback of subs) {
        try {
          callback(event);
        } catch (e) {
          console.error("[StreamGateway] Subscriber callback error:", e);
        }
      }
    }
  }

  subscribe(runId: string, callback: EventCallback): () => void {
    let subs = this.subscribers.get(runId);
    if (!subs) {
      subs = new Set();
      this.subscribers.set(runId, subs);
    }
    subs.add(callback);
    
    return () => {
      subs?.delete(callback);
      if (subs?.size === 0) {
        this.subscribers.delete(runId);
      }
    };
  }

  getStats(): {
    totalClients: number;
    activeRuns: number;
    clientsByRun: Record<string, number>;
  } {
    const clientsByRun: Record<string, number> = {};
    for (const client of this.clients.values()) {
      if (client.connected) {
        clientsByRun[client.runId] = (clientsByRun[client.runId] || 0) + 1;
      }
    }

    return {
      totalClients: this.clients.size,
      activeRuns: this.runBuses.size,
      clientsByRun,
    };
  }

  destroy(): void {
    for (const timer of this.heartbeatTimers.values()) {
      clearInterval(timer);
    }
    this.heartbeatTimers.clear();

    for (const clientId of this.clients.keys()) {
      this.disconnectClient(clientId);
    }

    for (const bus of this.runBuses.values()) {
      bus.destroy();
    }
    this.runBuses.clear();
  }
}

let gatewayInstance: StreamGateway | null = null;

export function getStreamGateway(): StreamGateway {
  if (!gatewayInstance) {
    gatewayInstance = new StreamGateway();
  }
  return gatewayInstance;
}
