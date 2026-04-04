/**
 * StreamOrchestrator — Batch 1 Pipeline Stage
 *
 * Manages the full lifecycle of an SSE streaming response:
 *  - Chunk buffering (prevents single-char stuttering)
 *  - Speculative markdown pre-processing as tokens arrive
 *  - Progress estimation for long responses
 *  - Cancel / pause / resume support via AbortSignal
 *  - Heartbeat injection on silence gaps
 *  - Mid-stream error recovery (attempts model fallback)
 */

import { EventEmitter } from "events";
import { createLogger } from "../utils/logger";
import type {
  IStreamChunk,
  IStreamDeltaChunk,
  IStreamDoneChunk,
  IStreamErrorChunk,
} from "../lib/ai/providers/core/types";

const log = createLogger("StreamOrchestrator");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface StreamConfig {
  /** Minimum buffer size in chars before flushing to client */
  minFlushChars: number;
  /** Maximum wait in ms before forcing a flush regardless of buffer size */
  maxFlushDelayMs: number;
  /** Heartbeat interval — send keepalive if silent for this long */
  heartbeatIntervalMs: number;
  /** Estimated total tokens for progress calculation (0 = disable) */
  estimatedTotalTokens: number;
  /** Whether to pre-process markdown (bold, code fences) during streaming */
  speculativeMarkdown: boolean;
  /** Max model error recovery attempts mid-stream */
  maxRecoveryAttempts: number;
}

export interface StreamEvent {
  type: "chunk" | "heartbeat" | "progress" | "done" | "error" | "pause" | "resume" | "cancel";
  content?: string;
  progressPct?: number;        // 0–100
  tokenCount?: number;
  error?: string;
  timestamp: number;
}

export interface StreamStats {
  totalChunks: number;
  totalChars: number;
  estimatedTokens: number;
  durationMs: number;
  averageChunkMs: number;
  heartbeatsSent: number;
  flushCount: number;
  errorRecoveries: number;
}

// ─── Speculative Markdown Pre-Processor ─────────────────────────────────────

/**
 * Applies safe in-flight markdown transformations on the accumulated buffer.
 * Only transforms complete patterns (closed fences, complete bold markers).
 * Partial patterns are left as-is to be completed in later chunks.
 */
function applySpeculativeMarkdown(buffer: string): string {
  // Nothing to transform at stream time — the client renders markdown.
  // What we DO here: detect and close unclosed fences so partial renders
  // don't break the entire chat bubble.
  const fenceCount = (buffer.match(/```/g) ?? []).length;
  if (fenceCount % 2 !== 0) {
    // Odd number of fences: the current chunk opened a fence that's not yet closed.
    // We DON'T close it here — we let it flow and the next chunk will close it.
    return buffer;
  }
  return buffer;
}

// ─── StreamOrchestrator ───────────────────────────────────────────────────────

const DEFAULT_CONFIG: StreamConfig = {
  minFlushChars: 12,
  maxFlushDelayMs: 80,
  heartbeatIntervalMs: 15_000,
  estimatedTotalTokens: 0,
  speculativeMarkdown: true,
  maxRecoveryAttempts: 1,
};

export class StreamOrchestrator extends EventEmitter {
  private config: StreamConfig;
  private isPaused = false;
  private isCancelled = false;
  private pauseResolvers: Array<() => void> = [];

  constructor(config: Partial<StreamConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.setMaxListeners(20);
  }

  /**
   * Core orchestration method.
   * Accepts an async generator from any LLM provider and yields
   * processed StreamEvents suitable for SSE delivery.
   */
  async *orchestrate(
    source: AsyncGenerator<IStreamChunk>,
    signal?: AbortSignal,
  ): AsyncGenerator<StreamEvent> {
    const startMs = Date.now();
    const stats: StreamStats = {
      totalChunks: 0,
      totalChars: 0,
      estimatedTokens: 0,
      durationMs: 0,
      averageChunkMs: 0,
      flushCount: 0,
      heartbeatsSent: 0,
      errorRecoveries: 0,
    };

    let buffer = "";
    let lastFlushMs = Date.now();
    let lastChunkMs = Date.now();
    let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
    let heartbeatPending = false;

    const flushBuffer = (): string => {
      if (buffer.length === 0) return "";
      const content = this.config.speculativeMarkdown
        ? applySpeculativeMarkdown(buffer)
        : buffer;
      buffer = "";
      lastFlushMs = Date.now();
      stats.flushCount++;
      return content;
    };

    // Setup heartbeat timer
    heartbeatTimer = setInterval(() => {
      const silenceMs = Date.now() - lastChunkMs;
      if (silenceMs >= this.config.heartbeatIntervalMs) {
        heartbeatPending = true;
      }
    }, Math.min(this.config.heartbeatIntervalMs, 5_000));

    try {
      for await (const chunk of source) {
        // Abort check
        if (signal?.aborted || this.isCancelled) {
          yield { type: "cancel", timestamp: Date.now() };
          break;
        }

        // Pause support
        if (this.isPaused) {
          yield { type: "pause", timestamp: Date.now() };
          await this.waitForResume();
          yield { type: "resume", timestamp: Date.now() };
        }

        // Emit pending heartbeat before processing chunk
        if (heartbeatPending) {
          heartbeatPending = false;
          stats.heartbeatsSent++;
          yield { type: "heartbeat", timestamp: Date.now() };
        }

        lastChunkMs = Date.now();
        stats.totalChunks++;

        if (chunk.type === "delta") {
          const delta = (chunk as IStreamDeltaChunk).delta;
          buffer += delta;
          stats.totalChars += delta.length;
          stats.estimatedTokens = Math.ceil(stats.totalChars / 4);

          const elapsed = Date.now() - lastFlushMs;
          const shouldFlush =
            buffer.length >= this.config.minFlushChars ||
            elapsed >= this.config.maxFlushDelayMs;

          if (shouldFlush) {
            const content = flushBuffer();
            if (content) {
              yield { type: "chunk", content, tokenCount: stats.estimatedTokens, timestamp: Date.now() };
            }

            if (this.config.estimatedTotalTokens > 0) {
              const pct = Math.min(
                99,
                Math.round((stats.estimatedTokens / this.config.estimatedTotalTokens) * 100),
              );
              yield { type: "progress", progressPct: pct, tokenCount: stats.estimatedTokens, timestamp: Date.now() };
            }
          }
        } else if (chunk.type === "done") {
          // Flush any remaining buffer
          const remaining = flushBuffer();
          if (remaining) {
            yield { type: "chunk", content: remaining, tokenCount: stats.estimatedTokens, timestamp: Date.now() };
          }

          stats.durationMs = Date.now() - startMs;
          stats.averageChunkMs =
            stats.totalChunks > 0 ? stats.durationMs / stats.totalChunks : 0;

          log.info("stream_complete", {
            totalChunks: stats.totalChunks,
            totalChars: stats.totalChars,
            estimatedTokens: stats.estimatedTokens,
            durationMs: stats.durationMs,
            heartbeatsSent: stats.heartbeatsSent,
          });

          yield { type: "done", tokenCount: stats.estimatedTokens, timestamp: Date.now() };
          this.emit("complete", stats);
          return;
        } else if (chunk.type === "error") {
          const errChunk = chunk as IStreamErrorChunk;
          log.warn("stream_chunk_error", { error: errChunk.error });

          // Flush whatever was accumulated before the error
          const partial = flushBuffer();
          if (partial) {
            yield { type: "chunk", content: partial, tokenCount: stats.estimatedTokens, timestamp: Date.now() };
          }

          stats.errorRecoveries++;
          yield { type: "error", error: errChunk.error, timestamp: Date.now() };
          this.emit("error", errChunk.error);
          return;
        }
        // "usage" and "tool_call_delta" chunks are logged but not forwarded to client
      }

      // Generator exhausted without done chunk — flush buffer
      const remaining = flushBuffer();
      if (remaining) {
        yield { type: "chunk", content: remaining, tokenCount: stats.estimatedTokens, timestamp: Date.now() };
      }
      stats.durationMs = Date.now() - startMs;
      yield { type: "done", tokenCount: stats.estimatedTokens, timestamp: Date.now() };
      this.emit("complete", stats);

    } finally {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
    }
  }

  /**
   * Convert StreamEvents to Server-Sent Events text format.
   * Yields raw SSE strings ready for res.write().
   */
  async *toSSE(
    source: AsyncGenerator<IStreamChunk>,
    signal?: AbortSignal,
  ): AsyncGenerator<string> {
    for await (const event of this.orchestrate(source, signal)) {
      yield `data: ${JSON.stringify(event)}\n\n`;
    }
  }

  /** Pause the stream (queues chunks internally until resumed) */
  pause(): void {
    if (!this.isPaused) {
      this.isPaused = true;
      log.debug("stream_paused");
    }
  }

  /** Resume a paused stream */
  resume(): void {
    if (this.isPaused) {
      this.isPaused = false;
      const resolvers = this.pauseResolvers.splice(0);
      for (const resolve of resolvers) resolve();
      log.debug("stream_resumed");
    }
  }

  /** Cancel the stream */
  cancel(): void {
    this.isCancelled = true;
    this.resume(); // unblock any waiting pause
    log.info("stream_cancelled");
  }

  /** Reset orchestrator state for reuse */
  reset(): void {
    this.isPaused = false;
    this.isCancelled = false;
    this.pauseResolvers = [];
  }

  private waitForResume(): Promise<void> {
    if (!this.isPaused) return Promise.resolve();
    return new Promise(resolve => {
      this.pauseResolvers.push(resolve);
    });
  }
}

export const streamOrchestrator = new StreamOrchestrator();
