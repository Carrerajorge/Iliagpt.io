/**
 * PARE File Security Tests - Phase 2
 * Tests for path traversal detection, MIME validation, and decompression limits
 */

import { describe, it, expect, beforeAll } from 'vitest';
import JSZip from 'jszip';
import { 
  checkZipBomb, 
  validateZipDocument, 
  checkPathTraversalInZip,
  ZipViolationCode,
  type ZipBombCheckOptions 
} from '../server/lib/zipBombGuard';
import { 
  detectMime, 
  validateMimeType, 
  detectDangerousFormat,
  type MimeValidationResult 
} from '../server/lib/mimeDetector';
import { 
  validateAttachmentSecurity, 
  isAttachmentSafe,
  SecurityViolationType,
  type AttachmentInput 
} from '../server/lib/pareSecurityGuard';

describe('PARE File Security - Phase 2', () => {
  describe('Path Traversal Detection', () => {
    it('should detect path traversal with ../etc/passwd', async () => {
      const zip = new JSZip();
      zip.file('../etc/passwd', 'root:x:0:0:root:/root:/bin/bash');
      
      const buffer = Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }));
      const result = await checkZipBomb(buffer);
      
      expect(result.safe).toBe(false);
      expect(result.blocked).toBe(true);
      expect(result.violations.some(v => 
        v.code === ZipViolationCode.PATH_TRAVERSAL || v.code === ZipViolationCode.ABSOLUTE_PATH
      )).toBe(true);
    });

    it('should detect path traversal with multiple ../', async () => {
      const zip = new JSZip();
      zip.file('../../../../../../tmp/evil', 'malicious content');
      
      const buffer = Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }));
      const result = await checkZipBomb(buffer);
      
      expect(result.blocked).toBe(true);
      expect(result.metrics.pathTraversalAttempts + result.metrics.absolutePathAttempts).toBeGreaterThan(0);
    });

    it('should detect absolute paths starting with /', async () => {
      const zip = new JSZip();
      zip.file('/etc/shadow', 'shadow file content');
      
      const buffer = Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }));
      const result = await checkZipBomb(buffer);
      
      expect(result.blocked).toBe(true);
      expect(result.violations.some(v => v.code === ZipViolationCode.ABSOLUTE_PATH)).toBe(true);
    });

    it('should allow normal paths without traversal', async () => {
      const zip = new JSZip();
      zip.file('documents/report.txt', 'Normal content');
      zip.file('images/photo.png', 'PNG data');
      
      const buffer = Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }));
      const result = await checkZipBomb(buffer);
      
      expect(result.blocked).toBe(false);
      expect(result.metrics.pathTraversalAttempts).toBe(0);
    });

    it('should use checkPathTraversalInZip for quick path check', async () => {
      const zip = new JSZip();
      zip.file('../../../etc/passwd', 'content');
      
      const buffer = Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }));
      const result = await checkPathTraversalInZip(buffer);
      
      expect(result.safe).toBe(false);
      expect(result.violations.length).toBeGreaterThan(0);
    });
  });

  describe('MIME Allowlist/Denylist Enforcement', () => {
    it('should allow PDF files', () => {
      const result = validateMimeType('application/pdf');
      expect(result.allowed).toBe(true);
    });

    it('should allow Office documents', () => {
      const docxResult = validateMimeType('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      const xlsxResult = validateMimeType('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      const pptxResult = validateMimeType('application/vnd.openxmlformats-officedocument.presentationml.presentation');
      
      expect(docxResult.allowed).toBe(true);
      expect(xlsxResult.allowed).toBe(true);
      expect(pptxResult.allowed).toBe(true);
    });

    it('should allow text files', () => {
      expect(validateMimeType('text/plain').allowed).toBe(true);
      expect(validateMimeType('text/csv').allowed).toBe(true);
      expect(validateMimeType('text/html').allowed).toBe(true);
    });

    it('should allow JSON and XML', () => {
      expect(validateMimeType('application/json').allowed).toBe(true);
      expect(validateMimeType('application/xml').allowed).toBe(true);
    });

    it('should allow images', () => {
      expect(validateMimeType('image/png').allowed).toBe(true);
      expect(validateMimeType('image/jpeg').allowed).toBe(true);
    });

    it('should deny executable MIME types', () => {
      const result = validateMimeType('application/x-executable');
      expect(result.allowed).toBe(false);
      expect(result.matchedRule).toBe('denylist');
    });

    it('should deny Windows executables', () => {
      expect(validateMimeType('application/x-msdos-program').allowed).toBe(false);
      expect(validateMimeType('application/x-msdownload').allowed).toBe(false);
    });

    it('should deny shell scripts', () => {
      expect(validateMimeType('application/x-sh').allowed).toBe(false);
      expect(validateMimeType('application/x-shellscript').allowed).toBe(false);
    });

    it('should deny JavaScript files', () => {
      expect(validateMimeType('application/javascript').allowed).toBe(false);
      expect(validateMimeType('text/javascript').allowed).toBe(false);
    });
  });

  describe('Dangerous Format Detection via Magic Bytes', () => {
    it('should detect Windows EXE files (MZ header)', () => {
      const exeBuffer = Buffer.from([0x4D, 0x5A, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
      const result = detectDangerousFormat(exeBuffer);
      
      expect(result.isDangerous).toBe(true);
      expect(result.signature?.threat).toBe('executable');
    });

    it('should detect ELF executables', () => {
      const elfBuffer = Buffer.from([0x7F, 0x45, 0x4C, 0x46, 0x02, 0x01, 0x01, 0x00]);
      const result = detectDangerousFormat(elfBuffer);
      
      expect(result.isDangerous).toBe(true);
      expect(result.signature?.description).toContain('ELF');
    });

    it('should detect shell scripts with shebang', () => {
      const shScript = Buffer.from('#!/bin/bash\necho "Hello"\n');
      const result = detectDangerousFormat(shScript);
      
      expect(result.isDangerous).toBe(true);
      expect(result.isShellScript).toBe(true);
    });

    it('should detect python scripts with shebang', () => {
      const pyScript = Buffer.from('#!/usr/bin/env python\nprint("Hello")\n');
      const result = detectDangerousFormat(pyScript);
      
      expect(result.isDangerous).toBe(true);
      expect(result.isShellScript).toBe(true);
    });

    it('should not flag PDF files as dangerous', () => {
      const pdfBuffer = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x34]);
      const result = detectDangerousFormat(pdfBuffer);
      
      expect(result.isDangerous).toBe(false);
    });

    it('should not flag PNG images as dangerous', () => {
      const pngBuffer = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
      const result = detectDangerousFormat(pngBuffer);
      
      expect(result.isDangerous).toBe(false);
    });
  });

  describe('Decompression Limit Enforcement', () => {
    it('should block archives with too many files', async () => {
      const zip = new JSZip();
      
      for (let i = 0; i < 100; i++) {
        zip.file(`file_${i}.txt`, 'content');
      }
      
      const buffer = Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }));
      const result = await checkZipBomb(buffer, { maxFileCount: 50 });
      
      expect(result.blocked).toBe(true);
      expect(result.violations.some(v => v.code === ZipViolationCode.EXCESSIVE_FILE_COUNT)).toBe(true);
    });

    it('should allow archives within file count limit', async () => {
      const zip = new JSZip();
      
      for (let i = 0; i < 10; i++) {
        zip.file(`file_${i}.txt`, 'content');
      }
      
      const buffer = Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }));
      const result = await checkZipBomb(buffer, { maxFileCount: 100 });
      
      expect(result.blocked).toBe(false);
    });

    it('should detect suspicious compression ratios', async () => {
      const zip = new JSZip();
      const largeContent = 'A'.repeat(1024 * 1024);
      zip.file('large.txt', largeContent);
      
      const buffer = Buffer.from(await zip.generateAsync({ 
        type: 'nodebuffer',
        compression: 'DEFLATE',
        compressionOptions: { level: 9 }
      }));
      
      const result = await checkZipBomb(buffer, { maxCompressionRatio: 5 });
      
      expect(result.blocked).toBe(true);
      expect(result.violations.some(v => v.code === ZipViolationCode.EXCESSIVE_COMPRESSION)).toBe(true);
    });
  });

  describe('Nested Archive Depth Limit', () => {
    it('should block deeply nested archives', async () => {
      let innerZip = new JSZip();
      innerZip.file('innermost.txt', 'content');
      
      for (let i = 0; i < 3; i++) {
        const innerBuffer = await innerZip.generateAsync({ type: 'nodebuffer' });
        const outerZip = new JSZip();
        outerZip.file(`level_${i}.zip`, innerBuffer);
        innerZip = outerZip;
      }
      
      const buffer = Buffer.from(await innerZip.generateAsync({ type: 'nodebuffer' }));
      const result = await checkZipBomb(buffer, { maxNestedDepth: 2 });
      
      expect(result.blocked).toBe(true);
      expect(result.violations.some(v => v.code === ZipViolationCode.EXCESSIVE_NESTING)).toBe(true);
    });

    it('should allow archives within nesting limit', async () => {
      const innerZip = new JSZip();
      innerZip.file('inner.txt', 'content');
      const innerBuffer = await innerZip.generateAsync({ type: 'nodebuffer' });
      
      const outerZip = new JSZip();
      outerZip.file('inner.zip', innerBuffer);
      outerZip.file('normal.txt', 'content');
      
      const buffer = Buffer.from(await outerZip.generateAsync({ type: 'nodebuffer' }));
      const result = await checkZipBomb(buffer, { maxNestedDepth: 2 });
      
      expect(result.blocked).toBe(false);
    });
  });

  describe('Unified Security Guard Integration', () => {
    it('should validate safe PDF attachment', async () => {
      const pdfBuffer = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x34]);
      
      const attachment: AttachmentInput = {
        filename: 'document.pdf',
        buffer: pdfBuffer,
        providedMimeType: 'application/pdf',
      };
      
      const result = await validateAttachmentSecurity(attachment);
      
      expect(result.safe).toBe(true);
      expect(result.checksPerformed.mimeValidation).toBe(true);
      expect(result.checksPerformed.dangerousFormatCheck).toBe(true);
    });

    it('should reject executable disguised as document', async () => {
      const exeBuffer = Buffer.from([0x4D, 0x5A, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
      
      const attachment: AttachmentInput = {
        filename: 'document.pdf',
        buffer: exeBuffer,
        providedMimeType: 'application/pdf',
      };
      
      const result = await validateAttachmentSecurity(attachment);
      
      expect(result.safe).toBe(false);
      expect(result.violations.some(v => v.type === SecurityViolationType.DANGEROUS_FORMAT)).toBe(true);
    });

    it('should reject ZIP with path traversal', async () => {
      const zip = new JSZip();
      zip.file('../../../etc/passwd', 'malicious');
      const zipBuffer = Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }));
      
      const attachment: AttachmentInput = {
        filename: 'archive.zip',
        buffer: zipBuffer,
        providedMimeType: 'application/zip',
      };
      
      const result = await validateAttachmentSecurity(attachment);
      
      expect(result.safe).toBe(false);
      expect(result.violations.some(v => v.type === SecurityViolationType.PATH_TRAVERSAL)).toBe(true);
    });

    it('should check DOCX files for ZIP bomb characteristics', async () => {
      const zip = new JSZip();
      zip.file('word/document.xml', '<w:document></w:document>');
      zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types></Types>');
      const docxBuffer = Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }));
      
      const attachment: AttachmentInput = {
        filename: 'document.docx',
        buffer: docxBuffer,
        providedMimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      };
      
      const result = await validateAttachmentSecurity(attachment);
      
      expect(result.checksPerformed.zipBombCheck).toBe(true);
      expect(result.checksPerformed.pathTraversalCheck).toBe(true);
    });

    it('should use isAttachmentSafe for quick checks', async () => {
      const textBuffer = Buffer.from('Hello, World!');
      
      const attachment: AttachmentInput = {
        filename: 'message.txt',
        buffer: textBuffer,
        providedMimeType: 'text/plain',
      };
      
      const isSafe = await isAttachmentSafe(attachment);
      expect(isSafe).toBe(true);
    });

    it('should reject shell script uploaded as text', async () => {
      const shellBuffer = Buffer.from('#!/bin/bash\nrm -rf /\n');
      
      const attachment: AttachmentInput = {
        filename: 'script.txt',
        buffer: shellBuffer,
        providedMimeType: 'text/plain',
      };
      
      const result = await validateAttachmentSecurity(attachment);
      
      expect(result.safe).toBe(false);
      expect(result.violations.some(v => v.type === SecurityViolationType.DANGEROUS_FORMAT)).toBe(true);
    });

    it('should enforce file size limits', async () => {
      const largeBuffer = Buffer.alloc(200 * 1024 * 1024);
      
      const attachment: AttachmentInput = {
        filename: 'large.bin',
        buffer: largeBuffer,
        providedMimeType: 'application/octet-stream',
      };
      
      const result = await validateAttachmentSecurity(attachment, { maxFileSizeMB: 100 });
      
      expect(result.safe).toBe(false);
      expect(result.violations.some(v => v.type === SecurityViolationType.EXCESSIVE_SIZE)).toBe(true);
    });
  });

  describe('Security Violation Logging', () => {
    it('should include timestamp in violations', async () => {
      const exeBuffer = Buffer.from([0x4D, 0x5A, 0x90, 0x00]);
      
      const attachment: AttachmentInput = {
        filename: 'malware.exe',
        buffer: exeBuffer,
        providedMimeType: 'application/octet-stream',
      };
      
      const result = await validateAttachmentSecurity(attachment);
      
      for (const violation of result.violations) {
        expect(violation.timestamp).toBeDefined();
        expect(new Date(violation.timestamp).getTime()).not.toBeNaN();
      }
    });

    it('should include severity levels in violations', async () => {
      const zip = new JSZip();
      zip.file('../malicious.txt', 'content');
      const zipBuffer = Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }));
      
      const attachment: AttachmentInput = {
        filename: 'archive.zip',
        buffer: zipBuffer,
      };
      
      const result = await validateAttachmentSecurity(attachment);
      
      for (const violation of result.violations) {
        expect(['critical', 'high', 'medium', 'low']).toContain(violation.severity);
      }
    });

    it('should track processing time', async () => {
      const zip = new JSZip();
      zip.file('test.txt', 'content');
      const buffer = Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }));
      
      const attachment: AttachmentInput = {
        filename: 'archive.zip',
        buffer,
      };
      
      const result = await validateAttachmentSecurity(attachment);
      
      expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
    });
  });
});
