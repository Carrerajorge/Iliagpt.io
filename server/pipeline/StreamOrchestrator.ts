/**
 * StreamOrchestrator
 *
 * Manages the full lifecycle of a streaming LLM response:
 *
 *   - Buffers incoming chunks and emits batched segments to the client
 *   - Estimates progress based on token budget (rough, probabilistic)
 *   - Supports pause / resume / cancel via AbortController
 *   - Recovers from mid-stream errors without closing the client connection
 *   - Sends periodic heartbeat comments to keep HTTP connections alive
 *   - Accumulates the full response for downstream quality validation
 *
 * Usage
 * ──────
 *   const orchestrator = new StreamOrchestrator(res, { maxTokens: 1024 });
 *   await orchestrator.run(asyncIterable);
 *   const full = orchestrator.accumulated;
 *
 * The class does NOT own the HTTP response — callers manage SSE framing.
 */

import { EventEmitter }      from 'events';
import { z }                 from 'zod';
import { Logger }            from '../lib/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

export const StreamStateSchema = z.enum([
  'idle',
  'streaming',
  'paused',
  'completed',
  'cancelled',
  'error',
]);
export type StreamState = z.infer<typeof StreamStateSchema>;

export interface StreamChunk {
  delta      : string;   // New text in this chunk
  accumulated: string;   // Full text so far
  done       : boolean;  // True on the final chunk
  tokenCount ?: number;  // Running token count if provided by the model
}

export interface OrchestratorOptions {
  /** Token budget for this request (used for progress estimation). */
  maxTokens        ?: number;
  /** Ms between heartbeat pings when no chunks arrive. Default 5000. */
  heartbeatIntervalMs?: number;
  /** Max ms to wait for the first chunk before giving up. Default 15000. */
  firstChunkTimeoutMs?: number;
  /** If true, flush every chunk immediately rather than batching. Default true. */
  immediateFlushing?: boolean;
  /** Batch multiple chunks together for this many ms. Only used when immediateFlushing=false. */
  batchWindowMs    ?: number;
  /** Called for each flushed segment. Replaces direct write to response stream. */
  onChunk         ?: (segment: string, accumulated: string, done: boolean) => void;
  /** Called when the stream completes (success or error). */
  onComplete      ?: (result: OrchestratorResult) => void;
}

export interface OrchestratorResult {
  accumulated   : string;
  tokenCount    : number;
  durationMs    : number;
  state         : StreamState;
  chunksReceived: number;
  error         ?: Error;
}

// ─── StreamOrchestrator ───────────────────────────────────────────────────────

export class StreamOrchestrator extends EventEmitter {
  private _state         : StreamState = 'idle';
  private _accumulated   : string      = '';
  private _tokenCount    : number      = 0;
  private _chunksReceived: number      = 0;
  private _startTime     : number      = 0;
  private _abortController             = new AbortController();
  private _heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private _batchBuffer   : string      = '';
  private _batchTimer    : ReturnType<typeof setTimeout>  | null = null;

  constructor(private readonly opts: OrchestratorOptions = {}) {
    super();
    this.opts.heartbeatIntervalMs = opts.heartbeatIntervalMs ?? 5_000;
    this.opts.firstChunkTimeoutMs = opts.firstChunkTimeoutMs ?? 15_000;
    this.opts.immediateFlushing   = opts.immediateFlushing   ?? true;
    this.opts.batchWindowMs       = opts.batchWindowMs       ?? 50;
    this.opts.maxTokens           = opts.maxTokens           ?? 1024;
  }

  // ── Public state accessors ─────────────────────────────────────────────────

  get state()       : StreamState { return this._state; }
  get accumulated() : string      { return this._accumulated; }
  get tokenCount()  : number      { return this._tokenCount; }
  get isActive()    : boolean     { return this._state === 'streaming' || this._state === 'paused'; }

  // ── Control methods ────────────────────────────────────────────────────────

  cancel(reason = 'cancelled by caller'): void {
    if (!this.isActive) return;
    Logger.debug('[StreamOrchestrator] cancelling stream', { reason });
    this._abortController.abort(reason);
    this._transition('cancelled');
  }

  pause(): void {
    if (this._state !== 'streaming') return;
    this._transition('paused');
    this._stopHeartbeat();
    Logger.debug('[StreamOrchestrator] stream paused');
  }

  resume(): void {
    if (this._state !== 'paused') return;
    this._transition('streaming');
    this._startHeartbeat();
    Logger.debug('[StreamOrchestrator] stream resumed');
  }

  /**
   * Main entry point.  Pass an AsyncIterable of StreamChunk (or any object
   * with `delta` and `done` fields) and the orchestrator handles the rest.
   */
  async run(source: AsyncIterable<StreamChunk>): Promise<OrchestratorResult> {
    if (this._state !== 'idle') {
      throw new Error(`StreamOrchestrator.run() called in state '${this._state}'`);
    }

    this._startTime = Date.now();
    this._transition('streaming');
    this._startHeartbeat();

    // First-chunk timeout
    let firstChunkSeen = false;
    const firstChunkTimer = setTimeout(() => {
      if (!firstChunkSeen) {
        Logger.warn('[StreamOrchestrator] first chunk timeout exceeded', {
          timeoutMs: this.opts.firstChunkTimeoutMs,
        });
        this.cancel('first_chunk_timeout');
      }
    }, this.opts.firstChunkTimeoutMs);

    let lastError: Error | undefined;

    try {
      for await (const chunk of source) {
        // Check for cancellation / pause
        if (this._abortController.signal.aborted) break;

        // Wait while paused (spin-wait with short sleep)
        while (this._state === 'paused') {
          await new Promise(resolve => setTimeout(resolve, 50));
          if (this._abortController.signal.aborted) break;
        }
        if (this._abortController.signal.aborted) break;

        if (!firstChunkSeen) {
          firstChunkSeen = true;
          clearTimeout(firstChunkTimer);
        }

        this._accumulated    = chunk.accumulated ?? (this._accumulated + chunk.delta);
        this._tokenCount     = chunk.tokenCount  ?? this._estimateTokens(this._accumulated);
        this._chunksReceived++;

        this._flush(chunk.delta, chunk.done);

        if (chunk.done) break;
      }

      if (this._state === 'streaming') {
        this._transition('completed');
      }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      Logger.error('[StreamOrchestrator] stream error', {
        error : lastError.message,
        chunks: this._chunksReceived,
      });
      this._transition('error');
    } finally {
      clearTimeout(firstChunkTimer);
      this._stopHeartbeat();
      if (this._batchTimer) {
        clearTimeout(this._batchTimer);
        if (this._batchBuffer) this._emitSegment(this._batchBuffer, true);
        this._batchBuffer = '';
        this._batchTimer  = null;
      }
    }

    const result: OrchestratorResult = {
      accumulated   : this._accumulated,
      tokenCount    : this._tokenCount,
      durationMs    : Date.now() - this._startTime,
      state         : this._state,
      chunksReceived: this._chunksReceived,
      error         : lastError,
    };

    this.emit('complete', result);
    this.opts.onComplete?.(result);

    Logger.debug('[StreamOrchestrator] stream finished', {
      state     : result.state,
      tokens    : result.tokenCount,
      durationMs: result.durationMs,
    });

    return result;
  }

  // ── Progress estimation ────────────────────────────────────────────────────

  /**
   * Returns a 0–1 progress estimate based on estimated tokens emitted
   * vs the maxTokens budget.  Deliberately conservative (caps at 0.95).
   */
  estimateProgress(): number {
    if (this._state === 'completed') return 1.0;
    if (this._tokenCount === 0)      return 0.0;
    return Math.min(0.95, this._tokenCount / (this.opts.maxTokens ?? 1024));
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private _transition(state: StreamState): void {
    this._state = state;
    this.emit('state', state);
  }

  private _flush(delta: string, done: boolean): void {
    if (!delta && !done) return;

    if (this.opts.immediateFlushing) {
      this._emitSegment(delta, done);
      return;
    }

    // Batch window: accumulate delta and flush after batchWindowMs
    this._batchBuffer += delta;
    if (done) {
      if (this._batchTimer) { clearTimeout(this._batchTimer); this._batchTimer = null; }
      this._emitSegment(this._batchBuffer, true);
      this._batchBuffer = '';
      return;
    }
    if (!this._batchTimer) {
      this._batchTimer = setTimeout(() => {
        const seg = this._batchBuffer;
        this._batchBuffer = '';
        this._batchTimer  = null;
        if (seg) this._emitSegment(seg, false);
      }, this.opts.batchWindowMs);
    }
  }

  private _emitSegment(segment: string, done: boolean): void {
    this.emit('chunk', segment, this._accumulated, done);
    this.opts.onChunk?.(segment, this._accumulated, done);
  }

  private _startHeartbeat(): void {
    if (this._heartbeatTimer) return;
    this._heartbeatTimer = setInterval(() => {
      if (this._state === 'streaming') {
        this.emit('heartbeat', this.estimateProgress());
      }
    }, this.opts.heartbeatIntervalMs);
  }

  private _stopHeartbeat(): void {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  }

  private _estimateTokens(text: string): number {
    // Rough heuristic: 1 token ≈ 4 characters for English text
    return Math.ceil(text.length / 4);
  }
}

// ─── Factory helper ───────────────────────────────────────────────────────────

/**
 * Wraps a simple async generator that yields `{ delta, done }` chunks
 * into a full StreamOrchestrator run.
 *
 * Returns the accumulated text and a stream of SSE-ready data lines
 * via the onChunk callback.
 */
export async function runStream(
  source: AsyncIterable<StreamChunk>,
  opts  : OrchestratorOptions = {},
): Promise<OrchestratorResult> {
  const orchestrator = new StreamOrchestrator(opts);
  return orchestrator.run(source);
}
