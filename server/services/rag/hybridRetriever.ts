/**
 * Hybrid Retriever
 *
 * Combines BM25 (full-text) + vector search, applies MMR for diversity,
 * supports query rewriting and cross-encoder reranking.
 */

import crypto from "crypto";
import { db } from "../../db";
import { ragChunks, type RagChunk } from "@shared/schema/rag";
import { eq, and, sql, inArray, gte, lte, arrayContains } from "drizzle-orm";
import { getEmbedding, cosineSimilarity } from "../embeddings";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RetrievalOptions {
    tenantId: string;
    userId: string;
    conversationId?: string;
    topK?: number;
    vectorWeight?: number;
    bm25Weight?: number;
    minScore?: number;
    mmrLambda?: number;          // 0..1 — 1 = pure relevance, 0 = pure diversity
    aclTags?: string[];
    tags?: string[];
    sources?: string[];
    dateRange?: { start?: Date; end?: Date };
    enableReranker?: boolean;
    enableQueryRewrite?: boolean;
}

export interface ScoredChunk {
    id: string;
    content: string;
    score: number;
    vectorScore: number;
    bm25Score: number;
    rerankerScore?: number;
    pageNumber?: number;
    sectionTitle?: string | null;
    source: string;
    sourceId?: string | null;
    chunkType?: string | null;
    metadata: Record<string, unknown>;
    tags: string[];
}

export interface RetrievalResult {
    chunks: ScoredChunk[];
    rewrittenQuery?: string;
    totalCandidates: number;
    processingTimeMs: number;
}

// ---------------------------------------------------------------------------
// BM25 scoring (in-memory for candidate set)
// ---------------------------------------------------------------------------

function calculateBM25(
    queryTerms: string[],
    docTerms: string[],
    avgDocLen: number,
    k1 = 1.5,
    b = 0.75,
): number {
    const termFreq = new Map<string, number>();
    for (const t of docTerms) termFreq.set(t, (termFreq.get(t) || 0) + 1);

    let score = 0;
    for (const qt of queryTerms) {
        const tf = termFreq.get(qt) || 0;
        if (tf === 0) continue;
        const idf = Math.log(1 + 1 / (tf / docTerms.length + 0.5));
        const tfNorm = (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (docTerms.length / avgDocLen)));
        score += idf * tfNorm;
    }
    return score;
}

// ---------------------------------------------------------------------------
// Query rewriting (lightweight — keyword expansion)
// ---------------------------------------------------------------------------

const SPANISH_SYNONYMS: Record<string, string[]> = {
    "precio": ["costo", "tarifa", "valor"],
    "configurar": ["ajustar", "parametrizar", "setup"],
    "error": ["bug", "fallo", "problema", "issue"],
    "crear": ["generar", "añadir", "agregar", "nuevo"],
    "eliminar": ["borrar", "quitar", "remover", "delete"],
    "usuario": ["user", "cuenta", "perfil"],
    "archivo": ["file", "documento", "fichero"],
};

export function rewriteQuery(query: string): string {
    const lower = query.toLowerCase();
    const words = lower.split(/\s+/);

    const expanded: string[] = [...words];
    for (const word of words) {
        const syns = SPANISH_SYNONYMS[word];
        if (syns) expanded.push(...syns.slice(0, 2));
    }

    return [...new Set(expanded)].join(" ");
}

// ---------------------------------------------------------------------------
// MMR diversification
// ---------------------------------------------------------------------------

function applyMMR(
    candidates: ScoredChunk[],
    queryEmbedding: number[],
    topK: number,
    lambda: number,
    chunkEmbeddings: Map<string, number[]>,
): ScoredChunk[] {
    if (candidates.length === 0) return [];

    const selected: ScoredChunk[] = [candidates[0]];
    const remaining = candidates.slice(1);

    while (selected.length < topK && remaining.length > 0) {
        let bestIdx = 0;
        let bestMMR = -Infinity;

        for (let i = 0; i < remaining.length; i++) {
            const cand = remaining[i];
            const relevance = cand.score;

            // Max similarity to already-selected
            let maxSim = 0;
            const candEmb = chunkEmbeddings.get(cand.id);
            if (candEmb) {
                for (const sel of selected) {
                    const selEmb = chunkEmbeddings.get(sel.id);
                    if (selEmb) {
                        maxSim = Math.max(maxSim, cosineSimilarity(candEmb, selEmb));
                    }
                }
            }

            const mmr = lambda * relevance - (1 - lambda) * maxSim;
            if (mmr > bestMMR) {
                bestMMR = mmr;
                bestIdx = i;
            }
        }

        selected.push(remaining[bestIdx]);
        remaining.splice(bestIdx, 1);
    }

    return selected;
}

// ---------------------------------------------------------------------------
// Cross-encoder re-ranker (lightweight heuristic — no external model)
// ---------------------------------------------------------------------------

function crossEncoderRerank(query: string, chunks: ScoredChunk[]): ScoredChunk[] {
    const queryTerms = new Set(query.toLowerCase().split(/\s+/).filter((t) => t.length > 2));

    return chunks
        .map((chunk) => {
            let boost = 0;
            const contentLower = chunk.content.toLowerCase();
            const contentTerms = contentLower.split(/\s+/);

            // Exact match boost
            const exactMatches = contentTerms.filter((t) => queryTerms.has(t)).length;
            boost += exactMatches * 0.03;

            // Title match boost
            if (chunk.sectionTitle) {
                const titleTerms = chunk.sectionTitle.toLowerCase().split(/\s+/);
                boost += titleTerms.filter((t) => queryTerms.has(t)).length * 0.08;
            }

            // Proximity boost — consecutive query terms in content
            const queryArr = Array.from(queryTerms);
            for (let i = 0; i < queryArr.length - 1; i++) {
                const pattern = new RegExp(`${queryArr[i]}\\s+(?:\\S+\\s+){0,3}${queryArr[i + 1]}`, "i");
                if (pattern.test(chunk.content)) boost += 0.05;
            }

            // Chunk-type boosts
            if (chunk.chunkType === "heading") boost += 0.04;
            if (chunk.chunkType === "table" && /tabla|table|datos|data/i.test(query)) boost += 0.08;
            if (chunk.chunkType === "code" && /código|code|función|function/i.test(query)) boost += 0.08;

            return {
                ...chunk,
                rerankerScore: chunk.score + boost,
                score: chunk.score + boost,
            };
        })
        .sort((a, b) => b.score - a.score);
}

// ---------------------------------------------------------------------------
// Main hybrid retrieval
// ---------------------------------------------------------------------------

export async function retrieve(
    query: string,
    options: RetrievalOptions,
): Promise<RetrievalResult> {
    const startTime = Date.now();
    const {
        tenantId,
        userId,
        conversationId,
        topK = 5,
        vectorWeight = 0.6,
        bm25Weight = 0.4,
        minScore = 0.1,
        mmrLambda = 0.7,
        aclTags,
        tags,
        sources,
        dateRange,
        enableReranker = true,
        enableQueryRewrite = true,
    } = options;

    // 1. Optional query rewriting
    const effectiveQuery = enableQueryRewrite ? rewriteQuery(query) : query;
    const queryTerms = effectiveQuery.toLowerCase().split(/\s+/).filter((t) => t.length > 2);

    // 2. Generate query embedding
    const queryEmbedding = await getEmbedding(query);

    // 3. Build SQL conditions
    const conditions: ReturnType<typeof eq>[] = [
        eq(ragChunks.tenantId, tenantId),
        eq(ragChunks.userId, userId),
        eq(ragChunks.isActive, true),
    ];

    if (conversationId) conditions.push(eq(ragChunks.conversationId, conversationId));
    if (sources && sources.length > 0) conditions.push(inArray(ragChunks.source, sources));
    if (dateRange?.start) conditions.push(gte(ragChunks.createdAt, dateRange.start));
    if (dateRange?.end) conditions.push(lte(ragChunks.createdAt, dateRange.end));

    // 4. Fetch candidate chunks (wide retrieval)
    const candidateLimit = Math.max(topK * 5, 50);
    const allChunks = await db
        .select()
        .from(ragChunks)
        .where(and(...conditions))
        .limit(candidateLimit);

    if (allChunks.length === 0) {
        return { chunks: [], totalCandidates: 0, processingTimeMs: Date.now() - startTime };
    }

    // 5. ACL / tag filter (in-memory for flexibility with array overlap)
    let filtered = allChunks;
    if (aclTags && aclTags.length > 0) {
        filtered = filtered.filter((c) =>
            (c.aclTags || []).length === 0 || (c.aclTags || []).some((t) => aclTags.includes(t)),
        );
    }
    if (tags && tags.length > 0) {
        filtered = filtered.filter((c) => (c.tags || []).some((t) => tags.includes(t)));
    }

    // 6. Hybrid scoring
    const avgDocLen = filtered.reduce((s, c) => s + c.content.split(/\s+/).length, 0) / (filtered.length || 1);
    const chunkEmbeddings = new Map<string, number[]>();

    const scored: ScoredChunk[] = filtered.map((chunk) => {
        const chunkEmb = chunk.embedding as number[] | null;
        if (chunkEmb) chunkEmbeddings.set(chunk.id, chunkEmb);

        const vecScore =
            chunkEmb && chunkEmb.length === queryEmbedding.length
                ? cosineSimilarity(queryEmbedding, chunkEmb)
                : 0;

        const docTerms = chunk.content.toLowerCase().split(/\s+/);
        const bm25 = calculateBM25(queryTerms, docTerms, avgDocLen);
        const normBm25 = Math.min(bm25 / 10, 1);

        const combined = vectorWeight * vecScore + bm25Weight * normBm25;

        return {
            id: chunk.id,
            content: chunk.content,
            score: combined,
            vectorScore: vecScore,
            bm25Score: normBm25,
            pageNumber: chunk.pageNumber ?? undefined,
            sectionTitle: chunk.sectionTitle,
            source: chunk.source,
            sourceId: chunk.sourceId,
            chunkType: chunk.chunkType,
            metadata: (chunk.metadata as Record<string, unknown>) || {},
            tags: chunk.tags || [],
        };
    });

    // 7. Filter by min score & sort
    let results = scored.filter((c) => c.score >= minScore);
    results.sort((a, b) => b.score - a.score);

    // 8. Re-ranker
    if (enableReranker) {
        results = crossEncoderRerank(query, results);
    }

    // 9. MMR diversification
    results = applyMMR(results, queryEmbedding, topK, mmrLambda, chunkEmbeddings);

    // 10. Update access counts
    const resultIds = results.map((r) => r.id);
    if (resultIds.length > 0) {
        await db.execute(sql`
            UPDATE rag_chunks
            SET access_count = access_count + 1,
                last_accessed_at = NOW()
            WHERE id = ANY(${resultIds})
        `);
    }

    return {
        chunks: results,
        rewrittenQuery: enableQueryRewrite ? effectiveQuery : undefined,
        totalCandidates: filtered.length,
        processingTimeMs: Date.now() - startTime,
    };
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const hybridRetriever = {
    retrieve,
    rewriteQuery,
    calculateBM25,
};
