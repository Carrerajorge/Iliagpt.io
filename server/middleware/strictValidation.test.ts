import { describe, it, expect, vi } from "vitest";
import { z } from "zod";

// Mock the log function to avoid importing the entire server
vi.mock("../index", () => ({
  log: vi.fn(),
}));

import { validate, commonSchemas } from "./strictValidation";
import type { Request, Response, NextFunction } from "express";

function mockReq(body: any = {}, query: any = {}, params: any = {}): Partial<Request> {
  return { body, query, params } as any;
}

function mockRes(): Partial<Response> & { _status?: number; _json?: any } {
  const res: any = {
    status: vi.fn(function (code: number) {
      res._status = code;
      return res;
    }),
    json: vi.fn(function (data: any) {
      res._json = data;
      return res;
    }),
  };
  return res;
}

describe("validate middleware", () => {
  const schema = z.object({
    name: z.string().min(1),
    age: z.number().min(0),
  });

  it("passes valid body data and calls next", () => {
    const middleware = validate(schema);
    const req = mockReq({ name: "John", age: 30 });
    const res = mockRes();
    const next = vi.fn();

    middleware(req as Request, res as Response, next);

    expect(next).toHaveBeenCalled();
    expect(req.body).toEqual({ name: "John", age: 30 });
  });

  it("returns 400 for invalid body data", () => {
    const middleware = validate(schema);
    const req = mockReq({ name: "", age: -1 });
    const res = mockRes();
    const next = vi.fn();

    middleware(req as Request, res as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(400);
    expect(res._json.code).toBe("VALIDATION_ERROR");
    expect(res._json.details).toBeDefined();
    expect(res._json.details.length).toBeGreaterThan(0);
  });

  it("validates query parameters", () => {
    const querySchema = z.object({ search: z.string().min(1) });
    const middleware = validate(querySchema, "query");
    const req = mockReq({}, { search: "hello" });
    const res = mockRes();
    const next = vi.fn();

    middleware(req as Request, res as Response, next);

    expect(next).toHaveBeenCalled();
    expect(req.query).toEqual({ search: "hello" });
  });

  it("validates URL params", () => {
    const paramSchema = z.object({ id: z.string().uuid() });
    const middleware = validate(paramSchema, "params");
    const req = mockReq({}, {}, { id: "123e4567-e89b-12d3-a456-426614174000" });
    const res = mockRes();
    const next = vi.fn();

    middleware(req as Request, res as Response, next);

    expect(next).toHaveBeenCalled();
  });

  it("replaces raw data with validated/transformed data", () => {
    const transformSchema = z.object({
      count: z.coerce.number(),
    });
    const middleware = validate(transformSchema);
    const req = mockReq({ count: "42" });
    const res = mockRes();
    const next = vi.fn();

    middleware(req as Request, res as Response, next);

    expect(next).toHaveBeenCalled();
    expect(req.body.count).toBe(42);
  });

  it("passes non-Zod errors to next()", () => {
    // Create a schema that throws a non-ZodError
    const evilSchema = {
      parse: () => { throw new Error("not a zod error"); },
    };
    const middleware = validate(evilSchema as any);
    const req = mockReq({});
    const res = mockRes();
    const next = vi.fn();

    middleware(req as Request, res as Response, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});

describe("commonSchemas", () => {
  it("id schema accepts UUID", () => {
    expect(commonSchemas.id.parse({ id: "123e4567-e89b-12d3-a456-426614174000" }))
      .toEqual({ id: "123e4567-e89b-12d3-a456-426614174000" });
  });
  it("id schema accepts non-UUID string", () => {
    expect(commonSchemas.id.parse({ id: "some-id" })).toEqual({ id: "some-id" });
  });
  it("id schema rejects empty string", () => {
    expect(() => commonSchemas.id.parse({ id: "" })).toThrow();
  });
  it("pagination schema has defaults", () => {
    const result = commonSchemas.pagination.parse({});
    expect(result.page).toBe(1);
    expect(result.limit).toBe(20);
  });
  it("pagination schema coerces strings", () => {
    const result = commonSchemas.pagination.parse({ page: "3", limit: "50" });
    expect(result.page).toBe(3);
    expect(result.limit).toBe(50);
  });
  it("pagination schema rejects invalid values", () => {
    expect(() => commonSchemas.pagination.parse({ page: 0 })).toThrow();
    expect(() => commonSchemas.pagination.parse({ limit: 101 })).toThrow();
  });
});
