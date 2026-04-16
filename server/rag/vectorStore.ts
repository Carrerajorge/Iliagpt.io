/**
 * Vector Store — pgvector-backed similarity search.
 *
 * Uses the existing ragChunks table with its vector(1536) embedding column.
 * Supports: insert, similarity search (cosine), hybrid search (vector + keyword),
 * filtering by user/collection/tags.
 */

import { db } from "../db";
import { ragChunks } from "@shared/schema/rag";
import { eq, and, sql, inArray, ilike, or, desc, asc } from "drizzle-orm";
import { embed, embedBatch, cosineSimilarity, getActiveProvider } from "./embeddingService";
import crypto from "crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VectorDocument {
  content: string;
  embedding?: number[];
  metadata: {
    filename?: string;
    pageNumber?: number;
    sectionHeading?: string;
    chunkType?: string;
    contentHash?: string;
    collectionId?: string;
    source?: string;
    [key: string]: unknown;
  };
  userId: string;
  tags?: string[];
  aclTags?: string[];
}

export interface SearchOptions {
  query: string;
  userId: string;
  topK?: number;
  minScore?: number;
  collectionId?: string;
  tags?: string[];
  hybrid?: boolean;           // Enable BM25 + vector fusion
  hybridKeywordWeight?: number; // 0-1, weight for keyword search (default 0.3)
}

export interface SearchResult {
  id: string;
  content: string;
  score: number;
  metadata: Record<string, unknown>;
  retrievalMethod: "vector" | "keyword" | "hybrid";
}

// ---------------------------------------------------------------------------
// Insert
// ---------------------------------------------------------------------------

/**
 * Insert a single document chunk into the vector store.
 * Generates embedding if not provided.
 */
export async function insertDocument(doc: VectorDocument): Promise<string> {
  const embedding = doc.embedding ?? await embed(doc.content);
  const contentHash = doc.metadata.contentHash ??
    crypto.createHash("sha256").update(doc.content).digest("hex");

  const id = crypto.randomUUID();

  await db.insert(ragChunks).values({
    id,
    userId: doc.userId,
    content: doc.content,
    contentHash,
    embedding: embedding as any,
    source: doc.metadata.source || "document",
    sourceId: doc.metadata.collectionId || null,
    title: doc.metadata.filename || null,
    tags: doc.tags || [],
    aclTags: doc.aclTags || [],
    metadata: doc.metadata as any,
    isActive: true,
  }).onConflictDoNothing();

  return id;
}

/**
 * Insert multiple document chunks in batch.
 * Generates embeddings for all documents that don't have them.
 */
export async function insertDocuments(docs: VectorDocument[]): Promise<string[]> {
  if (docs.length === 0) return [];

  // Generate embeddings for docs missing them
  const needsEmbedding = docs.filter(d => !d.embedding);
  if (needsEmbedding.length > 0) {
    const vectors = await embedBatch(needsEmbedding.map(d => d.content));
    for (let i = 0; i < needsEmbedding.length; i++) {
      needsEmbedding[i].embedding = vectors[i];
    }
  }

  const ids: string[] = [];
  const BATCH = 50;

  for (let i = 0; i < docs.length; i += BATCH) {
    const batch = docs.slice(i, i + BATCH);
    const values = batch.map(doc => {
      const id = crypto.randomUUID();
      ids.push(id);
      return {
        id,
        userId: doc.userId,
        content: doc.content,
        contentHash: doc.metadata.contentHash ??
          crypto.createHash("sha256").update(doc.content).digest("hex"),
        embedding: doc.embedding as any,
        source: doc.metadata.source || "document",
        sourceId: doc.metadata.collectionId || null,
        title: doc.metadata.filename || null,
        tags: doc.tags || [],
        aclTags: doc.aclTags || [],
        metadata: doc.metadata as any,
        isActive: true,
      };
    });

    await db.insert(ragChunks).values(values).onConflictDoNothing();
  }

  return ids;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/**
 * Similarity search using pgvector cosine distance.
 */
export async function search(options: SearchOptions): Promise<SearchResult[]> {
  const {
    query,
    userId,
    topK = 10,
    minScore = 0.3,
    collectionId,
    tags,
    hybrid = false,
    hybridKeywordWeight = 0.3,
  } = options;

  if (hybrid) {
    return hybridSearch(options);
  }

  // Generate query embedding
  const queryEmbedding = await embed(query);

  // Build pgvector cosine similarity query
  // pgvector uses <=> for cosine distance (1 - similarity)
  const embeddingStr = `[${queryEmbedding.join(",")}]`;

  const conditions = [
    eq(ragChunks.userId, userId),
    eq(ragChunks.isActive, true),
  ];

  if (collectionId) {
    conditions.push(eq(ragChunks.sourceId, collectionId));
  }

  const results = await db
    .select({
      id: ragChunks.id,
      content: ragChunks.content,
      metadata: ragChunks.metadata,
      title: ragChunks.title,
      source: ragChunks.source,
      similarity: sql<number>`1 - (${ragChunks.embedding} <=> ${embeddingStr}::vector)`,
    })
    .from(ragChunks)
    .where(and(...conditions))
    .orderBy(sql`${ragChunks.embedding} <=> ${embeddingStr}::vector`)
    .limit(topK);

  return results
    .filter(r => (r.similarity ?? 0) >= minScore)
    .map(r => ({
      id: r.id,
      content: r.content,
      score: r.similarity ?? 0,
      metadata: {
        ...(r.metadata as Record<string, unknown> || {}),
        filename: r.title,
        source: r.source,
      },
      retrievalMethod: "vector" as const,
    }));
}

/**
 * Hybrid search: combines vector similarity with keyword (full-text) search
 * using Reciprocal Rank Fusion (RRF).
 */
async function hybridSearch(options: SearchOptions): Promise<SearchResult[]> {
  const {
    query,
    userId,
    topK = 10,
    minScore = 0.2,
    collectionId,
    hybridKeywordWeight = 0.3,
  } = options;

  // Run both searches in parallel
  const [vectorResults, keywordResults] = await Promise.all([
    search({ ...options, hybrid: false, topK: topK * 2 }),
    keywordSearch(query, userId, topK * 2, collectionId),
  ]);

  // Reciprocal Rank Fusion
  const K = 60; // RRF constant
  const scores = new Map<string, { score: number; result: SearchResult }>();

  vectorResults.forEach((r, rank) => {
    const rrfScore = (1 - hybridKeywordWeight) / (K + rank + 1);
    scores.set(r.id, { score: rrfScore, result: { ...r, retrievalMethod: "hybrid" } });
  });

  keywordResults.forEach((r, rank) => {
    const rrfScore = hybridKeywordWeight / (K + rank + 1);
    const existing = scores.get(r.id);
    if (existing) {
      existing.score += rrfScore;
    } else {
      scores.set(r.id, { score: rrfScore, result: { ...r, retrievalMethod: "hybrid" } });
    }
  });

  return Array.from(scores.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .filter(s => s.score >= minScore * 0.01) // RRF scores are much smaller
    .map(s => ({ ...s.result, score: s.score }));
}

/**
 * Keyword search using PostgreSQL full-text search.
 */
async function keywordSearch(
  query: string,
  userId: string,
  topK: number,
  collectionId?: string,
): Promise<SearchResult[]> {
  const conditions = [
    eq(ragChunks.userId, userId),
    eq(ragChunks.isActive, true),
  ];

  if (collectionId) {
    conditions.push(eq(ragChunks.sourceId, collectionId));
  }

  // Use PostgreSQL ts_rank for relevance scoring
  const tsQuery = query
    .split(/\s+/)
    .filter(w => w.length > 1)
    .map(w => w.replace(/[^a-zA-Z0-9áéíóúñüÁÉÍÓÚÑÜ]/g, ""))
    .filter(Boolean)
    .join(" & ");

  if (!tsQuery) return [];

  try {
    const results = await db
      .select({
        id: ragChunks.id,
        content: ragChunks.content,
        metadata: ragChunks.metadata,
        title: ragChunks.title,
        source: ragChunks.source,
        rank: sql<number>`ts_rank(to_tsvector('spanish', ${ragChunks.content}), to_tsquery('spanish', ${tsQuery}))`,
      })
      .from(ragChunks)
      .where(and(
        ...conditions,
        sql`to_tsvector('spanish', ${ragChunks.content}) @@ to_tsquery('spanish', ${tsQuery})`,
      ))
      .orderBy(desc(sql`ts_rank(to_tsvector('spanish', ${ragChunks.content}), to_tsquery('spanish', ${tsQuery}))`))
      .limit(topK);

    return results.map(r => ({
      id: r.id,
      content: r.content,
      score: r.rank ?? 0,
      metadata: {
        ...(r.metadata as Record<string, unknown> || {}),
        filename: r.title,
        source: r.source,
      },
      retrievalMethod: "keyword" as const,
    }));
  } catch {
    // Fallback to ILIKE if full-text search fails
    const words = query.split(/\s+/).filter(w => w.length > 2).slice(0, 5);
    if (words.length === 0) return [];

    const likeConditions = words.map(w => ilike(ragChunks.content, `%${w}%`));

    const results = await db
      .select({
        id: ragChunks.id,
        content: ragChunks.content,
        metadata: ragChunks.metadata,
        title: ragChunks.title,
        source: ragChunks.source,
      })
      .from(ragChunks)
      .where(and(...conditions, or(...likeConditions)))
      .limit(topK);

    return results.map((r, i) => ({
      id: r.id,
      content: r.content,
      score: 1 / (i + 1),
      metadata: {
        ...(r.metadata as Record<string, unknown> || {}),
        filename: r.title,
        source: r.source,
      },
      retrievalMethod: "keyword" as const,
    }));
  }
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

/**
 * Delete all chunks for a collection or file.
 */
export async function deleteByCollection(userId: string, collectionId: string): Promise<number> {
  const result = await db
    .delete(ragChunks)
    .where(and(
      eq(ragChunks.userId, userId),
      eq(ragChunks.sourceId, collectionId),
    ));
  return (result as any).rowCount ?? 0;
}

export async function deleteByContentHash(userId: string, contentHash: string): Promise<void> {
  await db
    .delete(ragChunks)
    .where(and(
      eq(ragChunks.userId, userId),
      eq(ragChunks.contentHash, contentHash),
    ));
}
