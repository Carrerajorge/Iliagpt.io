/**
 * Enhanced Hybrid RAG Engine
 *
 * Combines THREE retrieval strategies:
 *   1. Dense (Vector/Embedding) — semantic similarity
 *   2. Sparse (BM25/Keyword) — lexical matching
 *   3. Graph (GraphRAG) — entity-relation traversal
 *
 * With:
 *   - Cross-encoder reranking
 *   - MMR diversification
 *   - Query expansion (HyDE, sub-queries)
 *   - Reciprocal Rank Fusion for multi-strategy merging
 *   - Context-aware chunk assembly (with header propagation)
 *   - Traceable citations (doc → page → section)
 */

import crypto from 'crypto';
import { GoogleGenAI } from '@google/genai';
import { LRUCache } from 'lru-cache';
import { withSpan } from '../../lib/tracing';
import type { ContextualChunk } from './contextAwareChunker';
import type { KnowledgeGraph, SubgraphResult } from './graphRAG';
import { retrieveSubgraph } from './graphRAG';

// ============================================================================
// Configuration
// ============================================================================

const isTestEnv = process.env.NODE_ENV === 'test' || !!process.env.VITEST_WORKER_ID;
const genAI = !isTestEnv && process.env.GEMINI_API_KEY
  ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  : null;

const RAG_MODEL = process.env.RAG_MODEL || 'gemini-2.5-flash';
const EMBEDDING_MODEL = process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-001';

// Caches
const embeddingCache = new LRUCache<string, number[]>({
  max: 5000,
  ttl: 1000 * 60 * 60 * 24,
});

const queryCache = new LRUCache<string, HybridRAGResult>({
  max: 200,
  ttl: 1000 * 60 * 30,
});

// ============================================================================
// Types
// ============================================================================

export interface HybridRAGOptions {
  /** Top-K results (default: 10) */
  topK?: number;
  /** Weight for vector retrieval (default: 0.4) */
  vectorWeight?: number;
  /** Weight for BM25 retrieval (default: 0.3) */
  bm25Weight?: number;
  /** Weight for GraphRAG retrieval (default: 0.3) */
  graphWeight?: number;
  /** Enable cross-encoder reranking (default: true) */
  enableReranking?: boolean;
  /** Enable GraphRAG (default: true if graph provided) */
  enableGraphRAG?: boolean;
  /** Enable query expansion (default: true) */
  enableQueryExpansion?: boolean;
  /** Language for prompts (default: 'es') */
  language?: 'es' | 'en';
  /** Use cache (default: true) */
  useCache?: boolean;
}

export interface RetrievedResult {
  chunk: ContextualChunk;
  /** Combined score */
  score: number;
  /** Individual scores */
  scores: {
    vector: number;
    bm25: number;
    graph: number;
    reranker: number;
    rrf: number;
  };
  /** Citation info */
  citation: {
    fileName: string;
    pageNumber?: number;
    sectionTitle?: string;
    breadcrumb: string[];
    excerpt: string;
    chunkId: string;
  };
}

export interface HybridRAGResult {
  /** Ranked results */
  results: RetrievedResult[];
  /** Graph context (if GraphRAG was used) */
  graphContext?: SubgraphResult;
  /** Query expansion info */
  queryExpansion?: {
    original: string;
    hypothetical: string;
    subQueries: string[];
    keywords: string[];
  };
  /** Overall retrieval confidence */
  confidence: number;
  /** Processing time */
  processingTimeMs: number;
  /** Retrieval strategy stats */
  stats: {
    vectorCandidates: number;
    bm25Candidates: number;
    graphCandidates: number;
    afterFusion: number;
    afterReranking: number;
    afterMMR: number;
  };
}

// ============================================================================
// Embedding
// ============================================================================

async function embed(text: string): Promise<number[]> {
  const cacheKey = crypto.createHash('md5').update(text).digest('hex');
  const cached = embeddingCache.get(cacheKey);
  if (cached) return cached;

  try {
    if (!genAI) return fallbackEmbed(text);

    const result = await (genAI as any).models.embedContent({
      model: EMBEDDING_MODEL,
      contents: [{ role: 'user', parts: [{ text: text.slice(0, 8192) }] }],
    });
    const embedding = result.embeddings?.[0]?.values;
    if (embedding) {
      embeddingCache.set(cacheKey, embedding);
      return embedding;
    }
    return fallbackEmbed(text);
  } catch {
    return fallbackEmbed(text);
  }
}

function fallbackEmbed(text: string): number[] {
  const hash = crypto.createHash('sha256').update(text).digest();
  return Array.from({ length: 768 }, (_, i) => (hash[i % hash.length] / 255) * 2 - 1);
}

function cosineSim(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) || 1);
}

// ============================================================================
// BM25
// ============================================================================

function bm25Score(query: string, doc: string, avgLen: number, k1 = 1.5, b = 0.75): number {
  const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
  const docTerms = doc.toLowerCase().split(/\s+/);
  const docLen = docTerms.length;

  const tf = new Map<string, number>();
  for (const t of docTerms) tf.set(t, (tf.get(t) || 0) + 1);

  let score = 0;
  for (const term of queryTerms) {
    const freq = tf.get(term) || 0;
    if (freq === 0) continue;
    const idf = Math.log(1 + 1 / (freq / docLen + 0.5));
    const tfNorm = (freq * (k1 + 1)) / (freq + k1 * (1 - b + b * (docLen / avgLen)));
    score += idf * tfNorm;
  }
  return score;
}

// ============================================================================
// Query Expansion
// ============================================================================

async function expandQuery(query: string, language: string = 'es'): Promise<{
  hypothetical: string;
  subQueries: string[];
  keywords: string[];
}> {
  if (!genAI) {
    return {
      hypothetical: query,
      subQueries: [query],
      keywords: query.toLowerCase().split(/\s+/).filter(w => w.length > 3),
    };
  }

  const prompt = language === 'es'
    ? `Para esta consulta, genera:
1. Un párrafo hipotético que respondería perfectamente (HyDE)
2. 2-3 sub-preguntas específicas
3. 5-8 palabras clave relevantes

Consulta: ${query}

Responde en JSON:
{"hypothetical": "...", "subQueries": ["..."], "keywords": ["..."]}`
    : `For this query, generate:
1. A hypothetical paragraph that would perfectly answer it (HyDE)
2. 2-3 specific sub-questions
3. 5-8 relevant keywords

Query: ${query}

Respond in JSON:
{"hypothetical": "...", "subQueries": ["..."], "keywords": ["..."]}`;

  try {
    const result = await (genAI as any).models.generateContent({
      model: RAG_MODEL,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 2048, responseMimeType: 'application/json' },
    });

    const rawText = result.text || '{}';
    const parsed = JSON.parse(rawText.match(/\{[\s\S]*\}/)?.[0] || '{}');

    return {
      hypothetical: parsed.hypothetical || query,
      subQueries: Array.isArray(parsed.subQueries) ? parsed.subQueries : [query],
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
    };
  } catch {
    return {
      hypothetical: query,
      subQueries: [query],
      keywords: query.toLowerCase().split(/\s+/).filter(w => w.length > 3),
    };
  }
}

// ============================================================================
// Cross-Encoder Reranking
// ============================================================================

async function rerankWithCrossEncoder(
  query: string,
  candidates: RetrievedResult[],
  topK: number,
  language: string,
): Promise<RetrievedResult[]> {
  if (!genAI || candidates.length === 0) return candidates.slice(0, topK);

  const maxCandidates = Math.min(candidates.length, 25);
  const toRerank = candidates.slice(0, maxCandidates);

  const prompt = language === 'es'
    ? `Evalúa la relevancia de cada pasaje para la pregunta. Puntúa de 0.0 a 1.0.
Pregunta: ${query}

${toRerank.map((r, i) => `[${i + 1}] ${r.chunk.fullContent.slice(0, 400)}`).join('\n\n')}

Responde SOLO con números separados por comas:`
    : `Rate the relevance of each passage to the question. Score from 0.0 to 1.0.
Question: ${query}

${toRerank.map((r, i) => `[${i + 1}] ${r.chunk.fullContent.slice(0, 400)}`).join('\n\n')}

Respond ONLY with comma-separated numbers:`;

  try {
    const result = await (genAI as any).models.generateContent({
      model: RAG_MODEL,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 256 },
    });

    const scores = (result.text || '').match(/[\d.]+/g)?.map(Number) || [];
    for (let i = 0; i < toRerank.length; i++) {
      toRerank[i].scores.reranker = scores[i] || toRerank[i].score;
      toRerank[i].score = (toRerank[i].score * 0.4) + ((scores[i] || toRerank[i].score) * 0.6);
    }

    toRerank.sort((a, b) => b.score - a.score);
    return toRerank.slice(0, topK);
  } catch {
    return candidates.slice(0, topK);
  }
}

// ============================================================================
// Reciprocal Rank Fusion
// ============================================================================

function reciprocalRankFusion(
  rankings: Map<string, number>[],
  weights: number[],
  k: number = 60,
): Map<string, number> {
  const fused = new Map<string, number>();

  for (let r = 0; r < rankings.length; r++) {
    const ranking = rankings[r];
    const weight = weights[r] || 1;

    // Sort by score to get ranks
    const sorted = Array.from(ranking.entries()).sort((a, b) => b[1] - a[1]);
    for (let rank = 0; rank < sorted.length; rank++) {
      const [id, _] = sorted[rank];
      const rrfScore = weight / (k + rank + 1);
      fused.set(id, (fused.get(id) || 0) + rrfScore);
    }
  }

  return fused;
}

// ============================================================================
// MMR Diversification
// ============================================================================

function mmrDiversify(
  results: RetrievedResult[],
  topK: number,
  lambda: number = 0.7,
): RetrievedResult[] {
  if (results.length <= topK) return results;

  const selected: RetrievedResult[] = [results[0]];
  const remaining = results.slice(1);

  while (selected.length < topK && remaining.length > 0) {
    let bestIdx = 0;
    let bestMMR = -Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i];
      const relevance = candidate.score;

      let maxSim = 0;
      for (const sel of selected) {
        const sim = jaccardSimilarity(candidate.chunk.content, sel.chunk.content);
        maxSim = Math.max(maxSim, sim);
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

function jaccardSimilarity(a: string, b: string): number {
  const setA = new Set(a.toLowerCase().split(/\s+/));
  const setB = new Set(b.toLowerCase().split(/\s+/));
  const intersection = new Set([...setA].filter(x => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return intersection.size / (union.size || 1);
}

// ============================================================================
// Main Hybrid Retrieval
// ============================================================================

/**
 * Perform hybrid retrieval (vector + BM25 + GraphRAG) with reranking.
 */
export async function hybridRetrieve(
  query: string,
  chunks: ContextualChunk[],
  graph?: KnowledgeGraph,
  options: HybridRAGOptions = {},
): Promise<HybridRAGResult> {
  return withSpan('hybrid_rag.retrieve', async (span) => {
    const startTime = Date.now();
    const {
      topK = 10,
      vectorWeight = 0.4,
      bm25Weight = 0.3,
      graphWeight = 0.3,
      enableReranking = true,
      enableGraphRAG = !!graph,
      enableQueryExpansion = true,
      language = 'es',
      useCache = true,
    } = options;

    span.setAttribute('hrag.query_length', query.length);
    span.setAttribute('hrag.chunk_count', chunks.length);
    span.setAttribute('hrag.top_k', topK);
    span.setAttribute('hrag.graph_enabled', enableGraphRAG);

    // Check cache
    const cacheKey = crypto.createHash('md5').update(`${query}:${chunks.length}:${topK}`).digest('hex');
    if (useCache) {
      const cached = queryCache.get(cacheKey);
      if (cached) return cached;
    }

    // 1. Query Expansion
    let queryExpansion: HybridRAGResult['queryExpansion'];
    let expandedQuery = query;
    if (enableQueryExpansion) {
      const expansion = await expandQuery(query, language);
      queryExpansion = { original: query, ...expansion };
      expandedQuery = `${query} ${expansion.keywords.join(' ')}`;
    }

    // 2. Vector Retrieval
    const queryEmb = await embed(expandedQuery);
    let hydeEmb: number[] | null = null;
    if (queryExpansion?.hypothetical) {
      hydeEmb = await embed(queryExpansion.hypothetical);
    }
    const combinedEmb = hydeEmb
      ? queryEmb.map((v, i) => v * 0.6 + hydeEmb![i] * 0.4)
      : queryEmb;

    // Pre-compute chunk embeddings (if not cached)
    const chunkEmbeddings = await Promise.all(
      chunks.map(c => embed(c.content)),
    );

    const vectorScores = new Map<string, number>();
    for (let i = 0; i < chunks.length; i++) {
      const sim = cosineSim(combinedEmb, chunkEmbeddings[i]);
      vectorScores.set(chunks[i].id, sim);
    }

    // 3. BM25 Retrieval
    const avgLen = chunks.reduce((s, c) => s + c.content.split(/\s+/).length, 0) / (chunks.length || 1);
    const bm25Scores = new Map<string, number>();
    for (const chunk of chunks) {
      const score = bm25Score(query, chunk.content, avgLen);
      bm25Scores.set(chunk.id, score);
    }

    // Normalize BM25 scores
    const maxBM25 = Math.max(...bm25Scores.values(), 0.001);
    for (const [id, score] of bm25Scores) {
      bm25Scores.set(id, score / maxBM25);
    }

    // 4. GraphRAG Retrieval
    let graphResult: SubgraphResult | undefined;
    const graphScores = new Map<string, number>();
    if (enableGraphRAG && graph) {
      graphResult = await retrieveSubgraph(graph, query, { maxEntities: 20, maxHops: 2 });
      for (const chunkId of graphResult.referencedChunkIds) {
        graphScores.set(chunkId, graphResult.score);
      }
    }

    // 5. Reciprocal Rank Fusion
    const rankings: Map<string, number>[] = [vectorScores, bm25Scores];
    const weights: number[] = [vectorWeight, bm25Weight];
    if (enableGraphRAG) {
      rankings.push(graphScores);
      weights.push(graphWeight);
    }

    const fusedScores = reciprocalRankFusion(rankings, weights);

    // 6. Build result objects
    const chunkMap = new Map(chunks.map(c => [c.id, c]));
    let results: RetrievedResult[] = [];

    for (const [id, rrfScore] of fusedScores) {
      const chunk = chunkMap.get(id);
      if (!chunk) continue;

      results.push({
        chunk,
        score: rrfScore,
        scores: {
          vector: vectorScores.get(id) || 0,
          bm25: bm25Scores.get(id) || 0,
          graph: graphScores.get(id) || 0,
          reranker: 0,
          rrf: rrfScore,
        },
        citation: {
          fileName: chunk.source.fileName,
          pageNumber: chunk.source.pageNumber,
          sectionTitle: chunk.source.sectionTitle,
          breadcrumb: chunk.breadcrumb,
          excerpt: chunk.content.slice(0, 300),
          chunkId: chunk.id,
        },
      });
    }

    results.sort((a, b) => b.score - a.score);
    const afterFusion = results.length;

    // 7. Cross-encoder Reranking
    if (enableReranking && results.length > 0) {
      results = await rerankWithCrossEncoder(query, results, topK * 2, language);
    }
    const afterReranking = results.length;

    // 8. MMR Diversification
    results = mmrDiversify(results, topK);
    const afterMMR = results.length;

    // 9. Compute confidence
    const confidence = results.length > 0
      ? Math.min(1, results[0].score * 1.5 + (results.length / topK) * 0.3)
      : 0;

    const processingTimeMs = Date.now() - startTime;

    const ragResult: HybridRAGResult = {
      results,
      graphContext: graphResult,
      queryExpansion,
      confidence,
      processingTimeMs,
      stats: {
        vectorCandidates: vectorScores.size,
        bm25Candidates: bm25Scores.size,
        graphCandidates: graphScores.size,
        afterFusion,
        afterReranking,
        afterMMR,
      },
    };

    if (useCache) {
      queryCache.set(cacheKey, ragResult);
    }

    span.setAttribute('hrag.results', results.length);
    span.setAttribute('hrag.confidence', confidence);
    span.setAttribute('hrag.processing_time_ms', processingTimeMs);

    return ragResult;
  });
}

export const hybridRAGEngine = {
  hybridRetrieve,
  expandQuery,
  embed,
};
