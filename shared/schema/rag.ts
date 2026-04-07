import { sql } from "drizzle-orm";
import {
    pgTable, text, varchar, integer, timestamp, jsonb,
    index, uniqueIndex, boolean, real, customType,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { users } from "./auth";
import { chats } from "./chat";
import { vector } from "./common";

const tsvector = customType<{ data: string }>({
    dataType() { return "tsvector"; },
});

// =============================================================================
// 1. RAG Document Chunks — unified vector store with mandatory metadata
// =============================================================================

export const ragChunks = pgTable("rag_chunks", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: varchar("tenant_id", { length: 100 }).notNull(),
    userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    conversationId: varchar("conversation_id"),
    threadId: varchar("thread_id"),
    source: varchar("source", { length: 200 }).notNull(), // 'document', 'message', 'web', 'email', 'manual'
    sourceId: varchar("source_id", { length: 200 }),       // external reference
    content: text("content").notNull(),
    contentHash: varchar("content_hash", { length: 64 }).notNull(),
    embedding: vector("embedding"),
    searchVector: tsvector("search_vector"),
    chunkIndex: integer("chunk_index").notNull().default(0),
    totalChunks: integer("total_chunks"),
    // Metadata
    title: text("title"),
    mimeType: varchar("mime_type", { length: 100 }),
    language: varchar("language", { length: 10 }),
    pageNumber: integer("page_number"),
    sectionTitle: text("section_title"),
    chunkType: varchar("chunk_type", { length: 50 }).default("paragraph"), // heading, paragraph, list, code, table
    importance: real("importance").default(0.5),
    // ACL / Tags
    aclTags: text("acl_tags").array().default([]),
    tags: text("tags").array().default([]),
    metadata: jsonb("metadata").default({}),
    // Lifecycle
    isActive: boolean("is_active").default(true),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    accessCount: integer("access_count").default(0),
    lastAccessedAt: timestamp("last_accessed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table: any) => [
    index("rag_chunks_tenant_user_idx").on(table.tenantId, table.userId),
    index("rag_chunks_conversation_idx").on(table.conversationId),
    index("rag_chunks_source_idx").on(table.source, table.sourceId),
    index("rag_chunks_search_idx").using("gin", table.searchVector),
    index("rag_chunks_tags_idx").using("gin", table.tags),
    index("rag_chunks_acl_idx").using("gin", table.aclTags),
    index("rag_chunks_embedding_idx").using("hnsw", sql`${table.embedding} vector_cosine_ops`),
    uniqueIndex("rag_chunks_content_hash_idx").on(table.userId, table.contentHash),
    index("rag_chunks_created_idx").on(table.createdAt),
    index("rag_chunks_active_idx").on(table.isActive),
]);

export const insertRagChunkSchema = (createInsertSchema(ragChunks).omit({
    id: true, createdAt: true, updatedAt: true, searchVector: true, accessCount: true, lastAccessedAt: true,
}) as any).extend({
    embedding: z.array(z.number()).nullish(),
    tags: z.array(z.string()).optional(),
    aclTags: z.array(z.string()).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
});

export type InsertRagChunk = z.infer<typeof insertRagChunkSchema>;
export type RagChunk = typeof ragChunks.$inferSelect;

// =============================================================================
// 2. KV Store — Structured state per user (Postgres-backed Redis alternative)
// =============================================================================

export const ragKvStore = pgTable("rag_kv_store", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: varchar("tenant_id", { length: 100 }).notNull(),
    userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    namespace: varchar("namespace", { length: 100 }).notNull(), // 'preferences', 'session', 'config'
    key: varchar("key", { length: 255 }).notNull(),
    value: jsonb("value").notNull(),
    version: integer("version").notNull().default(1),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table: any) => [
    uniqueIndex("rag_kv_tenant_user_ns_key_idx").on(table.tenantId, table.userId, table.namespace, table.key),
    index("rag_kv_namespace_idx").on(table.namespace),
    index("rag_kv_expires_idx").on(table.expiresAt),
]);

export const insertRagKvSchema = createInsertSchema(ragKvStore).omit({
    id: true, createdAt: true, updatedAt: true,
});

export type InsertRagKv = z.infer<typeof insertRagKvSchema>;
export type RagKv = typeof ragKvStore.$inferSelect;

// =============================================================================
// 3. User Long-Term Memory — facts/preferences/objectives with JSON Schema
// =============================================================================

export const memoryFactSchema = z.object({
    fact: z.string(),
    confidence: z.number().min(0).max(1),
    evidence: z.string(),
    scope: z.enum(["global", "conversation", "topic"]),
    ttl: z.number().nullable().optional(),   // seconds, null = permanent
    version: z.number().default(1),
    category: z.enum(["preference", "fact", "objective", "instruction", "personality", "context"]),
    supersedes: z.string().nullable().optional(), // id of memory this replaces
});

export type MemoryFactData = z.infer<typeof memoryFactSchema>;

export const userMemories = pgTable("user_memories", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: varchar("tenant_id", { length: 100 }).notNull(),
    userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    conversationId: varchar("conversation_id"),
    // Structured memory (JSON Schema validated)
    fact: text("fact").notNull(),
    category: varchar("category", { length: 50 }).notNull(), // preference, fact, objective, instruction, personality, context
    confidence: real("confidence").notNull().default(0.8),
    evidence: text("evidence").notNull(),
    scope: varchar("scope", { length: 30 }).notNull().default("global"), // global, conversation, topic
    // Versioning & dedup
    version: integer("version").notNull().default(1),
    supersedesId: varchar("supersedes_id"),
    contentHash: varchar("content_hash", { length: 64 }).notNull(),
    // Embedding for semantic retrieval
    embedding: vector("embedding"),
    // Scoring
    salienceScore: real("salience_score").default(0.5),
    recencyScore: real("recency_score").default(1.0),
    accessCount: integer("access_count").default(0),
    // Lifecycle
    isActive: boolean("is_active").default(true),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    tags: text("tags").array().default([]),
    metadata: jsonb("metadata").default({}),
    lastAccessedAt: timestamp("last_accessed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table: any) => [
    index("user_memories_tenant_user_idx").on(table.tenantId, table.userId),
    index("user_memories_category_idx").on(table.category),
    index("user_memories_scope_idx").on(table.scope),
    index("user_memories_active_idx").on(table.userId, table.isActive),
    index("user_memories_embedding_idx").using("hnsw", sql`${table.embedding} vector_cosine_ops`),
    uniqueIndex("user_memories_hash_idx").on(table.userId, table.contentHash),
    index("user_memories_salience_idx").on(table.salienceScore),
    index("user_memories_conversation_idx").on(table.conversationId),
]);

export const insertUserMemorySchema = (createInsertSchema(userMemories).omit({
    id: true, createdAt: true, updatedAt: true, accessCount: true, lastAccessedAt: true,
}) as any).extend({
    embedding: z.array(z.number()).nullish(),
    tags: z.array(z.string()).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
});

export type InsertUserMemory = z.infer<typeof insertUserMemorySchema>;
export type UserMemory = typeof userMemories.$inferSelect;

// =============================================================================
// 4. Episodic Summaries — per-conversation summaries
// =============================================================================

export const episodicSummaries = pgTable("episodic_summaries", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: varchar("tenant_id", { length: 100 }).notNull(),
    userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    conversationId: varchar("conversation_id").notNull(),
    summary: text("summary").notNull(),
    mainTopics: text("main_topics").array().default([]),
    keyEntities: text("key_entities").array().default([]),
    keyDecisions: text("key_decisions").array().default([]),
    sentiment: varchar("sentiment", { length: 20 }),
    turnCount: integer("turn_count").default(0),
    tokenCount: integer("token_count").default(0),
    embedding: vector("embedding"),
    metadata: jsonb("metadata").default({}),
    isActive: boolean("is_active").default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table: any) => [
    index("episodic_summaries_user_idx").on(table.tenantId, table.userId),
    uniqueIndex("episodic_summaries_conv_idx").on(table.conversationId),
    index("episodic_summaries_embedding_idx").using("hnsw", sql`${table.embedding} vector_cosine_ops`),
    index("episodic_summaries_created_idx").on(table.createdAt),
]);

export const insertEpisodicSummarySchema = (createInsertSchema(episodicSummaries).omit({
    id: true, createdAt: true, updatedAt: true,
}) as any).extend({
    embedding: z.array(z.number()).nullish(),
    metadata: z.record(z.string(), z.unknown()).optional(),
});

export type InsertEpisodicSummary = z.infer<typeof insertEpisodicSummarySchema>;
export type EpisodicSummary = typeof episodicSummaries.$inferSelect;

// =============================================================================
// 5. RAG Audit Log — privacy/security audit trail
// =============================================================================

export const ragAuditLog = pgTable("rag_audit_log", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: varchar("tenant_id", { length: 100 }).notNull(),
    userId: varchar("user_id").notNull(),
    action: varchar("action", { length: 50 }).notNull(), // 'ingest', 'retrieve', 'memory_write', 'memory_read', 'delete', 'pii_redact'
    resourceType: varchar("resource_type", { length: 50 }).notNull(), // 'chunk', 'memory', 'kv', 'episodic'
    resourceId: varchar("resource_id"),
    details: jsonb("details").default({}),
    piiDetected: boolean("pii_detected").default(false),
    piiTypes: text("pii_types").array().default([]),
    ipAddress: varchar("ip_address", { length: 45 }),
    userAgent: text("user_agent"),
    durationMs: integer("duration_ms"),
    success: boolean("success").default(true),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table: any) => [
    index("rag_audit_tenant_user_idx").on(table.tenantId, table.userId),
    index("rag_audit_action_idx").on(table.action),
    index("rag_audit_resource_idx").on(table.resourceType, table.resourceId),
    index("rag_audit_pii_idx").on(table.piiDetected),
    index("rag_audit_created_idx").on(table.createdAt),
]);

export const insertRagAuditLogSchema = createInsertSchema(ragAuditLog).omit({
    id: true, createdAt: true,
});

export type InsertRagAuditLog = z.infer<typeof insertRagAuditLogSchema>;
export type RagAuditLog = typeof ragAuditLog.$inferSelect;

// =============================================================================
// 6. RAG Evaluation Results — golden chats, recall@k, hit-rate
// =============================================================================

export const ragEvalResults = pgTable("rag_eval_results", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    runId: varchar("run_id", { length: 100 }).notNull(),
    testCaseId: varchar("test_case_id", { length: 200 }).notNull(),
    query: text("query").notNull(),
    expectedChunkIds: text("expected_chunk_ids").array().default([]),
    retrievedChunkIds: text("retrieved_chunk_ids").array().default([]),
    // Metrics
    recallAtK: real("recall_at_k"),
    precisionAtK: real("precision_at_k"),
    mrr: real("mrr"),                      // Mean Reciprocal Rank
    ndcg: real("ndcg"),                    // Normalized Discounted Cumulative Gain
    hitRate: real("hit_rate"),
    latencyMs: integer("latency_ms"),
    // Answer quality
    answerRelevance: real("answer_relevance"),
    faithfulness: real("faithfulness"),
    contextPrecision: real("context_precision"),
    // Config
    k: integer("k").default(5),
    retrievalConfig: jsonb("retrieval_config").default({}),
    metadata: jsonb("metadata").default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table: any) => [
    index("rag_eval_run_idx").on(table.runId),
    index("rag_eval_test_case_idx").on(table.testCaseId),
    index("rag_eval_created_idx").on(table.createdAt),
]);

export const insertRagEvalResultSchema = createInsertSchema(ragEvalResults).omit({
    id: true, createdAt: true,
});

export type InsertRagEvalResult = z.infer<typeof insertRagEvalResultSchema>;
export type RagEvalResult = typeof ragEvalResults.$inferSelect;
