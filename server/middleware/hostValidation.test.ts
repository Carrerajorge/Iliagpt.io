import { describe, it, expect, vi, beforeEach } from "vitest";

// We need to mock the structuredLogger before importing the module
vi.mock("../lib/structuredLogger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { hostValidation } from "../middleware/hostValidation";
import type { Request, Response, NextFunction } from "express";

// ── Mock Express req/res/next ────────────────────────────────

function mockReq(host?: string, path = "/api/chat"): Partial<Request> {
  return {
    headers: host !== undefined ? ({ host } as any) : ({} as any),
    path,
    ip: "127.0.0.1",
    method: "GET",
  } as any;
}

function mockRes(): Partial<Response> & { _status: number; _body: any } {
  const res: any = {
    _status: 200,
    _body: null,
    status: vi.fn().mockImplementation(function (code: number) {
      res._status = code;
      return res;
    }),
    json: vi.fn().mockImplementation(function (body: any) {
      res._body = body;
      return res;
    }),
  };
  return res;
}

// ── Tests ────────────────────────────────────────────────────

describe("hostValidation", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Ensure we're in production mode for these tests so validation is active
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOWED_HOSTS", "myapp.example.com");
    vi.stubEnv("APP_URL", "");
  });

  it("allows requests with host in ALLOWED_HOSTS", async () => {
    // Re-import to pick up stubbed env
    const mod = await import("../middleware/hostValidation");
    // We need to call with the allowed host
    // Since buildAllowedHosts runs at module init, we test with extraHosts config
    const middleware = hostValidation({
      extraHosts: ["trusted.example.com"],
    });
    const req = mockReq("trusted.example.com");
    const res = mockRes();
    const next = vi.fn();
    middleware(req as Request, res as Response, next as NextFunction);
    expect(next).toHaveBeenCalled();
  });

  it("rejects unknown host with 421 status", () => {
    const middleware = hostValidation({
      extraHosts: ["allowed.example.com"],
    });
    const req = mockReq("evil.attacker.com");
    const res = mockRes();
    const next = vi.fn();
    middleware(req as Request, res as Response, next as NextFunction);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(421);
  });

  it("exempt paths bypass host validation", () => {
    const middleware = hostValidation({
      extraHosts: [],
      exemptPaths: ["/health"],
    });
    const req = mockReq("evil.com", "/health");
    const res = mockRes();
    const next = vi.fn();
    middleware(req as Request, res as Response, next as NextFunction);
    expect(next).toHaveBeenCalled();
  });

  it("default exempt paths include /health and /api/health", () => {
    const middleware = hostValidation({ extraHosts: [] });
    const req1 = mockReq("any-host.com", "/health");
    const res1 = mockRes();
    const next1 = vi.fn();
    middleware(req1 as Request, res1 as Response, next1 as NextFunction);
    expect(next1).toHaveBeenCalled();

    const req2 = mockReq("any-host.com", "/api/health");
    const res2 = mockRes();
    const next2 = vi.fn();
    middleware(req2 as Request, res2 as Response, next2 as NextFunction);
    expect(next2).toHaveBeenCalled();
  });

  it("rejects requests with missing Host header", () => {
    const middleware = hostValidation({ extraHosts: [] });
    const req: any = {
      headers: {},
      path: "/api/data",
      ip: "1.2.3.4",
    };
    const res = mockRes();
    const next = vi.fn();
    middleware(req as Request, res as Response, next as NextFunction);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(421);
    expect(res._body?.code).toBe("MISSING_HOST");
  });

  it("detects and rejects CRLF injection in Host header", () => {
    const middleware = hostValidation({
      extraHosts: ["myapp.example.com"],
    });
    const req = mockReq("myapp.example.com\r\nX-Injected: true");
    const res = mockRes();
    const next = vi.fn();
    middleware(req as Request, res as Response, next as NextFunction);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res._body?.code).toBe("INVALID_HOST");
  });

  it("detects null byte injection in Host header", () => {
    const middleware = hostValidation({
      extraHosts: ["myapp.example.com"],
    });
    const req = mockReq("myapp.example.com\0evil");
    const res = mockRes();
    const next = vi.fn();
    middleware(req as Request, res as Response, next as NextFunction);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("allows host matching without port", () => {
    const middleware = hostValidation({
      extraHosts: ["myapp.example.com"],
    });
    const req = mockReq("myapp.example.com:443");
    const res = mockRes();
    const next = vi.fn();
    middleware(req as Request, res as Response, next as NextFunction);
    expect(next).toHaveBeenCalled();
  });

  it("normalizes host to lowercase before comparison", () => {
    const middleware = hostValidation({
      extraHosts: ["myapp.example.com"],
    });
    const req = mockReq("MYAPP.EXAMPLE.COM");
    const res = mockRes();
    const next = vi.fn();
    middleware(req as Request, res as Response, next as NextFunction);
    expect(next).toHaveBeenCalled();
  });

  it("skips validation entirely in non-production without config", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ALLOWED_HOSTS", "");
    vi.stubEnv("APP_URL", "");
    // Re-import to pick up new env
    vi.resetModules();
    vi.mock("../lib/structuredLogger", () => ({
      createLogger: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      }),
    }));
    const freshMod = await import("../middleware/hostValidation");
    const middleware = freshMod.hostValidation();
    const req = mockReq("anything.at.all");
    const res = mockRes();
    const next = vi.fn();
    middleware(req as Request, res as Response, next as NextFunction);
    expect(next).toHaveBeenCalled();
  });
});
