-- Workspace invitations for adding members by email

CREATE TABLE IF NOT EXISTS "workspace_invitations" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" text NOT NULL,
  "email" text NOT NULL,
  "invited_by_user_id" varchar REFERENCES "users"("id") ON DELETE SET NULL,
  "role" text NOT NULL DEFAULT 'team_member',
  "status" text NOT NULL DEFAULT 'pending',
  "created_at" timestamp NOT NULL DEFAULT now(),
  "last_sent_at" timestamp,
  "accepted_at" timestamp,
  "revoked_at" timestamp
);

CREATE INDEX IF NOT EXISTS "workspace_invitations_org_idx" ON "workspace_invitations" ("org_id");
CREATE INDEX IF NOT EXISTS "workspace_invitations_email_idx" ON "workspace_invitations" ("email");
CREATE INDEX IF NOT EXISTS "workspace_invitations_status_idx" ON "workspace_invitations" ("status");

CREATE UNIQUE INDEX IF NOT EXISTS "workspace_invitations_org_email_unique"
  ON "workspace_invitations" ("org_id", "email");
