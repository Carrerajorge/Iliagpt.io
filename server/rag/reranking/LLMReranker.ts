import { createHash } from 'crypto';
import { Logger } from '../../lib/logger';
import { llmGateway } from '../../lib/llmGateway';

// ─── Shared chunk types ────────────────────────────────────────────────────────

interface RetrievedChunk {
  id: string;
  documentId: string;
  content: string;
  chunkIndex: number;
  metadata: Record<string, unknown>;
  tokens: number;
  score: number;
  source: string;
  retrievalMethod: string;
}

export interface RankedChunk extends RetrievedChunk {
  rank: number;
  rerankScore?: number;
}

// ─── Public types ─────────────────────────────────────────────────────────────

export interface RerankBatch {
  batchId: string;
  query: string;
  chunks: RetrievedChunk[];
  createdAt: Date;
}

export interface RerankResult {
  chunkId: string;
  score: number;
  reasoning?: string;
}

export interface CacheEntry {
  results: RerankResult[];
  timestamp: number;
  hitCount: number;
}

export interface LLMRerankerConfig {
  model: string;
  batchSize: number;
  cacheTtlMs: number;
  cacheMaxSize: number;
  skipForSimpleQueries: boolean;
  simpleQueryMaxWords: number;
  costPerCall: number;
  maxCostPerRequest: number;
  includeReasoning: boolean;
}

// ─── Internal tracking ────────────────────────────────────────────────────────

interface BatchMetrics {
  totalBatches: number;
  totalChunks: number;
}

// ─── LLMReranker ─────────────────────────────────────────────────────────────

export class LLMReranker {
  private readonly config: LLMRerankerConfig;
  private readonly cache: Map<string, CacheEntry>;
  private totalCost: number;
  private totalCalls: number;
  private cacheHits: number;
  private readonly batchMetrics: BatchMetrics;

  constructor(config?: Partial<LLMRerankerConfig>) {
    this.config = {
      model: 'gpt-4o-mini',
      batchSize: 10,
      cacheTtlMs: 300_000,
      cacheMaxSize: 500,
      skipForSimpleQueries: true,
      simpleQueryMaxWords: 4,
      costPerCall: 0.0001,
      maxCostPerRequest: 0.01,
      includeReasoning: false,
      ...config,
    };
    this.cache = new Map();
    this.totalCost = 0;
    this.totalCalls = 0;
    this.cacheHits = 0;
    this.batchMetrics = { totalBatches: 0, totalChunks: 0 };
  }

  async rerank(query: string, chunks: RetrievedChunk[]): Promise<RankedChunk[]> {
    if (chunks.length === 0) {
      Logger.debug('[LLMReranker] No chunks to rerank', { query });
      return [];
    }

    // Skip reranking for simple queries — preserve original order
    if (this.config.skipForSimpleQueries && this._isSimpleQuery(query)) {
      Logger.debug('[LLMReranker] Skipping rerank for simple query', { query });
      return chunks.map((chunk, idx) => ({
        ...chunk,
        rank: idx + 1,
        rerankScore: chunk.score,
      }));
    }

    const cacheKey = this._cacheKey(query, chunks.map((c) => c.id));
    const cached = this._getFromCache(cacheKey);
    if (cached) {
      this.cacheHits++;
      Logger.debug('[LLMReranker] Cache hit', { cacheKey: cacheKey.slice(0, 16), query });
      return this._applyResults(chunks, cached);
    }

    // Split into batches
    const batches: RetrievedChunk[][] = [];
    for (let i = 0; i < chunks.length; i += this.config.batchSize) {
      batches.push(chunks.slice(i, i + this.config.batchSize));
    }

    Logger.info('[LLMReranker] Starting rerank', {
      query,
      chunkCount: chunks.length,
      batchCount: batches.length,
    });

    const allResults: RerankResult[] = [];
    let requestCost = 0;

    for (const batch of batches) {
      const estimatedCost = requestCost + this.config.costPerCall;
      if (estimatedCost > this.config.maxCostPerRequest) {
        Logger.warn('[LLMReranker] Cost limit reached, skipping remaining batches', {
          requestCost,
          maxCost: this.config.maxCostPerRequest,
          remainingChunks: chunks.length - allResults.length,
        });
        // Fill remaining with fallback scores
        const rankedIds = new Set(allResults.map((r) => r.chunkId));
        for (const chunk of chunks) {
          if (!rankedIds.has(chunk.id)) {
            allResults.push({ chunkId: chunk.id, score: chunk.score });
          }
        }
        break;
      }

      const batchResults = await this._rerankBatch(query, batch);
      allResults.push(...batchResults);
      requestCost += this.config.costPerCall;
      this.totalCost += this.config.costPerCall;
      this.totalCalls++;
      this.batchMetrics.totalBatches++;
      this.batchMetrics.totalChunks += batch.length;
    }

    // Store in cache
    this._evictCache();
    this.cache.set(cacheKey, {
      results: allResults,
      timestamp: Date.now(),
      hitCount: 0,
    });

    Logger.info('[LLMReranker] Rerank complete', {
      query,
      totalResults: allResults.length,
      requestCost,
    });

    return this._applyResults(chunks, allResults);
  }

  private _isSimpleQuery(query: string): boolean {
    const words = query.trim().split(/\s+/).filter((w) => w.length > 0);
    if (words.length > this.config.simpleQueryMaxWords) {
      return false;
    }
    const questionWords = new Set(['what', 'how', 'why', 'when', 'where', 'which', 'who']);
    const firstWord = words[0]?.toLowerCase() ?? '';
    if (questionWords.has(firstWord)) {
      return false;
    }
    return true;
  }

  private _cacheKey(query: string, chunkIds: string[]): string {
    const sorted = [...chunkIds].sort().join(',');
    return createHash('sha256')
      .update(`${query}:${sorted}`)
      .digest('hex');
  }

  private _getFromCache(key: string): RerankResult[] | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > this.config.cacheTtlMs) {
      this.cache.delete(key);
      return null;
    }
    entry.hitCount++;
    return entry.results;
  }

  private async _rerankBatch(
    query: string,
    batch: RetrievedChunk[],
  ): Promise<RerankResult[]> {
    const passageList = batch
      .map(
        (chunk, idx) =>
          `[${idx + 1}] ID:${chunk.id}\n${chunk.content.slice(0, 500)}`,
      )
      .join('\n\n');

    const reasoningInstruction = this.config.includeReasoning
      ? ' Include a brief "reasoning" field explaining your score.'
      : ' Omit the "reasoning" field.';

    const prompt = [
      'You are a relevance scoring system. Rate the relevance of each passage to the query on a scale 0.0–1.0.',
      `Return a JSON array with objects: { "chunkId": string, "score": number${this.config.includeReasoning ? ', "reasoning": string' : ''} }.${reasoningInstruction}`,
      'Respond with ONLY the JSON array, no other text.',
      '',
      `Query: ${query}`,
      '',
      'Passages:',
      passageList,
    ].join('\n');

    try {
      const response = await llmGateway.complete({
        model: this.config.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
        maxTokens: 1024,
      });

      const raw = (response.content ?? '').trim();

      // Extract JSON array from response (handle markdown code fences)
      const jsonMatch = raw.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        Logger.warn('[LLMReranker] No JSON array found in response, using fallback scores', {
          raw: raw.slice(0, 200),
        });
        return this._fallbackResults(batch);
      }

      const parsed: unknown = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(parsed)) {
        Logger.warn('[LLMReranker] Parsed response is not an array, using fallback scores');
        return this._fallbackResults(batch);
      }

      const results: RerankResult[] = [];
      const seenIds = new Set<string>();

      for (const item of parsed) {
        if (
          typeof item !== 'object' ||
          item === null ||
          typeof (item as Record<string, unknown>)['chunkId'] !== 'string' ||
          typeof (item as Record<string, unknown>)['score'] !== 'number'
        ) {
          continue;
        }
        const obj = item as Record<string, unknown>;
        const chunkId = obj['chunkId'] as string;
        const score = Math.min(1, Math.max(0, obj['score'] as number));
        const reasoning =
          this.config.includeReasoning && typeof obj['reasoning'] === 'string'
            ? (obj['reasoning'] as string)
            : undefined;

        if (!seenIds.has(chunkId)) {
          seenIds.add(chunkId);
          results.push({ chunkId, score, reasoning });
        }
      }

      // Fill in any chunks that weren't included in the LLM response
      const includedIds = new Set(results.map((r) => r.chunkId));
      for (const chunk of batch) {
        if (!includedIds.has(chunk.id)) {
          Logger.debug('[LLMReranker] Chunk missing from LLM response, using fallback', {
            chunkId: chunk.id,
          });
          results.push({ chunkId: chunk.id, score: 0.5 });
        }
      }

      return results;
    } catch (err) {
      Logger.error('[LLMReranker] Batch rerank failed, using fallback scores', {
        error: err instanceof Error ? err.message : String(err),
        query,
        batchSize: batch.length,
      });
      return this._fallbackResults(batch);
    }
  }

  private _fallbackResults(batch: RetrievedChunk[]): RerankResult[] {
    return batch.map((chunk) => ({ chunkId: chunk.id, score: 0.5 }));
  }

  private _applyResults(
    chunks: RetrievedChunk[],
    results: RerankResult[],
  ): RankedChunk[] {
    const scoreMap = new Map<string, RerankResult>();
    for (const r of results) {
      scoreMap.set(r.chunkId, r);
    }

    const ranked = chunks
      .map((chunk) => {
        const result = scoreMap.get(chunk.id);
        const rerankScore = result?.score ?? chunk.score;
        return {
          ...chunk,
          score: rerankScore,
          rerankScore,
          rank: 0, // placeholder, assigned below
        };
      })
      .sort((a, b) => b.rerankScore! - a.rerankScore!);

    return ranked.map((chunk, idx) => ({ ...chunk, rank: idx + 1 }));
  }

  private _evictCache(): void {
    if (this.cache.size <= this.config.cacheMaxSize) return;

    // Remove expired entries first
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.config.cacheTtlMs) {
        this.cache.delete(key);
      }
    }

    // If still over limit, remove oldest by timestamp
    if (this.cache.size > this.config.cacheMaxSize) {
      const entries = [...this.cache.entries()].sort(
        ([, a], [, b]) => a.timestamp - b.timestamp,
      );
      const toRemove = entries.slice(0, this.cache.size - this.config.cacheMaxSize);
      for (const [key] of toRemove) {
        this.cache.delete(key);
      }
      Logger.debug('[LLMReranker] Evicted cache entries', { evicted: toRemove.length });
    }
  }

  getCacheStats(): {
    size: number;
    hitRate: number;
    totalCalls: number;
    estimatedCost: number;
  } {
    const totalRequests = this.totalCalls + this.cacheHits;
    return {
      size: this.cache.size,
      hitRate: totalRequests > 0 ? this.cacheHits / totalRequests : 0,
      totalCalls: this.totalCalls,
      estimatedCost: this.totalCost,
    };
  }

  clearCache(): void {
    this.cache.clear();
    Logger.info('[LLMReranker] Cache cleared');
  }

  getMetrics(): {
    totalCalls: number;
    cacheHits: number;
    cacheHitRate: number;
    totalCost: number;
    avgBatchSize: number;
  } {
    const totalRequests = this.totalCalls + this.cacheHits;
    const avgBatchSize =
      this.batchMetrics.totalBatches > 0
        ? this.batchMetrics.totalChunks / this.batchMetrics.totalBatches
        : 0;
    return {
      totalCalls: this.totalCalls,
      cacheHits: this.cacheHits,
      cacheHitRate: totalRequests > 0 ? this.cacheHits / totalRequests : 0,
      totalCost: this.totalCost,
      avgBatchSize,
    };
  }
}
