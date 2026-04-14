CREATE TABLE IF NOT EXISTS custom_agents (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR NOT NULL,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  avatar_emoji VARCHAR(10) DEFAULT '🤖',
  system_prompt TEXT NOT NULL,
  model VARCHAR(100) DEFAULT 'auto',
  temperature REAL DEFAULT 0.7,
  tools JSONB DEFAULT '["chat"]',
  knowledge_files JSONB DEFAULT '[]',
  conversation_starters JSONB DEFAULT '[]',
  is_public BOOLEAN DEFAULT false,
  category VARCHAR(50),
  usage_count INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_custom_agents_user ON custom_agents(user_id);
CREATE INDEX IF NOT EXISTS idx_custom_agents_public ON custom_agents(is_public) WHERE is_public = true;
CREATE INDEX IF NOT EXISTS idx_custom_agents_category ON custom_agents(category);
