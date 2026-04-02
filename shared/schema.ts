import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, jsonb, index, uniqueIndex, customType, serial, boolean, bigint, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return "vector(1536)";
  },
  toDriver(value: number[]): string {
    return `[${value.join(",")}]`;
  },
  fromDriver(value: string): number[] {
    return value.slice(1, -1).split(",").map(Number);
  },
});

// Session storage table for Replit Auth
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)]
);

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
  role: text("role").default("user"), // admin, editor, viewer, api_only, user
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
  authProvider: text("auth_provider").default("email"), // email, google, sso
  is2faEnabled: text("is_2fa_enabled").default("false"),
  emailVerified: text("email_verified").default("false"),
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
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

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
}, (table) => [
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

export const insertIntegrationProviderSchema = createInsertSchema(integrationProviders).omit({
  createdAt: true,
});

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
}, (table) => [
  index("integration_accounts_user_id_idx").on(table.userId),
  index("integration_accounts_provider_idx").on(table.providerId),
]);

export const insertIntegrationAccountSchema = createInsertSchema(integrationAccounts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

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

export const insertIntegrationToolSchema = createInsertSchema(integrationTools).omit({
  createdAt: true,
});

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
}, (table) => [
  index("integration_policies_user_id_idx").on(table.userId),
]);

export const insertIntegrationPolicySchema = createInsertSchema(integrationPolicies).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

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
}, (table) => [
  index("shared_links_user_idx").on(table.userId),
  index("shared_links_token_idx").on(table.token),
  index("shared_links_resource_idx").on(table.resourceType, table.resourceId),
]);

export const insertSharedLinkSchema = createInsertSchema(sharedLinks).omit({
  id: true,
  createdAt: true,
  accessCount: true,
  lastAccessedAt: true,
});

export type InsertSharedLink = z.infer<typeof insertSharedLinkSchema>;
export type SharedLink = typeof sharedLinks.$inferSelect;

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
}, (table) => [
  index("consent_logs_user_idx").on(table.userId),
]);

export type ConsentLog = typeof consentLogs.$inferSelect;

// Tool Call Logs - Audit log for tool invocations
export const toolCallLogs = pgTable("tool_call_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id),
  chatId: varchar("chat_id"),
  runId: varchar("run_id"),
  toolId: varchar("tool_id").notNull(),
  providerId: varchar("provider_id").notNull(),
  accountId: varchar("account_id").references(() => integrationAccounts.id),
  inputRedacted: jsonb("input_redacted"),
  outputRedacted: jsonb("output_redacted"),
  status: text("status").notNull(),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  latencyMs: integer("latency_ms"),
  idempotencyKey: text("idempotency_key"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("tool_call_logs_user_id_idx").on(table.userId),
  index("tool_call_logs_tool_id_idx").on(table.toolId),
  index("tool_call_logs_created_at_idx").on(table.createdAt),
  index("tool_call_logs_run_created_idx").on(table.runId, table.createdAt),
]);

export const insertToolCallLogSchema = createInsertSchema(toolCallLogs).omit({
  id: true,
  createdAt: true,
});

export type InsertToolCallLog = z.infer<typeof insertToolCallLogSchema>;
export type ToolCallLog = typeof toolCallLogs.$inferSelect;

export const files = pgTable("files", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id"),
  name: text("name").notNull(),
  type: text("type").notNull(),
  size: integer("size").notNull(),
  storagePath: text("storage_path").notNull(),
  status: text("status").notNull().default("pending"),
  processingProgress: integer("processing_progress").default(0),
  processingError: text("processing_error"),
  completedAt: timestamp("completed_at"),
  totalChunks: integer("total_chunks"),
  uploadedChunks: integer("uploaded_chunks").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("files_user_created_idx").on(table.userId, table.createdAt),
  index("files_user_id_idx").on(table.userId),
  index("files_status_idx").on(table.status),
]);

export const insertFileSchema = createInsertSchema(files).omit({
  id: true,
  createdAt: true,
}).extend({
  processingProgress: z.number().min(0).max(100).optional(),
  processingError: z.string().nullable().optional(),
  completedAt: z.date().nullable().optional(),
  totalChunks: z.number().nullable().optional(),
  uploadedChunks: z.number().optional(),
});

export type InsertFile = z.infer<typeof insertFileSchema>;
export type File = typeof files.$inferSelect;

export const fileJobs = pgTable("file_jobs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  fileId: varchar("file_id").notNull().references(() => files.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("pending"),
  retries: integer("retries").default(0),
  lastError: text("last_error"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("file_jobs_file_id_idx").on(table.fileId),
  index("file_jobs_status_idx").on(table.status),
]);

export const insertFileJobSchema = createInsertSchema(fileJobs).omit({
  id: true,
  createdAt: true,
});

export type InsertFileJob = z.infer<typeof insertFileJobSchema>;
export type FileJob = typeof fileJobs.$inferSelect;

export const fileChunks = pgTable("file_chunks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  fileId: varchar("file_id").notNull().references(() => files.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  embedding: vector("embedding"),
  pageNumber: integer("page_number"),
  chunkIndex: integer("chunk_index").notNull(),
  metadata: jsonb("metadata"),
}, (table) => [
  index("file_chunks_file_id_idx").on(table.fileId),
]);

export const insertFileChunkSchema = createInsertSchema(fileChunks).omit({
  id: true,
}).extend({
  embedding: z.array(z.number()).nullish(),
});

export type InsertFileChunk = z.infer<typeof insertFileChunkSchema>;
export type FileChunk = typeof fileChunks.$inferSelect;

// Agent Web Navigation Tables
export const agentRuns = pgTable("agent_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  conversationId: varchar("conversation_id"),
  status: text("status").notNull().default("pending"), // pending, running, completed, failed, cancelled
  routerDecision: text("router_decision"), // llm, agent, hybrid
  objective: text("objective"),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
  error: text("error"),
}, (table) => [
  index("agent_runs_conversation_idx").on(table.conversationId),
  index("agent_runs_status_idx").on(table.status),
  index("agent_runs_conversation_started_idx").on(table.conversationId, table.startedAt),
]);

export const insertAgentRunSchema = createInsertSchema(agentRuns).omit({
  id: true,
  startedAt: true,
});

export type InsertAgentRun = z.infer<typeof insertAgentRunSchema>;
export type AgentRun = typeof agentRuns.$inferSelect;

export const agentSteps = pgTable("agent_steps", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  runId: varchar("run_id").notNull().references(() => agentRuns.id, { onDelete: "cascade" }),
  stepType: text("step_type").notNull(), // navigate, extract, click, input, screenshot, document
  url: text("url"),
  detail: jsonb("detail"),
  screenshot: text("screenshot"), // storage path
  startedAt: timestamp("started_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
  success: text("success").default("pending"), // pending, success, failed
  error: text("error"),
  stepIndex: integer("step_index").notNull().default(0),
}, (table) => [
  index("agent_steps_run_idx").on(table.runId),
  index("agent_steps_run_step_idx").on(table.runId, table.stepIndex),
]);

export const insertAgentStepSchema = createInsertSchema(agentSteps).omit({
  id: true,
  startedAt: true,
});

export type InsertAgentStep = z.infer<typeof insertAgentStepSchema>;
export type AgentStep = typeof agentSteps.$inferSelect;

export const agentAssets = pgTable("agent_assets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  runId: varchar("run_id").notNull().references(() => agentRuns.id, { onDelete: "cascade" }),
  stepId: varchar("step_id").references(() => agentSteps.id, { onDelete: "set null" }),
  assetType: text("asset_type").notNull(), // screenshot, document, extracted_content
  storagePath: text("storage_path"),
  content: text("content"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("agent_assets_run_idx").on(table.runId),
]);

export const insertAgentAssetSchema = createInsertSchema(agentAssets).omit({
  id: true,
  createdAt: true,
});

export type InsertAgentAsset = z.infer<typeof insertAgentAssetSchema>;
export type AgentAsset = typeof agentAssets.$inferSelect;

export const cachedPages = pgTable("cached_pages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  urlHash: text("url_hash").notNull().unique(),
  url: text("url").notNull(),
  title: text("title"),
  content: text("content"),
  fetchedAt: timestamp("fetched_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at"),
}, (table) => [
  index("cached_pages_url_hash_idx").on(table.urlHash),
]);

export const insertCachedPageSchema = createInsertSchema(cachedPages).omit({
  id: true,
  fetchedAt: true,
});

export type InsertCachedPage = z.infer<typeof insertCachedPageSchema>;
export type CachedPage = typeof cachedPages.$inferSelect;

export const domainPolicies = pgTable("domain_policies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  domain: text("domain").notNull().unique(),
  allowNavigation: text("allow_navigation").notNull().default("true"),
  cookiePolicy: text("cookie_policy").default("accept"), // accept, reject, essential
  rateLimit: integer("rate_limit").default(10), // requests per minute
  customHeaders: jsonb("custom_headers"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertDomainPolicySchema = createInsertSchema(domainPolicies).omit({
  id: true,
  createdAt: true,
});

export type InsertDomainPolicy = z.infer<typeof insertDomainPolicySchema>;
export type DomainPolicy = typeof domainPolicies.$inferSelect;

export const chats = pgTable("chats", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id"),
  title: text("title").notNull().default("New Chat"),
  gptId: varchar("gpt_id"),
  archived: text("archived").default("false"),
  hidden: text("hidden").default("false"),
  pinned: text("pinned").default("false"),
  pinnedAt: timestamp("pinned_at"),
  deletedAt: timestamp("deleted_at"),
  lastMessageAt: timestamp("last_message_at"),
  messageCount: integer("message_count").default(0),
  tokensUsed: integer("tokens_used").default(0),
  aiModelUsed: text("ai_model_used"),
  conversationStatus: text("conversation_status").default("active"), // active, completed, flagged
  flagStatus: text("flag_status"), // reviewed, needs_attention, spam, vip_support
  endedAt: timestamp("ended_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("chats_user_idx").on(table.userId),
  index("chats_status_idx").on(table.conversationStatus),
  index("chats_flag_idx").on(table.flagStatus),
  index("chats_user_updated_idx").on(table.userId, table.updatedAt),
  index("chats_user_archived_deleted_idx").on(table.userId, table.archived, table.deletedAt),
  index("chats_updated_at_idx").on(table.updatedAt),
]);

export const insertChatSchema = createInsertSchema(chats).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertChat = z.infer<typeof insertChatSchema>;
export type Chat = typeof chats.$inferSelect;

export const chatMessages = pgTable("chat_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  chatId: varchar("chat_id").notNull().references(() => chats.id, { onDelete: "cascade" }),
  runId: varchar("run_id"), // FK to the run this message belongs to (for run-based idempotency)
  role: text("role").notNull(), // "user" or "assistant"
  content: text("content").notNull(),
  status: text("status").default("done"), // pending, processing, done, failed - for idempotency
  requestId: varchar("request_id"), // UUID for idempotency - prevents duplicate processing (legacy)
  userMessageId: varchar("user_message_id"), // For assistant messages: links to the user message it responds to
  sequence: integer("sequence"), // Sequence number within the run (for streaming dedup)
  attachments: jsonb("attachments"), // array of attachments
  sources: jsonb("sources"), // array of sources
  figmaDiagram: jsonb("figma_diagram"), // Figma diagram data
  googleFormPreview: jsonb("google_form_preview"), // Google Forms preview data
  gmailPreview: jsonb("gmail_preview"), // Gmail preview data
  generatedImage: text("generated_image"), // Base64 or URL of generated image
  metadata: jsonb("metadata"), // Additional metadata for extensibility
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("chat_messages_chat_idx").on(table.chatId),
  index("chat_messages_request_idx").on(table.requestId),
  index("chat_messages_status_idx").on(table.status),
  uniqueIndex("chat_messages_request_unique").on(table.requestId),
  index("chat_messages_chat_created_idx").on(table.chatId, table.createdAt),
  index("chat_messages_created_at_idx").on(table.createdAt),
]);

export const insertChatMessageSchema = createInsertSchema(chatMessages).omit({
  id: true,
  createdAt: true,
});

export type InsertChatMessage = z.infer<typeof insertChatMessageSchema>;
export type ChatMessage = typeof chatMessages.$inferSelect;

// Chat Runs - Each user submission creates an idempotent "run"
// A run tracks: user_message creation -> AI processing -> assistant_message response
export const chatRuns = pgTable("chat_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  chatId: varchar("chat_id").notNull().references(() => chats.id, { onDelete: "cascade" }),
  clientRequestId: varchar("client_request_id").notNull(), // UUID from frontend - idempotency key
  userMessageId: varchar("user_message_id"), // FK to the user message that triggered this run
  assistantMessageId: varchar("assistant_message_id"), // FK to the assistant response message
  status: text("status").notNull().default("pending"), // pending, processing, done, failed, cancelled
  lastSeq: integer("last_seq").default(0), // Last sequence number processed (for streaming dedup)
  error: text("error"), // Error message if failed
  metadata: jsonb("metadata"), // Additional run metadata
  createdAt: timestamp("created_at").defaultNow().notNull(),
  startedAt: timestamp("started_at"), // When processing started
  completedAt: timestamp("completed_at"), // When processing completed
}, (table) => [
  index("chat_runs_chat_idx").on(table.chatId),
  index("chat_runs_status_idx").on(table.status),
  uniqueIndex("chat_runs_client_request_unique").on(table.chatId, table.clientRequestId),
  index("chat_runs_chat_created_idx").on(table.chatId, table.createdAt),
]);

export const insertChatRunSchema = createInsertSchema(chatRuns).omit({
  id: true,
  createdAt: true,
  startedAt: true,
  completedAt: true,
});

export type InsertChatRun = z.infer<typeof insertChatRunSchema>;
export type ChatRun = typeof chatRuns.$inferSelect;

// Conversation Documents - Persistent document context for chat conversations
// Stores extracted content from uploaded documents to maintain context across messages
export const conversationDocuments = pgTable("conversation_documents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  chatId: varchar("chat_id").notNull().references(() => chats.id, { onDelete: "cascade" }),
  messageId: varchar("message_id").references(() => chatMessages.id, { onDelete: "set null" }),
  fileName: text("file_name").notNull(),
  storagePath: text("storage_path"),
  mimeType: text("mime_type").notNull(),
  fileSize: integer("file_size"),
  extractedText: text("extracted_text"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("conversation_documents_chat_idx").on(table.chatId),
  index("conversation_documents_created_idx").on(table.chatId, table.createdAt),
]);

export const insertConversationDocumentSchema = createInsertSchema(conversationDocuments).omit({
  id: true,
  createdAt: true,
});

export type InsertConversationDocument = z.infer<typeof insertConversationDocumentSchema>;
export type ConversationDocument = typeof conversationDocuments.$inferSelect;

// Tool Invocations - Track tool calls within a run for idempotency
export const toolInvocations = pgTable("tool_invocations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  runId: varchar("run_id").notNull().references(() => chatRuns.id, { onDelete: "cascade" }),
  toolCallId: varchar("tool_call_id").notNull(), // Tool call ID from the model
  toolName: text("tool_name").notNull(),
  input: jsonb("input"), // Tool input parameters
  output: jsonb("output"), // Tool output/result
  status: text("status").notNull().default("pending"), // pending, running, done, failed
  error: text("error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
}, (table) => [
  index("tool_invocations_run_idx").on(table.runId),
  uniqueIndex("tool_invocations_unique").on(table.runId, table.toolCallId),
  index("tool_invocations_run_created_idx").on(table.runId, table.createdAt),
]);

export const insertToolInvocationSchema = createInsertSchema(toolInvocations).omit({
  id: true,
  createdAt: true,
  completedAt: true,
});

export type InsertToolInvocation = z.infer<typeof insertToolInvocationSchema>;
export type ToolInvocation = typeof toolInvocations.$inferSelect;

// Chat sharing - participantes con acceso a chats específicos
export const chatShares = pgTable("chat_shares", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  chatId: varchar("chat_id").notNull().references(() => chats.id, { onDelete: "cascade" }),
  recipientUserId: varchar("recipient_user_id"),
  email: text("email").notNull(),
  role: text("role").notNull().default("viewer"), // owner, editor, viewer
  invitedBy: varchar("invited_by"),
  notificationSent: text("notification_sent").default("false"),
  acceptedAt: timestamp("accepted_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("chat_shares_chat_idx").on(table.chatId),
  index("chat_shares_email_idx").on(table.email),
  index("chat_shares_recipient_idx").on(table.recipientUserId),
]);

export const insertChatShareSchema = createInsertSchema(chatShares).omit({
  id: true,
  createdAt: true,
});

export type InsertChatShare = z.infer<typeof insertChatShareSchema>;
export type ChatShare = typeof chatShares.$inferSelect;

// GPT Categories
export const gptCategories = pgTable("gpt_categories", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  icon: text("icon"),
  sortOrder: integer("sort_order").default(0),
});

export const insertGptCategorySchema = createInsertSchema(gptCategories).omit({
  id: true,
});

export type InsertGptCategory = z.infer<typeof insertGptCategorySchema>;
export type GptCategory = typeof gptCategories.$inferSelect;

// GPT Visibility Schema
export const gptVisibilitySchema = z.enum(['private', 'team', 'public']);
export type GptVisibility = z.infer<typeof gptVisibilitySchema>;

// GPT Capabilities Schema
export const gptCapabilitiesSchema = z.object({
  webBrowsing: z.boolean().default(false),
  codeInterpreter: z.boolean().default(false),
  imageGeneration: z.boolean().default(false),
  fileUpload: z.boolean().default(false),
  dataAnalysis: z.boolean().default(false),
});

// GPT Runtime Policy Schema
export const gptRuntimePolicySchema = z.object({
  enforceModel: z.boolean().default(false),
  modelFallbacks: z.array(z.string()).default([]),
  maxTokensOverride: z.number().optional(),
  temperatureOverride: z.number().optional(),
  allowClientOverride: z.boolean().default(false),
});

// GPT Tool Permissions Schema
export const gptToolPermissionsSchema = z.object({
  mode: z.enum(['allowlist', 'denylist']).default('allowlist'),
  tools: z.array(z.string()).default([]),
  actionsEnabled: z.boolean().default(true),
});

// Custom GPTs
export const gpts = pgTable("gpts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  avatar: text("avatar"),
  categoryId: varchar("category_id").references(() => gptCategories.id),
  creatorId: varchar("creator_id"),
  visibility: text("visibility").default("private"), // private, team, public
  systemPrompt: text("system_prompt").notNull(),
  temperature: text("temperature").default("0.7"),
  topP: text("top_p").default("1"),
  maxTokens: integer("max_tokens").default(4096),
  welcomeMessage: text("welcome_message"),
  capabilities: jsonb("capabilities"), // { webBrowsing: boolean, codeInterpreter: boolean, imageGeneration: boolean }
  conversationStarters: jsonb("conversation_starters"), // array of starter prompts
  usageCount: integer("usage_count").default(0),
  version: integer("version").default(1),
  recommendedModel: text("recommended_model"),
  runtimePolicy: jsonb("runtime_policy").$type<z.infer<typeof gptRuntimePolicySchema>>(),
  toolPermissions: jsonb("tool_permissions").$type<z.infer<typeof gptToolPermissionsSchema>>(),
  isPublished: text("is_published").default("false"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("gpts_category_idx").on(table.categoryId),
  index("gpts_creator_idx").on(table.creatorId),
  index("gpts_visibility_idx").on(table.visibility),
]);

export const insertGptSchema = createInsertSchema(gpts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  usageCount: true,
}).extend({
  recommendedModel: z.string().optional(),
  runtimePolicy: gptRuntimePolicySchema.optional(),
  toolPermissions: gptToolPermissionsSchema.optional(),
});

export type InsertGpt = z.infer<typeof insertGptSchema>;
export type Gpt = typeof gpts.$inferSelect;

// GPT Versions for version control
export const gptVersions = pgTable("gpt_versions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  gptId: varchar("gpt_id").notNull().references(() => gpts.id, { onDelete: "cascade" }),
  versionNumber: integer("version_number").notNull(),
  systemPrompt: text("system_prompt").notNull(),
  temperature: text("temperature").default("0.7"),
  topP: text("top_p").default("1"),
  maxTokens: integer("max_tokens").default(4096),
  changeNotes: text("change_notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  createdBy: varchar("created_by"),
}, (table) => [
  index("gpt_versions_gpt_idx").on(table.gptId),
]);

export const insertGptVersionSchema = createInsertSchema(gptVersions).omit({
  id: true,
  createdAt: true,
});

export type InsertGptVersion = z.infer<typeof insertGptVersionSchema>;
export type GptVersion = typeof gptVersions.$inferSelect;

// GPT Knowledge Base - files and documents attached to GPTs
export const gptKnowledge = pgTable("gpt_knowledge", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  gptId: varchar("gpt_id").notNull().references(() => gpts.id, { onDelete: "cascade" }),
  fileName: text("file_name").notNull(),
  fileType: text("file_type").notNull(), // pdf, txt, docx, xlsx, etc.
  fileSize: integer("file_size").notNull(),
  storageUrl: text("storage_url").notNull(),
  contentHash: text("content_hash"), // for deduplication
  extractedText: text("extracted_text"), // parsed text content for RAG
  embeddingStatus: text("embedding_status").default("pending"), // pending, processing, completed, failed
  chunkCount: integer("chunk_count").default(0),
  metadata: jsonb("metadata"), // { pages, wordCount, language, etc. }
  isActive: text("is_active").default("true"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("gpt_knowledge_gpt_idx").on(table.gptId),
  index("gpt_knowledge_status_idx").on(table.embeddingStatus),
]);

export const insertGptKnowledgeSchema = createInsertSchema(gptKnowledge).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  chunkCount: true,
});

export type InsertGptKnowledge = z.infer<typeof insertGptKnowledgeSchema>;
export type GptKnowledge = typeof gptKnowledge.$inferSelect;

// GPT Actions - custom API integrations for GPTs
export const gptActions = pgTable("gpt_actions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  gptId: varchar("gpt_id").notNull().references(() => gpts.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  actionType: text("action_type").notNull().default("api"), // api, webhook, function
  httpMethod: text("http_method").default("GET"), // GET, POST, PUT, DELETE, PATCH
  endpoint: text("endpoint").notNull(),
  headers: jsonb("headers"), // { "Authorization": "Bearer {{API_KEY}}", etc. }
  bodyTemplate: text("body_template"), // JSON template with {{variable}} placeholders
  responseMapping: jsonb("response_mapping"), // how to parse the response
  authType: text("auth_type").default("none"), // none, api_key, oauth, bearer
  authConfig: jsonb("auth_config"), // encrypted auth configuration
  parameters: jsonb("parameters"), // [{ name, type, required, description }]
  rateLimit: integer("rate_limit").default(100), // calls per minute
  timeout: integer("timeout").default(30000), // ms
  isActive: text("is_active").default("true"),
  lastUsedAt: timestamp("last_used_at"),
  usageCount: integer("usage_count").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("gpt_actions_gpt_idx").on(table.gptId),
  index("gpt_actions_type_idx").on(table.actionType),
]);

export const insertGptActionSchema = createInsertSchema(gptActions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  usageCount: true,
  lastUsedAt: true,
});

export type InsertGptAction = z.infer<typeof insertGptActionSchema>;
export type GptAction = typeof gptActions.$inferSelect;

// Sidebar Pinned GPTs - user preferences for GPTs shown in sidebar
export const sidebarPinnedGpts = pgTable("sidebar_pinned_gpts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id).notNull(),
  gptId: varchar("gpt_id").references(() => gpts.id).notNull(),
  displayOrder: integer("display_order").default(0),
  pinnedAt: timestamp("pinned_at").defaultNow().notNull(),
}, (table) => [
  index("sidebar_pinned_gpts_user_idx").on(table.userId),
  index("sidebar_pinned_gpts_gpt_idx").on(table.gptId),
]);

export const insertSidebarPinnedGptSchema = createInsertSchema(sidebarPinnedGpts).omit({
  id: true,
  pinnedAt: true,
});

export type InsertSidebarPinnedGpt = z.infer<typeof insertSidebarPinnedGptSchema>;
export type SidebarPinnedGpt = typeof sidebarPinnedGpts.$inferSelect;

// GPT Sessions - Immutable session contracts with frozen config
export const gptSessions = pgTable("gpt_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  chatId: varchar("chat_id").references(() => chats.id, { onDelete: "cascade" }),
  gptId: varchar("gpt_id").notNull().references(() => gpts.id),
  configVersion: integer("config_version").notNull(),
  frozenSystemPrompt: text("frozen_system_prompt").notNull(),
  frozenCapabilities: jsonb("frozen_capabilities").$type<z.infer<typeof gptCapabilitiesSchema>>(),
  frozenToolPermissions: jsonb("frozen_tool_permissions").$type<z.infer<typeof gptToolPermissionsSchema>>(),
  frozenRuntimePolicy: jsonb("frozen_runtime_policy").$type<z.infer<typeof gptRuntimePolicySchema>>(),
  enforcedModelId: text("enforced_model_id"),
  knowledgeContextIds: jsonb("knowledge_context_ids").$type<string[]>().default([]),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at"),
}, (table) => [
  index("gpt_sessions_chat_idx").on(table.chatId),
  index("gpt_sessions_gpt_idx").on(table.gptId),
]);

export const insertGptSessionSchema = createInsertSchema(gptSessions).omit({
  id: true,
  createdAt: true,
}).extend({
  frozenCapabilities: gptCapabilitiesSchema.optional(),
  frozenToolPermissions: gptToolPermissionsSchema.optional(),
  frozenRuntimePolicy: gptRuntimePolicySchema.optional(),
  knowledgeContextIds: z.array(z.string()).optional(),
});

export type InsertGptSession = z.infer<typeof insertGptSessionSchema>;
export type GptSession = typeof gptSessions.$inferSelect;

// Admin Tables

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
  isDeprecated: text("is_deprecated").default("false"),
  releaseDate: text("release_date"),
  isEnabled: text("is_enabled").default("false"),
  enabledAt: timestamp("enabled_at"),
  enabledByAdminId: varchar("enabled_by_admin_id"),
  displayOrder: integer("display_order").default(0),
  icon: text("icon"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("ai_models_provider_idx").on(table.provider),
  index("ai_models_model_type_idx").on(table.modelType),
  index("ai_models_status_idx").on(table.status),
  index("ai_models_is_enabled_idx").on(table.isEnabled),
]);

export const insertAiModelSchema = createInsertSchema(aiModels).omit({
  id: true,
  createdAt: true,
});

export type InsertAiModel = z.infer<typeof insertAiModelSchema>;
export type AiModel = typeof aiModels.$inferSelect;

// Payments
export const payments = pgTable("payments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id),
  amount: text("amount").notNull(),
  currency: text("currency").default("EUR"),
  status: text("status").default("pending"),
  method: text("method"),
  description: text("description"),
  stripePaymentId: text("stripe_payment_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("payments_user_idx").on(table.userId),
]);

export const insertPaymentSchema = createInsertSchema(payments).omit({
  id: true,
  createdAt: true,
});

export type InsertPayment = z.infer<typeof insertPaymentSchema>;
export type Payment = typeof payments.$inferSelect;

// Invoices
export const invoices = pgTable("invoices", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id),
  paymentId: varchar("payment_id").references(() => payments.id),
  invoiceNumber: text("invoice_number").notNull(),
  amount: text("amount").notNull(),
  currency: text("currency").default("EUR"),
  status: text("status").default("pending"),
  dueDate: timestamp("due_date"),
  paidAt: timestamp("paid_at"),
  pdfPath: text("pdf_path"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("invoices_user_idx").on(table.userId),
]);

export const insertInvoiceSchema = createInsertSchema(invoices).omit({
  id: true,
  createdAt: true,
});

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

export const insertPlatformSettingSchema = createInsertSchema(platformSettings).omit({
  id: true,
  updatedAt: true,
});

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
}, (table) => [
  index("audit_logs_user_idx").on(table.userId),
  index("audit_logs_action_idx").on(table.action),
]);

export const insertAuditLogSchema = createInsertSchema(auditLogs).omit({
  id: true,
  createdAt: true,
});

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

export const insertAnalyticsSnapshotSchema = createInsertSchema(analyticsSnapshots).omit({
  id: true,
  createdAt: true,
});

export type InsertAnalyticsSnapshot = z.infer<typeof insertAnalyticsSnapshotSchema>;
export type AnalyticsSnapshot = typeof analyticsSnapshots.$inferSelect;

// Reports
export const reports = pgTable("reports", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  type: text("type").notNull(),
  status: text("status").default("pending"),
  parameters: jsonb("parameters"),
  filePath: text("file_path"),
  generatedBy: varchar("generated_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
});

export const insertReportSchema = createInsertSchema(reports).omit({
  id: true,
  createdAt: true,
});

export type InsertReport = z.infer<typeof insertReportSchema>;
export type Report = typeof reports.$inferSelect;

// Chat Participants for sharing chats
export const chatParticipants = pgTable("chat_participants", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  chatId: varchar("chat_id").notNull().references(() => chats.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: text("role").notNull().default("viewer"), // owner, editor, viewer
  invitedBy: varchar("invited_by"),
  invitedAt: timestamp("invited_at").defaultNow().notNull(),
  acceptedAt: timestamp("accepted_at"),
}, (table) => [
  index("chat_participants_chat_idx").on(table.chatId),
  index("chat_participants_email_idx").on(table.email),
  uniqueIndex("chat_participants_unique_idx").on(table.chatId, table.email),
]);

export const insertChatParticipantSchema = createInsertSchema(chatParticipants).omit({
  id: true,
  invitedAt: true,
});

export type InsertChatParticipant = z.infer<typeof insertChatParticipantSchema>;
export type ChatParticipant = typeof chatParticipants.$inferSelect;

// Library Items - User media library
export const libraryItems = pgTable("library_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  mediaType: text("media_type").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  storagePath: text("storage_path").notNull(),
  thumbnailPath: text("thumbnail_path"),
  mimeType: text("mime_type"),
  size: integer("size"),
  metadata: jsonb("metadata"),
  sourceChatId: varchar("source_chat_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("library_items_user_idx").on(table.userId),
  index("library_items_type_idx").on(table.userId, table.mediaType),
]);

export const insertLibraryItemSchema = createInsertSchema(libraryItems).omit({
  id: true,
  createdAt: true,
});

export type InsertLibraryItem = z.infer<typeof insertLibraryItemSchema>;
export type LibraryItem = typeof libraryItems.$inferSelect;

// Code Interpreter Runs
export const codeInterpreterRuns = pgTable("code_interpreter_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  conversationId: varchar("conversation_id"),
  userId: varchar("user_id"),
  code: text("code").notNull(),
  language: text("language").notNull().default("python"),
  status: text("status").notNull().default("pending"), // pending, running, success, error
  stdout: text("stdout"),
  stderr: text("stderr"),
  executionTimeMs: integer("execution_time_ms"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("code_runs_conversation_idx").on(table.conversationId),
  index("code_runs_user_idx").on(table.userId),
]);

export const insertCodeInterpreterRunSchema = createInsertSchema(codeInterpreterRuns).omit({
  id: true,
  createdAt: true,
});

export type InsertCodeInterpreterRun = z.infer<typeof insertCodeInterpreterRunSchema>;
export type CodeInterpreterRun = typeof codeInterpreterRuns.$inferSelect;

// ========================================
// Notification Preferences System
// ========================================

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
}, (table) => [
  index("notification_prefs_user_idx").on(table.userId),
  uniqueIndex("notification_prefs_unique_idx").on(table.userId, table.eventTypeId),
]);

export const insertNotificationPreferenceSchema = createInsertSchema(notificationPreferences).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

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
}, (table) => [
  index("notification_logs_user_idx").on(table.userId),
  index("notification_logs_event_idx").on(table.eventId),
  uniqueIndex("notification_logs_idempotency_idx").on(table.eventId, table.channel),
]);

export const insertNotificationLogSchema = createInsertSchema(notificationLogs).omit({
  id: true,
  createdAt: true,
});

export type InsertNotificationLog = z.infer<typeof insertNotificationLogSchema>;
export type NotificationLog = typeof notificationLogs.$inferSelect;

// Code Interpreter Artifacts (generated files, charts, etc.)
export const codeInterpreterArtifacts = pgTable("code_interpreter_artifacts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  runId: varchar("run_id").notNull().references(() => codeInterpreterRuns.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // image, file, data
  name: text("name").notNull(),
  data: text("data"), // base64 encoded for images, or text content
  mimeType: text("mime_type"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("code_artifacts_run_idx").on(table.runId),
]);

export const insertCodeInterpreterArtifactSchema = createInsertSchema(codeInterpreterArtifacts).omit({
  id: true,
  createdAt: true,
});

export type InsertCodeInterpreterArtifact = z.infer<typeof insertCodeInterpreterArtifactSchema>;
export type CodeInterpreterArtifact = typeof codeInterpreterArtifacts.$inferSelect;

// ========================================
// Company Knowledge System
// ========================================

export const companyKnowledge = pgTable("company_knowledge", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  content: text("content").notNull(),
  category: text("category").default("general"),
  isActive: text("is_active").default("true"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("company_knowledge_user_idx").on(table.userId),
  index("company_knowledge_category_idx").on(table.category),
]);

export const insertCompanyKnowledgeSchema = createInsertSchema(companyKnowledge).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertCompanyKnowledge = z.infer<typeof insertCompanyKnowledgeSchema>;
export type CompanyKnowledge = typeof companyKnowledge.$inferSelect;

// ========================================
// Response Quality Metrics (Enterprise Scalability)
// ========================================

export const responseQualityMetrics = pgTable("response_quality_metrics", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  runId: varchar("run_id"),
  requestId: varchar("request_id").notNull(),
  provider: text("provider").notNull(),
  score: integer("score").notNull(),
  issues: text("issues").array(),
  tokensUsed: integer("tokens_used"),
  latencyMs: integer("latency_ms"),
  userId: varchar("user_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("response_quality_metrics_created_idx").on(table.createdAt),
  index("response_quality_metrics_provider_created_idx").on(table.provider, table.createdAt),
  index("response_quality_metrics_user_created_idx").on(table.userId, table.createdAt),
]);

export const insertResponseQualityMetricSchema = createInsertSchema(responseQualityMetrics).omit({
  id: true,
  createdAt: true,
});

export type InsertResponseQualityMetric = z.infer<typeof insertResponseQualityMetricSchema>;
export type ResponseQualityMetric = typeof responseQualityMetrics.$inferSelect;

// ========================================
// Connector Usage Hourly (Enterprise Metrics)
// ========================================

export const connectorUsageHourly = pgTable("connector_usage_hourly", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  connector: text("connector").notNull(),
  hourBucket: timestamp("hour_bucket").notNull(),
  totalCalls: integer("total_calls").default(0),
  successCount: integer("success_count").default(0),
  failureCount: integer("failure_count").default(0),
  totalLatencyMs: integer("total_latency_ms").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("connector_usage_hourly_connector_bucket_idx").on(table.connector, table.hourBucket),
  index("connector_usage_hourly_connector_created_idx").on(table.connector, table.createdAt),
]);

export const insertConnectorUsageHourlySchema = createInsertSchema(connectorUsageHourly).omit({
  id: true,
  createdAt: true,
});

export type InsertConnectorUsageHourly = z.infer<typeof insertConnectorUsageHourlySchema>;
export type ConnectorUsageHourly = typeof connectorUsageHourly.$inferSelect;

// ========================================
// Offline Message Queue (Resilience)
// ========================================

export const offlineMessageQueue = pgTable("offline_message_queue", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tempId: varchar("temp_id").notNull().unique(),
  userId: varchar("user_id"),
  chatId: varchar("chat_id").references(() => chats.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  status: text("status").default("pending"),
  retryCount: integer("retry_count").default(0),
  error: text("error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  syncedAt: timestamp("synced_at"),
}, (table) => [
  index("offline_message_queue_status_created_idx").on(table.status, table.createdAt),
  index("offline_message_queue_user_status_idx").on(table.userId, table.status),
]);

export const insertOfflineMessageQueueSchema = createInsertSchema(offlineMessageQueue).omit({
  id: true,
  createdAt: true,
  syncedAt: true,
});

export type InsertOfflineMessageQueue = z.infer<typeof insertOfflineMessageQueueSchema>;
export type OfflineMessageQueue = typeof offlineMessageQueue.$inferSelect;

// ========================================
// Gmail OAuth Tokens (Custom MCP Integration)
// ========================================

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
}, (table) => [
  index("gmail_oauth_user_idx").on(table.userId),
  uniqueIndex("gmail_oauth_user_email_idx").on(table.userId, table.accountEmail),
]);

export const insertGmailOAuthTokenSchema = createInsertSchema(gmailOAuthTokens).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertGmailOAuthToken = z.infer<typeof insertGmailOAuthTokenSchema>;
export type GmailOAuthToken = typeof gmailOAuthTokens.$inferSelect;

// ========================================
// Admin Dashboard Tables
// ========================================

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
}, (table) => [
  index("admin_audit_logs_admin_idx").on(table.adminId),
  index("admin_audit_logs_action_idx").on(table.action),
  index("admin_audit_logs_created_idx").on(table.createdAt),
]);

export const insertAdminAuditLogSchema = createInsertSchema(adminAuditLogs).omit({
  id: true,
  createdAt: true,
});

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
}, (table) => [
  index("ai_model_usage_user_idx").on(table.userId),
  index("ai_model_usage_provider_idx").on(table.provider),
  index("ai_model_usage_created_idx").on(table.createdAt),
]);

export const insertAiModelUsageSchema = createInsertSchema(aiModelUsage).omit({
  id: true,
  createdAt: true,
});

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
}, (table) => [
  index("security_events_user_idx").on(table.userId),
  index("security_events_type_idx").on(table.eventType),
  index("security_events_severity_idx").on(table.severity),
  index("security_events_created_idx").on(table.createdAt),
]);

export const insertSecurityEventSchema = createInsertSchema(securityEvents).omit({
  id: true,
  createdAt: true,
  resolvedAt: true,
});

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
}, (table) => [
  index("admin_reports_type_idx").on(table.type),
  index("admin_reports_status_idx").on(table.status),
  index("admin_reports_generated_by_idx").on(table.generatedBy),
]);

export const insertAdminReportSchema = createInsertSchema(adminReports).omit({
  id: true,
  createdAt: true,
  completedAt: true,
});

export type InsertAdminReport = z.infer<typeof insertAdminReportSchema>;
export type AdminReport = typeof adminReports.$inferSelect;

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
}, (table) => [
  index("scheduled_reports_active_next_idx").on(table.isActive, table.nextRunAt),
]);

export const insertScheduledReportSchema = createInsertSchema(scheduledReports).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  lastRunAt: true,
});

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
}, (table) => [
  index("ip_blocklist_ip_idx").on(table.ipAddress),
  index("ip_blocklist_expires_idx").on(table.expiresAt),
]);

export const insertIpBlocklistSchema = createInsertSchema(ipBlocklist).omit({
  id: true,
  createdAt: true,
});

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
}, (table) => [
  index("analytics_events_user_idx").on(table.userId),
  index("analytics_events_event_idx").on(table.eventName),
  index("analytics_events_created_idx").on(table.createdAt),
  index("analytics_events_user_created_idx").on(table.userId, table.createdAt),
]);

export const insertAnalyticsEventSchema = createInsertSchema(analyticsEvents).omit({
  id: true,
  createdAt: true,
});

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
}, (table) => [
  index("provider_metrics_provider_idx").on(table.provider),
  index("provider_metrics_window_idx").on(table.windowStart, table.windowEnd),
]);

export const insertProviderMetricsSchema = createInsertSchema(providerMetrics).omit({
  id: true,
  createdAt: true,
});

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
}, (table) => [
  index("cost_budgets_provider_idx").on(table.provider),
]);

export const insertCostBudgetSchema = createInsertSchema(costBudgets).omit({
  id: true,
  updatedAt: true,
});

export type InsertCostBudget = z.infer<typeof insertCostBudgetSchema>;
export type CostBudget = typeof costBudgets.$inferSelect;

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
}, (table) => [
  index("api_logs_user_idx").on(table.userId),
  index("api_logs_endpoint_idx").on(table.endpoint),
  index("api_logs_created_idx").on(table.createdAt),
  index("api_logs_status_idx").on(table.statusCode),
  index("api_logs_provider_idx").on(table.provider),
  index("api_logs_user_created_idx").on(table.userId, table.createdAt),
]);

export const insertApiLogSchema = createInsertSchema(apiLogs).omit({
  id: true,
  createdAt: true,
});

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
}, (table) => [
  index("kpi_snapshots_created_idx").on(table.createdAt),
]);

export const insertKpiSnapshotSchema = createInsertSchema(kpiSnapshots).omit({
  id: true,
  createdAt: true,
});

export type InsertKpiSnapshot = z.infer<typeof insertKpiSnapshotSchema>;
export type KpiSnapshot = typeof kpiSnapshots.$inferSelect;

// ========================================
// Security Center - Enterprise Security Policies
// ========================================

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
}, (table) => [
  index("security_policies_type_idx").on(table.policyType),
  index("security_policies_enabled_idx").on(table.isEnabled),
  index("security_policies_applied_idx").on(table.appliedTo),
]);

export const insertSecurityPolicySchema = createInsertSchema(securityPolicies).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertSecurityPolicy = z.infer<typeof insertSecurityPolicySchema>;
export type SecurityPolicy = typeof securityPolicies.$inferSelect;

// ========================================
// Reports Center - Templates and Generated Reports
// ========================================

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
}, (table) => [
  index("report_templates_type_idx").on(table.type),
]);

export const insertReportTemplateSchema = createInsertSchema(reportTemplates).omit({
  id: true,
  createdAt: true,
});

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
}, (table) => [
  index("generated_reports_status_idx").on(table.status),
  index("generated_reports_created_idx").on(table.createdAt),
]);

export const insertGeneratedReportSchema = createInsertSchema(generatedReports).omit({
  id: true,
  createdAt: true,
});

export type InsertGeneratedReport = z.infer<typeof insertGeneratedReportSchema>;
export type GeneratedReport = typeof generatedReports.$inferSelect;

// ========================================
// Settings Configuration
// ========================================

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
}, (table) => [
  index("settings_category_idx").on(table.category),
]);

export const insertSettingsConfigSchema = createInsertSchema(settingsConfig).omit({
  id: true,
  updatedAt: true,
});

export type InsertSettingsConfig = z.infer<typeof insertSettingsConfigSchema>;
export type SettingsConfig = typeof settingsConfig.$inferSelect;

// ========================================
// Agentic Engine - Gap Logging
// ========================================

export const agentGapLogs = pgTable("agent_gap_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userPrompt: text("user_prompt").notNull(),
  detectedIntent: text("detected_intent"),
  gapReason: text("gap_reason"),
  suggestedCapability: text("suggested_capability"),
  status: text("status").default("pending"),
  reviewedBy: varchar("reviewed_by"),
  gapSignature: varchar("gap_signature"),
  frequencyCount: integer("frequency_count").default(1),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("agent_gap_logs_status_idx").on(table.status),
  index("agent_gap_logs_created_idx").on(table.createdAt),
  index("agent_gap_logs_signature_idx").on(table.gapSignature),
]);

export const insertAgentGapLogSchema = createInsertSchema(agentGapLogs).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertAgentGapLog = z.infer<typeof insertAgentGapLogSchema>;
export type AgentGapLog = typeof agentGapLogs.$inferSelect;

// ========================================
// Excel Documents
// ========================================

export const excelDocuments = pgTable('excel_documents', {
  id: serial('id').primaryKey(),
  uuid: text('uuid').notNull().unique(),
  name: text('name').notNull(),
  data: jsonb('data'),
  sheets: jsonb('sheets'),
  metadata: jsonb('metadata'),
  createdBy: integer('created_by'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  size: integer('size').default(0),
  isTemplate: boolean('is_template').default(false),
  templateCategory: text('template_category'),
  version: integer('version').default(1)
}, (table) => [
  index("excel_documents_uuid_idx").on(table.uuid),
  index("excel_documents_created_idx").on(table.createdAt),
]);

export const insertExcelDocumentSchema = createInsertSchema(excelDocuments).omit({
  id: true,
  createdAt: true,
  updatedAt: true
});

export type InsertExcelDocument = z.infer<typeof insertExcelDocumentSchema>;
export type ExcelDocument = typeof excelDocuments.$inferSelect;

// ========================================
// Enhanced Multimedia Library System
// ========================================

export const libraryFileMetadataSchema = z.object({
  exif: z.record(z.any()).optional(),
  colors: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  aiDescription: z.string().optional(),
  sourceChat: z.string().optional(),
  sourceMessage: z.string().optional(),
  generatedBy: z.enum(['ai', 'user', 'system']).optional(),
  originalPrompt: z.string().optional(),
});

export const libraryFolders = pgTable('library_folders', {
  id: serial('id').primaryKey(),
  uuid: text('uuid').notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),
  color: text('color').default('#6366f1'),
  icon: text('icon').default('folder'),
  parentId: integer('parent_id'),
  path: text('path').notNull(),
  userId: varchar('user_id').notNull(),
  isSystem: boolean('is_system').default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('library_folders_user_idx').on(table.userId),
  index('library_folders_parent_idx').on(table.parentId),
]);

export const insertLibraryFolderSchema = createInsertSchema(libraryFolders).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertLibraryFolder = z.infer<typeof insertLibraryFolderSchema>;
export type LibraryFolder = typeof libraryFolders.$inferSelect;

export const libraryFiles = pgTable('library_files', {
  id: serial('id').primaryKey(),
  uuid: text('uuid').notNull().unique(),
  name: text('name').notNull(),
  originalName: text('original_name').notNull(),
  description: text('description'),
  type: text('type').notNull(),
  mimeType: text('mime_type').notNull(),
  extension: text('extension').notNull(),
  storagePath: text('storage_path').notNull(),
  storageUrl: text('storage_url'),
  thumbnailPath: text('thumbnail_path'),
  thumbnailUrl: text('thumbnail_url'),
  size: integer('size').notNull().default(0),
  width: integer('width'),
  height: integer('height'),
  duration: integer('duration'),
  pages: integer('pages'),
  metadata: jsonb('metadata').$type<z.infer<typeof libraryFileMetadataSchema>>(),
  folderId: integer('folder_id'),
  tags: text('tags').array(),
  isFavorite: boolean('is_favorite').default(false),
  isArchived: boolean('is_archived').default(false),
  isPinned: boolean('is_pinned').default(false),
  userId: varchar('user_id').notNull(),
  isPublic: boolean('is_public').default(false),
  sharedWith: jsonb('shared_with').$type<string[]>(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  lastAccessedAt: timestamp('last_accessed_at'),
  deletedAt: timestamp('deleted_at'),
  version: integer('version').default(1),
  parentVersionId: integer('parent_version_id'),
}, (table) => [
  index('library_files_user_idx').on(table.userId),
  index('library_files_type_idx').on(table.userId, table.type),
  index('library_files_folder_idx').on(table.folderId),
  index('library_files_created_idx').on(table.createdAt),
]);

export const insertLibraryFileSchema = createInsertSchema(libraryFiles).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertLibraryFile = z.infer<typeof insertLibraryFileSchema>;
export type LibraryFile = typeof libraryFiles.$inferSelect;

export const smartRulesSchema = z.object({
  conditions: z.array(z.object({
    field: z.string(),
    operator: z.string(),
    value: z.any(),
  })),
  matchAll: z.boolean(),
});

export const libraryCollections = pgTable('library_collections', {
  id: serial('id').primaryKey(),
  uuid: text('uuid').notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),
  coverFileId: integer('cover_file_id'),
  type: text('type').default('album'),
  smartRules: jsonb('smart_rules').$type<z.infer<typeof smartRulesSchema>>(),
  userId: varchar('user_id').notNull(),
  isPublic: boolean('is_public').default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('library_collections_user_idx').on(table.userId),
]);

export const insertLibraryCollectionSchema = createInsertSchema(libraryCollections).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertLibraryCollection = z.infer<typeof insertLibraryCollectionSchema>;
export type LibraryCollection = typeof libraryCollections.$inferSelect;

export const libraryFileCollections = pgTable('library_file_collections', {
  id: serial('id').primaryKey(),
  fileId: integer('file_id').notNull(),
  collectionId: integer('collection_id').notNull(),
  order: integer('order').default(0),
  addedAt: timestamp('added_at').defaultNow().notNull(),
}, (table) => [
  index('library_file_collections_file_idx').on(table.fileId),
  index('library_file_collections_collection_idx').on(table.collectionId),
]);

export const libraryActivity = pgTable('library_activity', {
  id: serial('id').primaryKey(),
  fileId: integer('file_id'),
  folderId: integer('folder_id'),
  collectionId: integer('collection_id'),
  action: text('action').notNull(),
  userId: varchar('user_id').notNull(),
  details: jsonb('details'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('library_activity_user_idx').on(table.userId),
  index('library_activity_file_idx').on(table.fileId),
  index('library_activity_created_idx').on(table.createdAt),
]);

export type LibraryActivityRecord = typeof libraryActivity.$inferSelect;

export const libraryStorage = pgTable('library_storage', {
  id: serial('id').primaryKey(),
  userId: varchar('user_id').notNull().unique(),
  totalBytes: bigint('total_bytes', { mode: 'number' }).default(0),
  imageBytes: bigint('image_bytes', { mode: 'number' }).default(0),
  videoBytes: bigint('video_bytes', { mode: 'number' }).default(0),
  documentBytes: bigint('document_bytes', { mode: 'number' }).default(0),
  otherBytes: bigint('other_bytes', { mode: 'number' }).default(0),
  fileCount: integer('file_count').default(0),
  quotaBytes: bigint('quota_bytes', { mode: 'number' }).default(5368709120),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('library_storage_user_idx').on(table.userId),
]);

export type LibraryStorageStats = typeof libraryStorage.$inferSelect;

// ==================== SPREADSHEET ANALYZER ====================

export const spreadsheetUploadStatusEnum = ['pending', 'scanning', 'ready', 'error', 'expired'] as const;
export type SpreadsheetUploadStatus = typeof spreadsheetUploadStatusEnum[number];

export const spreadsheetFileTypeEnum = ['xlsx', 'xls', 'csv', 'tsv', 'pdf', 'docx', 'pptx', 'ppt', 'rtf', 'png', 'jpeg', 'gif', 'bmp', 'tiff', 'webp'] as const;
export type SpreadsheetFileType = typeof spreadsheetFileTypeEnum[number];

export const spreadsheetUploads = pgTable('spreadsheet_uploads', {
  id: varchar('id').primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar('user_id').notNull(),
  fileName: text('file_name').notNull(),
  mimeType: text('mime_type').notNull(),
  size: integer('size').notNull(),
  storageKey: text('storage_key').notNull(),
  checksum: text('checksum'),
  status: text('status').$type<SpreadsheetUploadStatus>().default('pending'),
  errorMessage: text('error_message'),
  expiresAt: timestamp('expires_at'),
  fileType: text('file_type').$type<SpreadsheetFileType>(),
  encoding: text('encoding'),
  pageCount: integer('page_count'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('spreadsheet_uploads_user_idx').on(table.userId),
  index('spreadsheet_uploads_status_idx').on(table.status),
]);

export const insertSpreadsheetUploadSchema = createInsertSchema(spreadsheetUploads).omit({
  id: true,
  createdAt: true,
});

export type InsertSpreadsheetUpload = z.infer<typeof insertSpreadsheetUploadSchema>;
export type SpreadsheetUpload = typeof spreadsheetUploads.$inferSelect;

export const columnTypeSchema = z.object({
  name: z.string(),
  type: z.enum(['text', 'number', 'date', 'boolean', 'mixed', 'empty']),
  sampleValues: z.array(z.any()).optional(),
  nullCount: z.number().optional(),
});

export const spreadsheetSheets = pgTable('spreadsheet_sheets', {
  id: varchar('id').primaryKey().default(sql`gen_random_uuid()`),
  uploadId: varchar('upload_id').notNull().references(() => spreadsheetUploads.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  sheetIndex: integer('sheet_index').notNull(),
  rowCount: integer('row_count').default(0),
  columnCount: integer('column_count').default(0),
  inferredHeaders: jsonb('inferred_headers').$type<string[]>(),
  columnTypes: jsonb('column_types').$type<z.infer<typeof columnTypeSchema>[]>(),
  previewData: jsonb('preview_data').$type<any[][]>(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('spreadsheet_sheets_upload_idx').on(table.uploadId),
]);

export const insertSpreadsheetSheetSchema = createInsertSchema(spreadsheetSheets).omit({
  id: true,
  createdAt: true,
});

export type InsertSpreadsheetSheet = z.infer<typeof insertSpreadsheetSheetSchema>;
export type SpreadsheetSheet = typeof spreadsheetSheets.$inferSelect;

export const analysisStatusEnum = ['pending', 'generating_code', 'executing', 'succeeded', 'failed'] as const;
export type AnalysisStatus = typeof analysisStatusEnum[number];

export const analysisModeEnum = ['full', 'text_only', 'numbers_only', 'custom'] as const;
export type AnalysisMode = typeof analysisModeEnum[number];

export const analysisScopeEnum = ['active', 'selected', 'all'] as const;
export type AnalysisScope = typeof analysisScopeEnum[number];

export const sessionAnalysisModeEnum = ['full', 'summary', 'extract_tasks', 'text_only', 'custom'] as const;
export type SessionAnalysisMode = typeof sessionAnalysisModeEnum[number];

export const spreadsheetAnalysisSessions = pgTable('spreadsheet_analysis_sessions', {
  id: varchar('id').primaryKey().default(sql`gen_random_uuid()`),
  uploadId: varchar('upload_id').notNull().references(() => spreadsheetUploads.id, { onDelete: 'cascade' }),
  userId: varchar('user_id').notNull(),
  sheetName: text('sheet_name').notNull(),
  mode: text('mode').$type<AnalysisMode>().default('full'),
  userPrompt: text('user_prompt'),
  generatedCode: text('generated_code'),
  codeHash: text('code_hash'),
  status: text('status').$type<AnalysisStatus>().default('pending'),
  errorMessage: text('error_message'),
  executionTimeMs: integer('execution_time_ms'),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  scope: text('scope').$type<AnalysisScope>(),
  targetSheets: jsonb('target_sheets').$type<string[]>(),
  analysisMode: text('analysis_mode').$type<SessionAnalysisMode>(),
  crossSheetSummary: text('cross_sheet_summary'),
  totalJobs: integer('total_jobs'),
  completedJobs: integer('completed_jobs').default(0),
  failedJobs: integer('failed_jobs').default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('spreadsheet_analysis_user_idx').on(table.userId),
  index('spreadsheet_analysis_upload_idx').on(table.uploadId),
  index('spreadsheet_analysis_status_idx').on(table.status),
]);

export const insertSpreadsheetAnalysisSessionSchema = createInsertSchema(spreadsheetAnalysisSessions).omit({
  id: true,
  createdAt: true,
});

export type InsertSpreadsheetAnalysisSession = z.infer<typeof insertSpreadsheetAnalysisSessionSchema>;
export type SpreadsheetAnalysisSession = typeof spreadsheetAnalysisSessions.$inferSelect;

export const analysisJobStatusEnum = ['queued', 'running', 'done', 'failed'] as const;
export type AnalysisJobStatus = typeof analysisJobStatusEnum[number];

export const spreadsheetAnalysisJobs = pgTable('spreadsheet_analysis_jobs', {
  id: varchar('id').primaryKey().default(sql`gen_random_uuid()`),
  sessionId: varchar('session_id').notNull().references(() => spreadsheetAnalysisSessions.id, { onDelete: 'cascade' }),
  sheetName: text('sheet_name').notNull(),
  status: text('status').$type<AnalysisJobStatus>().default('queued'),
  generatedCode: text('generated_code'),
  error: text('error'),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('spreadsheet_analysis_jobs_session_idx').on(table.sessionId),
  index('spreadsheet_analysis_jobs_status_idx').on(table.status),
]);

export const insertSpreadsheetAnalysisJobSchema = createInsertSchema(spreadsheetAnalysisJobs).omit({
  id: true,
  createdAt: true,
});

export type InsertSpreadsheetAnalysisJob = z.infer<typeof insertSpreadsheetAnalysisJobSchema>;
export type SpreadsheetAnalysisJob = typeof spreadsheetAnalysisJobs.$inferSelect;

export const outputTypeEnum = ['table', 'metric', 'chart', 'log', 'error', 'summary'] as const;
export type OutputType = typeof outputTypeEnum[number];

export const spreadsheetAnalysisOutputs = pgTable('spreadsheet_analysis_outputs', {
  id: varchar('id').primaryKey().default(sql`gen_random_uuid()`),
  sessionId: varchar('session_id').notNull().references(() => spreadsheetAnalysisSessions.id, { onDelete: 'cascade' }),
  outputType: text('output_type').$type<OutputType>().notNull(),
  title: text('title'),
  payload: jsonb('payload').notNull(),
  order: integer('order').default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('spreadsheet_outputs_session_idx').on(table.sessionId),
]);

export const insertSpreadsheetAnalysisOutputSchema = createInsertSchema(spreadsheetAnalysisOutputs).omit({
  id: true,
  createdAt: true,
});

export type InsertSpreadsheetAnalysisOutput = z.infer<typeof insertSpreadsheetAnalysisOutputSchema>;
export type SpreadsheetAnalysisOutput = typeof spreadsheetAnalysisOutputs.$inferSelect;

// Chat Message Analysis - Links chat messages with document analysis sessions
export const chatMessageAnalysis = pgTable('chat_message_analysis', {
  id: varchar('id').primaryKey().default(sql`gen_random_uuid()`),
  messageId: varchar('message_id').references(() => chatMessages.id, { onDelete: 'cascade' }),
  uploadId: varchar('upload_id').references(() => spreadsheetUploads.id, { onDelete: 'cascade' }),
  sessionId: varchar('session_id').references(() => spreadsheetAnalysisSessions.id, { onDelete: 'set null' }),
  status: text('status').notNull().default('pending'), // pending, analyzing, completed, failed
  scope: text('scope').notNull().default('all'), // active, selected, all
  sheetsToAnalyze: text('sheets_to_analyze').array(),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  summary: text('summary'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('chat_message_analysis_message_idx').on(table.messageId),
  index('chat_message_analysis_upload_idx').on(table.uploadId),
  index('chat_message_analysis_session_idx').on(table.sessionId),
]);

export const insertChatMessageAnalysisSchema = createInsertSchema(chatMessageAnalysis).omit({
  id: true,
  createdAt: true,
});

export type InsertChatMessageAnalysis = z.infer<typeof insertChatMessageAnalysisSchema>;
export type ChatMessageAnalysis = typeof chatMessageAnalysis.$inferSelect;

// Agent Mode Tables - For autonomous agent execution within chats
export const agentModeRuns = pgTable("agent_mode_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  chatId: varchar("chat_id").notNull().references(() => chats.id, { onDelete: "cascade" }),
  messageId: varchar("message_id").references(() => chatMessages.id, { onDelete: "set null" }),
  userId: varchar("user_id").references(() => users.id),
  status: text("status").notNull().default("queued"), // queued, planning, running, succeeded, failed, cancelled
  plan: jsonb("plan"), // array of planned steps
  artifacts: jsonb("artifacts"), // output artifacts
  summary: text("summary"),
  error: text("error"),
  totalSteps: integer("total_steps").default(0),
  completedSteps: integer("completed_steps").default(0),
  currentStepIndex: integer("current_step_index").default(0),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  idempotencyKey: varchar("idempotency_key"),
}, (table) => [
  index("agent_mode_runs_chat_idx").on(table.chatId),
  index("agent_mode_runs_message_idx").on(table.messageId),
  index("agent_mode_runs_status_idx").on(table.status),
  index("agent_mode_runs_created_idx").on(table.createdAt),
  index("agent_mode_runs_idempotency_idx").on(table.idempotencyKey),
]);

export const insertAgentModeRunSchema = createInsertSchema(agentModeRuns).omit({
  id: true,
  createdAt: true,
});

export type InsertAgentModeRun = z.infer<typeof insertAgentModeRunSchema>;
export type AgentModeRun = typeof agentModeRuns.$inferSelect;

export const agentModeSteps = pgTable("agent_mode_steps", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  runId: varchar("run_id").notNull().references(() => agentModeRuns.id, { onDelete: "cascade" }),
  stepIndex: integer("step_index").notNull(),
  toolName: text("tool_name").notNull(),
  toolInput: jsonb("tool_input"),
  toolOutput: jsonb("tool_output"),
  status: text("status").notNull().default("pending"), // pending, running, succeeded, failed, skipped
  error: text("error"),
  retryCount: integer("retry_count").default(0),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("agent_mode_steps_run_idx").on(table.runId),
  index("agent_mode_steps_status_idx").on(table.status),
]);

export const insertAgentModeStepSchema = createInsertSchema(agentModeSteps).omit({
  id: true,
  createdAt: true,
});

export type InsertAgentModeStep = z.infer<typeof insertAgentModeStepSchema>;
export type AgentModeStep = typeof agentModeSteps.$inferSelect;

export const agentModeEvents = pgTable("agent_mode_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  runId: varchar("run_id").notNull().references(() => agentModeRuns.id, { onDelete: "cascade" }),
  stepIndex: integer("step_index"),
  correlationId: varchar("correlation_id").notNull(),
  eventType: text("event_type").notNull(),
  payload: jsonb("payload").notNull(),
  metadata: jsonb("metadata"),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  inputHash: varchar("input_hash"),
  outputRef: text("output_ref"),
  durationMs: integer("duration_ms"),
  errorCode: text("error_code"),
  retryCount: integer("retry_count").default(0),
}, (table) => [
  index("agent_mode_events_run_idx").on(table.runId),
  index("agent_mode_events_correlation_idx").on(table.correlationId),
  index("agent_mode_events_type_idx").on(table.eventType),
  index("agent_mode_events_timestamp_idx").on(table.timestamp),
]);

export const insertAgentModeEventSchema = createInsertSchema(agentModeEvents).omit({
  id: true,
});

export type InsertAgentModeEvent = z.infer<typeof insertAgentModeEventSchema>;
export type AgentModeEvent = typeof agentModeEvents.$inferSelect;

export const agentModeArtifacts = pgTable("agent_mode_artifacts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  runId: varchar("run_id").notNull(),
  stepId: varchar("step_id").notNull(),
  stepIndex: integer("step_index"),
  artifactKey: varchar("artifact_key").notNull(),
  type: varchar("type").notNull(),
  name: varchar("name").notNull(),
  url: text("url"),
  payload: jsonb("payload"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("agent_mode_artifacts_run_idx").on(table.runId),
  index("agent_mode_artifacts_step_idx").on(table.stepId),
]);
export type AgentModeArtifact = typeof agentModeArtifacts.$inferSelect;

export const agentWorkspaces = pgTable("agent_workspaces", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  runId: varchar("run_id").notNull().references(() => agentModeRuns.id, { onDelete: "cascade" }),
  filePath: text("file_path").notNull(), // e.g., "todo.md", "output/report.xlsx"
  fileType: text("file_type").notNull(), // "todo", "artifact", "temp", "memory"
  content: text("content"), // text content for small files
  storagePath: text("storage_path"), // object storage path for large files
  metadata: jsonb("metadata"), // additional metadata
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("agent_workspaces_run_idx").on(table.runId),
  index("agent_workspaces_path_idx").on(table.runId, table.filePath),
]);

export const insertAgentWorkspaceSchema = createInsertSchema(agentWorkspaces).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertAgentWorkspace = z.infer<typeof insertAgentWorkspaceSchema>;
export type AgentWorkspace = typeof agentWorkspaces.$inferSelect;

// ==========================================
// Agent Memory Persistence Tables
// ==========================================

export const agentMemoryStore = pgTable("agent_memory_store", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  chatId: varchar("chat_id").references(() => chats.id, { onDelete: "cascade" }),
  userId: varchar("user_id").references(() => users.id),
  memoryKey: text("memory_key").notNull(),
  memoryValue: jsonb("memory_value").notNull(),
  memoryType: text("memory_type").default("context"), // context, fact, preference, artifact_ref
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("agent_memory_store_chat_key_idx").on(table.chatId, table.memoryKey),
  index("agent_memory_store_user_idx").on(table.userId),
  index("agent_memory_store_type_idx").on(table.memoryType),
]);

export const insertAgentMemoryStoreSchema = createInsertSchema(agentMemoryStore).omit({
  id: true,
  createdAt: true,
});

export type InsertAgentMemoryStore = z.infer<typeof insertAgentMemoryStoreSchema>;
export type AgentMemoryStore = typeof agentMemoryStore.$inferSelect;

export const requestSpecHistory = pgTable("request_spec_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  chatId: varchar("chat_id").references(() => chats.id, { onDelete: "cascade" }),
  runId: varchar("run_id").references(() => agentModeRuns.id, { onDelete: "set null" }),
  messageId: varchar("message_id").references(() => chatMessages.id, { onDelete: "set null" }),
  intent: text("intent").notNull(),
  intentConfidence: real("intent_confidence"),
  deliverableType: text("deliverable_type"),
  primaryAgent: text("primary_agent"),
  targetAgents: text("target_agents").array(),
  attachmentsCount: integer("attachments_count").default(0),
  executionDurationMs: integer("execution_duration_ms"),
  status: text("status").default("pending"), // pending, completed, failed
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("request_spec_history_chat_created_idx").on(table.chatId, table.createdAt),
  index("request_spec_history_run_idx").on(table.runId),
  index("request_spec_history_intent_idx").on(table.intent),
]);

export const insertRequestSpecHistorySchema = createInsertSchema(requestSpecHistory).omit({
  id: true,
  createdAt: true,
});

export type InsertRequestSpecHistory = z.infer<typeof insertRequestSpecHistorySchema>;
export type RequestSpecHistory = typeof requestSpecHistory.$inferSelect;

// ==========================================
// Custom Skills Schema - User-defined Agent Skills
// ==========================================

export const skillCategorySchema = z.enum(["documents", "data", "integrations", "automation", "custom"]);
export const skillActionTypeSchema = z.enum(["api_call", "shell_command", "file_operation", "llm_prompt", "chain", "conditional"]);

export const skillParameterSchema = z.object({
  name: z.string(),
  type: z.enum(["string", "number", "boolean", "array", "object", "file"]),
  description: z.string(),
  required: z.boolean().default(true),
  defaultValue: z.any().optional(),
  validation: z.string().optional(),
  options: z.array(z.string()).optional(),
});

export const skillActionSchema = z.object({
  id: z.string(),
  type: skillActionTypeSchema,
  name: z.string(),
  description: z.string().optional(),
  config: z.record(z.any()),
  dependsOn: z.array(z.string()).optional(),
  condition: z.string().optional(),
  onSuccess: z.string().optional(),
  onError: z.string().optional(),
});

export const skillTriggerSchema = z.object({
  type: z.enum(["keyword", "pattern", "intent", "manual"]),
  value: z.string(),
  priority: z.number().default(0),
});

export const customSkills = pgTable("custom_skills", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description"),
  instructions: text("instructions"),
  category: varchar("category", { length: 50 }).notNull().default("custom"),
  icon: varchar("icon", { length: 50 }),
  color: varchar("color", { length: 20 }),
  enabled: boolean("enabled").default(true),
  isPublic: boolean("is_public").default(false),
  version: integer("version").default(1),
  parameters: jsonb("parameters").$type<z.infer<typeof skillParameterSchema>[]>().default([]),
  actions: jsonb("actions").$type<z.infer<typeof skillActionSchema>[]>().default([]),
  triggers: jsonb("triggers").$type<z.infer<typeof skillTriggerSchema>[]>().default([]),
  outputFormat: varchar("output_format", { length: 50 }),
  features: text("features").array(),
  tags: text("tags").array(),
  usageCount: integer("usage_count").default(0),
  lastUsedAt: timestamp("last_used_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("custom_skills_user_id_idx").on(table.userId),
  index("custom_skills_category_idx").on(table.category),
  index("custom_skills_enabled_idx").on(table.enabled),
]);

export const insertCustomSkillSchema = createInsertSchema(customSkills).omit({
  id: true,
  usageCount: true,
  lastUsedAt: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertCustomSkill = z.infer<typeof insertCustomSkillSchema>;
export type CustomSkill = typeof customSkills.$inferSelect;
export type SkillCategory = z.infer<typeof skillCategorySchema>;
export type SkillActionType = z.infer<typeof skillActionTypeSchema>;
export type SkillParameter = z.infer<typeof skillParameterSchema>;
export type SkillAction = z.infer<typeof skillActionSchema>;
export type SkillTrigger = z.infer<typeof skillTriggerSchema>;

// ==========================================
// Agent Event Schema - Standardized Contract
// ==========================================

export const AgentEventKindSchema = z.enum([
  'action',
  'observation', 
  'result',
  'verification',
  'error',
  'plan',
  'thinking',
  'progress'
]);

export const AgentEventStatusSchema = z.enum(['ok', 'warn', 'fail']);

export const AgentEventPhaseSchema = z.enum([
  'planning',
  'executing', 
  'verifying',
  'completed',
  'failed',
  'cancelled'
]);

export const AgentEventSchema = z.object({
  id: z.string().uuid().optional(),
  kind: AgentEventKindSchema,
  status: AgentEventStatusSchema,
  runId: z.string(),
  stepId: z.string().optional(),
  stepIndex: z.number().optional(),
  phase: AgentEventPhaseSchema.optional(),
  title: z.string(),
  summary: z.string().optional(),
  payload: z.any().optional(),
  confidence: z.number().min(0).max(1).optional(),
  shouldRetry: z.boolean().optional(),
  shouldReplan: z.boolean().optional(),
  timestamp: z.number(),
  metadata: z.record(z.any()).optional(),
});

export type AgentEventKind = z.infer<typeof AgentEventKindSchema>;
export type AgentEventStatus = z.infer<typeof AgentEventStatusSchema>;
export type AgentEventPhase = z.infer<typeof AgentEventPhaseSchema>;
export type AgentEvent = z.infer<typeof AgentEventSchema>;

export function createAgentEvent(
  kind: AgentEventKind,
  status: AgentEventStatus,
  runId: string,
  title: string,
  options?: Partial<Omit<AgentEvent, 'kind' | 'status' | 'runId' | 'title' | 'timestamp'>>
): AgentEvent {
  return AgentEventSchema.parse({
    kind,
    status,
    runId,
    title,
    timestamp: Date.now(),
    ...options,
  });
}

// ==========================================
// Trace Event Schema - SSE Streaming Contract
// ==========================================

export const TraceEventTypeSchema = z.enum([
  'task_start',
  'plan_created',
  'plan_step',
  'step_started',
  'tool_call',
  'tool_call_started',
  'tool_call_succeeded',
  'tool_call_failed',
  'tool_output',
  'tool_chunk',
  'observation',
  'verification',
  'verification_passed',
  'verification_failed',
  'step_completed',
  'step_failed',
  'step_retried',
  'replan',
  'thinking',
  'shell_output',
  'artifact_created',
  'artifact_ready',
  'citations_added',
  'memory_loaded',
  'memory_saved',
  'agent_delegated',
  'agent_completed',
  'progress_update',
  'error',
  'done',
  'cancelled',
  'heartbeat'
]);

export const TraceEventSchema = z.object({
  event_type: TraceEventTypeSchema,
  runId: z.string(),
  stepId: z.string().optional(),
  stepIndex: z.number().optional(),
  phase: z.enum(['planning', 'executing', 'verifying', 'completed', 'failed', 'cancelled']).optional(),
  status: z.enum(['pending', 'running', 'completed', 'failed', 'cancelled', 'retrying']).optional(),
  tool_name: z.string().optional(),
  tool_input: z.record(z.any()).optional(),
  command: z.string().optional(),
  output_snippet: z.string().optional(),
  chunk_sequence: z.number().optional(),
  is_final_chunk: z.boolean().optional(),
  artifact: z.object({
    id: z.string().optional(),
    type: z.string(),
    name: z.string(),
    url: z.string().optional(),
    mimeType: z.string().optional(),
    size: z.number().optional(),
    data: z.any().optional(),
  }).optional(),
  plan: z.object({
    objective: z.string(),
    steps: z.array(z.object({
      index: z.number(),
      toolName: z.string(),
      description: z.string(),
    })),
    estimatedTime: z.string().optional(),
  }).optional(),
  error: z.object({
    code: z.string().optional(),
    message: z.string(),
    retryable: z.boolean().optional(),
  }).optional(),
  citations: z.array(z.object({
    source: z.string(),
    text: z.string(),
    page: z.number().optional(),
    url: z.string().optional(),
  })).optional(),
  agent: z.object({
    name: z.string(),
    role: z.string().optional(),
    status: z.string().optional(),
  }).optional(),
  progress: z.object({
    current: z.number(),
    total: z.number(),
    percentage: z.number().optional(),
    message: z.string().optional(),
  }).optional(),
  memory: z.object({
    keys: z.array(z.string()).optional(),
    loaded: z.number().optional(),
    saved: z.number().optional(),
  }).optional(),
  content: z.string().optional(),
  summary: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  durationMs: z.number().optional(),
  timestamp: z.number(),
  metadata: z.record(z.any()).optional(),
});

export type TraceEventType = z.infer<typeof TraceEventTypeSchema>;
export type TraceEvent = z.infer<typeof TraceEventSchema>;

export function createTraceEvent(
  event_type: TraceEventType,
  runId: string,
  options?: Partial<Omit<TraceEvent, 'event_type' | 'runId' | 'timestamp'>>
): TraceEvent {
  const raw = {
    event_type,
    runId,
    timestamp: Date.now(),
    ...options,
  };
  const result = TraceEventSchema.safeParse(raw);
  if (result.success) {
    return result.data;
  }
  const { phase, ...safeOptions } = (options || {}) as any;
  return TraceEventSchema.parse({
    event_type,
    runId,
    timestamp: Date.now(),
    ...safeOptions,
  });
}

// ==========================================
// Agent Memory System - Vector-based Storage
// ==========================================

export const agentMemories = pgTable("agent_memories", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  namespace: varchar("namespace").notNull().default("default"),
  content: text("content").notNull(),
  embedding: vector("embedding"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("agent_memories_namespace_idx").on(table.namespace),
  index("agent_memories_created_at_idx").on(table.createdAt),
]);

export const insertAgentMemorySchema = createInsertSchema(agentMemories).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertAgentMemory = z.infer<typeof insertAgentMemorySchema>;
export type AgentMemory = typeof agentMemories.$inferSelect;

export const agentContext = pgTable("agent_context", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  threadId: varchar("thread_id").notNull(),
  contextWindow: jsonb("context_window").$type<Array<{ role: string; content: string; timestamp: number }>>().default([]),
  tokenCount: integer("token_count").default(0),
  maxTokens: integer("max_tokens").default(128000),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("agent_context_thread_id_idx").on(table.threadId),
  uniqueIndex("agent_context_thread_unique").on(table.threadId),
]);

export const insertAgentContextSchema = createInsertSchema(agentContext).omit({
  id: true,
  createdAt: true,
});

export type InsertAgentContext = z.infer<typeof insertAgentContextSchema>;
export type AgentContext = typeof agentContext.$inferSelect;

export const agentSessionState = pgTable("agent_session_state", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: varchar("session_id").notNull(),
  key: varchar("key").notNull(),
  value: jsonb("value"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("agent_session_state_session_idx").on(table.sessionId),
  uniqueIndex("agent_session_state_unique").on(table.sessionId, table.key),
]);

export const insertAgentSessionStateSchema = createInsertSchema(agentSessionState).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertAgentSessionState = z.infer<typeof insertAgentSessionStateSchema>;
export type AgentSessionState = typeof agentSessionState.$inferSelect;

// ==========================================
// PARE Idempotency System - Phase 2
// ==========================================

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
}, (table) => [
  index("pare_idempotency_key_idx").on(table.idempotencyKey),
  index("pare_idempotency_expires_idx").on(table.expiresAt),
]);

export const insertPareIdempotencyKeySchema = createInsertSchema(pareIdempotencyKeys).omit({
  id: true,
  createdAt: true,
});

export type InsertPareIdempotencyKey = z.infer<typeof insertPareIdempotencyKeySchema>;
export type PareIdempotencyKey = typeof pareIdempotencyKeys.$inferSelect;

// ==========================================
// Image State Management System
// ==========================================

export type ImageMode = 'generate' | 'edit_last' | 'edit_specific';

export const imageHistoryEntrySchema = z.object({
  id: z.string(),
  prompt: z.string(),
  mode: z.enum(['generate', 'edit_last', 'edit_specific']),
  parentId: z.string().nullable(),
  imageUrl: z.string(),
  thumbnailUrl: z.string().optional(),
  timestamp: z.number(),
  model: z.string().optional(),
});

export type ImageHistoryEntry = z.infer<typeof imageHistoryEntrySchema>;

export const imageSessionStateSchema = z.object({
  threadId: z.string(),
  lastImageId: z.string().nullable(),
  lastImageUrl: z.string().nullable(),
  history: z.array(imageHistoryEntrySchema),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type ImageSessionState = z.infer<typeof imageSessionStateSchema>;

export const imageIntentSchema = z.object({
  mode: z.enum(['generate', 'edit_last', 'edit_specific']),
  prompt: z.string(),
  referenceImageId: z.string().nullable(),
  referenceImageUrl: z.string().nullable(),
  editInstruction: z.string().nullable(),
});

export type ImageIntent = z.infer<typeof imageIntentSchema>;

// ==========================================
// Conversation Memory System
// ==========================================

// Zod schemas for JSONB columns
export const conversationContextDataSchema = z.object({
  summary: z.string().optional(),
  entities: z.array(z.object({
    name: z.string(),
    type: z.string(),
    mentions: z.number().default(1),
    lastMentioned: z.string().optional(),
  })).default([]),
  userPreferences: z.record(z.string(), z.unknown()).default({}),
  topics: z.array(z.string()).default([]),
  sentiment: z.enum(['positive', 'negative', 'neutral']).optional(),
});

export type ConversationContextData = z.infer<typeof conversationContextDataSchema>;

export const artifactMetadataSchema = z.object({
  pageCount: z.number().optional(),
  wordCount: z.number().optional(),
  language: z.string().optional(),
  dimensions: z.object({ width: z.number(), height: z.number() }).optional(),
  duration: z.number().optional(),
  encoding: z.string().optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
});

export type ArtifactMetadata = z.infer<typeof artifactMetadataSchema>;

export const imageEditHistorySchema = z.object({
  editId: z.string(),
  prompt: z.string(),
  timestamp: z.string(),
  model: z.string().optional(),
});

export type ImageEditHistory = z.infer<typeof imageEditHistorySchema>;

// Main ConversationState table - versioned state per chat
export const conversationStates = pgTable("conversation_states", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  chatId: varchar("chat_id").notNull().references(() => chats.id, { onDelete: "cascade" }),
  userId: varchar("user_id").references(() => users.id, { onDelete: "set null" }),
  version: integer("version").notNull().default(1),
  totalTokens: integer("total_tokens").default(0),
  messageCount: integer("message_count").default(0),
  artifactCount: integer("artifact_count").default(0),
  imageCount: integer("image_count").default(0),
  lastMessageId: varchar("last_message_id"),
  lastImageId: varchar("last_image_id"),
  isActive: text("is_active").default("true"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("conversation_states_chat_idx").on(table.chatId),
  index("conversation_states_user_idx").on(table.userId),
  index("conversation_states_version_idx").on(table.chatId, table.version),
  uniqueIndex("conversation_states_chat_unique").on(table.chatId),
]);

export const insertConversationStateSchema = createInsertSchema(conversationStates).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertConversationState = z.infer<typeof insertConversationStateSchema>;
export type ConversationState = typeof conversationStates.$inferSelect;

// Versioned snapshots for rollback
export const conversationStateVersions = pgTable("conversation_state_versions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  stateId: varchar("state_id").notNull().references(() => conversationStates.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  snapshot: jsonb("snapshot").notNull(),
  changeDescription: text("change_description"),
  authorId: varchar("author_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("conversation_versions_state_idx").on(table.stateId),
  index("conversation_versions_version_idx").on(table.stateId, table.version),
]);

export const insertConversationStateVersionSchema = createInsertSchema(conversationStateVersions).omit({
  id: true,
  createdAt: true,
});

export type InsertConversationStateVersion = z.infer<typeof insertConversationStateVersionSchema>;
export type ConversationStateVersion = typeof conversationStateVersions.$inferSelect;

// Messages within conversation state
export const conversationMessages = pgTable("conversation_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  stateId: varchar("state_id").notNull().references(() => conversationStates.id, { onDelete: "cascade" }),
  chatMessageId: varchar("chat_message_id").references(() => chatMessages.id, { onDelete: "set null" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  tokenCount: integer("token_count").default(0),
  sequence: integer("sequence").notNull(),
  parentMessageId: varchar("parent_message_id"),
  attachmentIds: text("attachment_ids").array().default([]),
  imageIds: text("image_ids").array().default([]),
  keywords: text("keywords").array().default([]),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("conversation_messages_state_idx").on(table.stateId),
  index("conversation_messages_sequence_idx").on(table.stateId, table.sequence),
  index("conversation_messages_created_idx").on(table.createdAt),
]);

export const insertConversationMessageSchema = createInsertSchema(conversationMessages).omit({
  id: true,
  createdAt: true,
});

export type InsertConversationMessage = z.infer<typeof insertConversationMessageSchema>;
export type ConversationMessage = typeof conversationMessages.$inferSelect;

// Artifacts (uploaded files: doc/pdf/img/etc)
export const conversationArtifacts = pgTable("conversation_artifacts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  stateId: varchar("state_id").notNull().references(() => conversationStates.id, { onDelete: "cascade" }),
  messageId: varchar("message_id").references(() => conversationMessages.id, { onDelete: "set null" }),
  artifactType: text("artifact_type").notNull(),
  mimeType: text("mime_type").notNull(),
  fileName: text("file_name"),
  fileSize: integer("file_size"),
  checksum: varchar("checksum", { length: 64 }),
  storageUrl: text("storage_url").notNull(),
  extractedText: text("extracted_text"),
  metadata: jsonb("metadata").$type<ArtifactMetadata>(),
  processingStatus: text("processing_status").default("pending"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("conversation_artifacts_state_idx").on(table.stateId),
  index("conversation_artifacts_message_idx").on(table.messageId),
  index("conversation_artifacts_type_idx").on(table.artifactType),
  index("conversation_artifacts_checksum_idx").on(table.checksum),
]);

export const insertConversationArtifactSchema = createInsertSchema(conversationArtifacts).omit({
  id: true,
  createdAt: true,
});

export type InsertConversationArtifact = z.infer<typeof insertConversationArtifactSchema>;
export type ConversationArtifact = typeof conversationArtifacts.$inferSelect;

// Generated images with edit history chain
export const conversationImages = pgTable("conversation_images", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  stateId: varchar("state_id").notNull().references(() => conversationStates.id, { onDelete: "cascade" }),
  messageId: varchar("message_id").references(() => conversationMessages.id, { onDelete: "set null" }),
  parentImageId: varchar("parent_image_id"),
  prompt: text("prompt").notNull(),
  imageUrl: text("image_url").notNull(),
  thumbnailUrl: text("thumbnail_url"),
  base64Preview: text("base64_preview"),
  model: text("model"),
  mode: text("mode").default("generate"),
  width: integer("width"),
  height: integer("height"),
  editHistory: jsonb("edit_history").$type<ImageEditHistory[]>().default([]),
  isLatest: text("is_latest").default("true"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("conversation_images_state_idx").on(table.stateId),
  index("conversation_images_message_idx").on(table.messageId),
  index("conversation_images_parent_idx").on(table.parentImageId),
  index("conversation_images_latest_idx").on(table.stateId, table.isLatest),
]);

export const insertConversationImageSchema = createInsertSchema(conversationImages).omit({
  id: true,
  createdAt: true,
});

export type InsertConversationImage = z.infer<typeof insertConversationImageSchema>;
export type ConversationImage = typeof conversationImages.$inferSelect;

// Context (summary, entities, user preferences)
export const conversationContexts = pgTable("conversation_contexts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  stateId: varchar("state_id").notNull().references(() => conversationStates.id, { onDelete: "cascade" }),
  summary: text("summary"),
  entities: jsonb("entities").$type<ConversationContextData['entities']>().default([]),
  userPreferences: jsonb("user_preferences").$type<Record<string, unknown>>().default({}),
  topics: text("topics").array().default([]),
  sentiment: text("sentiment"),
  lastUpdatedAt: timestamp("last_updated_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("conversation_contexts_state_idx").on(table.stateId),
  uniqueIndex("conversation_contexts_state_unique").on(table.stateId),
]);

export const insertConversationContextSchema = createInsertSchema(conversationContexts).omit({
  id: true,
  createdAt: true,
  lastUpdatedAt: true,
});

export type InsertConversationContext = z.infer<typeof insertConversationContextSchema>;
export type ConversationContext = typeof conversationContexts.$inferSelect;

// Memory facts table - stores persistent facts about user preferences, decisions, entities
export const memoryFacts = pgTable("memory_facts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  stateId: varchar("state_id").notNull().references(() => conversationStates.id, { onDelete: "cascade" }),
  factType: varchar("fact_type", { length: 50 }).notNull(), // user_preference, decision, fact, summary, entity
  content: text("content").notNull(),
  confidence: integer("confidence").default(80), // 0-100
  source: varchar("source", { length: 50 }), // user_stated, inferred, system
  extractedAtTurn: integer("extracted_at_turn"),
  validUntil: timestamp("valid_until", { withTimezone: true }),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("memory_facts_state_idx").on(table.stateId),
  index("memory_facts_type_idx").on(table.factType),
]);

export const insertMemoryFactSchema = createInsertSchema(memoryFacts).omit({
  id: true,
  createdAt: true,
});

export type InsertMemoryFact = z.infer<typeof insertMemoryFactSchema>;
export type MemoryFact = typeof memoryFacts.$inferSelect;

// Running summary table - stores progressive conversation summary
export const runningSummaries = pgTable("running_summaries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  stateId: varchar("state_id").notNull().references(() => conversationStates.id, { onDelete: "cascade" }).unique(),
  content: text("content").default(""),
  tokenCount: integer("token_count").default(0),
  lastUpdatedAtTurn: integer("last_updated_at_turn").default(0),
  mainTopics: text("main_topics").array().default([]),
  lastUpdatedAt: timestamp("last_updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("running_summaries_state_idx").on(table.stateId),
]);

export const insertRunningSummarySchema = createInsertSchema(runningSummaries).omit({
  id: true,
  lastUpdatedAt: true,
});

export type InsertRunningSummary = z.infer<typeof insertRunningSummarySchema>;
export type RunningSummary = typeof runningSummaries.$inferSelect;

// Processed requests table for idempotency
export const processedRequests = pgTable("processed_requests", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  requestId: varchar("request_id", { length: 100 }).notNull().unique(),
  stateId: varchar("state_id").notNull().references(() => conversationStates.id, { onDelete: "cascade" }),
  messageId: varchar("message_id", { length: 100 }),
  processedAt: timestamp("processed_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("processed_requests_request_idx").on(table.requestId),
  index("processed_requests_state_idx").on(table.stateId),
]);

export const insertProcessedRequestSchema = createInsertSchema(processedRequests).omit({
  id: true,
  processedAt: true,
});

export type InsertProcessedRequest = z.infer<typeof insertProcessedRequestSchema>;
export type ProcessedRequest = typeof processedRequests.$inferSelect;

// Full hydrated state type for API responses
export const hydratedConversationStateSchema = z.object({
  id: z.string(),
  chatId: z.string(),
  userId: z.string().nullable(),
  version: z.number(),
  totalTokens: z.number(),
  messages: z.array(z.object({
    id: z.string(),
    role: z.string(),
    content: z.string(),
    tokenCount: z.number(),
    sequence: z.number(),
    attachmentIds: z.array(z.string()),
    imageIds: z.array(z.string()),
    createdAt: z.string(),
  })),
  artifacts: z.array(z.object({
    id: z.string(),
    artifactType: z.string(),
    mimeType: z.string(),
    fileName: z.string().nullable(),
    fileSize: z.number().nullable(),
    checksum: z.string().nullable(),
    storageUrl: z.string(),
    extractedText: z.string().nullable(),
    metadata: artifactMetadataSchema.nullable(),
    processingStatus: z.string().nullable(),
    createdAt: z.string(),
  })),
  images: z.array(z.object({
    id: z.string(),
    parentImageId: z.string().nullable(),
    prompt: z.string(),
    imageUrl: z.string(),
    thumbnailUrl: z.string().nullable(),
    model: z.string().nullable(),
    mode: z.string().nullable(),
    editHistory: z.array(imageEditHistorySchema),
    isLatest: z.string().nullable(),
    createdAt: z.string(),
  })),
  context: z.object({
    summary: z.string().nullable(),
    entities: z.array(z.object({
      name: z.string(),
      type: z.string(),
      mentions: z.number(),
      lastMentioned: z.string().optional(),
    })),
    userPreferences: z.record(z.string(), z.unknown()),
    topics: z.array(z.string()),
    sentiment: z.string().nullable(),
  }).nullable(),
  lastMessageId: z.string().nullable(),
  lastImageId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type HydratedConversationState = z.infer<typeof hydratedConversationStateSchema>;

// Retrieval Telemetry table - tracks context retrieval performance metrics
export const retrievalTelemetry = pgTable("retrieval_telemetry", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  stateId: varchar("state_id").notNull().references(() => conversationStates.id, { onDelete: "cascade" }),
  requestId: varchar("request_id", { length: 100 }).notNull(),
  query: text("query").notNull(),
  chunksRetrieved: integer("chunks_retrieved").default(0),
  totalTimeMs: integer("total_time_ms").default(0),
  topScores: jsonb("top_scores").default([]),
  retrievalType: varchar("retrieval_type", { length: 50 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("retrieval_telemetry_state_idx").on(table.stateId),
  index("retrieval_telemetry_request_idx").on(table.requestId),
  index("retrieval_telemetry_created_idx").on(table.createdAt),
]);

export const insertRetrievalTelemetrySchema = createInsertSchema(retrievalTelemetry).omit({
  id: true,
  createdAt: true,
});

export type InsertRetrievalTelemetry = z.infer<typeof insertRetrievalTelemetrySchema>;
export type RetrievalTelemetry = typeof retrievalTelemetry.$inferSelect;

export { remoteShellTargets, insertRemoteShellTargetSchema, appReleases, insertAppReleaseSchema } from "./schema/admin";
export type { InsertRemoteShellTarget, RemoteShellTarget, InsertAppRelease, AppRelease } from "./schema/admin";
export { agentTransitions, agentEpisodicMemory } from "./schema/agent";
export { oauthStates, authTokens, magicLinks } from "./schema/auth";
export type { MagicLink, OAuthState, InsertOAuthState, AuthToken, InsertAuthToken } from "./schema/auth";
export { billingCreditGrants } from "./schema/billingCredits";
export type { BillingCreditGrant, InsertBillingCreditGrant } from "./schema/billingCredits";
export { channelConversations, insertChannelConversationSchema, channelPairingCodes, insertChannelPairingCodeSchema } from "./schema/channels";
export type { InsertChannelConversation, ChannelConversation, InsertChannelPairingCode, ChannelPairingCode } from "./schema/channels";
export { chatGroupShares, insertChatGroupShareSchema, promptIntegrityChecks, insertPromptIntegrityCheckSchema, promptAnalysisResults, insertPromptAnalysisResultSchema, promptTransformationLog } from "./schema/chat";
export type { InsertChatGroupShare, ChatGroupShare, InsertPromptIntegrityCheck, PromptIntegrityCheck, InsertPromptAnalysisResult, PromptAnalysisResult } from "./schema/chat";
export { vector } from "./schema/common";
export { pricingCatalog, tokenLedgerUsage } from "./schema/finops";
export { gptKnowledgeSourceSchema, gptPolicySchema, gptDefinitionSchema, gptActionTypeSchema, gptActionHttpMethodSchema, gptActionAuthTypeSchema, gptActionProviderStatusSchema, gptActionParameterSchema, gptActionJsonSchema, gptActionCreateSchema, gptActionUpdateSchema, gptActionUseSchema } from "./schema/gpt";
export type { GptDefinition, GptActionCreateInput, GptActionUpdateInput } from "./schema/gpt";
export { userIdentities } from "./schema/iam";
export type { UserIdentity, InsertUserIdentity } from "./schema/iam";
export { knowledgeNodes, knowledgeEdges, insertKnowledgeNodeSchema, insertKnowledgeEdgeSchema } from "./schema/knowledge";
export type { KnowledgeNodeType, KnowledgeRelationType, InsertKnowledgeNode, KnowledgeNode, InsertKnowledgeEdge, KnowledgeEdge } from "./schema/knowledge";
export { semanticMemoryChunks, insertSemanticMemoryChunkSchema } from "./schema/memory";
export type { InsertSemanticMemoryChunk, SemanticMemoryChunk } from "./schema/memory";
export { orgSettings } from "./schema/org";
export type { OrgSettings } from "./schema/org";
export { packageOperations } from "./schema/packageManager";
export type { PackageOperation, InsertPackageOperation } from "./schema/packageManager";
export { ragChunks, insertRagChunkSchema, ragKvStore, insertRagKvSchema, memoryFactSchema, userMemories, insertUserMemorySchema, episodicSummaries, insertEpisodicSummarySchema, ragAuditLog, insertRagAuditLogSchema, ragEvalResults, insertRagEvalResultSchema } from "./schema/rag";
export type { InsertRagChunk, RagChunk, InsertRagKv, RagKv, MemoryFactData, InsertUserMemory, UserMemory, InsertEpisodicSummary, EpisodicSummary, InsertRagAuditLog, RagAuditLog, InsertRagEvalResult, RagEvalResult } from "./schema/rag";
export { chatSchedules, insertChatScheduleSchema } from "./schema/schedules";
export type { InsertChatSchedule, ChatSchedule } from "./schema/schedules";
export { skillScopeSchema, skillModeSchema, skillStatusSchema, skillExecutionStatusSchema, jsonSchemaSchema, skillErrorContractSchema, skillExecutionPolicySchema, skillDependencySchema, skillWorkflowStepSchema, skillWorkflowDefinitionSchema, skillCodeDefinitionSchema, skillSpecSchema, skillCatalog, insertSkillCatalogSchema, skillCatalogVersions, insertSkillCatalogVersionSchema, skillExecutionRuns, insertSkillExecutionRunsSchema } from "./schema/skillPlatform";
export type { SkillScope, SkillMode, SkillStatus, SkillExecutionStatus, SkillSpec, SkillErrorContract, SkillExecutionPolicy, SkillWorkflowStep, SkillWorkflowDefinition, SkillCodeDefinition, InsertSkillCatalog, SkillCatalog, InsertSkillCatalogVersion, SkillCatalogVersion, InsertSkillExecutionRun, SkillExecutionRun } from "./schema/skillPlatform";
export { SwarmAgentConfigSchema, SwarmTaskSchema, SwarmPlanSchema } from "./schema/swarm";
export type { SwarmAgentConfig, SwarmTask, SwarmPlan } from "./schema/swarm";
export { telemetryEvents, insertTelemetryEventSchema } from "./schema/telemetry";
export type { InsertTelemetryEvent, TelemetryEvent } from "./schema/telemetry";
export { workspaces } from "./schema/workspace";
export type { Workspace } from "./schema/workspace";
export { workspaceGroupMembers } from "./schema/workspaceGroupMembers";
export type { WorkspaceGroupMember, InsertWorkspaceGroupMember } from "./schema/workspaceGroupMembers";
export { workspaceGroups } from "./schema/workspaceGroups";
export type { WorkspaceGroup, InsertWorkspaceGroup } from "./schema/workspaceGroups";
export { workspaceInvitations } from "./schema/workspaceMembers";
export type { WorkspaceInvitation, InsertWorkspaceInvitation } from "./schema/workspaceMembers";
export { workspaceRoles } from "./schema/workspaceRoles";
export type { WorkspaceRole, InsertWorkspaceRole } from "./schema/workspaceRoles";
export { orchestratorRuns, orchestratorTasks, orchestratorApprovals, orchestratorArtifacts, insertOrchestratorRunSchema, insertOrchestratorTaskSchema, insertOrchestratorApprovalSchema, insertOrchestratorArtifactSchema } from "./schema/orchestrator";
export type { OrchestratorRun, InsertOrchestratorRun, OrchestratorTask, InsertOrchestratorTask, OrchestratorApproval, InsertOrchestratorApproval, OrchestratorArtifact, InsertOrchestratorArtifact } from "./schema/orchestrator";
export { nodes, nodePairings, nodeJobs } from "./schema/nodes";
export type { Node, InsertNode, NodePairing, InsertNodePairing, NodeJob, InsertNodeJob } from "./schema/nodes";
export { oauthTokensGlobal, oauthTokensUser } from "./schema/oauthProviderTokens";
export type { OAuthTokenGlobal, InsertOAuthTokenGlobal, OAuthTokenUser, InsertOAuthTokenUser } from "./schema/oauthProviderTokens";
export { iliaAds, adImpressions, insertIliaAdSchema, insertAdImpressionSchema } from "./schema/ads";
export type { IliaAd, InsertIliaAd, AdImpression, InsertAdImpression } from "./schema/ads";
