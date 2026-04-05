import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import { Logger } from '../lib/logger';
import { llmGateway } from '../lib/llmGateway';
import { getSemanticEmbeddingVector } from '../services/semanticEmbeddings';

// ─── Core document types ────────────────────────────────────────────────────

export interface RawDocument {
  id: string;
  content: string;
  mimeType: string;
  metadata: Record<string, unknown>;
  source: string;
  language?: string;
}

export interface ProcessedDocument extends RawDocument {
  cleanedContent: string;
  detectedLanguage: string;
  wordCount: number;
  structure: {
    headings: number;
    tables: number;
    codeBlocks: number;
  };
}

export interface Chunk {
  id: string;
  documentId: string;
  content: string;
  chunkIndex: number;
  metadata: Record<string, unknown>;
  tokens: number;
}

export interface EmbeddedChunk extends Chunk {
  vector: number[];
}

export interface RetrievedQuery {
  text: string;
  namespace: string;
  topK: number;
  filter?: Record<string, unknown>;
  hybridAlpha?: number;
  minScore?: number;
}

export interface RetrievedChunk extends Chunk {
  score: number;
  source: string;
  retrievalMethod: 'vector' | 'bm25' | 'hybrid' | 'metadata';
}

export interface RankedChunk extends RetrievedChunk {
  rank: number;
  rerankScore?: number;
}

export interface GenerateOptions {
  maxTokens?: number;
  temperature?: number;
  language?: string;
  citationStyle?: 'inline' | 'bibliography' | 'none';
  streaming?: boolean;
}

export interface Citation {
  chunkId: string;
  documentId: string;
  source: string;
  page?: number;
  section?: string;
  snippet: string;
}

export interface GeneratedAnswer {
  content: string;
  citations: Citation[];
  tokensUsed: number;
  model: string;
  durationMs: number;
}

// ─── Stage interfaces ────────────────────────────────────────────────────────

export interface PreprocessStage {
  process(doc: RawDocument): Promise<ProcessedDocument>;
}

export interface ChunkStage {
  chunk(doc: ProcessedDocument): Promise<Chunk[]>;
}

export interface EmbedStage {
  embed(chunks: Chunk[]): Promise<EmbeddedChunk[]>;
}

export interface IndexStage {
  index(chunks: EmbeddedChunk[], namespace: string): Promise<void>;
}

export interface RetrieveStage {
  retrieve(query: RetrievedQuery): Promise<RetrievedChunk[]>;
}

export interface RerankStage {
  rerank(query: string, chunks: RetrievedChunk[]): Promise<RankedChunk[]>;
}

export interface GenerateStage {
  generate(
    query: string,
    context: RankedChunk[],
    options: GenerateOptions,
  ): Promise<GeneratedAnswer>;
}

// ─── Pipeline config & tracing ───────────────────────────────────────────────

export interface PipelineConfig {
  preprocess: PreprocessStage;
  chunk: ChunkStage;
  embed: EmbedStage;
  index: IndexStage;
  retrieve: RetrieveStage;
  rerank: RerankStage;
  generate: GenerateStage;
  options?: {
    tracing?: boolean;
    metricsEnabled?: boolean;
    maxRetries?: number;
    timeoutMs?: number;
  };
}

export interface PipelineTrace {
  pipelineId: string;
  query: string;
  stages: Array<{
    name: string;
    startMs: number;
    endMs: number;
    itemsIn: number;
    itemsOut: number;
    error?: string;
  }>;
  totalMs: number;
}

// ─── Default preprocess stage ────────────────────────────────────────────────

const ES_STOPWORDS = ['es', 'la', 'de', 'que', 'en', 'el', 'los', 'las', 'un', 'una', 'por', 'con', 'se', 'del', 'al'];
const EN_STOPWORDS = ['the', 'is', 'are', 'of', 'to', 'and', 'in', 'it', 'for', 'on', 'with', 'at', 'by', 'this', 'that'];

export class DefaultPreprocessStage implements PreprocessStage {
  async process(doc: RawDocument): Promise<ProcessedDocument> {
    // Strip HTML tags
    const stripped = doc.content.replace(/<[^>]+>/g, ' ');

    // Normalize whitespace: collapse runs of spaces/tabs, trim lines
    const cleaned = stripped
      .split('\n')
      .map((line) => line.replace(/[ \t]+/g, ' ').trim())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    const wordCount = cleaned.split(/\s+/).filter(Boolean).length;

    // Language detection via stopword frequency
    const tokens = cleaned.toLowerCase().split(/\W+/).filter(Boolean);
    let esScore = 0;
    let enScore = 0;
    for (const token of tokens) {
      if (ES_STOPWORDS.includes(token)) esScore++;
      if (EN_STOPWORDS.includes(token)) enScore++;
    }
    const detectedLanguage = doc.language ?? (esScore > enScore ? 'es' : 'en');

    // Structure analysis
    const lines = cleaned.split('\n');
    const headings = lines.filter((l) => /^#{1,6}\s/.test(l)).length;
    const tableLines = lines.filter((l) => /\|/.test(l)).length;
    const tables = Math.floor(tableLines / 2); // rough table count
    const codeBlockMatches = cleaned.match(/```/g);
    const codeBlocks = codeBlockMatches ? Math.floor(codeBlockMatches.length / 2) : 0;

    return {
      ...doc,
      cleanedContent: cleaned,
      detectedLanguage,
      wordCount,
      structure: { headings, tables, codeBlocks },
    };
  }
}

// ─── Default embed stage (real semantic embeddings with controlled fallback) ──

class DefaultEmbedStage implements EmbedStage {
  async embed(chunks: Chunk[]): Promise<EmbeddedChunk[]> {
    return Promise.all(
      chunks.map(async (chunk) => {
        const vector = await getSemanticEmbeddingVector(chunk.content, {
          dimensions: 1536,
          purpose: "document",
          cacheNamespace: "unified-rag",
        });
        return { ...chunk, vector };
      }),
    );
  }
}

// ─── Default in-memory index/retrieve stages ────────────────────────────────

interface StoredChunk {
  chunk: EmbeddedChunk;
  namespace: string;
}

const _inMemoryStore: StoredChunk[] = [];

class DefaultIndexStage implements IndexStage {
  async index(chunks: EmbeddedChunk[], namespace: string): Promise<void> {
    for (const chunk of chunks) {
      _inMemoryStore.push({ chunk, namespace });
    }
    Logger.debug('DefaultIndexStage: indexed chunks', { count: chunks.length, namespace });
  }
}

class DefaultRetrieveStage implements RetrieveStage {
  async retrieve(query: RetrievedQuery): Promise<RetrievedChunk[]> {
    const queryVec = await getSemanticEmbeddingVector(query.text, {
      dimensions: 1536,
      purpose: "query",
      cacheNamespace: "unified-rag",
    });
    const candidates = _inMemoryStore
      .filter((s) => s.namespace === query.namespace)
      .map((s) => {
        const score = this._cosine(queryVec, s.chunk.vector);
        return { ...s.chunk, score, source: s.chunk.metadata?.source as string ?? 'unknown', retrievalMethod: 'vector' as const };
      })
      .filter((c) => (query.minScore !== undefined ? c.score >= query.minScore : true))
      .sort((a, b) => b.score - a.score)
      .slice(0, query.topK);
    return candidates;
  }

  private _cosine(a: number[], b: number[]): number {
    let dot = 0;
    const maxLength = Math.min(a.length, b.length);
    for (let i = 0; i < maxLength; i++) dot += a[i] * b[i];
    return dot; // already L2-normalized
  }
}

// ─── Default rerank stage ────────────────────────────────────────────────────

class DefaultRerankStage implements RerankStage {
  async rerank(query: string, chunks: RetrievedChunk[]): Promise<RankedChunk[]> {
    // Simple keyword overlap reranking
    const queryTokens = new Set(query.toLowerCase().split(/\W+/).filter(Boolean));
    return chunks
      .map((chunk) => {
        const chunkTokens = chunk.content.toLowerCase().split(/\W+/).filter(Boolean);
        const overlap = chunkTokens.filter((t) => queryTokens.has(t)).length;
        const rerankScore = overlap / (queryTokens.size || 1);
        return { ...chunk, rerankScore };
      })
      .sort((a, b) => (b.rerankScore ?? 0) - (a.rerankScore ?? 0))
      .map((chunk, idx) => ({ ...chunk, rank: idx + 1 }));
  }
}

// ─── Default generate stage ──────────────────────────────────────────────────

class DefaultGenerateStage implements GenerateStage {
  async generate(
    query: string,
    context: RankedChunk[],
    options: GenerateOptions,
  ): Promise<GeneratedAnswer> {
    const start = Date.now();
    const citationStyle = options.citationStyle ?? 'inline';
    const maxTokens = options.maxTokens ?? 1024;
    const temperature = options.temperature ?? 0.2;

    const contextBlocks = context
      .map((c, i) => `[${i + 1}] (source: ${c.source})\n${c.content}`)
      .join('\n\n');

    const systemPrompt =
      citationStyle === 'none'
        ? 'You are a helpful assistant. Answer the question based on the provided context.'
        : 'You are a helpful assistant. Answer the question based on the provided context. ' +
          'When citing, use [N] inline references matching the numbered sources.';

    const userPrompt = `Context:\n${contextBlocks}\n\nQuestion: ${query}`;

    const response = await llmGateway.chat(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      { maxTokens, temperature },
    );

    const citations: Citation[] = context.map((chunk, i) => ({
      chunkId: chunk.id,
      documentId: chunk.documentId,
      source: chunk.source,
      snippet: chunk.content.slice(0, 120),
    }));

    return {
      content: response.content,
      citations: citationStyle === 'none' ? [] : citations,
      tokensUsed: response.usage?.totalTokens ?? 0,
      model: response.model,
      durationMs: Date.now() - start,
    };
  }
}

// ─── Default chunk stage (naive fixed-size fallback) ────────────────────────

class DefaultChunkStage implements ChunkStage {
  private readonly _chunkSize = 500;

  async chunk(doc: ProcessedDocument): Promise<Chunk[]> {
    const words = doc.cleanedContent.split(/\s+/);
    const chunks: Chunk[] = [];
    for (let i = 0; i < words.length; i += this._chunkSize) {
      const content = words.slice(i, i + this._chunkSize).join(' ');
      chunks.push({
        id: randomUUID(),
        documentId: doc.id,
        content,
        chunkIndex: chunks.length,
        metadata: { ...doc.metadata, source: doc.source },
        tokens: Math.ceil(content.split(/\s+/).length * 1.3),
      });
    }
    return chunks.length ? chunks : [{
      id: randomUUID(),
      documentId: doc.id,
      content: doc.cleanedContent,
      chunkIndex: 0,
      metadata: { ...doc.metadata, source: doc.source },
      tokens: Math.ceil(doc.wordCount * 1.3),
    }];
  }
}

// ─── UnifiedRAGPipeline ───────────────────────────────────────────────────────

export class UnifiedRAGPipeline extends EventEmitter {
  private readonly _config: PipelineConfig;
  private readonly _maxRetries: number;
  private readonly _timeoutMs: number;
  private readonly _tracing: boolean;

  constructor(config: PipelineConfig) {
    super();
    this._config = config;
    this._maxRetries = config.options?.maxRetries ?? 2;
    this._timeoutMs = config.options?.timeoutMs ?? 30_000;
    this._tracing = config.options?.tracing ?? false;
  }

  // ── Ingest ──────────────────────────────────────────────────────────────────

  async ingest(
    doc: RawDocument,
    namespace: string,
  ): Promise<{ chunks: number; tokens: number; durationMs: number }> {
    const start = Date.now();
    this.emit('ingest:start', { docId: doc.id, namespace });
    Logger.info('UnifiedRAGPipeline.ingest start', { docId: doc.id, namespace });

    const trace = this._buildTrace(doc.id);

    try {
      const processed = await this._runStage<ProcessedDocument>('preprocess', trace, () =>
        this._config.preprocess.process(doc),
      );

      const chunks = await this._runStage<Chunk[]>('chunk', trace, () =>
        this._config.chunk.chunk(processed),
      );

      const embedded = await this._runStage<EmbeddedChunk[]>('embed', trace, () =>
        this._config.embed.embed(chunks),
      );

      await this._runStage<void>('index', trace, () =>
        this._config.index.index(embedded, namespace),
      );

      const totalTokens = chunks.reduce((s, c) => s + c.tokens, 0);
      const durationMs = Date.now() - start;
      trace.totalMs = durationMs;

      const result = { chunks: chunks.length, tokens: totalTokens, durationMs };
      this.emit('ingest:complete', { docId: doc.id, namespace, ...result, trace: this._tracing ? trace : undefined });
      Logger.info('UnifiedRAGPipeline.ingest complete', { docId: doc.id, ...result });
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      trace.totalMs = Date.now() - start;
      this.emit('ingest:error', { docId: doc.id, namespace, error, trace: this._tracing ? trace : undefined });
      Logger.error('UnifiedRAGPipeline.ingest error', error);
      throw error;
    }
  }

  // ── Batch ingest ────────────────────────────────────────────────────────────

  async ingestBatch(
    docs: RawDocument[],
    namespace: string,
    concurrency = 3,
  ): Promise<{ indexed: number; failed: number; durationMs: number }> {
    const start = Date.now();
    let indexed = 0;
    let failed = 0;

    const queue = [...docs];
    const workers = Array.from({ length: Math.min(concurrency, docs.length) }, async () => {
      while (queue.length > 0) {
        const doc = queue.shift();
        if (!doc) break;
        try {
          await this.ingest(doc, namespace);
          indexed++;
        } catch {
          failed++;
          Logger.warn('UnifiedRAGPipeline.ingestBatch: doc failed', { docId: doc.id });
        }
      }
    });

    await Promise.all(workers);

    return { indexed, failed, durationMs: Date.now() - start };
  }

  // ── Query ───────────────────────────────────────────────────────────────────

  async query(
    queryText: string,
    namespace: string,
    options?: Partial<RetrievedQuery & GenerateOptions>,
  ): Promise<{ answer: GeneratedAnswer; trace?: PipelineTrace }> {
    const start = Date.now();
    this.emit('query:start', { query: queryText, namespace });
    Logger.info('UnifiedRAGPipeline.query start', { query: queryText, namespace });

    const trace = this._buildTrace(queryText);

    try {
      const retrieveQuery: RetrievedQuery = {
        text: queryText,
        namespace,
        topK: options?.topK ?? 10,
        filter: options?.filter,
        hybridAlpha: options?.hybridAlpha,
        minScore: options?.minScore,
      };

      const retrieved = await this._runStage<RetrievedChunk[]>('retrieve', trace, () =>
        this._config.retrieve.retrieve(retrieveQuery),
      );

      const ranked = await this._runStage<RankedChunk[]>('rerank', trace, () =>
        this._config.rerank.rerank(queryText, retrieved),
      );

      const generateOptions: GenerateOptions = {
        maxTokens: options?.maxTokens,
        temperature: options?.temperature,
        language: options?.language,
        citationStyle: options?.citationStyle,
        streaming: options?.streaming,
      };

      const answer = await this._runStage<GeneratedAnswer>('generate', trace, () =>
        this._config.generate.generate(queryText, ranked, generateOptions),
      );

      trace.totalMs = Date.now() - start;

      this.emit('query:complete', {
        query: queryText,
        namespace,
        durationMs: trace.totalMs,
        trace: this._tracing ? trace : undefined,
      });
      Logger.info('UnifiedRAGPipeline.query complete', { query: queryText, durationMs: trace.totalMs });

      return {
        answer,
        trace: this._tracing ? trace : undefined,
      };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      trace.totalMs = Date.now() - start;
      this.emit('query:error', { query: queryText, namespace, error, trace: this._tracing ? trace : undefined });
      Logger.error('UnifiedRAGPipeline.query error', error);
      throw error;
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private _buildTrace(query: string): PipelineTrace {
    return {
      pipelineId: randomUUID(),
      query,
      stages: [],
      totalMs: 0,
    };
  }

  private async _runStage<T>(
    name: string,
    trace: PipelineTrace,
    fn: () => Promise<T>,
  ): Promise<T> {
    const startMs = Date.now();
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this._maxRetries; attempt++) {
      try {
        const result = await Promise.race([
          fn(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`Stage "${name}" timed out after ${this._timeoutMs}ms`)), this._timeoutMs),
          ),
        ]);

        const endMs = Date.now();
        const itemsOut = Array.isArray(result) ? (result as unknown[]).length : 1;
        trace.stages.push({ name, startMs, endMs, itemsIn: 0, itemsOut });

        if (this._config.options?.metricsEnabled) {
          Logger.debug(`Stage "${name}" completed`, { durationMs: endMs - startMs, itemsOut });
        }
        return result;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        Logger.warn(`Stage "${name}" attempt ${attempt + 1} failed`, { error: lastError.message });
        if (attempt < this._maxRetries) {
          await new Promise((r) => setTimeout(r, 100 * Math.pow(2, attempt)));
        }
      }
    }

    const endMs = Date.now();
    trace.stages.push({ name, startMs, endMs, itemsIn: 0, itemsOut: 0, error: lastError?.message });
    throw lastError;
  }

  // ── Static factory ──────────────────────────────────────────────────────────

  static create(overrides?: Partial<PipelineConfig>): UnifiedRAGPipeline {
    const defaults: PipelineConfig = {
      preprocess: new DefaultPreprocessStage(),
      chunk: new DefaultChunkStage(),
      embed: new DefaultEmbedStage(),
      index: new DefaultIndexStage(),
      retrieve: new DefaultRetrieveStage(),
      rerank: new DefaultRerankStage(),
      generate: new DefaultGenerateStage(),
      options: {
        tracing: false,
        metricsEnabled: true,
        maxRetries: 2,
        timeoutMs: 30_000,
      },
    };

    return new UnifiedRAGPipeline({
      ...defaults,
      ...overrides,
      options: {
        ...defaults.options,
        ...overrides?.options,
      },
    });
  }
}
