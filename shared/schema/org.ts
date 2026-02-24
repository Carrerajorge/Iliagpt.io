import { pgTable, text, boolean, timestamp, index } from "drizzle-orm/pg-core";

// Organization/workspace settings (single-tenant compatible: default orgId="default")
export const orgSettings = pgTable(
  "org_settings",
  {
    orgId: text("org_id").primaryKey(),
    networkAccessEnabled: boolean("network_access_enabled").default(false).notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table: any) => [index("org_settings_network_idx").on(table.networkAccessEnabled)]
);

export type OrgSettings = typeof orgSettings.$inferSelect;
