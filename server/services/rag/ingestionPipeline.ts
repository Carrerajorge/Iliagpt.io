/**
 * RAG Ingestion Pipeline
 *
 * Normalizes sources, performs semantic chunking, computes embeddings,
 * and persists chunks to the unified vector store with mandatory metadata.
 */

import crypto from "crypto";
import { db } from "../../db";
import { ragChunks, type InsertRagChunk } from "@shared/schema/rag";
import { eq, and, sql } from "drizzle-orm";
import { getEmbedding } from "../embeddings";
import { chunkDocument, type SemanticChunk, type ChunkingOptions } from "../semanticChunker";
import { Logger } from "../../lib/logger";
import * as qdrant from "../../lib/integrations/qdrantProvider";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IngestionSource {
    content: string;
    source: string;           // 'document' | 'message' | 'web' | 'email' | 'manual'
    sourceId?: string;
    title?: string;
    mimeType?: string;
    language?: string;
    pageMap?: Map<number, { start: number; end: number }>;
    metadata?: Record<string, unknown>;
}

export interface IngestionOptions {
    tenantId: string;
    userId: string;
    conversationId?: string;
    threadId?: string;
    aclTags?: string[];
    tags?: string[];
    chunking?: ChunkingOptions;
    skipDuplicates?: boolean;
    batchSize?: number;
}

export interface IngestionResult {
    chunksCreated: number;
    chunksSkipped: number;        // deduped
    totalTokensEstimated: number;
    processingTimeMs: number;
    chunkIds: string[];
}

// ---------------------------------------------------------------------------
// Source normalizer
// ---------------------------------------------------------------------------

function normalizeText(text: string): string {
    return text
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .replace(/\t/g, "    ")
        .replace(/\u00A0/g, " ")        // non-breaking space
        .replace(/\u200B/g, "")          // zero-width space
        .replace(/\uFEFF/g, "")          // BOM
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "") // control chars
        .replace(/\n{4,}/g, "\n\n\n")   // excessive newlines
        .trim();
}

function contentHash(text: string): string {
    return crypto.createHash("sha256").update(text).digest("hex");
}

function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
}

let _qdrantAvailable: boolean | null = null;

async function isQdrantAvailable(): Promise<boolean> {
    if (_qdrantAvailable !== null) return _qdrantAvailable;
    if (!process.env.QDRANT_URL) {
        _qdrantAvailable = false;
        return false;
    }
    try {
        const health = await qdrant.healthCheck();
        _qdrantAvailable = health.ok;
        if (health.ok) {
            await qdrant.ensureCollection(1536, "Cosine");
            Logger.info("[Ingestion] Qdrant dual-write enabled");
        }
    } catch {
        _qdrantAvailable = false;
    }
    return _qdrantAvailable;
}

function chunkIdToQdrantId(id: string): string {
    const hash = crypto.createHash("md5").update(id).digest("hex");
    return [
        hash.slice(0, 8),
        hash.slice(8, 12),
        hash.slice(12, 16),
        hash.slice(16, 20),
        hash.slice(20, 32),
    ].join("-");
}

async function qdrantDualWrite(
    chunkId: string,
    vector: number[],
    payload: Record<string, unknown>,
): Promise<void> {
    const available = await isQdrantAvailable();
    if (!available) return;

    try {
        await qdrant.upsertVectors([
            {
                id: chunkIdToQdrantId(chunkId),
                vector,
                payload: { ...payload, pgChunkId: chunkId },
            },
        ]);
    } catch (err) {
        Logger.warn("[Ingestion] Qdrant dual-write failed for chunk", {
            chunkId,
            error: (err as Error).message,
        });
    }
}

// ---------------------------------------------------------------------------
// Chunking adapter — wraps the existing semantic chunker
// ---------------------------------------------------------------------------

interface EnrichedChunk {
    content: string;
    chunkIndex: number;
    chunkType: string;
    pageNumber?: number;
    sectionTitle?: string;
    importance: number;
    metadata: Record<string, unknown>;
}

function adaptChunks(raw: SemanticChunk[], source: IngestionSource): EnrichedChunk[] {
    return raw.map((chunk, idx) => {
        const importanceMap: Record<string, number> = { high: 0.9, medium: 0.5, low: 0.2 };
        return {
            content: chunk.content,
            chunkIndex: idx,
            chunkType: chunk.type,
            pageNumber: chunk.pageNumber,
            sectionTitle: chunk.headingHierarchy?.join(" > ") || undefined,
            importance: importanceMap[chunk.metadata.importance] ?? 0.5,
            metadata: {
                wordCount: chunk.metadata.wordCount,
                charCount: chunk.metadata.charCount,
                hasCode: chunk.metadata.hasCode,
                hasTable: chunk.metadata.hasTable,
                hasList: chunk.metadata.hasList,
                startOffset: chunk.startOffset,
                endOffset: chunk.endOffset,
                language: source.language,
            },
        };
    });
}

// ---------------------------------------------------------------------------
// Embedding batch generator
// ---------------------------------------------------------------------------

async function generateEmbeddingsBatch(
    texts: string[],
    batchSize: number = 10,
): Promise<(number[] | null)[]> {
    const results: (number[] | null)[] = [];

    for (let i = 0; i < texts.length; i += batchSize) {
        const batch = texts.slice(i, i + batchSize);
        const embeddings = await Promise.all(
            batch.map(async (text) => {
                try {
                    return await getEmbedding(text);
                } catch {
                    return null;
                }
            }),
        );
        results.push(...embeddings);
    }

    return results;
}

// ---------------------------------------------------------------------------
// Main ingestion function
// ---------------------------------------------------------------------------

export async function ingest(
    source: IngestionSource,
    options: IngestionOptions,
): Promise<IngestionResult> {
    const startTime = Date.now();
    const normalized = normalizeText(source.content);

    if (normalized.length < 20) {
        return { chunksCreated: 0, chunksSkipped: 0, totalTokensEstimated: 0, processingTimeMs: 0, chunkIds: [] };
    }

    // 1. Semantic chunking
    const chunkResult = chunkDocument(normalized, {
        maxChunkSize: options.chunking?.maxChunkSize ?? 1200,
        minChunkSize: options.chunking?.minChunkSize ?? 100,
        overlapSize: options.chunking?.overlapSize ?? 150,
        respectHeadings: true,
        respectParagraphs: true,
        preserveCodeBlocks: true,
        preserveTables: true,
    });

    const enriched = adaptChunks(chunkResult.chunks, source);

    // 2. Compute embeddings in batches
    const embeddings = await generateEmbeddingsBatch(
        enriched.map((c) => c.content),
        options.batchSize ?? 10,
    );

    // 3. Persist — skip duplicates by content hash
    let created = 0;
    let skipped = 0;
    let totalTokens = 0;
    const chunkIds: string[] = [];

    for (let i = 0; i < enriched.length; i++) {
        const chunk = enriched[i];
        const hash = contentHash(chunk.content);
        totalTokens += estimateTokens(chunk.content);

        if (options.skipDuplicates !== false) {
            const existing = await db
                .select({ id: ragChunks.id })
                .from(ragChunks)
                .where(and(eq(ragChunks.userId, options.userId), eq(ragChunks.contentHash, hash)))
                .limit(1);

            if (existing.length > 0) {
                skipped++;
                chunkIds.push(existing[0].id);
                continue;
            }
        }

        const row: InsertRagChunk = {
            tenantId: options.tenantId,
            userId: options.userId,
            conversationId: options.conversationId,
            threadId: options.threadId,
            source: source.source,
            sourceId: source.sourceId,
            content: chunk.content,
            contentHash: hash,
            embedding: embeddings[i] ?? undefined,
            chunkIndex: chunk.chunkIndex,
            totalChunks: enriched.length,
            title: source.title,
            mimeType: source.mimeType,
            language: source.language,
            pageNumber: chunk.pageNumber,
            sectionTitle: chunk.sectionTitle,
            chunkType: chunk.chunkType,
            importance: chunk.importance,
            aclTags: options.aclTags ?? [],
            tags: options.tags ?? [],
            metadata: chunk.metadata,
            isActive: true,
        };

        const [inserted] = await db.insert(ragChunks).values(row).returning({ id: ragChunks.id });
        chunkIds.push(inserted.id);
        created++;

        if (embeddings[i] && embeddings[i].length > 0) {
            try {
                await qdrantDualWrite(inserted.id, embeddings[i], {
                    content: chunk.content,
                    userId: options.userId,
                    tenantId: options.tenantId,
                    source: source.source,
                    sourceId: source.sourceId,
                    title: source.title,
                    chunkIndex: chunk.chunkIndex,
                    contentHash: hash,
                });
            } catch {}
        }
    }

    // 4. Update tsvector via raw SQL (drizzle doesn't support generated tsvectors easily)
    if (chunkIds.length > 0) {
        await db.execute(sql`
            UPDATE rag_chunks
            SET search_vector = to_tsvector('spanish', coalesce(title,'') || ' ' || content)
            WHERE id = ANY(${chunkIds})
              AND search_vector IS NULL
        `);
    }

    return {
        chunksCreated: created,
        chunksSkipped: skipped,
        totalTokensEstimated: totalTokens,
        processingTimeMs: Date.now() - startTime,
        chunkIds,
    };
}

// ---------------------------------------------------------------------------
// Bulk delete by source
// ---------------------------------------------------------------------------

export async function deleteBySource(
    userId: string,
    source: string,
    sourceId?: string,
): Promise<number> {
    const conditions = [eq(ragChunks.userId, userId), eq(ragChunks.source, source)];
    if (sourceId) conditions.push(eq(ragChunks.sourceId, sourceId));

    const deleted = await db
        .delete(ragChunks)
        .where(and(...conditions))
        .returning({ id: ragChunks.id });

    if (deleted.length > 0) {
        try {
            const available = await isQdrantAvailable();
            if (available) {
                const filter: Record<string, unknown> = {
                    must: [
                        { key: "userId", match: { value: userId } },
                        { key: "source", match: { value: source } },
                        ...(sourceId ? [{ key: "sourceId", match: { value: sourceId } }] : []),
                    ],
                };
                await qdrant.deleteByFilter(filter);
            }
        } catch (err) {
            Logger.warn("[Ingestion] Qdrant delete sync failed", {
                error: (err as Error).message,
            });
        }
    }

    return deleted.length;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const ingestionPipeline = {
    ingest,
    deleteBySource,
    normalizeText,
    contentHash,
    estimateTokens,
};
