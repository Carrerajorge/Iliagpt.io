/**
 * StreamMetrics — Per-stream and aggregate performance telemetry
 *
 * Tracks: TTFT (time-to-first-token), tokens/sec, total latency, stall detection
 */

import EventEmitter from "events";

// ─────────────────────────────────────────────
// Interfaces
// ─────────────────────────────────────────────

export interface IStreamSnapshot {
  streamId: string;
  provider: string;
  model: string;
  startedAt: Date;
  firstTokenAt?: Date;
  completedAt?: Date;
  ttftMs?: number;             // Time to first token
  tokensPerSecond?: number;
  totalTokens: number;
  totalChars: number;
  totalLatencyMs?: number;
  isCompleted: boolean;
  isStalled: boolean;
  stallCount: number;
  errors: string[];
}

export interface IAggregateStats {
  provider: string;
  avgTtftMs: number;
  p50TtftMs: number;
  p95TtftMs: number;
  avgTokensPerSecond: number;
  avgTotalLatencyMs: number;
  successRate: number;
  stallRate: number;
  requestCount: number;
  lastUpdated: Date;
}

// ─────────────────────────────────────────────
// StreamMetrics
// ─────────────────────────────────────────────

export class StreamMetrics extends EventEmitter {
  private readonly active = new Map<string, IStreamSnapshot>();
  private readonly completed: IStreamSnapshot[] = [];
  private readonly MAX_COMPLETED = 1_000;
  private stallTimers = new Map<string, ReturnType<typeof setTimeout>>();

  private readonly STALL_THRESHOLD_MS = 5_000; // Consider stalled if no token for 5s

  /**
   * Begin tracking a new stream
   */
  start(streamId: string, provider: string, model: string): void {
    const snapshot: IStreamSnapshot = {
      streamId,
      provider,
      model,
      startedAt: new Date(),
      totalTokens: 0,
      totalChars: 0,
      isCompleted: false,
      isStalled: false,
      stallCount: 0,
      errors: [],
    };

    this.active.set(streamId, snapshot);
    this.resetStallTimer(streamId);
  }

  /**
   * Record a token chunk arriving
   */
  recordChunk(streamId: string, deltaText: string, tokenCount = 0): void {
    const snapshot = this.active.get(streamId);
    if (!snapshot) return;

    const now = new Date();

    // Record first token
    if (!snapshot.firstTokenAt) {
      snapshot.firstTokenAt = now;
      snapshot.ttftMs = now.getTime() - snapshot.startedAt.getTime();
      this.emit("first_token", { streamId, ttftMs: snapshot.ttftMs, provider: snapshot.provider });
    }

    snapshot.totalChars += deltaText.length;
    snapshot.totalTokens += tokenCount > 0 ? tokenCount : Math.ceil(deltaText.length / 4);
    snapshot.isStalled = false;

    // Reset stall detection timer
    this.resetStallTimer(streamId);
  }

  /**
   * Mark stream as complete
   */
  complete(streamId: string): void {
    const snapshot = this.active.get(streamId);
    if (!snapshot) return;

    this.clearStallTimer(streamId);

    snapshot.completedAt = new Date();
    snapshot.isCompleted = true;
    snapshot.totalLatencyMs = snapshot.completedAt.getTime() - snapshot.startedAt.getTime();

    if (snapshot.totalLatencyMs > 0 && snapshot.totalTokens > 0) {
      snapshot.tokensPerSecond = (snapshot.totalTokens / snapshot.totalLatencyMs) * 1000;
    }

    this.emit("stream_complete", {
      streamId,
      ttftMs: snapshot.ttftMs,
      tokensPerSecond: snapshot.tokensPerSecond,
      totalLatencyMs: snapshot.totalLatencyMs,
      provider: snapshot.provider,
    });

    this.archiveSnapshot(snapshot);
    this.active.delete(streamId);
  }

  /**
   * Record an error on a stream
   */
  recordError(streamId: string, error: string): void {
    const snapshot = this.active.get(streamId);
    if (!snapshot) return;

    snapshot.errors.push(error);
    this.clearStallTimer(streamId);
    this.emit("stream_error", { streamId, error, provider: snapshot.provider });
    this.archiveSnapshot(snapshot);
    this.active.delete(streamId);
  }

  /**
   * Get live snapshot for a stream
   */
  getSnapshot(streamId: string): IStreamSnapshot | undefined {
    return this.active.get(streamId);
  }

  /**
   * Get aggregate statistics per provider
   */
  getAggregateStats(provider?: string): IAggregateStats[] {
    const byProvider = new Map<string, IStreamSnapshot[]>();

    for (const snap of this.completed) {
      if (provider && snap.provider !== provider) continue;
      const list = byProvider.get(snap.provider) ?? [];
      list.push(snap);
      byProvider.set(snap.provider, list);
    }

    return Array.from(byProvider.entries()).map(([prov, snaps]) =>
      this.computeAggregate(prov, snaps),
    );
  }

  /**
   * Detect anomalies across active streams
   */
  detectAnomalies(): Array<{ streamId: string; type: string; detail: string }> {
    const anomalies: Array<{ streamId: string; type: string; detail: string }> = [];

    for (const [streamId, snap] of this.active) {
      const ageMs = Date.now() - snap.startedAt.getTime();

      if (!snap.firstTokenAt && ageMs > 10_000) {
        anomalies.push({
          streamId,
          type: "NO_FIRST_TOKEN",
          detail: `No tokens received after ${ageMs}ms on ${snap.provider}/${snap.model}`,
        });
      }

      if (snap.isStalled) {
        anomalies.push({
          streamId,
          type: "STALLED",
          detail: `Stream stalled (${snap.stallCount} stalls) on ${snap.provider}/${snap.model}`,
        });
      }

      if (ageMs > 120_000) {
        anomalies.push({
          streamId,
          type: "TIMEOUT_RISK",
          detail: `Stream running for ${Math.floor(ageMs / 1000)}s on ${snap.provider}/${snap.model}`,
        });
      }
    }

    return anomalies;
  }

  // ─── Private Helpers ───

  private resetStallTimer(streamId: string): void {
    this.clearStallTimer(streamId);
    const timer = setTimeout(() => {
      const snapshot = this.active.get(streamId);
      if (snapshot && !snapshot.isCompleted) {
        snapshot.isStalled = true;
        snapshot.stallCount++;
        this.emit("stall", { streamId, stallCount: snapshot.stallCount, provider: snapshot.provider });
      }
    }, this.STALL_THRESHOLD_MS);

    if (timer.unref) timer.unref();
    this.stallTimers.set(streamId, timer);
  }

  private clearStallTimer(streamId: string): void {
    const timer = this.stallTimers.get(streamId);
    if (timer) {
      clearTimeout(timer);
      this.stallTimers.delete(streamId);
    }
  }

  private archiveSnapshot(snapshot: IStreamSnapshot): void {
    this.completed.push({ ...snapshot });
    if (this.completed.length > this.MAX_COMPLETED) {
      this.completed.splice(0, Math.floor(this.MAX_COMPLETED * 0.1));
    }
  }

  private computeAggregate(provider: string, snaps: IStreamSnapshot[]): IAggregateStats {
    const completed = snaps.filter((s) => s.isCompleted && !s.errors.length);
    const ttfts = completed.map((s) => s.ttftMs ?? 0).sort((a, b) => a - b);
    const latencies = completed.map((s) => s.totalLatencyMs ?? 0);
    const tps = completed.filter((s) => s.tokensPerSecond).map((s) => s.tokensPerSecond!);

    return {
      provider,
      avgTtftMs: ttfts.length > 0 ? ttfts.reduce((a, b) => a + b, 0) / ttfts.length : 0,
      p50TtftMs: ttfts[Math.floor(ttfts.length * 0.5)] ?? 0,
      p95TtftMs: ttfts[Math.floor(ttfts.length * 0.95)] ?? 0,
      avgTokensPerSecond: tps.length > 0 ? tps.reduce((a, b) => a + b, 0) / tps.length : 0,
      avgTotalLatencyMs: latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0,
      successRate: snaps.length > 0 ? completed.length / snaps.length : 0,
      stallRate: snaps.length > 0 ? snaps.filter((s) => s.stallCount > 0).length / snaps.length : 0,
      requestCount: snaps.length,
      lastUpdated: new Date(),
    };
  }
}

// Singleton instance
export const streamMetrics = new StreamMetrics();
