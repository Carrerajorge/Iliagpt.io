-- Fix production auth schema drift
-- Google login expects users.phone_verified

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS phone_verified text DEFAULT 'false';
