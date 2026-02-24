CREATE TABLE IF NOT EXISTS channel_conversations (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel TEXT NOT NULL,
    channel_key TEXT NOT NULL,
    external_conversation_id TEXT NOT NULL,
    chat_id VARCHAR NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    is_active BOOLEAN NOT NULL DEFAULT true,
    metadata JSONB,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS channel_conversations_unique_idx
    ON channel_conversations(channel, channel_key, external_conversation_id);

CREATE INDEX IF NOT EXISTS channel_conversations_user_idx ON channel_conversations(user_id);
CREATE INDEX IF NOT EXISTS channel_conversations_chat_idx ON channel_conversations(chat_id);
CREATE INDEX IF NOT EXISTS channel_conversations_channel_idx ON channel_conversations(channel);

CREATE TABLE IF NOT EXISTS channel_pairing_codes (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel TEXT NOT NULL,
    code VARCHAR(64) NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    consumed_at TIMESTAMP,
    consumed_by_external_id TEXT,
    metadata JSONB,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS channel_pairing_codes_code_unique_idx
    ON channel_pairing_codes(code);

CREATE INDEX IF NOT EXISTS channel_pairing_codes_user_idx ON channel_pairing_codes(user_id);
CREATE INDEX IF NOT EXISTS channel_pairing_codes_channel_idx ON channel_pairing_codes(channel);
CREATE INDEX IF NOT EXISTS channel_pairing_codes_expires_idx ON channel_pairing_codes(expires_at);

