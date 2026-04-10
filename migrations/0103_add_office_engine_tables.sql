-- Migration 0103: Create Office Engine tables (DOCX vertical slice)
--
-- Context: Backs the native document-engineering pipeline
-- (unpack → parse → map → edit → validate → repack → round-trip diff → preview → export)
-- implemented under server/lib/office/. Runs are sandboxed by run_id under
-- $TMPDIR/office-engine/<run_id>/ and support idempotent retries keyed by
-- (input_checksum, objective_hash) on succeeded rows.

-- ── Office Engine Runs ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "office_engine_runs" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "conversation_id" uuid,
    "user_id" text NOT NULL,
    "workspace_id" text,
    "objective" text NOT NULL,
    "objective_hash" text NOT NULL,
    "doc_kind" text NOT NULL,
    "input_checksum" text NOT NULL,
    "input_name" text,
    "input_size" integer,
    "sandbox_path" text NOT NULL,
    "status" text NOT NULL DEFAULT 'pending',
    "fallback_level" integer NOT NULL DEFAULT 0,
    "retry_of_run_id" uuid,
    "error_code" text,
    "error_message" text,
    "started_at" timestamptz,
    "completed_at" timestamptz,
    "duration_ms" integer,
    "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "office_engine_runs_conv_idx"
    ON "office_engine_runs" ("conversation_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "office_engine_runs_status_idx"
    ON "office_engine_runs" ("status");
CREATE UNIQUE INDEX IF NOT EXISTS "office_engine_runs_idempotency_idx"
    ON "office_engine_runs" ("input_checksum", "objective_hash")
    WHERE "status" = 'succeeded';

-- ── Office Engine Steps ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "office_engine_steps" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "run_id" uuid NOT NULL REFERENCES "office_engine_runs"("id") ON DELETE CASCADE,
    "seq" integer NOT NULL,
    "stage" text NOT NULL,
    "step_type" text NOT NULL,
    "title" text NOT NULL,
    "status" text NOT NULL DEFAULT 'running',
    "started_at" timestamptz NOT NULL DEFAULT now(),
    "duration_ms" integer,
    "input_digest" text,
    "output_digest" text,
    "log" jsonb NOT NULL DEFAULT '[]'::jsonb,
    "diff" jsonb,
    "error" jsonb
);

CREATE INDEX IF NOT EXISTS "office_engine_steps_run_idx"
    ON "office_engine_steps" ("run_id", "seq");
CREATE INDEX IF NOT EXISTS "office_engine_steps_stage_idx"
    ON "office_engine_steps" ("run_id", "stage");

-- ── Office Engine Artifacts ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "office_engine_artifacts" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "run_id" uuid NOT NULL REFERENCES "office_engine_runs"("id") ON DELETE CASCADE,
    "parent_artifact_id" uuid,
    "kind" text NOT NULL,
    "path" text NOT NULL,
    "mime_type" text NOT NULL,
    "size_bytes" integer NOT NULL DEFAULT 0,
    "checksum_sha256" text NOT NULL,
    "version_label" text NOT NULL DEFAULT 'v1',
    "zip_entry_count" integer,
    "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "office_engine_artifacts_run_kind_idx"
    ON "office_engine_artifacts" ("run_id", "kind");
CREATE INDEX IF NOT EXISTS "office_engine_artifacts_checksum_idx"
    ON "office_engine_artifacts" ("checksum_sha256");
