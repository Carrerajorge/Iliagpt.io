/**
 * RAG Relevance Scoring (#45)
 * Improved retrieval with semantic relevance ranking
 */

import crypto from 'crypto';

// ============================================
// TYPES
// ============================================

interface DocumentChunk {
    id: string;
    content: string;
    metadata: {
        source: string;
        page?: number;
        section?: string;
        timestamp?: Date;
    };
    embedding?: number[];
}

interface RankedChunk extends DocumentChunk {
    score: number;
    relevanceFactors: {
        semantic: number;
        keyword: number;
        recency: number;
        position: number;
        diversity: number;
    };
}

interface RetrievalOptions {
    topK?: number;
    minScore?: number;
    diversityFactor?: number;
    recencyWeight?: number;
    includeMetadata?: boolean;
}

// ============================================
// SCORING FUNCTIONS
// ============================================

/**
 * Cosine similarity between two vectors
 */
function cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }

    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    return magnitude === 0 ? 0 : dotProduct / magnitude;
}

/**
 * BM25-style keyword scoring
 */
function keywordScore(query: string, content: string): number {
    const queryTerms = query.toLowerCase().split(/\s+/);
    const contentLower = content.toLowerCase();
    const contentTerms = contentLower.split(/\s+/);

    let score = 0;
    const avgLength = 500; // Assumed average document length
    const k1 = 1.5;
    const b = 0.75;

    for (const term of queryTerms) {
        const termFreq = contentTerms.filter(t => t.includes(term)).length;
        if (termFreq > 0) {
            // Simplified BM25
            const idf = Math.log((10 + 1) / (5 + 0.5)); // Simplified IDF
            const tf = (termFreq * (k1 + 1)) / (termFreq + k1 * (1 - b + b * (contentTerms.length / avgLength)));
            score += idf * tf;
        }
    }

    return Math.min(1, score / queryTerms.length);
}

/**
 * Recency score based on timestamp
 */
function recencyScore(timestamp?: Date): number {
    if (!timestamp) return 0.5;

    const ageMs = Date.now() - timestamp.getTime();
    const ageDays = ageMs / (24 * 60 * 60 * 1000);

    // Exponential decay with half-life of 30 days
    return Math.exp(-ageDays / 30);
}

/**
 * Position score (prefer chunks from beginning of document)
 */
function positionScore(page?: number, totalPages?: number): number {
    if (!page || !totalPages || totalPages === 0) return 0.5;

    // Linear preference for earlier pages
    return 1 - (page - 1) / totalPages;
}

/**
 * Calculate diversity score compared to already selected chunks
 */
function diversityScore(chunk: DocumentChunk, selected: DocumentChunk[]): number {
    if (selected.length === 0) return 1;

    // Calculate average dissimilarity to selected chunks
    let totalSimilarity = 0;

    for (const s of selected) {
        if (chunk.embedding && s.embedding) {
            totalSimilarity += cosineSimilarity(chunk.embedding, s.embedding);
        } else {
            // Fallback: Jaccard similarity of terms
            const chunkTerms = new Set(chunk.content.toLowerCase().split(/\s+/));
            const selectedTerms = new Set(s.content.toLowerCase().split(/\s+/));
            const intersection = [...chunkTerms].filter(t => selectedTerms.has(t)).length;
            const union = chunkTerms.size + selectedTerms.size - intersection;
            totalSimilarity += union > 0 ? intersection / union : 0;
        }
    }

    const avgSimilarity = totalSimilarity / selected.length;
    return 1 - avgSimilarity; // Higher diversity = lower similarity
}

// ============================================
// RETRIEVAL SERVICE
// ============================================

export class RAGRetriever {
    private weights = {
        semantic: 0.5,
        keyword: 0.25,
        recency: 0.1,
        position: 0.05,
        diversity: 0.1,
    };

    constructor(weights?: Partial<typeof RAGRetriever.prototype.weights>) {
        if (weights) {
            this.weights = { ...this.weights, ...weights };
        }
    }

    /**
     * Retrieve and rank relevant chunks
     */
    retrieve(
        query: string,
        queryEmbedding: number[],
        chunks: DocumentChunk[],
        options: RetrievalOptions = {}
    ): RankedChunk[] {
        const {
            topK = 5,
            minScore = 0.3,
            diversityFactor = 0.1,
        } = options;

        // Score all chunks
        const scoredChunks: RankedChunk[] = chunks.map(chunk => {
            const relevanceFactors = {
                semantic: chunk.embedding
                    ? cosineSimilarity(queryEmbedding, chunk.embedding)
                    : 0,
                keyword: keywordScore(query, chunk.content),
                recency: recencyScore(chunk.metadata.timestamp),
                position: positionScore(chunk.metadata.page, 100),
                diversity: 1, // Will be calculated during selection
            };

            // Weighted score (without diversity for now)
            const baseScore =
                relevanceFactors.semantic * this.weights.semantic +
                relevanceFactors.keyword * this.weights.keyword +
                relevanceFactors.recency * this.weights.recency +
                relevanceFactors.position * this.weights.position;

            return {
                ...chunk,
                score: baseScore,
                relevanceFactors,
            };
        });

        // Sort by initial score
        scoredChunks.sort((a, b) => b.score - a.score);

        // Apply MMR-style diversity selection
        const selected: RankedChunk[] = [];
        const remaining = [...scoredChunks];

        while (selected.length < topK && remaining.length > 0) {
            // Recalculate scores with diversity
            for (const chunk of remaining) {
                chunk.relevanceFactors.diversity = diversityScore(chunk, selected);
                chunk.score =
                    (1 - diversityFactor) * (
                        chunk.relevanceFactors.semantic * this.weights.semantic +
                        chunk.relevanceFactors.keyword * this.weights.keyword +
                        chunk.relevanceFactors.recency * this.weights.recency +
                        chunk.relevanceFactors.position * this.weights.position
                    ) +
                    diversityFactor * chunk.relevanceFactors.diversity;
            }

            // Sort by updated score
            remaining.sort((a, b) => b.score - a.score);

            // Select top scoring chunk
            const best = remaining.shift()!;
            if (best.score >= minScore) {
                selected.push(best);
            } else {
                break; // No more chunks meet minimum score
            }
        }

        return selected;
    }

    /**
     * Deduplicate semantically similar chunks
     */
    deduplicate(chunks: DocumentChunk[], threshold: number = 0.9): DocumentChunk[] {
        const unique: DocumentChunk[] = [];

        for (const chunk of chunks) {
            let isDuplicate = false;

            for (const existing of unique) {
                if (chunk.embedding && existing.embedding) {
                    const similarity = cosineSimilarity(chunk.embedding, existing.embedding);
                    if (similarity >= threshold) {
                        isDuplicate = true;
                        break;
                    }
                }
            }

            if (!isDuplicate) {
                unique.push(chunk);
            }
        }

        return unique;
    }

    /**
     * Rerank chunks using cross-encoder style scoring
     */
    rerank(
        query: string,
        chunks: RankedChunk[],
        reranker: (query: string, content: string) => Promise<number>
    ): Promise<RankedChunk[]> {
        return Promise.all(
            chunks.map(async chunk => ({
                ...chunk,
                score: await reranker(query, chunk.content),
            }))
        ).then(results => results.sort((a, b) => b.score - a.score));
    }

    /**
     * Build context string from ranked chunks
     */
    buildContext(chunks: RankedChunk[], maxTokens: number = 4000): string {
        const parts: string[] = [];
        let totalLength = 0;
        const tokensPerChar = 0.25;

        for (const chunk of chunks) {
            const estimated = chunk.content.length * tokensPerChar;

            if (totalLength + estimated > maxTokens) {
                // Truncate remaining space
                const remaining = maxTokens - totalLength;
                const chars = Math.floor(remaining / tokensPerChar);
                if (chars > 100) {
                    parts.push(chunk.content.substring(0, chars) + '...');
                }
                break;
            }

            parts.push(`[Source: ${chunk.metadata.source}]\n${chunk.content}`);
            totalLength += estimated;
        }

        return parts.join('\n\n---\n\n');
    }
}

// Singleton
export const ragRetriever = new RAGRetriever();
