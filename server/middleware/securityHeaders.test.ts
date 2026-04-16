import { describe, it, expect, vi } from "vitest";
import { securityHeaders, apiSecurityHeaders, staticSecurityHeaders, generateCspNonce } from "./securityHeaders";
import type { Request, Response, NextFunction } from "express";

function mockReq(): Partial<Request> {
  return {} as any;
}

function mockRes(): Partial<Response> & { _headers: Record<string, string>; _removed: string[] } {
  const _headers: Record<string, string> = {};
  const _removed: string[] = [];
  return {
    _headers,
    _removed,
    setHeader: vi.fn((name: string, value: any) => { _headers[name] = String(value); }),
    removeHeader: vi.fn((name: string) => { _removed.push(name); delete _headers[name]; }),
    getHeader: vi.fn((name: string) => _headers[name]),
  } as any;
}

describe("generateCspNonce", () => {
  it("generates a base64 string", () => {
    const nonce = generateCspNonce();
    expect(typeof nonce).toBe("string");
    expect(nonce.length).toBeGreaterThan(10);
  });
  it("generates unique nonces", () => {
    const a = generateCspNonce();
    const b = generateCspNonce();
    expect(a).not.toBe(b);
  });
});

describe("securityHeaders middleware (defaults)", () => {
  it("sets HSTS header", () => {
    const middleware = securityHeaders();
    const res = mockRes();
    const next = vi.fn();

    middleware(mockReq() as Request, res as unknown as Response, next);

    expect(res._headers["Strict-Transport-Security"]).toContain("max-age=31536000");
    expect(res._headers["Strict-Transport-Security"]).toContain("includeSubDomains");
    expect(next).toHaveBeenCalled();
  });

  it("sets CSP header", () => {
    const middleware = securityHeaders();
    const res = mockRes();
    middleware(mockReq() as Request, res as unknown as Response, vi.fn());

    expect(res._headers["Content-Security-Policy"]).toBeDefined();
    expect(res._headers["Content-Security-Policy"]).toContain("default-src");
  });

  it("sets X-Frame-Options", () => {
    const middleware = securityHeaders();
    const res = mockRes();
    middleware(mockReq() as Request, res as unknown as Response, vi.fn());

    expect(res._headers["X-Frame-Options"]).toBe("SAMEORIGIN");
  });

  it("sets X-Content-Type-Options", () => {
    const middleware = securityHeaders();
    const res = mockRes();
    middleware(mockReq() as Request, res as unknown as Response, vi.fn());

    expect(res._headers["X-Content-Type-Options"]).toBe("nosniff");
  });

  it("sets X-XSS-Protection", () => {
    const middleware = securityHeaders();
    const res = mockRes();
    middleware(mockReq() as Request, res as unknown as Response, vi.fn());

    expect(res._headers["X-XSS-Protection"]).toBe("1; mode=block");
  });

  it("sets Referrer-Policy", () => {
    const middleware = securityHeaders();
    const res = mockRes();
    middleware(mockReq() as Request, res as unknown as Response, vi.fn());

    expect(res._headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
  });

  it("sets Permissions-Policy", () => {
    const middleware = securityHeaders();
    const res = mockRes();
    middleware(mockReq() as Request, res as unknown as Response, vi.fn());

    expect(res._headers["Permissions-Policy"]).toBeDefined();
    expect(res._headers["Permissions-Policy"]).toContain("camera=()");
  });

  it("sets Cross-Origin headers", () => {
    const middleware = securityHeaders();
    const res = mockRes();
    middleware(mockReq() as Request, res as unknown as Response, vi.fn());

    expect(res._headers["Cross-Origin-Opener-Policy"]).toBe("same-origin");
    expect(res._headers["Cross-Origin-Resource-Policy"]).toBe("same-origin");
  });

  it("removes X-Powered-By", () => {
    const middleware = securityHeaders();
    const res = mockRes();
    middleware(mockReq() as Request, res as unknown as Response, vi.fn());

    expect(res._removed).toContain("X-Powered-By");
  });
});

describe("securityHeaders with custom config", () => {
  it("supports HSTS preload", () => {
    const middleware = securityHeaders({ hstsPreload: true });
    const res = mockRes();
    middleware(mockReq() as Request, res as unknown as Response, vi.fn());

    expect(res._headers["Strict-Transport-Security"]).toContain("preload");
  });

  it("supports disabling CSP", () => {
    const middleware = securityHeaders({ enableCSP: false });
    const res = mockRes();
    middleware(mockReq() as Request, res as unknown as Response, vi.fn());

    expect(res._headers["Content-Security-Policy"]).toBeUndefined();
  });

  it("supports custom headers", () => {
    const middleware = securityHeaders({ customHeaders: { "X-Custom": "value" } });
    const res = mockRes();
    middleware(mockReq() as Request, res as unknown as Response, vi.fn());

    expect(res._headers["X-Custom"]).toBe("value");
  });
});

describe("apiSecurityHeaders", () => {
  it("disables CSP and sets cache headers", () => {
    const middleware = apiSecurityHeaders();
    const res = mockRes();
    middleware(mockReq() as Request, res as unknown as Response, vi.fn());

    expect(res._headers["Content-Security-Policy"]).toBeUndefined();
    expect(res._headers["Cache-Control"]).toContain("no-store");
  });
});

describe("staticSecurityHeaders", () => {
  it("enables HSTS preload and sets cache headers", () => {
    const middleware = staticSecurityHeaders();
    const res = mockRes();
    middleware(mockReq() as Request, res as unknown as Response, vi.fn());

    expect(res._headers["Strict-Transport-Security"]).toContain("preload");
    expect(res._headers["Cache-Control"]).toContain("immutable");
  });
});
