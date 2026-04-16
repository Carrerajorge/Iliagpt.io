import { describe, expect, it } from "vitest";
import type { Request } from "express";
import { validateHeaderBodyIdConsistency } from "../routes/filesRouter";

function mockRequest(headers: Record<string, string | undefined>): Request {
  return {
    headers,
  } as Request;
}

describe("validateHeaderBodyIdConsistency", () => {
  it("accepts matching uploadId in header and body", () => {
    const req = mockRequest({ "x-upload-id": "upload-abc123" });
    const result = validateHeaderBodyIdConsistency(req, "upload-abc123", undefined);
    expect(result.ok).toBe(true);
  });

  it("rejects conflicting uploadId between header and body", () => {
    const req = mockRequest({ "x-upload-id": "upload-abc123" });
    const result = validateHeaderBodyIdConsistency(req, "upload-def456", undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
      expect(result.error).toContain("Conflicting uploadId");
    }
  });

  it("rejects invalid uploadId in header", () => {
    const req = mockRequest({ "x-upload-id": "bad id with spaces" });
    const result = validateHeaderBodyIdConsistency(req, undefined, undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toContain("Invalid uploadId");
    }
  });

  it("rejects conflicting conversationId between header and body", () => {
    const req = mockRequest({ "x-conversation-id": "conv-1234" });
    const result = validateHeaderBodyIdConsistency(req, undefined, "conv-9876");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
      expect(result.error).toContain("Conflicting conversationId");
    }
  });
});
