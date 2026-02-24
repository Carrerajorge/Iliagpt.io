import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const workspaces = pgTable(
  "workspaces",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    orgId: text("org_id").notNull(),
    name: text("name").notNull(),
    logoFileUuid: text("logo_file_uuid"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table: any) => [
    index("workspaces_org_idx").on(table.orgId),
    index("workspaces_updated_idx").on(table.updatedAt),
  ]
);

export type Workspace = typeof workspaces.$inferSelect;
