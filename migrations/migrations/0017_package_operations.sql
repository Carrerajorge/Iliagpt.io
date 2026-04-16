-- SQLite-compatible schema for planned package operations audit log.
CREATE TABLE IF NOT EXISTS package_operations (
    id TEXT PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
    package_name TEXT NOT NULL,
    manager TEXT NOT NULL,
    action TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'planned',
    os_family TEXT,
    os_distro TEXT,
    command TEXT,
    policy_decision TEXT,
    policy_warnings JSONB DEFAULT '[]'::jsonb,
    requested_by TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_package_ops_status ON package_operations(status);
CREATE INDEX IF NOT EXISTS idx_package_ops_manager ON package_operations(manager);
