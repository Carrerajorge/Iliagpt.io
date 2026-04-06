-- Migration 0024: Add missing indexes to users table + sanitize field lengths
-- These indexes improve query performance for admin/billing/auth lookups.

CREATE INDEX IF NOT EXISTS users_org_id_idx ON users (org_id);
CREATE INDEX IF NOT EXISTS users_role_idx ON users (role);
CREATE INDEX IF NOT EXISTS users_plan_idx ON users (plan);
CREATE INDEX IF NOT EXISTS users_status_idx ON users (status);
CREATE INDEX IF NOT EXISTS users_stripe_customer_idx ON users (stripe_customer_id);
CREATE INDEX IF NOT EXISTS users_stripe_subscription_idx ON users (stripe_subscription_id);
CREATE INDEX IF NOT EXISTS users_auth_provider_idx ON users (auth_provider);

-- Sanitize last_ip and user_agent column types to bounded varchars.
-- Safe: existing values that exceed the length will be truncated in PostgreSQL
-- by the ALTER TYPE, so we first truncate in-place to avoid errors.
UPDATE users SET last_ip = LEFT(last_ip, 64) WHERE last_ip IS NOT NULL AND LENGTH(last_ip) > 64;
UPDATE users SET user_agent = LEFT(user_agent, 512) WHERE user_agent IS NOT NULL AND LENGTH(user_agent) > 512;

ALTER TABLE users
  ALTER COLUMN last_ip TYPE varchar(64),
  ALTER COLUMN user_agent TYPE varchar(512);
