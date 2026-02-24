CREATE TABLE IF NOT EXISTS remote_shell_targets (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    host TEXT NOT NULL,
    port INTEGER DEFAULT 22,
    username TEXT NOT NULL,
    auth_type TEXT NOT NULL,
    encrypted_secret TEXT NOT NULL,
    secret_hint TEXT,
    owner_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    allowed_admin_ids TEXT[] DEFAULT ARRAY[]::TEXT[],
    notes TEXT,
    last_connected_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS remote_shell_targets_owner_idx ON remote_shell_targets(owner_id);
CREATE INDEX IF NOT EXISTS remote_shell_targets_host_idx ON remote_shell_targets(host);
CREATE INDEX IF NOT EXISTS remote_shell_targets_created_idx ON remote_shell_targets(created_at);
