import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, jsonb, index, uniqueIndex, customType, serial, boolean, bigint, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { users } from "./auth";

// ========================================
// Integration Management Tables
// ========================================

// Integration Providers - Catalog of available providers
export const integrationProviders = pgTable("integration_providers", {
    id: varchar("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    iconUrl: text("icon_url"),
    authType: text("auth_type").notNull().default("oauth2"),
    authConfig: jsonb("auth_config"),
    category: text("category").default("general"),
    isActive: text("is_active").default("true"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertIntegrationProviderSchema = createInsertSchema(integrationProviders);

export type InsertIntegrationProvider = z.infer<typeof insertIntegrationProviderSchema>;
export type IntegrationProvider = typeof integrationProviders.$inferSelect;

// Integration Accounts - User's connected accounts per provider
export const integrationAccounts = pgTable("integration_accounts", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    providerId: varchar("provider_id").notNull().references(() => integrationProviders.id),
    externalUserId: text("external_user_id"),
    displayName: text("display_name"),
    email: text("email"),
    avatarUrl: text("avatar_url"),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    tokenExpiresAt: timestamp("token_expires_at"),
    scopes: text("scopes"),
    isDefault: text("is_default").default("false"),
    status: text("status").default("active"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table: any) => [
    index("integration_accounts_user_id_idx").on(table.userId),
    index("integration_accounts_provider_idx").on(table.providerId),
]);

export const insertIntegrationAccountSchema = createInsertSchema(integrationAccounts);

export type InsertIntegrationAccount = z.infer<typeof insertIntegrationAccountSchema>;
export type IntegrationAccount = typeof integrationAccounts.$inferSelect;

// Integration Tools - Available tools/actions per provider
export const integrationTools = pgTable("integration_tools", {
    id: varchar("id").primaryKey(),
    providerId: varchar("provider_id").notNull().references(() => integrationProviders.id),
    name: text("name").notNull(),
    description: text("description"),
    actionSchema: jsonb("action_schema"),
    resultSchema: jsonb("result_schema"),
    requiredScopes: text("required_scopes").array(),
    dataAccessLevel: text("data_access_level").default("read"),
    rateLimit: jsonb("rate_limit"),
    confirmationRequired: text("confirmation_required").default("false"),
    isActive: text("is_active").default("true"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertIntegrationToolSchema = createInsertSchema(integrationTools);

export type InsertIntegrationTool = z.infer<typeof insertIntegrationToolSchema>;
export type IntegrationTool = typeof integrationTools.$inferSelect;

// Integration Policies - User preferences for enabled apps/tools
export const integrationPolicies = pgTable("integration_policies", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }).unique(),
    enabledApps: jsonb("enabled_apps").$type<string[]>().default([]),
    enabledTools: jsonb("enabled_tools").$type<string[]>().default([]),
    disabledTools: jsonb("disabled_tools").$type<string[]>().default([]),
    resourceScopes: jsonb("resource_scopes"),
    autoConfirmPolicy: text("auto_confirm_policy").default("ask"),
    sandboxMode: text("sandbox_mode").default("false"),
    maxParallelCalls: integer("max_parallel_calls").default(3),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table: any) => [
    index("integration_policies_user_id_idx").on(table.userId),
]);

export const insertIntegrationPolicySchema = createInsertSchema(integrationPolicies);

export type InsertIntegrationPolicy = z.infer<typeof insertIntegrationPolicySchema>;
export type IntegrationPolicy = typeof integrationPolicies.$inferSelect;

// Shared Links - For sharing resources with external users
export const sharedLinks = pgTable("shared_links", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    resourceType: text("resource_type").notNull(), // 'chat', 'file', 'artifact'
    resourceId: varchar("resource_id").notNull(),
    token: varchar("token").notNull().unique(),
    scope: text("scope").default("link_only"), // 'public', 'link_only', 'organization'
    permissions: text("permissions").default("read"), // 'read', 'read_write'
    expiresAt: timestamp("expires_at"),
    lastAccessedAt: timestamp("last_accessed_at"),
    accessCount: integer("access_count").default(0),
    isRevoked: text("is_revoked").default("false"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table: any) => [
    index("shared_links_user_idx").on(table.userId),
    index("shared_links_token_idx").on(table.token),
    index("shared_links_resource_idx").on(table.resourceType, table.resourceId),
]);

export const insertSharedLinkSchema = createInsertSchema(sharedLinks);

export type InsertSharedLink = z.infer<typeof insertSharedLinkSchema>;
export type SharedLink = typeof sharedLinks.$inferSelect;

// Gmail OAuth Tokens (Custom MCP Integration)
export const gmailOAuthTokens = pgTable("gmail_oauth_tokens", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    accountEmail: text("account_email").notNull(),
    accessToken: text("access_token").notNull(),
    refreshToken: text("refresh_token").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    scopes: text("scopes").array().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table: any) => [
    index("gmail_oauth_user_idx").on(table.userId),
    uniqueIndex("gmail_oauth_user_email_idx").on(table.userId, table.accountEmail),
]);

export const insertGmailOAuthTokenSchema = createInsertSchema(gmailOAuthTokens);

export type InsertGmailOAuthToken = z.infer<typeof insertGmailOAuthTokenSchema>;
export type GmailOAuthToken = typeof gmailOAuthTokens.$inferSelect;

// PARE Idempotency System - Phase 2
export const pareIdempotencyStatusEnum = ['processing', 'completed', 'failed'] as const;
export type PareIdempotencyStatus = typeof pareIdempotencyStatusEnum[number];

export const pareIdempotencyKeys = pgTable("pare_idempotency_keys", {
    id: serial("id").primaryKey(),
    idempotencyKey: varchar("idempotency_key", { length: 255 }).notNull().unique(),
    payloadHash: varchar("payload_hash", { length: 64 }).notNull(),
    responseJson: jsonb("response_json").$type<Record<string, unknown>>(),
    status: text("status").$type<PareIdempotencyStatus>().notNull().default('processing'),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    expiresAt: timestamp("expires_at").notNull().default(sql`NOW() + INTERVAL '24 hours'`),
}, (table: any) => [
    index("pare_idempotency_key_idx").on(table.idempotencyKey),
    index("pare_idempotency_expires_idx").on(table.expiresAt),
]);

export const insertPareIdempotencyKeySchema = createInsertSchema(pareIdempotencyKeys);

export type InsertPareIdempotencyKey = z.infer<typeof insertPareIdempotencyKeySchema>;
export type PareIdempotencyKey = typeof pareIdempotencyKeys.$inferSelect;

// Connector Usage Hourly (Enterprise Metrics)
export const connectorUsageHourly = pgTable("connector_usage_hourly", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    connector: text("connector").notNull(),
    hourBucket: timestamp("hour_bucket").notNull(),
    totalCalls: integer("total_calls").default(0),
    successCount: integer("success_count").default(0),
    failureCount: integer("failure_count").default(0),
    totalLatencyMs: integer("total_latency_ms").default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table: any) => [
    uniqueIndex("connector_usage_hourly_connector_bucket_idx").on(table.connector, table.hourBucket),
    index("connector_usage_hourly_connector_created_idx").on(table.connector, table.createdAt),
]);

export const insertConnectorUsageHourlySchema = createInsertSchema(connectorUsageHourly);

export type InsertConnectorUsageHourly = z.infer<typeof insertConnectorUsageHourlySchema>;
export type ConnectorUsageHourly = typeof connectorUsageHourly.$inferSelect;
