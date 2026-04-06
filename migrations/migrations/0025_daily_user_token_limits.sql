-- Migration 0025: Track daily per-user input/output token usage and limits.
-- Safe for existing environments: all new limit fields are nullable (unlimited by default).

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS daily_input_tokens_used integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS daily_output_tokens_used integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS daily_input_tokens_limit integer,
  ADD COLUMN IF NOT EXISTS daily_output_tokens_limit integer,
  ADD COLUMN IF NOT EXISTS daily_token_usage_reset_at timestamp;
