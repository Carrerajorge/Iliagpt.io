-- Migration 0105: Create per-user SearchBrain settings table
--
-- Context: Replaces the Phase 1b in-memory settings store with a
-- persistent row. Keyed by user_id so each user has at most one
-- settings record; /api/search-brain/settings performs UPSERT-style
-- writes (INSERT ... ON CONFLICT (user_id) DO UPDATE).
--
-- No FK to users(id) on purpose — the broader codebase has multiple
-- representations of user identity (Replit Auth, anon tokens, API
-- keys) and we don't want a cache-adjacent table to block migrations
-- on a foreign-key lifecycle. If a row survives past its user's
-- tenancy, it's just dead state with no access path.

CREATE TABLE IF NOT EXISTS "user_search_brain_settings" (
    "user_id" varchar PRIMARY KEY,
    "mailto" text,
    "core_api_key" text,
    "enable_scraping_providers" boolean NOT NULL DEFAULT false,
    "updated_at" timestamp NOT NULL DEFAULT now()
);

-- Recently-updated scans (admin ops, audit) benefit from an index.
CREATE INDEX IF NOT EXISTS "user_search_brain_settings_updated_at_idx"
    ON "user_search_brain_settings" ("updated_at");
