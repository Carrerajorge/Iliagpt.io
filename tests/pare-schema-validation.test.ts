import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  validateAnalyzeRequest,
  validateChatRequest,
  canonicalizeAnalyzeRequest,
  canonicalizeChatRequest,
  formatZodErrors,
  type AnalyzeRequest,
  type ChatRequest,
} from "../server/lib/pareSchemas";
import {
  checkTypeLimits,
  estimateLimitsFromSize,
  formatViolationMessage,
  DEFAULT_TYPE_LIMITS,
} from "../server/lib/pareTypeLimits";

describe("PARE Schema Validation", () => {
  describe("AnalyzeRequestSchema", () => {
    const validRequest: AnalyzeRequest = {
      messages: [{ role: "user", content: "Analyze this document" }],
      attachments: [
        {
          name: "test.pdf",
          mimeType: "application/pdf",
          type: "document",
          url: "https://example.com/test.pdf",
        },
      ],
    };

    it("should accept valid request", () => {
      const result = validateAnalyzeRequest(validRequest);
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data?.messages).toHaveLength(1);
      expect(result.data?.attachments).toHaveLength(1);
    });

    it("should accept request with content instead of url", () => {
      const request = {
        ...validRequest,
        attachments: [
          {
            name: "test.pdf",
            mimeType: "application/pdf",
            type: "document",
            content: "base64encodedcontent",
          },
        ],
      };
      const result = validateAnalyzeRequest(request);
      expect(result.success).toBe(true);
    });

    it("should accept request with storagePath", () => {
      const request = {
        ...validRequest,
        attachments: [
          {
            name: "test.pdf",
            mimeType: "application/pdf",
            type: "document",
            storagePath: "/storage/files/test.pdf",
          },
        ],
      };
      const result = validateAnalyzeRequest(request);
      expect(result.success).toBe(true);
    });

    it("should accept request with fileId", () => {
      const request = {
        ...validRequest,
        attachments: [
          {
            name: "test.pdf",
            mimeType: "application/pdf",
            type: "document",
            fileId: "file-123",
          },
        ],
      };
      const result = validateAnalyzeRequest(request);
      expect(result.success).toBe(true);
    });

    it("should reject missing messages", () => {
      const request = {
        attachments: validRequest.attachments,
      };
      const result = validateAnalyzeRequest(request);
      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors?.some((e) => e.path === "messages")).toBe(true);
    });

    it("should reject empty messages array", () => {
      const request = {
        messages: [],
        attachments: validRequest.attachments,
      };
      const result = validateAnalyzeRequest(request);
      expect(result.success).toBe(false);
      expect(result.errors?.some((e) => e.message.includes("At least one message"))).toBe(true);
    });

    it("should reject missing attachments", () => {
      const request = {
        messages: validRequest.messages,
      };
      const result = validateAnalyzeRequest(request);
      expect(result.success).toBe(false);
      expect(result.errors?.some((e) => e.path === "attachments")).toBe(true);
    });

    it("should reject empty attachments array", () => {
      const request = {
        messages: validRequest.messages,
        attachments: [],
      };
      const result = validateAnalyzeRequest(request);
      expect(result.success).toBe(false);
      expect(result.errors?.some((e) => e.message.includes("At least one attachment"))).toBe(true);
    });

    it("should reject more than 20 attachments", () => {
      const attachments = Array(21).fill(null).map((_, i) => ({
        name: `file${i}.pdf`,
        mimeType: "application/pdf",
        type: "document" as const,
        url: `https://example.com/file${i}.pdf`,
      }));

      const request = {
        messages: validRequest.messages,
        attachments,
      };
      const result = validateAnalyzeRequest(request);
      expect(result.success).toBe(false);
      expect(result.errors?.some((e) => e.message.includes("Maximum 20 attachments"))).toBe(true);
    });

    it("should reject more than 100 messages", () => {
      const messages = Array(101).fill(null).map((_, i) => ({
        role: "user" as const,
        content: `Message ${i}`,
      }));

      const request = {
        messages,
        attachments: validRequest.attachments,
      };
      const result = validateAnalyzeRequest(request);
      expect(result.success).toBe(false);
      expect(result.errors?.some((e) => e.message.includes("Maximum 100 messages"))).toBe(true);
    });

    it("should reject message content exceeding 100000 characters", () => {
      const longContent = "a".repeat(100001);
      const request = {
        messages: [{ role: "user", content: longContent }],
        attachments: validRequest.attachments,
      };
      const result = validateAnalyzeRequest(request);
      expect(result.success).toBe(false);
      expect(result.errors?.some((e) => e.message.includes("100,000 character limit"))).toBe(true);
    });

    it("should reject empty message content", () => {
      const request = {
        messages: [{ role: "user", content: "" }],
        attachments: validRequest.attachments,
      };
      const result = validateAnalyzeRequest(request);
      expect(result.success).toBe(false);
      expect(result.errors?.some((e) => e.message.includes("cannot be empty"))).toBe(true);
    });

    it("should reject invalid mimeType format", () => {
      const request = {
        messages: validRequest.messages,
        attachments: [
          {
            name: "test.pdf",
            mimeType: "invalid-mime",
            type: "document",
            url: "https://example.com/test.pdf",
          },
        ],
      };
      const result = validateAnalyzeRequest(request);
      expect(result.success).toBe(false);
      expect(result.errors?.some((e) => e.message.includes("Invalid mimeType format"))).toBe(true);
    });

    it("should accept valid mimeType formats", () => {
      const validMimeTypes = [
        "application/pdf",
        "text/plain",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "image/jpeg",
        "application/json",
      ];

      for (const mimeType of validMimeTypes) {
        const request = {
          messages: validRequest.messages,
          attachments: [
            {
              name: "test.file",
              mimeType,
              type: "document" as const,
              url: "https://example.com/test.file",
            },
          ],
        };
        const result = validateAnalyzeRequest(request);
        expect(result.success).toBe(true);
      }
    });

    it("should reject invalid attachment type", () => {
      const request = {
        messages: validRequest.messages,
        attachments: [
          {
            name: "test.pdf",
            mimeType: "application/pdf",
            type: "unknown",
            url: "https://example.com/test.pdf",
          },
        ],
      };
      const result = validateAnalyzeRequest(request);
      expect(result.success).toBe(false);
      expect(result.errors?.some((e) => e.message.includes("'document', 'image', or 'file'"))).toBe(true);
    });

    it("should reject attachment without content, url, storagePath, or fileId", () => {
      const request = {
        messages: validRequest.messages,
        attachments: [
          {
            name: "test.pdf",
            mimeType: "application/pdf",
            type: "document",
          },
        ],
      };
      const result = validateAnalyzeRequest(request);
      expect(result.success).toBe(false);
      expect(result.errors?.some((e) => e.message.includes("content, url, storagePath, or fileId"))).toBe(true);
    });

    it("should reject invalid URL format", () => {
      const request = {
        messages: validRequest.messages,
        attachments: [
          {
            name: "test.pdf",
            mimeType: "application/pdf",
            type: "document",
            url: "not-a-valid-url",
          },
        ],
      };
      const result = validateAnalyzeRequest(request);
      expect(result.success).toBe(false);
      expect(result.errors?.some((e) => e.message.includes("Invalid URL"))).toBe(true);
    });

    it("should reject attachment name exceeding 255 characters", () => {
      const longName = "a".repeat(256) + ".pdf";
      const request = {
        messages: validRequest.messages,
        attachments: [
          {
            name: longName,
            mimeType: "application/pdf",
            type: "document",
            url: "https://example.com/test.pdf",
          },
        ],
      };
      const result = validateAnalyzeRequest(request);
      expect(result.success).toBe(false);
      expect(result.errors?.some((e) => e.message.includes("exceeds 255 characters"))).toBe(true);
    });

    it("should reject invalid message role", () => {
      const request = {
        messages: [{ role: "admin", content: "Test" }],
        attachments: validRequest.attachments,
      };
      const result = validateAnalyzeRequest(request);
      expect(result.success).toBe(false);
    });

    it("should accept all valid message roles", () => {
      const roles = ["user", "assistant", "system"] as const;
      for (const role of roles) {
        const request = {
          messages: [{ role, content: "Test" }],
          attachments: validRequest.attachments,
        };
        const result = validateAnalyzeRequest(request);
        expect(result.success).toBe(true);
      }
    });
  });

  describe("Field Canonicalization", () => {
    it("should trim message content", () => {
      const request: AnalyzeRequest = {
        messages: [{ role: "user", content: "  test message  " }],
        attachments: [
          {
            name: "test.pdf",
            mimeType: "application/pdf",
            type: "document",
            url: "https://example.com/test.pdf",
          },
        ],
      };
      const canonicalized = canonicalizeAnalyzeRequest(request);
      expect(canonicalized.messages[0].content).toBe("test message");
    });

    it("should trim attachment name", () => {
      const request: AnalyzeRequest = {
        messages: [{ role: "user", content: "test" }],
        attachments: [
          {
            name: "  test.pdf  ",
            mimeType: "application/pdf",
            type: "document",
            url: "https://example.com/test.pdf",
          },
        ],
      };
      const canonicalized = canonicalizeAnalyzeRequest(request);
      expect(canonicalized.attachments[0].name).toBe("test.pdf");
    });

    it("should lowercase mimeType", () => {
      const request: AnalyzeRequest = {
        messages: [{ role: "user", content: "test" }],
        attachments: [
          {
            name: "test.pdf",
            mimeType: "Application/PDF",
            type: "document",
            url: "https://example.com/test.pdf",
          },
        ],
      };
      const canonicalized = canonicalizeAnalyzeRequest(request);
      expect(canonicalized.attachments[0].mimeType).toBe("application/pdf");
    });

    it("should trim mimeType", () => {
      const request: AnalyzeRequest = {
        messages: [{ role: "user", content: "test" }],
        attachments: [
          {
            name: "test.pdf",
            mimeType: "  application/pdf  ",
            type: "document",
            url: "https://example.com/test.pdf",
          },
        ],
      };
      const canonicalized = canonicalizeAnalyzeRequest(request);
      expect(canonicalized.attachments[0].mimeType).toBe("application/pdf");
    });

    it("should trim URL", () => {
      const request: AnalyzeRequest = {
        messages: [{ role: "user", content: "test" }],
        attachments: [
          {
            name: "test.pdf",
            mimeType: "application/pdf",
            type: "document",
            url: "  https://example.com/test.pdf  ",
          },
        ],
      };
      const canonicalized = canonicalizeAnalyzeRequest(request);
      expect(canonicalized.attachments[0].url).toBe("https://example.com/test.pdf");
    });

    it("should trim conversationId", () => {
      const request: AnalyzeRequest = {
        messages: [{ role: "user", content: "test" }],
        conversationId: "  conv-123  ",
        attachments: [
          {
            name: "test.pdf",
            mimeType: "application/pdf",
            type: "document",
            url: "https://example.com/test.pdf",
          },
        ],
      };
      const canonicalized = canonicalizeAnalyzeRequest(request);
      expect(canonicalized.conversationId).toBe("conv-123");
    });
  });

  describe("ChatRequestSchema", () => {
    it("should accept request without attachments", () => {
      const request = {
        messages: [{ role: "user", content: "Hello" }],
      };
      const result = validateChatRequest(request);
      expect(result.success).toBe(true);
    });

    it("should accept request with optional fields", () => {
      const request = {
        messages: [{ role: "user", content: "Hello" }],
        useRag: true,
        provider: "anthropic",
        model: "claude-3",
      };
      const result = validateChatRequest(request);
      expect(result.success).toBe(true);
    });
  });

  describe("formatZodErrors", () => {
    it("should format errors with path and message", () => {
      const result = validateAnalyzeRequest({ messages: [] });
      expect(result.errors).toBeDefined();
      expect(result.errors?.[0]).toHaveProperty("path");
      expect(result.errors?.[0]).toHaveProperty("message");
      expect(result.errors?.[0]).toHaveProperty("code");
    });
  });
});

describe("PARE Type Limits", () => {
  describe("checkTypeLimits", () => {
    it("should pass for PDF within limits", () => {
      const result = checkTypeLimits(
        { name: "test.pdf", mimeType: "application/pdf", size: 1000000 },
        { pageCount: 50 }
      );
      expect(result.passed).toBe(true);
      expect(result.violation).toBeUndefined();
    });

    it("should fail for PDF exceeding page limit", () => {
      const result = checkTypeLimits(
        { name: "test.pdf", mimeType: "application/pdf" },
        { pageCount: 6000 }
      );
      expect(result.passed).toBe(false);
      expect(result.violation).toBeDefined();
      expect(result.violation?.type).toBe("pdf");
      expect(result.violation?.metric).toBe("pages");
      expect(result.violation?.limit).toBe(5000);
      expect(result.violation?.actual).toBe(6000);
    });

    it("should fail for PDF exceeding size limit", () => {
      const result = checkTypeLimits(
        { name: "test.pdf", mimeType: "application/pdf", size: 600 * 1024 * 1024 },
        {}
      );
      expect(result.passed).toBe(false);
      expect(result.violation?.metric).toBe("size");
    });

    it("should pass for XLSX within limits", () => {
      const result = checkTypeLimits(
        { name: "test.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
        { rowCount: 50000, cellCount: 500000 }
      );
      expect(result.passed).toBe(true);
    });

    it("should fail for XLSX exceeding row limit", () => {
      const result = checkTypeLimits(
        { name: "test.xlsx" },
        { rowCount: 1500000 }
      );
      expect(result.passed).toBe(false);
      expect(result.violation?.type).toBe("xlsx");
      expect(result.violation?.metric).toBe("rows");
    });

    it("should fail for XLSX exceeding cell limit", () => {
      const result = checkTypeLimits(
        { name: "test.xlsx" },
        { cellCount: 20000000 }
      );
      expect(result.passed).toBe(false);
      expect(result.violation?.metric).toBe("cells");
    });

    it("should fail for XLSX exceeding sheet limit", () => {
      const result = checkTypeLimits(
        { name: "test.xlsx" },
        { sheetCount: 300 }
      );
      expect(result.passed).toBe(false);
      expect(result.violation?.metric).toBe("sheets");
    });

    it("should pass for CSV within limits", () => {
      const result = checkTypeLimits(
        { name: "data.csv", mimeType: "text/csv" },
        { rowCount: 50000 }
      );
      expect(result.passed).toBe(true);
    });

    it("should fail for CSV exceeding row limit", () => {
      const result = checkTypeLimits(
        { name: "data.csv" },
        { rowCount: 1500000 }
      );
      expect(result.passed).toBe(false);
      expect(result.violation?.type).toBe("csv");
    });

    it("should fail for CSV exceeding column limit", () => {
      const result = checkTypeLimits(
        { name: "data.csv" },
        { columnCount: 15000 }
      );
      expect(result.passed).toBe(false);
      expect(result.violation?.metric).toBe("columns");
    });

    it("should pass for PPTX within limits", () => {
      const result = checkTypeLimits(
        { name: "presentation.pptx" },
        { slideCount: 100 }
      );
      expect(result.passed).toBe(true);
    });

    it("should fail for PPTX exceeding slide limit", () => {
      const result = checkTypeLimits(
        { name: "presentation.pptx" },
        { slideCount: 3000 }
      );
      expect(result.passed).toBe(false);
      expect(result.violation?.type).toBe("pptx");
      expect(result.violation?.metric).toBe("slides");
    });

    it("should pass for DOCX within limits", () => {
      const result = checkTypeLimits(
        { name: "document.docx" },
        { pageCount: 100 }
      );
      expect(result.passed).toBe(true);
    });

    it("should fail for DOCX exceeding page limit", () => {
      const result = checkTypeLimits(
        { name: "document.docx" },
        { pageCount: 6000 }
      );
      expect(result.passed).toBe(false);
      expect(result.violation?.type).toBe("docx");
    });

    it("should pass for unknown file types", () => {
      const result = checkTypeLimits(
        { name: "unknown.xyz" },
        { pageCount: 1000 }
      );
      expect(result.passed).toBe(true);
    });

    it("should detect file type from mimeType when extension missing", () => {
      const result = checkTypeLimits(
        { name: "document", mimeType: "application/pdf" },
        { pageCount: 6000 }
      );
      expect(result.passed).toBe(false);
      expect(result.violation?.type).toBe("pdf");
    });

    it("should warn when approaching limits", () => {
      const result = checkTypeLimits(
        { name: "test.pdf" },
        { pageCount: 4500 }
      );
      expect(result.passed).toBe(true);
      expect(result.warnings).toBeDefined();
      expect(result.warnings?.length).toBeGreaterThan(0);
    });

    it("should use custom limits when provided", () => {
      const customLimits = {
        ...DEFAULT_TYPE_LIMITS,
        pdf: { maxPages: 100, maxSizeBytes: 10 * 1024 * 1024 },
      };
      const result = checkTypeLimits(
        { name: "test.pdf" },
        { pageCount: 150 },
        customLimits
      );
      expect(result.passed).toBe(false);
      expect(result.violation?.limit).toBe(100);
    });
  });

  describe("estimateLimitsFromSize", () => {
    it("should not flag small files", () => {
      const result = estimateLimitsFromSize({
        name: "small.pdf",
        size: 100000,
      });
      expect(result.wouldExceed).toBe(false);
    });

    it("should flag very large PDFs", () => {
      const result = estimateLimitsFromSize({
        name: "large.pdf",
        size: 500 * 1024 * 1024,
      });
      expect(result.wouldExceed).toBe(true);
      expect(result.reason).toContain("pages");
    });

    it("should flag very large Excel files", () => {
      const result = estimateLimitsFromSize({
        name: "large.xlsx",
        size: 200 * 1024 * 1024,
      });
      expect(result.wouldExceed).toBe(true);
      expect(result.reason).toContain("cells");
    });

    it("should handle files without size", () => {
      const result = estimateLimitsFromSize({
        name: "test.pdf",
      });
      expect(result.wouldExceed).toBe(false);
    });

    it("should handle unknown file types", () => {
      const result = estimateLimitsFromSize({
        name: "test.unknown",
        size: 1000000000,
      });
      expect(result.wouldExceed).toBe(false);
    });
  });

  describe("formatViolationMessage", () => {
    it("should format size violations with MB", () => {
      const message = formatViolationMessage({
        type: "pdf",
        metric: "size",
        limit: 50 * 1024 * 1024,
        actual: 75 * 1024 * 1024,
        unit: "bytes",
      });
      expect(message).toContain("75.0MB");
      expect(message).toContain("50.0MB");
    });

    it("should format page violations", () => {
      const message = formatViolationMessage({
        type: "pdf",
        metric: "pages",
        limit: 500,
        actual: 750,
        unit: "pages",
      });
      expect(message).toContain("PDF");
      expect(message).toContain("750");
      expect(message).toContain("500");
    });

    it("should format cell violations with locale numbers", () => {
      const message = formatViolationMessage({
        type: "xlsx",
        metric: "cells",
        limit: 1000000,
        actual: 1500000,
        unit: "cells",
      });
      expect(message).toContain("1,500,000");
      expect(message).toContain("1,000,000");
    });
  });
});
