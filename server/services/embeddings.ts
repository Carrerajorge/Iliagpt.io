import { GoogleGenAI } from "@google/genai";
import * as crypto from "crypto";

const isTestEnv =
    process.env.NODE_ENV === "test" ||
    !!process.env.VITEST_WORKER_ID ||
    !!process.env.VITEST_POOL_ID;

// Avoid network calls during tests.
const ai = !isTestEnv && process.env.GEMINI_API_KEY
    ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
    : null;

// Configurable because some projects/keys don't have `text-embedding-004`.
const EMBEDDING_MODEL = process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-001";
const EMBEDDING_CACHE_SIZE = 1000;

// Simple in-memory cache
const embeddingCache = new Map<string, number[]>();

const MAX_TOKEN_CHARS = 8192; // Approx safe limit for standard models
const CONCURRENCY_LIMIT = 5;

class Semaphore {
    private tasks: (() => void)[] = [];
    private count = 0;
    constructor(private max: number) { }

    async acquire() {
        if (this.count < this.max) {
            this.count++;
            return;
        }
        await new Promise<void>(resolve => this.tasks.push(resolve));
        this.count++;
    }

    release() {
        this.count--;
        if (this.tasks.length > 0) {
            this.tasks.shift()!();
        }
    }
}

const limiter = new Semaphore(CONCURRENCY_LIMIT);

function generateFallbackEmbedding(text: string): number[] {
    const DIMENSIONS = 768;
    const embedding = new Array(DIMENSIONS).fill(0);

    const words = text
        .toLowerCase()
        .replace(/[^\w\s]/g, " ")
        .split(/\s+/)
        .filter(w => w.length > 2);

    for (let idx = 0; idx < words.length; idx++) {
        const word = words[idx];
        let hash = 0;
        for (let i = 0; i < word.length; i++) {
            hash = ((hash << 5) - hash) + word.charCodeAt(i);
            hash = hash & hash;
        }
        const position = Math.abs(hash) % DIMENSIONS;
        embedding[position] += 1 / (idx + 1);
    }

    const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    if (magnitude > 0) {
        for (let i = 0; i < embedding.length; i++) embedding[i] /= magnitude;
    }

    return embedding;
}

export async function getEmbedding(text: string): Promise<number[]> {
    // Guard against type confusion via parameter tampering (CodeQL: type-confusion)
    if (typeof text !== "string") {
      throw new TypeError("getEmbedding: text must be a string");
    }
    // 1. Truncate to avoid 400 Bad Request (Token limit)
    // Improvement #7: Chunking/Truncation
    const safeText = text.length > MAX_TOKEN_CHARS ? text.slice(0, MAX_TOKEN_CHARS) : text;

    const hash = crypto.createHash("md5").update(safeText).digest("hex");

    if (embeddingCache.has(hash)) {
        return embeddingCache.get(hash)!;
    }

    // Improvement #4: Rate Limiting
    await limiter.acquire();

    try {
        if (!ai) {
            const embedding = generateFallbackEmbedding(safeText);
            embeddingCache.set(hash, embedding);
            return embedding;
        }

        const result = await ai.models.embedContent({
            model: EMBEDDING_MODEL,
            contents: [
                {
                    role: "user",
                    parts: [{ text: safeText }]
                }
            ]
        });

        const embedding = (result as any).embedding?.values || (result as any).embeddings?.values;
        if (!embedding) {
            throw new Error("No embedding returned");
        }

        // Cache management
        if (embeddingCache.size >= EMBEDDING_CACHE_SIZE) {
            const firstKey = embeddingCache.keys().next().value;
            if (firstKey) embeddingCache.delete(firstKey);
        }

        embeddingCache.set(hash, embedding);
        return embedding;
    } catch (error) {
        console.error("Embedding error:", error);
        throw error;
    } finally {
        limiter.release();
    }
}

export function cosineSimilarity(a: number[], b: number[]): number {
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
