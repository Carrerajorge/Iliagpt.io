-- Automation Triggers: persistent triggers that survive restarts
-- Supports: cron, file_watch, webhook, email, calendar, system_event, one_shot

CREATE TABLE IF NOT EXISTS automation_triggers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       TEXT NOT NULL,
  name          TEXT NOT NULL,
  description   TEXT,
  kind          TEXT NOT NULL CHECK (kind IN ('cron', 'file_watch', 'webhook', 'email', 'calendar', 'system_event', 'one_shot')),
  is_active     BOOLEAN NOT NULL DEFAULT true,
  config        JSONB NOT NULL,
  action        JSONB NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_run_at   TIMESTAMPTZ,
  last_run_status TEXT CHECK (last_run_status IN ('success', 'error')),
  last_run_error TEXT,
  run_count     INTEGER NOT NULL DEFAULT 0,
  error_count   INTEGER NOT NULL DEFAULT 0,
  max_runs      INTEGER
);

CREATE INDEX IF NOT EXISTS idx_automation_triggers_user ON automation_triggers(user_id);
CREATE INDEX IF NOT EXISTS idx_automation_triggers_active ON automation_triggers(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_automation_triggers_kind ON automation_triggers(kind);

-- Trigger execution log for audit trail
CREATE TABLE IF NOT EXISTS trigger_executions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger_id    UUID NOT NULL REFERENCES automation_triggers(id) ON DELETE CASCADE,
  fired_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status        TEXT NOT NULL CHECK (status IN ('success', 'error', 'running')),
  action_kind   TEXT NOT NULL,
  result        TEXT,
  error         TEXT,
  duration_ms   INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_trigger_executions_trigger ON trigger_executions(trigger_id);
CREATE INDEX IF NOT EXISTS idx_trigger_executions_fired ON trigger_executions(fired_at DESC);

-- Voice sessions table for voice/audio feature
CREATE TABLE IF NOT EXISTS voice_sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       TEXT NOT NULL,
  chat_id       TEXT,
  status        TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'listening', 'processing', 'speaking')),
  tts_provider  TEXT DEFAULT 'system' CHECK (tts_provider IN ('system', 'elevenlabs', 'openai')),
  stt_provider  TEXT DEFAULT 'whisper' CHECK (stt_provider IN ('whisper', 'deepgram', 'system')),
  voice_id      TEXT,
  language      TEXT DEFAULT 'es',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Analytics: cost tracking per model per user
CREATE TABLE IF NOT EXISTS model_usage_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       TEXT NOT NULL,
  chat_id       TEXT,
  model         TEXT NOT NULL,
  provider      TEXT NOT NULL,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens  INTEGER NOT NULL DEFAULT 0,
  cost_usd      NUMERIC(10, 6) NOT NULL DEFAULT 0,
  latency_ms    INTEGER,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_model_usage_user ON model_usage_log(user_id);
CREATE INDEX IF NOT EXISTS idx_model_usage_model ON model_usage_log(model);
CREATE INDEX IF NOT EXISTS idx_model_usage_date ON model_usage_log(created_at DESC);

-- Multi-agent collaboration tracking
CREATE TABLE IF NOT EXISTS agent_delegations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_agent_id TEXT NOT NULL,
  child_agent_id  TEXT NOT NULL,
  task            TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  result          TEXT,
  error           TEXT,
  context         JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ,
  timeout_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_agent_delegations_parent ON agent_delegations(parent_agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_delegations_status ON agent_delegations(status);
