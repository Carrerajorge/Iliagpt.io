-- Sync production DB schema with current auth/user expectations.
-- This migration is intentionally idempotent (IF NOT EXISTS) to be safe in prod.

-- Users table columns (added over time in the app; prod may lag behind)
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_verified text DEFAULT 'false';
ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_requests_used integer DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_requests_limit integer DEFAULT 3;
ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_requests_reset_at timestamp;

ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_subscription_id text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_subscription_status text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_subscription_plan text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_subscription_expires_at timestamp;

ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled boolean DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS login_count integer DEFAULT 0;

ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at timestamp;
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_status text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_plan text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_period_end timestamp;
ALTER TABLE users ADD COLUMN IF NOT EXISTS monthly_token_limit integer;
ALTER TABLE users ADD COLUMN IF NOT EXISTS monthly_tokens_used integer;
ALTER TABLE users ADD COLUMN IF NOT EXISTS tokens_reset_at timestamp;
ALTER TABLE users ADD COLUMN IF NOT EXISTS preferences jsonb;
ALTER TABLE users ADD COLUMN IF NOT EXISTS org_id text DEFAULT 'default';
ALTER TABLE users ADD COLUMN IF NOT EXISTS network_access_enabled boolean DEFAULT false;

-- Auth tokens table (server/lib/auth/tokenManager.ts expects this)
CREATE TABLE IF NOT EXISTS auth_tokens (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider varchar(50) NOT NULL,
  access_token text NOT NULL,
  refresh_token text,
  expires_at bigint,
  scope text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT auth_tokens_unique_user_provider UNIQUE (user_id, provider)
);

CREATE INDEX IF NOT EXISTS auth_tokens_user_provider_idx ON auth_tokens (user_id, provider);
