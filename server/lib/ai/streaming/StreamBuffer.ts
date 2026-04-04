/**
 * StreamBuffer — Smooths bursty token streams for consistent UI rendering
 *
 * Problem: Providers often emit tokens in bursts followed by pauses.
 * Solution: Buffer tokens and emit them at a configurable max rate,
 * creating smooth, readable output regardless of provider behavior.
 */

import EventEmitter from "events";

// ─────────────────────────────────────────────
// Interfaces
// ─────────────────────────────────────────────

export interface IBufferConfig {
  maxBufferSize: number;        // Max chars to hold in buffer
  flushIntervalMs: number;      // Flush interval in ms (smooth delivery)
  maxCharsPerFlush: number;     // Max chars to emit per flush (rate limit)
  passthroughMode: boolean;     // If true, disable buffering (dev mode)
  backpressureThreshold: number; // Pause upstream if buffer exceeds this
}

const DEFAULT_BUFFER_CONFIG: IBufferConfig = {
  maxBufferSize: 8_192,
  flushIntervalMs: 16,       // ~60fps rendering
  maxCharsPerFlush: 200,     // Smooth reading speed
  passthroughMode: false,
  backpressureThreshold: 4_096,
};

export type BufferEvent = "data" | "drain" | "end" | "error" | "backpressure";

// ─────────────────────────────────────────────
// StreamBuffer
// ─────────────────────────────────────────────

export class StreamBuffer extends EventEmitter {
  private buffer = "";
  private isEnded = false;
  private isBackpressured = false;
  private flushTimer?: ReturnType<typeof setInterval>;
  private readonly config: IBufferConfig;

  constructor(config: Partial<IBufferConfig> = {}) {
    super();
    this.config = { ...DEFAULT_BUFFER_CONFIG, ...config };

    if (!this.config.passthroughMode) {
      this.startFlushing();
    }
  }

  /**
   * Push a text chunk into the buffer.
   * Returns whether upstream should pause (backpressure).
   */
  push(text: string): boolean {
    if (this.config.passthroughMode) {
      if (text) this.emit("data", text);
      return false;
    }

    this.buffer += text;

    // Enforce max buffer size — truncate to prevent unbounded growth
    if (this.buffer.length > this.config.maxBufferSize) {
      this.buffer = this.buffer.slice(-this.config.maxBufferSize);
      this.emit("error", new Error(`Buffer overflow: truncated to ${this.config.maxBufferSize} chars`));
    }

    // Signal backpressure
    if (this.buffer.length > this.config.backpressureThreshold && !this.isBackpressured) {
      this.isBackpressured = true;
      this.emit("backpressure", { bufferSize: this.buffer.length });
    }

    return this.isBackpressured;
  }

  /**
   * Signal end of stream. Buffer will drain then emit 'end'.
   */
  end(): void {
    this.isEnded = true;
    if (this.config.passthroughMode) {
      this.emit("end");
      return;
    }
    // Let the flush timer drain naturally, then emit end
  }

  /**
   * Force immediate flush of all buffered content.
   */
  flush(): void {
    if (this.buffer.length > 0) {
      const content = this.buffer;
      this.buffer = "";
      this.emit("data", content);
    }

    if (this.isEnded) {
      this.stop();
      this.emit("end");
    }
  }

  /**
   * Destroy the buffer immediately.
   */
  destroy(): void {
    this.stop();
    this.buffer = "";
    this.isEnded = true;
  }

  get size(): number {
    return this.buffer.length;
  }

  get isEmpty(): boolean {
    return this.buffer.length === 0;
  }

  /**
   * Convert this buffer into an async iterable of string chunks.
   * Useful for piping to SSE or WebSocket handlers.
   */
  async *[Symbol.asyncIterator](): AsyncGenerator<string> {
    const queue: string[] = [];
    let done = false;

    const onData = (chunk: string) => queue.push(chunk);
    const onEnd = () => { done = true; };

    this.on("data", onData);
    this.once("end", onEnd);

    try {
      while (!done || queue.length > 0) {
        if (queue.length > 0) {
          yield queue.shift()!;
        } else {
          await new Promise<void>((resolve) => {
            const check = () => {
              if (queue.length > 0 || done) {
                resolve();
              } else {
                setTimeout(check, this.config.flushIntervalMs);
              }
            };
            check();
          });
        }
      }
    } finally {
      this.off("data", onData);
      this.off("end", onEnd);
    }
  }

  // ─── Private ───

  private startFlushing(): void {
    this.flushTimer = setInterval(() => {
      if (this.buffer.length === 0) {
        if (this.isEnded) {
          this.stop();
          this.emit("end");
        }
        return;
      }

      // Emit up to maxCharsPerFlush chars
      const toEmit = this.buffer.slice(0, this.config.maxCharsPerFlush);
      this.buffer = this.buffer.slice(this.config.maxCharsPerFlush);

      this.emit("data", toEmit);

      // Release backpressure if drained
      if (this.isBackpressured && this.buffer.length < this.config.backpressureThreshold * 0.5) {
        this.isBackpressured = false;
        this.emit("drain");
      }

      // Emit end once buffer is empty
      if (this.isEnded && this.buffer.length === 0) {
        this.stop();
        this.emit("end");
      }
    }, this.config.flushIntervalMs);

    if (this.flushTimer.unref) this.flushTimer.unref();
  }

  private stop(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }
  }
}
