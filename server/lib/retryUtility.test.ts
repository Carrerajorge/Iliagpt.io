import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock productionLogger before importing module
vi.mock("./productionLogger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { withRetry, retryable, fetchWithRetry } from "./retryUtility";

describe("withRetry", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns result on first success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on retryable errors", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValue("recovered");
    const result = await withRetry(fn, { maxAttempts: 3, initialDelayMs: 1, jitter: false });
    expect(result).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("throws after max attempts exhausted", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("ETIMEDOUT"));
    await expect(withRetry(fn, { maxAttempts: 2, initialDelayMs: 1, jitter: false })).rejects.toThrow("ETIMEDOUT");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does not retry non-retryable errors", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("validation failed"));
    await expect(withRetry(fn, { maxAttempts: 3, initialDelayMs: 1 })).rejects.toThrow("validation failed");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("respects custom retryCondition", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("custom retryable"))
      .mockResolvedValue("ok");
    const result = await withRetry(fn, {
      maxAttempts: 3,
      initialDelayMs: 1,
      jitter: false,
      retryCondition: (err) => err.message.includes("custom retryable"),
    });
    expect(result).toBe("ok");
  });

  it("calls onRetry callback", async () => {
    const onRetry = vi.fn();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValue("ok");
    await withRetry(fn, { maxAttempts: 3, initialDelayMs: 1, jitter: false, onRetry });
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(expect.any(Error), 1, expect.any(Number));
  });

  it("retries on rate limit errors (429)", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("429 Too Many Requests"))
      .mockResolvedValue("ok");
    const result = await withRetry(fn, { maxAttempts: 3, initialDelayMs: 1, jitter: false });
    expect(result).toBe("ok");
  });

  it("retries on 500/502/503/504 server errors", async () => {
    for (const code of ["500", "502", "503", "504"]) {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error(`HTTP ${code}`))
        .mockResolvedValue("ok");
      const result = await withRetry(fn, { maxAttempts: 3, initialDelayMs: 1, jitter: false });
      expect(result).toBe("ok");
    }
  });

  it("converts non-Error throws to Error", async () => {
    const fn = vi.fn().mockRejectedValue("string error");
    await expect(withRetry(fn, { maxAttempts: 1, initialDelayMs: 1 })).rejects.toThrow("string error");
  });
});

describe("retryable", () => {
  it("wraps a function with retry logic", async () => {
    let callCount = 0;
    const fn = async (x: number) => {
      callCount++;
      if (callCount === 1) throw new Error("ECONNREFUSED");
      return x * 2;
    };
    const wrapped = retryable(fn, { maxAttempts: 3, initialDelayMs: 1, jitter: false });
    const result = await wrapped(5);
    expect(result).toBe(10);
    expect(callCount).toBe(2);
  });
});

describe("fetchWithRetry (server)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns response on success", async () => {
    const mockResponse = new Response("ok", { status: 200 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));
    const result = await fetchWithRetry("https://example.com");
    expect(result.status).toBe(200);
  });

  it("throws on 500 status after retries", async () => {
    const mockResponse = new Response("error", { status: 500, statusText: "Internal Server Error" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));
    await expect(
      fetchWithRetry("https://example.com", undefined, { maxAttempts: 2, initialDelayMs: 1, jitter: false })
    ).rejects.toThrow("HTTP 500");
  });

  it("throws on 429 status after retries", async () => {
    const mockResponse = new Response("rate limited", { status: 429, statusText: "Too Many Requests" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));
    await expect(
      fetchWithRetry("https://example.com", undefined, { maxAttempts: 2, initialDelayMs: 1, jitter: false })
    ).rejects.toThrow("HTTP 429");
  });

  it("passes through 4xx errors without retry", async () => {
    const mockResponse = new Response("not found", { status: 404, statusText: "Not Found" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));
    const result = await fetchWithRetry("https://example.com");
    expect(result.status).toBe(404);
  });
});
