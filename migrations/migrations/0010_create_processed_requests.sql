-- Create processed_requests table used for idempotency in ConversationStateService.
--
-- Production issue (2026-02-06): conversation state append failed with:
--   relation "processed_requests" does not exist
--
-- This migration is idempotent and safe to re-run.

CREATE TABLE IF NOT EXISTS processed_requests (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id varchar(100) NOT NULL UNIQUE,
  state_id varchar NOT NULL REFERENCES conversation_states(id) ON DELETE CASCADE,
  message_id varchar(100),
  processed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS processed_requests_request_idx ON processed_requests(request_id);
CREATE INDEX IF NOT EXISTS processed_requests_state_idx ON processed_requests(state_id);
