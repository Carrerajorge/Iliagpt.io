-- Add missing column used by shared/schema/admin.ts
-- Keeps backward compatibility with last_sync_at
ALTER TABLE "ai_models" ADD COLUMN IF NOT EXISTS "last_synced_at" timestamp;
