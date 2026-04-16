-- Add confirmation workflow fields to agent_mode_runs

ALTER TABLE "agent_mode_runs"
  ADD COLUMN IF NOT EXISTS "pending_confirmation" jsonb,
  ADD COLUMN IF NOT EXISTS "awaiting_confirmation_since" timestamp,
  ADD COLUMN IF NOT EXISTS "confirmed_step_indices" jsonb;
