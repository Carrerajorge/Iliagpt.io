/**
 * RAG-based Summarization Service
 * 
 * Features:
 * - Vector embeddings for documents
 * - Retrieve relevant chunks before summarizing
 * - Citation-backed summaries
 * - Multi-document synthesis
 */

import crypto from "crypto";
import { LRUCache } from "lru-cache";

// Simple vector embedding (production would use OpenAI/Cohere embeddings)
interface EmbeddingVector {
    id: string;
    text: string;
    vector: number[];
    metadata: {
        documentId?: string;
        title?: string;
        source?: string;
        pageNumber?: number;
    };
}

interface RAGConfig {
    chunkSize: number;
    chunkOverlap: number;
    topK: number;              // Number of chunks to retrieve
    minSimilarity: number;     // Minimum cosine similarity threshold
    maxContextTokens: number;  // Max tokens for context window
}

const DEFAULT_CONFIG: RAGConfig = {
    chunkSize: 500,
    chunkOverlap: 100,
    topK: 5,
    minSimilarity: 0.7,
    maxContextTokens: 4000,
};

// Vector store (in-memory for simplicity)
const vectorStore: EmbeddingVector[] = [];

// Embedding cache
const embeddingCache = new LRUCache<string, number[]>({
    max: 1000,
    ttl: 60 * 60 * 1000, // 1 hour
});

// Simple TF-IDF based embedding (placeholder for real embeddings)
function createSimpleEmbedding(text: string): number[] {
    const words = text.toLowerCase().split(/\W+/).filter(w => w.length > 2);
    const wordFreq = new Map<string, number>();

    for (const word of words) {
        wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
    }

    // Create a fixed-size vector using hash-based projection
    const vectorSize = 256;
    const vector = new Array(vectorSize).fill(0);

    for (const [word, freq] of wordFreq) {
        const hash = crypto.createHash("md5").update(word).digest();
        for (let i = 0; i < 4; i++) {
            const idx = hash[i * 4] % vectorSize;
            const sign = hash[i * 4 + 1] % 2 === 0 ? 1 : -1;
            vector[idx] += sign * freq;
        }
    }

    // Normalize
    const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    if (magnitude > 0) {
        for (let i = 0; i < vector.length; i++) {
            vector[i] /= magnitude;
        }
    }

    return vector;
}

// Cosine similarity between vectors
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

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : dotProduct / denominator;
}

// Split text into chunks
function chunkText(text: string, config: RAGConfig): string[] {
    const chunks: string[] = [];
    const sentences = text.split(/(?<=[.!?])\s+/);

    let currentChunk = "";

    for (const sentence of sentences) {
        if (currentChunk.length + sentence.length > config.chunkSize) {
            if (currentChunk.length > 0) {
                chunks.push(currentChunk.trim());
                // Keep overlap
                const words = currentChunk.split(" ");
                const overlapWords = Math.floor(config.chunkOverlap / 5); // ~5 chars per word
                currentChunk = words.slice(-overlapWords).join(" ") + " ";
            }
        }
        currentChunk += sentence + " ";
    }

    if (currentChunk.trim().length > 0) {
        chunks.push(currentChunk.trim());
    }

    return chunks;
}

// Index a document
export async function indexDocument(
    documentId: string,
    text: string,
    metadata: { title?: string; source?: string } = {}
): Promise<number> {
    const chunks = chunkText(text, DEFAULT_CONFIG);
    let indexed = 0;

    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const cacheKey = crypto.createHash("md5").update(chunk).digest("hex");

        let vector = embeddingCache.get(cacheKey);
        if (!vector) {
            vector = createSimpleEmbedding(chunk);
            embeddingCache.set(cacheKey, vector);
        }

        vectorStore.push({
            id: `${documentId}_chunk_${i}`,
            text: chunk,
            vector,
            metadata: {
                documentId,
                title: metadata.title,
                source: metadata.source,
                pageNumber: i + 1,
            },
        });

        indexed++;
    }

    console.log(`[RAG] Indexed ${indexed} chunks for document ${documentId}`);
    return indexed;
}

// Retrieve relevant chunks for a query
export function retrieveChunks(
    query: string,
    options: Partial<RAGConfig> = {}
): { chunk: EmbeddingVector; score: number }[] {
    const config = { ...DEFAULT_CONFIG, ...options };
    const queryVector = createSimpleEmbedding(query);

    const scored = vectorStore.map(chunk => ({
        chunk,
        score: cosineSimilarity(queryVector, chunk.vector),
    }));

    return scored
        .filter(s => s.score >= config.minSimilarity)
        .sort((a, b) => b.score - a.score)
        .slice(0, config.topK);
}

// Generate context for LLM from retrieved chunks
export function buildContext(
    retrievedChunks: { chunk: EmbeddingVector; score: number }[]
): string {
    const contextParts: string[] = [];

    for (const { chunk, score } of retrievedChunks) {
        const citation = chunk.metadata.title || chunk.metadata.source || "Unknown";
        contextParts.push(
            `[Source: ${citation}]\n${chunk.text}\n`
        );
    }

    return contextParts.join("\n---\n");
}

// Main RAG summarization function
export async function ragSummarize(
    query: string,
    options: {
        maxLength?: number;
        style?: "academic" | "simple" | "bullet";
        includeCitations?: boolean;
    } = {}
): Promise<{
    summary: string;
    sources: { title: string; relevance: number }[];
    context: string;
}> {
    const { maxLength = 500, style = "academic", includeCitations = true } = options;

    // Retrieve relevant chunks
    const retrieved = retrieveChunks(query);

    if (retrieved.length === 0) {
        return {
            summary: "No se encontraron documentos relevantes para esta consulta.",
            sources: [],
            context: "",
        };
    }

    // Build context
    const context = buildContext(retrieved);

    // Extract unique sources
    const sources = [...new Map(
        retrieved.map(r => [
            r.chunk.metadata.documentId,
            {
                title: r.chunk.metadata.title || r.chunk.metadata.source || "Documento",
                relevance: r.score,
            },
        ])
    ).values()];

    // Generate summary prompt (would be sent to LLM)
    const summaryPrompt = buildSummaryPrompt(query, context, style, maxLength, includeCitations);

    // Placeholder: In production, call LLM here
    // const summary = await callLLM(summaryPrompt);

    // For now, create a simple extractive summary
    const summary = createExtractiveSummary(retrieved, query, maxLength);

    return {
        summary,
        sources,
        context,
    };
}

// Build prompt for LLM summarization
function buildSummaryPrompt(
    query: string,
    context: string,
    style: "academic" | "simple" | "bullet",
    maxLength: number,
    includeCitations: boolean
): string {
    const styleInstructions = {
        academic: "Escribe en un tono académico y formal, con terminología técnica apropiada.",
        simple: "Escribe de forma clara y sencilla, evitando jerga técnica.",
        bullet: "Presenta la información en forma de lista con viñetas, de forma concisa.",
    };

    return `
Basándote en el siguiente contexto, responde la pregunta del usuario.

CONTEXTO:
${context}

PREGUNTA DEL USUARIO:
${query}

INSTRUCCIONES:
- ${styleInstructions[style]}
- Mantén la respuesta en máximo ${maxLength} palabras.
${includeCitations ? "- Incluye referencias a las fuentes entre corchetes [Fuente]." : ""}
- Si el contexto no contiene información suficiente, indícalo claramente.

RESPUESTA:
`.trim();
}

// Create extractive summary (fallback when LLM unavailable)
function createExtractiveSummary(
    chunks: { chunk: EmbeddingVector; score: number }[],
    query: string,
    maxLength: number
): string {
    const queryWords = new Set(query.toLowerCase().split(/\W+/).filter(w => w.length > 3));

    // Extract most relevant sentences
    const sentences: { text: string; score: number; source: string }[] = [];

    for (const { chunk, score } of chunks) {
        const chunkSentences = chunk.text.split(/(?<=[.!?])\s+/);

        for (const sentence of chunkSentences) {
            if (sentence.length < 20) continue;

            const words = sentence.toLowerCase().split(/\W+/);
            const matchCount = words.filter(w => queryWords.has(w)).length;
            const sentenceScore = score * 0.7 + (matchCount / queryWords.size) * 0.3;

            sentences.push({
                text: sentence.trim(),
                score: sentenceScore,
                source: chunk.metadata.title || "Fuente",
            });
        }
    }

    // Sort by score and select top sentences
    sentences.sort((a, b) => b.score - a.score);

    let summary = "";
    const usedSentences = new Set<string>();

    for (const s of sentences) {
        // Avoid duplicates
        if (usedSentences.has(s.text)) continue;

        // Check length
        if (summary.length + s.text.length > maxLength * 5) break;

        summary += s.text + ` [${s.source}] `;
        usedSentences.add(s.text);
    }

    return summary.trim() || "No se pudo generar un resumen con la información disponible.";
}

// Get index statistics
export function getRAGStats(): {
    totalChunks: number;
    totalDocuments: number;
    avgChunkSize: number;
} {
    const documentIds = new Set(vectorStore.map(v => v.metadata.documentId));
    const totalLength = vectorStore.reduce((sum, v) => sum + v.text.length, 0);

    return {
        totalChunks: vectorStore.length,
        totalDocuments: documentIds.size,
        avgChunkSize: vectorStore.length > 0 ? Math.round(totalLength / vectorStore.length) : 0,
    };
}

// Clear vector store
export function clearRAGIndex(): void {
    vectorStore.length = 0;
    embeddingCache.clear();
}

// Remove document from index
export function removeDocumentFromIndex(documentId: string): number {
    const beforeCount = vectorStore.length;

    for (let i = vectorStore.length - 1; i >= 0; i--) {
        if (vectorStore[i].metadata.documentId === documentId) {
            vectorStore.splice(i, 1);
        }
    }

    return beforeCount - vectorStore.length;
}

export default {
    indexDocument,
    retrieveChunks,
    buildContext,
    ragSummarize,
    getRAGStats,
    clearRAGIndex,
    removeDocumentFromIndex,
};
