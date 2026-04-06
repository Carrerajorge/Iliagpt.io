-- Migration 0002: Track daily per-user input/output token usage and limits.
-- Mirrors migrations/migrations/0025_daily_user_token_limits.sql so the active
-- runtime migration path also applies these columns.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS daily_input_tokens_used integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS daily_output_tokens_used integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS daily_input_tokens_limit integer,
  ADD COLUMN IF NOT EXISTS daily_output_tokens_limit integer,
  ADD COLUMN IF NOT EXISTS daily_token_usage_reset_at timestamp;
