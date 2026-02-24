import { describe, it, expect } from "vitest";
import {
  ALLOWED_MIME_TYPES,
  HTTP_HEADERS,
  TIMEOUTS,
  LIMITS,
  MEMORY_INTENT_KEYWORDS,
  FILE_UPLOAD_CONFIG,
  ALLOWED_EXTENSIONS,
} from "./constants";

describe("ALLOWED_MIME_TYPES", () => {
  it("includes common document types", () => {
    expect(ALLOWED_MIME_TYPES).toContain("application/pdf");
    expect(ALLOWED_MIME_TYPES).toContain("text/plain");
    expect(ALLOWED_MIME_TYPES).toContain("text/csv");
    expect(ALLOWED_MIME_TYPES).toContain("application/json");
  });
  it("includes Office formats", () => {
    expect(ALLOWED_MIME_TYPES).toContain("application/msword");
    expect(ALLOWED_MIME_TYPES).toContain("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(ALLOWED_MIME_TYPES).toContain("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(ALLOWED_MIME_TYPES).toContain("application/vnd.openxmlformats-officedocument.presentationml.presentation");
  });
  it("includes image types", () => {
    expect(ALLOWED_MIME_TYPES).toContain("image/png");
    expect(ALLOWED_MIME_TYPES).toContain("image/jpeg");
    expect(ALLOWED_MIME_TYPES).toContain("image/webp");
  });
  it("does not include dangerous types", () => {
    expect(ALLOWED_MIME_TYPES).not.toContain("application/x-executable");
    expect(ALLOWED_MIME_TYPES).not.toContain("application/javascript");
  });
});

describe("HTTP_HEADERS", () => {
  it("has required headers", () => {
    expect(HTTP_HEADERS.USER_AGENT).toBeTruthy();
    expect(HTTP_HEADERS.ACCEPT_HTML).toBeTruthy();
    expect(HTTP_HEADERS.ACCEPT_LANGUAGE).toContain("es");
  });
});

describe("TIMEOUTS", () => {
  it("has reasonable values", () => {
    expect(TIMEOUTS.PAGE_FETCH).toBeGreaterThan(0);
    expect(TIMEOUTS.PAGE_FETCH).toBeLessThanOrEqual(10000);
    expect(TIMEOUTS.SEARCH_LLM_TIMEOUT).toBeGreaterThan(0);
    expect(TIMEOUTS.MAX_CONTENT_LENGTH).toBeGreaterThan(0);
  });
});

describe("LIMITS", () => {
  it("has valid search limits", () => {
    expect(LIMITS.MAX_SEARCH_RESULTS).toBeGreaterThan(0);
    expect(LIMITS.MAX_CONTENT_FETCH).toBeGreaterThan(0);
  });
  it("has valid file size limits", () => {
    expect(LIMITS.MAX_FILE_SIZE_MB).toBe(100);
    expect(LIMITS.MAX_FILE_SIZE_BYTES).toBe(100 * 1024 * 1024);
  });
  it("has valid RAG limits", () => {
    expect(LIMITS.RAG_SIMILAR_CHUNKS).toBeGreaterThan(0);
    expect(LIMITS.RAG_SIMILARITY_THRESHOLD).toBeGreaterThanOrEqual(0);
    expect(LIMITS.RAG_SIMILARITY_THRESHOLD).toBeLessThanOrEqual(1);
  });
});

describe("MEMORY_INTENT_KEYWORDS", () => {
  it("contains Spanish keywords", () => {
    expect(MEMORY_INTENT_KEYWORDS.length).toBeGreaterThan(0);
    expect(MEMORY_INTENT_KEYWORDS.some(k => k.includes("archivo"))).toBe(true);
    expect(MEMORY_INTENT_KEYWORDS.some(k => k.includes("documento"))).toBe(true);
  });
});

describe("FILE_UPLOAD_CONFIG", () => {
  it("has valid chunk sizes", () => {
    expect(FILE_UPLOAD_CONFIG.CHUNK_SIZE_MB).toBe(5);
    expect(FILE_UPLOAD_CONFIG.CHUNK_SIZE_BYTES).toBe(5 * 1024 * 1024);
    expect(FILE_UPLOAD_CONFIG.MAX_PARALLEL_CHUNKS).toBeGreaterThan(0);
    expect(FILE_UPLOAD_CONFIG.UPLOAD_TIMEOUT_MS).toBeGreaterThan(0);
  });
});

describe("ALLOWED_EXTENSIONS", () => {
  it("maps MIME types to extensions", () => {
    expect(ALLOWED_EXTENSIONS["application/pdf"]).toBe(".pdf");
    expect(ALLOWED_EXTENSIONS["text/plain"]).toBe(".txt");
    expect(ALLOWED_EXTENSIONS["image/png"]).toBe(".png");
    expect(ALLOWED_EXTENSIONS["image/jpeg"]).toBe(".jpg");
  });
  it("has matching entries for ALLOWED_MIME_TYPES", () => {
    for (const mime of ALLOWED_MIME_TYPES) {
      expect(ALLOWED_EXTENSIONS[mime]).toBeDefined();
    }
  });
});
