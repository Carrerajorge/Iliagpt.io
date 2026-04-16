import { LIMITS } from "./lib/constants";

export interface TextChunk {
  content: string;
  chunkIndex: number;
  pageNumber?: number;
}

export function chunkText(text: string, chunkSize = 1000, overlap = 200): TextChunk[] {
  const chunks: TextChunk[] = [];
  const cleanedText = text.replace(/\s+/g, " ").trim();
  
  if (cleanedText.length <= chunkSize) {
    return [{ content: cleanedText, chunkIndex: 0 }];
  }

  let startIndex = 0;
  let chunkIndex = 0;

  while (startIndex < cleanedText.length) {
    let endIndex = Math.min(startIndex + chunkSize, cleanedText.length);
    
    if (endIndex < cleanedText.length) {
      const lastSpace = cleanedText.lastIndexOf(" ", endIndex);
      if (lastSpace > startIndex) {
        endIndex = lastSpace;
      }
    }

    const chunkContent = cleanedText.slice(startIndex, endIndex).trim();
    if (chunkContent.length > 0) {
      chunks.push({ content: chunkContent, chunkIndex });
      chunkIndex++;
    }

    startIndex = endIndex - overlap;
    if (startIndex >= cleanedText.length || endIndex >= cleanedText.length) break;
  }

  return chunks;
}

function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash;
}

function extractKeywords(text: string): string[] {
  const stopWords = new Set([
    'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'de', 'del', 'al',
    'y', 'o', 'a', 'en', 'que', 'es', 'por', 'para', 'con', 'no', 'se', 'su',
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of',
    'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
    'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might',
    'this', 'that', 'these', 'those', 'it', 'its', 'as', 'if', 'then', 'than'
  ]);
  
  return text
    .toLowerCase()
    .replace(/[^\w\sáéíóúñü]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 2 && !stopWords.has(word));
}

const EMBEDDING_DIMENSIONS = 1536;

// ── Simple in-process embedding fallback (used when no API key is configured) ──
function generateSimpleEmbedding(text: string): number[] {
  const keywords = extractKeywords(text.slice(0, LIMITS.MAX_EMBEDDING_INPUT));
  const embedding = new Array(EMBEDDING_DIMENSIONS).fill(0);

  keywords.forEach((word, idx) => {
    const hash = Math.abs(simpleHash(word));
    const position = hash % embedding.length;
    embedding[position] += 1 / (idx + 1);
  });

  const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
  if (magnitude > 0) {
    for (let i = 0; i < embedding.length; i++) {
      embedding[i] /= magnitude;
    }
  }

  return embedding;
}

// ── OpenAI embedding (text-embedding-3-small produces 1536-dim vectors) ──
async function generateOpenAIEmbedding(text: string): Promise<number[]> {
  const model = process.env.EMBEDDING_MODEL || "text-embedding-3-small";
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({ model, input: text.slice(0, 8000) }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`OpenAI embedding API error: ${response.status} ${response.statusText}`);
  }
  const data = await response.json() as { data: Array<{ embedding: number[] }> };
  return data.data[0].embedding;
}

// ── Gemini embedding ──
async function generateGeminiEmbedding(text: string): Promise<number[]> {
  const model = process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-001";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${process.env.GEMINI_API_KEY}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: { parts: [{ text: text.slice(0, 2048) }] } }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`Gemini embedding API error: ${response.status} ${response.statusText}`);
  }
  const data = await response.json() as { embedding?: { values: number[] } };
  const values = data.embedding?.values ?? [];
  // Gemini may return fewer dimensions; pad to 1536 if needed
  while (values.length < EMBEDDING_DIMENSIONS) values.push(0);
  return values.slice(0, EMBEDDING_DIMENSIONS);
}

const isTestEnv = () =>
  process.env.NODE_ENV === "test" ||
  !!process.env.VITEST_WORKER_ID ||
  !!process.env.VITEST_POOL_ID;

export async function generateEmbedding(text: string): Promise<number[]> {
  // Guard against type confusion via parameter tampering (CodeQL: type-confusion)
  if (typeof text !== "string") {
    throw new TypeError("generateEmbedding: text must be a string");
  }

  // Skip real API calls in test environments — use the deterministic fallback
  if (isTestEnv()) {
    return generateSimpleEmbedding(text);
  }

  // Try real API providers in preference order
  if (process.env.OPENAI_API_KEY) {
    try {
      return await generateOpenAIEmbedding(text);
    } catch (err) {
      console.warn("[EmbeddingService] OpenAI embedding failed, trying next provider:", (err as Error).message);
    }
  }

  if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) {
    // Support both env var names for Gemini
    process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    try {
      return await generateGeminiEmbedding(text);
    } catch (err) {
      console.warn("[EmbeddingService] Gemini embedding failed, using local fallback:", (err as Error).message);
    }
  }

  // Final fallback: deterministic local embedding
  return generateSimpleEmbedding(text);
}

export async function generateEmbeddingsBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  // OpenAI supports batching up to 2048 inputs at once — use it when available
  if (!isTestEnv() && process.env.OPENAI_API_KEY) {
    try {
      const model = process.env.EMBEDDING_MODEL || "text-embedding-3-small";
      const response = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({ model, input: texts.map(t => t.slice(0, 8000)) }),
        signal: AbortSignal.timeout(30_000),
      });
      if (response.ok) {
        const data = await response.json() as { data: Array<{ index: number; embedding: number[] }> };
        // Results may arrive out of order — sort by index
        const sorted = [...data.data].sort((a, b) => a.index - b.index);
        return sorted.map(d => d.embedding);
      }
      console.warn("[EmbeddingService] OpenAI batch embedding returned", response.status, "— falling through to sequential");
    } catch (err) {
      console.warn("[EmbeddingService] OpenAI batch embedding failed:", (err as Error).message);
    }
  }

  // Sequential fallback for other providers / test environments
  const embeddings: number[][] = [];
  for (const text of texts) {
    const embedding = await generateEmbedding(text);
    embeddings.push(embedding);
  }
  return embeddings;
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
