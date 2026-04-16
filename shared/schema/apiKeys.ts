import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, index, uniqueIndex, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { users } from "./auth";

// =============================================================================
// API Keys — user-scoped API keys with rate limiting and usage tracking
// =============================================================================

export const apiKeys = pgTable("api_keys", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    keyHash: varchar("key_hash", { length: 64 }).notNull(),
    keyPrefix: varchar("key_prefix", { length: 12 }).notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    requestCount: integer("request_count").default(0),
    rateLimit: integer("rate_limit").default(60),
    isActive: boolean("is_active").default(true),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table: any) => [
    index("api_keys_user_id_idx").on(table.userId),
    uniqueIndex("api_keys_key_hash_idx").on(table.keyHash),
]);

export const insertApiKeySchema = createInsertSchema(apiKeys).omit({
    id: true, createdAt: true, lastUsedAt: true, requestCount: true,
});

export type InsertApiKey = z.infer<typeof insertApiKeySchema>;
export type ApiKey = typeof apiKeys.$inferSelect;
