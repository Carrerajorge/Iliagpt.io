-- Performance indices migration
-- Created: 2025-12-28
-- Purpose: Add indices for frequently queried fields to improve query performance

-- =============================================
-- chat_messages table indices
-- =============================================
CREATE INDEX IF NOT EXISTS idx_chat_messages_chat_id ON chat_messages(chat_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON chat_messages(created_at);

-- =============================================
-- chats table indices
-- =============================================
CREATE INDEX IF NOT EXISTS idx_chats_user_id ON chats(user_id);
CREATE INDEX IF NOT EXISTS idx_chats_user_archived_deleted ON chats(user_id, archived, deleted_at);
CREATE INDEX IF NOT EXISTS idx_chats_updated_at ON chats(updated_at);

-- =============================================
-- ai_models table indices
-- =============================================
CREATE INDEX IF NOT EXISTS idx_ai_models_provider ON ai_models(provider);
CREATE INDEX IF NOT EXISTS idx_ai_models_status ON ai_models(status);
CREATE INDEX IF NOT EXISTS idx_ai_models_model_type ON ai_models(model_type);

-- =============================================
-- files table indices
-- =============================================
CREATE INDEX IF NOT EXISTS idx_files_user_id ON files(user_id);
CREATE INDEX IF NOT EXISTS idx_files_status ON files(status);

-- =============================================
-- agent_runs table indices
-- Note: Using conversation_id as the chat reference column
-- =============================================
CREATE INDEX IF NOT EXISTS idx_agent_runs_conversation_id ON agent_runs(conversation_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_status ON agent_runs(status);

-- =============================================
-- tool_invocations table indices
-- =============================================
CREATE INDEX IF NOT EXISTS idx_tool_invocations_run_id ON tool_invocations(run_id);
