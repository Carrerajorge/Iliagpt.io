import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { vector } from "./common";
import { chats, chatMessages } from "./chat";

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
}, (table: any) => [
    index("files_user_created_idx").on(table.userId, table.createdAt),
    index("files_user_id_idx").on(table.userId),
    index("files_status_idx").on(table.status),
]);

export const insertFileSchema = (createInsertSchema(files).omit({
    id: true,
    createdAt: true,
}) as any).extend({
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
}, (table: any) => [
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
}, (table: any) => [
    index("file_chunks_file_id_idx").on(table.fileId),
    index("file_chunks_embedding_idx").using("hnsw", sql`${table.embedding} vector_cosine_ops`),
]);

export const insertFileChunkSchema = (createInsertSchema(fileChunks).omit({
    id: true,
}) as any).extend({
    embedding: z.array(z.number()).nullish(),
});

export type InsertFileChunk = z.infer<typeof insertFileChunkSchema>;
export type FileChunk = typeof fileChunks.$inferSelect;

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
}, (table: any) => [
    index("conversation_documents_chat_idx").on(table.chatId),
    index("conversation_documents_created_idx").on(table.chatId, table.createdAt),
]);

export const insertConversationDocumentSchema = createInsertSchema(conversationDocuments).omit({
    id: true,
    createdAt: true,
});

export type InsertConversationDocument = z.infer<typeof insertConversationDocumentSchema>;
export type ConversationDocument = typeof conversationDocuments.$inferSelect;
