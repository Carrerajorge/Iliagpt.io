-- Workspace groups + members

CREATE TABLE IF NOT EXISTS "workspace_groups" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" text NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "created_by_user_id" varchar REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "workspace_groups_org_idx" ON "workspace_groups" ("org_id");
CREATE INDEX IF NOT EXISTS "workspace_groups_updated_idx" ON "workspace_groups" ("updated_at");
CREATE UNIQUE INDEX IF NOT EXISTS "workspace_groups_org_name_unique" ON "workspace_groups" ("org_id", "name");

CREATE TABLE IF NOT EXISTS "workspace_group_members" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "group_id" varchar NOT NULL REFERENCES "workspace_groups"("id") ON DELETE CASCADE,
  "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "workspace_group_members_group_idx" ON "workspace_group_members" ("group_id");
CREATE INDEX IF NOT EXISTS "workspace_group_members_user_idx" ON "workspace_group_members" ("user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "workspace_group_members_group_user_unique" ON "workspace_group_members" ("group_id", "user_id");

