-- Performance Indexes Migration
-- Fix #18: Add missing indexes for production performance
-- Run this migration to add critical performance indexes

-- Chat messages - most frequently queried table
CREATE INDEX IF NOT EXISTS idx_chat_messages_chat_id ON chat_messages(chat_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON chat_messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_chat_created ON chat_messages(chat_id, created_at DESC);

-- Chats - user lookup optimization
CREATE INDEX IF NOT EXISTS idx_chats_user_id ON chats(user_id);
CREATE INDEX IF NOT EXISTS idx_chats_created_at ON chats(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chats_user_created ON chats(user_id, created_at DESC);

-- Users - email and status lookup
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- AI Models - provider and status filtering
CREATE INDEX IF NOT EXISTS idx_ai_models_provider ON ai_models(provider);
CREATE INDEX IF NOT EXISTS idx_ai_models_enabled ON ai_models(is_enabled) WHERE is_enabled = 'true';

-- Audit Logs - time-based queries
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);

-- Files - user and chat lookup
CREATE INDEX IF NOT EXISTS idx_files_user_id ON files(user_id);
CREATE INDEX IF NOT EXISTS idx_files_chat_id ON files(chat_id);
CREATE INDEX IF NOT EXISTS idx_files_uploaded_at ON files(uploaded_at DESC);

-- Conversation Documents - chat lookup
CREATE INDEX IF NOT EXISTS idx_conversation_documents_chat_id ON conversation_documents(chat_id);

-- GPTs (custom assistants) - user and visibility
CREATE INDEX IF NOT EXISTS idx_gpts_user_id ON gpts(user_id);
CREATE INDEX IF NOT EXISTS idx_gpts_visibility ON gpts(visibility);

-- Projects - user lookup
CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id);
CREATE INDEX IF NOT EXISTS idx_projects_created_at ON projects(created_at DESC);

-- Sessions - lookup optimization
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

-- Memories - user and project
CREATE INDEX IF NOT EXISTS idx_memories_user_id ON memories(user_id);
CREATE INDEX IF NOT EXISTS idx_memories_project_id ON memories(project_id);

-- Analytics snapshots - time-based
CREATE INDEX IF NOT EXISTS idx_analytics_snapshots_created_at ON analytics_snapshots(created_at DESC);

-- Usage logs - user and date
CREATE INDEX IF NOT EXISTS idx_usage_logs_user_id ON usage_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_usage_logs_created_at ON usage_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_logs_user_date ON usage_logs(user_id, created_at DESC);

COMMENT ON INDEX idx_chat_messages_chat_id IS 'Performance index for chat message lookups';
COMMENT ON INDEX idx_users_email IS 'Unique user email lookup optimization';
COMMENT ON INDEX idx_audit_logs_created_at IS 'Time-series audit log queries';
