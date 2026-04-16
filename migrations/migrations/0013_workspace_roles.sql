-- Workspace custom roles for per-org permissions

CREATE TABLE IF NOT EXISTS "workspace_roles" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" text NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "permissions" text[] NOT NULL DEFAULT '{}',
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "workspace_roles_org_idx" ON "workspace_roles" ("org_id");
CREATE INDEX IF NOT EXISTS "workspace_roles_updated_idx" ON "workspace_roles" ("updated_at");

CREATE UNIQUE INDEX IF NOT EXISTS "workspace_roles_org_name_unique"
  ON "workspace_roles" ("org_id", "name");
