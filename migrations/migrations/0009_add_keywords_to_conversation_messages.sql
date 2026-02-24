
-- Adds missing keywords column required by conversation memory hydration.

-- Idempotent for safe re-runs.

ALTER TABLE conversation_messages

  ADD COLUMN IF NOT EXISTS keywords text[] DEFAULT '{}'::text[];

