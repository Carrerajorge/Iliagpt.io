import { once } from "events";
import { randomUUID } from "crypto";
import type { Response } from "express";
import { WebSocket, WebSocketServer } from "ws";

import type { AuthenticatedWebSocket } from "../lib/wsAuth";
import { createAuthenticatedWebSocketHandler } from "../lib/wsAuth";
import { agentEventBus } from "../agent/eventBus";
import { WorkflowStore, StoredWorkflowEvent } from "./store";
import {
  decrementStreamClients,
  incrementStreamClients,
  recordStreamOverflow,
  setStreamQueueDepth,
} from "./metrics";

const DEFAULT_RETRY_MS = Number(process.env.WORKFLOW_STREAM_RETRY_MS || 1500);
const DEFAULT_POLL_MS = Number(process.env.WORKFLOW_STREAM_POLL_MS || 500);
const DEFAULT_HEARTBEAT_MS = Number(process.env.WORKFLOW_STREAM_HEARTBEAT_MS || 15_000);
const DEFAULT_MAX_QUEUE = Number(process.env.WORKFLOW_STREAM_MAX_QUEUE || 1000);
const WS_MAX_BUFFERED_BYTES = Number(process.env.WORKFLOW_STREAM_WS_MAX_BUFFERED_BYTES || 1024 * 1024);
const REPLAY_BATCH_SIZE = Number(process.env.WORKFLOW_STREAM_REPLAY_BATCH || 200);

type Protocol = "sse" | "ws";

type StreamClient = {
  id: string;
  runId: string;
  protocol: Protocol;
  lastSentSeq: number;
  queue: string[];
  closed: boolean;
  flushing: boolean;
  replaying: boolean;
  replayRequested: boolean;
  pollTimer: NodeJS.Timeout;
  close: (reason?: string) => void;
} & (
  | { protocol: "sse"; res: Response }
  | { protocol: "ws"; ws: WebSocket }
);

interface SseConnectOptions {
  runId: string;
  res: Response;
  lastEventId?: number | null;
}

interface WsSubscribeMessage {
  type: "subscribe";
  runId: string;
  lastEventId?: number;
}

function parseEventId(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return Math.floor(parsed);
}

function toStreamPayload(row: StoredWorkflowEvent) {
  const basePayload = row.payload || {};
  const payloadMetadata = typeof basePayload.metadata === "object" && basePayload.metadata !== null ? basePayload.metadata : {};

  return {
    ...basePayload,
    event_type: row.eventType,
    runId: row.runId,
    event_seq: row.eventSeq,
    correlation_id: row.correlationId,
    stepId: row.stepId || undefined,
    stepIndex: row.stepIndex ?? undefined,
    trace_id: row.traceId || undefined,
    span_id: row.spanId || undefined,
    severity: row.severity || undefined,
    timestamp: row.timestamp.getTime(),
    metadata: {
      ...payloadMetadata,
      ...(row.metadata || {}),
      event_seq: row.eventSeq,
      correlation_id: row.correlationId,
      trace_id: row.traceId || undefined,
      span_id: row.spanId || undefined,
      severity: row.severity || undefined,
    },
  };
}

export class WorkflowTraceStreamHub {
  private readonly clients = new Map<string, StreamClient>();
  private readonly clientsByRun = new Map<string, Set<string>>();
  private readonly retryMs: number;
  private readonly pollMs: number;
  private readonly heartbeatMs: number;
  private readonly maxQueue: number;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(private readonly store: WorkflowStore) {
    this.retryMs = DEFAULT_RETRY_MS;
    this.pollMs = Math.max(100, DEFAULT_POLL_MS);
    this.heartbeatMs = Math.max(5_000, DEFAULT_HEARTBEAT_MS);
    this.maxQueue = Math.max(100, DEFAULT_MAX_QUEUE);

    agentEventBus.on("trace", (event) => {
      if (!event?.runId || typeof event.event_seq !== "number") {
        return;
      }
      this.flushRun(event.runId);
    });

    this.startHeartbeat();
  }

  connectSse({ runId, res, lastEventId }: SseConnectOptions): { clientId: string; close: () => void } {
    const clientId = randomUUID();

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const pollTimer = setInterval(() => {
      void this.flushClient(clientId);
    }, this.pollMs);

    const client: StreamClient = {
      id: clientId,
      runId,
      protocol: "sse",
      res,
      lastSentSeq: parseEventId(lastEventId),
      queue: [],
      closed: false,
      flushing: false,
      replaying: false,
      replayRequested: false,
      pollTimer,
      close: () => this.removeClient(clientId),
    };

    this.clients.set(clientId, client);
    this.addClientToRun(clientId, runId);
    incrementStreamClients("sse");

    this.enqueue(client, `retry: ${this.retryMs}\n\n`);
    void this.flushClient(clientId);

    return {
      clientId,
      close: () => this.removeClient(clientId),
    };
  }

  async registerWebSocket(wss: WebSocketServer, requireAuth: boolean): Promise<void> {
    createAuthenticatedWebSocketHandler(wss, requireAuth, (ws: AuthenticatedWebSocket) => {
      let activeClientId: string | null = null;

      ws.on("message", (raw) => {
        let parsed: WsSubscribeMessage | null = null;
        try {
          parsed = JSON.parse(raw.toString());
        } catch {
          ws.send(JSON.stringify({ type: "error", error: "Invalid JSON" }));
          return;
        }

        if (!parsed || parsed.type !== "subscribe" || !parsed.runId) {
          ws.send(JSON.stringify({ type: "error", error: "Invalid subscribe payload" }));
          return;
        }

        if (activeClientId) {
          this.removeClient(activeClientId);
          activeClientId = null;
        }

        activeClientId = this.connectWs(ws, parsed.runId, parsed.lastEventId);
      });

      ws.on("close", () => {
        if (activeClientId) {
          this.removeClient(activeClientId);
          activeClientId = null;
        }
      });
    });
  }

  private connectWs(ws: WebSocket, runId: string, lastEventId?: number): string {
    const clientId = randomUUID();

    const pollTimer = setInterval(() => {
      void this.flushClient(clientId);
    }, this.pollMs);

    const client: StreamClient = {
      id: clientId,
      runId,
      protocol: "ws",
      ws,
      lastSentSeq: parseEventId(lastEventId),
      queue: [],
      closed: false,
      flushing: false,
      replaying: false,
      replayRequested: false,
      pollTimer,
      close: () => this.removeClient(clientId),
    };

    this.clients.set(clientId, client);
    this.addClientToRun(clientId, runId);
    incrementStreamClients("ws");

    this.enqueue(
      client,
      JSON.stringify({
        type: "subscribed",
        runId,
        lastEventId: client.lastSentSeq,
        retryMs: this.retryMs,
      }),
    );

    void this.flushClient(clientId);
    return clientId;
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      for (const client of this.clients.values()) {
        if (client.protocol === "sse") {
          this.enqueue(client, `: heartbeat ${Date.now()}\n\n`);
        }
      }
    }, this.heartbeatMs);
  }

  private addClientToRun(clientId: string, runId: string): void {
    if (!this.clientsByRun.has(runId)) {
      this.clientsByRun.set(runId, new Set());
    }
    this.clientsByRun.get(runId)!.add(clientId);
  }

  private removeClient(clientId: string): void {
    const client = this.clients.get(clientId);
    if (!client || client.closed) {
      return;
    }

    client.closed = true;
    clearInterval(client.pollTimer);

    if (client.protocol === "sse") {
      decrementStreamClients("sse");
      try {
        client.res.end();
      } catch {
        // ignore
      }
    } else {
      decrementStreamClients("ws");
      try {
        if (client.ws.readyState === WebSocket.OPEN) {
          client.ws.close(1000, "closed");
        }
      } catch {
        // ignore
      }
    }

    const runClients = this.clientsByRun.get(client.runId);
    if (runClients) {
      runClients.delete(clientId);
      if (runClients.size === 0) {
        this.clientsByRun.delete(client.runId);
      }
    }

    this.clients.delete(clientId);
    setStreamQueueDepth(client.protocol, 0);
  }

  private flushRun(runId: string): void {
    const runClients = this.clientsByRun.get(runId);
    if (!runClients || runClients.size === 0) {
      return;
    }

    for (const clientId of runClients) {
      void this.flushClient(clientId);
    }
  }

  private async flushClient(clientId: string): Promise<void> {
    const client = this.clients.get(clientId);
    if (!client || client.closed) {
      return;
    }

    if (client.replaying) {
      client.replayRequested = true;
      return;
    }

    client.replaying = true;

    try {
      do {
        client.replayRequested = false;

        while (!client.closed) {
          const events = await this.store.listEvents({
            runId: client.runId,
            afterSeq: client.lastSentSeq,
            order: "asc",
            limit: REPLAY_BATCH_SIZE,
          });

          if (events.length === 0) {
            break;
          }

          for (const row of events) {
            const payload = toStreamPayload(row);
            if (payload.event_seq <= client.lastSentSeq) {
              continue;
            }

            if (client.protocol === "sse") {
              this.enqueue(client, this.formatSseFrame(payload));
            } else {
              this.enqueue(
                client,
                JSON.stringify({
                  type: "event",
                  id: payload.event_seq,
                  event: payload.event_type,
                  data: payload,
                }),
              );
            }

            client.lastSentSeq = payload.event_seq;
          }

          if (events.length < REPLAY_BATCH_SIZE) {
            break;
          }
        }
      } while (client.replayRequested && !client.closed);
    } finally {
      client.replaying = false;
      void this.drainClient(client);
    }
  }

  private formatSseFrame(payload: Record<string, any>): string {
    return `id: ${payload.event_seq}\nevent: ${payload.event_type}\ndata: ${JSON.stringify(payload)}\n\n`;
  }

  private enqueue(client: StreamClient, frame: string): void {
    if (client.closed) {
      return;
    }

    if (client.queue.length >= this.maxQueue) {
      recordStreamOverflow(client.protocol, client.runId, client.queue.length);
      if (client.protocol === "ws") {
        try {
          client.ws.close(1013, "workflow stream overflow");
        } catch {
          // ignore
        }
      }
      this.removeClient(client.id);
      return;
    }

    client.queue.push(frame);
    setStreamQueueDepth(client.protocol, client.queue.length);
    void this.drainClient(client);
  }

  private async drainClient(client: StreamClient): Promise<void> {
    if (client.closed || client.flushing) {
      return;
    }

    client.flushing = true;

    try {
      while (!client.closed && client.queue.length > 0) {
        if (client.protocol === "sse") {
          const frame = client.queue[0];
          const writable = client.res.write(frame);
          if (!writable) {
            try {
              await once(client.res, "drain");
            } catch {
              this.removeClient(client.id);
              return;
            }
          }
          client.queue.shift();
          setStreamQueueDepth(client.protocol, client.queue.length);
          continue;
        }

        if (client.ws.readyState !== WebSocket.OPEN) {
          this.removeClient(client.id);
          return;
        }

        if (client.ws.bufferedAmount > WS_MAX_BUFFERED_BYTES) {
          // Let the socket drain naturally; queue limit enforces backpressure safety.
          await new Promise((resolve) => setTimeout(resolve, 10));
          continue;
        }

        const frame = client.queue.shift()!;
        setStreamQueueDepth(client.protocol, client.queue.length);
        client.ws.send(frame, (error) => {
          if (error) {
            this.removeClient(client.id);
          }
        });
      }
    } finally {
      client.flushing = false;
    }
  }

  shutdown(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    for (const clientId of Array.from(this.clients.keys())) {
      this.removeClient(clientId);
    }

    this.clientsByRun.clear();
  }
}

let singletonHub: WorkflowTraceStreamHub | null = null;

export function getWorkflowTraceStreamHub(store: WorkflowStore): WorkflowTraceStreamHub {
  if (!singletonHub) {
    singletonHub = new WorkflowTraceStreamHub(store);
  }
  return singletonHub;
}

export function parseLastEventId(headerValue?: string | string[] | null, queryValue?: unknown): number {
  const fromHeader = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  const value = fromHeader ?? (typeof queryValue === "string" ? queryValue : null);
  return parseEventId(value ?? 0);
}
