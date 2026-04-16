-- Add per-user attribution to Agentic Engine gap logs.
-- This enables filtering gaps by account and avoids cross-user frequency merging.

ALTER TABLE IF EXISTS "agent_gap_logs" ADD COLUMN IF NOT EXISTS "user_id" varchar;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'agent_gap_logs_user_id_users_id_fk'
      AND table_schema = 'public'
      AND table_name = 'agent_gap_logs'
  ) THEN
    ALTER TABLE "agent_gap_logs"
      ADD CONSTRAINT "agent_gap_logs_user_id_users_id_fk"
      FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
      ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "agent_gap_logs_user_id_idx" ON "agent_gap_logs" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_gap_logs_user_status_idx" ON "agent_gap_logs" USING btree ("user_id","status");
