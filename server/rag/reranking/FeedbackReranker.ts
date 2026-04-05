/**
 * FeedbackReranker — Learns from user interaction signals to boost/degrade
 * chunks over time. Supports per-user and global feedback models.
 *
 * Signals: click, copy, cite, thumbs_up, thumbs_down, dwell_time, dismiss
 * Decay: feedback contribution decays exponentially (half-life configurable).
 */

import crypto from "crypto";
import { createLogger } from "../../utils/logger";
import type { RerankStage, RetrievedChunk } from "../UnifiedRAGPipeline";

const logger = createLogger("FeedbackReranker");

// ─── Feedback types ───────────────────────────────────────────────────────────

export type FeedbackSignal =
  | "click"
  | "copy"
  | "cite"
  | "thumbs_up"
  | "thumbs_down"
  | "dwell_short"   // < 3 seconds dwell
  | "dwell_medium"  // 3–15 seconds
  | "dwell_long"    // > 15 seconds
  | "dismiss";

const SIGNAL_WEIGHTS: Record<FeedbackSignal, number> = {
  click: 0.5,
  copy: 1.0,
  cite: 1.5,
  thumbs_up: 2.0,
  thumbs_down: -2.0,
  dwell_short: -0.2,
  dwell_medium: 0.3,
  dwell_long: 0.8,
  dismiss: -1.0,
};

export interface FeedbackEvent {
  chunkId: string;
  queryHash: string;
  signal: FeedbackSignal;
  userId?: string;
  timestamp: number;
  /** Content hash for matching similar chunks in the future */
  contentHash?: string;
}

export interface FeedbackScore {
  chunkId: string;
  queryHash: string;
  cumulativeScore: number;
  eventCount: number;
  lastUpdated: number;
}

// ─── Configuration ────────────────────────────────────────────────────────────

export interface FeedbackRerankerConfig {
  /** Feedback half-life in milliseconds */
  halfLifeMs: number;
  /** Max adjustment to original score (±) */
  maxAdjustment: number;
  /** Weight of global (cross-user) feedback vs per-user */
  globalFeedbackWeight: number;
  /** Minimum events before feedback influences ranking */
  minEventsToInfluence: number;
  /** Similarity threshold for query matching (Jaccard on tokens) */
  querySimilarityThreshold: number;
}

const DEFAULT_FEEDBACK_CONFIG: FeedbackRerankerConfig = {
  halfLifeMs: 14 * 24 * 60 * 60 * 1000, // 2 weeks
  maxAdjustment: 0.3,
  globalFeedbackWeight: 0.4,
  minEventsToInfluence: 2,
  querySimilarityThreshold: 0.6,
};

// ─── Storage (in-process; production should use Redis/DB) ────────────────────

interface FeedbackStore {
  /** chunkId → queryHash → user events */
  userFeedback: Map<string, Map<string, FeedbackEvent[]>>;
  /** chunkId → queryHash → global events */
  globalFeedback: Map<string, Map<string, FeedbackEvent[]>>;
  /** queryHash → original query tokens */
  queryRegistry: Map<string, string[]>;
}

const store: FeedbackStore = {
  userFeedback: new Map(),
  globalFeedback: new Map(),
  queryRegistry: new Map(),
};

function hashQuery(query: string): string {
  return crypto.createHash("sha256").update(query.toLowerCase().trim()).digest("hex").slice(0, 12);
}

function tokenizeQuery(query: string): string[] {
  return query.toLowerCase().replace(/[^\w\s]/g, " ").split(/\s+/).filter((t) => t.length > 2);
}

function jaccardSimilarity(a: string[], b: string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  const intersection = [...setA].filter((x) => setB.has(x)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

// ─── Decay function ───────────────────────────────────────────────────────────

function decayedScore(events: FeedbackEvent[], halfLifeMs: number): number {
  const now = Date.now();
  return events.reduce((sum, event) => {
    const ageMs = now - event.timestamp;
    const decay = Math.exp(-Math.log(2) * ageMs / halfLifeMs);
    return sum + SIGNAL_WEIGHTS[event.signal] * decay;
  }, 0);
}

// ─── FeedbackReranker ─────────────────────────────────────────────────────────

export class FeedbackReranker implements RerankStage {
  private readonly config: FeedbackRerankerConfig;

  constructor(config: Partial<FeedbackRerankerConfig> = {}) {
    this.config = { ...DEFAULT_FEEDBACK_CONFIG, ...config };
  }

  /**
   * Record a feedback event for a chunk retrieved for a given query.
   */
  recordFeedback(event: FeedbackEvent): void {
    const qHash = event.queryHash;
    const tokens = tokenizeQuery(event.queryHash);
    store.queryRegistry.set(qHash, tokens);

    // Per-user feedback
    if (event.userId) {
      const userKey = `${event.userId}:${event.chunkId}`;
      if (!store.userFeedback.has(userKey)) store.userFeedback.set(userKey, new Map());
      const userMap = store.userFeedback.get(userKey)!;
      if (!userMap.has(qHash)) userMap.set(qHash, []);
      userMap.get(qHash)!.push(event);
    }

    // Global feedback
    if (!store.globalFeedback.has(event.chunkId)) store.globalFeedback.set(event.chunkId, new Map());
    const globalMap = store.globalFeedback.get(event.chunkId)!;
    if (!globalMap.has(qHash)) globalMap.set(qHash, []);
    globalMap.get(qHash)!.push(event);

    logger.debug("Feedback recorded", {
      chunkId: event.chunkId,
      signal: event.signal,
      userId: event.userId,
    });
  }

  /**
   * Compute feedback adjustment for a chunk given the current query.
   * Returns a value in range [-maxAdjustment, +maxAdjustment].
   */
  getFeedbackAdjustment(
    chunkId: string,
    query: string,
    userId?: string
  ): number {
    const queryTokens = tokenizeQuery(query);
    const halfLife = this.config.halfLifeMs;

    // Find matching query hashes by similarity
    const matchingHashes: string[] = [];
    for (const [qHash, tokens] of store.queryRegistry) {
      const sim = jaccardSimilarity(queryTokens, tokens);
      if (sim >= this.config.querySimilarityThreshold) {
        matchingHashes.push(qHash);
      }
    }

    if (matchingHashes.length === 0) return 0;

    // Per-user adjustment
    let userAdjustment = 0;
    let userEventCount = 0;
    if (userId) {
      const userKey = `${userId}:${chunkId}`;
      const userMap = store.userFeedback.get(userKey);
      if (userMap) {
        for (const qHash of matchingHashes) {
          const events = userMap.get(qHash) ?? [];
          userEventCount += events.length;
          userAdjustment += decayedScore(events, halfLife);
        }
      }
    }

    // Global adjustment
    let globalAdjustment = 0;
    let globalEventCount = 0;
    const globalMap = store.globalFeedback.get(chunkId);
    if (globalMap) {
      for (const qHash of matchingHashes) {
        const events = globalMap.get(qHash) ?? [];
        globalEventCount += events.length;
        globalAdjustment += decayedScore(events, halfLife);
      }
    }

    const totalEvents = Math.max(userEventCount, globalEventCount);
    if (totalEvents < this.config.minEventsToInfluence) return 0;

    // Blend user and global
    const blended = userId && userEventCount >= this.config.minEventsToInfluence
      ? userAdjustment * (1 - this.config.globalFeedbackWeight) +
        globalAdjustment * this.config.globalFeedbackWeight
      : globalAdjustment;

    // Normalize and clamp
    const normalized = blended / Math.max(1, totalEvents);
    return Math.max(
      -this.config.maxAdjustment,
      Math.min(this.config.maxAdjustment, normalized * 0.1)
    );
  }

  async rerank(
    query: string,
    chunks: RetrievedChunk[],
    userId?: string
  ): Promise<RetrievedChunk[]> {
    if (chunks.length === 0) return [];

    const reranked = chunks.map((chunk) => {
      const adjustment = this.getFeedbackAdjustment(chunk.id, query, userId);
      return {
        ...chunk,
        score: Math.max(0, Math.min(1, chunk.score + adjustment)),
      };
    });

    reranked.sort((a, b) => b.score - a.score);

    logger.debug("FeedbackReranker applied", {
      query: query.slice(0, 50),
      chunks: chunks.length,
      userId,
    });

    return reranked;
  }

  /** Get feedback statistics for a chunk */
  getChunkStats(chunkId: string): {
    totalEvents: number;
    positiveSignals: number;
    negativeSignals: number;
    latestEvent?: number;
  } {
    const globalMap = store.globalFeedback.get(chunkId);
    if (!globalMap) return { totalEvents: 0, positiveSignals: 0, negativeSignals: 0 };

    let totalEvents = 0;
    let positiveSignals = 0;
    let negativeSignals = 0;
    let latestEvent: number | undefined;

    for (const events of globalMap.values()) {
      for (const event of events) {
        totalEvents++;
        const weight = SIGNAL_WEIGHTS[event.signal];
        if (weight > 0) positiveSignals++;
        else if (weight < 0) negativeSignals++;
        if (!latestEvent || event.timestamp > latestEvent) latestEvent = event.timestamp;
      }
    }

    return { totalEvents, positiveSignals, negativeSignals, latestEvent };
  }

  /** Prune expired feedback to prevent unbounded memory growth */
  pruneExpired(): number {
    const cutoff = Date.now() - this.config.halfLifeMs * 4; // Keep 4x half-life of history
    let pruned = 0;

    for (const [key, queryMap] of store.userFeedback) {
      for (const [qHash, events] of queryMap) {
        const fresh = events.filter((e) => e.timestamp > cutoff);
        pruned += events.length - fresh.length;
        if (fresh.length === 0) queryMap.delete(qHash);
        else queryMap.set(qHash, fresh);
      }
      if (queryMap.size === 0) store.userFeedback.delete(key);
    }

    for (const [chunkId, queryMap] of store.globalFeedback) {
      for (const [qHash, events] of queryMap) {
        const fresh = events.filter((e) => e.timestamp > cutoff);
        pruned += events.length - fresh.length;
        if (fresh.length === 0) queryMap.delete(qHash);
        else queryMap.set(qHash, fresh);
      }
      if (queryMap.size === 0) store.globalFeedback.delete(chunkId);
    }

    logger.info("Feedback pruned", { prunedEvents: pruned });
    return pruned;
  }
}

// ─── Singleton + helpers ─────────────────────────────────────────────────────

export const feedbackReranker = new FeedbackReranker();

export function recordFeedback(event: Omit<FeedbackEvent, "queryHash"> & { query: string }): void {
  const { query, ...rest } = event;
  feedbackReranker.recordFeedback({
    ...rest,
    queryHash: hashQuery(query),
  });
}

export { hashQuery as hashQueryForFeedback };
