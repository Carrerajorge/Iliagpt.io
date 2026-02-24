import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// We need to reset the singleton between tests, so we re-import after resetting modules
// The module exports a singleton, so we work with the exported helpers directly.
import {
  requestDedup,
  dedupe,
  dedupeRequest,
  createDedupedFunction,
  getDedupStats,
} from "./requestDedup";

describe("RequestDeduplicator", () => {
  beforeEach(() => {
    requestDedup.clearAll();
    requestDedup.resetStats();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // generateKey
  // -------------------------------------------------------------------------
  describe("generateKey", () => {
    it("generates a hex string key", () => {
      const key = requestDedup.generateKey("GET", "/api/data");
      expect(key).toMatch(/^[0-9a-f]{64}$/);
    });

    it("generates same key for identical method+path", () => {
      const k1 = requestDedup.generateKey("GET", "/api/data");
      const k2 = requestDedup.generateKey("GET", "/api/data");
      expect(k1).toBe(k2);
    });

    it("uppercases the method for consistency", () => {
      const k1 = requestDedup.generateKey("get", "/api/data");
      const k2 = requestDedup.generateKey("GET", "/api/data");
      expect(k1).toBe(k2);
    });

    it("produces different keys for different paths", () => {
      const k1 = requestDedup.generateKey("GET", "/api/a");
      const k2 = requestDedup.generateKey("GET", "/api/b");
      expect(k1).not.toBe(k2);
    });

    it("produces different keys for different methods", () => {
      const k1 = requestDedup.generateKey("GET", "/api/data");
      const k2 = requestDedup.generateKey("POST", "/api/data");
      expect(k1).not.toBe(k2);
    });

    it("includes sorted params in the key", () => {
      const k1 = requestDedup.generateKey("GET", "/api", { b: 2, a: 1 });
      const k2 = requestDedup.generateKey("GET", "/api", { a: 1, b: 2 });
      expect(k1).toBe(k2);
    });

    it("includes body in the key", () => {
      const k1 = requestDedup.generateKey("POST", "/api", undefined, { foo: "bar" });
      const k2 = requestDedup.generateKey("POST", "/api", undefined, { foo: "baz" });
      expect(k1).not.toBe(k2);
    });

    it("ignores empty params object", () => {
      const k1 = requestDedup.generateKey("GET", "/api", {});
      const k2 = requestDedup.generateKey("GET", "/api");
      expect(k1).toBe(k2);
    });

    it("treats null body same as no body", () => {
      const k1 = requestDedup.generateKey("POST", "/api", undefined, null);
      const k2 = requestDedup.generateKey("POST", "/api");
      expect(k1).toBe(k2);
    });
  });

  // -------------------------------------------------------------------------
  // dedupe
  // -------------------------------------------------------------------------
  describe("dedupe", () => {
    it("executes the executor for a new key", async () => {
      const executor = vi.fn().mockResolvedValue("result");
      const result = await requestDedup.dedupe("key1", executor);
      expect(result).toBe("result");
      expect(executor).toHaveBeenCalledTimes(1);
    });

    it("coalesces concurrent requests with the same key", async () => {
      let resolveFn: (v: string) => void;
      const slowPromise = new Promise<string>((resolve) => {
        resolveFn = resolve;
      });
      const executor = vi.fn().mockReturnValue(slowPromise);

      const p1 = requestDedup.dedupe("key2", executor);
      const p2 = requestDedup.dedupe("key2", executor);

      // executor should only be called once
      expect(executor).toHaveBeenCalledTimes(1);

      resolveFn!("shared");
      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1).toBe("shared");
      expect(r2).toBe("shared");
    });

    it("cleans up the key after execution completes", async () => {
      await requestDedup.dedupe("key3", () => Promise.resolve("done"));
      expect(requestDedup.isInflight("key3")).toBe(false);
    });

    it("cleans up the key after execution rejects", async () => {
      try {
        await requestDedup.dedupe("key4", () => Promise.reject(new Error("fail")));
      } catch {
        // expected
      }
      expect(requestDedup.isInflight("key4")).toBe(false);
    });

    it("propagates errors to all subscribers", async () => {
      let rejectFn: (e: Error) => void;
      const failing = new Promise<string>((_, reject) => {
        rejectFn = reject;
      });
      const executor = vi.fn().mockReturnValue(failing);

      const p1 = requestDedup.dedupe("key5", executor);
      const p2 = requestDedup.dedupe("key5", executor);

      rejectFn!(new Error("boom"));

      await expect(p1).rejects.toThrow("boom");
      await expect(p2).rejects.toThrow("boom");
    });
  });

  // -------------------------------------------------------------------------
  // dedupeWithTimeout
  // -------------------------------------------------------------------------
  describe("dedupeWithTimeout", () => {
    it("resolves if executor finishes before timeout", async () => {
      const result = await requestDedup.dedupeWithTimeout(
        "tkey1",
        () => Promise.resolve("fast"),
        5000,
      );
      expect(result).toBe("fast");
    });

    it("rejects with timeout error if executor is too slow", async () => {
      const neverResolve = new Promise<string>(() => {});
      await expect(
        requestDedup.dedupeWithTimeout("tkey2", () => neverResolve, 50),
      ).rejects.toThrow("Request deduplication timeout after 50ms");
    });
  });

  // -------------------------------------------------------------------------
  // isInflight / getInflightCount
  // -------------------------------------------------------------------------
  describe("isInflight / getInflightCount", () => {
    it("reports in-flight status while pending", async () => {
      let resolveFn: () => void;
      const pending = new Promise<void>((resolve) => {
        resolveFn = resolve;
      });
      const p = requestDedup.dedupe("ifkey", () => pending);

      expect(requestDedup.isInflight("ifkey")).toBe(true);
      expect(requestDedup.getInflightCount()).toBe(1);

      resolveFn!();
      await p;

      expect(requestDedup.isInflight("ifkey")).toBe(false);
      expect(requestDedup.getInflightCount()).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // stats
  // -------------------------------------------------------------------------
  describe("getStats / resetStats", () => {
    it("tracks unique and coalesced requests", async () => {
      let resolveFn: (v: string) => void;
      const pending = new Promise<string>((resolve) => {
        resolveFn = resolve;
      });
      const executor = vi.fn().mockReturnValue(pending);

      const p1 = requestDedup.dedupe("skey", executor);
      const p2 = requestDedup.dedupe("skey", executor);

      resolveFn!("ok");
      await Promise.all([p1, p2]);

      const stats = getDedupStats();
      expect(stats.uniqueRequests).toBe(1);
      expect(stats.coalescedRequests).toBe(1);
      expect(stats.totalSaved).toBe(1);
    });

    it("resets stats correctly", async () => {
      await requestDedup.dedupe("rkey", () => Promise.resolve("x"));
      requestDedup.resetStats();
      const stats = getDedupStats();
      expect(stats.uniqueRequests).toBe(0);
      expect(stats.coalescedRequests).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // cancelInflight / clearAll
  // -------------------------------------------------------------------------
  describe("cancelInflight / clearAll", () => {
    it("cancels a single in-flight key", () => {
      requestDedup.dedupe("ckey", () => new Promise<void>(() => {}));
      expect(requestDedup.isInflight("ckey")).toBe(true);
      const deleted = requestDedup.cancelInflight("ckey");
      expect(deleted).toBe(true);
      expect(requestDedup.isInflight("ckey")).toBe(false);
    });

    it("returns false when cancelling a non-existent key", () => {
      expect(requestDedup.cancelInflight("nokey")).toBe(false);
    });

    it("clearAll removes all pending requests", () => {
      requestDedup.dedupe("a", () => new Promise<void>(() => {}));
      requestDedup.dedupe("b", () => new Promise<void>(() => {}));
      expect(requestDedup.getInflightCount()).toBe(2);
      requestDedup.clearAll();
      expect(requestDedup.getInflightCount()).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Module-level helper functions
// ---------------------------------------------------------------------------
describe("dedupe (module export)", () => {
  beforeEach(() => {
    requestDedup.clearAll();
    requestDedup.resetStats();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("delegates to requestDedup.dedupe", async () => {
    const result = await dedupe("dk", () => Promise.resolve(42));
    expect(result).toBe(42);
  });
});

describe("dedupeRequest", () => {
  beforeEach(() => {
    requestDedup.clearAll();
    requestDedup.resetStats();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("deduplicates by method+path", async () => {
    const executor = vi.fn().mockResolvedValue("data");
    const r1 = dedupeRequest("GET", "/api/items", executor);
    const r2 = dedupeRequest("GET", "/api/items", executor);
    const [v1, v2] = await Promise.all([r1, r2]);
    expect(v1).toBe("data");
    expect(v2).toBe("data");
    expect(executor).toHaveBeenCalledTimes(1);
  });

  it("uses timeout when specified", async () => {
    const neverResolve = new Promise<string>(() => {});
    await expect(
      dedupeRequest("GET", "/slow", () => neverResolve, { timeout: 50 }),
    ).rejects.toThrow("timeout");
  });
});

describe("createDedupedFunction", () => {
  beforeEach(() => {
    requestDedup.clearAll();
    requestDedup.resetStats();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("wraps a function with deduplication based on custom key generator", async () => {
    const fn = vi.fn(async (id: number) => `result-${id}`);
    const dedupedFn = createDedupedFunction(fn, (id) => `user-${id}`);

    const result = await dedupedFn(42);
    expect(result).toBe("result-42");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("coalesces calls with same generated key", async () => {
    let resolveFn: (v: string) => void;
    const pending = new Promise<string>((resolve) => {
      resolveFn = resolve;
    });
    const fn = vi.fn().mockReturnValue(pending);
    const dedupedFn = createDedupedFunction(fn, () => "same-key");

    const p1 = dedupedFn("a");
    const p2 = dedupedFn("b");

    expect(fn).toHaveBeenCalledTimes(1);

    resolveFn!("shared");
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe("shared");
    expect(r2).toBe("shared");
  });
});
