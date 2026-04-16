import { describe, it, expect, beforeEach } from 'vitest';
import { createPareLogger, redactPII, type PareLogger } from '../server/lib/pareLogger';
import { pareMetrics, Histogram, getMetricsSummary, PareMetricsCollector } from '../server/lib/pareMetrics';
import { 
  createAuditRecord, 
  computeContentHash, 
  AuditTrailCollector,
  formatAuditLog,
  type AuditRecord 
} from '../server/lib/pareAuditTrail';
import { createChunkStore, PareChunkStore } from '../server/lib/pareChunkStore';

describe('PARE Phase 3 Observability', () => {
  describe('PII Redaction', () => {
    it('should redact email addresses', () => {
      const input = 'Contact us at user@example.com for support';
      const result = redactPII(input);
      expect(result).toBe('Contact us at [EMAIL_REDACTED] for support');
    });

    it('should redact multiple email addresses', () => {
      const input = 'Send to john.doe@company.org and jane@test.io';
      const result = redactPII(input);
      expect(result).toBe('Send to [EMAIL_REDACTED] and [EMAIL_REDACTED]');
    });

    it('should redact phone numbers', () => {
      const input = 'Call us at 555-123-4567 or 555.987.6543';
      const result = redactPII(input);
      expect(result).toBe('Call us at [PHONE_REDACTED] or [PHONE_REDACTED]');
    });

    it('should redact phone numbers with country code', () => {
      const input = 'International: 1-555-123-4567';
      const result = redactPII(input);
      expect(result).toBe('International: [PHONE_REDACTED]');
    });

    it('should redact IP address last octet', () => {
      const input = 'Request from IP 192.168.1.100';
      const result = redactPII(input);
      expect(result).toBe('Request from IP 192.168.1.***');
    });

    it('should redact user directory paths', () => {
      const input = 'File located at /home/username/documents/file.txt';
      const result = redactPII(input);
      expect(result).toBe('File located at [USER_PATH_REDACTED]/documents/file.txt');
    });

    it('should redact Windows user paths', () => {
      const input = 'Path: C:\\Users\\JohnDoe\\Desktop\\secret.docx';
      const result = redactPII(input);
      expect(result).toBe('Path: [USER_PATH_REDACTED]\\Desktop\\secret.docx');
    });

    it('should redact Mac user paths', () => {
      const input = 'Located at /Users/jane.smith/Downloads/doc.pdf';
      const result = redactPII(input);
      expect(result).toBe('Located at [USER_PATH_REDACTED]/Downloads/doc.pdf');
    });

    it('should handle nested objects for redaction', () => {
      const input = {
        user: 'test@example.com',
        data: {
          phone: '555-123-4567',
          ip: '10.0.0.1'
        }
      };
      const result = redactPII(input) as any;
      expect(result.user).toBe('[EMAIL_REDACTED]');
      expect(result.data.phone).toBe('[PHONE_REDACTED]');
      expect(result.data.ip).toBe('10.0.0.***');
    });

    it('should handle arrays for redaction', () => {
      const input = ['user@test.com', '555-987-6543'];
      const result = redactPII(input) as string[];
      expect(result[0]).toBe('[EMAIL_REDACTED]');
      expect(result[1]).toBe('[PHONE_REDACTED]');
    });

    it('should leave non-PII content unchanged', () => {
      const input = 'Regular text without PII';
      const result = redactPII(input);
      expect(result).toBe('Regular text without PII');
    });
  });

  describe('Metrics Percentile Calculation', () => {
    let histogram: Histogram;

    beforeEach(() => {
      histogram = new Histogram();
    });

    it('should calculate p50 correctly', () => {
      for (let i = 1; i <= 100; i++) {
        histogram.record(i);
      }
      expect(histogram.getPercentile(50)).toBe(50);
    });

    it('should calculate p95 correctly', () => {
      for (let i = 1; i <= 100; i++) {
        histogram.record(i);
      }
      expect(histogram.getPercentile(95)).toBe(95);
    });

    it('should calculate p99 correctly', () => {
      for (let i = 1; i <= 100; i++) {
        histogram.record(i);
      }
      expect(histogram.getPercentile(99)).toBe(99);
    });

    it('should return 0 for empty histogram', () => {
      expect(histogram.getPercentile(50)).toBe(0);
    });

    it('should handle single value', () => {
      histogram.record(42);
      expect(histogram.getPercentile(50)).toBe(42);
      expect(histogram.getPercentile(99)).toBe(42);
    });

    it('should provide complete stats', () => {
      histogram.record(10);
      histogram.record(20);
      histogram.record(30);
      histogram.record(40);
      histogram.record(50);
      
      const stats = histogram.getStats();
      expect(stats.count).toBe(5);
      expect(stats.avg).toBe(30);
      expect(stats.min).toBe(10);
      expect(stats.max).toBe(50);
    });

    it('should track per-parser metrics', () => {
      const collector = new PareMetricsCollector();
      
      collector.recordParserExecution('PdfParser', 100, true);
      collector.recordParserExecution('PdfParser', 150, true);
      collector.recordParserExecution('PdfParser', 200, false);
      collector.recordParserExecution('DocxParser', 50, true);
      
      const summary = collector.getMetricsSummary();
      
      expect(summary.parsers['PdfParser'].success_count).toBe(2);
      expect(summary.parsers['PdfParser'].failure_count).toBe(1);
      expect(summary.parsers['PdfParser'].avg_duration_ms).toBeCloseTo(150, 0);
      expect(summary.parsers['DocxParser'].success_count).toBe(1);
      expect(summary.parsers['DocxParser'].failure_count).toBe(0);
    });

    it('should track files processed', () => {
      const collector = new PareMetricsCollector();
      
      collector.recordFileProcessed(true);
      collector.recordFileProcessed(true);
      collector.recordFileProcessed(false);
      
      const summary = collector.getMetricsSummary();
      expect(summary.files_processed.total).toBe(3);
      expect(summary.files_processed.success).toBe(2);
      expect(summary.files_processed.failed).toBe(1);
    });
  });

  describe('Audit Hash Generation', () => {
    it('should generate consistent SHA-256 hash for same content', () => {
      const content = 'Test document content';
      const hash1 = computeContentHash(content);
      const hash2 = computeContentHash(content);
      
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64);
    });

    it('should generate different hashes for different content', () => {
      const hash1 = computeContentHash('Content A');
      const hash2 = computeContentHash('Content B');
      
      expect(hash1).not.toBe(hash2);
    });

    it('should handle Buffer input', () => {
      const buffer = Buffer.from('Binary content');
      const hash = computeContentHash(buffer);
      
      expect(hash).toHaveLength(64);
      expect(/^[a-f0-9]+$/.test(hash)).toBe(true);
    });

    it('should create audit record with correct fields', () => {
      const fileData = {
        filename: 'document.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        content: 'Test content'
      };
      
      const parseResult = {
        success: true,
        parserUsed: 'PdfParser',
        tokensExtracted: 500,
        chunksGenerated: 5,
        citationsGenerated: 3,
        parseTimeMs: 150
      };
      
      const record = createAuditRecord(fileData, parseResult);
      
      expect(record.id).toMatch(/^aud_[a-z0-9_]+$/);
      expect(record.fileHash).toHaveLength(64);
      expect(record.fileName).toBe('document.pdf');
      expect(record.mimeType).toBe('application/pdf');
      expect(record.sizeBytes).toBe(1024);
      expect(record.parserUsed).toBe('PdfParser');
      expect(record.parseResult).toBe('success');
      expect(record.tokensExtracted).toBe(500);
      expect(record.chunksGenerated).toBe(5);
      expect(record.citationsGenerated).toBe(3);
      expect(record.parseTimeMs).toBe(150);
      expect(record.timestamp).toBeTruthy();
    });

    it('should create audit record for failed parse', () => {
      const fileData = {
        filename: 'corrupt.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        sizeBytes: 512,
        content: 'corrupted'
      };
      
      const parseResult = {
        success: false,
        parserUsed: 'DocxParser',
        tokensExtracted: 0,
        chunksGenerated: 0,
        parseTimeMs: 50,
        error: 'Invalid document format'
      };
      
      const record = createAuditRecord(fileData, parseResult);
      
      expect(record.parseResult).toBe('failure');
      expect(record.errorMessage).toBe('Invalid document format');
      expect(record.tokensExtracted).toBe(0);
    });

    it('should format audit log as readable text', () => {
      const records: AuditRecord[] = [
        createAuditRecord(
          { filename: 'doc1.pdf', mimeType: 'application/pdf', sizeBytes: 1000, content: 'a' },
          { success: true, parserUsed: 'PdfParser', tokensExtracted: 100, chunksGenerated: 2, parseTimeMs: 50 }
        ),
        createAuditRecord(
          { filename: 'doc2.xlsx', mimeType: 'application/vnd.ms-excel', sizeBytes: 2000, content: 'b' },
          { success: true, parserUsed: 'XlsxParser', tokensExtracted: 200, chunksGenerated: 4, parseTimeMs: 75 }
        )
      ];
      
      const formatted = formatAuditLog(records);
      
      expect(formatted).toContain('=== PARE AUDIT LOG ===');
      expect(formatted).toContain('Total Records: 2');
      expect(formatted).toContain('doc1.pdf');
      expect(formatted).toContain('doc2.xlsx');
      expect(formatted).toContain('PdfParser');
      expect(formatted).toContain('XlsxParser');
    });

    it('should collect and summarize batch audit', () => {
      const collector = new AuditTrailCollector('test-request-123');
      
      collector.addRecord(
        { filename: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 1000, content: 'content a' },
        { success: true, parserUsed: 'PdfParser', tokensExtracted: 100, chunksGenerated: 2, parseTimeMs: 50 }
      );
      
      collector.addRecord(
        { filename: 'b.docx', mimeType: 'application/msword', sizeBytes: 2000, content: 'content b' },
        { success: false, parserUsed: 'DocxParser', tokensExtracted: 0, chunksGenerated: 0, parseTimeMs: 25, error: 'Parse error' }
      );
      
      const summary = collector.getSummary();
      
      expect(summary.requestId).toBe('test-request-123');
      expect(summary.totalFiles).toBe(2);
      expect(summary.successCount).toBe(1);
      expect(summary.failureCount).toBe(1);
      expect(summary.totalTokens).toBe(100);
      expect(summary.totalParseTimeMs).toBe(75);
      expect(summary.records).toHaveLength(2);
    });
  });

  describe('Chunk Store Coverage Guarantee', () => {
    let chunkStore: PareChunkStore;

    beforeEach(() => {
      chunkStore = createChunkStore({ maxChunksPerDoc: 10 });
    });

    it('should store chunks with document indexing', () => {
      const result = chunkStore.addChunks('doc1', 'document.pdf', [
        { content: 'First chunk content', location: { page: 1 } },
        { content: 'Second chunk content', location: { page: 2 } }
      ]);
      
      expect(result.added).toBe(2);
      expect(result.duplicates).toBe(0);
      expect(result.stored).toHaveLength(2);
    });

    it('should guarantee at least 1 chunk per document', () => {
      const result = chunkStore.addChunks('doc1', 'document.pdf', [
        { content: 'Only chunk', location: { page: 1 } }
      ]);
      
      const chunks = chunkStore.getChunks('doc1');
      expect(chunks.length).toBeGreaterThanOrEqual(1);
      
      const coverage = chunkStore.getCoverageReport();
      expect(coverage.documents[0].hasCoverage).toBe(true);
    });

    it('should deduplicate identical content across documents', () => {
      const duplicateContent = 'This is exactly the same content';
      
      const result1 = chunkStore.addChunks('doc1', 'doc1.pdf', [
        { content: duplicateContent, location: { page: 1 } },
        { content: 'Unique content for doc1', location: { page: 2 } }
      ]);
      
      const result2 = chunkStore.addChunks('doc2', 'doc2.pdf', [
        { content: duplicateContent, location: { page: 1 } },
        { content: 'Unique content for doc2', location: { page: 2 } }
      ]);
      
      expect(result1.added).toBe(2);
      expect(result1.duplicates).toBe(0);
      expect(result2.added).toBe(1);
      expect(result2.duplicates).toBe(1);
      
      const coverage = chunkStore.getCoverageReport();
      expect(coverage.duplicatesRemoved).toBe(1);
    });

    it('should provide fallback chunk when all are duplicates', () => {
      const content = 'Duplicate content for coverage test';
      
      chunkStore.addChunks('doc1', 'doc1.pdf', [
        { content: content, location: { page: 1 } }
      ]);
      
      const result = chunkStore.addChunks('doc2', 'doc2.pdf', [
        { content: content, location: { page: 1 } }
      ]);
      
      expect(result.added).toBe(1);
      expect(chunkStore.hasDocument('doc2')).toBe(true);
      
      const chunks = chunkStore.getChunks('doc2');
      expect(chunks.length).toBeGreaterThanOrEqual(1);
    });

    it('should support diversity sampling', () => {
      for (let i = 0; i < 20; i++) {
        chunkStore.addChunks('largeDoc', 'large.pdf', [
          { content: `Chunk ${i} content`, location: { page: i + 1 } }
        ]);
      }
      
      const diverseSample = chunkStore.getDiverseSample(5);
      expect(diverseSample.length).toBeLessThanOrEqual(5);
    });

    it('should track coverage across multiple documents', () => {
      chunkStore.addChunks('doc1', 'doc1.pdf', [
        { content: 'Doc 1 content', location: { page: 1 } }
      ]);
      chunkStore.addChunks('doc2', 'doc2.xlsx', [
        { content: 'Sheet 1 data', location: { sheet: 'Sheet1' } },
        { content: 'Sheet 2 data', location: { sheet: 'Sheet2' } }
      ]);
      chunkStore.addChunks('doc3', 'doc3.pptx', [
        { content: 'Slide 1', location: { slide: 1 } },
        { content: 'Slide 2', location: { slide: 2 } },
        { content: 'Slide 3', location: { slide: 3 } }
      ]);
      
      const coverage = chunkStore.getCoverageReport();
      
      expect(coverage.totalDocuments).toBe(3);
      expect(coverage.coverageRate).toBe(1);
      expect(coverage.documents.every(d => d.hasCoverage)).toBe(true);
    });

    it('should remove documents correctly', () => {
      chunkStore.addChunks('doc1', 'doc1.pdf', [
        { content: 'Content 1', location: { page: 1 } }
      ]);
      chunkStore.addChunks('doc2', 'doc2.pdf', [
        { content: 'Content 2', location: { page: 1 } }
      ]);
      
      const removed = chunkStore.removeDocument('doc1');
      expect(removed).toBe(1);
      expect(chunkStore.hasDocument('doc1')).toBe(false);
      expect(chunkStore.hasDocument('doc2')).toBe(true);
    });

    it('should provide memory statistics', () => {
      chunkStore.addChunks('doc1', 'doc1.pdf', [
        { content: 'A'.repeat(1000), location: { page: 1 } }
      ]);
      
      const stats = chunkStore.getStats();
      expect(stats.totalDocuments).toBe(1);
      expect(stats.totalChunks).toBe(1);
      expect(stats.memoryEstimateBytes).toBeGreaterThan(0);
    });
  });

  describe('Logger Integration', () => {
    it('should create logger with request ID', () => {
      const logger = createPareLogger('test-req-123');
      expect(logger.requestId).toBe('test-req-123');
    });

    it('should generate request ID if not provided', () => {
      const logger = createPareLogger();
      expect(logger.requestId).toBeTruthy();
      expect(typeof logger.requestId).toBe('string');
    });

    it('should support context propagation', () => {
      const logger = createPareLogger('req-456');
      logger.setContext({
        userId: 'user-789',
        conversationId: 'conv-abc'
      });
      expect(logger.requestId).toBe('req-456');
    });

    it('should have all required logging methods', () => {
      const logger = createPareLogger();
      
      expect(typeof logger.debug).toBe('function');
      expect(typeof logger.info).toBe('function');
      expect(typeof logger.warn).toBe('function');
      expect(typeof logger.error).toBe('function');
      expect(typeof logger.logRequest).toBe('function');
      expect(typeof logger.logParsing).toBe('function');
      expect(typeof logger.logResponse).toBe('function');
      expect(typeof logger.logError).toBe('function');
      expect(typeof logger.logAudit).toBe('function');
    });
  });

  describe('Global Metrics Summary', () => {
    beforeEach(() => {
      pareMetrics.reset();
    });

    it('should provide health check metrics', () => {
      pareMetrics.recordRequestDuration(100);
      pareMetrics.recordRequestDuration(200);
      pareMetrics.recordParseDuration(50);
      pareMetrics.recordTokensExtracted(1000);
      pareMetrics.recordFileProcessed(true);
      
      const summary = getMetricsSummary();
      
      expect(summary.uptime_ms).toBeGreaterThanOrEqual(0);
      expect(summary.request_duration_ms.count).toBe(2);
      expect(summary.parse_duration_ms.count).toBe(1);
      expect(summary.tokens_extracted.total).toBeGreaterThan(0);
      expect(summary.files_processed.total).toBe(1);
      expect(summary.memory_usage_mb).toBeGreaterThan(0);
    });
  });
});
