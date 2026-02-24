import { sql } from "drizzle-orm";
import { pgTable, text, timestamp, index, uniqueIndex, varchar } from "drizzle-orm/pg-core";

// Custom roles (per org/workspace) with a permission allow-list.
// Role assignments are stored as `custom:<id>` in `users.role` and `workspace_invitations.role`.
export const workspaceRoles = pgTable(
  "workspace_roles",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    orgId: text("org_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    permissions: text("permissions").array().default([]).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table: any) => [
    index("workspace_roles_org_idx").on(table.orgId),
    index("workspace_roles_updated_idx").on(table.updatedAt),
    uniqueIndex("workspace_roles_org_name_unique").on(table.orgId, table.name),
  ]
);

export type WorkspaceRole = typeof workspaceRoles.$inferSelect;
export type InsertWorkspaceRole = typeof workspaceRoles.$inferInsert;

