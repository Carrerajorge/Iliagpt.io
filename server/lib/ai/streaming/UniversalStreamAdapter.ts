/**
 * Universal Stream Adapter
 *
 * Normalizes streaming output from all providers into a consistent
 * IStreamChunk sequence. Provides utilities:
 *   - adaptStream()      — pass-through with buffering/error recovery
 *   - collectToResponse() — buffer entire stream → IChatResponse
 *   - toSSE()            — convert to Server-Sent Events text
 *   - tee()              — fork one generator into two independent readers
 *   - merge()            — interleave multiple provider streams
 *   - withHeartbeat()    — inject keepalive chunks on long silences
 */

import {
  IStreamChunk,
  IStreamDeltaChunk,
  IChatResponse,
  ITokenUsage,
  MessageRole,
} from '../providers/core/types';

// ─── SSE formatting ───────────────────────────────────────────────────────────

export function chunkToSSE(chunk: IStreamChunk): string {
  return `data: ${JSON.stringify(chunk)}\n\n`;
}

export function sseTerminator(): string {
  return 'data: [DONE]\n\n';
}

// ─── Tee: split one async generator into two ─────────────────────────────────

export function tee<T>(source: AsyncGenerator<T>): [AsyncGenerator<T>, AsyncGenerator<T>] {
  const queue1: T[] = [];
  const queue2: T[] = [];
  const resolvers1: Array<(v: IteratorResult<T>) => void> = [];
  const resolvers2: Array<(v: IteratorResult<T>) => void> = [];
  let done = false;
  let error: unknown;

  async function pump() {
    try {
      for await (const item of source) {
        queue1.push(item);
        queue2.push(item);
        if (resolvers1.length) resolvers1.shift()!({ value: item, done: false });
        if (resolvers2.length) resolvers2.shift()!({ value: item, done: false });
      }
    } catch (err) {
      error = err;
    } finally {
      done = true;
      const sentinel: IteratorResult<T> = { value: undefined as T, done: true };
      resolvers1.forEach((r) => r(sentinel));
      resolvers2.forEach((r) => r(sentinel));
    }
  }

  pump();

  function makeReader(queue: T[], resolvers: Array<(v: IteratorResult<T>) => void>): AsyncGenerator<T> {
    return {
      [Symbol.asyncIterator]() { return this; },
      async next(): Promise<IteratorResult<T>> {
        if (queue.length > 0) return { value: queue.shift()!, done: false };
        if (done) {
          if (error) throw error;
          return { value: undefined as T, done: true };
        }
        return new Promise((resolve) => resolvers.push(resolve));
      },
      async return() { return { value: undefined as T, done: true }; },
      async throw(err: unknown) { throw err; },
    };
  }

  return [makeReader(queue1, resolvers1), makeReader(queue2, resolvers2)];
}

// ─── Merge: interleave multiple streams ──────────────────────────────────────

export async function* merge<T>(generators: AsyncGenerator<T>[]): AsyncGenerator<T> {
  type Item = { index: number; result: IteratorResult<T> };
  const pending = new Map<number, Promise<Item>>();

  generators.forEach((gen, i) => {
    pending.set(i, gen.next().then((result) => ({ index: i, result })));
  });

  while (pending.size > 0) {
    const { index, result } = await Promise.race(pending.values());
    if (result.done) {
      pending.delete(index);
    } else {
      yield result.value;
      pending.set(
        index,
        generators[index].next().then((r) => ({ index, result: r })),
      );
    }
  }
}

// ─── Main adapter ─────────────────────────────────────────────────────────────

export class UniversalStreamAdapter {

  /**
   * Pass-through adapter that validates and re-emits chunks.
   * Catches errors from the underlying generator and yields error chunks.
   */
  async *adaptStream(
    source: AsyncGenerator<IStreamChunk>,
    options: { onChunk?: (chunk: IStreamChunk) => void } = {},
  ): AsyncGenerator<IStreamChunk> {
    try {
      for await (const chunk of source) {
        options.onChunk?.(chunk);
        yield chunk;
        if (chunk.type === 'done' || chunk.type === 'error') break;
      }
    } catch (err) {
      const errorChunk: IStreamChunk = {
        type: 'error',
        id: 'adapter_error',
        model: 'unknown',
        provider: 'adapter',
        error: err instanceof Error ? err.message : String(err),
        finishReason: null,
      };
      options.onChunk?.(errorChunk);
      yield errorChunk;
    }
  }

  /**
   * Injects keepalive comment chunks if no data arrives within silenceMs.
   * Prevents proxies/clients from timing out on long generations.
   */
  async *withHeartbeat(
    source: AsyncGenerator<IStreamChunk>,
    silenceMs = 15_000,
  ): AsyncGenerator<IStreamChunk | { type: 'heartbeat' }> {
    let lastActivity = Date.now();
    let heartbeatInterval: NodeJS.Timeout | null = null;
    const queue: Array<IStreamChunk | { type: 'heartbeat' }> = [];
    let resolve: (() => void) | null = null;
    let sourceDone = false;

    heartbeatInterval = setInterval(() => {
      if (Date.now() - lastActivity >= silenceMs) {
        queue.push({ type: 'heartbeat' });
        resolve?.();
        resolve = null;
      }
    }, Math.min(silenceMs, 5_000));

    const consumeSource = async () => {
      try {
        for await (const chunk of source) {
          lastActivity = Date.now();
          queue.push(chunk);
          resolve?.();
          resolve = null;
          if (chunk.type === 'done' || chunk.type === 'error') break;
        }
      } finally {
        sourceDone = true;
        resolve?.();
        resolve = null;
      }
    };

    consumeSource();

    try {
      while (!sourceDone || queue.length > 0) {
        if (queue.length === 0) {
          await new Promise<void>((r) => { resolve = r; });
        }
        while (queue.length > 0) {
          yield queue.shift()!;
        }
      }
    } finally {
      if (heartbeatInterval) clearInterval(heartbeatInterval);
    }
  }

  /**
   * Collect an entire stream into a single IChatResponse.
   * Useful for providers where you want to expose a non-streaming API
   * but only have a streaming backend.
   */
  async collectToResponse(
    stream: AsyncGenerator<IStreamChunk>,
    defaults: { provider: string; model: string },
  ): Promise<IChatResponse> {
    let content = '';
    let id = this._generateId();
    let finishReason: IChatResponse['finishReason'] = null;
    let usage: ITokenUsage | undefined;
    const toolCallBuffers: Record<number, { id: string; name: string; args: string }> = {};

    for await (const chunk of stream) {
      switch (chunk.type) {
        case 'delta':
          content += chunk.delta;
          id = chunk.id;
          break;

        case 'tool_call_delta': {
          const buf = toolCallBuffers[chunk.toolCallIndex] ?? { id: chunk.toolCallId ?? '', name: chunk.functionName ?? '', args: '' };
          if (chunk.toolCallId) buf.id = chunk.toolCallId;
          if (chunk.functionName) buf.name = chunk.functionName;
          buf.args += chunk.argumentsDelta;
          toolCallBuffers[chunk.toolCallIndex] = buf;
          break;
        }

        case 'usage':
          usage = chunk.usage;
          finishReason = chunk.finishReason;
          break;

        case 'done':
          if (chunk.finishReason) finishReason = chunk.finishReason;
          break;

        case 'error':
          throw new Error(`Stream error: ${chunk.error}`);
      }
    }

    const toolCalls = Object.values(toolCallBuffers).map((buf) => ({
      id: buf.id,
      type: 'function' as const,
      function: { name: buf.name, arguments: buf.args },
    }));

    return {
      id,
      content,
      role: MessageRole.Assistant,
      model: defaults.model,
      provider: defaults.provider,
      usage: usage ?? { promptTokens: 0, completionTokens: Math.ceil(content.length / 4), totalTokens: Math.ceil(content.length / 4) },
      finishReason,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      latencyMs: 0,
    };
  }

  /**
   * Convert a stream to SSE text suitable for streaming HTTP responses.
   * Each yielded string can be directly written to a response.
   */
  async *toSSE(stream: AsyncGenerator<IStreamChunk>): AsyncGenerator<string> {
    for await (const chunk of stream) {
      yield chunkToSSE(chunk);
      if (chunk.type === 'done' || chunk.type === 'error') break;
    }
    yield sseTerminator();
  }

  /**
   * Convert a stream to NDJSON (newline-delimited JSON).
   * Useful for non-browser consumers.
   */
  async *toNDJSON(stream: AsyncGenerator<IStreamChunk>): AsyncGenerator<string> {
    for await (const chunk of stream) {
      yield JSON.stringify(chunk) + '\n';
      if (chunk.type === 'done' || chunk.type === 'error') break;
    }
  }

  /**
   * Extract only the text delta content from a stream.
   * Useful for building text UIs without handling all chunk types.
   */
  async *textOnly(stream: AsyncGenerator<IStreamChunk>): AsyncGenerator<string> {
    for await (const chunk of stream) {
      if (chunk.type === 'delta') yield chunk.delta;
      if (chunk.type === 'done' || chunk.type === 'error') break;
    }
  }

  /**
   * Merge streams from multiple providers and yield chunks in arrival order.
   * Each chunk is tagged with its source provider (already in chunk.provider).
   */
  async *mergeStreams(streams: AsyncGenerator<IStreamChunk>[]): AsyncGenerator<IStreamChunk> {
    yield* merge(streams);
  }

  /**
   * Buffer chunks and yield them in fixed-size token batches.
   * Useful for reducing UI update frequency on fast models.
   */
  async *batch(
    stream: AsyncGenerator<IStreamChunk>,
    minChars = 20,
  ): AsyncGenerator<IStreamChunk> {
    let buffer = '';
    let lastDeltaChunk: IStreamDeltaChunk | null = null;

    for await (const chunk of stream) {
      if (chunk.type === 'delta') {
        buffer += chunk.delta;
        lastDeltaChunk = chunk;
        if (buffer.length >= minChars) {
          yield { ...lastDeltaChunk, delta: buffer };
          buffer = '';
          lastDeltaChunk = null;
        }
      } else {
        // Flush remaining buffer
        if (buffer && lastDeltaChunk) {
          yield { ...lastDeltaChunk, delta: buffer };
          buffer = '';
          lastDeltaChunk = null;
        }
        yield chunk;
        if (chunk.type === 'done' || chunk.type === 'error') break;
      }
    }
  }

  private _generateId(): string {
    return `stream_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  }
}

export const streamAdapter = new UniversalStreamAdapter();
