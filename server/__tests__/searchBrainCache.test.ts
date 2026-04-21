/**
 * Tests for searchCache — both the pure helpers and the lookup/write
 * flow with an in-memory CacheStore stub.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  lookup,
  write,
  SEARCH_CACHE_INTERNAL,
  DEFAULT_SEMANTIC_THRESHOLD,
  DEFAULT_TTL_SECONDS,
  type CacheStore,
  type SearchKind,
  type StoredRow,
} from "../services/searchBrain/searchCache";

// All lookup/write calls require DATABASE_URL to be set. Tests use an
// injected store, so this is only a gate flag.
beforeEach(() => {
  process.env.DATABASE_URL = "postgres://test";
});

function inMemoryStore(): CacheStore & { rows: StoredRow[]; findExactCalls: number; findNearestCalls: number } {
  const rows: StoredRow[] = [];
  const instance = {
    rows,
    findExactCalls: 0,
    findNearestCalls: 0,
    async findExact(queryHash: string, kind: SearchKind, now: Date) {
      instance.findExactCalls++;
      const hit = rows.find(
        (r) => r.queryHash === queryHash && r.kind === kind && r.expiresAt > now
      );
      return hit ?? null;
    },
    async findNearest(embedding: number[], kind: SearchKind, now: Date, limit: number) {
      instance.findNearestCalls++;
      const candidates = rows.filter((r) => r.kind === kind && r.expiresAt > now && r.embedding);
      const scored = candidates.map((r) => ({
        ...r,
        distance: cosineDistance(embedding, r.embedding!),
      }));
      scored.sort((a, b) => a.distance - b.distance);
      return scored.slice(0, limit);
    },
    async upsert(row: StoredRow) {
      const idx = rows.findIndex((r) => r.queryHash === row.queryHash && r.kind === row.kind);
      if (idx >= 0) rows[idx] = row;
      else rows.push(row);
    },
  };
  return instance;
}

function cosineDistance(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  if (denom === 0) return 1;
  return 1 - dot / denom;
}

// ─── Pure helpers ─────────────────────────────────────────────────────────

describe("computeQueryHash", () => {
  it("is stable across invocations and normalises whitespace/case", () => {
    const h1 = SEARCH_CACHE_INTERNAL.computeQueryHash("academic", "Machine Learning", ["openalex"]);
    const h2 = SEARCH_CACHE_INTERNAL.computeQueryHash("academic", "machine   learning", ["openalex"]);
    expect(h1).toBe(h2);
  });

  it("differs when kind differs", () => {
    expect(
      SEARCH_CACHE_INTERNAL.computeQueryHash("academic", "q", ["openalex"]),
    ).not.toBe(SEARCH_CACHE_INTERNAL.computeQueryHash("web", "q", ["openalex"]));
  });

  it("is source-order independent", () => {
    const h1 = SEARCH_CACHE_INTERNAL.computeQueryHash("academic", "q", ["a", "b"]);
    const h2 = SEARCH_CACHE_INTERNAL.computeQueryHash("academic", "q", ["b", "a"]);
    expect(h1).toBe(h2);
  });
});

describe("distanceToSimilarity", () => {
  it("0 distance → 1 similarity, 1 distance → 0 similarity", () => {
    expect(SEARCH_CACHE_INTERNAL.distanceToSimilarity(0)).toBe(1);
    expect(SEARCH_CACHE_INTERNAL.distanceToSimilarity(1)).toBe(0);
  });

  it("clamps negative / NaN to 0", () => {
    expect(SEARCH_CACHE_INTERNAL.distanceToSimilarity(NaN)).toBe(0);
    expect(SEARCH_CACHE_INTERNAL.distanceToSimilarity(-0.1)).toBe(1); // sim = 1 - (-0.1) = 1.1 → clamped to 1
    expect(SEARCH_CACHE_INTERNAL.distanceToSimilarity(2)).toBe(0); // sim = -1 → clamped to 0
  });
});

describe("pgvector round-trip", () => {
  it("embeddingToPg + parsePgVector is identity (within float rounding)", () => {
    const v = [1.5, -2.25, 0, 3.14];
    const s = SEARCH_CACHE_INTERNAL.embeddingToPg(v);
    expect(s).toBe("[1.5,-2.25,0,3.14]");
    const parsed = SEARCH_CACHE_INTERNAL.parsePgVector(s);
    expect(parsed).toEqual(v);
  });

  it("parsePgVector handles malformed input", () => {
    expect(SEARCH_CACHE_INTERNAL.parsePgVector("")).toEqual([]);
    expect(SEARCH_CACHE_INTERNAL.parsePgVector("not a vector")).toEqual([]);
  });
});

// ─── lookup / write ────────────────────────────────────────────────────────

describe("lookup", () => {
  it("returns null when DATABASE_URL is unset (cache disabled)", async () => {
    delete process.env.DATABASE_URL;
    const store = inMemoryStore();
    const hit = await lookup({ kind: "academic", query: "q", store });
    expect(hit).toBeNull();
    expect(store.findExactCalls).toBe(0);
  });

  it("returns null when nothing is cached", async () => {
    const store = inMemoryStore();
    const hit = await lookup({ kind: "academic", query: "q", store });
    expect(hit).toBeNull();
  });

  it("returns exact match when hash + kind match", async () => {
    const store = inMemoryStore();
    await write({
      kind: "academic",
      query: "melatonin sleep",
      sources: ["openalex"],
      payload: { answer: "cached!" },
      store,
    });
    const hit = await lookup({
      kind: "academic",
      query: "melatonin sleep",
      sources: ["openalex"],
      store,
    });
    expect(hit).toMatchObject({
      matchedBy: "exact",
      payload: { answer: "cached!" },
    });
  });

  it("skips semantic fallback when no embedding supplied", async () => {
    const store = inMemoryStore();
    await write({
      kind: "academic",
      query: "melatonin",
      payload: {},
      embedding: [1, 0, 0],
      store,
    });
    const hit = await lookup({
      kind: "academic",
      query: "different",
      store,
    });
    expect(hit).toBeNull();
    expect(store.findNearestCalls).toBe(0);
  });

  it("returns semantic match when similarity ≥ threshold", async () => {
    const store = inMemoryStore();
    await write({
      kind: "academic",
      query: "melatonin supplementation",
      payload: { rows: 5 },
      embedding: [1, 0, 0],
      store,
    });
    const hit = await lookup({
      kind: "academic",
      query: "nearby query",
      embedding: [0.98, 0.1, 0.01],
      similarityThreshold: 0.9,
      store,
    });
    expect(hit).toMatchObject({ matchedBy: "semantic", payload: { rows: 5 } });
    expect(hit!.similarity).toBeGreaterThanOrEqual(0.9);
  });

  it("rejects semantic match below threshold", async () => {
    const store = inMemoryStore();
    await write({
      kind: "academic",
      query: "melatonin",
      payload: { rows: 5 },
      embedding: [1, 0, 0],
      store,
    });
    const hit = await lookup({
      kind: "academic",
      query: "far away",
      embedding: [0, 1, 0], // orthogonal — cosine 0
      similarityThreshold: DEFAULT_SEMANTIC_THRESHOLD,
      store,
    });
    expect(hit).toBeNull();
  });

  it("does NOT cross-match different kinds", async () => {
    const store = inMemoryStore();
    await write({ kind: "academic", query: "q", payload: { a: 1 }, store });
    const webHit = await lookup({ kind: "web", query: "q", store });
    expect(webHit).toBeNull();
  });

  it("respects expiry (entries past expiresAt are ignored)", async () => {
    const store = inMemoryStore();
    await write({ kind: "academic", query: "q", payload: { a: 1 }, ttlSeconds: 60, store });
    // Manually bump stored row to already-expired.
    store.rows[0]!.expiresAt = new Date(Date.now() - 1000);
    const hit = await lookup({ kind: "academic", query: "q", store });
    expect(hit).toBeNull();
  });

  it("swallows store errors (returns null)", async () => {
    const failing: CacheStore = {
      findExact: vi.fn(async () => { throw new Error("db down"); }),
      findNearest: vi.fn(async () => []),
      upsert: vi.fn(async () => {}),
    };
    const hit = await lookup({ kind: "academic", query: "q", store: failing });
    expect(hit).toBeNull();
  });
});

describe("write", () => {
  it("persists the row with default TTL per kind", async () => {
    const store = inMemoryStore();
    const before = Date.now();
    await write({ kind: "academic", query: "q", payload: { a: 1 }, store });
    expect(store.rows).toHaveLength(1);
    const row = store.rows[0]!;
    expect(row.ttlSeconds).toBe(DEFAULT_TTL_SECONDS.academic);
    expect(row.expiresAt.getTime()).toBeGreaterThanOrEqual(
      before + DEFAULT_TTL_SECONDS.academic * 1000 - 1000,
    );
  });

  it("upsert replaces the same (queryHash, kind) row", async () => {
    const store = inMemoryStore();
    await write({ kind: "academic", query: "q", payload: { v: 1 }, store });
    await write({ kind: "academic", query: "q", payload: { v: 2 }, store });
    expect(store.rows).toHaveLength(1);
    expect((store.rows[0]!.payload as { v: number }).v).toBe(2);
  });

  it("different kinds share the same query but live independently", async () => {
    const store = inMemoryStore();
    await write({ kind: "academic", query: "q", payload: { v: "a" }, store });
    await write({ kind: "web", query: "q", payload: { v: "w" }, store });
    expect(store.rows).toHaveLength(2);
  });

  it("write failures are swallowed", async () => {
    const failing: CacheStore = {
      findExact: vi.fn(async () => null),
      findNearest: vi.fn(async () => []),
      upsert: vi.fn(async () => { throw new Error("insert fail"); }),
    };
    await expect(
      write({ kind: "academic", query: "q", payload: {}, store: failing }),
    ).resolves.toBeUndefined();
  });
});
