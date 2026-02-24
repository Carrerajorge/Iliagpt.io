import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, jsonb, index, uniqueIndex, serial, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { users } from "./auth";
import { chats, chatMessages } from "./chat";



// Image State Management System
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

// Conversation Memory System
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
}, (table: any) => [
    index("conversation_states_chat_idx").on(table.chatId),
    index("conversation_states_user_idx").on(table.userId),
    index("conversation_states_version_idx").on(table.chatId, table.version),
    uniqueIndex("conversation_states_chat_unique").on(table.chatId),
]);

export const insertConversationStateSchema = createInsertSchema(conversationStates);

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
}, (table: any) => [
    index("conversation_versions_state_idx").on(table.stateId),
    index("conversation_versions_version_idx").on(table.stateId, table.version),
]);

export const insertConversationStateVersionSchema = createInsertSchema(conversationStateVersions);

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
}, (table: any) => [
    index("conversation_messages_state_idx").on(table.stateId),
    index("conversation_messages_sequence_idx").on(table.stateId, table.sequence),
    index("conversation_messages_created_idx").on(table.createdAt),
]);

export const insertConversationMessageSchema = createInsertSchema(conversationMessages);

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
}, (table: any) => [
    index("conversation_artifacts_state_idx").on(table.stateId),
    index("conversation_artifacts_message_idx").on(table.messageId),
    index("conversation_artifacts_type_idx").on(table.artifactType),
    index("conversation_artifacts_checksum_idx").on(table.checksum),
]);

export const insertConversationArtifactSchema = createInsertSchema(conversationArtifacts);

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
}, (table: any) => [
    index("conversation_images_state_idx").on(table.stateId),
    index("conversation_images_message_idx").on(table.messageId),
    index("conversation_images_parent_idx").on(table.parentImageId),
    index("conversation_images_latest_idx").on(table.stateId, table.isLatest),
]);

export const insertConversationImageSchema = createInsertSchema(conversationImages);

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
}, (table: any) => [
    index("conversation_contexts_state_idx").on(table.stateId),
    uniqueIndex("conversation_contexts_state_unique").on(table.stateId),
]);

export const insertConversationContextSchema = createInsertSchema(conversationContexts);

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
}, (table: any) => [
    index("memory_facts_state_idx").on(table.stateId),
    index("memory_facts_type_idx").on(table.factType),
]);

export const insertMemoryFactSchema = createInsertSchema(memoryFacts);

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
}, (table: any) => [
    index("running_summaries_state_idx").on(table.stateId),
]);

export const insertRunningSummarySchema = createInsertSchema(runningSummaries);

export type InsertRunningSummary = z.infer<typeof insertRunningSummarySchema>;
export type RunningSummary = typeof runningSummaries.$inferSelect;

// Processed requests table for idempotency
export const processedRequests = pgTable("processed_requests", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    requestId: varchar("request_id", { length: 100 }).notNull().unique(),
    stateId: varchar("state_id").notNull().references(() => conversationStates.id, { onDelete: "cascade" }),
    messageId: varchar("message_id", { length: 100 }),
    processedAt: timestamp("processed_at", { withTimezone: true }).defaultNow().notNull(),
}, (table: any) => [
    index("processed_requests_request_idx").on(table.requestId),
    index("processed_requests_state_idx").on(table.stateId),
]);

export const insertProcessedRequestSchema = createInsertSchema(processedRequests);

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
}, (table: any) => [
    index("retrieval_telemetry_state_idx").on(table.stateId),
    index("retrieval_telemetry_request_idx").on(table.requestId),
    index("retrieval_telemetry_created_idx").on(table.createdAt),
]);

export const insertRetrievalTelemetrySchema = createInsertSchema(retrievalTelemetry);

export type InsertRetrievalTelemetry = z.infer<typeof insertRetrievalTelemetrySchema>;
export type RetrievalTelemetry = typeof retrievalTelemetry.$inferSelect;

// Semantic Memory Chunks - stores user memories with vector embeddings
export const semanticMemoryChunks = pgTable("semantic_memory_chunks", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    type: varchar("type", { length: 50 }).notNull(), // fact, preference, conversation, instruction, note
    source: varchar("source", { length: 100 }).default("explicit"),
    confidence: integer("confidence").default(80), // 0-100
    accessCount: integer("access_count").default(0),
    tags: text("tags").array().default([]),
    metadata: jsonb("metadata").default({}),
    lastAccessedAt: timestamp("last_accessed_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table: any) => [
    index("semantic_memory_user_idx").on(table.userId),
    index("semantic_memory_type_idx").on(table.type),
    index("semantic_memory_created_idx").on(table.createdAt),
]);

export const insertSemanticMemoryChunkSchema = createInsertSchema(semanticMemoryChunks);

export type InsertSemanticMemoryChunk = z.infer<typeof insertSemanticMemoryChunkSchema>;
export type SemanticMemoryChunk = typeof semanticMemoryChunks.$inferSelect;
