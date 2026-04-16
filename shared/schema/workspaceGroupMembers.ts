import { sql } from "drizzle-orm";
import { pgTable, varchar, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";

import { users } from "./auth";
import { workspaceGroups } from "./workspaceGroups";

export const workspaceGroupMembers = pgTable(
  "workspace_group_members",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    groupId: varchar("group_id").notNull().references(() => workspaceGroups.id, { onDelete: "cascade" }),
    userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table: any) => [
    index("workspace_group_members_group_idx").on(table.groupId),
    index("workspace_group_members_user_idx").on(table.userId),
    uniqueIndex("workspace_group_members_group_user_unique").on(table.groupId, table.userId),
  ]
);

export type WorkspaceGroupMember = typeof workspaceGroupMembers.$inferSelect;
export type InsertWorkspaceGroupMember = typeof workspaceGroupMembers.$inferInsert;

