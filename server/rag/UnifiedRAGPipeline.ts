/**
 * UnifiedRAGPipeline — Single orchestration pipeline replacing ragRetriever.ts,
 * ragPipeline.ts, and ragService.ts. Uses the Strategy pattern for pluggable stages.
 *
 * Stages: Preprocess → Chunk → Embed → Index → Retrieve → Rerank → Generate
 * Modes:  fast (skip rerank), thorough (multi-hop), academic (citation-heavy)
 */

import crypto from "crypto";
import { createLogger } from "../utils/logger";

const logger = createLogger("UnifiedRAGPipeline");

// ─── Core chunk types ────────────────────────────────────────────────────────

export type ChunkType = "text" | "code" | "table" | "list" | "heading";
export type SectionType = "title" | "heading" | "paragraph" | "list" | "table" | "code";
export type PipelineMode = "fast" | "thorough" | "academic";
export type CitationFormat = "inline" | "apa" | "mla" | "chicago";

export interface ChunkMetadata {
  sourceFile?: string;
  pageNumber?: number;
  sectionTitle?: string;
  sectionType?: SectionType;
  chunkType: ChunkType;
  startOffset: number;
  endOffset: number;
  hasTable?: boolean;
  hasFigure?: boolean;
  language?: string;
  // Code-specific
  functionName?: string;
  className?: string;
  parameters?: string[];
  returnType?: string;
  dependencies?: string[];
  complexityScore?: number;
  // Document-specific
  documentTitle?: string;
  author?: string;
  createdAt?: string;
}

export interface PipelineChunk {
  id: string;
  content: string;
  chunkIndex: number;
  embedding?: number[];
  metadata: ChunkMetadata;
  score?: number;
  rerankScore?: number;
}

export interface RetrievedChunk extends PipelineChunk {
  score: number;
  matchType: "vector" | "keyword" | "hybrid" | "metadata";
  rrfScore?: number;
}

export interface Citation {
  chunkId: string;
  text: string;
  pageNumber?: number;
  sectionTitle?: string;
  sourceFile?: string;
  relevanceScore: number;
  claimText?: string;
  format?: CitationFormat;
  formatted?: string;
}

export interface PipelineMetrics {
  preprocessMs: number;
  chunkMs: number;
  embedMs: number;
  indexMs: number;
  retrieveMs: number;
  rerankMs: number;
  generateMs: number;
  totalMs: number;
  chunksCreated: number;
  chunksRetrieved: number;
  chunksAfterRerank: number;
  embeddingCacheHits: number;
  stagesCached: string[];
}

export interface PipelineResult {
  chunks: RetrievedChunk[];
  citations: Citation[];
  prompt?: string;
  answer?: string;
  metrics: PipelineMetrics;
  subQueries?: string[];
  hopsUsed?: number;
}

// ─── Stage interfaces (Strategy pattern) ────────────────────────────────────

export interface PreprocessStage {
  preprocess(text: string, mimeType?: string): Promise<string>;
}

export interface ChunkStage {
  chunk(text: string, options?: Record<string, unknown>): Promise<PipelineChunk[]>;
}

export interface EmbedStage {
  embed(chunks: PipelineChunk[]): Promise<PipelineChunk[]>;
  embedQuery(query: string): Promise<number[]>;
}

export interface IndexStage {
  index(chunks: PipelineChunk[], userId: string, sourceId: string): Promise<void>;
}

export interface RetrieveStage {
  retrieve(
    query: string,
    queryEmbedding: number[],
    options: RetrieveOptions
  ): Promise<RetrievedChunk[]>;
}

export interface RerankStage {
  rerank(query: string, chunks: RetrievedChunk[]): Promise<RetrievedChunk[]>;
}

export interface GenerateStage {
  generate(
    query: string,
    chunks: RetrievedChunk[],
    options: GenerateOptions
  ): Promise<{ prompt: string; answer?: string; citations: Citation[] }>;
}

export interface RetrieveOptions {
  topK?: number;
  minScore?: number;
  filterUserId?: string;
  filterSourceIds?: string[];
  filterLanguage?: string;
  filterChunkTypes?: ChunkType[];
}

export interface GenerateOptions {
  language?: "es" | "en";
  citationFormat?: CitationFormat;
  maxContextTokens?: number;
  includePageNumbers?: boolean;
}

// ─── Pipeline configuration ──────────────────────────────────────────────────

export interface PipelineConfig {
  mode: PipelineMode;
  skipRerank: boolean;
  skipGenerate: boolean;
  maxHops: number;
  enableCitations: boolean;
  enableTableExtraction: boolean;
  enableMultiHop: boolean;
  citationFormat: CitationFormat;
  topK: number;
  minScore: number;
  language: "es" | "en";
  stages: {
    preprocess?: PreprocessStage;
    chunk: ChunkStage;
    embed: EmbedStage;
    index?: IndexStage;
    retrieve: RetrieveStage;
    rerank?: RerankStage;
    generate?: GenerateStage;
  };
}

const MODE_DEFAULTS: Record<PipelineMode, Partial<PipelineConfig>> = {
  fast: {
    skipRerank: true,
    enableMultiHop: false,
    maxHops: 1,
    topK: 5,
    enableCitations: false,
  },
  thorough: {
    skipRerank: false,
    enableMultiHop: true,
    maxHops: 3,
    topK: 10,
    enableCitations: true,
  },
  academic: {
    skipRerank: false,
    enableMultiHop: true,
    maxHops: 5,
    topK: 15,
    enableCitations: true,
    citationFormat: "apa",
  },
};

// ─── Stage-level cache ───────────────────────────────────────────────────────

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

class StageCache {
  private readonly store = new Map<string, CacheEntry<unknown>>();
  private readonly ttlMs: number;

  constructor(ttlMs = 5 * 60 * 1000) {
    this.ttlMs = ttlMs;
  }

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key) as CacheEntry<T> | undefined;
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set<T>(key: string, value: T): void {
    // Evict expired entries when cache grows large
    if (this.store.size > 500) {
      const now = Date.now();
      for (const [k, v] of this.store) {
        if (now > v.expiresAt) this.store.delete(k);
      }
    }
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  key(...parts: string[]): string {
    return crypto.createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 16);
  }
}

// ─── Default no-op implementations ──────────────────────────────────────────

class PassthroughPreprocess implements PreprocessStage {
  async preprocess(text: string): Promise<string> {
    // Normalize whitespace, remove null bytes, trim
    return text.replace(/\0/g, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  }
}

class SimpleEmbedStage implements EmbedStage {
  async embed(chunks: PipelineChunk[]): Promise<PipelineChunk[]> {
    const { generateEmbeddingsBatch } = await import("../services/ragPipeline");
    const texts = chunks.map((c) => c.content);
    const embeddings = await generateEmbeddingsBatch(texts);
    return chunks.map((c, i) => ({ ...c, embedding: embeddings[i] }));
  }

  async embedQuery(query: string): Promise<number[]> {
    const { generateEmbeddingGemini } = await import("../services/ragPipeline");
    return generateEmbeddingGemini(query);
  }
}

class IdentityRerankStage implements RerankStage {
  async rerank(_query: string, chunks: RetrievedChunk[]): Promise<RetrievedChunk[]> {
    return chunks;
  }
}

// ─── Main Pipeline ───────────────────────────────────────────────────────────

export class UnifiedRAGPipeline {
  private readonly config: PipelineConfig;
  private readonly cache: StageCache;

  constructor(config: PipelineConfig) {
    const modeDefaults = MODE_DEFAULTS[config.mode] ?? {};
    this.config = { ...modeDefaults, ...config };
    this.cache = new StageCache();

    if (!this.config.stages.preprocess) {
      this.config.stages.preprocess = new PassthroughPreprocess();
    }
    if (!this.config.stages.embed) {
      this.config.stages.embed = new SimpleEmbedStage();
    }
    if (!this.config.stages.rerank) {
      this.config.stages.rerank = new IdentityRerankStage();
    }
  }

  /**
   * INDEX: Ingest a document into the vector store.
   * Runs Preprocess → Chunk → Embed → Index stages.
   */
  async index(
    text: string,
    userId: string,
    sourceId: string,
    mimeType?: string
  ): Promise<{ chunksCreated: number; metrics: Partial<PipelineMetrics> }> {
    const metrics: Partial<PipelineMetrics> = {
      preprocessMs: 0,
      chunkMs: 0,
      embedMs: 0,
      indexMs: 0,
      chunksCreated: 0,
      embeddingCacheHits: 0,
      stagesCached: [],
    };

    // Stage 1: Preprocess
    let processed: string;
    const preprocessStart = Date.now();
    try {
      processed = await this.config.stages.preprocess!.preprocess(text, mimeType);
      metrics.preprocessMs = Date.now() - preprocessStart;
    } catch (err) {
      logger.error("Preprocess stage failed", { error: String(err), sourceId });
      throw err;
    }

    // Stage 2: Chunk
    let chunks: PipelineChunk[];
    const chunkStart = Date.now();
    const chunkCacheKey = this.cache.key(processed.slice(0, 200), String(processed.length));
    const cachedChunks = this.cache.get<PipelineChunk[]>(chunkCacheKey);
    if (cachedChunks) {
      chunks = cachedChunks;
      metrics.stagesCached = [...(metrics.stagesCached ?? []), "chunk"];
    } else {
      try {
        chunks = await this.config.stages.chunk.chunk(processed);
        this.cache.set(chunkCacheKey, chunks);
      } catch (err) {
        logger.error("Chunk stage failed", { error: String(err), sourceId });
        throw err;
      }
    }
    metrics.chunkMs = Date.now() - chunkStart;
    metrics.chunksCreated = chunks.length;

    logger.info("Chunks created", { count: chunks.length, sourceId, userId });

    // Stage 3: Embed
    let embeddedChunks: PipelineChunk[];
    const embedStart = Date.now();
    try {
      embeddedChunks = await this.config.stages.embed!.embed(chunks);
      metrics.embedMs = Date.now() - embedStart;
    } catch (err) {
      logger.error("Embed stage failed", { error: String(err), sourceId });
      throw err;
    }

    // Stage 4: Index
    if (this.config.stages.index) {
      const indexStart = Date.now();
      try {
        await this.config.stages.index.index(embeddedChunks, userId, sourceId);
        metrics.indexMs = Date.now() - indexStart;
      } catch (err) {
        logger.error("Index stage failed", { error: String(err), sourceId });
        throw err;
      }
    }

    logger.info("Document indexed", { chunksCreated: chunks.length, sourceId, userId });
    return { chunksCreated: chunks.length, metrics };
  }

  /**
   * QUERY: Retrieve relevant chunks and optionally generate an answer.
   * Runs Embed(query) → Retrieve → Rerank → Generate stages.
   */
  async query(
    query: string,
    options: Partial<RetrieveOptions & GenerateOptions> = {}
  ): Promise<PipelineResult> {
    const startTime = Date.now();
    const metrics: PipelineMetrics = {
      preprocessMs: 0,
      chunkMs: 0,
      embedMs: 0,
      indexMs: 0,
      retrieveMs: 0,
      rerankMs: 0,
      generateMs: 0,
      totalMs: 0,
      chunksCreated: 0,
      chunksRetrieved: 0,
      chunksAfterRerank: 0,
      embeddingCacheHits: 0,
      stagesCached: [],
    };

    const topK = options.topK ?? this.config.topK;
    const minScore = options.minScore ?? this.config.minScore;
    const language = options.language ?? this.config.language;

    // Embed query
    const embedStart = Date.now();
    let queryEmbedding: number[];
    const embedCacheKey = this.cache.key("q", query);
    const cachedEmb = this.cache.get<number[]>(embedCacheKey);
    if (cachedEmb) {
      queryEmbedding = cachedEmb;
      metrics.stagesCached.push("embed_query");
      metrics.embeddingCacheHits++;
    } else {
      queryEmbedding = await this.config.stages.embed!.embedQuery(query);
      this.cache.set(embedCacheKey, queryEmbedding);
    }
    metrics.embedMs = Date.now() - embedStart;

    // Retrieve
    const retrieveStart = Date.now();
    let retrieved: RetrievedChunk[];
    try {
      retrieved = await this.config.stages.retrieve.retrieve(query, queryEmbedding, {
        topK: topK * 2, // fetch extras for reranking
        minScore,
        filterUserId: options.filterUserId,
        filterSourceIds: options.filterSourceIds,
        filterLanguage: options.filterLanguage,
        filterChunkTypes: options.filterChunkTypes,
      });
    } catch (err) {
      logger.error("Retrieve stage failed", { error: String(err), query: query.slice(0, 50) });
      throw err;
    }
    metrics.retrieveMs = Date.now() - retrieveStart;
    metrics.chunksRetrieved = retrieved.length;

    // Multi-hop retrieval
    let subQueries: string[] = [];
    let hopsUsed = 0;
    if (this.config.enableMultiHop && this.config.maxHops > 1) {
      const multiHopResult = await this.runMultiHop(
        query,
        retrieved,
        queryEmbedding,
        options,
        metrics
      );
      retrieved = multiHopResult.chunks;
      subQueries = multiHopResult.subQueries;
      hopsUsed = multiHopResult.hopsUsed;
    }

    // Rerank
    const rerankStart = Date.now();
    let reranked: RetrievedChunk[];
    if (!this.config.skipRerank && this.config.stages.rerank) {
      try {
        reranked = await this.config.stages.rerank.rerank(query, retrieved);
      } catch (err) {
        logger.warn("Rerank stage failed, using original order", { error: String(err) });
        reranked = retrieved;
      }
    } else {
      reranked = retrieved;
    }
    metrics.rerankMs = Date.now() - rerankStart;

    const finalChunks = reranked.slice(0, topK);
    metrics.chunksAfterRerank = finalChunks.length;

    // Generate
    let prompt = "";
    let answer: string | undefined;
    let citations: Citation[] = [];

    if (!this.config.skipGenerate && this.config.stages.generate) {
      const generateStart = Date.now();
      try {
        const genResult = await this.config.stages.generate.generate(query, finalChunks, {
          language,
          citationFormat: options.citationFormat ?? this.config.citationFormat,
          maxContextTokens: 4000,
          includePageNumbers: true,
        });
        prompt = genResult.prompt;
        answer = genResult.answer;
        citations = genResult.citations;
      } catch (err) {
        logger.error("Generate stage failed", { error: String(err) });
      }
      metrics.generateMs = Date.now() - generateStart;
    } else {
      // Build prompt without answering
      citations = finalChunks.map((c) => ({
        chunkId: c.id,
        text: c.content.slice(0, 200),
        pageNumber: c.metadata.pageNumber,
        sectionTitle: c.metadata.sectionTitle,
        sourceFile: c.metadata.sourceFile,
        relevanceScore: c.score,
      }));
    }

    metrics.totalMs = Date.now() - startTime;

    logger.info("Query pipeline complete", {
      query: query.slice(0, 60),
      hopsUsed,
      chunksRetrieved: metrics.chunksRetrieved,
      chunksAfterRerank: metrics.chunksAfterRerank,
      totalMs: metrics.totalMs,
    });

    return {
      chunks: finalChunks,
      citations,
      prompt,
      answer,
      metrics,
      subQueries,
      hopsUsed,
    };
  }

  private async runMultiHop(
    query: string,
    initial: RetrievedChunk[],
    _queryEmbedding: number[],
    options: Partial<RetrieveOptions>,
    _metrics: PipelineMetrics
  ): Promise<{ chunks: RetrievedChunk[]; subQueries: string[]; hopsUsed: number }> {
    const seen = new Set(initial.map((c) => c.id));
    let accumulated = [...initial];
    const subQueries: string[] = [];
    let hopsUsed = 0;

    for (let hop = 0; hop < this.config.maxHops - 1; hop++) {
      // Generate sub-query based on retrieved info
      const context = accumulated
        .slice(0, 3)
        .map((c) => c.content.slice(0, 300))
        .join("\n");

      const subQuery = await this.generateSubQuery(query, context, hop);
      if (!subQuery || subQuery === query) break;

      subQueries.push(subQuery);
      const subEmbedding = await this.config.stages.embed!.embedQuery(subQuery);

      let hopResults: RetrievedChunk[];
      try {
        hopResults = await this.config.stages.retrieve.retrieve(subQuery, subEmbedding, {
          topK: 5,
          minScore: options.minScore ?? this.config.minScore,
          filterUserId: options.filterUserId,
          filterSourceIds: options.filterSourceIds,
        });
      } catch {
        break;
      }

      const newChunks = hopResults.filter((c) => !seen.has(c.id));
      if (newChunks.length === 0) break; // convergence

      for (const c of newChunks) seen.add(c.id);
      accumulated = [...accumulated, ...newChunks];
      hopsUsed++;
    }

    return { chunks: accumulated, subQueries, hopsUsed };
  }

  private async generateSubQuery(
    originalQuery: string,
    context: string,
    hopIndex: number
  ): Promise<string> {
    try {
      const { llmGateway } = await import("../lib/llmGateway");
      const response = await llmGateway.chat(
        [
          {
            role: "system",
            content:
              "You are a query expansion assistant. Given an original query and retrieved context, generate ONE specific follow-up query to find additional relevant information. Return ONLY the query text, nothing else.",
          },
          {
            role: "user",
            content: `Original query: ${originalQuery}\n\nAlready retrieved context:\n${context}\n\nHop ${hopIndex + 1}: Generate a specific follow-up query to find missing information:`,
          },
        ],
        { model: "gpt-4o-mini", maxTokens: 100, temperature: 0.3 }
      );
      return response.content.trim();
    } catch (err) {
      logger.warn("Sub-query generation failed", { error: String(err) });
      return "";
    }
  }
}

// ─── Pipeline Builder ────────────────────────────────────────────────────────

export class PipelineBuilder {
  private partialConfig: Partial<PipelineConfig> & { stages: Partial<PipelineConfig["stages"]> } = {
    stages: {},
  };

  mode(mode: PipelineMode): this {
    this.partialConfig.mode = mode;
    const defaults = MODE_DEFAULTS[mode] ?? {};
    Object.assign(this.partialConfig, defaults);
    return this;
  }

  withChunker(stage: ChunkStage): this {
    this.partialConfig.stages!.chunk = stage;
    return this;
  }

  withEmbedder(stage: EmbedStage): this {
    this.partialConfig.stages!.embed = stage;
    return this;
  }

  withRetriever(stage: RetrieveStage): this {
    this.partialConfig.stages!.retrieve = stage;
    return this;
  }

  withReranker(stage: RerankStage): this {
    this.partialConfig.stages!.rerank = stage;
    return this;
  }

  withGenerator(stage: GenerateStage): this {
    this.partialConfig.stages!.generate = stage;
    return this;
  }

  withIndexer(stage: IndexStage): this {
    this.partialConfig.stages!.index = stage;
    return this;
  }

  withPreprocessor(stage: PreprocessStage): this {
    this.partialConfig.stages!.preprocess = stage;
    return this;
  }

  language(lang: "es" | "en"): this {
    this.partialConfig.language = lang;
    return this;
  }

  build(): UnifiedRAGPipeline {
    if (!this.partialConfig.stages?.chunk) {
      throw new Error("PipelineBuilder: chunk stage is required");
    }
    if (!this.partialConfig.stages?.retrieve) {
      throw new Error("PipelineBuilder: retrieve stage is required");
    }

    const config: PipelineConfig = {
      mode: this.partialConfig.mode ?? "fast",
      skipRerank: this.partialConfig.skipRerank ?? true,
      skipGenerate: this.partialConfig.skipGenerate ?? false,
      maxHops: this.partialConfig.maxHops ?? 1,
      enableCitations: this.partialConfig.enableCitations ?? false,
      enableTableExtraction: this.partialConfig.enableTableExtraction ?? false,
      enableMultiHop: this.partialConfig.enableMultiHop ?? false,
      citationFormat: this.partialConfig.citationFormat ?? "inline",
      topK: this.partialConfig.topK ?? 5,
      minScore: this.partialConfig.minScore ?? 0.1,
      language: this.partialConfig.language ?? "es",
      stages: this.partialConfig.stages as PipelineConfig["stages"],
    };

    return new UnifiedRAGPipeline(config);
  }
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const mag = Math.sqrt(normA) * Math.sqrt(normB);
  return mag === 0 ? 0 : dot / mag;
}

export function generateChunkId(content: string, index: number): string {
  return crypto
    .createHash("sha256")
    .update(`${index}:${content.slice(0, 100)}`)
    .digest("hex")
    .slice(0, 16);
}
