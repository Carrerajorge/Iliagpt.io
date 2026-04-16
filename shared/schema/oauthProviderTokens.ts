import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  varchar,
  timestamp,
  bigint,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { users } from "./auth";

// ========================================
// Multi-Provider OAuth Token Tables
// ========================================

/**
 * Global OAuth tokens — admin connects once, all users get access.
 * Only one token per provider is allowed (unique on provider).
 * Tokens are AES-256-GCM encrypted at rest.
 */
export const oauthTokensGlobal = pgTable(
  "oauth_tokens_global",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    provider: varchar("provider", { length: 50 }).notNull(), // 'openai' | 'gemini' | 'anthropic'
    accessToken: text("access_token").notNull(), // AES-256-GCM encrypted
    refreshToken: text("refresh_token"), // AES-256-GCM encrypted
    expiresAt: bigint("expires_at", { mode: "number" }), // epoch ms, null = never expires
    scope: text("scope"),
    label: text("label"), // admin-friendly label e.g. "Team OpenAI"
    models: text("models"), // JSON cache of available models
    addedByUserId: varchar("added_by_user_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table: any) => [
    uniqueIndex("oauth_tokens_global_provider_unique").on(table.provider),
  ],
);

export type OAuthTokenGlobal = typeof oauthTokensGlobal.$inferSelect;
export type InsertOAuthTokenGlobal = typeof oauthTokensGlobal.$inferInsert;

/**
 * Per-user OAuth tokens — each user connects their own account.
 * One token per user per provider (unique on userId + provider).
 * User tokens take priority over global tokens.
 * Tokens are AES-256-GCM encrypted at rest.
 */
export const oauthTokensUser = pgTable(
  "oauth_tokens_user",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: varchar("provider", { length: 50 }).notNull(), // 'openai' | 'gemini' | 'anthropic'
    accessToken: text("access_token").notNull(), // AES-256-GCM encrypted
    refreshToken: text("refresh_token"), // AES-256-GCM encrypted
    expiresAt: bigint("expires_at", { mode: "number" }), // epoch ms
    scope: text("scope"),
    models: text("models"), // JSON cache of available models
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table: any) => [
    uniqueIndex("oauth_tokens_user_unique_user_provider").on(
      table.userId,
      table.provider,
    ),
    index("oauth_tokens_user_user_idx").on(table.userId),
  ],
);

export type OAuthTokenUser = typeof oauthTokensUser.$inferSelect;
export type InsertOAuthTokenUser = typeof oauthTokensUser.$inferInsert;
