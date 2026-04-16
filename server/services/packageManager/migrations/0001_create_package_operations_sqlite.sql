-- REQ-002 / Phase 1
-- SQLite migration for audit log of planned/executed package operations.
-- NOTE: Phase 1 does NOT execute this migration.

CREATE TABLE IF NOT EXISTS package_operations (
  id TEXT PRIMARY KEY,
  package_name TEXT NOT NULL,
  manager TEXT NOT NULL,
  action TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned',
  os_family TEXT,
  os_distro TEXT,
  command TEXT,
  policy_decision TEXT,
  policy_warnings TEXT, -- JSON string
  requested_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS package_operations_created_at_idx ON package_operations(created_at);
CREATE INDEX IF NOT EXISTS package_operations_requested_by_idx ON package_operations(requested_by);
