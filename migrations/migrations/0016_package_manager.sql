CREATE TABLE IF NOT EXISTS installed_packages (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
    manager VARCHAR NOT NULL, -- 'npm', 'pip', 'apt', 'docker'
    name VARCHAR NOT NULL,
    version VARCHAR,
    status VARCHAR DEFAULT 'installed', -- 'installed', 'removed', 'failed'
    installed_at TIMESTAMP DEFAULT NOW(),
    installed_by VARCHAR REFERENCES users(id),
    metadata JSONB,
    UNIQUE(manager, name)
);

CREATE TABLE IF NOT EXISTS package_logs (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
    package_id VARCHAR REFERENCES installed_packages(id),
    action VARCHAR NOT NULL, -- 'install', 'uninstall', 'update'
    output TEXT, -- stdout/stderr del comando
    performed_at TIMESTAMP DEFAULT NOW(),
    performed_by VARCHAR REFERENCES users(id),
    success BOOLEAN DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_packages_manager ON installed_packages(manager);
