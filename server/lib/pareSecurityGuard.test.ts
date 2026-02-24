import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the external dependencies
vi.mock("./mimeDetector", () => ({
  detectMime: vi.fn(),
  validateMimeType: vi.fn(),
  detectDangerousFormat: vi.fn(),
}));

vi.mock("./zipBombGuard", () => ({
  checkZipBomb: vi.fn(),
  checkPathTraversalInZip: vi.fn(),
  ZipViolationCode: {
    PATH_TRAVERSAL: "PATH_TRAVERSAL",
    ABSOLUTE_PATH: "ABSOLUTE_PATH",
    EXCESSIVE_COMPRESSION: "EXCESSIVE_COMPRESSION",
    EXCESSIVE_FILE_COUNT: "EXCESSIVE_FILE_COUNT",
    EXCESSIVE_SIZE: "EXCESSIVE_SIZE",
    EXCESSIVE_NESTING: "EXCESSIVE_NESTING",
    NESTED_ARCHIVE_VIOLATION: "NESTED_ARCHIVE_VIOLATION",
    PARSE_ERROR: "PARSE_ERROR",
  },
}));

import {
  validateAttachmentSecurity,
  isAttachmentSafe,
  validateAttachmentsBatch,
  SecurityViolationType,
} from "./pareSecurityGuard";
import type { AttachmentInput, SecurityGuardOptions } from "./pareSecurityGuard";

import { detectMime, validateMimeType, detectDangerousFormat } from "./mimeDetector";
import { checkZipBomb } from "./zipBombGuard";

const mockedDetectMime = vi.mocked(detectMime);
const mockedValidateMimeType = vi.mocked(validateMimeType);
const mockedDetectDangerousFormat = vi.mocked(detectDangerousFormat);
const mockedCheckZipBomb = vi.mocked(checkZipBomb);

function makeSafeDefaults() {
  mockedDetectMime.mockReturnValue({
    detectedMime: "text/plain",
    mismatch: false,
    mismatchDetails: undefined,
    confidence: "high",
    source: "magic",
  } as any);
  mockedValidateMimeType.mockReturnValue({
    allowed: true,
    reason: undefined,
    matchedRule: "text/*",
  } as any);
  mockedDetectDangerousFormat.mockReturnValue({
    isDangerous: false,
    isShellScript: false,
    signature: undefined,
  } as any);
}

describe("validateAttachmentSecurity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Silence console output during tests
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    makeSafeDefaults();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should pass a safe plain text file", async () => {
    const attachment: AttachmentInput = {
      filename: "readme.txt",
      buffer: Buffer.from("Hello world"),
    };

    const result = await validateAttachmentSecurity(attachment);
    expect(result.safe).toBe(true);
    expect(result.violations).toHaveLength(0);
    expect(result.checksPerformed.mimeValidation).toBe(true);
    expect(result.checksPerformed.dangerousFormatCheck).toBe(true);
  });

  it("should reject files exceeding the size limit", async () => {
    const bigBuffer = Buffer.alloc(200 * 1024 * 1024); // 200MB
    const attachment: AttachmentInput = {
      filename: "huge.bin",
      buffer: bigBuffer,
    };

    const result = await validateAttachmentSecurity(attachment, { maxFileSizeMB: 100 });
    expect(result.safe).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
    expect(result.violations[0].type).toBe(SecurityViolationType.EXCESSIVE_SIZE);
  });

  it("should reject files exceeding a custom size limit", async () => {
    const buffer = Buffer.alloc(6 * 1024 * 1024); // 6MB
    const attachment: AttachmentInput = {
      filename: "medium.bin",
      buffer,
    };

    const result = await validateAttachmentSecurity(attachment, { maxFileSizeMB: 5 });
    expect(result.safe).toBe(false);
    expect(result.violations[0].type).toBe(SecurityViolationType.EXCESSIVE_SIZE);
    expect(result.violations[0].details?.actualSize).toBe(buffer.length);
  });

  it("should flag MIME denied files", async () => {
    mockedValidateMimeType.mockReturnValue({
      allowed: false,
      reason: "Executable files not allowed",
      matchedRule: "application/x-executable",
    } as any);

    const attachment: AttachmentInput = {
      filename: "malware.exe",
      buffer: Buffer.from("MZ..."),
      providedMimeType: "application/x-executable",
    };

    // In strict mode, high-severity violations make the file unsafe
    const result = await validateAttachmentSecurity(attachment, { strictMode: true });
    expect(result.safe).toBe(false);
    const mimeViolation = result.violations.find(
      (v) => v.type === SecurityViolationType.MIME_DENIED
    );
    expect(mimeViolation).toBeDefined();
    expect(mimeViolation!.severity).toBe("high");
  });

  it("should flag MIME mismatch in strict mode", async () => {
    mockedDetectMime.mockReturnValue({
      detectedMime: "application/javascript",
      mismatch: true,
      mismatchDetails: "Extension says .txt but content is JavaScript",
      confidence: "high",
      source: "magic",
    } as any);

    const attachment: AttachmentInput = {
      filename: "sneaky.txt",
      buffer: Buffer.from("#!/usr/bin/env node"),
      providedMimeType: "text/plain",
    };

    const result = await validateAttachmentSecurity(attachment, { strictMode: true });
    const mismatchViolation = result.violations.find(
      (v) => v.type === SecurityViolationType.MIME_MISMATCH
    );
    expect(mismatchViolation).toBeDefined();
    expect(mismatchViolation!.severity).toBe("medium");
  });

  it("should NOT flag MIME mismatch when allowMimeMismatch is true", async () => {
    mockedDetectMime.mockReturnValue({
      detectedMime: "application/javascript",
      mismatch: true,
      mismatchDetails: "Mismatch detected",
      confidence: "high",
      source: "magic",
    } as any);

    const attachment: AttachmentInput = {
      filename: "file.txt",
      buffer: Buffer.from("content"),
      providedMimeType: "text/plain",
    };

    const result = await validateAttachmentSecurity(attachment, {
      strictMode: true,
      allowMimeMismatch: true,
    });
    const mismatchViolation = result.violations.find(
      (v) => v.type === SecurityViolationType.MIME_MISMATCH
    );
    expect(mismatchViolation).toBeUndefined();
  });

  it("should flag dangerous formats", async () => {
    mockedDetectDangerousFormat.mockReturnValue({
      isDangerous: true,
      isShellScript: true,
      signature: undefined,
    } as any);

    const attachment: AttachmentInput = {
      filename: "script.sh",
      buffer: Buffer.from("#!/bin/bash\nrm -rf /"),
    };

    const result = await validateAttachmentSecurity(attachment);
    const dangerViolation = result.violations.find(
      (v) => v.type === SecurityViolationType.DANGEROUS_FORMAT
    );
    expect(dangerViolation).toBeDefined();
    expect(dangerViolation!.severity).toBe("critical");
    expect(dangerViolation!.message).toContain("Shell script");
  });

  it("should run zip checks on .zip files", async () => {
    // Create a minimal ZIP magic bytes buffer
    const zipBuffer = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0, 0, 0]);

    mockedCheckZipBomb.mockResolvedValue({
      safe: true,
      suspicious: false,
      blocked: false,
      reason: undefined,
      violations: [],
      metrics: {} as any,
    } as any);

    const attachment: AttachmentInput = {
      filename: "archive.zip",
      buffer: zipBuffer,
    };

    const result = await validateAttachmentSecurity(attachment);
    expect(result.checksPerformed.zipBombCheck).toBe(true);
    expect(result.checksPerformed.pathTraversalCheck).toBe(true);
    expect(mockedCheckZipBomb).toHaveBeenCalledWith(zipBuffer);
  });

  it("should detect zip bombs and flag them", async () => {
    const zipBuffer = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);

    mockedCheckZipBomb.mockResolvedValue({
      safe: false,
      suspicious: true,
      blocked: true,
      reason: "Compression ratio exceeds limit",
      violations: [
        {
          code: "EXCESSIVE_COMPRESSION",
          message: "Extreme compression ratio detected",
          path: undefined,
          details: { ratio: 10000 },
        },
      ],
      metrics: {} as any,
    } as any);

    const attachment: AttachmentInput = {
      filename: "bomb.zip",
      buffer: zipBuffer,
    };

    const result = await validateAttachmentSecurity(attachment);
    expect(result.safe).toBe(false);
    const zipViolation = result.violations.find(
      (v) => v.type === SecurityViolationType.ZIP_BOMB
    );
    expect(zipViolation).toBeDefined();
  });

  it("should also run zip checks on docx files (zip-based)", async () => {
    const docxBuffer = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
    mockedCheckZipBomb.mockResolvedValue({
      safe: true,
      suspicious: false,
      blocked: false,
      violations: [],
      metrics: {} as any,
    } as any);

    const attachment: AttachmentInput = {
      filename: "document.docx",
      buffer: docxBuffer,
    };

    const result = await validateAttachmentSecurity(attachment);
    expect(result.checksPerformed.zipBombCheck).toBe(true);
    expect(mockedCheckZipBomb).toHaveBeenCalled();
  });

  it("should NOT run zip checks on non-zip files", async () => {
    const attachment: AttachmentInput = {
      filename: "image.png",
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]), // PNG magic bytes
    };

    const result = await validateAttachmentSecurity(attachment);
    expect(result.checksPerformed.zipBombCheck).toBe(false);
    expect(mockedCheckZipBomb).not.toHaveBeenCalled();
  });

  it("should return processingTimeMs as a non-negative number", async () => {
    const attachment: AttachmentInput = {
      filename: "test.txt",
      buffer: Buffer.from("data"),
    };

    const result = await validateAttachmentSecurity(attachment);
    expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
  });

  it("should handle internal errors gracefully", async () => {
    mockedDetectMime.mockImplementation(() => {
      throw new Error("Unexpected parsing failure");
    });

    const attachment: AttachmentInput = {
      filename: "crash.bin",
      buffer: Buffer.from("data"),
    };

    const result = await validateAttachmentSecurity(attachment);
    expect(result.safe).toBe(false);
    const errorViolation = result.violations.find(
      (v) => v.type === SecurityViolationType.VALIDATION_ERROR
    );
    expect(errorViolation).toBeDefined();
    expect(errorViolation!.message).toContain("Unexpected parsing failure");
  });

  it("should consider critical violations as unsafe", async () => {
    mockedDetectDangerousFormat.mockReturnValue({
      isDangerous: true,
      isShellScript: false,
      signature: { description: "ELF executable", threat: "high" },
    } as any);

    const attachment: AttachmentInput = {
      filename: "elf-binary",
      buffer: Buffer.from("data"),
    };

    const result = await validateAttachmentSecurity(attachment);
    expect(result.safe).toBe(false);
  });

  it("should consider high violations unsafe only in strict mode", async () => {
    mockedValidateMimeType.mockReturnValue({
      allowed: false,
      reason: "Type not allowed",
      matchedRule: "blocked",
    } as any);

    const attachment: AttachmentInput = {
      filename: "file.bin",
      buffer: Buffer.from("data"),
    };

    // Without strict mode: high violation does NOT make it unsafe (only critical does)
    const resultNonStrict = await validateAttachmentSecurity(attachment, { strictMode: false });
    // MIME_DENIED is severity 'high', but without critical violations and not strict mode, safe can be true
    // Actually: hasCriticalViolation is false, strictMode is false, so safe = true
    expect(resultNonStrict.violations.length).toBeGreaterThan(0);

    // With strict mode: high violation makes it unsafe
    const resultStrict = await validateAttachmentSecurity(attachment, { strictMode: true });
    expect(resultStrict.safe).toBe(false);
  });
});

describe("isAttachmentSafe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    makeSafeDefaults();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return true for safe files", async () => {
    const attachment: AttachmentInput = {
      filename: "readme.txt",
      buffer: Buffer.from("Hello"),
    };
    const result = await isAttachmentSafe(attachment);
    expect(result).toBe(true);
  });

  it("should return false for oversized files", async () => {
    const attachment: AttachmentInput = {
      filename: "big.bin",
      buffer: Buffer.alloc(200 * 1024 * 1024),
    };
    const result = await isAttachmentSafe(attachment, { maxFileSizeMB: 100 });
    expect(result).toBe(false);
  });
});

describe("validateAttachmentsBatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    makeSafeDefaults();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return a Map keyed by filename", async () => {
    const attachments: AttachmentInput[] = [
      { filename: "a.txt", buffer: Buffer.from("aaa") },
      { filename: "b.txt", buffer: Buffer.from("bbb") },
    ];

    const results = await validateAttachmentsBatch(attachments);
    expect(results).toBeInstanceOf(Map);
    expect(results.size).toBe(2);
    expect(results.has("a.txt")).toBe(true);
    expect(results.has("b.txt")).toBe(true);
  });

  it("should handle an empty attachments array", async () => {
    const results = await validateAttachmentsBatch([]);
    expect(results.size).toBe(0);
  });
});

describe("SecurityViolationType enum", () => {
  it("should contain all expected violation types", () => {
    expect(SecurityViolationType.MIME_DENIED).toBe("MIME_DENIED");
    expect(SecurityViolationType.MIME_MISMATCH).toBe("MIME_MISMATCH");
    expect(SecurityViolationType.DANGEROUS_FORMAT).toBe("DANGEROUS_FORMAT");
    expect(SecurityViolationType.ZIP_BOMB).toBe("ZIP_BOMB");
    expect(SecurityViolationType.PATH_TRAVERSAL).toBe("PATH_TRAVERSAL");
    expect(SecurityViolationType.EXCESSIVE_SIZE).toBe("EXCESSIVE_SIZE");
    expect(SecurityViolationType.EXCESSIVE_FILES).toBe("EXCESSIVE_FILES");
    expect(SecurityViolationType.EXCESSIVE_NESTING).toBe("EXCESSIVE_NESTING");
    expect(SecurityViolationType.VALIDATION_ERROR).toBe("VALIDATION_ERROR");
  });
});
