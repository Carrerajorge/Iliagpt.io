import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  varchar,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { users } from "./auth";

// Workspace member invitations (inviting by email into an org/workspace)
export const workspaceInvitations = pgTable(
  "workspace_invitations",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    orgId: text("org_id").notNull(),
    email: text("email").notNull(),
    invitedByUserId: varchar("invited_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    role: text("role").notNull().default("team_member"),
    status: text("status").notNull().default("pending"), // pending | accepted | revoked
    createdAt: timestamp("created_at").defaultNow().notNull(),
    lastSentAt: timestamp("last_sent_at"),
    acceptedAt: timestamp("accepted_at"),
    revokedAt: timestamp("revoked_at"),
  },
  (table: any) => [
    index("workspace_invitations_org_idx").on(table.orgId),
    index("workspace_invitations_email_idx").on(table.email),
    index("workspace_invitations_status_idx").on(table.status),
    // Single invitation record per email in an org; status drives the lifecycle (pending/accepted/revoked).
    uniqueIndex("workspace_invitations_org_email_unique").on(table.orgId, table.email),
  ]
);

export type WorkspaceInvitation = typeof workspaceInvitations.$inferSelect;
export type InsertWorkspaceInvitation = typeof workspaceInvitations.$inferInsert;
