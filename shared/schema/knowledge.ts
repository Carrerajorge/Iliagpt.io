import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, jsonb, index, uniqueIndex, boolean, real, customType } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { users } from "./auth";
import { vector } from "./common";

const tsvector = customType<{ data: string }>({
    dataType() {
        return "tsvector";
    },
});

export type KnowledgeNodeType =
    | "concept"
    | "entity"
    | "fact"
    | "note"
    | "summary"
    | "conversation"
    | "document"
    | "web"
    | "email"
    | "task"
    | "reference";

export type KnowledgeRelationType =
    | "menciona"
    | "contradice"
    | "expande"
    | "es_parte_de"
    | "relacionado";

export const knowledgeNodes = pgTable("knowledge_nodes", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    zettelId: varchar("zettel_id", { length: 64 }),
    title: text("title").notNull(),
    content: text("content").notNull(),
    nodeType: text("node_type").notNull().default("note"),
    sourceType: text("source_type").notNull().default("manual"),
    sourceId: varchar("source_id"),
    tags: text("tags").array().default([]),
    embedding: vector("embedding"),
    searchVector: tsvector("search_vector"),
    contentHash: text("content_hash"),
    metadata: jsonb("metadata").default({}),
    importance: real("importance").default(0.5),
    accessCount: integer("access_count").default(0),
    lastAccessedAt: timestamp("last_accessed_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    isActive: boolean("is_active").default(true),
}, (table: any) => [
    index("knowledge_nodes_user_idx").on(table.userId),
    uniqueIndex("knowledge_nodes_user_zettel_idx").on(table.userId, table.zettelId),
    index("knowledge_nodes_type_idx").on(table.nodeType),
    index("knowledge_nodes_source_idx").on(table.sourceType, table.sourceId),
    index("knowledge_nodes_created_idx").on(table.createdAt),
    index("knowledge_nodes_search_idx").using("gin", table.searchVector),
    index("knowledge_nodes_tags_idx").using("gin", table.tags),
    index("knowledge_nodes_embedding_idx").using("hnsw", sql`${table.embedding} vector_cosine_ops`),
    uniqueIndex("knowledge_nodes_user_hash_idx").on(table.userId, table.contentHash),
    uniqueIndex("knowledge_nodes_user_source_idx").on(table.userId, table.sourceType, table.sourceId),
]);

export const insertKnowledgeNodeSchema = (createInsertSchema(knowledgeNodes).omit({
    id: true,
    createdAt: true,
    updatedAt: true,
    lastAccessedAt: true,
    accessCount: true,
    searchVector: true,
}) as any).extend({
    tags: z.array(z.string()).optional(),
    embedding: z.array(z.number()).nullish(),
    metadata: z.record(z.string(), z.unknown()).optional(),
});

export type InsertKnowledgeNode = z.infer<typeof insertKnowledgeNodeSchema>;
export type KnowledgeNode = typeof knowledgeNodes.$inferSelect;

export const knowledgeEdges = pgTable("knowledge_edges", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    sourceNodeId: varchar("source_node_id").notNull().references(() => knowledgeNodes.id, { onDelete: "cascade" }),
    targetNodeId: varchar("target_node_id").notNull().references(() => knowledgeNodes.id, { onDelete: "cascade" }),
    relationType: text("relation_type").notNull(),
    weight: real("weight").default(1.0),
    metadata: jsonb("metadata").default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table: any) => [
    index("knowledge_edges_user_idx").on(table.userId),
    index("knowledge_edges_source_idx").on(table.sourceNodeId),
    index("knowledge_edges_target_idx").on(table.targetNodeId),
    index("knowledge_edges_relation_idx").on(table.relationType),
    uniqueIndex("knowledge_edges_unique").on(table.userId, table.sourceNodeId, table.targetNodeId, table.relationType),
]);

export const insertKnowledgeEdgeSchema = (createInsertSchema(knowledgeEdges).omit({
    id: true,
    createdAt: true,
}) as any).extend({
    metadata: z.record(z.string(), z.unknown()).optional(),
});

export type InsertKnowledgeEdge = z.infer<typeof insertKnowledgeEdgeSchema>;
export type KnowledgeEdge = typeof knowledgeEdges.$inferSelect;
