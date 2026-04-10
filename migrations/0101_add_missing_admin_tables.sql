-- Migration 0101: Create missing admin/orchestrator tables found during Phase P1 audit (2026-04-10)
--
-- Context: The Drizzle schemas in shared/schema/admin.ts and shared/schema/orchestrator.ts
-- defined these tables but they were never migrated into the live database, causing
-- 500 errors on /api/admin/releases, /api/orchestrator/runs, /api/orchestrator/stats, and
-- /api/observability/orchestrator. This migration brings the DB in sync with the schema.

-- ── App Releases (admin.ts) ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "app_releases" (
    "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
    "platform" text NOT NULL,
    "version" text NOT NULL,
    "size" text NOT NULL,
    "requirements" text NOT NULL,
    "available" text DEFAULT 'false',
    "file_name" text NOT NULL,
    "download_url" text NOT NULL,
    "note" text,
    "is_active" text DEFAULT 'true',
    "created_at" timestamp NOT NULL DEFAULT now(),
    "updated_at" timestamp NOT NULL DEFAULT now()
);

-- ── Orchestrator Runs (orchestrator.ts) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS "orchestrator_runs" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "objective" text NOT NULL,
    "status" text NOT NULL DEFAULT 'queued',
    "priority" integer NOT NULL DEFAULT 5,
    "budget_limit_usd" double precision,
    "time_limit_ms" integer,
    "concurrency_limit" integer NOT NULL DEFAULT 10,
    "created_by" text NOT NULL,
    "dag_json" jsonb,
    "result_json" jsonb,
    "error" text,
    "total_tasks" integer NOT NULL DEFAULT 0,
    "completed_tasks" integer NOT NULL DEFAULT 0,
    "failed_tasks" integer NOT NULL DEFAULT 0,
    "total_cost_usd" double precision NOT NULL DEFAULT 0,
    "started_at" timestamp,
    "completed_at" timestamp,
    "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "orchestrator_runs_status_idx" ON "orchestrator_runs" ("status");
CREATE INDEX IF NOT EXISTS "orchestrator_runs_created_by_idx" ON "orchestrator_runs" ("created_by");
CREATE INDEX IF NOT EXISTS "orchestrator_runs_created_at_idx" ON "orchestrator_runs" ("created_at" DESC);

-- ── Orchestrator Tasks ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "orchestrator_tasks" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "run_id" uuid NOT NULL,
    "parent_task_id" uuid,
    "agent_role" text NOT NULL,
    "label" text NOT NULL DEFAULT '',
    "status" text NOT NULL DEFAULT 'pending',
    "input_json" jsonb,
    "output_json" jsonb,
    "retry_count" integer NOT NULL DEFAULT 0,
    "max_retries" integer NOT NULL DEFAULT 3,
    "depends_on" text[],
    "risk_level" text NOT NULL DEFAULT 'safe',
    "cost_usd" double precision NOT NULL DEFAULT 0,
    "duration_ms" integer,
    "error" text,
    "created_at" timestamp NOT NULL DEFAULT now(),
    "started_at" timestamp,
    "completed_at" timestamp
);

CREATE INDEX IF NOT EXISTS "orchestrator_tasks_run_id_idx" ON "orchestrator_tasks" ("run_id");
CREATE INDEX IF NOT EXISTS "orchestrator_tasks_status_idx" ON "orchestrator_tasks" ("status");
CREATE INDEX IF NOT EXISTS "orchestrator_tasks_parent_task_id_idx" ON "orchestrator_tasks" ("parent_task_id");

-- ── Orchestrator Approvals ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "orchestrator_approvals" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "task_id" uuid NOT NULL,
    "run_id" uuid NOT NULL,
    "reason" text NOT NULL,
    "status" text NOT NULL DEFAULT 'pending',
    "requested_by" text NOT NULL,
    "decided_by" text,
    "decided_at" timestamp,
    "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "orchestrator_approvals_run_id_idx" ON "orchestrator_approvals" ("run_id");
CREATE INDEX IF NOT EXISTS "orchestrator_approvals_status_idx" ON "orchestrator_approvals" ("status");

-- ── Orchestrator Artifacts ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "orchestrator_artifacts" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "task_id" uuid,
    "run_id" uuid NOT NULL,
    "type" text NOT NULL DEFAULT 'data',
    "name" text NOT NULL,
    "content_json" jsonb,
    "size_bytes" integer NOT NULL DEFAULT 0,
    "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "orchestrator_artifacts_run_id_idx" ON "orchestrator_artifacts" ("run_id");
CREATE INDEX IF NOT EXISTS "orchestrator_artifacts_task_id_idx" ON "orchestrator_artifacts" ("task_id");
