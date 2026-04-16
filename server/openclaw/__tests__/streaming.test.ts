import { describe, it, expect, vi } from 'vitest';
import { BlockStreamAccumulator } from '../streaming/blockStreaming';

describe('Block Streaming', () => {
  it('accumulates text and emits blocks when threshold is reached', () => {
    const onBlock = vi.fn();
    const acc = new BlockStreamAccumulator({ minChars: 10, maxChars: 50, onBlock });

    acc.push('Hello ');
    expect(onBlock).not.toHaveBeenCalled();

    acc.push('World! This is a test.');
    expect(onBlock).toHaveBeenCalledOnce();
    expect(onBlock.mock.calls[0][0]).toContain('Hello World!');
  });

  it('flushes remaining text on end', () => {
    const onBlock = vi.fn();
    const acc = new BlockStreamAccumulator({ minChars: 100, maxChars: 500, onBlock });

    acc.push('Short text');
    expect(onBlock).not.toHaveBeenCalled();

    acc.end();
    expect(onBlock).toHaveBeenCalledOnce();
    expect(onBlock.mock.calls[0][0]).toBe('Short text');
  });

  it('respects sentence boundaries for block breaks', () => {
    const onBlock = vi.fn();
    const acc = new BlockStreamAccumulator({ minChars: 10, maxChars: 50, onBlock });

    acc.push('First sentence. Second sentence. Third sentence.');
    acc.end();

    // Should break at sentence boundaries
    for (const call of onBlock.mock.calls) {
      const text = call[0] as string;
      expect(text.trimEnd().endsWith('.') || text.length < 10).toBe(true);
    }
  });

  it('tracks block indices incrementally', () => {
    const onBlock = vi.fn();
    const acc = new BlockStreamAccumulator({ minChars: 5, maxChars: 20, onBlock });

    acc.push('First block. Second block. Third block.');
    acc.end();

    // Each block should have incrementing indices
    const indices = onBlock.mock.calls.map(call => call[1]);
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i]).toBeGreaterThan(indices[i - 1]);
    }
  });

  it('force-emits when buffer exceeds maxChars', () => {
    const onBlock = vi.fn();
    const acc = new BlockStreamAccumulator({ minChars: 10, maxChars: 20, onBlock });

    // Push a long string without any sentence boundaries
    acc.push('abcdefghijklmnopqrstuvwxyz1234567890');

    expect(onBlock).toHaveBeenCalled();
    // All emitted blocks should be <= maxChars
    for (const call of onBlock.mock.calls) {
      expect((call[0] as string).length).toBeLessThanOrEqual(20);
    }
  });

  it('reports buffered length', () => {
    const onBlock = vi.fn();
    const acc = new BlockStreamAccumulator({ minChars: 100, maxChars: 500, onBlock });

    acc.push('hello');
    expect(acc.bufferedLength).toBe(5);

    acc.push(' world');
    expect(acc.bufferedLength).toBe(11);

    acc.end();
    expect(acc.bufferedLength).toBe(0);
  });
});
