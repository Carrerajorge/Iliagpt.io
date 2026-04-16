-- Share chats to workspace groups (grants access to all members of a group)

CREATE TABLE IF NOT EXISTS "chat_group_shares" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "chat_id" varchar NOT NULL REFERENCES "chats"("id") ON DELETE CASCADE,
  "group_id" varchar NOT NULL REFERENCES "workspace_groups"("id") ON DELETE CASCADE,
  "role" text NOT NULL DEFAULT 'viewer',
  "invited_by" varchar,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "chat_group_shares_chat_idx" ON "chat_group_shares" ("chat_id");
CREATE INDEX IF NOT EXISTS "chat_group_shares_group_idx" ON "chat_group_shares" ("group_id");
CREATE UNIQUE INDEX IF NOT EXISTS "chat_group_shares_chat_group_unique"
  ON "chat_group_shares" ("chat_id", "group_id");

