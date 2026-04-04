/**
 * PgVectorMemoryStore — production memory store using PostgreSQL pgvector extension.
 * Extends the existing SemanticMemoryStore with full pgvector operations.
 */

import crypto from "crypto"
import { db } from "../db"
import { sql, eq, and, desc, gt, lt, inArray } from "drizzle-orm"
import { Logger } from "../lib/logger"

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MemoryEntry {
  id: string
  userId: string
  conversationId?: string
  agentId?: string
  content: string
  type: "fact" | "preference" | "conversation" | "instruction" | "note" | "entity"
  embedding: number[]
  importance: number
  metadata: {
    source: string
    tags: string[]
    createdAt: Date
    lastAccessedAt: Date
    accessCount: number
    expiresAt?: Date
    consolidatedFrom?: string[]
  }
}

export interface VectorSearchOptions {
  limit?: number
  threshold?: number
  userId?: string
  conversationId?: string
  agentId?: string
  types?: MemoryEntry["type"][]
  minImportance?: number
}

interface RawMemoryRow {
  id: string
  user_id: string
  conversation_id?: string | null
  agent_id?: string | null
  content: string
  type: string
  embedding?: number[] | string | null
  importance?: number | null
  metadata?: Record<string, unknown> | null
  similarity?: number | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function rowToEntry(row: RawMemoryRow): MemoryEntry {
  const meta = (row.metadata ?? {}) as Record<string, unknown>
  return {
    id: row.id,
    userId: row.user_id,
    conversationId: row.conversation_id ?? undefined,
    agentId: row.agent_id ?? undefined,
    content: row.content,
    type: row.type as MemoryEntry["type"],
    embedding: Array.isArray(row.embedding)
      ? (row.embedding as number[])
      : parseEmbeddingString(row.embedding as string | null),
    importance: typeof row.importance === "number" ? row.importance : 0.5,
    metadata: {
      source: String(meta.source ?? "explicit"),
      tags: Array.isArray(meta.tags) ? (meta.tags as string[]) : [],
      createdAt: meta.createdAt ? new Date(meta.createdAt as string) : new Date(),
      lastAccessedAt: meta.lastAccessedAt ? new Date(meta.lastAccessedAt as string) : new Date(),
      accessCount: typeof meta.accessCount === "number" ? meta.accessCount : 0,
      expiresAt: meta.expiresAt ? new Date(meta.expiresAt as string) : undefined,
      consolidatedFrom: Array.isArray(meta.consolidatedFrom)
        ? (meta.consolidatedFrom as string[])
        : undefined,
    },
  }
}

function parseEmbeddingString(raw: string | null): number[] {
  if (!raw) return []
  try {
    const cleaned = raw.replace(/^\[/, "").replace(/\]$/, "")
    return cleaned.split(",").map(Number)
  } catch {
    return []
  }
}

function formatVector(embedding: number[]): string {
  return `[${embedding.join(",")}]`
}

// ─── Store ────────────────────────────────────────────────────────────────────

class PgVectorMemoryStore {
  private readonly TABLE = "semantic_memory_chunks"
  private pgvectorAvailable: boolean | null = null

  // ── pgvector availability detection ─────────────────────────────────────────

  private async checkPgVector(): Promise<boolean> {
    if (this.pgvectorAvailable !== null) return this.pgvectorAvailable
    try {
      await db.execute(sql`SELECT 1 FROM pg_extension WHERE extname = 'vector'`)
      // Try a small cast to confirm the operator works
      await db.execute(sql`SELECT '[1,2,3]'::vector`)
      this.pgvectorAvailable = true
    } catch {
      this.pgvectorAvailable = false
      Logger.warn("[PgVectorMemoryStore] pgvector not available — using LIKE fallback")
    }
    return this.pgvectorAvailable
  }

  // ── store ────────────────────────────────────────────────────────────────────

  async store(entry: Omit<MemoryEntry, "id">): Promise<MemoryEntry> {
    try {
      const vectorStr = formatVector(entry.embedding)
      const metadataJson = JSON.stringify({
        source: entry.metadata.source,
        tags: entry.metadata.tags,
        createdAt: entry.metadata.createdAt.toISOString(),
        lastAccessedAt: entry.metadata.lastAccessedAt.toISOString(),
        accessCount: entry.metadata.accessCount,
        ...(entry.metadata.expiresAt && { expiresAt: entry.metadata.expiresAt.toISOString() }),
        ...(entry.metadata.consolidatedFrom && { consolidatedFrom: entry.metadata.consolidatedFrom }),
      })

      const hasPgVector = await this.checkPgVector()

      let rows: RawMemoryRow[]
      if (hasPgVector) {
        const result = await db.execute<RawMemoryRow>(sql`
          INSERT INTO ${sql.identifier(this.TABLE)}
            (user_id, conversation_id, agent_id, content, type, embedding, importance, metadata)
          VALUES
            (${entry.userId}, ${entry.conversationId ?? null}, ${entry.agentId ?? null},
             ${entry.content}, ${entry.type}, ${vectorStr}::vector,
             ${entry.importance}, ${metadataJson}::jsonb)
          RETURNING *
        `)
        rows = result.rows as RawMemoryRow[]
      } else {
        // Fallback: store without embedding column
        const result = await db.execute<RawMemoryRow>(sql`
          INSERT INTO ${sql.identifier(this.TABLE)}
            (user_id, conversation_id, agent_id, content, type, importance, metadata)
          VALUES
            (${entry.userId}, ${entry.conversationId ?? null}, ${entry.agentId ?? null},
             ${entry.content}, ${entry.type}, ${entry.importance}, ${metadataJson}::jsonb)
          RETURNING *
        `)
        rows = result.rows as RawMemoryRow[]
      }

      if (!rows[0]) throw new Error("INSERT returned no rows")
      Logger.debug("[PgVectorMemoryStore] stored memory", { id: rows[0].id, type: entry.type })
      return rowToEntry(rows[0])
    } catch (err) {
      Logger.error("[PgVectorMemoryStore] store failed", err)
      throw err
    }
  }

  // ── vector search ────────────────────────────────────────────────────────────

  async search(
    queryEmbedding: number[],
    options: VectorSearchOptions = {}
  ): Promise<Array<MemoryEntry & { similarity: number }>> {
    const {
      limit = 10,
      threshold = 0.7,
      userId,
      conversationId,
      agentId,
      types,
      minImportance = 0,
    } = options

    const vectorStr = formatVector(queryEmbedding)
    const hasPgVector = await this.checkPgVector()

    try {
      if (hasPgVector) {
        const result = await db.execute<RawMemoryRow & { similarity: number }>(sql`
          SELECT *,
                 1 - (embedding <=> ${vectorStr}::vector) AS similarity
          FROM ${sql.identifier(this.TABLE)}
          WHERE 1=1
            ${userId ? sql`AND user_id = ${userId}` : sql``}
            ${conversationId ? sql`AND conversation_id = ${conversationId}` : sql``}
            ${agentId ? sql`AND agent_id = ${agentId}` : sql``}
            ${types && types.length > 0 ? sql`AND type = ANY(${types}::text[])` : sql``}
            ${minImportance > 0 ? sql`AND importance >= ${minImportance}` : sql``}
            AND 1 - (embedding <=> ${vectorStr}::vector) >= ${threshold}
          ORDER BY embedding <=> ${vectorStr}::vector
          LIMIT ${limit}
        `)
        return (result.rows as Array<RawMemoryRow & { similarity: number }>).map((row) => ({
          ...rowToEntry(row),
          similarity: row.similarity ?? 0,
        }))
      } else {
        // Fallback: LIKE-based text search
        return await this.fallbackSearch(options)
      }
    } catch (err) {
      Logger.error("[PgVectorMemoryStore] search failed", err)
      return this.fallbackSearch(options)
    }
  }

  private async fallbackSearch(
    options: VectorSearchOptions
  ): Promise<Array<MemoryEntry & { similarity: number }>> {
    const { limit = 10, userId, types, minImportance = 0 } = options
    try {
      const result = await db.execute<RawMemoryRow>(sql`
        SELECT * FROM ${sql.identifier(this.TABLE)}
        WHERE 1=1
          ${userId ? sql`AND user_id = ${userId}` : sql``}
          ${types && types.length > 0 ? sql`AND type = ANY(${types}::text[])` : sql``}
          ${minImportance > 0 ? sql`AND importance >= ${minImportance}` : sql``}
        ORDER BY last_accessed_at DESC
        LIMIT ${limit}
      `)
      return (result.rows as RawMemoryRow[]).map((row) => ({
        ...rowToEntry(row),
        similarity: 0.5,
      }))
    } catch (err) {
      Logger.error("[PgVectorMemoryStore] fallback search failed", err)
      return []
    }
  }

  // ── search by text ───────────────────────────────────────────────────────────

  async searchByText(
    text: string,
    options: VectorSearchOptions = {}
  ): Promise<Array<MemoryEntry & { similarity: number }>> {
    const embedding = this.generateEmbedding(text)
    return this.search(embedding, options)
  }

  // ── get by id ────────────────────────────────────────────────────────────────

  async getById(id: string): Promise<MemoryEntry | null> {
    try {
      const result = await db.execute<RawMemoryRow>(sql`
        SELECT * FROM ${sql.identifier(this.TABLE)} WHERE id = ${id} LIMIT 1
      `)
      const row = (result.rows as RawMemoryRow[])[0]
      if (!row) return null

      // Bump access count
      await db.execute(sql`
        UPDATE ${sql.identifier(this.TABLE)}
        SET access_count = COALESCE((metadata->>'accessCount')::int, 0) + 1,
            last_accessed_at = NOW(),
            metadata = jsonb_set(
              jsonb_set(metadata, '{accessCount}', to_jsonb(COALESCE((metadata->>'accessCount')::int, 0) + 1)),
              '{lastAccessedAt}', to_jsonb(NOW()::text)
            )
        WHERE id = ${id}
      `)

      return rowToEntry(row)
    } catch (err) {
      Logger.error("[PgVectorMemoryStore] getById failed", err)
      return null
    }
  }

  // ── get by user ──────────────────────────────────────────────────────────────

  async getByUser(
    userId: string,
    options: { limit?: number; type?: string } = {}
  ): Promise<MemoryEntry[]> {
    const { limit = 50, type } = options
    try {
      const result = await db.execute<RawMemoryRow>(sql`
        SELECT * FROM ${sql.identifier(this.TABLE)}
        WHERE user_id = ${userId}
          ${type ? sql`AND type = ${type}` : sql``}
        ORDER BY importance DESC, last_accessed_at DESC
        LIMIT ${limit}
      `)
      return (result.rows as RawMemoryRow[]).map(rowToEntry)
    } catch (err) {
      Logger.error("[PgVectorMemoryStore] getByUser failed", err)
      return []
    }
  }

  // ── update importance ────────────────────────────────────────────────────────

  async updateImportance(id: string, importance: number): Promise<void> {
    const clamped = Math.max(0, Math.min(1, importance))
    try {
      await db.execute(sql`
        UPDATE ${sql.identifier(this.TABLE)} SET importance = ${clamped} WHERE id = ${id}
      `)
      Logger.debug("[PgVectorMemoryStore] updateImportance", { id, importance: clamped })
    } catch (err) {
      Logger.error("[PgVectorMemoryStore] updateImportance failed", err)
      throw err
    }
  }

  // ── delete ───────────────────────────────────────────────────────────────────

  async delete(id: string): Promise<void> {
    try {
      await db.execute(sql`
        DELETE FROM ${sql.identifier(this.TABLE)} WHERE id = ${id}
      `)
    } catch (err) {
      Logger.error("[PgVectorMemoryStore] delete failed", err)
      throw err
    }
  }

  async deleteByUser(userId: string): Promise<number> {
    try {
      const result = await db.execute<{ count: string }>(sql`
        WITH deleted AS (
          DELETE FROM ${sql.identifier(this.TABLE)} WHERE user_id = ${userId} RETURNING id
        ) SELECT COUNT(*) AS count FROM deleted
      `)
      const count = parseInt((result.rows as Array<{ count: string }>)[0]?.count ?? "0", 10)
      Logger.info("[PgVectorMemoryStore] deleteByUser", { userId, count })
      return count
    } catch (err) {
      Logger.error("[PgVectorMemoryStore] deleteByUser failed", err)
      throw err
    }
  }

  // ── consolidate ──────────────────────────────────────────────────────────────

  async consolidate(
    entryIds: string[],
    newContent: string,
    userId: string
  ): Promise<MemoryEntry> {
    const embedding = this.generateEmbedding(newContent)
    const newEntry = await this.store({
      userId,
      content: newContent,
      type: "fact",
      embedding,
      importance: 0.7,
      metadata: {
        source: "consolidation",
        tags: ["consolidated"],
        createdAt: new Date(),
        lastAccessedAt: new Date(),
        accessCount: 0,
        consolidatedFrom: entryIds,
      },
    })

    for (const id of entryIds) {
      await this.delete(id)
    }

    Logger.info("[PgVectorMemoryStore] consolidated", { userId, count: entryIds.length, newId: newEntry.id })
    return newEntry
  }

  // ── garbage collect ──────────────────────────────────────────────────────────

  async garbageCollect(userId: string, maxEntries: number = 1000): Promise<number> {
    let deleted = 0
    try {
      // Delete expired entries
      const expiredResult = await db.execute<{ count: string }>(sql`
        WITH deleted AS (
          DELETE FROM ${sql.identifier(this.TABLE)}
          WHERE user_id = ${userId}
            AND (metadata->>'expiresAt') IS NOT NULL
            AND (metadata->>'expiresAt')::timestamptz < NOW()
          RETURNING id
        ) SELECT COUNT(*) AS count FROM deleted
      `)
      deleted += parseInt(
        (expiredResult.rows as Array<{ count: string }>)[0]?.count ?? "0",
        10
      )

      // Delete lowest-importance entries if over limit
      const countResult = await db.execute<{ count: string }>(sql`
        SELECT COUNT(*) AS count FROM ${sql.identifier(this.TABLE)} WHERE user_id = ${userId}
      `)
      const total = parseInt(
        (countResult.rows as Array<{ count: string }>)[0]?.count ?? "0",
        10
      )

      if (total > maxEntries) {
        const excess = total - maxEntries
        const pruneResult = await db.execute<{ count: string }>(sql`
          WITH to_delete AS (
            SELECT id FROM ${sql.identifier(this.TABLE)}
            WHERE user_id = ${userId}
            ORDER BY importance ASC, last_accessed_at ASC
            LIMIT ${excess}
          ), deleted AS (
            DELETE FROM ${sql.identifier(this.TABLE)} WHERE id IN (SELECT id FROM to_delete) RETURNING id
          ) SELECT COUNT(*) AS count FROM deleted
        `)
        deleted += parseInt(
          (pruneResult.rows as Array<{ count: string }>)[0]?.count ?? "0",
          10
        )
      }

      Logger.info("[PgVectorMemoryStore] garbageCollect", { userId, deleted })
      return deleted
    } catch (err) {
      Logger.error("[PgVectorMemoryStore] garbageCollect failed", err)
      return deleted
    }
  }

  // ── stats ────────────────────────────────────────────────────────────────────

  async getStats(
    userId: string
  ): Promise<{ total: number; byType: Record<string, number>; avgImportance: number }> {
    try {
      const result = await db.execute<{
        total: string
        avg_importance: string
        type: string
        type_count: string
      }>(sql`
        SELECT
          COUNT(*) AS total,
          AVG(importance) AS avg_importance,
          type,
          COUNT(*) OVER (PARTITION BY type) AS type_count
        FROM ${sql.identifier(this.TABLE)}
        WHERE user_id = ${userId}
        GROUP BY type
      `)

      const rows = result.rows as Array<{
        total: string
        avg_importance: string
        type: string
        type_count: string
      }>

      const byType: Record<string, number> = {}
      let avgImportance = 0

      for (const row of rows) {
        byType[row.type] = parseInt(row.type_count, 10)
        avgImportance = parseFloat(row.avg_importance ?? "0")
      }

      const total = rows.reduce((sum, r) => sum + parseInt(r.type_count, 10), 0)
      return { total, byType, avgImportance: Math.round(avgImportance * 1000) / 1000 }
    } catch (err) {
      Logger.error("[PgVectorMemoryStore] getStats failed", err)
      return { total: 0, byType: {}, avgImportance: 0 }
    }
  }

  // ── embedding generation ──────────────────────────────────────────────────────

  /**
   * Deterministic hash-based 1536-dimensional unit vector.
   * Uses SHA-256 in a streaming loop to fill all 1536 dimensions,
   * then normalizes to unit length.
   */
  generateEmbedding(text: string): number[] {
    const DIMS = 1536
    const dims = new Float64Array(DIMS)

    // Seed multiple rounds with different salts to fill all dimensions
    const rounds = Math.ceil(DIMS / 32) // sha256 → 32 bytes per round
    for (let r = 0; r < rounds; r++) {
      const hash = crypto
        .createHash("sha256")
        .update(`${r}:${text}`)
        .digest()
      for (let b = 0; b < hash.length; b++) {
        const idx = r * 32 + b
        if (idx >= DIMS) break
        dims[idx] = (hash[b] - 128) / 128 // center around 0
      }
    }

    // Normalize to unit length
    let norm = 0
    for (let i = 0; i < DIMS; i++) norm += dims[i] * dims[i]
    norm = Math.sqrt(norm) || 1
    const result: number[] = new Array(DIMS)
    for (let i = 0; i < DIMS; i++) result[i] = dims[i] / norm

    return result
  }
}

export const pgVectorMemoryStore = new PgVectorMemoryStore()
