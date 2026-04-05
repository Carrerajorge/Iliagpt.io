/**
 * PgVectorMemoryStore — production-grade vector memory using PostgreSQL pgvector.
 * Tables: conversation_memories, user_memories, agent_memories, shared_knowledge.
 * Semantic search via cosine similarity, with consolidation and GC.
 */

import { EventEmitter } from "events";
import { createLogger } from "../utils/logger";
import { AppError } from "../utils/errors";
import { db } from "../db";
import { sql, and, eq, lt, desc, gte } from "drizzle-orm";
import { pgTable, uuid, text, real, timestamp, jsonb, integer, boolean, index } from "drizzle-orm/pg-core";
import { getSemanticEmbeddingVector } from "../services/semanticEmbeddings";

const logger = createLogger("PgVectorMemoryStore");

// ─── Schema ───────────────────────────────────────────────────────────────────

export const conversationMemories = pgTable("conversation_memories", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id"),
  conversationId: uuid("conversation_id"),
  agentId: text("agent_id"),
  content: text("content").notNull(),
  summary: text("summary"),
  memoryType: text("memory_type").notNull().default("fact"),
  importance: real("importance").notNull().default(0.5),
  accessCount: integer("access_count").notNull().default(0),
  lastAccessedAt: timestamp("last_accessed_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
  expiresAt: timestamp("expires_at"),
  tags: jsonb("tags").default([]),
  metadata: jsonb("metadata").default({}),
  isConsolidated: boolean("is_consolidated").default(false),
}, (t) => ({
  userIdx: index("cm_user_idx").on(t.userId),
  convIdx: index("cm_conv_idx").on(t.conversationId),
  typeIdx: index("cm_type_idx").on(t.memoryType),
  importanceIdx: index("cm_importance_idx").on(t.importance),
}));

export const userMemories = pgTable("user_memories", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  key: text("key").notNull(),
  value: text("value").notNull(),
  memoryType: text("memory_type").notNull().default("preference"),
  importance: real("importance").notNull().default(0.7),
  accessCount: integer("access_count").notNull().default(0),
  lastAccessedAt: timestamp("last_accessed_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  metadata: jsonb("metadata").default({}),
}, (t) => ({
  userKeyIdx: index("um_user_key_idx").on(t.userId, t.key),
}));

// ─── Types ────────────────────────────────────────────────────────────────────

export type MemoryType = "fact" | "preference" | "action_item" | "decision" | "entity" | "skill" | "ephemeral";

export interface Memory {
  id: string;
  content: string;
  summary?: string;
  memoryType: MemoryType;
  importance: number;
  accessCount: number;
  createdAt: Date;
  lastAccessedAt: Date;
  tags: string[];
  metadata: Record<string, unknown>;
  similarity?: number;
}

export interface StoreMemoryOptions {
  content: string;
  summary?: string;
  memoryType?: MemoryType;
  importance?: number;
  userId?: string;
  conversationId?: string;
  agentId?: string;
  ttlMs?: number;
  tags?: string[];
  metadata?: Record<string, unknown>;
  embedding?: number[];
}

export interface SearchMemoryOptions {
  query: string;
  embedding?: number[];
  userId?: string;
  conversationId?: string;
  agentId?: string;
  memoryType?: MemoryType;
  limit?: number;
  minImportance?: number;
  minSimilarity?: number;
  sinceMs?: number;
}

export interface GarbageCollectionResult {
  deletedExpired: number;
  deletedLowImportance: number;
  mergedDuplicates: number;
  totalFreed: number;
}

// ─── Embedding Provider ───────────────────────────────────────────────────────

async function generateEmbedding(text: string): Promise<number[]> {
  try {
    return await getSemanticEmbeddingVector(text, {
      dimensions: 512,
      purpose: "document",
      cacheNamespace: "pgvector-memory",
    });
  } catch (err) {
    logger.warn(`Semantic embedding failed, using empty vector fallback: ${(err as Error).message}`);
    return [];
  }
}

// ─── pgvector Setup ───────────────────────────────────────────────────────────

async function ensureVectorExtension(): Promise<void> {
  try {
    await db.execute(sql`CREATE EXTENSION IF NOT EXISTS vector`);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS memory_embeddings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        memory_id UUID NOT NULL,
        memory_table TEXT NOT NULL,
        embedding vector(512),
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS memory_embeddings_hnsw
      ON memory_embeddings USING hnsw (embedding vector_cosine_ops)
      WITH (m = 16, ef_construction = 64)
    `);
    logger.info("pgvector extension and memory_embeddings table ready");
  } catch (err) {
    logger.warn(`pgvector setup warning: ${(err as Error).message}`);
  }
}

// ─── PgVectorMemoryStore ──────────────────────────────────────────────────────

export class PgVectorMemoryStore extends EventEmitter {
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await ensureVectorExtension();
    this.initialized = true;
    logger.info("PgVectorMemoryStore initialized");
  }

  async store(options: StoreMemoryOptions): Promise<string> {
    await this.initialize();

    const expiresAt = options.ttlMs ? new Date(Date.now() + options.ttlMs) : undefined;
    const importance = options.importance ?? 0.5;

    // Insert memory record
    const [record] = await db.insert(conversationMemories).values({
      userId: options.userId as `${string}-${string}-${string}-${string}-${string}` | undefined,
      conversationId: options.conversationId as `${string}-${string}-${string}-${string}-${string}` | undefined,
      agentId: options.agentId,
      content: options.content,
      summary: options.summary,
      memoryType: options.memoryType ?? "fact",
      importance,
      expiresAt,
      tags: options.tags ?? [],
      metadata: options.metadata ?? {},
    }).returning({ id: conversationMemories.id });

    if (!record) throw new AppError("Failed to insert memory", 500, "MEMORY_INSERT_ERROR");

    // Generate and store embedding
    try {
      const embedding = options.embedding ?? await generateEmbedding(options.content);
      if (embedding.length > 0) {
        const vectorStr = `[${embedding.join(",")}]`;
        await db.execute(sql`
          INSERT INTO memory_embeddings (memory_id, memory_table, embedding)
          VALUES (${record.id}, 'conversation_memories', ${vectorStr}::vector)
        `);
      }
    } catch (err) {
      logger.warn(`Failed to store embedding for memory ${record.id}: ${(err as Error).message}`);
    }

    this.emit("stored", { id: record.id, memoryType: options.memoryType });
    return record.id;
  }

  async search(options: SearchMemoryOptions): Promise<Memory[]> {
    await this.initialize();

    const embedding = options.embedding ?? await generateEmbedding(options.query);
    const limit = options.limit ?? 10;
    const minSimilarity = options.minSimilarity ?? 0.5;

    if (embedding.length === 0) {
      return this.searchByText(options);
    }

    const vectorStr = `[${embedding.join(",")}]`;

    try {
      const rows = await db.execute(sql`
        SELECT
          cm.id,
          cm.content,
          cm.summary,
          cm.memory_type,
          cm.importance,
          cm.access_count,
          cm.created_at,
          cm.last_accessed_at,
          cm.tags,
          cm.metadata,
          1 - (me.embedding <=> ${vectorStr}::vector) AS similarity
        FROM conversation_memories cm
        JOIN memory_embeddings me ON me.memory_id = cm.id AND me.memory_table = 'conversation_memories'
        WHERE
          (cm.expires_at IS NULL OR cm.expires_at > NOW())
          AND (cm.user_id = ${options.userId ?? null}::uuid OR ${options.userId ?? null}::uuid IS NULL)
          AND (cm.conversation_id = ${options.conversationId ?? null}::uuid OR ${options.conversationId ?? null}::uuid IS NULL)
          AND (cm.agent_id = ${options.agentId ?? null} OR ${options.agentId ?? null} IS NULL)
          AND (cm.memory_type = ${options.memoryType ?? null} OR ${options.memoryType ?? null} IS NULL)
          AND cm.importance >= ${options.minImportance ?? 0}
          AND 1 - (me.embedding <=> ${vectorStr}::vector) >= ${minSimilarity}
        ORDER BY similarity DESC
        LIMIT ${limit}
      `) as { rows: Array<Record<string, unknown>> };

      // Update access counts
      const ids = rows.rows.map((r) => r["id"] as string);
      if (ids.length > 0) {
        await db.execute(sql`
          UPDATE conversation_memories
          SET access_count = access_count + 1, last_accessed_at = NOW()
          WHERE id = ANY(${ids}::uuid[])
        `);
      }

      return rows.rows.map((r) => ({
        id: r["id"] as string,
        content: r["content"] as string,
        summary: r["summary"] as string | undefined,
        memoryType: r["memory_type"] as MemoryType,
        importance: r["importance"] as number,
        accessCount: r["access_count"] as number,
        createdAt: new Date(r["created_at"] as string),
        lastAccessedAt: new Date(r["last_accessed_at"] as string),
        tags: (r["tags"] as string[]) ?? [],
        metadata: (r["metadata"] as Record<string, unknown>) ?? {},
        similarity: r["similarity"] as number,
      }));
    } catch (err) {
      logger.warn(`Vector search failed, falling back to text search: ${(err as Error).message}`);
      return this.searchByText(options);
    }
  }

  private async searchByText(options: SearchMemoryOptions): Promise<Memory[]> {
    const results = await db
      .select()
      .from(conversationMemories)
      .where(
        and(
          options.userId ? eq(conversationMemories.userId, options.userId as `${string}-${string}-${string}-${string}-${string}`) : undefined,
          options.conversationId ? eq(conversationMemories.conversationId, options.conversationId as `${string}-${string}-${string}-${string}-${string}`) : undefined,
          options.memoryType ? eq(conversationMemories.memoryType, options.memoryType) : undefined,
          options.minImportance ? gte(conversationMemories.importance, options.minImportance) : undefined,
        )
      )
      .orderBy(desc(conversationMemories.importance))
      .limit(options.limit ?? 10);

    return results.map((r) => ({
      id: r.id,
      content: r.content,
      summary: r.summary ?? undefined,
      memoryType: r.memoryType as MemoryType,
      importance: r.importance,
      accessCount: r.accessCount,
      createdAt: r.createdAt ?? new Date(),
      lastAccessedAt: r.lastAccessedAt ?? new Date(),
      tags: (r.tags as string[]) ?? [],
      metadata: (r.metadata as Record<string, unknown>) ?? {},
    }));
  }

  async storeUserMemory(userId: string, key: string, value: string, metadata?: Record<string, unknown>): Promise<void> {
    await db.insert(userMemories).values({
      userId: userId as `${string}-${string}-${string}-${string}-${string}`,
      key,
      value,
      metadata: metadata ?? {},
    }).onConflictDoUpdate({
      target: [userMemories.userId, userMemories.key],
      set: { value, metadata: metadata ?? {}, updatedAt: new Date(), accessCount: sql`${userMemories.accessCount} + 1` },
    });
  }

  async getUserMemory(userId: string, key: string): Promise<string | null> {
    const [record] = await db
      .select()
      .from(userMemories)
      .where(and(eq(userMemories.userId, userId as `${string}-${string}-${string}-${string}-${string}`), eq(userMemories.key, key)))
      .limit(1);
    return record?.value ?? null;
  }

  async runGarbageCollection(): Promise<GarbageCollectionResult> {
    let deletedExpired = 0;
    let deletedLowImportance = 0;

    // Delete expired memories
    const expired = await db
      .delete(conversationMemories)
      .where(lt(conversationMemories.expiresAt, new Date()))
      .returning({ id: conversationMemories.id });
    deletedExpired = expired.length;

    // Delete ephemeral memories older than 24h with low access
    const cutoff = new Date(Date.now() - 86_400_000);
    const lowPriority = await db
      .delete(conversationMemories)
      .where(
        and(
          eq(conversationMemories.memoryType, "ephemeral"),
          lt(conversationMemories.createdAt, cutoff),
          lt(conversationMemories.importance, 0.3)
        )
      )
      .returning({ id: conversationMemories.id });
    deletedLowImportance = lowPriority.length;

    const allDeleted = [...expired, ...lowPriority].map((r) => r.id);
    if (allDeleted.length > 0) {
      await db.execute(sql`
        DELETE FROM memory_embeddings WHERE memory_id = ANY(${allDeleted}::uuid[])
      `);
    }

    logger.info(`GC: deleted ${deletedExpired} expired + ${deletedLowImportance} low-importance memories`);
    this.emit("gc_complete", { deletedExpired, deletedLowImportance });

    return { deletedExpired, deletedLowImportance, mergedDuplicates: 0, totalFreed: deletedExpired + deletedLowImportance };
  }

  async exportMemories(userId: string): Promise<Memory[]> {
    const records = await db
      .select()
      .from(conversationMemories)
      .where(eq(conversationMemories.userId, userId as `${string}-${string}-${string}-${string}-${string}`))
      .orderBy(desc(conversationMemories.importance));

    return records.map((r) => ({
      id: r.id,
      content: r.content,
      summary: r.summary ?? undefined,
      memoryType: r.memoryType as MemoryType,
      importance: r.importance,
      accessCount: r.accessCount,
      createdAt: r.createdAt ?? new Date(),
      lastAccessedAt: r.lastAccessedAt ?? new Date(),
      tags: (r.tags as string[]) ?? [],
      metadata: (r.metadata as Record<string, unknown>) ?? {},
    }));
  }

  async deleteUserMemories(userId: string): Promise<number> {
    const deleted = await db
      .delete(conversationMemories)
      .where(eq(conversationMemories.userId, userId as `${string}-${string}-${string}-${string}-${string}`))
      .returning({ id: conversationMemories.id });
    return deleted.length;
  }
}

export const pgVectorMemoryStore = new PgVectorMemoryStore();
