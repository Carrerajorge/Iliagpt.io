-- Migration 0104: Create SearchBrain cache table
--
-- Context: Backs the WebGLM-inspired SearchBrain module
-- (server/services/searchBrain/). Stores the full response payload of
-- academic / web / deep searches keyed by (query_hash, kind), plus an
-- embedding column for semantic reuse across near-duplicate queries.
--
-- Exact-hit path:  SELECT ... WHERE query_hash = $1 AND kind = $2 AND expires_at > now()
-- Semantic path:   SELECT ... ORDER BY embedding <=> $1 LIMIT 5
--                  (filtered by kind + expires_at, cosine-similarity ≥ 0.92 gate applied
--                   client-side so we can tune the threshold without a migration)
--
-- pgvector extension is bootstrapped in `scripts/db/ensure-extensions.ts`
-- before migrations run. This migration just references the `vector` type.

CREATE TABLE IF NOT EXISTS "search_brain_cache" (
    "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
    "query_hash" text NOT NULL,
    "query_text" text NOT NULL,
    "kind" text NOT NULL,
    "embedding" vector(1536),
    "payload" jsonb NOT NULL,
    "cached_at" timestamp NOT NULL DEFAULT now(),
    "ttl_seconds" integer NOT NULL,
    "expires_at" timestamp NOT NULL,
    "metadata" jsonb
);

-- Exact-hit lookup — unique so a second write for the same query/kind
-- replaces (upsert) rather than duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS "search_brain_cache_hash_kind_idx"
    ON "search_brain_cache" ("query_hash", "kind");

-- Cleanup scans + WHERE expires_at > now() filters.
CREATE INDEX IF NOT EXISTS "search_brain_cache_expires_at_idx"
    ON "search_brain_cache" ("expires_at");

-- Kind-bucketed browsing / admin queries.
CREATE INDEX IF NOT EXISTS "search_brain_cache_kind_idx"
    ON "search_brain_cache" ("kind");

-- Approximate-nearest-neighbour index on the embedding. ivfflat with
-- cosine distance matches the query-time operator (<=>) we use in the
-- semantic fallback. lists=100 is a safe default for tables up to ~1M
-- rows; tune once the table actually grows.
CREATE INDEX IF NOT EXISTS "search_brain_cache_embedding_idx"
    ON "search_brain_cache"
    USING ivfflat ("embedding" vector_cosine_ops)
    WITH (lists = 100);
