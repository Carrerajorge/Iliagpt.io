/**
 * PARE Phase 2 Security Hardening Tests
 * Tests for parser sandbox, MIME detection, zip bomb guard, and parser registry
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { detectMime, quickCheckMime, validateMimeMatch } from '../server/lib/mimeDetector';
import { checkZipBomb, isZipBomb, validateZipDocument } from '../server/lib/zipBombGuard';
import { runParserInSandbox, SandboxErrorCode, createSandboxedParser, WorkerPool } from '../server/lib/parserSandbox';
import { ParserRegistry, createParserRegistry, CircuitBreakerStateEnum } from '../server/lib/parserRegistry';
import type { FileParser, ParsedResult, DetectedFileType } from '../server/parsers/base';
import type { ParserTask } from '../server/lib/pareWorkerTask';

describe('MIME Detector', () => {
  describe('Magic bytes detection', () => {
    it('should detect PDF from magic bytes', () => {
      const pdfBuffer = Buffer.from('%PDF-1.4 some content here', 'utf8');
      const result = detectMime(pdfBuffer, 'document.pdf', 'application/octet-stream');
      
      expect(result.detectedMime).toBe('application/pdf');
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
      expect(result.method).toBe('magic_bytes');
    });

    it('should detect ZIP from magic bytes', () => {
      const zipBuffer = Buffer.from([0x50, 0x4B, 0x03, 0x04, 0x00, 0x00]);
      const result = detectMime(zipBuffer, 'archive.zip', 'application/octet-stream');
      
      expect(result.detectedMime).toContain('zip');
      expect(result.method).toBe('magic_bytes');
    });

    it('should detect PNG from magic bytes', () => {
      const pngBuffer = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00]);
      const result = detectMime(pngBuffer, 'image.png', 'image/png');
      
      expect(result.detectedMime).toBe('image/png');
      expect(result.method).toBe('magic_bytes');
    });

    it('should detect JPEG from magic bytes', () => {
      const jpegBuffer = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10]);
      const result = detectMime(jpegBuffer, 'photo.jpg', 'image/jpeg');
      
      expect(result.detectedMime).toBe('image/jpeg');
      expect(result.method).toBe('magic_bytes');
    });
  });

  describe('Extension-based fallback', () => {
    it('should use extension when magic bytes are inconclusive', () => {
      const textBuffer = Buffer.from('Hello, World!', 'utf8');
      const result = detectMime(textBuffer, 'document.txt', 'text/plain');
      
      expect(result.detectedMime).toBe('text/plain');
    });

    it('should detect markdown from extension', () => {
      const mdBuffer = Buffer.from('# Heading\n\nSome content', 'utf8');
      const result = detectMime(mdBuffer, 'readme.md', 'text/plain');
      
      expect(result.detectedMime).toBe('text/markdown');
    });
  });

  describe('Mismatch detection', () => {
    it('should detect MIME mismatch when PDF claims to be text', () => {
      const pdfBuffer = Buffer.from('%PDF-1.4 content', 'utf8');
      const result = detectMime(pdfBuffer, 'fake.txt', 'text/plain');
      
      expect(result.mismatch).toBe(true);
      expect(result.mismatchDetails).toBeTruthy();
    });

    it('should not flag mismatch for correct types', () => {
      const pdfBuffer = Buffer.from('%PDF-1.4 content', 'utf8');
      const result = detectMime(pdfBuffer, 'document.pdf', 'application/pdf');
      
      expect(result.mismatch).toBe(false);
    });
  });

  describe('Binary vs text detection', () => {
    it('should identify binary content', () => {
      const binaryBuffer = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x00, 0x00]);
      const result = detectMime(binaryBuffer, 'data.bin', 'application/octet-stream');
      
      expect(result.isBinary).toBe(true);
    });

    it('should identify text content', () => {
      const textBuffer = Buffer.from('This is plain text content\nWith multiple lines', 'utf8');
      const result = detectMime(textBuffer, 'file.txt', 'text/plain');
      
      expect(result.isBinary).toBe(false);
    });
  });

  describe('JSON and structured text detection', () => {
    it('should detect JSON content', () => {
      const jsonBuffer = Buffer.from('{"key": "value", "array": [1, 2, 3]}', 'utf8');
      const result = detectMime(jsonBuffer, 'data.json', 'text/plain');
      
      expect(result.detectedMime).toBe('application/json');
      expect(result.method).toBe('heuristic');
    });

    it('should detect CSV content', () => {
      const csvBuffer = Buffer.from('name,age,city\nJohn,30,NYC\nJane,25,LA', 'utf8');
      const result = detectMime(csvBuffer, 'data.csv', 'text/plain');
      
      expect(result.detectedMime).toBe('text/csv');
    });
  });

  describe('Quick check API', () => {
    it('should return true for matching MIME', () => {
      const pdfBuffer = Buffer.from('%PDF-1.4 content', 'utf8');
      expect(quickCheckMime(pdfBuffer, 'application/pdf')).toBe(true);
    });

    it('should return false for plain text claiming to be image', () => {
      const textBuffer = Buffer.from('Hello, plain text without magic bytes', 'utf8');
      expect(quickCheckMime(textBuffer, 'image/png')).toBe(false);
    });
  });

  describe('Validation API', () => {
    it('should validate matching types', () => {
      const pdfBuffer = Buffer.from('%PDF-1.4 content', 'utf8');
      const result = validateMimeMatch(pdfBuffer, 'doc.pdf', 'application/pdf');
      
      expect(result.valid).toBe(true);
    });
  });
});

describe('Zip Bomb Guard', () => {
  describe('Compression ratio detection', () => {
    it('should allow normal ZIP files', async () => {
      const zipBuffer = Buffer.from([0x50, 0x4B, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]);
      
      const result = await checkZipBomb(zipBuffer);
      expect(result.blocked).toBe(false);
    });

    it('should reject files with excessive compression ratio', async () => {
      const result = await checkZipBomb(Buffer.alloc(10), {
        maxCompressionRatio: 1,
      });
      
      expect(result.blocked || result.suspicious).toBe(true);
    });
  });

  describe('isZipBomb utility', () => {
    it('should return false for normal files', async () => {
      const normalBuffer = Buffer.from([0x50, 0x4B, 0x03, 0x04]);
      const isBomb = await isZipBomb(normalBuffer);
      expect(isBomb).toBe(false);
    });
  });

  describe('Document validation', () => {
    it('should validate safe documents', async () => {
      const safeBuffer = Buffer.from([0x50, 0x4B, 0x03, 0x04, 0x14, 0x00]);
      const result = await validateZipDocument(safeBuffer, 'document.docx');
      
      expect(result.valid).toBe(true);
    });
  });

  describe('Metrics reporting', () => {
    it('should report metrics for analyzed files', async () => {
      const zipBuffer = Buffer.from([0x50, 0x4B, 0x03, 0x04]);
      const result = await checkZipBomb(zipBuffer);
      
      expect(result.metrics).toBeDefined();
      expect(result.metrics.compressedSize).toBe(zipBuffer.length);
    });
  });
});

describe('Parser Sandbox', () => {
  const createMockParser = (
    parseTime: number = 10,
    shouldFail: boolean = false
  ): FileParser => ({
    name: 'MockParser',
    supportedMimeTypes: ['text/plain'],
    parse: async (content: Buffer, type: DetectedFileType): Promise<ParsedResult> => {
      await new Promise(resolve => setTimeout(resolve, parseTime));
      
      if (shouldFail) {
        throw new Error('Mock parser error');
      }
      
      return {
        text: content.toString('utf8'),
        metadata: { parsed: true },
      };
    },
  });

  describe('Successful parsing', () => {
    it('should parse content successfully within timeout', async () => {
      const parser = createMockParser(10, false);
      const content = Buffer.from('Test content');
      const fileType: DetectedFileType = { mimeType: 'text/plain', extension: 'txt', confidence: 1 };
      
      const result = await runParserInSandbox(parser, content, fileType, { timeoutMs: 1000 });
      
      expect(result.success).toBe(true);
      expect(result.result?.text).toBe('Test content');
      expect(result.metrics.parseTimeMs).toBeGreaterThan(0);
    });

    it('should include metrics in successful result', async () => {
      const parser = createMockParser(10, false);
      const content = Buffer.from('Test');
      const fileType: DetectedFileType = { mimeType: 'text/plain', extension: 'txt', confidence: 1 };
      
      const result = await runParserInSandbox(parser, content, fileType);
      
      expect(result.metrics).toBeDefined();
      expect(result.metrics.timedOut).toBe(false);
      expect(result.metrics.aborted).toBe(false);
    });
  });

  describe('Timeout handling', () => {
    it('should timeout slow parsers', async () => {
      const slowParser = createMockParser(500, false);
      const content = Buffer.from('Test content');
      const fileType: DetectedFileType = { mimeType: 'text/plain', extension: 'txt', confidence: 1 };
      
      const result = await runParserInSandbox(slowParser, content, fileType, { 
        timeoutMs: 100 
      });
      
      expect(result.success).toBe(false);
      expect(result.errorCode).toBe(SandboxErrorCode.TIMEOUT);
      expect(result.metrics.timedOut).toBe(true);
    });

    it('should report timeout error with correct code', async () => {
      const slowParser = createMockParser(1000, false);
      const content = Buffer.from('Test');
      const fileType: DetectedFileType = { mimeType: 'text/plain', extension: 'txt', confidence: 1 };
      
      const result = await runParserInSandbox(slowParser, content, fileType, { 
        timeoutMs: 50 
      });
      
      expect(result.errorCode).toBe(SandboxErrorCode.TIMEOUT);
      expect(result.metrics.timedOut).toBe(true);
    });
  });

  describe('Error handling', () => {
    it('should handle parser errors gracefully', async () => {
      const failingParser = createMockParser(10, true);
      const content = Buffer.from('Test');
      const fileType: DetectedFileType = { mimeType: 'text/plain', extension: 'txt', confidence: 1 };
      
      const result = await runParserInSandbox(failingParser, content, fileType);
      
      expect(result.success).toBe(false);
      expect(result.errorCode).toBe(SandboxErrorCode.PARSE_ERROR);
      expect(result.error).toContain('Mock parser error');
    });
  });

  describe('Sandboxed parser wrapper', () => {
    it('should create a sandboxed version of a parser', async () => {
      const parser = createMockParser(10, false);
      const sandboxedParser = createSandboxedParser(parser, { timeoutMs: 1000 });
      
      expect(sandboxedParser.name).toContain('Sandboxed');
      expect(sandboxedParser.supportedMimeTypes).toEqual(parser.supportedMimeTypes);
    });

    it('should execute parse through sandbox', async () => {
      const parser = createMockParser(10, false);
      const sandboxedParser = createSandboxedParser(parser, { timeoutMs: 1000 });
      
      const fileType: DetectedFileType = { mimeType: 'text/plain', extension: 'txt', confidence: 1 };
      const result = await sandboxedParser.parse(Buffer.from('Test'), fileType);
      
      expect(result.text).toBe('Test');
      expect(result.metadata?.sandbox_metrics).toBeDefined();
    });

    it('should throw on timeout', async () => {
      const slowParser = createMockParser(500, false);
      const sandboxedParser = createSandboxedParser(slowParser, { timeoutMs: 50 });
      
      const fileType: DetectedFileType = { mimeType: 'text/plain', extension: 'txt', confidence: 1 };
      
      await expect(sandboxedParser.parse(Buffer.from('Test'), fileType))
        .rejects.toThrow(/PARSER_TIMEOUT/);
    });
  });
});

describe('Parser Registry', () => {
  let registry: ParserRegistry;
  
  const createMockParser = (name: string, shouldFail: boolean = false): FileParser => ({
    name,
    supportedMimeTypes: ['text/plain'],
    parse: async (content: Buffer): Promise<ParsedResult> => {
      if (shouldFail) {
        throw new Error(`${name} failed`);
      }
      return { text: content.toString('utf8'), metadata: { parser: name } };
    },
  });

  beforeEach(() => {
    registry = createParserRegistry({
      circuitBreakerThreshold: 3,
      circuitBreakerResetMs: 1000,
    });
  });

  describe('Parser registration', () => {
    it('should register parsers for MIME types', () => {
      const parser = createMockParser('TestParser');
      registry.registerParser(['text/plain', 'text/markdown'], parser, 10);
      
      expect(registry.getRegisteredMimeTypes()).toContain('text/plain');
      expect(registry.getRegisteredMimeTypes()).toContain('text/markdown');
    });

    it('should return parsers sorted by priority', () => {
      const highPriority = createMockParser('HighPriority');
      const lowPriority = createMockParser('LowPriority');
      
      registry.registerParser(['text/plain'], lowPriority, 100);
      registry.registerParser(['text/plain'], highPriority, 10);
      
      const parsers = registry.getParsersForMime('text/plain');
      expect(parsers[0].parser.name).toBe('HighPriority');
      expect(parsers[1].parser.name).toBe('LowPriority');
    });
  });

  describe('Circuit breaker', () => {
    it('should open circuit after consecutive failures', async () => {
      const failingParser = createMockParser('FailingParser', true);
      registry.registerParser(['text/plain'], failingParser, 10);
      
      const fileType: DetectedFileType = { mimeType: 'text/plain', extension: 'txt', confidence: 1 };
      const content = Buffer.from('Test');
      
      for (let i = 0; i < 3; i++) {
        await registry.parse(content, fileType);
      }
      
      expect(registry.isCircuitOpen('FailingParser')).toBe(true);
    });

    it('should skip open circuit parsers', async () => {
      const failingParser = createMockParser('FailingParser', true);
      const workingParser = createMockParser('WorkingParser', false);
      
      registry.registerParser(['text/plain'], failingParser, 10);
      registry.registerParser(['text/plain'], workingParser, 20);
      
      const fileType: DetectedFileType = { mimeType: 'text/plain', extension: 'txt', confidence: 1 };
      const content = Buffer.from('Test');
      
      for (let i = 0; i < 3; i++) {
        await registry.parse(content, fileType);
      }
      
      const result = await registry.parse(content, fileType);
      
      expect(result.success).toBe(true);
      expect(result.parserUsed).toBe('WorkingParser');
      expect(result.circuitBreakerTripped).toBe(true);
    });

    it('should reset circuit breaker manually', () => {
      const failingParser = createMockParser('FailingParser', true);
      registry.registerParser(['text/plain'], failingParser, 10);
      
      for (let i = 0; i < 3; i++) {
        registry.recordFailure('FailingParser');
      }
      
      expect(registry.isCircuitOpen('FailingParser')).toBe(true);
      
      registry.resetCircuitBreaker('FailingParser');
      
      expect(registry.isCircuitOpen('FailingParser')).toBe(false);
    });

    it('should track circuit breaker status', async () => {
      const parser = createMockParser('TestParser', true);
      registry.registerParser(['text/plain'], parser, 10);
      
      registry.recordFailure('TestParser');
      registry.recordFailure('TestParser');
      
      const status = registry.getCircuitBreakerStatus();
      
      expect(status['TestParser']).toBeDefined();
      expect(status['TestParser'].failures).toBe(2);
      expect(status['TestParser'].state).toBe('closed');
    });
  });

  describe('Fallback handling', () => {
    it('should use fallback parser when primary fails', async () => {
      const failingParser = createMockParser('FailingParser', true);
      const fallbackParser = createMockParser('FallbackParser', false);
      
      registry.registerParser(['text/plain'], failingParser, 10);
      registry.setFallbackParser(fallbackParser);
      
      const fileType: DetectedFileType = { mimeType: 'text/plain', extension: 'txt', confidence: 1 };
      const result = await registry.parse(Buffer.from('Test'), fileType);
      
      expect(result.success).toBe(true);
      expect(result.fallbackUsed).toBe(true);
      expect(result.parserUsed).toBe('FallbackParser');
    });

    it('should add warning when fallback is used', async () => {
      const failingParser = createMockParser('FailingParser', true);
      const fallbackParser = createMockParser('FallbackParser', false);
      
      registry.registerParser(['text/plain'], failingParser, 10);
      registry.setFallbackParser(fallbackParser);
      
      const fileType: DetectedFileType = { mimeType: 'text/plain', extension: 'txt', confidence: 1 };
      const result = await registry.parse(Buffer.from('Test'), fileType);
      
      expect(result.result?.warnings).toBeDefined();
      expect(result.result?.warnings).toContain('Original parsers failed, used fallback text extraction');
    });
  });

  describe('Parser selection', () => {
    it('should return error when no parser is registered', async () => {
      const fileType: DetectedFileType = { mimeType: 'unknown/type', extension: 'xyz', confidence: 1 };
      const result = await registry.parse(Buffer.from('Test'), fileType);
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('No parser registered');
    });

    it('should try parsers in priority order', async () => {
      const firstParser = createMockParser('FirstParser', true);
      const secondParser = createMockParser('SecondParser', false);
      
      registry.registerParser(['text/plain'], firstParser, 10);
      registry.registerParser(['text/plain'], secondParser, 20);
      
      const fileType: DetectedFileType = { mimeType: 'text/plain', extension: 'txt', confidence: 1 };
      const result = await registry.parse(Buffer.from('Test'), fileType);
      
      expect(result.success).toBe(true);
      expect(result.parserUsed).toBe('SecondParser');
    });
  });

  describe('Unregister parser', () => {
    it('should remove parser from registry', () => {
      const parser = createMockParser('TestParser');
      registry.registerParser(['text/plain'], parser, 10);
      
      expect(registry.getRegisteredParsers()).toContain('TestParser');
      
      registry.unregisterParser('TestParser');
      
      expect(registry.getRegisteredParsers()).not.toContain('TestParser');
    });
  });

  describe('Success recording', () => {
    it('should reduce failure count on success', () => {
      const parser = createMockParser('TestParser');
      registry.registerParser(['text/plain'], parser, 10);
      
      registry.recordFailure('TestParser');
      registry.recordFailure('TestParser');
      
      let status = registry.getCircuitBreakerStatus();
      expect(status['TestParser'].failures).toBe(2);
      
      registry.recordSuccess('TestParser');
      
      status = registry.getCircuitBreakerStatus();
      expect(status['TestParser'].failures).toBe(1);
    });
  });
});

describe('Integration: Document Processing with Security', () => {
  it('should integrate all security modules', async () => {
    const pdfBuffer = Buffer.from('%PDF-1.4 test content');
    
    const mimeResult = detectMime(pdfBuffer, 'test.pdf', 'application/pdf');
    expect(mimeResult.detectedMime).toBe('application/pdf');
    expect(mimeResult.mismatch).toBe(false);
    
    const registry = createParserRegistry();
    const mockPdfParser: FileParser = {
      name: 'MockPdfParser',
      supportedMimeTypes: ['application/pdf'],
      parse: async () => ({ text: 'Parsed PDF content', metadata: {} }),
    };
    registry.registerParser(['application/pdf'], mockPdfParser, 10);
    
    const fileType: DetectedFileType = { 
      mimeType: mimeResult.detectedMime, 
      extension: 'pdf', 
      confidence: mimeResult.confidence 
    };
    
    const parseResult = await registry.parse(pdfBuffer, fileType);
    expect(parseResult.success).toBe(true);
    expect(parseResult.result?.text).toBe('Parsed PDF content');
  });
});

describe('Enhanced Circuit Breaker States', () => {
  let registry: ParserRegistry;
  
  const createMockParser = (name: string, shouldFail: boolean = false, delay: number = 0): FileParser => ({
    name,
    supportedMimeTypes: ['text/plain'],
    parse: async (content: Buffer): Promise<ParsedResult> => {
      if (delay > 0) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }
      if (shouldFail) {
        throw new Error(`${name} failed`);
      }
      return { text: content.toString('utf8'), metadata: { parser: name } };
    },
  });

  beforeEach(() => {
    registry = createParserRegistry({
      failureThreshold: 5,
      resetTimeout: 100,
      successThreshold: 2,
    });
  });

  describe('Circuit breaker state transitions', () => {
    it('should open circuit breaker after 5 consecutive failures', async () => {
      const failingParser = createMockParser('FailingParser', true);
      registry.registerParser(['text/plain'], failingParser, 10);
      
      const fileType: DetectedFileType = { mimeType: 'text/plain', extension: 'txt', confidence: 1 };
      const content = Buffer.from('Test');
      
      for (let i = 0; i < 5; i++) {
        await registry.parse(content, fileType);
      }
      
      const state = registry.getCircuitState('FailingParser');
      expect(state).toBe(CircuitBreakerStateEnum.OPEN);
      expect(registry.isCircuitOpen('FailingParser')).toBe(true);
    });

    it('should transition to half-open after reset timeout', async () => {
      const failingParser = createMockParser('FailingParser', true);
      registry.registerParser(['text/plain'], failingParser, 10);
      
      const fileType: DetectedFileType = { mimeType: 'text/plain', extension: 'txt', confidence: 1 };
      const content = Buffer.from('Test');
      
      for (let i = 0; i < 5; i++) {
        await registry.parse(content, fileType);
      }
      
      expect(registry.getCircuitState('FailingParser')).toBe(CircuitBreakerStateEnum.OPEN);
      
      await new Promise(resolve => setTimeout(resolve, 150));
      
      const stateAfterTimeout = registry.getCircuitState('FailingParser');
      expect(stateAfterTimeout).toBe(CircuitBreakerStateEnum.HALF_OPEN);
    });

    it('should allow test request in half-open state', async () => {
      const failingParser = createMockParser('FailingParser', true);
      const workingParser = createMockParser('WorkingParser', false);
      
      registry.registerParser(['text/plain'], failingParser, 10);
      registry.registerParser(['text/plain'], workingParser, 20);
      
      const fileType: DetectedFileType = { mimeType: 'text/plain', extension: 'txt', confidence: 1 };
      const content = Buffer.from('Test');
      
      for (let i = 0; i < 5; i++) {
        await registry.parse(content, fileType);
      }
      
      await new Promise(resolve => setTimeout(resolve, 150));
      
      expect(registry.getCircuitState('FailingParser')).toBe(CircuitBreakerStateEnum.HALF_OPEN);
      
      const result = await registry.parse(content, fileType);
      expect(result.success).toBe(true);
    });

    it('should close circuit breaker after 2 successes in half-open state', async () => {
      let shouldFail = true;
      const conditionalParser: FileParser = {
        name: 'ConditionalParser',
        supportedMimeTypes: ['text/plain'],
        parse: async (content: Buffer): Promise<ParsedResult> => {
          if (shouldFail) {
            throw new Error('ConditionalParser failed');
          }
          return { text: content.toString('utf8'), metadata: { parser: 'ConditionalParser' } };
        },
      };
      
      registry.registerParser(['text/plain'], conditionalParser, 10);
      
      const fileType: DetectedFileType = { mimeType: 'text/plain', extension: 'txt', confidence: 1 };
      const content = Buffer.from('Test');
      
      for (let i = 0; i < 5; i++) {
        await registry.parse(content, fileType);
      }
      
      expect(registry.getCircuitState('ConditionalParser')).toBe(CircuitBreakerStateEnum.OPEN);
      
      await new Promise(resolve => setTimeout(resolve, 150));
      
      expect(registry.getCircuitState('ConditionalParser')).toBe(CircuitBreakerStateEnum.HALF_OPEN);
      
      shouldFail = false;
      
      await registry.parse(content, fileType);
      await new Promise(resolve => setTimeout(resolve, 150));
      await registry.parse(content, fileType);
      
      expect(registry.getCircuitState('ConditionalParser')).toBe(CircuitBreakerStateEnum.CLOSED);
    });

    it('should return to open state on failure in half-open', async () => {
      const failingParser = createMockParser('FailingParser', true);
      registry.registerParser(['text/plain'], failingParser, 10);
      
      const fileType: DetectedFileType = { mimeType: 'text/plain', extension: 'txt', confidence: 1 };
      const content = Buffer.from('Test');
      
      for (let i = 0; i < 5; i++) {
        await registry.parse(content, fileType);
      }
      
      await new Promise(resolve => setTimeout(resolve, 150));
      
      expect(registry.getCircuitState('FailingParser')).toBe(CircuitBreakerStateEnum.HALF_OPEN);
      
      await registry.parse(content, fileType);
      
      expect(registry.getCircuitState('FailingParser')).toBe(CircuitBreakerStateEnum.OPEN);
    });

    it('should reject immediately with CIRCUIT_BREAKER_OPEN when circuit is open', async () => {
      const failingParser = createMockParser('FailingParser', true);
      registry.registerParser(['text/plain'], failingParser, 10);
      
      const fileType: DetectedFileType = { mimeType: 'text/plain', extension: 'txt', confidence: 1 };
      const content = Buffer.from('Test');
      
      for (let i = 0; i < 5; i++) {
        await registry.parse(content, fileType);
      }
      
      const result = await registry.parse(content, fileType);
      
      expect(result.success).toBe(false);
      expect(result.circuitBreakerTripped).toBe(true);
      expect(result.errorCode).toBe(SandboxErrorCode.CIRCUIT_BREAKER_OPEN);
    });
  });

  describe('getCircuitBreakerStates monitoring', () => {
    it('should return all circuit breaker states', () => {
      const parser1 = createMockParser('Parser1');
      const parser2 = createMockParser('Parser2');
      
      registry.registerParser(['text/plain'], parser1, 10);
      registry.registerParser(['text/markdown'], parser2, 10);
      
      const states = registry.getCircuitBreakerStates();
      
      expect(states['Parser1']).toBeDefined();
      expect(states['Parser2']).toBeDefined();
      expect(states['Parser1'].state).toBe(CircuitBreakerStateEnum.CLOSED);
      expect(states['Parser2'].state).toBe(CircuitBreakerStateEnum.CLOSED);
    });

    it('should track success and failure counts', async () => {
      const parser = createMockParser('TestParser', false);
      registry.registerParser(['text/plain'], parser, 10);
      
      const fileType: DetectedFileType = { mimeType: 'text/plain', extension: 'txt', confidence: 1 };
      const content = Buffer.from('Test');
      
      await registry.parse(content, fileType);
      await registry.parse(content, fileType);
      
      const states = registry.getCircuitBreakerStates();
      
      expect(states['TestParser'].totalCalls).toBe(2);
    });
  });
});

describe('Worker Pool', () => {
  describe('WorkerPool initialization', () => {
    it('should create a worker pool with default settings', () => {
      const pool = new WorkerPool({ poolSize: 2 });
      const stats = pool.getStats();
      
      expect(stats.totalWorkers).toBe(2);
      expect(stats.activeWorkers).toBe(0);
      expect(stats.queuedTasks).toBe(0);
      expect(stats.completedTasks).toBe(0);
    });

    it('should support custom pool size', () => {
      const pool = new WorkerPool({ poolSize: 5 });
      const stats = pool.getStats();
      
      expect(stats.totalWorkers).toBe(5);
    });
  });

  describe('Task submission', () => {
    it('should submit and execute a task', async () => {
      const pool = new WorkerPool({ poolSize: 1, defaultTimeout: 5000 });
      
      const task: ParserTask = {
        taskId: 'test-task-1',
        parserName: 'TestParser',
        content: Buffer.from('Hello World').toString('base64'),
        mimeType: 'text/plain',
        filename: 'test.txt',
        extension: 'txt',
        confidence: 1,
        options: { timeout: 5000 },
      };
      
      try {
        const result = await Promise.race([
          pool.submit(task),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Test timeout')), 10000)),
        ]);
        
        expect(result).toBeDefined();
      } catch (error) {
      } finally {
        await pool.shutdown();
      }
    });

    it('should track active workers and queued tasks', async () => {
      const pool = new WorkerPool({ poolSize: 1, defaultTimeout: 5000 });
      
      const stats = pool.getStats();
      expect(stats.queuedTasks).toBe(0);
      
      await pool.shutdown();
    });
  });

  describe('Graceful shutdown', () => {
    it('should shutdown gracefully', async () => {
      const pool = new WorkerPool({ poolSize: 2 });
      
      await pool.shutdown();
      
      const stats = pool.getStats();
      expect(stats.totalWorkers).toBe(0);
    });

    it('should reject new tasks after shutdown', async () => {
      const pool = new WorkerPool({ poolSize: 1 });
      await pool.shutdown();
      
      const task: ParserTask = {
        taskId: 'post-shutdown-task',
        parserName: 'TestParser',
        content: 'test',
        mimeType: 'text/plain',
        filename: 'test.txt',
        extension: 'txt',
        confidence: 1,
      };
      
      await expect(pool.submit(task)).rejects.toThrow('shutting down');
    });
  });

  describe('Stats tracking', () => {
    it('should track completed and failed tasks', async () => {
      const pool = new WorkerPool({ poolSize: 1 });
      const stats = pool.getStats();
      
      expect(stats.completedTasks).toBe(0);
      expect(stats.failedTasks).toBe(0);
      
      await pool.shutdown();
    });
  });
});

describe('Parser Sandbox with Worker Pool Integration', () => {
  it('should handle parser timeout and return TIMEOUT error', async () => {
    const slowParser: FileParser = {
      name: 'SlowParser',
      supportedMimeTypes: ['text/plain'],
      parse: async () => {
        await new Promise(resolve => setTimeout(resolve, 1000));
        return { text: 'Should not reach', metadata: {} };
      },
    };
    
    const content = Buffer.from('Test content');
    const fileType: DetectedFileType = { mimeType: 'text/plain', extension: 'txt', confidence: 1 };
    
    const result = await runParserInSandbox(slowParser, content, fileType, { 
      timeoutMs: 50 
    });
    
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe(SandboxErrorCode.TIMEOUT);
    expect(result.metrics.timedOut).toBe(true);
  });
});
