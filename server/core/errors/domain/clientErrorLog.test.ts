import { describe, expect, it } from "vitest";

import { createClientErrorLog } from "./clientErrorLog";

describe("createClientErrorLog", () => {
  it("rejects non-object payload", () => {
    const result = createClientErrorLog(null as any);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_payload");
  });

  it("rejects missing required fields", () => {
    const result = createClientErrorLog({} as any);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("invalid_message");
    }
  });

  it("canonicalizes url and strips query/hash", () => {
    const result = createClientErrorLog({
      errorId: "E_TEST",
      message: "Boom",
      url: "https://example.com/path?q=secret#frag",
      userAgent: "UA",
      now: new Date("2026-02-18T00:00:00.000Z"),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.url).toBe("https://example.com/path");
      expect(result.value.timestampIso).toBe("2026-02-18T00:00:00.000Z");
      expect(result.value.errorId).toBe("E_TEST");
    }
  });

  it("rejects invalid urls and protocols", () => {
    const invalid = createClientErrorLog({
      errorId: "E_TEST",
      message: "Boom",
      url: "not a url",
      userAgent: "UA",
    });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.error.code).toBe("invalid_url");

    const badProto = createClientErrorLog({
      errorId: "E_TEST",
      message: "Boom",
      url: "ftp://example.com/path",
      userAgent: "UA",
    });
    expect(badProto.ok).toBe(false);
    if (!badProto.ok) expect(badProto.error.code).toBe("invalid_url");

    const missing = createClientErrorLog({
      errorId: "E_TEST",
      message: "Boom",
      url: "",
      userAgent: "UA",
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.code).toBe("invalid_url");
  });

  it("sanitizes errorId and preserves newlines in stack fields", () => {
    const result = createClientErrorLog({
      errorId: " abc 123 ",
      message: "Boom",
      url: "https://example.com/path",
      userAgent: "UA",
      stack: "line1\nline2",
      componentStack: "c1\r\nc2",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.errorId).toBe("abc123");
      expect(result.value.stack).toContain("\n");
      expect(result.value.componentStack).toContain("\n");
    }
  });

  it("rejects missing userAgent", () => {
    const result = createClientErrorLog({
      errorId: "E_TEST",
      message: "Boom",
      url: "https://example.com/path",
      userAgent: "",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_user_agent");
  });

  it("falls back to a generated errorId when sanitized is empty", () => {
    const result = createClientErrorLog({
      errorId: "!!!!",
      message: "Boom",
      url: "https://example.com/path",
      userAgent: "UA",
      now: new Date("2026-02-18T00:00:00.000Z"),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.errorId.startsWith("err_")).toBe(true);
    }
  });
});
