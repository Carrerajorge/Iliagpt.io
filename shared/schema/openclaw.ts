import { pgTable, text, varchar, integer, timestamp, jsonb, index, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { users } from "../schema";

export const openclawInstances = pgTable(
  "openclaw_instances",
  {
    id: varchar("id").primaryKey(),
    userId: varchar("user_id").notNull().references(() => users.id),
    instanceId: varchar("instance_id").notNull().unique(),
    status: text("status").notNull().default("active"),
    version: varchar("version").default("v2026.4.1"),
    config: jsonb("config").default({}),
    tokensUsed: integer("tokens_used").notNull().default(0),
    tokensLimit: integer("tokens_limit").notNull().default(50000),
    requestCount: integer("request_count").notNull().default(0),
    lastActiveAt: timestamp("last_active_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_openclaw_instances_user").on(table.userId),
    index("idx_openclaw_instances_status").on(table.status),
  ]
);

export const openclawTokenLedger = pgTable(
  "openclaw_token_ledger",
  {
    id: varchar("id").primaryKey(),
    userId: varchar("user_id").notNull().references(() => users.id),
    instanceId: varchar("instance_id").notNull(),
    action: text("action").notNull(),
    toolName: varchar("tool_name"),
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    model: varchar("model"),
    metadata: jsonb("metadata").default({}),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_openclaw_ledger_user").on(table.userId),
    index("idx_openclaw_ledger_instance").on(table.instanceId),
    index("idx_openclaw_ledger_created").on(table.createdAt),
  ]
);

export const openclawAdminConfig = pgTable("openclaw_admin_config", {
  id: varchar("id").primaryKey().default("default"),
  defaultTokensLimit: integer("default_tokens_limit").notNull().default(50000),
  globalEnabled: boolean("global_enabled").notNull().default(true),
  autoProvisionOnLogin: boolean("auto_provision_on_login").notNull().default(true),
  githubRepo: varchar("github_repo").default("openclaw/openclaw"),
  currentVersion: varchar("current_version").default("v2026.4.8"),
  lastSyncAt: timestamp("last_sync_at"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertOpenclawInstanceSchema = createInsertSchema(openclawInstances).omit({ createdAt: true, updatedAt: true });
export const insertOpenclawTokenLedgerSchema = createInsertSchema(openclawTokenLedger).omit({ createdAt: true });
export const insertOpenclawAdminConfigSchema = createInsertSchema(openclawAdminConfig).omit({ updatedAt: true });

export type OpenclawInstance = typeof openclawInstances.$inferSelect;
export type InsertOpenclawInstance = z.infer<typeof insertOpenclawInstanceSchema>;
export type OpenclawTokenLedger = typeof openclawTokenLedger.$inferSelect;
export type InsertOpenclawTokenLedger = z.infer<typeof insertOpenclawTokenLedgerSchema>;
export type OpenclawAdminConfig = typeof openclawAdminConfig.$inferSelect;
export type InsertOpenclawAdminConfig = z.infer<typeof insertOpenclawAdminConfigSchema>;
