import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, jsonb, index, uniqueIndex, customType, serial, boolean, bigint, real, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { users } from "./auth";

// AI Models Registry
export const aiModels = pgTable("ai_models", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    name: text("name").notNull(),
    provider: text("provider").notNull(),
    modelId: text("model_id").notNull(),
    status: text("status").default("active"),
    costPer1k: text("cost_per_1k").default("0.00"),
    usagePercent: integer("usage_percent").default(0),
    description: text("description"),
    capabilities: jsonb("capabilities"),
    modelType: text("model_type").default("TEXT"),
    contextWindow: integer("context_window"),
    maxOutputTokens: integer("max_output_tokens"),
    inputCostPer1k: text("input_cost_per_1k").default("0.00"),
    outputCostPer1k: text("output_cost_per_1k").default("0.00"),
    lastSyncAt: timestamp("last_sync_at"),
    lastSyncedAt: timestamp("last_synced_at"),
    isDeprecated: text("is_deprecated").default("false"),
    releaseDate: text("release_date"),
    isEnabled: text("is_enabled").default("false"),
    enabledAt: timestamp("enabled_at"),
    enabledByAdminId: varchar("enabled_by_admin_id"),
    displayOrder: integer("display_order").default(0),
    icon: text("icon"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table: any) => [
    index("ai_models_provider_idx").on(table.provider),
    index("ai_models_model_type_idx").on(table.modelType),
    index("ai_models_status_idx").on(table.status),
    index("ai_models_is_enabled_idx").on(table.isEnabled),
]);

export const insertAiModelSchema = createInsertSchema(aiModels);

export type InsertAiModel = z.infer<typeof insertAiModelSchema>;
export type AiModel = typeof aiModels.$inferSelect;

// Payments
export const payments = pgTable("payments", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id").references(() => users.id),
    amount: text("amount").notNull(),
    // Derived numeric amounts for robust filtering/sorting. Keep legacy `amount` string for compatibility.
    amountValue: numeric("amount_value", { precision: 18, scale: 6 }),
    // Stripe amounts in the smallest currency unit (cents). Useful for reconciliation and charge/refund events.
    amountMinor: bigint("amount_minor", { mode: "number" }),
    currency: text("currency").default("EUR"),
    status: text("status").default("pending"),
    method: text("method"),
    description: text("description"),
    stripePaymentId: text("stripe_payment_id"),
    stripeCustomerId: text("stripe_customer_id"),
    stripePaymentIntentId: text("stripe_payment_intent_id"),
    stripeChargeId: text("stripe_charge_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table: any) => [
    index("payments_user_idx").on(table.userId),
    index("payments_created_at_idx").on(table.createdAt),
    index("payments_status_created_at_idx").on(table.status, table.createdAt),
    index("payments_currency_created_at_idx").on(table.currency, table.createdAt),
    index("payments_stripe_customer_id_idx").on(table.stripeCustomerId),
    index("payments_stripe_payment_intent_id_idx").on(table.stripePaymentIntentId),
    index("payments_stripe_charge_id_idx").on(table.stripeChargeId),
    uniqueIndex("payments_stripe_payment_id_unique_idx").on(table.stripePaymentId),
]);

export const insertPaymentSchema = createInsertSchema(payments);

export type InsertPayment = z.infer<typeof insertPaymentSchema>;
export type Payment = typeof payments.$inferSelect;

// Invoices
export const invoices = pgTable("invoices", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id").references(() => users.id),
    paymentId: varchar("payment_id").references(() => payments.id),
    source: text("source").default("internal"),
    invoiceNumber: text("invoice_number").notNull(),
    amount: text("amount").notNull(),
    amountValue: numeric("amount_value", { precision: 18, scale: 6 }),
    amountMinor: bigint("amount_minor", { mode: "number" }),
    currency: text("currency").default("EUR"),
    status: text("status").default("pending"),
    dueDate: timestamp("due_date"),
    paidAt: timestamp("paid_at"),
    pdfPath: text("pdf_path"),
    stripeInvoiceId: text("stripe_invoice_id"),
    stripeHostedInvoiceUrl: text("stripe_hosted_invoice_url"),
    stripeInvoicePdfUrl: text("stripe_invoice_pdf_url"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table: any) => [
    index("invoices_user_idx").on(table.userId),
    index("invoices_payment_idx").on(table.paymentId),
    uniqueIndex("invoices_user_invoice_number_unique_idx").on(table.userId, table.invoiceNumber),
    uniqueIndex("invoices_stripe_invoice_id_unique_idx").on(table.stripeInvoiceId),
]);

export const insertInvoiceSchema = createInsertSchema(invoices);

export type InsertInvoice = z.infer<typeof insertInvoiceSchema>;
export type Invoice = typeof invoices.$inferSelect;

// Platform Settings
export const platformSettings = pgTable("platform_settings", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    key: text("key").notNull().unique(),
    value: text("value"),
    description: text("description"),
    category: text("category").default("general"),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertPlatformSettingSchema = createInsertSchema(platformSettings);

export type InsertPlatformSetting = z.infer<typeof insertPlatformSettingSchema>;
export type PlatformSetting = typeof platformSettings.$inferSelect;

// Audit Logs
export const auditLogs = pgTable("audit_logs", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id"),
    action: text("action").notNull(),
    resource: text("resource"),
    resourceId: varchar("resource_id"),
    details: jsonb("details"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table: any) => [
    index("audit_logs_user_idx").on(table.userId),
    index("audit_logs_action_idx").on(table.action),
]);

export const insertAuditLogSchema = createInsertSchema(auditLogs);

export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type AuditLog = typeof auditLogs.$inferSelect;

// Analytics Snapshots
export const analyticsSnapshots = pgTable("analytics_snapshots", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    date: timestamp("date").notNull(),
    totalUsers: integer("total_users").default(0),
    activeUsers: integer("active_users").default(0),
    totalQueries: integer("total_queries").default(0),
    revenue: text("revenue").default("0"),
    newSignups: integer("new_signups").default(0),
    churnedUsers: integer("churned_users").default(0),
    avgResponseTime: integer("avg_response_time").default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertAnalyticsSnapshotSchema = createInsertSchema(analyticsSnapshots);

export type InsertAnalyticsSnapshot = z.infer<typeof insertAnalyticsSnapshotSchema>;
export type AnalyticsSnapshot = typeof analyticsSnapshots.$inferSelect;

// Admin Audit Logs - Track all admin actions
export const adminAuditLogs = pgTable("admin_audit_logs", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    adminId: varchar("admin_id").notNull().references(() => users.id),
    action: text("action").notNull(), // 'user.create', 'user.delete', 'settings.update', etc.
    targetType: text("target_type"), // 'user', 'settings', 'report', etc.
    targetId: varchar("target_id"),
    details: jsonb("details"), // action-specific data
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table: any) => [
    index("admin_audit_logs_admin_idx").on(table.adminId),
    index("admin_audit_logs_action_idx").on(table.action),
    index("admin_audit_logs_created_idx").on(table.createdAt),
]);

export const insertAdminAuditLogSchema = createInsertSchema(adminAuditLogs);

export type InsertAdminAuditLog = z.infer<typeof insertAdminAuditLogSchema>;
export type AdminAuditLog = typeof adminAuditLogs.$inferSelect;

// AI Model Usage - Track token consumption per model
export const aiModelUsage = pgTable("ai_model_usage", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id").references(() => users.id, { onDelete: "set null" }),
    provider: text("provider").notNull(), // 'xai', 'gemini'
    model: text("model").notNull(), // 'grok-3-fast', 'gemini-2.5-flash', etc.
    promptTokens: integer("prompt_tokens").default(0),
    completionTokens: integer("completion_tokens").default(0),
    totalTokens: integer("total_tokens").default(0),
    latencyMs: integer("latency_ms"),
    costEstimate: text("cost_estimate"), // stored as string for precision
    requestType: text("request_type"), // 'chat', 'vision', 'embedding'
    success: text("success").default("true"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table: any) => [
    index("ai_model_usage_user_idx").on(table.userId),
    index("ai_model_usage_provider_idx").on(table.provider),
    index("ai_model_usage_created_idx").on(table.createdAt),
]);

export const insertAiModelUsageSchema = createInsertSchema(aiModelUsage);

export type InsertAiModelUsage = z.infer<typeof insertAiModelUsageSchema>;
export type AiModelUsage = typeof aiModelUsage.$inferSelect;

// Security Events - Track security-related events
export const securityEvents = pgTable("security_events", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id").references(() => users.id, { onDelete: "set null" }),
    eventType: text("event_type").notNull(), // 'login_failed', 'login_success', 'password_reset', 'suspicious_activity', 'rate_limit', 'ip_blocked'
    severity: text("severity").default("info"), // 'info', 'warning', 'error', 'critical'
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    details: jsonb("details"),
    resolved: text("resolved").default("false"),
    resolvedBy: varchar("resolved_by").references(() => users.id),
    resolvedAt: timestamp("resolved_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table: any) => [
    index("security_events_user_idx").on(table.userId),
    index("security_events_type_idx").on(table.eventType),
    index("security_events_severity_idx").on(table.severity),
    index("security_events_created_idx").on(table.createdAt),
]);

export const insertSecurityEventSchema = createInsertSchema(securityEvents);

export type InsertSecurityEvent = z.infer<typeof insertSecurityEventSchema>;
export type SecurityEvent = typeof securityEvents.$inferSelect;

// Admin Reports - Generated reports
export const adminReports = pgTable("admin_reports", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    name: text("name").notNull(),
    type: text("type").notNull(), // 'users', 'usage', 'revenue', 'security', 'custom'
    parameters: jsonb("parameters"), // report generation parameters
    status: text("status").default("pending"), // 'pending', 'generating', 'completed', 'failed'
    fileUrl: text("file_url"),
    fileSize: integer("file_size"),
    generatedBy: varchar("generated_by").notNull().references(() => users.id),
    scheduledId: varchar("scheduled_id"), // if part of a scheduled report
    error: text("error"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    completedAt: timestamp("completed_at"),
}, (table: any) => [
    index("admin_reports_type_idx").on(table.type),
    index("admin_reports_status_idx").on(table.status),
    index("admin_reports_generated_by_idx").on(table.generatedBy),
]);

export const insertAdminReportSchema = createInsertSchema(adminReports);

export type InsertAdminReport = z.infer<typeof insertAdminReportSchema>;
export type AdminReport = typeof adminReports.$inferSelect;

// Aliases for compatibility with server/storage.ts
export const reports = adminReports;
export const insertReportSchema = insertAdminReportSchema;
export type Report = AdminReport;
export type InsertReport = InsertAdminReport;

// Scheduled Reports - Recurring report generation
export const scheduledReports = pgTable("scheduled_reports", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    name: text("name").notNull(),
    type: text("type").notNull(),
    parameters: jsonb("parameters"),
    schedule: text("schedule").notNull(), // cron expression
    recipients: text("recipients").array(), // email addresses
    isActive: text("is_active").default("true"),
    lastRunAt: timestamp("last_run_at"),
    nextRunAt: timestamp("next_run_at"),
    createdBy: varchar("created_by").notNull().references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table: any) => [
    index("scheduled_reports_active_next_idx").on(table.isActive, table.nextRunAt),
]);

export const insertScheduledReportSchema = createInsertSchema(scheduledReports);

export type InsertScheduledReport = z.infer<typeof insertScheduledReportSchema>;
export type ScheduledReport = typeof scheduledReports.$inferSelect;

// IP Blocklist - Blocked IP addresses
export const ipBlocklist = pgTable("ip_blocklist", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    ipAddress: text("ip_address").notNull().unique(),
    reason: text("reason"),
    blockedBy: varchar("blocked_by").notNull().references(() => users.id),
    expiresAt: timestamp("expires_at"), // null = permanent
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table: any) => [
    index("ip_blocklist_ip_idx").on(table.ipAddress),
    index("ip_blocklist_expires_idx").on(table.expiresAt),
]);

export const insertIpBlocklistSchema = createInsertSchema(ipBlocklist);

export type InsertIpBlocklist = z.infer<typeof insertIpBlocklistSchema>;
export type IpBlocklist = typeof ipBlocklist.$inferSelect;

// Analytics Events - User behavior tracking
export const analyticsEvents = pgTable("analytics_events", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id").references(() => users.id, { onDelete: "set null" }),
    sessionId: varchar("session_id"),
    eventName: text("event_name").notNull(), // 'page_view', 'chat_started', 'document_generated', etc.
    eventData: jsonb("event_data"),
    pageUrl: text("page_url"),
    referrer: text("referrer"),
    deviceType: text("device_type"), // 'desktop', 'mobile', 'tablet'
    browser: text("browser"),
    country: text("country"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table: any) => [
    index("analytics_events_user_idx").on(table.userId),
    index("analytics_events_event_idx").on(table.eventName),
    index("analytics_events_created_idx").on(table.createdAt),
    index("analytics_events_user_created_idx").on(table.userId, table.createdAt),
]);

export const insertAnalyticsEventSchema = createInsertSchema(analyticsEvents);

export type InsertAnalyticsEvent = z.infer<typeof insertAnalyticsEventSchema>;
export type AnalyticsEvent = typeof analyticsEvents.$inferSelect;

// Provider Metrics - Performance tracking per AI provider
export const providerMetrics = pgTable("provider_metrics", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    provider: text("provider").notNull(),
    windowStart: timestamp("window_start").notNull(),
    windowEnd: timestamp("window_end").notNull(),
    avgLatency: integer("avg_latency").default(0),
    p50Latency: integer("p50_latency").default(0),
    p95Latency: integer("p95_latency").default(0),
    p99Latency: integer("p99_latency").default(0),
    successRate: text("success_rate").default("100"),
    totalRequests: integer("total_requests").default(0),
    errorCount: integer("error_count").default(0),
    tokensIn: integer("tokens_in").default(0),
    tokensOut: integer("tokens_out").default(0),
    totalCost: text("total_cost").default("0.00"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table: any) => [
    index("provider_metrics_provider_idx").on(table.provider),
    index("provider_metrics_window_idx").on(table.windowStart, table.windowEnd),
]);

export const insertProviderMetricsSchema = createInsertSchema(providerMetrics);

export type InsertProviderMetrics = z.infer<typeof insertProviderMetricsSchema>;
export type ProviderMetrics = typeof providerMetrics.$inferSelect;

// Cost Budgets - Budget tracking and alerts per provider
export const costBudgets = pgTable("cost_budgets", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    provider: text("provider").notNull().unique(),
    budgetLimit: text("budget_limit").notNull().default("100.00"),
    alertThreshold: integer("alert_threshold").default(80),
    currentSpend: text("current_spend").default("0.00"),
    projectedMonthly: text("projected_monthly").default("0.00"),
    periodStart: timestamp("period_start").defaultNow().notNull(),
    periodEnd: timestamp("period_end"),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table: any) => [
    index("cost_budgets_provider_idx").on(table.provider),
]);

export const insertCostBudgetSchema = createInsertSchema(costBudgets);

export type InsertCostBudget = z.infer<typeof insertCostBudgetSchema>;
export type CostBudget = typeof costBudgets.$inferSelect;

// Remote shell targets
export const remoteShellTargets = pgTable("remote_shell_targets", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    name: text("name").notNull(),
    host: text("host").notNull(),
    port: integer("port").default(22),
    username: text("username").notNull(),
    authType: text("auth_type").notNull(),
    encryptedSecret: text("encrypted_secret").notNull(),
    secretHint: text("secret_hint"),
    ownerId: varchar("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    allowedAdminIds: text("allowed_admin_ids").array().default(sql`ARRAY[]::text[]`),
    notes: text("notes"),
    lastConnectedAt: timestamp("last_connected_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table: any) => [
    index("remote_shell_targets_owner_idx").on(table.ownerId),
    index("remote_shell_targets_host_idx").on(table.host),
    index("remote_shell_targets_created_idx").on(table.createdAt),
]);

export const insertRemoteShellTargetSchema = createInsertSchema(remoteShellTargets);

export type InsertRemoteShellTarget = z.infer<typeof insertRemoteShellTargetSchema>;
export type RemoteShellTarget = typeof remoteShellTargets.$inferSelect;

// API Logs - Detailed request/response logging
export const apiLogs = pgTable("api_logs", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id").references(() => users.id, { onDelete: "set null" }),
    endpoint: text("endpoint").notNull(),
    method: text("method").notNull(),
    statusCode: integer("status_code"),
    latencyMs: integer("latency_ms"),
    tokensIn: integer("tokens_in"),
    tokensOut: integer("tokens_out"),
    model: text("model"),
    provider: text("provider"),
    requestPreview: text("request_preview"),
    responsePreview: text("response_preview"),
    errorMessage: text("error_message"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table: any) => [
    index("api_logs_user_idx").on(table.userId),
    index("api_logs_endpoint_idx").on(table.endpoint),
    index("api_logs_created_idx").on(table.createdAt),
    index("api_logs_status_idx").on(table.statusCode),
    index("api_logs_provider_idx").on(table.provider),
    index("api_logs_user_created_idx").on(table.userId, table.createdAt),
]);

export const insertApiLogSchema = createInsertSchema(apiLogs);

export type InsertApiLog = z.infer<typeof insertApiLogSchema>;
export type ApiLog = typeof apiLogs.$inferSelect;

// Real-time KPI Snapshots - For dashboard metrics
export const kpiSnapshots = pgTable("kpi_snapshots", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    activeUsersNow: integer("active_users_now").default(0),
    queriesPerMinute: integer("queries_per_minute").default(0),
    tokensConsumedToday: bigint("tokens_consumed_today", { mode: 'number' }).default(0),
    revenueToday: text("revenue_today").default("0.00"),
    avgLatencyMs: integer("avg_latency_ms").default(0),
    errorRatePercentage: text("error_rate_percentage").default("0.00"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table: any) => [
    index("kpi_snapshots_created_idx").on(table.createdAt),
]);

export const insertKpiSnapshotSchema = createInsertSchema(kpiSnapshots);

export type InsertKpiSnapshot = z.infer<typeof insertKpiSnapshotSchema>;
export type KpiSnapshot = typeof kpiSnapshots.$inferSelect;

// Security Center - Enterprise Security Policies
export const securityPolicies = pgTable("security_policies", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    policyName: text("policy_name").notNull().unique(),
    policyType: text("policy_type").notNull(), // cors, csp, rate_limit, ip_restriction, auth_requirement, data_retention
    rules: jsonb("rules").notNull().$type<Record<string, any>>(),
    priority: integer("priority").default(0),
    isEnabled: text("is_enabled").default("true"),
    appliedTo: text("applied_to").notNull().default("global"), // global, api, dashboard, public
    createdBy: varchar("created_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table: any) => [
    index("security_policies_type_idx").on(table.policyType),
    index("security_policies_enabled_idx").on(table.isEnabled),
    index("security_policies_applied_idx").on(table.appliedTo),
]);

export const insertSecurityPolicySchema = createInsertSchema(securityPolicies);

export type InsertSecurityPolicy = z.infer<typeof insertSecurityPolicySchema>;
export type SecurityPolicy = typeof securityPolicies.$inferSelect;

// Reports Center - Templates and Generated Reports
// Report Templates
export const reportTemplates = pgTable("report_templates", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    name: text("name").notNull(),
    type: text("type").notNull(),
    description: text("description"),
    columns: jsonb("columns").notNull().$type<{ key: string; label: string; type?: string }[]>(),
    filters: jsonb("filters").$type<{ key: string; label: string; type: string }[]>(),
    groupBy: jsonb("group_by").$type<string[]>(),
    isSystem: text("is_system").default("false"),
    createdBy: varchar("created_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table: any) => [
    index("report_templates_type_idx").on(table.type),
]);

export const insertReportTemplateSchema = createInsertSchema(reportTemplates);

export type InsertReportTemplate = z.infer<typeof insertReportTemplateSchema>;
export type ReportTemplate = typeof reportTemplates.$inferSelect;

// Generated Reports
export const generatedReports = pgTable("generated_reports", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    templateId: varchar("template_id"),
    name: text("name").notNull(),
    type: text("type").notNull(),
    status: text("status").default("pending"),
    parameters: jsonb("parameters").$type<Record<string, any>>(),
    resultSummary: jsonb("result_summary").$type<{ rowCount?: number; aggregates?: Record<string, any> }>(),
    filePath: text("file_path"),
    format: text("format").default("json"),
    generatedBy: varchar("generated_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    completedAt: timestamp("completed_at"),
}, (table: any) => [
    index("generated_reports_status_idx").on(table.status),
    index("generated_reports_created_idx").on(table.createdAt),
]);

export const insertGeneratedReportSchema = createInsertSchema(generatedReports);

export type InsertGeneratedReport = z.infer<typeof insertGeneratedReportSchema>;
export type GeneratedReport = typeof generatedReports.$inferSelect;

// Settings Configuration
export const settingsConfig = pgTable("settings_config", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    category: text("category").notNull(),
    key: text("key").notNull().unique(),
    value: jsonb("value"),
    valueType: text("value_type").default("string"),
    defaultValue: jsonb("default_value"),
    description: text("description"),
    isSensitive: text("is_sensitive").default("false"),
    updatedBy: varchar("updated_by"),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table: any) => [
    index("settings_category_idx").on(table.category),
]);

export const insertSettingsConfigSchema = createInsertSchema(settingsConfig);

export type InsertSettingsConfig = z.infer<typeof insertSettingsConfigSchema>;
export type SettingsConfig = typeof settingsConfig.$inferSelect;

// Notification Preferences System
// Notification Event Types Catalog
export const notificationEventTypes = pgTable("notification_event_types", {
    id: varchar("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    category: text("category").notNull(), // ai_updates, tasks, social, product
    severity: text("severity").default("normal"), // low, normal, high, critical
    defaultOptIn: text("default_opt_in").default("true"),
    defaultChannels: text("default_channels").default("push"), // none, push, email, push_email
    frequencyCap: integer("frequency_cap"), // max notifications per hour
    icon: text("icon"),
    sortOrder: integer("sort_order").default(0),
});

export const insertNotificationEventTypeSchema = createInsertSchema(notificationEventTypes);
export type InsertNotificationEventType = z.infer<typeof insertNotificationEventTypeSchema>;
export type NotificationEventType = typeof notificationEventTypes.$inferSelect;

// User Notification Preferences
export const notificationPreferences = pgTable("notification_preferences", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id").notNull(),
    eventTypeId: varchar("event_type_id").notNull().references(() => notificationEventTypes.id, { onDelete: "cascade" }),
    channels: text("channels").notNull().default("push"), // none, push, email, push_email
    enabled: text("enabled").default("true"),
    quietHoursStart: text("quiet_hours_start"), // HH:MM format
    quietHoursEnd: text("quiet_hours_end"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table: any) => [
    index("notification_prefs_user_idx").on(table.userId),
    uniqueIndex("notification_prefs_unique_idx").on(table.userId, table.eventTypeId),
]);

export const insertNotificationPreferenceSchema = createInsertSchema(notificationPreferences);

export type InsertNotificationPreference = z.infer<typeof insertNotificationPreferenceSchema>;
export type NotificationPreference = typeof notificationPreferences.$inferSelect;

// Notification Delivery Log
export const notificationLogs = pgTable("notification_logs", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    eventId: varchar("event_id").notNull(), // idempotency key
    userId: varchar("user_id").notNull(),
    eventTypeId: varchar("event_type_id").notNull(),
    channel: text("channel").notNull(), // push, email
    status: text("status").notNull().default("pending"), // pending, sent, delivered, failed, bounced
    providerResponse: jsonb("provider_response"),
    errorMessage: text("error_message"),
    retryCount: integer("retry_count").default(0),
    sentAt: timestamp("sent_at"),
    deliveredAt: timestamp("delivered_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table: any) => [
    index("notification_logs_user_idx").on(table.userId),
    index("notification_logs_event_idx").on(table.eventId),
    uniqueIndex("notification_logs_idempotency_idx").on(table.eventId, table.channel),
]);

export const insertNotificationLogSchema = createInsertSchema(notificationLogs);

export type InsertNotificationLog = z.infer<typeof insertNotificationLogSchema>;
export type NotificationLog = typeof notificationLogs.$inferSelect;

// App Releases (Desktop Native Binarles)
export const appReleases = pgTable("app_releases", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    platform: text("platform").notNull(), // 'macOS', 'Windows', 'Linux'
    version: text("version").notNull(), // e.g., 'v2.1.0'
    size: text("size").notNull(), // e.g., '~98 MB'
    requirements: text("requirements").notNull(),
    available: text("available").default("false"), // true/false manually parsed or handle as string
    fileName: text("file_name").notNull(),
    downloadUrl: text("download_url").notNull(),
    note: text("note"),
    isActive: text("is_active").default("true"), // to keep history
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertAppReleaseSchema = createInsertSchema(appReleases);
export type InsertAppRelease = z.infer<typeof insertAppReleaseSchema>;
export type AppRelease = typeof appReleases.$inferSelect;
