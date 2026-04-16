import { sql } from "drizzle-orm";
import { boolean, index, jsonb, pgTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";

import { users } from "./auth";

// IAM hardening: provider identity linking table (migration 0020)
export const userIdentities = pgTable(
  "user_identities",
  {
    id: varchar("id", { length: 255 }).primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    providerSubject: text("provider_subject").notNull(),
    providerEmail: text("provider_email"),
    emailVerified: boolean("email_verified").default(false),
    metadata: jsonb("metadata"),
    linkedAt: timestamp("linked_at").defaultNow().notNull(),
    lastUsedAt: timestamp("last_used_at"),
  },
  (table: any) => [
    uniqueIndex("user_identities_provider_subject_idx").on(table.provider, table.providerSubject),
    index("user_identities_user_idx").on(table.userId),
    index("user_identities_provider_idx").on(table.provider),
  ],
);

export type UserIdentity = typeof userIdentities.$inferSelect;
export type InsertUserIdentity = typeof userIdentities.$inferInsert;

