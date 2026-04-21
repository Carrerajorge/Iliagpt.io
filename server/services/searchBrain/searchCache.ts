/**
 * searchCache — persistent cache for SearchBrain responses.
 *
 * Two lookup paths, both cheap to keep cold:
 *
 *   1. EXACT HIT — SHA-256 of (normalised query + sources + kind).
 *      Deterministic and fast: a user who re-submits the same query
 *      within TTL gets a sub-ms Postgres round-trip with no LLM call.
 *
 *   2. SEMANTIC HIT — when the exact key misses we fall back to a
 *      cosine-similarity query over the `embedding` column. The
 *      incoming query is embedded via the shared text-embedding-3-small
 *      pipeline; we run `embedding <=> $1 ASC LIMIT 5` on rows of the
 *      same `kind` within TTL, then apply a cosine-similarity gate
 *      (default 0.92) on the client side so we can tune the threshold
 *      without touching the schema.
 *
 * TTL policy:
 *   - academic  → 30 days (papers don't churn; new matches come from
 *                 new publications, not existing ones)
 *   - web       → 24 hours
 *   - deep      → 24 hours (bounded by the cheaper of academic + web)
 *
 * Redis is NOT used in this phase — the Drizzle path is strictly
 * faster than a cold disk seek and our current Redis helper is
 * disabled in dev anyway. Adding Redis later means one more `.get` /
 * `.setex` pair in this file; the contract with callers doesn't change.
 *
 * The store is dependency-injected so tests run without Postgres.
 */

import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import { db as defaultDb } from "../../db";

export type SearchKind = "academic" | "web" | "deep";

export const DEFAULT_TTL_SECONDS: Record<SearchKind, number> = {
  academic: 30 * 24 * 3600,
  web: 24 * 3600,
  deep: 24 * 3600,
};

export const DEFAULT_SEMANTIC_THRESHOLD = 0.92;

export interface CacheLookupArgs {
  kind: SearchKind;
  query: string;
  sources?: string[];
  /** Pre-computed embedding. If omitted, semantic fallback is skipped. */
  embedding?: number[];
  /** Override the 0.92 cosine gate for this one lookup. */
  similarityThreshold?: number;
  /** Override the default Drizzle db (for tests). */
  store?: CacheStore;
}

export interface CacheWriteArgs {
  kind: SearchKind;
  query: string;
  sources?: string[];
  embedding?: number[];
  payload: unknown;
  ttlSeconds?: number;
  metadata?: Record<string, unknown>;
  store?: CacheStore;
}

export interface CacheHit {
  payload: unknown;
  queryHash: string;
  kind: SearchKind;
  matchedBy: "exact" | "semantic";
  similarity?: number;
  cachedAt: Date;
  expiresAt: Date;
  metadata?: unknown;
}

// ─── Dependency seam ──────────────────────────────────────────────────────

/**
 * Narrow interface around the Drizzle client so tests don't need a
 * real DB. The methods here are the ONLY things searchCache calls.
 */
export interface CacheStore {
  findExact(
    queryHash: string,
    kind: SearchKind,
    now: Date
  ): Promise<StoredRow | null>;
  findNearest(
    embedding: number[],
    kind: SearchKind,
    now: Date,
    limit: number
  ): Promise<Array<StoredRow & { distance: number }>>;
  upsert(row: StoredRow): Promise<void>;
}

export interface StoredRow {
  queryHash: string;
  kind: SearchKind;
  queryText: string;
  embedding: number[] | null;
  payload: unknown;
  cachedAt: Date;
  expiresAt: Date;
  ttlSeconds: number;
  metadata?: unknown;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function normaliseQuery(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, " ");
}

export function computeQueryHash(
  kind: SearchKind,
  query: string,
  sources: string[] | undefined
): string {
  const sorted = (sources ?? []).map(String).sort().join(",");
  const key = `${kind}::${normaliseQuery(query)}::${sorted}`;
  return crypto.createHash("sha256").update(key).digest("hex");
}

/**
 * Convert pgvector distance (<=> returns 1 - cos) to a 0..1 cosine
 * similarity. pgvector's `vector_cosine_ops` gives `distance = 1 - cos`.
 */
export function distanceToSimilarity(distance: number): number {
  const sim = 1 - distance;
  if (!Number.isFinite(sim)) return 0;
  return Math.max(0, Math.min(1, sim));
}

// ─── Default store (Drizzle-backed) ───────────────────────────────────────

type DbLike = Pick<typeof defaultDb, "execute"> & {
  // The exact signature of `execute` differs between Drizzle versions;
  // we only use `sql` tagged queries so keep the typing loose.
};

function makeDefaultStore(): CacheStore {
  return makeDrizzleStore(defaultDb as unknown as DbLike);
}

export function makeDrizzleStore(dbInstance: DbLike): CacheStore {
  const db = dbInstance;
  return {
    async findExact(queryHash, kind, now) {
      const rows = (await db.execute(sql/*sql*/`
        SELECT query_hash, kind, query_text, embedding::text as embedding,
               payload, cached_at, expires_at, ttl_seconds, metadata
        FROM search_brain_cache
        WHERE query_hash = ${queryHash}
          AND kind = ${kind}
          AND expires_at > ${now.toISOString()}
        LIMIT 1
      `)) as { rows?: RawRow[] } | RawRow[] | undefined;
      const raw = getRows(rows)[0];
      return raw ? rowToStored(raw) : null;
    },
    async findNearest(embedding, kind, now, limit) {
      const vec = embeddingToPg(embedding);
      const rows = (await db.execute(sql/*sql*/`
        SELECT query_hash, kind, query_text, embedding::text as embedding,
               payload, cached_at, expires_at, ttl_seconds, metadata,
               embedding <=> ${vec}::vector as distance
        FROM search_brain_cache
        WHERE kind = ${kind}
          AND expires_at > ${now.toISOString()}
          AND embedding IS NOT NULL
        ORDER BY embedding <=> ${vec}::vector ASC
        LIMIT ${limit}
      `)) as { rows?: RawRow[] } | RawRow[] | undefined;
      return getRows(rows).map((r) => ({
        ...rowToStored(r),
        distance: typeof r.distance === "number" ? r.distance : Number(r.distance),
      }));
    },
    async upsert(row) {
      const vec = row.embedding ? embeddingToPg(row.embedding) : null;
      await db.execute(sql/*sql*/`
        INSERT INTO search_brain_cache
          (query_hash, query_text, kind, embedding, payload,
           cached_at, expires_at, ttl_seconds, metadata)
        VALUES
          (${row.queryHash}, ${row.queryText}, ${row.kind},
           ${vec === null ? sql`NULL` : sql`${vec}::vector`},
           ${JSON.stringify(row.payload)}::jsonb,
           ${row.cachedAt.toISOString()},
           ${row.expiresAt.toISOString()},
           ${row.ttlSeconds},
           ${row.metadata ? JSON.stringify(row.metadata) : null}::jsonb)
        ON CONFLICT (query_hash, kind) DO UPDATE SET
          query_text = EXCLUDED.query_text,
          embedding = EXCLUDED.embedding,
          payload = EXCLUDED.payload,
          cached_at = EXCLUDED.cached_at,
          expires_at = EXCLUDED.expires_at,
          ttl_seconds = EXCLUDED.ttl_seconds,
          metadata = EXCLUDED.metadata
      `);
    },
  };
}

interface RawRow {
  query_hash: string;
  kind: string;
  query_text: string;
  embedding: string | null;
  payload: unknown;
  cached_at: string | Date;
  expires_at: string | Date;
  ttl_seconds: number | string;
  metadata: unknown;
  distance?: number | string;
}

function getRows(result: { rows?: RawRow[] } | RawRow[] | undefined): RawRow[] {
  if (!result) return [];
  if (Array.isArray(result)) return result;
  return result.rows ?? [];
}

function rowToStored(r: RawRow): StoredRow {
  return {
    queryHash: String(r.query_hash),
    kind: String(r.kind) as SearchKind,
    queryText: String(r.query_text),
    embedding: r.embedding ? parsePgVector(r.embedding) : null,
    payload: r.payload,
    cachedAt: r.cached_at instanceof Date ? r.cached_at : new Date(r.cached_at),
    expiresAt: r.expires_at instanceof Date ? r.expires_at : new Date(r.expires_at),
    ttlSeconds: typeof r.ttl_seconds === "number" ? r.ttl_seconds : Number(r.ttl_seconds),
    metadata: r.metadata,
  };
}

function embeddingToPg(v: number[]): string {
  return `[${v.join(",")}]`;
}

function parsePgVector(s: string): number[] {
  const trimmed = s.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return [];
  return trimmed.slice(1, -1).split(",").map((x) => Number(x.trim()));
}

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * Look up a cached response. Returns null when neither exact nor
 * semantic paths hit (or when the store is disabled via env).
 *
 * Safe to call when the cache table doesn't exist — errors bubble up
 * to the orchestrator which MUST be wired to treat `null` as "no hit"
 * regardless of reason.
 */
export async function lookup(args: CacheLookupArgs): Promise<CacheHit | null> {
  if (!process.env.DATABASE_URL) return null;
  const store = args.store ?? makeDefaultStore();
  const now = new Date();
  const queryHash = computeQueryHash(args.kind, args.query, args.sources);

  // 1. Exact-hit path.
  try {
    const exact = await store.findExact(queryHash, args.kind, now);
    if (exact) {
      return {
        payload: exact.payload,
        queryHash: exact.queryHash,
        kind: exact.kind,
        matchedBy: "exact",
        cachedAt: exact.cachedAt,
        expiresAt: exact.expiresAt,
        metadata: exact.metadata,
      };
    }
  } catch {
    // Store error — skip cache entirely rather than fail the search.
    return null;
  }

  // 2. Semantic fallback — only when caller supplied an embedding.
  if (!args.embedding || args.embedding.length === 0) return null;
  const threshold = args.similarityThreshold ?? DEFAULT_SEMANTIC_THRESHOLD;
  try {
    const nearest = await store.findNearest(args.embedding, args.kind, now, 5);
    for (const cand of nearest) {
      const similarity = distanceToSimilarity(cand.distance);
      if (similarity >= threshold) {
        return {
          payload: cand.payload,
          queryHash: cand.queryHash,
          kind: cand.kind,
          matchedBy: "semantic",
          similarity,
          cachedAt: cand.cachedAt,
          expiresAt: cand.expiresAt,
          metadata: cand.metadata,
        };
      }
    }
  } catch {
    // Degrade gracefully.
    return null;
  }
  return null;
}

/**
 * Upsert a cache entry. TTL defaults to DEFAULT_TTL_SECONDS for the
 * kind; callers can override (e.g. shorter TTL when the retriever
 * reported many provider errors).
 */
export async function write(args: CacheWriteArgs): Promise<void> {
  if (!process.env.DATABASE_URL) return;
  const store = args.store ?? makeDefaultStore();
  const queryHash = computeQueryHash(args.kind, args.query, args.sources);
  const ttlSeconds = Math.max(60, args.ttlSeconds ?? DEFAULT_TTL_SECONDS[args.kind]);
  const cachedAt = new Date();
  const expiresAt = new Date(cachedAt.getTime() + ttlSeconds * 1000);
  try {
    await store.upsert({
      queryHash,
      kind: args.kind,
      queryText: normaliseQuery(args.query),
      embedding: args.embedding ?? null,
      payload: args.payload,
      cachedAt,
      expiresAt,
      ttlSeconds,
      metadata: args.metadata,
    });
  } catch {
    // Cache write failures are never fatal to the user-facing path.
  }
}

export const SEARCH_CACHE_INTERNAL = {
  normaliseQuery,
  computeQueryHash,
  distanceToSimilarity,
  embeddingToPg,
  parsePgVector,
  rowToStored,
};
