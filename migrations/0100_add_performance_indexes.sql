-- Performance indexes for common query patterns
-- These are CREATE INDEX IF NOT EXISTS to be idempotent

CREATE INDEX IF NOT EXISTS idx_chat_messages_chat_created
  ON chat_messages(chat_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_chats_user_updated
  ON chats(user_id, updated_at DESC);

-- Sessions table uses "expire" column (not expires_at) and has no user_id
CREATE INDEX IF NOT EXISTS idx_sessions_expire
  ON sessions(expire);

-- Soft delete support
-- Note: chats.deleted_at already exists in the schema
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_chat_messages_not_deleted
  ON chat_messages(chat_id, created_at DESC) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_chats_not_deleted
  ON chats(user_id, updated_at DESC) WHERE deleted_at IS NULL;
