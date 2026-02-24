import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, jsonb, index, uniqueIndex, customType, serial, boolean, bigint, real, check } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Session storage table for Replit Auth
export const sessions = pgTable(
    "sessions",
    {
        sid: varchar("sid").primaryKey(),
        sess: jsonb("sess").notNull(),
        expire: timestamp("expire").notNull(),
        // Optional: derived from sess JSON by a DB trigger (see migrations/0005_session_user_tracking.sql)
        userId: varchar("user_id"),
        createdAt: timestamp("created_at").defaultNow().notNull(),
        updatedAt: timestamp("updated_at").defaultNow().notNull(),
        lastSeenAt: timestamp("last_seen_at"),
    },
    (table: any) => [
        index("IDX_session_expire").on(table.expire),
        index("sessions_user_idx").on(table.userId),
        index("sessions_user_expire_idx").on(table.userId, table.expire),
    ]
);

// Magic Links table for passwordless email authentication
export const magicLinks = pgTable("magic_links", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id").notNull(),
    token: varchar("token").notNull().unique(),
    expiresAt: timestamp("expires_at").notNull(),
    used: boolean("used").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table: any) => [
    index("magic_links_token_idx").on(table.token),
    index("magic_links_user_idx").on(table.userId),
]);

export type MagicLink = typeof magicLinks.$inferSelect;

// OAuth States table - para almacenar estados de autenticación OAuth de forma persistente
// Esto soluciona el problema de múltiples réplicas del servidor
export const oauthStates = pgTable("oauth_states", {
    state: varchar("state", { length: 255 }).primaryKey(),
    returnUrl: text("return_url").notNull().default("/"),
    provider: varchar("provider", { length: 50 }).notNull().default("google"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    expiresAt: timestamp("expires_at").notNull(),
}, (table: any) => [
    index("oauth_states_expires_idx").on(table.expiresAt),
]);

export type OAuthState = typeof oauthStates.$inferSelect;
export type InsertOAuthState = typeof oauthStates.$inferInsert;

// Auth Tokens table - Secure storage for encryption tokens (replacing in-memory)
export const authTokens = pgTable("auth_tokens", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    provider: varchar("provider", { length: 50 }).notNull(), // google, microsoft, auth0
    accessToken: text("access_token").notNull(), // Encrypted
    refreshToken: text("refresh_token"), // Encrypted
    expiresAt: bigint("expires_at", { mode: "number" }),
    scope: text("scope"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table: any) => [
    index("auth_tokens_user_provider_idx").on(table.userId, table.provider),
    uniqueIndex("auth_tokens_unique_user_provider").on(table.userId, table.provider),
]);

export type AuthToken = typeof authTokens.$inferSelect;
export type InsertAuthToken = typeof authTokens.$inferInsert;


// Users table (compatible with Replit Auth) - Enterprise-grade
export const users = pgTable("users", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    username: text("username"),
    password: text("password"),
    email: text("email").unique(),
    firstName: varchar("first_name"),
    lastName: varchar("last_name"),
    fullName: varchar("full_name"),
    profileImageUrl: varchar("profile_image_url"),
    phone: varchar("phone"),
    company: varchar("company"),
    role: text("role").default("USER"), // USER, MOD, ADMIN, SYSTEM_AGENT
    plan: text("plan").default("free"), // free, pro, enterprise
    status: text("status").default("active"), // active, inactive, suspended, pending_verification
    queryCount: integer("query_count").default(0),
    tokensConsumed: integer("tokens_consumed").default(0),
    tokensLimit: integer("tokens_limit").default(100000),
    creditsBalance: integer("credits_balance").default(0),
    lastLoginAt: timestamp("last_login_at"),
    lastIp: varchar("last_ip"),
    userAgent: text("user_agent"),
    countryCode: varchar("country_code", { length: 2 }),
    authProvider: text("auth_provider").default("email"), // email, google, sso, phone
    is2faEnabled: text("is_2fa_enabled").default("false"),
    emailVerified: text("email_verified").default("false"),
    phoneVerified: text("phone_verified").default("false"),
    referralCode: varchar("referral_code"),
    referredBy: varchar("referred_by"),
    internalNotes: text("internal_notes"),
    tags: text("tags").array(),
    subscriptionExpiresAt: timestamp("subscription_expires_at"),
    dailyRequestsUsed: integer("daily_requests_used").default(0),
    dailyRequestsLimit: integer("daily_requests_limit").default(3),
    dailyRequestsResetAt: timestamp("daily_requests_reset_at"),
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    totpSecret: text("totp_secret"),
    totpEnabled: boolean("totp_enabled").default(false),
    loginCount: integer("login_count").default(0),
    subscriptionStatus: text("subscription_status"),
    subscriptionPlan: text("subscription_plan"),
    subscriptionPeriodEnd: timestamp("subscription_period_end"),
    monthlyTokenLimit: integer("monthly_token_limit"),
    monthlyTokensUsed: integer("monthly_tokens_used"),
    tokensResetAt: timestamp("tokens_reset_at"),
    preferences: jsonb("preferences"),
    // Multi-tenant (v2): organization/workspace ownership
    orgId: text("org_id").default("default"),
    // Per-user toggle: allow network access during code execution when org permits
    networkAccessEnabled: boolean("network_access_enabled").default(false),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
    deletedAt: timestamp("deleted_at"),
}, (table: any) => [
    index("users_role_idx").on(table.role),
    index("users_plan_idx").on(table.plan),
    index("users_status_idx").on(table.status),
    index("users_last_login_at_idx").on(table.lastLoginAt),
    index("users_referral_code_idx").on(table.referralCode),
    index("users_stripe_subscription_id_idx").on(table.stripeSubscriptionId),
    index("users_tags_idx").using("gin", table.tags),
    check("users_credits_balance_check", sql`${table.creditsBalance} >= 0`),
]);

export const insertUserSchema = createInsertSchema(users).pick({
    username: true,
    password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// User Settings table - one settings record per user
export const responsePreferencesSchema = z.object({
    responseStyle: z.enum(['default', 'formal', 'casual', 'concise']).default('default'),
    responseTone: z.string().default(''),
    customInstructions: z.string().default(''),
});

export const userProfileSchema = z.object({
    nickname: z.string().default(''),
    occupation: z.string().default(''),
    bio: z.string().default(''),
    // Builder profile (public-facing metadata for GPTs)
    showName: z.boolean().default(true),
    linkedInUrl: z.string().default(''),
    githubUrl: z.string().default(''),
    websiteDomain: z.string().default(''),
    receiveEmailComments: z.boolean().default(false),
});

export const featureFlagsSchema = z.object({
    memoryEnabled: z.boolean().default(false),
    recordingHistoryEnabled: z.boolean().default(false),
    webSearchAuto: z.boolean().default(true),
    codeInterpreterEnabled: z.boolean().default(true),
    canvasEnabled: z.boolean().default(true),
    voiceEnabled: z.boolean().default(true),
    voiceAdvanced: z.boolean().default(false),
    connectorSearchAuto: z.boolean().default(false),
});

export const privacySettingsSchema = z.object({
    trainingOptIn: z.boolean().default(false),
    remoteBrowserDataAccess: z.boolean().default(false),
    analyticsTracking: z.boolean().default(true),
    chatHistoryEnabled: z.boolean().default(true),
});

export const userSettings = pgTable("user_settings", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }).unique(),
    responsePreferences: jsonb("response_preferences").$type<z.infer<typeof responsePreferencesSchema>>(),
    userProfile: jsonb("user_profile").$type<z.infer<typeof userProfileSchema>>(),
    featureFlags: jsonb("feature_flags").$type<z.infer<typeof featureFlagsSchema>>(),
    privacySettings: jsonb("privacy_settings").$type<z.infer<typeof privacySettingsSchema>>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table: any) => [
    index("user_settings_user_id_idx").on(table.userId),
]);

export const insertUserSettingsSchema = createInsertSchema(userSettings).omit({
    id: true,
    createdAt: true,
    updatedAt: true,
}).extend({
    responsePreferences: responsePreferencesSchema.optional(),
    userProfile: userProfileSchema.optional(),
    featureFlags: featureFlagsSchema.optional(),
    privacySettings: privacySettingsSchema.optional(),
});

export type InsertUserSettings = z.infer<typeof insertUserSettingsSchema>;
export type UserSettings = typeof userSettings.$inferSelect;

// Consent Logs - Audit trail for privacy consent changes
export const consentLogs = pgTable("consent_logs", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    consentType: text("consent_type").notNull(), // 'training_opt_in', 'remote_browser_access'
    value: text("value").notNull(), // 'true' or 'false'
    consentVersion: text("consent_version").default("1.0"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table: any) => [
    index("consent_logs_user_idx").on(table.userId),
    index("consent_logs_consent_type_idx").on(table.consentType),
]);

export type ConsentLog = typeof consentLogs.$inferSelect;
