import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Request, Response, NextFunction } from "express";

// We need to control NODE_ENV for these tests, so we import after setting env
let canonicalUrlMiddleware: typeof import("./canonicalUrl").canonicalUrlMiddleware;

function mockReq(host: string, url = "/some-path", protocol = "https"): Partial<Request> {
  return {
    get: vi.fn((h: string) => {
      if (h === "host") return host;
      if (h === "x-forwarded-proto") return protocol;
      return undefined;
    }),
    protocol,
    originalUrl: url,
  } as any;
}

function mockRes(): Partial<Response> & { _redirectCode?: number; _redirectUrl?: string } {
  const res: any = {
    redirect: vi.fn(function (code: number, url: string) {
      res._redirectCode = code;
      res._redirectUrl = url;
    }),
  };
  return res;
}

describe("canonicalUrlMiddleware", () => {
  const originalEnv = process.env.NODE_ENV;

  beforeEach(async () => {
    // Force production mode and fresh import
    process.env.NODE_ENV = "production";
    // Dynamic import to get fresh module
    const mod = await import("./canonicalUrl");
    canonicalUrlMiddleware = mod.canonicalUrlMiddleware;
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it("redirects www.iliagpt.com to iliagpt.com in production", () => {
    const req = mockReq("www.iliagpt.com", "/dashboard");
    const res = mockRes();
    const next = vi.fn();

    canonicalUrlMiddleware(req as Request, res as Response, next);

    expect(res.redirect).toHaveBeenCalledWith(301, "https://iliagpt.com/dashboard");
    expect(next).not.toHaveBeenCalled();
  });

  it("does not redirect iliagpt.com (canonical)", () => {
    const req = mockReq("iliagpt.com", "/dashboard");
    const res = mockRes();
    const next = vi.fn();

    canonicalUrlMiddleware(req as Request, res as Response, next);

    expect(res.redirect).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it("does not redirect localhost", () => {
    const req = mockReq("localhost:3000", "/");
    const res = mockRes();
    const next = vi.fn();

    canonicalUrlMiddleware(req as Request, res as Response, next);

    expect(res.redirect).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it("preserves the full URL path and query", () => {
    const req = mockReq("www.iliagpt.com", "/api/health?format=json");
    const res = mockRes();
    const next = vi.fn();

    canonicalUrlMiddleware(req as Request, res as Response, next);

    expect(res.redirect).toHaveBeenCalledWith(301, "https://iliagpt.com/api/health?format=json");
  });

  it("skips redirect in non-production environment", async () => {
    process.env.NODE_ENV = "development";
    // Re-import to pick up new env
    vi.resetModules();
    const mod = await import("./canonicalUrl");

    const req = mockReq("www.iliagpt.com", "/");
    const res = mockRes();
    const next = vi.fn();

    mod.canonicalUrlMiddleware(req as Request, res as Response, next);

    expect(next).toHaveBeenCalled();
    expect(res.redirect).not.toHaveBeenCalled();
  });
});
