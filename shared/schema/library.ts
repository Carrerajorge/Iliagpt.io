import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, jsonb, index, uniqueIndex, serial, boolean, bigint } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { users } from "./auth";
import { chatMessages } from "./chat";

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
}, (table: any) => [
    index("library_items_user_idx").on(table.userId),
    index("library_items_type_idx").on(table.userId, table.mediaType),
]);

export const insertLibraryItemSchema = createInsertSchema(libraryItems);

export type InsertLibraryItem = z.infer<typeof insertLibraryItemSchema>;
export type LibraryItem = typeof libraryItems.$inferSelect;

// Enhanced Multimedia Library System
export const libraryFileMetadataSchema = z.object({
    exif: z.record(z.string(), z.any()).optional(),
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
}, (table: any) => [
    index('library_folders_user_idx').on(table.userId),
    index('library_folders_parent_idx').on(table.parentId),
]);

export const insertLibraryFolderSchema = createInsertSchema(libraryFolders);

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
}, (table: any) => [
    index('library_files_user_idx').on(table.userId),
    index('library_files_type_idx').on(table.userId, table.type),
    index('library_files_folder_idx').on(table.folderId),
    index('library_files_created_idx').on(table.createdAt),
]);

export const insertLibraryFileSchema = createInsertSchema(libraryFiles);

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
}, (table: any) => [
    index('library_collections_user_idx').on(table.userId),
]);

export const insertLibraryCollectionSchema = createInsertSchema(libraryCollections);

export type InsertLibraryCollection = z.infer<typeof insertLibraryCollectionSchema>;
export type LibraryCollection = typeof libraryCollections.$inferSelect;

export const libraryFileCollections = pgTable('library_file_collections', {
    id: serial('id').primaryKey(),
    fileId: integer('file_id').notNull(),
    collectionId: integer('collection_id').notNull(),
    order: integer('order').default(0),
    addedAt: timestamp('added_at').defaultNow().notNull(),
}, (table: any) => [
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
}, (table: any) => [
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
}, (table: any) => [
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
}, (table: any) => [
    index('spreadsheet_uploads_user_idx').on(table.userId),
    index('spreadsheet_uploads_status_idx').on(table.status),
]);

export const insertSpreadsheetUploadSchema = createInsertSchema(spreadsheetUploads);

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
}, (table: any) => [
    index('spreadsheet_sheets_upload_idx').on(table.uploadId),
]);

export const insertSpreadsheetSheetSchema = createInsertSchema(spreadsheetSheets);

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
}, (table: any) => [
    index('spreadsheet_analysis_user_idx').on(table.userId),
    index('spreadsheet_analysis_upload_idx').on(table.uploadId),
    index('spreadsheet_analysis_status_idx').on(table.status),
]);

export const insertSpreadsheetAnalysisSessionSchema = createInsertSchema(spreadsheetAnalysisSessions);

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
}, (table: any) => [
    index('spreadsheet_analysis_jobs_session_idx').on(table.sessionId),
    index('spreadsheet_analysis_jobs_status_idx').on(table.status),
]);

export const insertSpreadsheetAnalysisJobSchema = createInsertSchema(spreadsheetAnalysisJobs);

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
}, (table: any) => [
    index('spreadsheet_outputs_session_idx').on(table.sessionId),
]);

export const insertSpreadsheetAnalysisOutputSchema = createInsertSchema(spreadsheetAnalysisOutputs);

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
}, (table: any) => [
    index('chat_message_analysis_message_idx').on(table.messageId),
    index('chat_message_analysis_upload_idx').on(table.uploadId),
    index('chat_message_analysis_session_idx').on(table.sessionId),
]);

export const insertChatMessageAnalysisSchema = createInsertSchema(chatMessageAnalysis);

export type InsertChatMessageAnalysis = z.infer<typeof insertChatMessageAnalysisSchema>;
export type ChatMessageAnalysis = typeof chatMessageAnalysis.$inferSelect;

// Excel Documents (Legacy/Alternative)
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
}, (table: any) => [
    index("excel_documents_uuid_idx").on(table.uuid),
    index("excel_documents_created_idx").on(table.createdAt),
]);

export const insertExcelDocumentSchema = createInsertSchema(excelDocuments);

export type InsertExcelDocument = z.infer<typeof insertExcelDocumentSchema>;
export type ExcelDocument = typeof excelDocuments.$inferSelect;

// Company Knowledge Base
export const companyKnowledge = pgTable("company_knowledge", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    content: text("content"),
    embedding: text("embedding"), // vector support if needed
    metadata: jsonb("metadata"),
    source: text("source").default("manual"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table: any) => [
    index("company_knowledge_user_idx").on(table.userId),
]);

export const insertCompanyKnowledgeSchema = createInsertSchema(companyKnowledge);

export type InsertCompanyKnowledge = z.infer<typeof insertCompanyKnowledgeSchema>;
export type CompanyKnowledge = typeof companyKnowledge.$inferSelect;
