-- Migration 0003: align active runtime migrations with GPT definition/versioning schema.
-- Mirrors migrations/migrations/0019_gpt_definition_versioning.sql so environments
-- using the root ./migrations path also receive these columns.

ALTER TABLE public.gpts
  ADD COLUMN IF NOT EXISTS definition jsonb,
  ADD COLUMN IF NOT EXISTS runtime_policy jsonb,
  ADD COLUMN IF NOT EXISTS tool_permissions jsonb,
  ADD COLUMN IF NOT EXISTS recommended_model text;

ALTER TABLE public.gpt_versions
  ADD COLUMN IF NOT EXISTS definition_snapshot jsonb;

ALTER TABLE public.gpt_actions
  ADD COLUMN IF NOT EXISTS open_api_spec jsonb,
  ADD COLUMN IF NOT EXISTS operation_id text,
  ADD COLUMN IF NOT EXISTS request_schema jsonb,
  ADD COLUMN IF NOT EXISTS response_schema jsonb,
  ADD COLUMN IF NOT EXISTS domain_allowlist jsonb,
  ADD COLUMN IF NOT EXISTS pii_redaction_rules jsonb;
