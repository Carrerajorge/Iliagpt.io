import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";

function mockReq(path = "/api/auth/mfa/status", host = "127.0.0.1:41734"): Partial<Request> {
  return {
    path,
    originalUrl: path,
    method: "GET",
    headers: { host } as any,
    ip: "127.0.0.1",
    socket: { remoteAddress: "127.0.0.1" } as any,
  } as any;
}

function mockRes(): Partial<Response> & { _status: number; _body: any } {
  const res: any = {
    _status: 200,
    _body: null,
    headers: {} as Record<string, string>,
    setHeader: vi.fn((key: string, value: string) => {
      res.headers[key] = value;
    }),
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

describe("abuseDetection", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ABUSE_DETECTION_MAX_SCORE", "3");
    vi.stubEnv("ABUSE_DETECTION_MAX_REQUESTS", "2");
    vi.stubEnv("ABUSE_DETECTION_WINDOW_MS", "60000");
    vi.stubEnv("BASE_URL", "");
  });

  it("bypasses loopback traffic in production-like local runtimes", async () => {
    vi.stubEnv("BASE_URL", "http://127.0.0.1:41734");
    const { abuseDetection } = await import("./abuseDetection");
    const middleware = abuseDetection();
    const req = mockReq();

    for (let i = 0; i < 5; i += 1) {
      const res = mockRes();
      const next = vi.fn();
      middleware(req as Request, res as Response, next as NextFunction);
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalledWith(429);
    }
  });

  it("still blocks suspicious production traffic on non-loopback deployments", async () => {
    vi.stubEnv("BASE_URL", "https://app.iliagpt.com");
    const { abuseDetection } = await import("./abuseDetection");
    const middleware = abuseDetection();
    const req = mockReq("/api/auth/mfa/status", "app.iliagpt.com");

    const firstRes = mockRes();
    const firstNext = vi.fn();
    middleware(req as Request, firstRes as Response, firstNext as NextFunction);
    expect(firstNext).toHaveBeenCalled();

    const secondRes = mockRes();
    const secondNext = vi.fn();
    middleware(req as Request, secondRes as Response, secondNext as NextFunction);
    expect(secondNext).not.toHaveBeenCalled();
    expect(secondRes.status).toHaveBeenCalledWith(429);
    expect(secondRes._body?.code).toBe("ABUSE_DETECTED");
  });
});
