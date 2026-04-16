/**
 * Multi-provider embedding service.
 *
 * Supports: OpenAI text-embedding-3-large, Gemini embedding-001,
 * and a deterministic local fallback for tests/offline.
 *
 * Usage:
 *   const vec = await embed("some text");
 *   const vecs = await embedBatch(["a", "b", "c"]);
 */

import crypto from "crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EmbeddingProvider = "openai" | "gemini" | "local";

export interface EmbeddingOptions {
  provider?: EmbeddingProvider;
  model?: string;
  dimensions?: number;
}

interface ProviderConfig {
  name: EmbeddingProvider;
  available: boolean;
  dimensions: number;
  model: string;
  embed: (texts: string[]) => Promise<number[][]>;
}

// ---------------------------------------------------------------------------
// Provider implementations
// ---------------------------------------------------------------------------

const isTestEnv =
  process.env.NODE_ENV === "test" ||
  !!process.env.VITEST_WORKER_ID;

// Cache: md5(text) → vector
const cache = new Map<string, number[]>();
const MAX_CACHE = 2000;

function cacheKey(text: string): string {
  return crypto.createHash("md5").update(text).digest("hex");
}

function cacheGet(text: string): number[] | undefined {
  return cache.get(cacheKey(text));
}

function cacheSet(text: string, vec: number[]): void {
  if (cache.size >= MAX_CACHE) {
    const first = cache.keys().next().value;
    if (first) cache.delete(first);
  }
  cache.set(cacheKey(text), vec);
}

// --- Local fallback (deterministic hash-based, works offline) ---

function localEmbed(text: string, dims: number = 768): number[] {
  const vec = new Array(dims).fill(0);
  const words = text.toLowerCase().replace(/[^\w\s]/g, " ").split(/\s+/).filter(w => w.length > 1);
  for (let i = 0; i < words.length; i++) {
    let h = 0;
    for (let j = 0; j < words[i].length; j++) {
      h = ((h << 5) - h + words[i].charCodeAt(j)) | 0;
    }
    vec[Math.abs(h) % dims] += 1 / (i + 1);
    // bigram feature
    if (i > 0) {
      const bigram = words[i - 1] + words[i];
      let h2 = 0;
      for (let j = 0; j < bigram.length; j++) {
        h2 = ((h2 << 5) - h2 + bigram.charCodeAt(j)) | 0;
      }
      vec[Math.abs(h2) % dims] += 0.5 / (i + 1);
    }
  }
  const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  if (mag > 0) for (let i = 0; i < vec.length; i++) vec[i] /= mag;
  return vec;
}

// --- OpenAI ---

async function openaiEmbed(texts: string[], model: string, dimensions: number): Promise<number[][]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");

  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: texts,
      dimensions,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`OpenAI embedding failed: ${res.status} ${err}`);
  }

  const data = (await res.json()) as { data: Array<{ embedding: number[] }> };
  return data.data.map(d => d.embedding);
}

// --- Gemini ---

async function geminiEmbed(texts: string[], model: string): Promise<number[][]> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not set");

  // Gemini batch embedding
  const results: number[][] = [];
  for (const text of texts) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: `models/${model}`,
          content: { parts: [{ text }] },
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!res.ok) {
      const err = await res.text().catch(() => "");
      throw new Error(`Gemini embedding failed: ${res.status} ${err}`);
    }
    const data = (await res.json()) as { embedding: { values: number[] } };
    results.push(data.embedding.values);
  }
  return results;
}

// ---------------------------------------------------------------------------
// Provider registry
// ---------------------------------------------------------------------------

function getProviders(): ProviderConfig[] {
  return [
    {
      name: "openai",
      available: !isTestEnv && !!process.env.OPENAI_API_KEY,
      dimensions: 1536,
      model: process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-large",
      embed: (texts) => openaiEmbed(texts, process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-large", 1536),
    },
    {
      name: "gemini",
      available: !isTestEnv && !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
      dimensions: 768,
      model: process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-001",
      embed: (texts) => geminiEmbed(texts, process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-001"),
    },
    {
      name: "local",
      available: true,
      dimensions: 768,
      model: "local-hash",
      embed: async (texts) => texts.map(t => localEmbed(t)),
    },
  ];
}

function selectProvider(preferred?: EmbeddingProvider): ProviderConfig {
  const providers = getProviders();

  if (preferred) {
    const p = providers.find(p => p.name === preferred && p.available);
    if (p) return p;
  }

  // Auto-select: OpenAI > Gemini > Local
  const available = providers.filter(p => p.available);
  return available[0] ?? providers[providers.length - 1]; // local is always last
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

let _activeProvider: ProviderConfig | null = null;

export function getActiveProvider(): { name: string; model: string; dimensions: number } {
  const p = _activeProvider ?? selectProvider();
  return { name: p.name, model: p.model, dimensions: p.dimensions };
}

/**
 * Embed a single text string. Uses cache when available.
 */
export async function embed(text: string, options?: EmbeddingOptions): Promise<number[]> {
  const cached = cacheGet(text);
  if (cached) return cached;

  const provider = selectProvider(options?.provider);
  _activeProvider = provider;

  const [vec] = await provider.embed([text.slice(0, 8192)]);
  cacheSet(text, vec);
  return vec;
}

/**
 * Embed multiple texts in batch. Much faster than calling embed() in a loop
 * for providers that support batch requests (OpenAI).
 */
export async function embedBatch(
  texts: string[],
  options?: EmbeddingOptions,
): Promise<number[][]> {
  const provider = selectProvider(options?.provider);
  _activeProvider = provider;

  // Check cache first
  const results: (number[] | null)[] = texts.map(t => cacheGet(t) ?? null);
  const uncached = texts
    .map((t, i) => (results[i] === null ? { text: t.slice(0, 8192), index: i } : null))
    .filter(Boolean) as Array<{ text: string; index: number }>;

  if (uncached.length > 0) {
    // Batch in groups of 100 (OpenAI limit)
    const BATCH_SIZE = 100;
    for (let i = 0; i < uncached.length; i += BATCH_SIZE) {
      const batch = uncached.slice(i, i + BATCH_SIZE);
      const vecs = await provider.embed(batch.map(b => b.text));
      for (let j = 0; j < batch.length; j++) {
        results[batch[j].index] = vecs[j];
        cacheSet(texts[batch[j].index], vecs[j]);
      }
    }
  }

  return results as number[][];
}

/**
 * Cosine similarity between two vectors.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const mag = Math.sqrt(normA) * Math.sqrt(normB);
  return mag === 0 ? 0 : dot / mag;
}
