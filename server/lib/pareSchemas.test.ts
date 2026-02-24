import { describe, it, expect } from "vitest";
import {
  MessageSchema,
  AttachmentSchema,
  AnalyzeRequestSchema,
  ChatRequestSchema,
  TypeLimitsSchema,
  DEFAULT_TYPE_LIMITS,
  formatZodErrors,
  validateAnalyzeRequest,
  validateChatRequest,
  canonicalizeAttachment,
  canonicalizeAnalyzeRequest,
  canonicalizeChatRequest,
} from "./pareSchemas";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Helpers: valid fixtures
// ---------------------------------------------------------------------------
function validMessage(overrides = {}) {
  return { role: "user" as const, content: "Hello world", ...overrides };
}

function validAttachment(overrides = {}) {
  return {
    name: "file.pdf",
    mimeType: "application/pdf",
    type: "document" as const,
    url: "https://example.com/file.pdf",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// MessageSchema
// ---------------------------------------------------------------------------
describe("MessageSchema", () => {
  it("accepts a valid user message", () => {
    const result = MessageSchema.safeParse(validMessage());
    expect(result.success).toBe(true);
  });

  it("accepts all valid roles", () => {
    for (const role of ["user", "assistant", "system"]) {
      const result = MessageSchema.safeParse(validMessage({ role }));
      expect(result.success).toBe(true);
    }
  });

  it("rejects invalid role", () => {
    const result = MessageSchema.safeParse(validMessage({ role: "admin" }));
    expect(result.success).toBe(false);
  });

  it("rejects empty content", () => {
    const result = MessageSchema.safeParse(validMessage({ content: "" }));
    expect(result.success).toBe(false);
  });

  it("rejects content exceeding 100,000 characters", () => {
    const result = MessageSchema.safeParse(
      validMessage({ content: "x".repeat(100001) }),
    );
    expect(result.success).toBe(false);
  });

  it("accepts content at exactly 100,000 characters", () => {
    const result = MessageSchema.safeParse(
      validMessage({ content: "x".repeat(100000) }),
    );
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AttachmentSchema
// ---------------------------------------------------------------------------
describe("AttachmentSchema", () => {
  it("accepts a valid attachment with url", () => {
    const result = AttachmentSchema.safeParse(validAttachment());
    expect(result.success).toBe(true);
  });

  it("accepts attachment with content instead of url", () => {
    const result = AttachmentSchema.safeParse(
      validAttachment({ url: undefined, content: "base64data" }),
    );
    expect(result.success).toBe(true);
  });

  it("accepts attachment with storagePath", () => {
    const result = AttachmentSchema.safeParse(
      validAttachment({ url: undefined, storagePath: "/uploads/file.pdf" }),
    );
    expect(result.success).toBe(true);
  });

  it("accepts attachment with fileId", () => {
    const result = AttachmentSchema.safeParse(
      validAttachment({ url: undefined, fileId: "abc123" }),
    );
    expect(result.success).toBe(true);
  });

  it("rejects attachment with no content, url, storagePath, or fileId", () => {
    const result = AttachmentSchema.safeParse({
      name: "file.pdf",
      mimeType: "application/pdf",
      type: "document",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid mimeType format", () => {
    const result = AttachmentSchema.safeParse(
      validAttachment({ mimeType: "not-a-mime" }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects empty name", () => {
    const result = AttachmentSchema.safeParse(validAttachment({ name: "" }));
    expect(result.success).toBe(false);
  });

  it("rejects name exceeding 255 characters", () => {
    const result = AttachmentSchema.safeParse(
      validAttachment({ name: "a".repeat(256) }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects invalid type value", () => {
    const result = AttachmentSchema.safeParse(
      validAttachment({ type: "video" }),
    );
    expect(result.success).toBe(false);
  });

  it("accepts all valid type values", () => {
    for (const type of ["document", "image", "file"]) {
      const result = AttachmentSchema.safeParse(validAttachment({ type }));
      expect(result.success).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// AnalyzeRequestSchema
// ---------------------------------------------------------------------------
describe("AnalyzeRequestSchema", () => {
  it("accepts a valid analyze request", () => {
    const result = AnalyzeRequestSchema.safeParse({
      messages: [validMessage()],
      attachments: [validAttachment()],
    });
    expect(result.success).toBe(true);
  });

  it("rejects when messages array is empty", () => {
    const result = AnalyzeRequestSchema.safeParse({
      messages: [],
      attachments: [validAttachment()],
    });
    expect(result.success).toBe(false);
  });

  it("rejects when attachments array is empty", () => {
    const result = AnalyzeRequestSchema.safeParse({
      messages: [validMessage()],
      attachments: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects more than 100 messages", () => {
    const messages = Array.from({ length: 101 }, () => validMessage());
    const result = AnalyzeRequestSchema.safeParse({
      messages,
      attachments: [validAttachment()],
    });
    expect(result.success).toBe(false);
  });

  it("rejects more than 20 attachments", () => {
    const attachments = Array.from({ length: 21 }, () => validAttachment());
    const result = AnalyzeRequestSchema.safeParse({
      messages: [validMessage()],
      attachments,
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ChatRequestSchema
// ---------------------------------------------------------------------------
describe("ChatRequestSchema", () => {
  it("accepts a minimal valid chat request", () => {
    const result = ChatRequestSchema.safeParse({
      messages: [validMessage()],
    });
    expect(result.success).toBe(true);
  });

  it("accepts null attachments (preprocessed to undefined)", () => {
    const result = ChatRequestSchema.safeParse({
      messages: [validMessage()],
      attachments: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.attachments).toBeUndefined();
    }
  });

  it("accepts null images (preprocessed to undefined)", () => {
    const result = ChatRequestSchema.safeParse({
      messages: [validMessage()],
      images: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.images).toBeUndefined();
    }
  });

  it("accepts all optional boolean fields", () => {
    const result = ChatRequestSchema.safeParse({
      messages: [validMessage()],
      useRag: true,
      documentMode: true,
      figmaMode: false,
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty messages array", () => {
    const result = ChatRequestSchema.safeParse({ messages: [] });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TypeLimitsSchema / DEFAULT_TYPE_LIMITS
// ---------------------------------------------------------------------------
describe("TypeLimitsSchema / DEFAULT_TYPE_LIMITS", () => {
  it("provides correct default PDF limits", () => {
    expect(DEFAULT_TYPE_LIMITS.pdf.maxPages).toBe(500);
    expect(DEFAULT_TYPE_LIMITS.pdf.maxSizeBytes).toBe(50 * 1024 * 1024);
  });

  it("provides correct default XLSX limits", () => {
    expect(DEFAULT_TYPE_LIMITS.xlsx.maxRows).toBe(100000);
    expect(DEFAULT_TYPE_LIMITS.xlsx.maxCells).toBe(1000000);
    expect(DEFAULT_TYPE_LIMITS.xlsx.maxSheets).toBe(50);
  });

  it("provides correct default CSV limits", () => {
    expect(DEFAULT_TYPE_LIMITS.csv.maxRows).toBe(100000);
    expect(DEFAULT_TYPE_LIMITS.csv.maxColumns).toBe(1000);
  });

  it("provides correct default PPTX limits", () => {
    expect(DEFAULT_TYPE_LIMITS.pptx.maxSlides).toBe(200);
    expect(DEFAULT_TYPE_LIMITS.pptx.maxSizeBytes).toBe(100 * 1024 * 1024);
  });

  it("provides correct default JSON limits", () => {
    expect(DEFAULT_TYPE_LIMITS.json.maxDepth).toBe(50);
    expect(DEFAULT_TYPE_LIMITS.json.maxSizeBytes).toBe(10 * 1024 * 1024);
  });

  it("allows overriding specific values", () => {
    const custom = TypeLimitsSchema.parse({ pdf: { maxPages: 10 } });
    expect(custom.pdf.maxPages).toBe(10);
    // Other defaults should still be there
    expect(custom.xlsx.maxRows).toBe(100000);
  });
});

// ---------------------------------------------------------------------------
// formatZodErrors
// ---------------------------------------------------------------------------
describe("formatZodErrors", () => {
  it("formats a single-field error", () => {
    const result = MessageSchema.safeParse({ role: "bad", content: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const formatted = formatZodErrors(result.error);
      expect(formatted.length).toBeGreaterThan(0);
      expect(formatted[0]).toHaveProperty("path");
      expect(formatted[0]).toHaveProperty("message");
      expect(formatted[0]).toHaveProperty("code");
    }
  });

  it("includes path as dot-separated string", () => {
    const result = AnalyzeRequestSchema.safeParse({
      messages: [{ role: "user", content: "" }],
      attachments: [validAttachment()],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const formatted = formatZodErrors(result.error);
      const contentError = formatted.find((e) => e.path.includes("content"));
      expect(contentError).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// validateAnalyzeRequest
// ---------------------------------------------------------------------------
describe("validateAnalyzeRequest", () => {
  it("returns success:true with data for valid input", () => {
    const result = validateAnalyzeRequest({
      messages: [validMessage()],
      attachments: [validAttachment()],
    });
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data!.messages).toHaveLength(1);
  });

  it("returns success:false with errors for invalid input", () => {
    const result = validateAnalyzeRequest({});
    expect(result.success).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// validateChatRequest
// ---------------------------------------------------------------------------
describe("validateChatRequest", () => {
  it("returns success:true for valid chat request", () => {
    const result = validateChatRequest({
      messages: [validMessage()],
    });
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
  });

  it("returns success:false for missing messages", () => {
    const result = validateChatRequest({ messages: [] });
    expect(result.success).toBe(false);
    expect(result.errors).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// canonicalizeAttachment
// ---------------------------------------------------------------------------
describe("canonicalizeAttachment", () => {
  it("trims whitespace from name and mimeType", () => {
    const att = canonicalizeAttachment({
      name: "  file.pdf  ",
      mimeType: "  Application/PDF  ",
      type: "document",
      url: "https://example.com/file.pdf",
    });
    expect(att.name).toBe("file.pdf");
    expect(att.mimeType).toBe("application/pdf");
  });

  it("lowercases the mimeType", () => {
    const att = canonicalizeAttachment({
      name: "img.png",
      mimeType: "Image/PNG",
      type: "image",
      url: "https://example.com/img.png",
    });
    expect(att.mimeType).toBe("image/png");
  });

  it("trims optional string fields when present", () => {
    const att = canonicalizeAttachment({
      name: "file.txt",
      mimeType: "text/plain",
      type: "file",
      content: "  hello  ",
      url: "  https://example.com  ",
      storagePath: "  /uploads/file.txt  ",
      fileId: "  abc  ",
    });
    expect(att.content).toBe("hello");
    expect(att.url).toBe("https://example.com");
    expect(att.storagePath).toBe("/uploads/file.txt");
    expect(att.fileId).toBe("abc");
  });

  it("preserves type as-is", () => {
    const att = canonicalizeAttachment({
      name: "file.pdf",
      mimeType: "application/pdf",
      type: "document",
      url: "https://example.com/file.pdf",
    });
    expect(att.type).toBe("document");
  });

  it("handles undefined optional fields without error", () => {
    const att = canonicalizeAttachment({
      name: "file.pdf",
      mimeType: "application/pdf",
      type: "document",
      url: "https://example.com/file.pdf",
    });
    expect(att.content).toBeUndefined();
    expect(att.storagePath).toBeUndefined();
    expect(att.fileId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// canonicalizeAnalyzeRequest
// ---------------------------------------------------------------------------
describe("canonicalizeAnalyzeRequest", () => {
  it("trims message content and conversationId", () => {
    const req = canonicalizeAnalyzeRequest({
      messages: [{ role: "user", content: "  Hello  " }],
      attachments: [validAttachment()],
      conversationId: "  conv-123  ",
    });
    expect(req.messages[0].content).toBe("Hello");
    expect(req.conversationId).toBe("conv-123");
  });

  it("canonicalizes all attachments", () => {
    const req = canonicalizeAnalyzeRequest({
      messages: [validMessage()],
      attachments: [
        validAttachment({ name: "  file1.pdf  ", mimeType: "  Application/PDF  " }),
      ],
    });
    expect(req.attachments[0].name).toBe("file1.pdf");
    expect(req.attachments[0].mimeType).toBe("application/pdf");
  });
});

// ---------------------------------------------------------------------------
// canonicalizeChatRequest
// ---------------------------------------------------------------------------
describe("canonicalizeChatRequest", () => {
  it("trims message content", () => {
    const req = canonicalizeChatRequest({
      messages: [{ role: "user", content: "  Hello  " }],
    });
    expect(req.messages[0].content).toBe("Hello");
  });

  it("handles undefined attachments without error", () => {
    const req = canonicalizeChatRequest({
      messages: [validMessage()],
    });
    expect(req.attachments).toBeUndefined();
  });

  it("canonicalizes attachments when present", () => {
    const req = canonicalizeChatRequest({
      messages: [validMessage()],
      attachments: [
        validAttachment({ name: "  doc.docx  " }),
      ],
    });
    expect(req.attachments![0].name).toBe("doc.docx");
  });

  it("trims conversationId when present", () => {
    const req = canonicalizeChatRequest({
      messages: [validMessage()],
      conversationId: "  abc-456  ",
    });
    expect(req.conversationId).toBe("abc-456");
  });

  it("preserves boolean fields untouched", () => {
    const req = canonicalizeChatRequest({
      messages: [validMessage()],
      useRag: true,
      documentMode: false,
      figmaMode: true,
    });
    expect(req.useRag).toBe(true);
    expect(req.documentMode).toBe(false);
    expect(req.figmaMode).toBe(true);
  });
});
