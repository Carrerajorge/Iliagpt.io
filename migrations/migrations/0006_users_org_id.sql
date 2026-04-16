-- Fix production auth schema drift
-- Google login expects users.org_id (multi-tenant v2)

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS org_id text DEFAULT 'default';
