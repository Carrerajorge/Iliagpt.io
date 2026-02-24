import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";

import { users } from "./auth";

export const workspaceGroups = pgTable(
  "workspace_groups",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    orgId: text("org_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    createdByUserId: varchar("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table: any) => [
    index("workspace_groups_org_idx").on(table.orgId),
    index("workspace_groups_updated_idx").on(table.updatedAt),
    uniqueIndex("workspace_groups_org_name_unique").on(table.orgId, table.name),
  ]
);

export type WorkspaceGroup = typeof workspaceGroups.$inferSelect;
export type InsertWorkspaceGroup = typeof workspaceGroups.$inferInsert;

