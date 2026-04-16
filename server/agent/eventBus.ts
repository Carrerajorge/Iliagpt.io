import { EventEmitter } from "events";
import type { Response } from "express";
import { createTraceEvent, type TraceEvent, type TraceEventType } from "@shared/schema";
import { db } from "../db";
import { agentModeEvents } from "@shared/schema";
import { randomUUID } from "crypto";

interface SSEClient {
  id: string;
  res: Response;
  runId: string;
  connectedAt: number;
}

class AgentEventBus extends EventEmitter {
  private clients: Map<string, SSEClient> = new Map();
  private eventHistory: Map<string, TraceEvent[]> = new Map();
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private readonly maxHistoryPerRun = 500;

  constructor() {
    super();
    this.setMaxListeners(100);
    this.startHeartbeat();
  }

  // Type-safe event listener overloads
  public override on(event: 'trace', listener: (event: TraceEvent) => void): this;
  public override on(event: TraceEventType, listener: (event: TraceEvent) => void): this;
  public override on(event: string | symbol, listener: (...args: any[]) => void): this {
    return super.on(event, listener);
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      for (const [clientId, client] of this.clients) {
        try {
          const heartbeat = createTraceEvent('heartbeat', client.runId);
          this.sendToClient(client, heartbeat);
        } catch (error) {
          console.log(`[EventBus] Removing dead client ${clientId}`);
          this.removeClient(clientId);
        }
      }
    }, 30000);
  }

  subscribe(runId: string, res: Response): string {
    const clientId = randomUUID();

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const client: SSEClient = {
      id: clientId,
      res,
      runId,
      connectedAt: Date.now(),
    };

    this.clients.set(clientId, client);
    console.log(`[EventBus] Client ${clientId} subscribed to run ${runId}`);

    const history = this.eventHistory.get(runId) || [];
    for (const event of history) {
      this.sendToClient(client, event);
    }

    res.on('close', () => {
      this.removeClient(clientId);
    });

    return clientId;
  }

  removeClient(clientId: string): void {
    const client = this.clients.get(clientId);
    if (client) {
      this.clients.delete(clientId);
      console.log(`[EventBus] Client ${clientId} disconnected from run ${client.runId}`);
    }
  }

  private sendToClient(client: SSEClient, event: TraceEvent): void {
    try {
      const data = JSON.stringify(event);
      client.res.write(`event: ${event.event_type}\n`);
      client.res.write(`data: ${data}\n\n`);
    } catch (error) {
      console.error(`[EventBus] Failed to send to client ${client.id}:`, error);
    }
  }

  async emit(runId: string, eventType: TraceEventType, options?: Partial<Omit<TraceEvent, 'event_type' | 'runId' | 'timestamp'>>): Promise<TraceEvent> {
    const event = createTraceEvent(eventType, runId, options);

    if (!this.eventHistory.has(runId)) {
      this.eventHistory.set(runId, []);
    }
    const history = this.eventHistory.get(runId)!;
    history.push(event);
    if (history.length > this.maxHistoryPerRun) {
      history.shift();
    }

    for (const client of this.clients.values()) {
      if (client.runId === runId) {
        this.sendToClient(client, event);
      }
    }

    super.emit('trace', event);
    super.emit(eventType, event);

    this.persistEvent(event).catch(err => {
      console.error(`[EventBus] Failed to persist event:`, err);
    });

    return event;
  }

  private async persistEvent(event: TraceEvent): Promise<void> {
    if (!db || typeof (db as any).insert !== "function") {
      return;
    }

    try {
      const correlationId = event.stepId || randomUUID();

      await (db as any).insert(agentModeEvents).values({
        id: randomUUID(),
        runId: event.runId,
        stepIndex: event.stepIndex ?? null,
        correlationId,
        eventType: event.event_type,
        payload: {
          phase: event.phase,
          status: event.status,
          tool_name: event.tool_name,
          command: event.command,
          output_snippet: event.output_snippet,
          chunk_sequence: event.chunk_sequence,
          artifact: event.artifact,
          plan: event.plan,
          error: event.error,
          summary: event.summary,
          confidence: event.confidence,
          metadata: event.metadata,
        },
        metadata: event.metadata ?? null,
        timestamp: new Date(event.timestamp),
      });
    } catch (error: any) {
      // Silently ignore FK constraint errors (run not persisted yet) and NOT NULL errors
      // These are non-critical for the agent workflow to complete
      if (error?.code === '23503' || error?.code === '23502') {
        // FK or NOT NULL constraint - run might not be persisted, skip silently
        return;
      }
      console.error(`[EventBus] Persist error:`, error);
    }
  }

  getHistory(runId: string): TraceEvent[] {
    return this.eventHistory.get(runId) || [];
  }

  clearHistory(runId: string): void {
    this.eventHistory.delete(runId);
  }

  getClientCount(runId?: string): number {
    if (runId) {
      return Array.from(this.clients.values()).filter(c => c.runId === runId).length;
    }
    return this.clients.size;
  }

  shutdown(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    for (const client of this.clients.values()) {
      try {
        client.res.end();
      } catch { }
    }
    this.clients.clear();
    this.eventHistory.clear();
  }
}

export const agentEventBus = new AgentEventBus();
export const unifiedEventBus = agentEventBus;
