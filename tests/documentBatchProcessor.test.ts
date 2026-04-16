import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

let mockGetObjectEntityBuffer: ReturnType<typeof vi.fn>;
let MockObjectNotFoundError: new (message: string) => Error;

vi.mock('../server/replit_integrations/object_storage/objectStorage', async (importOriginal) => {
  const mockFn = vi.fn();
  
  class ObjectNotFoundErrorMock extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'ObjectNotFoundError';
    }
  }
  
  class MockObjectStorageService {
    async getObjectEntityBuffer(storagePath: string): Promise<Buffer> {
      return mockFn(storagePath);
    }
  }
  
  (globalThis as any).__mockGetObjectEntityBuffer = mockFn;
  (globalThis as any).__MockObjectNotFoundError = ObjectNotFoundErrorMock;
  
  return {
    ObjectStorageService: MockObjectStorageService,
    ObjectNotFoundError: ObjectNotFoundErrorMock,
  };
});

import { DocumentBatchProcessor, type SimpleAttachment, type BatchProcessingResult } from '../server/services/documentBatchProcessor';

const fixturesPath = path.join(__dirname, 'fixtures', 'documents');

const loadFixture = (filename: string): Buffer => {
  return fs.readFileSync(path.join(fixturesPath, filename));
};

describe('DocumentBatchProcessor Integration Tests', () => {
  let processor: DocumentBatchProcessor;

  beforeEach(() => {
    mockGetObjectEntityBuffer = (globalThis as any).__mockGetObjectEntityBuffer;
    MockObjectNotFoundError = (globalThis as any).__MockObjectNotFoundError;
    mockGetObjectEntityBuffer.mockReset();
    processor = new DocumentBatchProcessor();
  });

  describe('Single file processing', () => {
    it('should process a single text file correctly', async () => {
      const txtBuffer = loadFixture('sample.txt');
      mockGetObjectEntityBuffer.mockResolvedValue(txtBuffer);

      const attachments: SimpleAttachment[] = [
        {
          name: 'sample.txt',
          mimeType: 'text/plain',
          storagePath: 'uploads/sample.txt',
        },
      ];

      const result = await processor.processBatch(attachments);

      expect(result.attachmentsCount).toBe(1);
      expect(result.processedFiles).toBe(1);
      expect(result.failedFiles).toHaveLength(0);
      expect(result.chunks.length).toBeGreaterThan(0);
      expect(result.stats).toHaveLength(1);
      
      const stat = result.stats[0];
      expect(stat.filename).toBe('sample.txt');
      expect(stat.status).toBe('success');
      expect(stat.bytesRead).toBeGreaterThan(0);
      expect(stat.tokensExtracted).toBeGreaterThan(0);
      expect(stat.parseTimeMs).toBeGreaterThanOrEqual(0);
      expect(stat.chunkCount).toBeGreaterThan(0);
    });

    it('should process a CSV file with row locations', async () => {
      const csvBuffer = loadFixture('sample.csv');
      mockGetObjectEntityBuffer.mockResolvedValue(csvBuffer);

      const attachments: SimpleAttachment[] = [
        {
          name: 'data.csv',
          mimeType: 'text/csv',
          storagePath: 'uploads/data.csv',
        },
      ];

      const result = await processor.processBatch(attachments);

      expect(result.processedFiles).toBe(1);
      expect(result.failedFiles).toHaveLength(0);
      expect(result.chunks.length).toBeGreaterThan(0);
      
      const csvChunk = result.chunks[0];
      expect(csvChunk.location).toHaveProperty('row');
      expect(typeof csvChunk.location.row).toBe('number');
      expect(csvChunk.content).toContain('id');
      expect(csvChunk.content).toContain('name');
    });

    it('should process a JSON file as text', async () => {
      const jsonBuffer = loadFixture('sample.json');
      mockGetObjectEntityBuffer.mockResolvedValue(jsonBuffer);

      const attachments: SimpleAttachment[] = [
        {
          name: 'config.json',
          mimeType: 'application/json',
          storagePath: 'uploads/config.json',
        },
      ];

      const result = await processor.processBatch(attachments);

      expect(result.processedFiles).toBe(1);
      expect(result.failedFiles).toHaveLength(0);
      expect(result.chunks.length).toBeGreaterThan(0);
      expect(result.unifiedContext).toContain('company');
      expect(result.unifiedContext).toContain('employees');
    });
  });

  describe('Multiple files processing', () => {
    it('should process multiple files (txt, csv, json) correctly', async () => {
      const txtBuffer = loadFixture('sample.txt');
      const csvBuffer = loadFixture('sample.csv');
      const jsonBuffer = loadFixture('sample.json');

      mockGetObjectEntityBuffer
        .mockResolvedValueOnce(txtBuffer)
        .mockResolvedValueOnce(csvBuffer)
        .mockResolvedValueOnce(jsonBuffer);

      const attachments: SimpleAttachment[] = [
        {
          name: 'document.txt',
          mimeType: 'text/plain',
          storagePath: 'uploads/document.txt',
        },
        {
          name: 'data.csv',
          mimeType: 'text/csv',
          storagePath: 'uploads/data.csv',
        },
        {
          name: 'config.json',
          mimeType: 'application/json',
          storagePath: 'uploads/config.json',
        },
      ];

      const result = await processor.processBatch(attachments);

      expect(result.attachmentsCount).toBe(3);
      expect(result.processedFiles).toBe(3);
      expect(result.failedFiles).toHaveLength(0);
      expect(result.stats).toHaveLength(3);
      
      const filenames = result.stats.map(s => s.filename);
      expect(filenames).toContain('document.txt');
      expect(filenames).toContain('data.csv');
      expect(filenames).toContain('config.json');
      
      result.stats.forEach(stat => {
        expect(stat.status).toBe('success');
      });
    });

    it('should maintain coverage: processedFiles equals attachmentsCount for valid files', async () => {
      const txtBuffer = loadFixture('sample.txt');
      const csvBuffer = loadFixture('sample.csv');

      mockGetObjectEntityBuffer
        .mockResolvedValueOnce(txtBuffer)
        .mockResolvedValueOnce(csvBuffer);

      const attachments: SimpleAttachment[] = [
        {
          name: 'file1.txt',
          mimeType: 'text/plain',
          storagePath: 'uploads/file1.txt',
        },
        {
          name: 'file2.csv',
          mimeType: 'text/csv',
          storagePath: 'uploads/file2.csv',
        },
      ];

      const result = await processor.processBatch(attachments);

      expect(result.processedFiles).toBe(result.attachmentsCount);
      expect(result.failedFiles).toHaveLength(0);
    });
  });

  describe('Observability and stats verification', () => {
    it('should include all required stats fields', async () => {
      const txtBuffer = loadFixture('sample.txt');
      mockGetObjectEntityBuffer.mockResolvedValue(txtBuffer);

      const attachments: SimpleAttachment[] = [
        {
          name: 'test.txt',
          mimeType: 'text/plain',
          storagePath: 'uploads/test.txt',
        },
      ];

      const result = await processor.processBatch(attachments);

      expect(result.stats).toHaveLength(1);
      const stat = result.stats[0];
      
      expect(stat).toHaveProperty('filename');
      expect(stat).toHaveProperty('bytesRead');
      expect(stat).toHaveProperty('pagesProcessed');
      expect(stat).toHaveProperty('tokensExtracted');
      expect(stat).toHaveProperty('parseTimeMs');
      expect(stat).toHaveProperty('chunkCount');
      expect(stat).toHaveProperty('status');
      
      expect(typeof stat.bytesRead).toBe('number');
      expect(typeof stat.tokensExtracted).toBe('number');
      expect(typeof stat.parseTimeMs).toBe('number');
      expect(typeof stat.chunkCount).toBe('number');
      
      expect(stat.bytesRead).toBe(txtBuffer.length);
    });

    it('should calculate totalTokens correctly across all files', async () => {
      const txtBuffer = loadFixture('sample.txt');
      const csvBuffer = loadFixture('sample.csv');

      mockGetObjectEntityBuffer
        .mockResolvedValueOnce(txtBuffer)
        .mockResolvedValueOnce(csvBuffer);

      const attachments: SimpleAttachment[] = [
        {
          name: 'doc1.txt',
          mimeType: 'text/plain',
          storagePath: 'uploads/doc1.txt',
        },
        {
          name: 'doc2.csv',
          mimeType: 'text/csv',
          storagePath: 'uploads/doc2.csv',
        },
      ];

      const result = await processor.processBatch(attachments);

      const sumTokens = result.stats.reduce((sum, s) => sum + s.tokensExtracted, 0);
      expect(result.totalTokens).toBe(sumTokens);
    });
  });

  describe('Chunks with correct locations', () => {
    it('should create chunks with proper location for text files', async () => {
      const txtBuffer = loadFixture('sample.txt');
      mockGetObjectEntityBuffer.mockResolvedValue(txtBuffer);

      const attachments: SimpleAttachment[] = [
        {
          name: 'readme.txt',
          mimeType: 'text/plain',
          storagePath: 'uploads/readme.txt',
        },
      ];

      const result = await processor.processBatch(attachments);

      expect(result.chunks.length).toBeGreaterThan(0);
      result.chunks.forEach(chunk => {
        expect(chunk.docId).toBeDefined();
        expect(chunk.filename).toBe('readme.txt');
        expect(chunk.location).toBeDefined();
        expect(chunk.content).toBeDefined();
        expect(chunk.offsets).toHaveProperty('start');
        expect(chunk.offsets).toHaveProperty('end');
      });
    });

    it('should create CSV chunks with row in location', async () => {
      const csvBuffer = loadFixture('sample.csv');
      mockGetObjectEntityBuffer.mockResolvedValue(csvBuffer);

      const attachments: SimpleAttachment[] = [
        {
          name: 'employees.csv',
          mimeType: 'text/csv',
          storagePath: 'uploads/employees.csv',
        },
      ];

      const result = await processor.processBatch(attachments);

      expect(result.chunks.length).toBeGreaterThan(0);
      
      const hasRowLocation = result.chunks.some(chunk => 
        chunk.location.row !== undefined && typeof chunk.location.row === 'number'
      );
      expect(hasRowLocation).toBe(true);
    });

    it('should normalize content in chunks', async () => {
      const txtBuffer = loadFixture('sample.txt');
      mockGetObjectEntityBuffer.mockResolvedValue(txtBuffer);

      const attachments: SimpleAttachment[] = [
        {
          name: 'doc.txt',
          mimeType: 'text/plain',
          storagePath: 'uploads/doc.txt',
        },
      ];

      const result = await processor.processBatch(attachments);

      result.chunks.forEach(chunk => {
        expect(chunk.content).not.toContain('\u0000');
        expect(chunk.content.trim()).toBe(chunk.content);
      });
    });
  });

  describe('Unified context with citations', () => {
    it('should build unified context with proper document citations', async () => {
      const txtBuffer = loadFixture('sample.txt');
      mockGetObjectEntityBuffer.mockResolvedValue(txtBuffer);

      const attachments: SimpleAttachment[] = [
        {
          name: 'report.txt',
          mimeType: 'text/plain',
          storagePath: 'uploads/report.txt',
        },
      ];

      const result = await processor.processBatch(attachments);

      expect(result.unifiedContext).toBeDefined();
      expect(result.unifiedContext.length).toBeGreaterThan(0);
      expect(result.unifiedContext).toContain('doc:report.txt');
    });

    it('should include citations for multiple documents', async () => {
      const txtBuffer = loadFixture('sample.txt');
      const csvBuffer = loadFixture('sample.csv');

      mockGetObjectEntityBuffer
        .mockResolvedValueOnce(txtBuffer)
        .mockResolvedValueOnce(csvBuffer);

      const attachments: SimpleAttachment[] = [
        {
          name: 'notes.txt',
          mimeType: 'text/plain',
          storagePath: 'uploads/notes.txt',
        },
        {
          name: 'sales.csv',
          mimeType: 'text/csv',
          storagePath: 'uploads/sales.csv',
        },
      ];

      const result = await processor.processBatch(attachments);

      expect(result.unifiedContext).toContain('doc:notes.txt');
      expect(result.unifiedContext).toContain('doc:sales.csv');
    });

    it('should format CSV citations with row reference', async () => {
      const csvBuffer = loadFixture('sample.csv');
      mockGetObjectEntityBuffer.mockResolvedValue(csvBuffer);

      const attachments: SimpleAttachment[] = [
        {
          name: 'data.csv',
          mimeType: 'text/csv',
          storagePath: 'uploads/data.csv',
        },
      ];

      const result = await processor.processBatch(attachments);

      expect(result.unifiedContext).toContain('row:');
    });
  });

  describe('Error handling', () => {
    it('should handle file not found errors gracefully', async () => {
      mockGetObjectEntityBuffer.mockRejectedValue(
        new MockObjectNotFoundError('File not found: uploads/missing.txt')
      );

      const attachments: SimpleAttachment[] = [
        {
          name: 'missing.txt',
          mimeType: 'text/plain',
          storagePath: 'uploads/missing.txt',
        },
      ];

      const result = await processor.processBatch(attachments);

      expect(result.attachmentsCount).toBe(1);
      expect(result.processedFiles).toBe(0);
      expect(result.failedFiles).toHaveLength(1);
      expect(result.failedFiles[0].filename).toBe('missing.txt');
      expect(result.failedFiles[0].error).toContain('not found');
      
      expect(result.stats).toHaveLength(1);
      expect(result.stats[0].status).toBe('failed');
      expect(result.stats[0].error).toBeDefined();
    });

    it('should continue processing other files when one fails', async () => {
      const txtBuffer = loadFixture('sample.txt');

      mockGetObjectEntityBuffer
        .mockRejectedValueOnce(new MockObjectNotFoundError('File not found'))
        .mockResolvedValueOnce(txtBuffer);

      const attachments: SimpleAttachment[] = [
        {
          name: 'missing.txt',
          mimeType: 'text/plain',
          storagePath: 'uploads/missing.txt',
        },
        {
          name: 'valid.txt',
          mimeType: 'text/plain',
          storagePath: 'uploads/valid.txt',
        },
      ];

      const result = await processor.processBatch(attachments);

      expect(result.attachmentsCount).toBe(2);
      expect(result.processedFiles).toBe(1);
      expect(result.failedFiles).toHaveLength(1);
      expect(result.failedFiles[0].filename).toBe('missing.txt');
      
      const successStats = result.stats.filter(s => s.status === 'success');
      expect(successStats).toHaveLength(1);
      expect(successStats[0].filename).toBe('valid.txt');
    });

    it('should handle empty storage path', async () => {
      const attachments: SimpleAttachment[] = [
        {
          name: 'empty.txt',
          mimeType: 'text/plain',
          storagePath: '',
        },
      ];

      const result = await processor.processBatch(attachments);

      expect(result.processedFiles).toBe(0);
      expect(result.failedFiles).toHaveLength(1);
      expect(result.failedFiles[0].error).toContain('No storage path');
    });
  });

  describe('Pre-extracted content handling', () => {
    it('should use pre-extracted content when provided', async () => {
      const preExtractedContent = 'This is pre-extracted content from frontend.';

      const attachments: SimpleAttachment[] = [
        {
          name: 'frontend-file.txt',
          mimeType: 'text/plain',
          storagePath: 'uploads/frontend-file.txt',
          content: preExtractedContent,
        },
      ];

      const result = await processor.processBatch(attachments);

      expect(result.processedFiles).toBe(1);
      expect(result.failedFiles).toHaveLength(0);
      expect(result.unifiedContext).toContain(preExtractedContent);
      
      expect(mockGetObjectEntityBuffer).not.toHaveBeenCalled();
    });
  });

  describe('Coverage verification', () => {
    it('should have processedFiles equal to attachmentsCount for all valid files', async () => {
      const txtBuffer = loadFixture('sample.txt');
      const csvBuffer = loadFixture('sample.csv');
      const jsonBuffer = loadFixture('sample.json');

      mockGetObjectEntityBuffer
        .mockResolvedValueOnce(txtBuffer)
        .mockResolvedValueOnce(csvBuffer)
        .mockResolvedValueOnce(jsonBuffer);

      const attachments: SimpleAttachment[] = [
        { name: 'a.txt', mimeType: 'text/plain', storagePath: 'uploads/a.txt' },
        { name: 'b.csv', mimeType: 'text/csv', storagePath: 'uploads/b.csv' },
        { name: 'c.json', mimeType: 'application/json', storagePath: 'uploads/c.json' },
      ];

      const result = await processor.processBatch(attachments);

      expect(result.processedFiles).toBe(3);
      expect(result.attachmentsCount).toBe(3);
      expect(result.processedFiles).toBe(result.attachmentsCount);
      expect(result.failedFiles).toHaveLength(0);
      
      result.stats.forEach(stat => {
        expect(stat.status).toBe('success');
        expect(stat.bytesRead).toBeGreaterThan(0);
        expect(stat.tokensExtracted).toBeGreaterThan(0);
        expect(stat.parseTimeMs).toBeGreaterThanOrEqual(0);
        expect(stat.chunkCount).toBeGreaterThan(0);
      });
    });

    it('should have failedFiles empty when all files are valid', async () => {
      const txtBuffer = loadFixture('sample.txt');
      mockGetObjectEntityBuffer.mockResolvedValue(txtBuffer);

      const attachments: SimpleAttachment[] = [
        { name: 'doc1.txt', mimeType: 'text/plain', storagePath: 'uploads/doc1.txt' },
        { name: 'doc2.txt', mimeType: 'text/plain', storagePath: 'uploads/doc2.txt' },
      ];

      const result = await processor.processBatch(attachments);

      expect(result.failedFiles).toEqual([]);
      expect(result.failedFiles.length).toBe(0);
    });
  });
});
