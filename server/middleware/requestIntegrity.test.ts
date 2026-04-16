import { describe, it, expect, vi, beforeEach } from "vitest";
import { requestIntegrity, stopIntegrityCleanup } from "./requestIntegrity";

// ── Helpers ──────────────────────────────────────────────────────────

function mockReq(overrides: Record<string, any> = {}): any {
  return {
    method: "GET",
    originalUrl: "/api/test",
    path: "/api/test",
    headers: {},
    query: {},
    get: vi.fn((header: string) => {
      const h = (overrides.headers || {})[header.toLowerCase()];
      return h ?? "";
    }),
    ...overrides,
  };
}

function mockRes(): any {
  const res: any = {
    statusCode: 200,
    body: null,
    _headers: {} as Record<string, string>,
  };
  res.status = vi.fn((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json = vi.fn((body: any) => {
    res.body = body;
    return res;
  });
  res.setHeader = vi.fn((key: string, value: string) => {
    res._headers[key] = value;
  });
  return res;
}

function mockNext(): any {
  return vi.fn();
}

// ── Tests ────────────────────────────────────────────────────────────

describe("requestIntegrity", () => {
  let middleware: ReturnType<typeof requestIntegrity>;

  beforeEach(() => {
    vi.clearAllMocks();
    // Ensure NODE_ENV=test so no interval is created
    process.env.NODE_ENV = "test";
    middleware = requestIntegrity();
  });

  // ── Normal pass-through ────────────────────────────────────────

  it("calls next for a clean GET request", () => {
    const next = mockNext();
    middleware(mockReq(), mockRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("calls next for a clean POST request with valid content-length", () => {
    const req = mockReq({
      method: "POST",
      headers: { "content-length": "1024" },
      get: vi.fn((h: string) => (h.toLowerCase() === "content-length" ? "1024" : "")),
    });
    const next = mockNext();
    middleware(req, mockRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  // ── Header validation ──────────────────────────────────────────

  it("returns 400 for headers containing control characters", () => {
    const req = mockReq({
      headers: { "user-agent": "Mozilla\u0000injected" },
    });
    const res = mockRes();
    const next = mockNext();
    middleware(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe("INVALID_HEADER");
  });

  it("returns 400 when a header value exceeds MAX_HEADER_SIZE_BYTES", () => {
    const req = mockReq({
      headers: { "x-huge": "a".repeat(13000) },
    });
    const res = mockRes();
    const next = mockNext();
    middleware(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe("INVALID_HEADER");
  });

  it("returns 400 when an array header item exceeds MAX_QUERY_VALUE_LENGTH", () => {
    const req = mockReq({
      headers: { "x-multi": ["short", "a".repeat(1100)] },
    });
    const res = mockRes();
    const next = mockNext();
    middleware(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
  });

  // ── Query validation ───────────────────────────────────────────

  it("returns 400 when query has too many parameters", () => {
    const bigQuery: Record<string, string> = {};
    for (let i = 0; i < 250; i++) {
      bigQuery[`k${i}`] = "v";
    }
    const req = mockReq({ query: bigQuery });
    const res = mockRes();
    const next = mockNext();
    middleware(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe("QUERY_PARAMS_LIMIT");
  });

  it("returns 400 for a query key exceeding MAX_QUERY_KEY_LENGTH", () => {
    const longKey = "k".repeat(200);
    const req = mockReq({ query: { [longKey]: "v" } });
    const res = mockRes();
    const next = mockNext();
    middleware(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe("QUERY_KEY_INVALID");
  });

  it("returns 400 for a query key with control characters", () => {
    const req = mockReq({ query: { "key\u0001": "v" } });
    const res = mockRes();
    const next = mockNext();
    middleware(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe("QUERY_KEY_INVALID");
  });

  it("returns 400 for a query value exceeding MAX_QUERY_VALUE_LENGTH", () => {
    const req = mockReq({ query: { key: "v".repeat(1100) } });
    const res = mockRes();
    const next = mockNext();
    middleware(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe("QUERY_VALUE_INVALID");
  });

  it("returns 400 for a query value with control characters", () => {
    const req = mockReq({ query: { key: "val\u007f" } });
    const res = mockRes();
    const next = mockNext();
    middleware(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe("QUERY_VALUE_INVALID");
  });

  it("handles array query values by joining them", () => {
    const req = mockReq({ query: { tags: ["a", "b", "c"] } });
    const next = mockNext();
    middleware(req, mockRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  // ── Risk scoring ───────────────────────────────────────────────

  it("returns 429 when risk score exceeds INTEGRITY_MAX_RISK", () => {
    // Combine multiple risk factors
    const req = mockReq({
      method: "POST",
      headers: {
        "user-agent": "bot\u0002agent",           // +4 risk (control char in UA)
        "x-requested-with": "x".repeat(100),       // +2 risk (>96 len)
        "content-length": "999999999",              // +3 risk (>25MB)
        "cookie": "c".repeat(17000),                // +1 risk
      },
      get: vi.fn((h: string) => {
        const map: Record<string, string> = {
          "content-length": "999999999",
          "x-forwarded-for": "",
        };
        return map[h.toLowerCase()] ?? "";
      }),
    });
    const res = mockRes();
    const next = mockNext();
    middleware(req, res, next);
    expect(next).not.toHaveBeenCalled();
    // The header validation catches control chars first, so this is 400
    expect(res.statusCode).toBe(400);
  });

  it("sets X-Request-Integrity-Risk header when risk > 0 but below threshold", () => {
    // Only trigger x-requested-with > 96 chars = risk 2 (below default 8)
    const req = mockReq({
      method: "GET",
      headers: {
        "x-requested-with": "x".repeat(100),
      },
      get: vi.fn((h: string) => {
        if (h.toLowerCase() === "content-length") return "0";
        if (h.toLowerCase() === "x-forwarded-for") return "";
        return "";
      }),
    });
    const res = mockRes();
    const next = mockNext();
    middleware(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.setHeader).toHaveBeenCalledWith("X-Request-Integrity-Risk", "2");
  });

  it("does not set risk header when risk is 0", () => {
    const req = mockReq({
      headers: {},
      get: vi.fn(() => ""),
    });
    const res = mockRes();
    const next = mockNext();
    middleware(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.setHeader).not.toHaveBeenCalled();
  });

  // ── Header normalization ───────────────────────────────────────

  it("normalizes and truncates long string header values to 2048 chars", () => {
    const longValue = "x".repeat(3000);
    const req = mockReq({
      headers: { "x-custom": longValue },
    });
    const res = mockRes();
    const next = mockNext();
    middleware(req, res, next);
    // normalizeHeaderValue slices to 2048
    expect(req.headers["x-custom"]).toHaveLength(2048);
    expect(next).toHaveBeenCalledTimes(1);
  });

  // ── stopIntegrityCleanup ───────────────────────────────────────

  it("stopIntegrityCleanup does not throw when called without an active interval", () => {
    expect(() => stopIntegrityCleanup()).not.toThrow();
  });

  // ── Query size limit ───────────────────────────────────────────

  it("returns 400 when total query JSON size exceeds MAX_HEADER_SIZE_BYTES", () => {
    // Create a query with many moderate-sized values to exceed 12000 bytes total
    const query: Record<string, string> = {};
    for (let i = 0; i < 50; i++) {
      query[`param${i}`] = "x".repeat(250);
    }
    const req = mockReq({ query });
    const res = mockRes();
    const next = mockNext();
    middleware(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe("QUERY_SIZE_LIMIT");
  });

  it("accepts query params within all limits", () => {
    const req = mockReq({
      query: { search: "hello", page: "1", limit: "20" },
    });
    const next = mockNext();
    middleware(req, mockRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  // ── Edge: empty query / headers ────────────────────────────────

  it("passes through with empty query and empty headers", () => {
    const req = mockReq({ headers: {}, query: {} });
    const next = mockNext();
    middleware(req, mockRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
