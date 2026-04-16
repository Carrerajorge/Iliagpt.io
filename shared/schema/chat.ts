import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, jsonb, index, uniqueIndex, serial, boolean, customType, check } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { users } from "./auth";
import { workspaceGroups } from "./workspaceGroups";

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
}, (table: any) => [
    index("chats_user_idx").on(table.userId),
    index("chats_status_idx").on(table.conversationStatus),
    index("chats_flag_idx").on(table.flagStatus),
    index("chats_user_updated_idx").on(table.userId, table.updatedAt),
    index("chats_user_archived_deleted_idx").on(table.userId, table.archived, table.deletedAt),
    index("chats_updated_at_idx").on(table.updatedAt),
    index("chats_gpt_id_idx").on(table.gptId),
    index("chats_pinned_idx").on(table.pinned),
    index("chats_active_inbox_idx").on(table.conversationStatus, table.archived),
    check("chats_message_count_check", sql`${table.messageCount} >= 0`),
    check("chats_tokens_used_check", sql`${table.tokensUsed} >= 0`),
]);

export const insertChatSchema = createInsertSchema(chats);

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
    searchVector: customType<{ data: string }>({ dataType() { return "tsvector"; } })("search_vector"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table: any) => [
    index("chat_messages_chat_idx").on(table.chatId),
    index("chat_messages_request_idx").on(table.requestId),
    index("chat_messages_status_idx").on(table.status),
    uniqueIndex("chat_messages_request_unique").on(table.requestId),
    index("chat_messages_chat_created_idx").on(table.chatId, table.createdAt),
    index("chat_messages_created_at_idx").on(table.createdAt),
    index("chat_messages_search_idx").using("gin", table.searchVector),
    index("chat_messages_role_idx").on(table.role),
    index("chat_messages_sequence_idx").on(table.sequence),
    index("chat_messages_metadata_idx").using("gin", table.metadata),
    check("chat_messages_content_check", sql`length(${table.content}) > 0`),
]);

export const insertChatMessageSchema = createInsertSchema(chatMessages);

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
}, (table: any) => [
    index("chat_runs_chat_idx").on(table.chatId),
    index("chat_runs_status_idx").on(table.status),
    uniqueIndex("chat_runs_client_request_unique").on(table.chatId, table.clientRequestId),
    index("chat_runs_chat_created_idx").on(table.chatId, table.createdAt),
]);

export const insertChatRunSchema = createInsertSchema(chatRuns);

export type InsertChatRun = z.infer<typeof insertChatRunSchema>;
export type ChatRun = typeof chatRuns.$inferSelect;

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
}, (table: any) => [
    index("tool_invocations_run_idx").on(table.runId),
    uniqueIndex("tool_invocations_unique").on(table.runId, table.toolCallId),
    index("tool_invocations_run_created_idx").on(table.runId, table.createdAt),
    index("tool_invocations_tool_name_idx").on(table.toolName),
]);

export const insertToolInvocationSchema = createInsertSchema(toolInvocations);

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
}, (table: any) => [
    index("chat_shares_chat_idx").on(table.chatId),
    index("chat_shares_email_idx").on(table.email),
    index("chat_shares_recipient_idx").on(table.recipientUserId),
]);

export const insertChatShareSchema = createInsertSchema(chatShares);

export type InsertChatShare = z.infer<typeof insertChatShareSchema>;
export type ChatShare = typeof chatShares.$inferSelect;

// Chat sharing to workspace groups - grants access to all current/future members of a group
export const chatGroupShares = pgTable(
    "chat_group_shares",
    {
        id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
        chatId: varchar("chat_id").notNull().references(() => chats.id, { onDelete: "cascade" }),
        groupId: varchar("group_id").notNull().references(() => workspaceGroups.id, { onDelete: "cascade" }),
        role: text("role").notNull().default("viewer"), // editor, viewer
        invitedBy: varchar("invited_by"),
        createdAt: timestamp("created_at").defaultNow().notNull(),
    },
    (table: any) => [
        index("chat_group_shares_chat_idx").on(table.chatId),
        index("chat_group_shares_group_idx").on(table.groupId),
        uniqueIndex("chat_group_shares_chat_group_unique").on(table.chatId, table.groupId),
    ]
);

export const insertChatGroupShareSchema = createInsertSchema(chatGroupShares);

export type InsertChatGroupShare = z.infer<typeof insertChatGroupShareSchema>;
export type ChatGroupShare = typeof chatGroupShares.$inferSelect;

// Chat Participants for sharing chats
export const chatParticipants = pgTable("chat_participants", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    chatId: varchar("chat_id").notNull().references(() => chats.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role").notNull().default("viewer"), // owner, editor, viewer
    invitedBy: varchar("invited_by"),
    invitedAt: timestamp("invited_at").defaultNow().notNull(),
    acceptedAt: timestamp("accepted_at"),
}, (table: any) => [
    index("chat_participants_chat_idx").on(table.chatId),
    index("chat_participants_email_idx").on(table.email),
    uniqueIndex("chat_participants_unique_idx").on(table.chatId, table.email),
]);

export const insertChatParticipantSchema = createInsertSchema(chatParticipants);

export type InsertChatParticipant = z.infer<typeof insertChatParticipantSchema>;
export type ChatParticipant = typeof chatParticipants.$inferSelect;

// Response Quality Metrics
export const responseQualityMetrics = pgTable("response_quality_metrics", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    runId: varchar("run_id"),
    userId: varchar("user_id"),
    score: integer("score"), // 1-5 or similar
    feedback: text("feedback"),
    category: text("category"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table: any) => [
    index("response_quality_metrics_run_idx").on(table.runId),
    index("response_quality_metrics_category_idx").on(table.category),
]);

export const insertResponseQualityMetricSchema = createInsertSchema(responseQualityMetrics);

export type InsertResponseQualityMetric = z.infer<typeof insertResponseQualityMetricSchema>;
export type ResponseQualityMetric = typeof responseQualityMetrics.$inferSelect;

// Offline Message Queue
export const offlineMessageQueue = pgTable("offline_message_queue", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id").notNull(),
    content: jsonb("content").notNull(),
    status: text("status").default("pending"),
    retryCount: integer("retry_count").default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    processedAt: timestamp("processed_at"),
}, (table: any) => [
    index("offline_message_queue_user_idx").on(table.userId),
    index("offline_message_queue_status_idx").on(table.status),
    index("offline_message_queue_processed_at_idx").on(table.processedAt),
]);

export const insertOfflineMessageQueueSchema = createInsertSchema(offlineMessageQueue);

export type InsertOfflineMessageQueue = z.infer<typeof insertOfflineMessageQueueSchema>;
export type OfflineMessageQueue = typeof offlineMessageQueue.$inferSelect;

// ── Prompt Integrity Audit Trail ───────────────────────────

/** Records every SHA-256 integrity check performed on incoming prompts. */
export const promptIntegrityChecks = pgTable("prompt_integrity_checks", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    chatId: varchar("chat_id").references(() => chats.id, { onDelete: "cascade" }),
    runId: varchar("run_id"),
    messageRole: text("message_role"), // "user" | "assistant" | "system"
    clientPromptLen: integer("client_prompt_len"),
    clientPromptHash: varchar("client_prompt_hash", { length: 64 }),
    serverPromptLen: integer("server_prompt_len").notNull(),
    serverPromptHash: varchar("server_prompt_hash", { length: 64 }).notNull(),
    valid: boolean("valid").notNull(),
    mismatchType: text("mismatch_type"), // "hash" | "length" | "both" | null
    lenDelta: integer("len_delta"),
    requestId: varchar("request_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table: any) => [
    index("prompt_integrity_chat_idx").on(table.chatId),
    index("prompt_integrity_created_idx").on(table.createdAt),
    index("prompt_integrity_valid_idx").on(table.valid),
    index("prompt_integrity_request_idx").on(table.requestId),
]);

export const insertPromptIntegrityCheckSchema = createInsertSchema(promptIntegrityChecks);
export type InsertPromptIntegrityCheck = z.infer<typeof insertPromptIntegrityCheckSchema>;
export type PromptIntegrityCheck = typeof promptIntegrityChecks.$inferSelect;

/** Stores PromptUnderstanding analysis results for each processed prompt. */
export const promptAnalysisResults = pgTable("prompt_analysis_results", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    chatId: varchar("chat_id").references(() => chats.id, { onDelete: "cascade" }),
    runId: varchar("run_id"),
    requestId: varchar("request_id"),
    confidence: integer("confidence"), // 0-100 (stored as integer percentage)
    needsClarification: boolean("needs_clarification").default(false),
    clarificationQuestions: jsonb("clarification_questions"), // string[]
    extractedSpec: jsonb("extracted_spec"), // UserSpec JSON
    policyViolations: jsonb("policy_violations"), // PolicyViolation[]
    contradictions: jsonb("contradictions"), // ContradictionResult
    usedLLM: boolean("used_llm").default(false),
    processingTimeMs: integer("processing_time_ms"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table: any) => [
    index("prompt_analysis_chat_idx").on(table.chatId),
    index("prompt_analysis_created_idx").on(table.createdAt),
    index("prompt_analysis_request_idx").on(table.requestId),
    index("prompt_analysis_spec_idx").using("gin", table.extractedSpec),
]);

export const insertPromptAnalysisResultSchema = createInsertSchema(promptAnalysisResults);
export type InsertPromptAnalysisResult = z.infer<typeof insertPromptAnalysisResultSchema>;
export type PromptAnalysisResult = typeof promptAnalysisResults.$inferSelect;

/** Logs every transformation applied to a prompt through the processing pipeline. */
export const promptTransformationLog = pgTable("prompt_transformation_log", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    chatId: varchar("chat_id").references(() => chats.id, { onDelete: "cascade" }),
    runId: varchar("run_id"),
    requestId: varchar("request_id"),
    stage: text("stage").notNull(), // 'intake' | 'normalize' | 'truncate' | 'compress' | 'enrich'
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    droppedMessages: integer("dropped_messages").default(0),
    droppedChars: integer("dropped_chars").default(0),
    transformationDetails: jsonb("transformation_details"), // Arbitrary stage-specific metadata
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table: any) => [
    index("prompt_transform_chat_idx").on(table.chatId),
    index("prompt_transform_created_idx").on(table.createdAt),
    index("prompt_transform_stage_idx").on(table.stage),
    index("prompt_transform_request_idx").on(table.requestId),
]);
