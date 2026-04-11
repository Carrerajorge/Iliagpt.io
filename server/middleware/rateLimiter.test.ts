import { afterEach, describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { rateLimiter } from "./rateLimiter";

function makeMockResponse() {
  return {
    headers: {} as Record<string, unknown>,
    statusCode: 200,
    setHeader(key: string, value: unknown) {
      this.headers[key] = value;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(_payload: unknown) {
      return this;
    },
  } as unknown as Response & { headers: Record<string, unknown>; statusCode: number };
}

describe("rateLimiter", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it("skips rate limiting for localhost traffic outside production", () => {
    process.env.NODE_ENV = "development";
    const middleware = rateLimiter("api");
    const next = vi.fn<NextFunction>();

    for (let index = 0; index < 150; index += 1) {
      const req = {
        ip: "::ffff:127.0.0.1",
        headers: { host: "127.0.0.1:41733" },
        socket: { remoteAddress: "::ffff:127.0.0.1" },
      } as unknown as Request;
      const res = makeMockResponse();
      middleware(req, res, next);
      expect(res.statusCode).toBe(200);
    }

    expect(next).toHaveBeenCalledTimes(150);
  });
});
