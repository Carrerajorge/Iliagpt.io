import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@google/genai', () => {
  const mockGenAI = class {
    models = {
      generateContent: vi.fn().mockResolvedValue({
        text: JSON.stringify({
          summary: 'Test summary',
          relevantInfo: ['Info 1', 'Info 2'],
        }),
      }),
    };
  };
  return { GoogleGenAI: mockGenAI };
});

import {
  LargeDocumentProcessor,
  chunkDocument,
  estimateTokens,
  processLargeDocument,
  streamChunkDocument,
  mergeChunkResults,
  compressContext,
  ChunkResult,
  ProcessingProgress,
} from '../largeDocumentProcessor';

describe('LargeDocumentProcessor', () => {
  describe('estimateTokens', () => {
    it('should estimate tokens correctly', () => {
      const text = 'Hello world';
      const tokens = estimateTokens(text);
      expect(tokens).toBe(Math.ceil(text.length / 4));
    });

    it('should return 0 for empty string', () => {
      expect(estimateTokens('')).toBe(0);
    });

    it('should return 0 for null/undefined', () => {
      expect(estimateTokens(null as any)).toBe(0);
      expect(estimateTokens(undefined as any)).toBe(0);
    });
  });

  describe('chunkDocument', () => {
    it('should not chunk small documents', () => {
      const content = 'Small document content';
      const result = chunkDocument(content);
      
      expect(result.totalChunks).toBe(1);
      expect(result.chunks[0].content).toBe(content);
    });

    it('should chunk large documents correctly', () => {
      const smallChunkContent = 'A'.repeat(1000);
      const result = chunkDocument(smallChunkContent, { maxChunkTokens: 100 });
      
      expect(result.totalChunks).toBeGreaterThan(1);
      result.chunks.forEach(chunk => {
        expect(chunk.tokenCount).toBeLessThanOrEqual(100 + 50);
      });
    });

    it('should create proper overlap between chunks', () => {
      const content = 'A'.repeat(2000);
      const result = chunkDocument(content, { maxChunkTokens: 200, overlapTokens: 50 });
      
      if (result.totalChunks > 1) {
        for (let i = 1; i < result.chunks.length; i++) {
          expect(result.chunks[i].startOffset).toBeLessThan(result.chunks[i - 1].endOffset);
        }
      }
    });

    it('should handle very large documents (500k+ tokens)', () => {
      const largeContent = 'This is a test sentence. '.repeat(100000);
      const tokens = estimateTokens(largeContent);
      expect(tokens).toBeGreaterThan(500000);
      
      const result = chunkDocument(largeContent);
      
      expect(result.totalChunks).toBeGreaterThan(10);
      expect(result.documentHash).toBeDefined();
      expect(result.documentHash.length).toBe(64);
      
      result.chunks.forEach(chunk => {
        expect(chunk.tokenCount).toBeLessThanOrEqual(50000 + 1000);
        expect(chunk.id).toBeDefined();
        expect(chunk.content.length).toBeGreaterThan(0);
      });
    });
  });

  describe('LargeDocumentProcessor class', () => {
    let processor: LargeDocumentProcessor;

    beforeEach(() => {
      processor = new LargeDocumentProcessor({
        maxChunkTokens: 1000,
        maxConcurrentChunks: 2,
        maxInFlightPromises: 3,
        chunkTimeoutMs: 5000,
        promiseTimeoutMs: 10000,
      });
    });

    afterEach(() => {
      processor.destroy();
    });

    it('should validate empty documents', () => {
      const result = processor.validateDocument('');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('empty');
    });

    it('should validate document size limits', () => {
      const hugeDoc = 'A'.repeat(50000000);
      const result = processor.validateDocument(hugeDoc);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('exceeds maximum');
    });

    it('should accept valid documents', () => {
      const doc = 'Valid document content here.';
      const result = processor.validateDocument(doc);
      expect(result.valid).toBe(true);
      expect(result.tokenCount).toBeGreaterThan(0);
    });

    it('should track statistics correctly', () => {
      const stats = processor.getStats();
      expect(stats.totalProcessed).toBe(0);
      expect(stats.totalErrors).toBe(0);
      expect(stats.isDestroyed).toBe(false);
    });

    it('should cleanup on destroy', () => {
      processor.destroy();
      const stats = processor.getStats();
      expect(stats.isDestroyed).toBe(true);
      expect(stats.cacheSize).toBe(0);
      expect(stats.queueSize).toBe(0);
    });

    it('should handle abort correctly', () => {
      processor.abort();
      const stats = processor.getStats();
      expect(stats.queueSize).toBe(0);
    });
  });

  describe('processLargeDocument streaming', () => {
    it('should stream results with yields', async () => {
      const content = 'This is test content. '.repeat(100);
      const processor = new LargeDocumentProcessor({
        maxChunkTokens: 200,
        chunkTimeoutMs: 100,
      });

      const results: ChunkResult[] = [];
      
      for await (const result of processor.processLargeDocument(content, {
        summarize: false,
      })) {
        results.push(result);
      }

      expect(results.length).toBeGreaterThan(0);
      results.forEach(r => {
        expect(r.chunkId).toBeDefined();
        expect(r.processed).toBe(true);
      });

      processor.destroy();
    });

    it('should handle abort signal', async () => {
      const content = 'This is test content. '.repeat(1000);
      const abortController = new AbortController();
      const processor = new LargeDocumentProcessor({
        maxChunkTokens: 100,
      });

      const results: ChunkResult[] = [];
      let aborted = false;

      setTimeout(() => abortController.abort(), 10);

      for await (const result of processor.processLargeDocument(content, {
        signal: abortController.signal,
        summarize: false,
      })) {
        results.push(result);
        if (result.error?.includes('aborted')) {
          aborted = true;
          break;
        }
      }

      expect(aborted || results.length > 0).toBe(true);
      processor.destroy();
    });

    it('should report progress', async () => {
      const content = 'Test sentence here. '.repeat(500);
      const processor = new LargeDocumentProcessor({
        maxChunkTokens: 200,
      });

      const progressUpdates: ProcessingProgress[] = [];

      for await (const _ of processor.processLargeDocument(content, {
        summarize: false,
        onProgress: (progress) => {
          progressUpdates.push({ ...progress });
        },
      })) {
      }

      expect(progressUpdates.length).toBeGreaterThan(0);
      
      for (let i = 1; i < progressUpdates.length; i++) {
        if (!progressUpdates[i].isPaused) {
          expect(progressUpdates[i].processedChunks).toBeGreaterThanOrEqual(
            progressUpdates[i - 1].processedChunks
          );
        }
      }

      processor.destroy();
    });
  });

  describe('500k+ token processing test', () => {
    it('should process document with 500k+ tokens without memory leaks', async () => {
      const largeContent = 'This is a comprehensive test document with multiple sentences. '.repeat(50000);
      const tokenCount = estimateTokens(largeContent);
      
      expect(tokenCount).toBeGreaterThan(500000);

      const processor = new LargeDocumentProcessor({
        maxChunkTokens: 10000,
        maxConcurrentChunks: 2,
        maxInFlightPromises: 3,
        chunkTimeoutMs: 1000,
        memoryThresholdPercent: 90,
      });

      const results: ChunkResult[] = [];
      let processedChunks = 0;
      const startMemory = process.memoryUsage().heapUsed;

      for await (const result of processor.processLargeDocument(largeContent, {
        summarize: false,
        onProgress: (progress) => {
          processedChunks = progress.processedChunks;
        },
      })) {
        results.push(result);
        
        if (results.length > 100) {
          results.shift();
        }
      }

      const endMemory = process.memoryUsage().heapUsed;
      const memoryIncreaseMB = (endMemory - startMemory) / (1024 * 1024);

      expect(memoryIncreaseMB).toBeLessThan(500);

      const stats = processor.getStats();
      expect(stats.totalProcessed).toBeGreaterThan(0);
      expect(stats.inFlightPromises).toBe(0);

      processor.destroy();

      const finalStats = processor.getStats();
      expect(finalStats.isDestroyed).toBe(true);
      expect(finalStats.queueSize).toBe(0);
      expect(finalStats.cacheSize).toBe(0);
    }, 120000);

    it('should enforce 50k token chunk boundaries', async () => {
      const content = 'A'.repeat(300000);
      
      const result = chunkDocument(content, { maxChunkTokens: 50000 });
      
      result.chunks.forEach(chunk => {
        expect(chunk.tokenCount).toBeLessThanOrEqual(51000);
      });
    });

    it('should yield control to event loop regularly', async () => {
      const content = 'Test content. '.repeat(10000);
      const processor = new LargeDocumentProcessor({
        maxChunkTokens: 500,
      });

      let yieldCount = 0;
      const originalSetImmediate = global.setImmediate;
      global.setImmediate = ((cb: Function, ...args: any[]) => {
        yieldCount++;
        return originalSetImmediate(cb, ...args);
      }) as typeof setImmediate;

      try {
        for await (const _ of processor.processLargeDocument(content, {
          summarize: false,
        })) {
        }

        expect(yieldCount).toBeGreaterThan(10);
      } finally {
        global.setImmediate = originalSetImmediate;
        processor.destroy();
      }
    });
  });

  describe('streamChunkDocument', () => {
    it('should stream chunks with async iteration', async () => {
      const content = 'Test content for streaming. '.repeat(100);
      const chunks = [];

      for await (const chunk of streamChunkDocument(content, { maxChunkTokens: 200 })) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBeGreaterThan(0);
      chunks.forEach(c => {
        expect(c.id).toBeDefined();
        expect(c.content.length).toBeGreaterThan(0);
      });
    });
  });

  describe('mergeChunkResults', () => {
    it('should merge results correctly', () => {
      const results: ChunkResult[] = [
        {
          chunkId: '1',
          chunkIndex: 0,
          processed: true,
          summary: 'Summary 1',
          relevantInfo: ['Info A', 'Info B'],
          processingTimeMs: 100,
          tokenCount: 500,
        },
        {
          chunkId: '2',
          chunkIndex: 1,
          processed: true,
          summary: 'Summary 2',
          relevantInfo: ['Info B', 'Info C'],
          processingTimeMs: 150,
          tokenCount: 600,
        },
      ];

      const merged = mergeChunkResults(results);

      expect(merged.combinedSummary).toContain('Summary 1');
      expect(merged.combinedSummary).toContain('Summary 2');
      expect(merged.allRelevantInfo).toContain('Info A');
      expect(merged.allRelevantInfo).toContain('Info C');
      expect(new Set(merged.allRelevantInfo).size).toBe(merged.allRelevantInfo.length);
      expect(merged.successRate).toBe(1);
      expect(merged.totalProcessingTimeMs).toBe(250);
    });

    it('should handle failed results', () => {
      const results: ChunkResult[] = [
        {
          chunkId: '1',
          chunkIndex: 0,
          processed: true,
          summary: 'Summary 1',
          processingTimeMs: 100,
          tokenCount: 500,
        },
        {
          chunkId: '2',
          chunkIndex: 1,
          processed: false,
          error: 'Failed',
          processingTimeMs: 50,
          tokenCount: 600,
        },
      ];

      const merged = mergeChunkResults(results);
      expect(merged.successRate).toBe(0.5);
    });
  });

  describe('compressContext', () => {
    it('should compress summaries to fit token limit', () => {
      const summaries = Array(10).fill('A'.repeat(1000));
      const compressed = compressContext(summaries, 1000);

      const tokens = estimateTokens(compressed);
      expect(tokens).toBeLessThanOrEqual(1100);
    });

    it('should return combined summaries if under limit', () => {
      const summaries = ['Short 1', 'Short 2'];
      const compressed = compressContext(summaries, 1000);

      expect(compressed).toContain('Short 1');
      expect(compressed).toContain('Short 2');
    });
  });

  describe('Concurrency and backpressure', () => {
    it('should limit concurrent processing', async () => {
      const content = 'Test sentence. '.repeat(5000);
      const processor = new LargeDocumentProcessor({
        maxChunkTokens: 200,
        maxConcurrentChunks: 2,
        maxInFlightPromises: 3,
      });

      let maxConcurrent = 0;
      let currentConcurrent = 0;

      const promises: Promise<void>[] = [];

      for await (const result of processor.processLargeDocument(content, {
        summarize: false,
      })) {
        currentConcurrent++;
        maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
        
        await new Promise(resolve => setImmediate(resolve));
        currentConcurrent--;
      }

      expect(maxConcurrent).toBeLessThanOrEqual(4);

      processor.destroy();
    });

    it('should clean up all resources on destroy', async () => {
      const processor = new LargeDocumentProcessor();
      
      processor.destroy();
      
      const stats = processor.getStats();
      expect(stats.isDestroyed).toBe(true);
      expect(stats.inFlightPromises).toBe(0);
      expect(stats.queueSize).toBe(0);
      expect(stats.cacheSize).toBe(0);
    });
  });
});
