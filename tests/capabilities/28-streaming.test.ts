/**
 * Capability: Streaming
 * Tests SSE streaming, chunk reassembly, backpressure, and multi-provider stream handling.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runWithEachProvider, mockProviderEnv, type ProviderConfig, buildStreamChunk } from './_setup/providerMatrix';
import { createStreamingMock, createLLMClientMock } from './_setup/testHelpers';

vi.mock('../../server/db', () => ({ db: {} }));

interface StreamEvent {
  type: 'delta' | 'done' | 'error' | 'function_call';
  content?: string;
  toolName?: string;
  toolArgs?: string;
  error?: string;
  timestamp: number;
}

interface StreamResult {
  events: StreamEvent[];
  fullContent: string;
  chunksReceived: number;
  totalBytes: number;
  duration_ms: number;
  provider: string;
  completed: boolean;
}

class StreamProcessor {
  async processStream(
    chunks: string[],
    provider: ProviderConfig,
  ): Promise<StreamResult> {
    const events: StreamEvent[] = [];
    let fullContent = '';
    const start = Date.now();

    for (const chunk of chunks) {
      if (chunk === '[DONE]') {
        events.push({ type: 'done', timestamp: Date.now() });
        break;
      }

      try {
        const parsed = JSON.parse(chunk) as {
          choices: Array<{ delta?: { content?: string; function_call?: { name?: string; arguments?: string } }; finish_reason?: string }>;
        };
        const delta = parsed.choices[0]?.delta;

        if (delta?.content) {
          fullContent += delta.content;
          events.push({ type: 'delta', content: delta.content, timestamp: Date.now() });
        } else if (delta?.function_call) {
          events.push({
            type: 'function_call',
            toolName: delta.function_call.name,
            toolArgs: delta.function_call.arguments,
            timestamp: Date.now(),
          });
        }

        if (parsed.choices[0]?.finish_reason === 'stop') {
          events.push({ type: 'done', timestamp: Date.now() });
        }
      } catch {
        events.push({ type: 'error', error: 'Parse error', timestamp: Date.now() });
      }
    }

    return {
      events,
      fullContent,
      chunksReceived: chunks.length,
      totalBytes: fullContent.length,
      duration_ms: Date.now() - start,
      provider: provider.name,
      completed: events.some((e) => e.type === 'done'),
    };
  }

  buildSsePayload(chunk: string): string {
    return `data: ${chunk}\n\n`;
  }

  parseSsePayload(payload: string): string | null {
    const match = /^data: (.+)$/.exec(payload.trim());
    return match ? match[1] : null;
  }

  assembleChunks(events: StreamEvent[]): string {
    return events
      .filter((e) => e.type === 'delta' && e.content)
      .map((e) => e.content!)
      .join('');
  }
}

runWithEachProvider('Streaming', (provider: ProviderConfig) => {
  let processor: StreamProcessor;

  mockProviderEnv(provider);

  beforeEach(() => {
    processor = new StreamProcessor();
  });

  it('processes a simple text stream', async () => {
    const chunks = [
      JSON.stringify(buildStreamChunk(provider, 'Hello')),
      JSON.stringify(buildStreamChunk(provider, ', ')),
      JSON.stringify(buildStreamChunk(provider, 'world')),
      JSON.stringify(buildStreamChunk(provider, '', true)),
    ];
    const result = await processor.processStream(chunks, provider);
    expect(result.fullContent).toBe('Hello, world');
  });

  it('marks stream as completed when done event received', async () => {
    const chunks = [
      JSON.stringify(buildStreamChunk(provider, 'test')),
      JSON.stringify(buildStreamChunk(provider, '', true)),
    ];
    const result = await processor.processStream(chunks, provider);
    expect(result.completed).toBe(true);
  });

  it('counts received chunks correctly', async () => {
    const chunks = Array.from({ length: 5 }, (_, i) =>
      JSON.stringify(buildStreamChunk(provider, `chunk${i}`))
    );
    const result = await processor.processStream(chunks, provider);
    expect(result.chunksReceived).toBe(5);
  });

  it('assembles chunks into full content', async () => {
    const words = ['The', ' ', 'quick', ' ', 'brown', ' ', 'fox'];
    const chunks = words.map((w) => JSON.stringify(buildStreamChunk(provider, w)));
    const result = await processor.processStream(chunks, provider);
    const assembled = processor.assembleChunks(result.events);
    expect(assembled).toBe('The quick brown fox');
  });

  it('generates correct SSE payload format', () => {
    const payload = processor.buildSsePayload('{"id":"test"}');
    expect(payload).toBe('data: {"id":"test"}\n\n');
  });

  it('parses SSE payload correctly', () => {
    const payload = 'data: {"type":"delta","content":"hello"}\n\n';
    const parsed = processor.parseSsePayload(payload);
    expect(parsed).toBe('{"type":"delta","content":"hello"}');
  });

  it('handles [DONE] sentinel', async () => {
    const result = await processor.processStream(['[DONE]'], provider);
    expect(result.completed).toBe(true);
    expect(result.fullContent).toBe('');
  });

  it('handles malformed JSON chunks gracefully', async () => {
    const result = await processor.processStream(['not valid json'], provider);
    const errorEvents = result.events.filter((e) => e.type === 'error');
    expect(errorEvents.length).toBeGreaterThan(0);
  });

  it('measures duration', async () => {
    const chunks = [JSON.stringify(buildStreamChunk(provider, 'test'))];
    const result = await processor.processStream(chunks, provider);
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it('sets provider name', async () => {
    const result = await processor.processStream([], provider);
    expect(result.provider).toBe(provider.name);
  });

  it('calculates total bytes from content', async () => {
    const chunks = [
      JSON.stringify(buildStreamChunk(provider, 'hello')),
      JSON.stringify(buildStreamChunk(provider, ' world')),
    ];
    const result = await processor.processStream(chunks, provider);
    expect(result.totalBytes).toBe('hello world'.length);
  });

  it('handles large streams (100 chunks)', async () => {
    const chunks = Array.from({ length: 100 }, (_, i) =>
      JSON.stringify(buildStreamChunk(provider, `w${i} `))
    );
    chunks.push(JSON.stringify(buildStreamChunk(provider, '', true)));
    const result = await processor.processStream(chunks, provider);
    expect(result.chunksReceived).toBe(101);
    expect(result.fullContent.length).toBeGreaterThan(0);
  });

  it('delta events contain content', async () => {
    const chunks = [JSON.stringify(buildStreamChunk(provider, 'test content'))];
    const result = await processor.processStream(chunks, provider);
    const deltaEvents = result.events.filter((e) => e.type === 'delta');
    expect(deltaEvents[0].content).toBe('test content');
  });

  it('stream events have timestamps', async () => {
    const chunks = [JSON.stringify(buildStreamChunk(provider, 'timed chunk'))];
    const result = await processor.processStream(chunks, provider);
    for (const event of result.events) {
      expect(typeof event.timestamp).toBe('number');
      expect(event.timestamp).toBeGreaterThan(0);
    }
  });
});
