import { describe, it, expect, vi } from "vitest";
import { correlationIdMiddleware } from "./correlationId";
import type { Request, Response, NextFunction } from "express";

function mockReq(headers: Record<string, string> = {}): Partial<Request> {
  return {
    headers: headers as any,
  } as any;
}

function mockRes(): Partial<Response> {
  const _headers: Record<string, string> = {};
  return {
    setHeader: vi.fn((name: string, value: string) => {
      _headers[name] = value;
    }),
    getHeader: vi.fn((name: string) => _headers[name]),
    _headers,
  } as any;
}

describe("correlationIdMiddleware", () => {
  it("generates a UUID if no headers provided", () => {
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();

    correlationIdMiddleware(req as Request, res as Response, next);

    expect((req as any).correlationId).toBeDefined();
    expect((req as any).correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
    expect(res.setHeader).toHaveBeenCalledWith("x-correlation-id", (req as any).correlationId);
    expect(next).toHaveBeenCalled();
  });

  it("uses x-correlation-id header when valid", () => {
    const req = mockReq({ "x-correlation-id": "my-corr-id-12345" });
    const res = mockRes();
    const next = vi.fn();

    correlationIdMiddleware(req as Request, res as Response, next);

    expect((req as any).correlationId).toBe("my-corr-id-12345");
  });

  it("uses x-request-id header as fallback", () => {
    const req = mockReq({ "x-request-id": "req-id-abc123" });
    const res = mockRes();
    const next = vi.fn();

    correlationIdMiddleware(req as Request, res as Response, next);

    expect((req as any).correlationId).toBe("req-id-abc123");
  });

  it("prefers x-correlation-id over x-request-id", () => {
    const req = mockReq({
      "x-correlation-id": "corr-123",
      "x-request-id": "req-456",
    });
    const res = mockRes();
    const next = vi.fn();

    correlationIdMiddleware(req as Request, res as Response, next);

    expect((req as any).correlationId).toBe("corr-123");
  });

  it("rejects invalid correlation IDs (too short)", () => {
    const req = mockReq({ "x-correlation-id": "short" });
    const res = mockRes();
    const next = vi.fn();

    correlationIdMiddleware(req as Request, res as Response, next);

    // Should generate a UUID since "short" is < 8 chars
    expect((req as any).correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  it("rejects correlation IDs with dangerous chars", () => {
    const req = mockReq({ "x-correlation-id": "id-with spaces!" });
    const res = mockRes();
    const next = vi.fn();

    correlationIdMiddleware(req as Request, res as Response, next);

    // Should generate a UUID
    expect((req as any).correlationId).not.toBe("id-with spaces!");
  });

  it("sets requestId for backwards compatibility", () => {
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();

    correlationIdMiddleware(req as Request, res as Response, next);

    expect((req as any).requestId).toBe((req as any).correlationId);
  });

  it("parses W3C traceparent header", () => {
    const req = mockReq({
      traceparent: "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
    });
    const res = mockRes();
    const next = vi.fn();

    correlationIdMiddleware(req as Request, res as Response, next);

    expect((req as any).traceId).toBe("0af7651916cd43dd8448eb211c80319c");
    expect((req as any).spanId).toBe("b7ad6b7169203331");
  });

  it("echoes correlation ID in response header", () => {
    const req = mockReq({ "x-correlation-id": "echo-test-123" });
    const res = mockRes();
    const next = vi.fn();

    correlationIdMiddleware(req as Request, res as Response, next);

    expect(res.setHeader).toHaveBeenCalledWith("x-correlation-id", "echo-test-123");
  });
});
