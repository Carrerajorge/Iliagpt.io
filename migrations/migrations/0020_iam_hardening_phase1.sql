-- =============================================================================
-- Migration 0020: IAM Hardening Phase 1
-- Email canonicalization, provider identity linking, enriched audit events
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Email Canonicalization
-- ---------------------------------------------------------------------------

-- Add canonical email column
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_canonical TEXT;

-- Backfill existing rows
UPDATE users SET email_canonical = LOWER(TRIM(email))
WHERE email IS NOT NULL AND email_canonical IS NULL;

-- UNIQUE index on canonical email (partial: allow NULL for anon/phone-only users)
CREATE UNIQUE INDEX IF NOT EXISTS users_email_canonical_unique_idx
  ON users (email_canonical)
  WHERE email_canonical IS NOT NULL;

-- Trigger to auto-populate email_canonical on INSERT/UPDATE
CREATE OR REPLACE FUNCTION canonicalize_email() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.email IS NOT NULL THEN
    NEW.email_canonical := LOWER(TRIM(NEW.email));
  ELSE
    NEW.email_canonical := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_canonicalize_email ON users;
CREATE TRIGGER trg_canonicalize_email
  BEFORE INSERT OR UPDATE OF email ON users
  FOR EACH ROW EXECUTE FUNCTION canonicalize_email();


-- ---------------------------------------------------------------------------
-- 2. Provider Identity Linking Table
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS user_identities (
  id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_subject TEXT NOT NULL,
  provider_email TEXT,
  email_verified BOOLEAN DEFAULT false,
  metadata JSONB,
  linked_at TIMESTAMP DEFAULT NOW() NOT NULL,
  last_used_at TIMESTAMP
);

-- One identity per (provider, subject) — prevents duplicate linking
CREATE UNIQUE INDEX IF NOT EXISTS user_identities_provider_subject_idx
  ON user_identities(provider, provider_subject);

CREATE INDEX IF NOT EXISTS user_identities_user_idx ON user_identities(user_id);
CREATE INDEX IF NOT EXISTS user_identities_provider_idx ON user_identities(provider);

-- Backfill existing users: create an identity record from current auth_provider
INSERT INTO user_identities (user_id, provider, provider_subject, provider_email, email_verified)
SELECT
  id,
  COALESCE(auth_provider, 'email'),
  id,  -- use user.id as the initial provider_subject (will be overwritten on next OAuth login)
  email,
  (email_verified = 'true')
FROM users
WHERE NOT EXISTS (
  SELECT 1 FROM user_identities WHERE user_id = users.id
)
ON CONFLICT DO NOTHING;


-- ---------------------------------------------------------------------------
-- 3. Enriched Audit Log Columns
-- ---------------------------------------------------------------------------

ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS correlation_id VARCHAR;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS trace_id VARCHAR;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS outcome TEXT;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS severity TEXT DEFAULT 'info';
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS sequence_number BIGINT;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS previous_hash TEXT;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS record_hash TEXT;

-- Sequence for monotonic hash-chain numbering (Phase 3 uses this)
CREATE SEQUENCE IF NOT EXISTS audit_log_seq;

-- Indexes for new columns
CREATE INDEX IF NOT EXISTS audit_logs_correlation_idx ON audit_logs(correlation_id);
CREATE INDEX IF NOT EXISTS audit_logs_outcome_idx ON audit_logs(outcome);
CREATE INDEX IF NOT EXISTS audit_logs_severity_idx ON audit_logs(severity);
CREATE INDEX IF NOT EXISTS audit_logs_category_idx ON audit_logs(category);
CREATE INDEX IF NOT EXISTS audit_logs_sequence_idx ON audit_logs(sequence_number);
CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx ON audit_logs(created_at);


-- ---------------------------------------------------------------------------
-- 4. Break-Glass Accounts Table (Phase 2 — schema created now for forward compat)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS break_glass_accounts (
  id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(255) NOT NULL REFERENCES users(id) UNIQUE,
  password_hash TEXT NOT NULL,
  password_rotated_at TIMESTAMP DEFAULT NOW() NOT NULL,
  password_expires_at TIMESTAMP,
  mfa_required BOOLEAN DEFAULT true NOT NULL,
  allowed_cidrs TEXT[],
  max_session_duration_min INTEGER DEFAULT 60,
  last_used_at TIMESTAMP,
  usage_count INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL
);
