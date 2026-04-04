import { Logger } from '../../lib/logger';
import { llmGateway } from '../../lib/llmGateway';
import { HybridRetriever } from './HybridRetriever';

// ---------------------------------------------------------------------------
// Shared types (local definitions — not imported from UnifiedRAGPipeline)
// ---------------------------------------------------------------------------

interface RetrievedChunk {
  id: string;
  documentId: string;
  content: string;
  chunkIndex: number;
  metadata: Record<string, unknown>;
  tokens: number;
  score: number;
  source: string;
  retrievalMethod: 'vector' | 'bm25' | 'hybrid' | 'metadata';
}

interface RetrievedQuery {
  text: string;
  namespace: string;
  topK: number;
  filter?: Record<string, unknown>;
  hybridAlpha?: number;
  minScore?: number;
}

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export interface Hop {
  index: number;
  subQuery: string;
  results: RetrievedChunk[];
  reasoning: string;
  converged: boolean;
}

export interface EvidenceChain {
  hops: Hop[];
  finalResults: RetrievedChunk[];
  totalHops: number;
  converged: boolean;
  confidenceScore: number; // 0-1
}

export interface MultiHopConfig {
  maxHops: number;            // default 5
  minScore: number;           // default 0.35
  convergenceThreshold: number; // default 0.85 — overlap ratio
  subQueryModel: string;      // default 'gpt-4o-mini'
  maxResultsPerHop: number;   // default 10
  enableReasoning: boolean;   // default true
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_MULTI_HOP_CONFIG: MultiHopConfig = {
  maxHops: 5,
  minScore: 0.35,
  convergenceThreshold: 0.85,
  subQueryModel: 'gpt-4o-mini',
  maxResultsPerHop: 10,
  enableReasoning: true,
};

// ---------------------------------------------------------------------------
// MultiHopRetriever
// ---------------------------------------------------------------------------

export class MultiHopRetriever {
  private baseRetriever: HybridRetriever;
  private config: MultiHopConfig;

  constructor(baseRetriever: HybridRetriever, config?: Partial<MultiHopConfig>) {
    this.baseRetriever = baseRetriever;
    this.config = { ...DEFAULT_MULTI_HOP_CONFIG, ...(config ?? {}) };

    Logger.debug('MultiHopRetriever initialized', { config: this.config });
  }

  async retrieve(
    initialQuery: string,
    namespace: string,
    topK: number,
  ): Promise<EvidenceChain> {
    Logger.info('MultiHopRetriever.retrieve started', {
      initialQuery,
      namespace,
      topK,
      maxHops: this.config.maxHops,
    });

    const hops: Hop[] = [];
    let evidencePool: RetrievedChunk[] = [];
    let prevResultIds: string[] = [];
    let chainConverged = false;

    // -----------------------------------------------------------------------
    // Hop 0: direct retrieval with initialQuery
    // -----------------------------------------------------------------------
    const firstQuery: RetrievedQuery = {
      text: initialQuery,
      namespace,
      topK: this.config.maxResultsPerHop,
      minScore: this.config.minScore,
    };

    const firstResults = await this.baseRetriever.retrieve(firstQuery);
    const firstHop: Hop = {
      index: 0,
      subQuery: initialQuery,
      results: firstResults,
      reasoning: 'Initial retrieval using the original query.',
      converged: false,
    };

    hops.push(firstHop);
    evidencePool = this._deduplicateAndRank([...evidencePool, ...firstResults]);
    prevResultIds = firstResults.map(r => r.id);

    Logger.debug('MultiHopRetriever hop 0 complete', {
      resultsCount: firstResults.length,
    });

    // -----------------------------------------------------------------------
    // Subsequent hops
    // -----------------------------------------------------------------------
    for (let hopIdx = 1; hopIdx < this.config.maxHops; hopIdx++) {
      // Generate sub-query from previous results
      let subQuery: string;
      try {
        subQuery = await this._generateSubQuery(
          evidencePool.slice(0, 5),
          initialQuery,
          hopIdx,
        );
      } catch (err) {
        Logger.warn('MultiHopRetriever: sub-query generation failed', {
          hopIdx,
          error: err instanceof Error ? err.message : String(err),
        });
        break;
      }

      Logger.debug('MultiHopRetriever sub-query generated', { hopIdx, subQuery });

      // Retrieve with sub-query
      const subQuery_q: RetrievedQuery = {
        text: subQuery,
        namespace,
        topK: this.config.maxResultsPerHop,
        minScore: this.config.minScore,
      };

      let hopResults: RetrievedChunk[];
      try {
        hopResults = await this.baseRetriever.retrieve(subQuery_q);
      } catch (err) {
        Logger.warn('MultiHopRetriever: retrieval failed on hop', {
          hopIdx,
          error: err instanceof Error ? err.message : String(err),
        });
        break;
      }

      const currResultIds = hopResults.map(r => r.id);
      const overlap = this._computeConvergence(prevResultIds, currResultIds);

      const converged = overlap >= this.config.convergenceThreshold;

      // Build reasoning
      const reasoning = this.config.enableReasoning
        ? this._buildReasoning(
            { index: hopIdx, subQuery, results: hopResults, reasoning: '', converged },
            hops,
          )
        : `Hop ${hopIdx}: retrieved ${hopResults.length} results with overlap ${(overlap * 100).toFixed(1)}%.`;

      const hop: Hop = {
        index: hopIdx,
        subQuery,
        results: hopResults,
        reasoning,
        converged,
      };

      hops.push(hop);
      evidencePool = this._deduplicateAndRank([...evidencePool, ...hopResults]);
      prevResultIds = currResultIds;

      Logger.debug('MultiHopRetriever hop complete', {
        hopIdx,
        resultsCount: hopResults.length,
        overlap,
        converged,
      });

      if (converged) {
        chainConverged = true;
        Logger.info('MultiHopRetriever converged', { hopIdx, overlap });
        break;
      }
    }

    // -----------------------------------------------------------------------
    // Build final evidence chain
    // -----------------------------------------------------------------------
    const finalResults = evidencePool.slice(0, topK);
    const confidenceScore = this._computeConfidence(hops);

    const chain: EvidenceChain = {
      hops,
      finalResults,
      totalHops: hops.length,
      converged: chainConverged,
      confidenceScore,
    };

    Logger.info('MultiHopRetriever.retrieve complete', {
      totalHops: chain.totalHops,
      finalResults: chain.finalResults.length,
      converged: chain.converged,
      confidenceScore: chain.confidenceScore,
    });

    return chain;
  }

  private async _generateSubQuery(
    previousResults: RetrievedChunk[],
    originalQuery: string,
    hopIndex: number,
  ): Promise<string> {
    const passagesSummary = previousResults
      .slice(0, 5)
      .map((r, i) => `[${i + 1}] ${r.content.slice(0, 300)}`)
      .join('\n\n');

    const prompt = [
      `You are an expert at formulating precise search queries for information retrieval.`,
      ``,
      `Original question: "${originalQuery}"`,
      ``,
      `Retrieved passages so far (hop ${hopIndex}):`,
      passagesSummary,
      ``,
      `Based on these passages and the original question, generate a specific follow-up search query`,
      `to find information that is MISSING or not yet covered by the above passages.`,
      `The follow-up query must be:`,
      `- Different from the original question`,
      `- Specific and focused on a gap in the retrieved information`,
      `- A short phrase or sentence (under 20 words)`,
      ``,
      `Respond with ONLY the follow-up query, no explanation.`,
    ].join('\n');

    const response = await llmGateway.complete({
      model: this.config.subQueryModel,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      maxTokens: 80,
    });

    const subQuery = (response.content ?? '').trim().replace(/^["']|["']$/g, '');

    if (!subQuery || subQuery.length < 3) {
      throw new Error('LLM returned empty or too-short sub-query');
    }

    return subQuery;
  }

  private _computeConvergence(prev: string[], curr: string[]): number {
    if (prev.length === 0 && curr.length === 0) return 1;
    if (prev.length === 0 || curr.length === 0) return 0;

    const prevSet = new Set(prev);
    const currSet = new Set(curr);

    let intersectionSize = 0;
    for (const id of currSet) {
      if (prevSet.has(id)) intersectionSize++;
    }

    const unionSize = prevSet.size + currSet.size - intersectionSize;
    return unionSize === 0 ? 0 : intersectionSize / unionSize;
  }

  private _deduplicateAndRank(allChunks: RetrievedChunk[]): RetrievedChunk[] {
    const best = new Map<string, RetrievedChunk>();

    for (const chunk of allChunks) {
      const existing = best.get(chunk.id);
      if (!existing || chunk.score > existing.score) {
        best.set(chunk.id, chunk);
      }
    }

    return Array.from(best.values()).sort((a, b) => b.score - a.score);
  }

  private _computeConfidence(chain: Hop[]): number {
    if (chain.length === 0) return 0;

    // Collect all final results across hops
    const allResults: RetrievedChunk[] = [];
    for (const hop of chain) {
      allResults.push(...hop.results);
    }

    const deduped = this._deduplicateAndRank(allResults);
    const top5 = deduped.slice(0, 5);

    if (top5.length === 0) return 0;

    const avgScore = top5.reduce((sum, r) => sum + r.score, 0) / top5.length;

    // More hops = slightly lower confidence (factor 0.95^hops)
    const hopPenalty = Math.pow(0.95, chain.length);

    return Math.min(1, Math.max(0, avgScore * hopPenalty));
  }

  private _buildReasoning(hop: Hop, previousHops: Hop[]): string {
    if (previousHops.length === 0) {
      return `Initial retrieval using the original query "${hop.subQuery}".`;
    }

    const prevHop = previousHops[previousHops.length - 1];
    const prevResultCount = prevHop.results.length;
    const currResultCount = hop.results.length;

    const prevTopics = this._extractTopics(prevHop.results);
    const prevTopicStr = prevTopics.length > 0
      ? `covering: ${prevTopics.slice(0, 3).join(', ')}`
      : 'with limited coverage';

    if (hop.converged) {
      return (
        `Hop ${hop.index}: The sub-query "${hop.subQuery}" retrieved ${currResultCount} result(s). ` +
        `Previous hop found ${prevResultCount} result(s) ${prevTopicStr}. ` +
        `High overlap with previous results indicates convergence — the retrieval chain has stabilized.`
      );
    }

    return (
      `Hop ${hop.index}: Previous results (${prevResultCount} chunks ${prevTopicStr}) did not fully answer the question. ` +
      `Generated sub-query "${hop.subQuery}" to explore missing information. ` +
      `Retrieved ${currResultCount} new result(s) to expand the evidence pool.`
    );
  }

  private _extractTopics(chunks: RetrievedChunk[]): string[] {
    const wordFreq = new Map<string, number>();
    const stopWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to',
      'for', 'of', 'with', 'is', 'are', 'was', 'were', 'be', 'been',
      'this', 'that', 'it', 'its', 'by', 'from', 'as', 'not',
    ]);

    for (const chunk of chunks.slice(0, 5)) {
      const words = chunk.content
        .toLowerCase()
        .split(/\W+/)
        .filter(w => w.length > 4 && !stopWords.has(w));

      for (const word of words) {
        wordFreq.set(word, (wordFreq.get(word) ?? 0) + 1);
      }
    }

    return Array.from(wordFreq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([word]) => word);
  }
}
