import type { Response } from "express";
import { EventEmitter } from "events";

export type BudgetEventType =
  | "budget.update"
  | "budget.warn80"
  | "budget.throttle"
  | "budget.stop"
  | "cost.breakdown"
  | "provider.spike"
  | "cache.hit"
  | "cache.miss";

export interface BudgetEvent {
  type: BudgetEventType;
  timestamp: string;
  runId?: string;
  data: Record<string, unknown>;
}

export interface SSEClient {
  id: string;
  res: Response;
  connectedAt: number;
}

class BudgetEventStream extends EventEmitter {
  private clients: Map<string, SSEClient> = new Map();
  private eventHistory: BudgetEvent[] = [];
  private maxHistorySize = 500;
  private providerCostWindow: Map<string, { costs: number[]; timestamps: number[] }> = new Map();
  private spikeThresholdMultiplier = 3;

  addClient(clientId: string, res: Response): void {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    res.write(`data: ${JSON.stringify({ type: "connected", clientId })}\n\n`);

    const client: SSEClient = { id: clientId, res, connectedAt: Date.now() };
    this.clients.set(clientId, client);

    const recent = this.eventHistory.slice(-50);
    for (const event of recent) {
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    }

    res.on("close", () => {
      this.clients.delete(clientId);
    });
  }

  removeClient(clientId: string): void {
    const client = this.clients.get(clientId);
    if (client) {
      try {
        client.res.end();
      } catch {}
      this.clients.delete(clientId);
    }
  }

  broadcast(event: BudgetEvent): void {
    this.eventHistory.push(event);
    if (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory = this.eventHistory.slice(-this.maxHistorySize);
    }

    this.emit("event", event);

    const payload = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
    for (const [id, client] of this.clients) {
      try {
        client.res.write(payload);
      } catch {
        this.clients.delete(id);
      }
    }
  }

  emitBudgetUpdate(runId: string, snapshot: Record<string, unknown>): void {
    this.broadcast({
      type: "budget.update",
      timestamp: new Date().toISOString(),
      runId,
      data: snapshot,
    });
  }

  emitBudgetWarn80(runId: string, remainingPct: number, costUsd: number): void {
    this.broadcast({
      type: "budget.warn80",
      timestamp: new Date().toISOString(),
      runId,
      data: { remainingPct, costUsd, message: `Budget at ${(100 - remainingPct).toFixed(1)}% usage` },
    });
  }

  emitBudgetThrottle(runId: string, reason: string): void {
    this.broadcast({
      type: "budget.throttle",
      timestamp: new Date().toISOString(),
      runId,
      data: { reason },
    });
  }

  emitBudgetStop(runId: string, reason: string, finalCost: number): void {
    this.broadcast({
      type: "budget.stop",
      timestamp: new Date().toISOString(),
      runId,
      data: { reason, finalCost },
    });
  }

  emitCostBreakdown(breakdown: Record<string, { inputTokens: number; outputTokens: number; cost: number; calls: number }>): void {
    this.broadcast({
      type: "cost.breakdown",
      timestamp: new Date().toISOString(),
      data: { models: breakdown },
    });
  }

  emitProviderSpike(provider: string, currentCost: number, averageCost: number): void {
    this.broadcast({
      type: "provider.spike",
      timestamp: new Date().toISOString(),
      data: { provider, currentCost, averageCost, multiplier: currentCost / averageCost },
    });
  }

  emitCacheHit(model: string, savedCost: number): void {
    this.broadcast({
      type: "cache.hit",
      timestamp: new Date().toISOString(),
      data: { model, savedCost },
    });
  }

  emitCacheMiss(model: string, cost: number): void {
    this.broadcast({
      type: "cache.miss",
      timestamp: new Date().toISOString(),
      data: { model, cost },
    });
  }

  trackProviderCost(provider: string, cost: number): void {
    if (!this.providerCostWindow.has(provider)) {
      this.providerCostWindow.set(provider, { costs: [], timestamps: [] });
    }
    const window = this.providerCostWindow.get(provider)!;
    const now = Date.now();
    const cutoff = now - 5 * 60 * 1000;

    while (window.timestamps.length > 0 && window.timestamps[0] < cutoff) {
      window.timestamps.shift();
      window.costs.shift();
    }

    window.costs.push(cost);
    window.timestamps.push(now);

    if (window.costs.length >= 5) {
      const avg = window.costs.reduce((a, b) => a + b, 0) / window.costs.length;
      if (cost > avg * this.spikeThresholdMultiplier) {
        this.emitProviderSpike(provider, cost, avg);
      }
    }
  }

  getClientCount(): number {
    return this.clients.size;
  }

  getRecentEvents(limit = 50): BudgetEvent[] {
    return this.eventHistory.slice(-limit);
  }

  getStats(): { clientCount: number; totalEvents: number; recentEvents: number } {
    return {
      clientCount: this.clients.size,
      totalEvents: this.eventHistory.length,
      recentEvents: this.eventHistory.filter(
        (e) => new Date(e.timestamp).getTime() > Date.now() - 60 * 60 * 1000
      ).length,
    };
  }
}

export const budgetEventStream = new BudgetEventStream();
