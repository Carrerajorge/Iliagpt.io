import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Logger before importing
vi.mock("../lib/logger", () => ({
  Logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { responseBudget } from "../middleware/responseBudget";
import type { Request, Response, NextFunction } from "express";

// ── Helpers ──────────────────────────────────────────────────

function mockReq(path = "/api/chat"): Partial<Request> {
  return {
    path,
    originalUrl: path,
    method: "GET",
    ip: "127.0.0.1",
    headers: {} as any,
  } as any;
}

function mockRes(): Partial<Response> & {
  _headers: Record<string, string>;
  _finishHandlers: Array<() => void>;
} {
  const res: any = {
    _headers: {} as Record<string, string>,
    _finishHandlers: [] as Array<() => void>,
    statusCode: 200,
    headersSent: false,
    setHeader: vi.fn((name: string, value: string) => {
      res._headers[name] = value;
    }),
    once: vi.fn((event: string, handler: () => void) => {
      if (event === "finish") {
        res._finishHandlers.push(handler);
      }
    }),
  };
  return res;
}

function triggerFinish(res: ReturnType<typeof mockRes>) {
  for (const handler of res._finishHandlers) {
    handler();
  }
}

// ── Tests ────────────────────────────────────────────────────

describe("responseBudget", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a middleware function", () => {
    const middleware = responseBudget();
    expect(typeof middleware).toBe("function");
  });

  it("calls next() for normal requests", () => {
    const middleware = responseBudget();
    const req = mockReq("/api/chat");
    const res = mockRes();
    const next = vi.fn();

    middleware(req as Request, res as Response, next as NextFunction);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("skips health paths and calls next directly", () => {
    const middleware = responseBudget();
    const req = mockReq("/health");
    const res = mockRes();
    const next = vi.fn();

    middleware(req as Request, res as Response, next as NextFunction);
    expect(next).toHaveBeenCalledTimes(1);
    // Health paths should not register a finish listener
    expect(res.once).not.toHaveBeenCalled();
  });

  it("skips /api/health path", () => {
    const middleware = responseBudget();
    const req = mockReq("/api/health");
    const res = mockRes();
    const next = vi.fn();

    middleware(req as Request, res as Response, next as NextFunction);
    expect(next).toHaveBeenCalled();
    expect(res.once).not.toHaveBeenCalled();
  });

  it("skips /ready path", () => {
    const middleware = responseBudget();
    const req = mockReq("/ready");
    const res = mockRes();
    const next = vi.fn();

    middleware(req as Request, res as Response, next as NextFunction);
    expect(next).toHaveBeenCalled();
    expect(res.once).not.toHaveBeenCalled();
  });

  it("registers a finish event listener for non-health paths", () => {
    const middleware = responseBudget();
    const req = mockReq("/api/data");
    const res = mockRes();
    const next = vi.fn();

    middleware(req as Request, res as Response, next as NextFunction);
    expect(res.once).toHaveBeenCalledWith("finish", expect.any(Function));
  });

  it("sets Server-Timing and X-Response-Time-Ms headers on finish", () => {
    const middleware = responseBudget();
    const req = mockReq("/api/data");
    const res = mockRes();
    const next = vi.fn();

    middleware(req as Request, res as Response, next as NextFunction);
    triggerFinish(res);

    // The middleware uses process.hrtime.bigint() so headers should be set
    expect(res.setHeader).toHaveBeenCalledWith(
      "Server-Timing",
      expect.stringContaining("app;dur="),
    );
    expect(res.setHeader).toHaveBeenCalledWith(
      "X-Response-Time-Ms",
      expect.any(String),
    );
  });

  it("does not set headers if headersSent is true", () => {
    const middleware = responseBudget();
    const req = mockReq("/api/data");
    const res = mockRes();
    res.headersSent = true;
    const next = vi.fn();

    middleware(req as Request, res as Response, next as NextFunction);
    triggerFinish(res);

    // setHeader should not have been called because headersSent is true
    // The safeSetHeader function checks this condition
    expect(res.setHeader).not.toHaveBeenCalled();
  });
});
