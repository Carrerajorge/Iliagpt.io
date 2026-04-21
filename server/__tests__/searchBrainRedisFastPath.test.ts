/**
 * Tests for the Redis fast-path. A fake RedisClientLike is injected so
 * we can run without a real Redis server and without ioredis on the
 * import graph.
 */

import { describe, expect, it, vi } from "vitest";
import { redisLookup, redisWrite, REDIS_FAST_PATH_INTERNAL } from "../services/searchBrain/redisFastPath";
import type { RedisClientLike } from "../services/searchBrain/redisClientFactory";

function makeFakeRedis(): RedisClientLike & { store: Map<string, string>; getCalls: string[]; setexCalls: Array<[string, number, string]> } {
  const store = new Map<string, string>();
  const instance = {
    store,
    getCalls: [] as string[],
    setexCalls: [] as Array<[string, number, string]>,
    async get(key: string) {
      instance.getCalls.push(key);
      return store.get(key) ?? null;
    },
    async setex(key: string, seconds: number, value: string) {
      instance.setexCalls.push([key, seconds, value]);
      store.set(key, value);
      return "OK" as const;
    },
  };
  return instance;
}

describe("redisKey", () => {
  it("produces a namespaced key", () => {
    expect(REDIS_FAST_PATH_INTERNAL.redisKey("academic", "abc123")).toBe("sb:academic:abc123");
    expect(REDIS_FAST_PATH_INTERNAL.redisKey("web", "xyz")).toBe("sb:web:xyz");
  });
});

describe("redisLookup", () => {
  it("returns null when no client configured", async () => {
    const hit = await redisLookup({ kind: "academic", queryHash: "h" });
    expect(hit).toBeNull();
  });

  it("returns null when key missing", async () => {
    const client = makeFakeRedis();
    const hit = await redisLookup({ kind: "academic", queryHash: "h", client });
    expect(hit).toBeNull();
    expect(client.getCalls).toEqual(["sb:academic:h"]);
  });

  it("returns parsed JSON on hit", async () => {
    const client = makeFakeRedis();
    client.store.set("sb:academic:h", JSON.stringify({ ok: true, n: 5 }));
    const hit = await redisLookup({ kind: "academic", queryHash: "h", client });
    expect(hit).toEqual({ ok: true, n: 5 });
  });

  it("returns null on malformed JSON", async () => {
    const client = makeFakeRedis();
    client.store.set("sb:academic:h", "not-json");
    const hit = await redisLookup({ kind: "academic", queryHash: "h", client });
    expect(hit).toBeNull();
  });

  it("swallows client errors", async () => {
    const failing: RedisClientLike = {
      get: vi.fn(async () => { throw new Error("boom"); }),
      setex: vi.fn(async () => "OK"),
    };
    const hit = await redisLookup({ kind: "academic", queryHash: "h", client: failing });
    expect(hit).toBeNull();
  });
});

describe("redisWrite", () => {
  it("serialises + SETEXs with the provided TTL", async () => {
    const client = makeFakeRedis();
    await redisWrite({
      kind: "academic",
      queryHash: "hq",
      payload: { a: 1 },
      ttlSeconds: 300,
      client,
    });
    expect(client.setexCalls).toEqual([["sb:academic:hq", 300, JSON.stringify({ a: 1 })]]);
  });

  it("floors TTL at 60s", async () => {
    const client = makeFakeRedis();
    await redisWrite({ kind: "web", queryHash: "h", payload: {}, ttlSeconds: 10, client });
    expect(client.setexCalls[0]?.[1]).toBe(60);
  });

  it("no-op when client missing", async () => {
    await expect(redisWrite({ kind: "academic", queryHash: "h", payload: {}, ttlSeconds: 60 })).resolves.toBeUndefined();
  });

  it("swallows client errors", async () => {
    const failing: RedisClientLike = {
      get: vi.fn(async () => null),
      setex: vi.fn(async () => { throw new Error("write fail"); }),
    };
    await expect(
      redisWrite({ kind: "academic", queryHash: "h", payload: {}, ttlSeconds: 120, client: failing }),
    ).resolves.toBeUndefined();
  });

  it("round-trips via lookup", async () => {
    const client = makeFakeRedis();
    await redisWrite({ kind: "academic", queryHash: "h", payload: { rows: [1, 2, 3] }, ttlSeconds: 600, client });
    const hit = await redisLookup({ kind: "academic", queryHash: "h", client });
    expect(hit).toEqual({ rows: [1, 2, 3] });
  });
});
