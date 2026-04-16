import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import {
  GptActionRuntime,
  isAllowedResponseMimeTypeForTesting,
  normalizeContentTypeForTesting,
  isValidActorIdForTesting,
  resolveActorIdForTesting,
  normalizeGptActionRequestPayload,
  parseRetryAfterHeader,
  sanitizeLogValueForTesting,
  mapResponseForTesting,
} from "./gptActionRuntime";

describe("gptActionRuntime shared helpers", () => {
  describe("normalizeGptActionRequestPayload", () => {
    it("uses request when provided", () => {
      const payload = normalizeGptActionRequestPayload({
        request: { primary: "from-request" },
        input: { fallback: "ignored" },
      } as Record<string, unknown>);

      expect(payload).toEqual({ primary: "from-request" });
      expect(payload).not.toHaveProperty("fallback");
    });

    it("falls back to input when request is missing", () => {
      const payload = normalizeGptActionRequestPayload({
        request: undefined,
        input: { fallback: "used" },
      } as Record<string, unknown>);

      expect(payload).toEqual({ fallback: "used" });
    });

    it("falls back to input when request is null", () => {
      const payload = normalizeGptActionRequestPayload({
        request: null,
        input: { fallback: "used-from-null" },
      } as Record<string, unknown>);

      expect(payload).toEqual({ fallback: "used-from-null" });
    });

    it("returns empty object for non-object request/input", () => {
      const payload = normalizeGptActionRequestPayload({
        request: "invalid",
        input: 123,
      } as Record<string, unknown>);

      expect(payload).toEqual({});
    });

    it("truncates oversized payloads", () => {
      const payload = normalizeGptActionRequestPayload({
        request: {
          text: "x".repeat(60_000),
        },
      } as Record<string, unknown>);

      expect(payload).toBeTypeOf("string");
      expect(payload.length).toBeLessThanOrEqual(50_000);
    });

    it("returns empty payload when request contains forbidden structure keys", () => {
      const request = Object.create(null) as Record<string, unknown>;
      request.good = "value";
      Object.defineProperty(request, "__proto__", {
        value: { escalated: true },
        enumerable: true,
      });

      const payload = normalizeGptActionRequestPayload({
        request,
      } as Record<string, unknown>);

      expect(payload).toEqual({});
    });
  });

  describe("parseRetryAfterHeader", () => {
    it("parses numeric Retry-After values", () => {
      expect(parseRetryAfterHeader("120")).toBe(120);
      expect(parseRetryAfterHeader("  15  ")).toBe(15);
      expect(parseRetryAfterHeader("-7")).toBeUndefined();
      expect(parseRetryAfterHeader("0")).toBeUndefined();
    });

    it("parses HTTP-date Retry-After values", () => {
      const future = new Date(Date.now() + 30_000).toUTCString();
      const parsed = parseRetryAfterHeader(future);

      expect(parsed).toBeGreaterThanOrEqual(1);
      expect(parsed).toBeLessThanOrEqual(40);
    });

    it("returns undefined for malformed values", () => {
      expect(parseRetryAfterHeader("invalid")).toBeUndefined();
      expect(parseRetryAfterHeader("")).toBeUndefined();
      expect(parseRetryAfterHeader(undefined)).toBeUndefined();
    });

    it("ignores malformed negative and zero header values", () => {
      expect(parseRetryAfterHeader("-1")).toBeUndefined();
      expect(parseRetryAfterHeader("0")).toBeUndefined();
    });

    it("returns undefined for past HTTP-date values", () => {
      const past = new Date(Date.now() - 30_000).toUTCString();
      expect(parseRetryAfterHeader(past)).toBeUndefined();
    });
  });

  describe("content-type helpers", () => {
    it("normalizes content-type headers", () => {
      expect(normalizeContentTypeForTesting("application/json; charset=utf-8")).toBe("application/json");
      expect(normalizeContentTypeForTesting("  Text/Plain; charset=UTF-8  ")).toBe("text/plain");
      expect(normalizeContentTypeForTesting(null)).toBeNull();
      expect(normalizeContentTypeForTesting("")).toBeNull();
    });

    it("allows only safe response content types", () => {
      expect(isAllowedResponseMimeTypeForTesting("application/json; charset=utf-8")).toBe(true);
      expect(isAllowedResponseMimeTypeForTesting("text/plain")).toBe(true);
      expect(isAllowedResponseMimeTypeForTesting("text/csv; charset=utf-8")).toBe(true);
      expect(isAllowedResponseMimeTypeForTesting("application/problem+json")).toBe(true);
      expect(isAllowedResponseMimeTypeForTesting("image/png")).toBe(false);
      expect(isAllowedResponseMimeTypeForTesting(null)).toBe(false);
    });
  });

  describe("computeBackoff jitter behavior", () => {
    it("respects bounds and fallback delay", () => {
      const runtime = new GptActionRuntime({ random: () => 0.5 });
      const firstAttempt = (runtime as any).computeBackoff(1);
      const secondAttempt = (runtime as any).computeBackoff(2);
      const maxAttempt = (runtime as any).computeBackoff(20);

      expect(firstAttempt).toBe(500);
      expect(secondAttempt).toBe(1000);
      expect(maxAttempt).toBeGreaterThanOrEqual(500);
      expect(maxAttempt).toBeLessThanOrEqual(8000);
    });

    it("bounds random samples", () => {
      fc.assert(
        fc.property(fc.float({ min: 0, max: 1, noNaN: true }), (random) => {
          const runtime = new GptActionRuntime({ random: () => random });
          const value = (runtime as any).computeBackoff(4);
          const base = 500 * Math.pow(2, 3);
          const capped = Math.min(8000, base);
          const jitter = capped * 0.2 * (random - 0.5) * 2;
          const expectedMin = Math.max(500, Math.floor(capped + jitter - 0.0001));
          const expectedMax = Math.floor(capped + jitter + 0.0001);
          expect(value).toBeGreaterThanOrEqual(expectedMin);
          expect(value).toBeLessThanOrEqual(expectedMax);
        })
      );
    });
  });

  describe("sanitizeLogValue", () => {
  it("normalizes and redacts risky substrings", () => {
      const result = sanitizeLogValueForTesting({
        title: " <script>alert(1)</script> hello ",
        path: "javascript:alert(1)",
      });

      expect(result).toEqual({
        title: " [redacted] hello ",
        path: "[redacted]alert(1)",
      });
    });

    it("guards against cyclic log values", () => {
      const payload: Record<string, unknown> = { message: "start" };
      payload.self = payload;

      const result = sanitizeLogValueForTesting(payload);

      expect(result).toMatchObject({
        message: "start",
        self: "[redacted-cyclic]",
      });
    });
  });

  describe("actor id resolution", () => {
    it("validates actor ids and rejects non-compliant values", () => {
      expect(isValidActorIdForTesting("user_123")).toBe(true);
      expect(isValidActorIdForTesting("conv-1")).toBe(true);
      expect(isValidActorIdForTesting("short")).toBe(false);
      expect(isValidActorIdForTesting("  user@bad ")).toBe(false);
      expect(isValidActorIdForTesting(null)).toBe(false);
    });

    it("resolves actor id to null when invalid", () => {
      expect(resolveActorIdForTesting("abcdef")).toBe("abcdef");
      expect(resolveActorIdForTesting("conv-1")).toBe("conv-1");
      expect(resolveActorIdForTesting("bad@id")).toBeNull();
    });
  });

  describe("response mapping", () => {
    it("rejects forbidden source paths and target keys to avoid prototype pollution", () => {
      const response = {
        safe: { value: "ok" },
      };

      expect(
        mapResponseForTesting(response, {
          poisoned: "__proto__",
          safeAlias: "safe.value",
          constructor: "safe.value",
        })
      ).toEqual({
        safeAlias: "ok",
      });
    });
  });

  describe("request/response hardening", () => {
    it("rejects oversized request bodies before fetching", async () => {
      let called = false;
      const runtime = new GptActionRuntime({
        fetch: async () => {
          called = true;
          return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
        },
      });

      const action = {
        id: "action-1",
        name: "action-test",
        endpoint: "https://example.com/api",
        isActive: "true",
        httpMethod: "POST",
        bodyTemplate: JSON.stringify({ payload: "x".repeat(90_000) }),
      } as any;

      const result = await runtime.execute({
        action,
        gptId: "gpt-1",
        conversationId: "conv-1",
        request: {},
      });

      expect(called).toBe(false);
      expect(result.success).toBe(false);
      expect(result.error?.retryable).toBe(false);
      expect(result.error?.code).toBe("execution_error");
      expect(result.error?.message || "").toContain("exceeds");
    });

    it("rejects structured schema responses with unsupported content-type", async () => {
      const runtime = new GptActionRuntime({
        fetch: async () => {
          return new Response("ok", { status: 200, headers: { "content-type": "image/png" } });
        },
      });

      const action = {
        id: "action-2",
        name: "action-test-2",
        endpoint: "https://example.com/api",
        isActive: "true",
        httpMethod: "GET",
        responseSchema: { type: "object", properties: { value: { type: "string" } } },
      } as any;

      const result = await runtime.execute({
        action,
        gptId: "gpt-1",
        conversationId: "conv-1",
        request: {},
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("validation_error");
      expect(result.error?.message).toContain("content-type");
    });

    it("does not retry non-retriable client errors returned by downstream", async () => {
      let calls = 0;
      const runtime = new GptActionRuntime({
        fetch: async () => {
          calls += 1;
          return new Response("bad request", {
            status: 400,
            headers: { "content-type": "application/json" },
          });
        },
      });

      const action = {
        id: "action-3",
        name: "action-test-3",
        endpoint: "https://example.com/api",
        isActive: "true",
        httpMethod: "GET",
      } as any;

      const result = await runtime.execute({
        action,
        gptId: "gpt-1",
        conversationId: "conv-1",
        request: {},
      });

      expect(calls).toBe(1);
      expect(result.success).toBe(false);
      expect(result.error?.retryable).toBe(false);
      expect(result.error?.code).toBe("execution_error");
      expect(result.error?.message).toContain("status 400");
    });

    it("returns partial mapped payload on exhausted retry when downstream returns 5xx", async () => {
      const runtime = new GptActionRuntime({
        random: () => 0,
        fetch: async () => {
          return new Response(
            JSON.stringify({ reason: "temporary outage", payload: { active: true } }),
            {
              status: 503,
              headers: { "content-type": "application/json" },
            }
          );
        },
      });

      const action = {
        id: "action-4b",
        name: "action-test-4b",
        endpoint: "https://example.com/api",
        isActive: "true",
        httpMethod: "GET",
        responseMapping: { reason: "reason" },
      } as any;

      const result = await runtime.execute({
        action,
        gptId: "gpt-1",
        conversationId: "conv-1",
        request: {},
        maxRetries: 0,
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe("timeout");
      expect(result.error?.code).toBe("execution_retryable");
      expect(result.error?.retryable).toBe(true);
      expect(result.data).toEqual({ reason: "temporary outage" });
    });

    it("returns partial mapped payload on non-retryable client failures", async () => {
      const runtime = new GptActionRuntime({
        fetch: async () => {
          return new Response(
            JSON.stringify({ reason: "bad data", code: "bad_request" }),
            {
              status: 400,
              headers: { "content-type": "application/json" },
            }
          );
        },
      });

      const action = {
        id: "action-4c",
        name: "action-test-4c",
        endpoint: "https://example.com/api",
        isActive: "true",
        httpMethod: "GET",
        responseMapping: { reason: "reason" },
      } as any;

      const result = await runtime.execute({
        action,
        gptId: "gpt-1",
        conversationId: "conv-1",
        request: {},
        maxRetries: 0,
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe("failure");
      expect(result.error?.code).toBe("execution_error");
      expect(result.error?.retryable).toBe(false);
      expect(result.data).toEqual({ reason: "bad data" });
    });

    it("redacts sensitive data from partial output on downstream errors", async () => {
      const runtime = new GptActionRuntime({
        fetch: async () => {
          return new Response(
            JSON.stringify({ secret: "very-sensitive-token", reason: "temporary outage" }),
            {
              status: 400,
              headers: { "content-type": "application/json" },
            }
          );
        },
      });

      const action = {
        id: "action-4d",
        name: "action-test-4d",
        endpoint: "https://example.com/api",
        isActive: "true",
        httpMethod: "GET",
        responseMapping: { reason: "reason", secret: "secret" },
      } as any;

      const result = await runtime.execute({
        action,
        gptId: "gpt-1",
        conversationId: "conv-1",
        request: {},
        maxRetries: 0,
      });

      expect(result.success).toBe(false);
      expect(result.data).toEqual({
        reason: "temporary outage",
        secret: "[REDACTED]",
      });
    });

    it("retries transient 5xx response and exhausts at configured retry limit", async () => {
      let calls = 0;
      const runtime = new GptActionRuntime({
        random: () => 0,
        fetch: async () => {
          calls += 1;
          return new Response(
            JSON.stringify({ message: "service unavailable" }),
            {
              status: 503,
              headers: { "content-type": "application/json" },
            }
          );
        },
      });

      const action = {
        id: "action-4",
        name: "action-test-4",
        endpoint: "https://example.com/api",
        isActive: "true",
        httpMethod: "GET",
      } as any;

      const result = await runtime.execute({
        action,
        gptId: "gpt-1",
        conversationId: "conv-1",
        request: {},
        maxRetries: 1,
      });

      expect(calls).toBe(2);
      expect(result.success).toBe(false);
      expect(result.status).toBe("timeout");
      expect(result.error?.code).toBe("execution_retryable");
      expect(result.error?.message).toContain("status 503");
      expect(result.error?.retryable).toBe(true);
    });

    it("uses default retry budget when maxRetries is omitted", async () => {
      let calls = 0;
      const runtime = new GptActionRuntime({
        random: () => 0,
        fetch: async () => {
          calls += 1;
          return new Response(JSON.stringify({ message: "temporary outage" }), {
            status: 503,
            headers: { "content-type": "application/json" },
          });
        },
      });

      const action = {
        id: "action-5",
        name: "action-test-5",
        endpoint: "https://example.com/api",
        isActive: "true",
        httpMethod: "GET",
      } as any;

      const result = await runtime.execute({
        action,
        gptId: "gpt-1",
        conversationId: "conv-1",
        request: {},
      });

      expect(calls).toBe(4);
      expect(result.success).toBe(false);
      expect(result.status).toBe("timeout");
      expect(result.error?.code).toBe("execution_retryable");
      expect(result.error?.message).toContain("status 503");
      expect(result.error?.retryable).toBe(true);
    });

    it("treats invalid negative retry configuration as zero retries", async () => {
      let calls = 0;
      const runtime = new GptActionRuntime({
        random: () => 0,
        fetch: async () => {
          calls += 1;
          return new Response(JSON.stringify({ message: "service unavailable" }), {
            status: 503,
            headers: { "content-type": "application/json" },
          });
        },
      });

      const action = {
        id: "action-6",
        name: "action-test-6",
        endpoint: "https://example.com/api",
        isActive: "true",
        httpMethod: "GET",
      } as any;

      const result = await runtime.execute({
        action,
        gptId: "gpt-1",
        conversationId: "conv-1",
        request: {},
        maxRetries: -1 as any,
      });

      expect(calls).toBe(1);
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("execution_retryable");
      expect(result.error?.retryable).toBe(true);
    });

    it("rejects unsupported HTTP methods before execution", async () => {
      let called = false;
      const runtime = new GptActionRuntime({
        fetch: async () => {
          called = true;
          return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
        },
      });

      const action = {
        id: "action-7",
        name: "action-test-7",
        endpoint: "https://example.com/api",
        isActive: "true",
        httpMethod: "TRACE",
      } as any;

      const result = await runtime.execute({
        action,
        gptId: "gpt-1",
        conversationId: "conv-1",
        request: {},
      });

      expect(called).toBe(false);
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("validation_error");
      expect(result.error?.message).toContain("Unsupported HTTP method");
    });

    it("rejects unsafe endpoint schemes", async () => {
      const runtime = new GptActionRuntime({
        fetch: async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
      });

      const action = {
        id: "action-8",
        name: "action-test-8",
        endpoint: "ftp://example.com/api",
        isActive: "true",
        httpMethod: "GET",
      } as any;

      const result = await runtime.execute({
        action,
        gptId: "gpt-1",
        conversationId: "conv-1",
        request: {},
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("security_blocked");
    });

    it("rejects local and loopback endpoints", async () => {
      const runtime = new GptActionRuntime({
        fetch: async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
      });

      const action = {
        id: "action-9",
        name: "action-test-9",
        endpoint: "https://127.0.0.1:8443/api",
        isActive: "true",
        httpMethod: "GET",
      } as any;

      const result = await runtime.execute({
        action,
        gptId: "gpt-1",
        conversationId: "conv-1",
        request: {},
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("security_blocked");
    });

    it("rejects IPv6 loopback endpoints", async () => {
      const runtime = new GptActionRuntime({
        fetch: async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
      });

      const action = {
        id: "action-8a",
        name: "action-ipv6-loopback",
        endpoint: "https://[::1]/api",
        isActive: "true",
        httpMethod: "GET",
      } as any;

      const result = await runtime.execute({
        action,
        gptId: "gpt-1",
        conversationId: "conv-1",
        request: {},
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("security_blocked");
    });

    it("rejects IPv6 mapped loopback endpoints", async () => {
      const runtime = new GptActionRuntime({
        fetch: async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
      });

      const action = {
        id: "action-8b",
        name: "action-ipv6-mapped-loopback",
        endpoint: "https://[::ffff:127.0.0.1]/api",
        isActive: "true",
        httpMethod: "GET",
      } as any;

      const result = await runtime.execute({
        action,
        gptId: "gpt-1",
        conversationId: "conv-1",
        request: {},
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("security_blocked");
    });

    it("rejects endpoints with invalid URL fragments", async () => {
      const runtime = new GptActionRuntime({
        fetch: async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
      });

      const action = {
        id: "action-frag-1",
        name: "action-fragment",
        endpoint: "https://example.com/api#<script>",
        isActive: "true",
        httpMethod: "GET",
      } as any;

      const result = await runtime.execute({
        action,
        gptId: "gpt-1",
        conversationId: "conv-1",
        request: {},
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("validation_error");
      expect(result.error?.message).toContain("Invalid URL fragment");
    });

    it("rejects endpoints with oversized query parameter lists", async () => {
      const runtime = new GptActionRuntime({
        fetch: async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
      });

      const url = new URL("https://example.com/search");
      for (let index = 0; index <= 129; index += 1) {
        url.searchParams.set(`k${index}`, "1");
      }

      const action = {
        id: "action-query-count",
        name: "action-query-count",
        endpoint: url.toString(),
        isActive: "true",
        httpMethod: "GET",
      } as any;

      const result = await runtime.execute({
        action,
        gptId: "gpt-1",
        conversationId: "conv-1",
        request: {},
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("validation_error");
      expect(result.error?.message).toContain("too many query parameters");
    });

    it("rejects malformed percent-encoded query values", async () => {
      const runtime = new GptActionRuntime({
        fetch: async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
      });

      const action = {
        id: "action-query-encoding",
        name: "action-query-encoding",
        endpoint: "https://example.com/search?term=%GG",
        isActive: "true",
        httpMethod: "GET",
      } as any;

      const result = await runtime.execute({
        action,
        gptId: "gpt-1",
        conversationId: "conv-1",
        request: {},
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("validation_error");
      expect(result.error?.message).toContain("Invalid percent-encoded");
    });

    it("rejects query strings containing encoded null bytes", async () => {
      const runtime = new GptActionRuntime({
        fetch: async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
      });

      const action = {
        id: "action-query-null",
        name: "action-query-null",
        endpoint: "https://example.com/search?term=ok%00bad",
        isActive: "true",
        httpMethod: "GET",
      } as any;

      const result = await runtime.execute({
        action,
        gptId: "gpt-1",
        conversationId: "conv-1",
        request: {},
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("validation_error");
      expect(result.error?.message).toContain("Invalid query parameter value");
    });

    it("rejects double-encoded path traversal in endpoint", async () => {
      const runtime = new GptActionRuntime({
        fetch: async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
      });

      const action = {
        id: "action-14",
        name: "action-double-traversal",
        endpoint: "https://example.com/%252e%252e%252fsecret",
        isActive: "true",
        httpMethod: "GET",
      } as any;

      const result = await runtime.execute({
        action,
        gptId: "gpt-1",
        conversationId: "conv-1",
        request: {},
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("validation_error");
      expect(result.error?.message).toContain("path traversal");
    });

    it("rejects excessive endpoint query sizes", async () => {
      const runtime = new GptActionRuntime({
        fetch: async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
      });

      const action = {
        id: "action-15",
        name: "action-query-limit",
        endpoint: `https://example.com/search?q=${"x".repeat(5_000)}`,
        isActive: "true",
        httpMethod: "GET",
      } as any;

      const result = await runtime.execute({
        action,
        gptId: "gpt-1",
        conversationId: "conv-1",
        request: {},
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("validation_error");
      expect(result.error?.message).toContain("query is too long");
    });

    it("rejects invalid header configuration before outbound execution", async () => {
      let called = false;
      const runtime = new GptActionRuntime({
        fetch: async () => {
          called = true;
          return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
        },
      });

      const action = {
        id: "action-10",
        name: "action-test-10",
        endpoint: "https://example.com/api",
        isActive: "true",
        httpMethod: "GET",
        headers: Object.fromEntries(Array.from({ length: 60 }, (_, index) => [`x-test-${index}`, "1"])),
      } as any;

      const result = await runtime.execute({
        action,
        gptId: "gpt-1",
        conversationId: "conv-1",
        request: {},
      });

      expect(called).toBe(false);
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("validation_error");
      expect(result.error?.message).toContain("Too many request headers");
    });

    it("rejects domain allowlist wildcard bypass attempts", async () => {
      const runtime = new GptActionRuntime({
        fetch: async () =>
          new Response("{}", {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      });

      const action = {
        id: "action-11",
        name: "action-test-11",
        endpoint: "https://badexample.com/api",
        isActive: "true",
        httpMethod: "GET",
        domainAllowlist: ["*.example.com"],
      } as any;

      const result = await runtime.execute({
        action,
        gptId: "gpt-1",
        conversationId: "conv-1",
        request: {},
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("security_blocked");
      expect(result.error?.message).toContain("not in allowed domains");
    });

    it("rejects invalid domain allowlist entries", async () => {
      const runtime = new GptActionRuntime({
        fetch: async () =>
          new Response("{}", {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      });

      const action = {
        id: "action-12",
        name: "action-test-12",
        endpoint: "https://example.com/api",
        isActive: "true",
        httpMethod: "GET",
        domainAllowlist: [123 as any, "example.com"],
      } as any;

      const result = await runtime.execute({
        action,
        gptId: "gpt-1",
        conversationId: "conv-1",
        request: {},
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("validation_error");
      expect(result.error?.message).toContain("Invalid domain allowlist entry");
    });

    it("rejects non-array domain allowlist entries", async () => {
      const runtime = new GptActionRuntime({
        fetch: async () =>
          new Response("{}", {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      });

      const action = {
        id: "action-12a",
        name: "action-test-12a",
        endpoint: "https://example.com/api",
        isActive: "true",
        httpMethod: "GET",
        domainAllowlist: "example.com" as any,
      } as any;

      const result = await runtime.execute({
        action,
        gptId: "gpt-1",
        conversationId: "conv-1",
        request: {},
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("validation_error");
      expect(result.error?.message).toContain("Invalid domain allowlist entry");
    });

    it("rejects malformed wildcard allowlist expressions", async () => {
      const runtime = new GptActionRuntime({
        fetch: async () =>
          new Response("{}", {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      });

      const action = {
        id: "action-16",
        name: "action-test-16",
        endpoint: "https://api.example.com/api",
        isActive: "true",
        httpMethod: "GET",
        domainAllowlist: ["bad*domain.com", "*.allowed.com*"],
      } as any;

      const result = await runtime.execute({
        action,
        gptId: "gpt-1",
        conversationId: "conv-1",
        request: {},
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("validation_error");
      expect(result.error?.message).toContain("Invalid domain allowlist entry");
    });

    it("rejects allowlist arrays above hard limits", async () => {
      const runtime = new GptActionRuntime({
        fetch: async () =>
          new Response("{}", {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      });

      const action = {
        id: "action-17",
        name: "action-test-17",
        endpoint: "https://example.com/api",
        isActive: "true",
        httpMethod: "GET",
        domainAllowlist: Array.from({ length: 50 }, (_, index) => `example${index}.com`),
      } as any;

      const result = await runtime.execute({
        action,
        gptId: "gpt-1",
        conversationId: "conv-1",
        request: {},
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("validation_error");
      expect(result.error?.message).toContain("Domain allowlist is too long");
    });

    it("rejects unsafe header names that could pollute prototype", async () => {
      const runtime = new GptActionRuntime({
        fetch: async () =>
          new Response("{}", {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      });

      const headers = Object.create(null) as Record<string, unknown>;
      headers.__proto__ = "danger";
      Object.defineProperty(headers, "constructor", {
        value: "bad",
        enumerable: true,
      });
      headers["x-safe"] = "ok";

      const action = {
        id: "action-13",
        name: "action-test-13",
        endpoint: "https://example.com/api",
        isActive: "true",
        httpMethod: "GET",
        headers,
      } as any;

      const result = await runtime.execute({
        action,
        gptId: "gpt-1",
        conversationId: "conv-1",
        request: {},
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("validation_error");
      expect(result.error?.message).toContain("Unsupported header name");
    });

    it("rejects non-data header values during header normalization", async () => {
      const runtime = new GptActionRuntime({
        fetch: async () =>
          new Response("{}", {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      });

      const headers: Record<string, unknown> = {};
      Object.defineProperty(headers, "x-break", {
        enumerable: true,
        get() {
          return "broken";
        },
      });

      const action = {
        id: "action-14b",
        name: "action-test-14b",
        endpoint: "https://example.com/api",
        isActive: "true",
        httpMethod: "GET",
        headers,
      } as any;

      const result = await runtime.execute({
        action,
        gptId: "gpt-1",
        conversationId: "conv-1",
        request: {},
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("validation_error");
      expect(result.error?.message).toContain("Unsupported header value type");
    });

    it("rejects oversized aggregated headers", async () => {
      const runtime = new GptActionRuntime({
        fetch: async () =>
          new Response("{}", {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      });

      const headers = Object.fromEntries(
        Array.from({ length: 12 }, (_, index) => [`x-test-${index}`, "x".repeat(1700)])
      );

      const action = {
        id: "action-14",
        name: "action-test-14",
        endpoint: "https://example.com/api",
        isActive: "true",
        httpMethod: "GET",
        headers,
      } as any;

      const result = await runtime.execute({
        action,
        gptId: "gpt-1",
        conversationId: "conv-1",
        request: {},
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("validation_error");
      expect(result.error?.message).toContain("Request headers are too large");
    });

    it("rejects malformed body template payloads before outbound call", async () => {
      let called = false;
      const runtime = new GptActionRuntime({
        fetch: async () => {
          called = true;
          return new Response("{}", {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        },
      });

      const action = {
        id: "action-body-template",
        name: "action-test-body",
        endpoint: "https://example.com/api",
        isActive: "true",
        httpMethod: "POST",
        bodyTemplate: '{"safe":"ok","__proto__":"bad"}',
      } as any;

      const result = await runtime.execute({
        action,
        gptId: "gpt-1",
        conversationId: "conv-1",
        request: {},
      });

      expect(called).toBe(false);
      expect(result.success).toBe(false);
      expect(result.status).toBe("validation_error");
      expect(result.error?.code).toBe("validation_error");
      expect(result.error?.message).toContain("Forbidden object key");
    });

    it("rejects outbound request body for GET methods", async () => {
      let called = false;
      const runtime = new GptActionRuntime({
        fetch: async () => {
          called = true;
          return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
        },
      });

      const action = {
        id: "action-get-body",
        name: "action-get-body",
        endpoint: "https://example.com/api",
        isActive: "true",
        httpMethod: "GET",
        bodyTemplate: JSON.stringify({ forbidden: true }),
      } as any;

      const result = await runtime.execute({
        action,
        gptId: "gpt-1",
        conversationId: "conv-1",
        request: {},
      });

      expect(called).toBe(false);
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("validation_error");
      expect(result.error?.message).toContain("Request bodies are not allowed for GET");
    });

    it("rejects deeply nested requests before making outbound call", async () => {
      let called = false;
      const runtime = new GptActionRuntime({
        fetch: async () => {
          called = true;
          return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
        },
      });

      const nestedRequest: Record<string, unknown> = {};
      let pointer = nestedRequest;
      for (let i = 0; i < 30; i += 1) {
        const next: Record<string, unknown> = {};
        pointer.level = i;
        pointer.next = next;
        pointer = next;
      }

      const action = {
        id: "action-deep-request",
        name: "action-deep-request",
        endpoint: "https://example.com/api",
        isActive: "true",
        httpMethod: "GET",
      } as any;

      const result = await runtime.execute({
        action,
        gptId: "gpt-1",
        conversationId: "conv-1",
        request: nestedRequest,
      });

      expect(called).toBe(false);
      expect(result.success).toBe(false);
      expect(result.status).toBe("validation_error");
      expect(result.error?.code).toBe("validation_error");
      expect(result.error?.message).toContain("depth limit");
    });

    it("rejects forbidden object keys in payload at execution time", async () => {
      let called = false;
      const runtime = new GptActionRuntime({
        fetch: async () => {
          called = true;
          return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
        },
      });

      const action = {
        id: "action-prototype-key",
        name: "action-prototype-key",
        endpoint: "https://example.com/api",
        isActive: "true",
        httpMethod: "GET",
      } as any;
      const request = Object.create(null) as Record<string, unknown>;
      request.safe = "ok";
      Object.defineProperty(request, "__proto__", {
        value: { attack: "x" },
        enumerable: true,
      });

      const result = await runtime.execute({
        action,
        gptId: "gpt-1",
        conversationId: "conv-1",
        request,
      });

      expect(called).toBe(false);
      expect(result.success).toBe(false);
      expect(result.status).toBe("validation_error");
      expect(result.error?.code).toBe("validation_error");
      expect(result.error?.message).toContain("Forbidden object key");
    });

    it("rejects overly deep response payloads when schema validation requires structure", async () => {
      const runtime = new GptActionRuntime({
        fetch: async () => {
          let nested: Record<string, unknown> = {};
          let cursor = nested;
          for (let i = 0; i < 80; i += 1) {
            const next: Record<string, unknown> = {};
            cursor.value = i;
            cursor.nested = next;
            cursor = next;
          }

          return new Response(JSON.stringify({ payload: nested }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        },
      });

      const action = {
        id: "action-deep-response",
        name: "action-deep-response",
        endpoint: "https://example.com/api",
        isActive: "true",
        httpMethod: "GET",
        responseSchema: { type: "object" },
      } as any;

      const result = await runtime.execute({
        action,
        gptId: "gpt-1",
        conversationId: "conv-1",
        request: {},
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe("validation_error");
      expect(result.error?.code).toBe("validation_error");
      expect(result.error?.message).toContain("depth limit exceeded");
    });
  });
});
