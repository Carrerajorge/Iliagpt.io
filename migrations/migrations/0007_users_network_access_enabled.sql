-- Fix production auth schema drift
-- Google login expects users.network_access_enabled

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS network_access_enabled boolean DEFAULT false;
