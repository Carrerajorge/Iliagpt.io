import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import crypto from 'crypto';
import { Logger } from '../lib/logger';
import { llmGateway } from '../lib/llmGateway';
import { getSemanticEmbeddingVector } from '../services/semanticEmbeddings';
import { db } from '../db';
import { ragChunks } from '@shared/schema/rag';
import { eq, and, sql, inArray } from 'drizzle-orm';

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
  userId?: string;
  tenantId?: string;
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

// ─── Types expected by external retriever modules ───────────────────────────

export type ChunkType = 'text' | 'heading' | 'paragraph' | 'list' | 'code' | 'table';

export interface ChunkMetadata {
  chunkType: ChunkType;
  sectionTitle?: string;
  sourceFile?: string;
  pageNumber?: number;
  language?: string;
  startOffset: number;
  endOffset: number;
}

export interface PipelineChunk {
  id: string;
  content: string;
  chunkIndex: number;
  embedding?: number[];
  score: number;
  rrfScore?: number;
  matchType: 'vector' | 'bm25' | 'hybrid' | 'metadata';
  metadata: ChunkMetadata;
}

export interface RetrieveOptions {
  topK?: number;
  minScore?: number;
  filterUserId?: string;
  filterSourceIds?: string[];
  filterLanguage?: string;
  filterChunkTypes?: string[];
}

export function generateChunkId(content: string, documentId: string, chunkIndex: number): string {
  return crypto
    .createHash('sha256')
    .update(`${documentId}:${chunkIndex}:${content.slice(0, 256)}`)
    .digest('hex')
    .slice(0, 32);
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
    relevanceThreshold?: number;
    ragTemplate?: string;
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

// ─── Prompt injection sanitization ──────────────────────────────────────────

const SYSTEM_TAG_PATTERNS = [
  /<\/?system>/gi,
  /<\|[^|]*\|>/g,
  /<\/?instruction>/gi,
  /<\/?prompt>/gi,
  /\[INST\]|\[\/INST\]/gi,
  /<<SYS>>|<<\/SYS>>/gi,
  /\{\{#system\}\}|\{\{\/system\}\}/gi,
];

export function sanitizeRAGContent(content: string): string {
  let sanitized = content;
  for (const pattern of SYSTEM_TAG_PATTERNS) {
    sanitized = sanitized.replace(pattern, (match) => {
      return match.replace(/</g, '＜').replace(/>/g, '＞').replace(/\[/g, '［').replace(/\]/g, '］');
    });
  }

  sanitized = sanitized
    .replace(/You are now|Ignore (all )?previous|Forget (all )?instructions|Disregard (all )?(above|previous)/gi,
      (m) => `[FILTERED: ${m.slice(0, 20)}...]`);

  return sanitized;
}

export function detectPlaceholderInjection(content: string, placeholders: string[]): boolean {
  for (const ph of placeholders) {
    if (content.includes(ph)) return true;
  }
  return false;
}

// ─── Configurable RAG template ──────────────────────────────────────────────

const DEFAULT_RAG_TEMPLATE = `You are a knowledgeable assistant. Answer the user's question using ONLY the provided context.

RULES:
1. Use ONLY information from the context below. Do NOT use prior knowledge.
2. Cite sources using [N] references matching the numbered context blocks.
3. If the context does not contain sufficient information, explicitly state: "The available documents do not contain enough information to answer this question."
4. Never fabricate data, statistics, or facts not present in the context.

--- BEGIN CONTEXT ---
[context]
--- END CONTEXT ---

Question: [query]`;

export function buildRAGPrompt(
  template: string,
  context: string,
  query: string,
): { systemPrompt: string; userPrompt: string } {
  let safeTemplate = template;
  if (!safeTemplate.includes('[context]') || !safeTemplate.includes('[query]')) {
    Logger.warn('[RAG] Invalid template missing required placeholders, using default');
    safeTemplate = DEFAULT_RAG_TEMPLATE;
  }
  if (safeTemplate.length > 5000) {
    Logger.warn('[RAG] Template exceeds max length, using default');
    safeTemplate = DEFAULT_RAG_TEMPLATE;
  }

  const sanitizedContext = sanitizeRAGContent(context);

  const queryPlaceholders: Array<{ uuid: string; original: string }> = [];

  if (sanitizedContext.includes('[query]')) {
    const uuid = `{{QUERY_${crypto.randomUUID().replace(/-/g, '')}}}`;
    safeTemplate = safeTemplate.replace('[query]', uuid);
    queryPlaceholders.push({ uuid, original: '[query]' });
    Logger.warn('[RAG] Context contains [query] placeholder — using UUID isolation');
  }

  if (sanitizedContext.includes('{{QUERY}}')) {
    const uuid = `{{QUERY_${crypto.randomUUID().replace(/-/g, '')}}}`;
    safeTemplate = safeTemplate.replace('{{QUERY}}', uuid);
    queryPlaceholders.push({ uuid, original: '{{QUERY}}' });
  }

  if (sanitizedContext.includes('[context]')) {
    Logger.warn('[RAG] Context contains [context] placeholder — potential injection');
  }

  let rendered = safeTemplate
    .replace('[context]', sanitizedContext)
    .replace('{{CONTEXT}}', sanitizedContext);

  rendered = rendered
    .replace('[query]', query)
    .replace('{{QUERY}}', query);

  for (const { uuid } of queryPlaceholders) {
    rendered = rendered.replace(uuid, query);
  }

  return { systemPrompt: '', userPrompt: rendered };
}

// ─── LLM response validation ───────────────────────────────────────────────

const REFUSAL_PATTERNS = [
  /^I('m| am) (sorry|unable|not able),? (but )?(I )?(can't|cannot|am unable)/i,
  /^(Sorry|Unfortunately),? (I |but )(can't|cannot|am not able|don't have)/i,
  /^No puedo (ayud|respond|proporcion)/i,
  /^Lo siento,? (pero )?(no puedo|no tengo)/i,
  /^I (can't|cannot) (help|assist|answer|respond|provide)/i,
  /^As an AI,? I (can't|cannot|am unable)/i,
];

const GARBAGE_PATTERNS = [
  /(.{10,})\1{3,}/,
  /^[^\w\s]{20,}$/,
  /(\b\w+\b)(\s+\1){5,}/i,
];

export interface ResponseValidation {
  isValid: boolean;
  reason?: string;
}

export function validateLLMResponse(
  response: string,
  contextLength: number,
): ResponseValidation {
  if (!response || response.trim().length === 0) {
    return { isValid: false, reason: 'empty_response' };
  }

  const trimmed = response.trim();

  if (trimmed.length < 5) {
    return { isValid: false, reason: 'too_short' };
  }

  if (/^(undefined|null|NaN|\[object Object\])$/i.test(trimmed)) {
    return { isValid: false, reason: 'garbage_literal' };
  }

  for (const pat of REFUSAL_PATTERNS) {
    if (pat.test(trimmed)) {
      return { isValid: false, reason: 'generic_refusal' };
    }
  }

  for (const pat of GARBAGE_PATTERNS) {
    if (pat.test(trimmed)) {
      return { isValid: false, reason: 'garbage_content' };
    }
  }

  if (contextLength > 500 && trimmed.length < 20) {
    return { isValid: false, reason: 'disproportionately_short' };
  }

  if (trimmed.length > 100) {
    const words = trimmed.split(/\s+/);
    if (words.length >= 20) {
      const windowSize = Math.min(15, Math.floor(words.length / 3));
      const seen = new Set<string>();
      let repeats = 0;
      for (let i = 0; i <= words.length - windowSize; i++) {
        const w = words.slice(i, i + windowSize).join(" ");
        if (seen.has(w)) repeats++;
        seen.add(w);
      }
      if (repeats / Math.max(1, words.length - windowSize) > 0.5) {
        return { isValid: false, reason: 'excessive_repetition' };
      }
    }
  }

  return { isValid: true };
}

// ─── Failed response metrics tracking ───────────────────────────────────────

const _failedResponseMetrics = new Map<string, { count: number; lastReason: string; lastAt: number }>();

function recordFailedResponse(provider: string, reason: string): void {
  const existing = _failedResponseMetrics.get(provider) || { count: 0, lastReason: '', lastAt: 0 };
  _failedResponseMetrics.set(provider, {
    count: existing.count + 1,
    lastReason: reason,
    lastAt: Date.now(),
  });
}

export function getFailedResponseMetrics(): Record<string, { count: number; lastReason: string; lastAt: number }> {
  return Object.fromEntries(_failedResponseMetrics);
}

// ─── Default preprocess stage ────────────────────────────────────────────────

const ES_STOPWORDS = new Set(['es', 'la', 'de', 'que', 'en', 'el', 'los', 'las', 'un', 'una', 'por', 'con', 'se', 'del', 'al']);
const EN_STOPWORDS = new Set(['the', 'is', 'are', 'of', 'to', 'and', 'in', 'it', 'for', 'on', 'with', 'at', 'by', 'this', 'that']);

export class DefaultPreprocessStage implements PreprocessStage {
  async process(doc: RawDocument): Promise<ProcessedDocument> {
    const stripped = doc.content.replace(/<[^>]+>/g, ' ');

    const cleaned = stripped
      .split('\n')
      .map((line) => line.replace(/[ \t]+/g, ' ').trim())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    const wordCount = cleaned.split(/\s+/).filter(Boolean).length;

    const tokens = cleaned.toLowerCase().split(/\W+/).filter(Boolean);
    let esScore = 0;
    let enScore = 0;
    for (const token of tokens) {
      if (ES_STOPWORDS.has(token)) esScore++;
      if (EN_STOPWORDS.has(token)) enScore++;
    }
    const detectedLanguage = doc.language ?? (esScore > enScore ? 'es' : 'en');

    const lines = cleaned.split('\n');
    const headings = lines.filter((l) => /^#{1,6}\s/.test(l)).length;
    const tableLines = lines.filter((l) => /\|/.test(l)).length;
    const tables = Math.floor(tableLines / 2);
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

// ─── Default embed stage (real semantic embeddings with fallback chain) ──────

const EMBED_BATCH_SIZE = 16;

class DefaultEmbedStage implements EmbedStage {
  async embed(chunks: Chunk[]): Promise<EmbeddedChunk[]> {
    const results: EmbeddedChunk[] = [];

    for (let i = 0; i < chunks.length; i += EMBED_BATCH_SIZE) {
      const batch = chunks.slice(i, i + EMBED_BATCH_SIZE);
      const embedded = await Promise.all(
        batch.map(async (chunk) => {
          const vector = await getSemanticEmbeddingVector(chunk.content, {
            dimensions: 1536,
            purpose: 'document',
            cacheNamespace: 'unified-rag',
          });
          return { ...chunk, vector };
        }),
      );
      results.push(...embedded);
    }
    return results;
  }
}

// ─── BM25 enriched text for metadata boosting ───────────────────────────────

function buildEnrichedBM25Text(chunk: EmbeddedChunk, namespace: string): string {
  const parts: string[] = [];

  const source = (chunk.metadata?.source as string) || '';
  if (source) {
    const filename = source.split('/').pop()?.replace(/\.[^.]+$/, '') || '';
    const tokenized = filename.replace(/[-_]/g, ' ');
    parts.push(tokenized, tokenized);
  }

  const title = (chunk.metadata?.title as string) || '';
  if (title) parts.push(title, title);

  const sectionTitle = (chunk.metadata?.sectionTitle as string) || '';
  if (sectionTitle) parts.push(sectionTitle);

  const headings = (chunk.metadata?.headings as string[]) || [];
  if (headings.length > 0) parts.push(...headings);

  parts.push(chunk.content);

  if (namespace) parts.push(namespace);

  return parts.join(' ');
}

// ─── PgVector Index Stage (replaces in-memory) ─────────────────────────────

class PgVectorIndexStage implements IndexStage {
  async index(chunks: EmbeddedChunk[], namespace: string): Promise<void> {
    if (chunks.length === 0) return;

    const BATCH_INSERT_SIZE = 50;
    let indexed = 0;
    let deduped = 0;

    for (let i = 0; i < chunks.length; i += BATCH_INSERT_SIZE) {
      const batch = chunks.slice(i, i + BATCH_INSERT_SIZE);

      for (const chunk of batch) {
        const contentHash = crypto.createHash('sha256').update(chunk.content).digest('hex');
        const enrichedText = buildEnrichedBM25Text(chunk, namespace);
        const userId = (chunk.metadata?.userId as string) || 'system';
        const tenantId = (chunk.metadata?.tenantId as string) || 'default';
        const source = (chunk.metadata?.source as string) || 'document';
        const sourceId = (chunk.metadata?.sourceId as string) || chunk.documentId;

        try {
          await db.execute(sql`
            INSERT INTO rag_chunks (
              id, tenant_id, user_id, source, source_id, content, content_hash,
              embedding, search_vector, chunk_index, title, section_title,
              chunk_type, language, tags, metadata, is_active
            ) VALUES (
              ${chunk.id},
              ${tenantId},
              ${userId},
              ${source},
              ${sourceId},
              ${chunk.content},
              ${contentHash},
              ${sql.raw(`'[${chunk.vector.join(',')}]'::vector`)},
              to_tsvector('simple', ${enrichedText}),
              ${chunk.chunkIndex},
              ${(chunk.metadata?.title as string) || null},
              ${(chunk.metadata?.sectionTitle as string) || null},
              ${(chunk.metadata?.chunkType as string) || 'paragraph'},
              ${(chunk.metadata?.language as string) || null},
              ${sql.raw(`ARRAY[${namespace ? `'${namespace.replace(/'/g, "''")}'` : ''}]::text[]`)},
              ${JSON.stringify(chunk.metadata || {})}::jsonb,
              true
            )
            ON CONFLICT (user_id, content_hash) DO UPDATE SET
              embedding = EXCLUDED.embedding,
              search_vector = EXCLUDED.search_vector,
              tags = (
                SELECT array_agg(DISTINCT t) FROM unnest(rag_chunks.tags || EXCLUDED.tags) AS t
              ),
              source = EXCLUDED.source,
              source_id = EXCLUDED.source_id,
              metadata = rag_chunks.metadata || EXCLUDED.metadata,
              updated_at = NOW()
          `);
          indexed++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes('duplicate') || msg.includes('unique')) {
            deduped++;
          } else {
            Logger.warn('[PgVectorIndex] Failed to index chunk', { chunkId: chunk.id, error: msg });
          }
        }
      }
    }

    Logger.info('[PgVectorIndex] Batch complete', { indexed, deduped, total: chunks.length, namespace });
  }
}

// ─── BM25 scoring helpers ───────────────────────────────────────────────────

const STOP_WORDS = new Set([
  'the', 'is', 'are', 'of', 'and', 'to', 'in', 'for', 'with', 'that', 'this',
  'have', 'it', 'at', 'be', 'from', 'or', 'an', 'by', 'we', 'you',
  'el', 'la', 'los', 'las', 'de', 'que', 'en', 'un', 'una', 'es', 'por',
  'con', 'del', 'al', 'se', 'no', 'a', 'su', 'si',
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\sáéíóúüñ]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

function bm25Score(
  queryTerms: string[],
  docTerms: string[],
  avgDocLen: number,
  docFreq: Map<string, number>,
  totalDocs: number,
  k1 = 1.5,
  b = 0.75,
): number {
  const tf = new Map<string, number>();
  for (const t of docTerms) tf.set(t, (tf.get(t) ?? 0) + 1);
  let score = 0;
  for (const term of queryTerms) {
    const freq = tf.get(term) ?? 0;
    if (freq === 0) continue;
    const df = docFreq.get(term) ?? 0;
    const idf = Math.log((totalDocs - df + 0.5) / (df + 0.5) + 1);
    const num = freq * (k1 + 1);
    const den = freq + k1 * (1 - b + b * (docTerms.length / avgDocLen));
    score += idf * (num / den);
  }
  return score;
}

// ─── PgVector Hybrid Retrieve Stage (BM25 + vector with RRF) ────────────────

const RRF_K = 60;
const DEFAULT_BM25_WEIGHT = 0.3;
const DEFAULT_VECTOR_WEIGHT = 0.7;

class PgVectorHybridRetrieveStage implements RetrieveStage {
  async retrieve(query: RetrievedQuery): Promise<RetrievedChunk[]> {
    const queryVec = await getSemanticEmbeddingVector(query.text, {
      dimensions: 1536,
      purpose: 'query',
      cacheNamespace: 'unified-rag',
    });

    const rawAlpha = query.hybridAlpha ?? DEFAULT_BM25_WEIGHT;
    const bm25Weight = Math.max(0, Math.min(1, rawAlpha));
    const vectorWeight = 1 - bm25Weight;
    const candidateLimit = Math.max(query.topK * 5, 50);

    const nsEscaped = (query.namespace || 'default').replace(/'/g, "''");
    const userFilter = query.userId
      ? sql`AND user_id = ${query.userId}`
      : sql``;
    const tenantFilter = query.tenantId
      ? sql`AND tenant_id = ${query.tenantId}`
      : sql``;

    let vectorResults: Array<{ id: string; content: string; score: number; embedding: number[] | null; chunkIndex: number; source: string; metadata: any }> = [];
    try {
      const vecRows = await db.execute(sql`
        SELECT id, content, chunk_index, source, source_id, metadata,
               embedding,
               1 - (embedding <=> ${sql.raw(`'[${queryVec.join(',')}]'::vector`)}) as similarity
        FROM rag_chunks
        WHERE is_active = true
          AND tags @> ${sql.raw(`ARRAY['${nsEscaped}']::text[]`)}
          ${userFilter}
          ${tenantFilter}
        ORDER BY embedding <=> ${sql.raw(`'[${queryVec.join(',')}]'::vector`)}
        LIMIT ${candidateLimit}
      `);
      vectorResults = (vecRows as any).rows || [];
    } catch (err) {
      Logger.warn('[PgVectorRetrieve] Vector search failed, falling back', { error: (err as Error).message });
    }

    let tsResults: Array<{ id: string; content: string; rank: number; chunkIndex: number; source: string; metadata: any }> = [];
    try {
      const tsRows = await db.execute(sql`
        SELECT id, content, chunk_index, source, source_id, metadata,
               ts_rank_cd(search_vector, plainto_tsquery('simple', ${query.text})) as rank
        FROM rag_chunks
        WHERE is_active = true
          AND tags @> ${sql.raw(`ARRAY['${nsEscaped}']::text[]`)}
          ${userFilter}
          ${tenantFilter}
          AND search_vector @@ plainto_tsquery('simple', ${query.text})
        ORDER BY rank DESC
        LIMIT ${candidateLimit}
      `);
      tsResults = (tsRows as any).rows || [];
    } catch (err) {
      Logger.warn('[PgVectorRetrieve] BM25/tsvector search failed', { error: (err as Error).message });
    }

    const seenHashes = new Set<string>();
    const allCandidates = new Map<string, {
      id: string;
      content: string;
      chunkIndex: number;
      source: string;
      metadata: Record<string, unknown>;
      vectorRank: number;
      bm25Rank: number;
      vectorScore: number;
    }>();

    vectorResults.forEach((row: any, idx: number) => {
      const contentHash = crypto.createHash('sha256').update(row.content).digest('hex');
      if (seenHashes.has(contentHash)) return;
      seenHashes.add(contentHash);

      allCandidates.set(row.id, {
        id: row.id,
        content: row.content,
        chunkIndex: row.chunk_index ?? 0,
        source: row.source || 'unknown',
        metadata: (typeof row.metadata === 'object' ? row.metadata : {}) as Record<string, unknown>,
        vectorRank: idx + 1,
        bm25Rank: candidateLimit + 1,
        vectorScore: parseFloat(row.similarity) || 0,
      });
    });

    tsResults.forEach((row: any, idx: number) => {
      const contentHash = crypto.createHash('sha256').update(row.content).digest('hex');
      if (seenHashes.has(contentHash) && !allCandidates.has(row.id)) return;
      if (!seenHashes.has(contentHash)) seenHashes.add(contentHash);

      const existing = allCandidates.get(row.id);
      if (existing) {
        existing.bm25Rank = idx + 1;
      } else {
        allCandidates.set(row.id, {
          id: row.id,
          content: row.content,
          chunkIndex: row.chunk_index ?? 0,
          source: row.source || 'unknown',
          metadata: (typeof row.metadata === 'object' ? row.metadata : {}) as Record<string, unknown>,
          vectorRank: candidateLimit + 1,
          bm25Rank: idx + 1,
          vectorScore: 0,
        });
      }
    });

    const rrfScored = Array.from(allCandidates.values()).map((c) => {
      const rrfScore =
        vectorWeight * (1 / (RRF_K + c.vectorRank)) +
        bm25Weight * (1 / (RRF_K + c.bm25Rank));

      return {
        id: c.id,
        documentId: (c.metadata?.sourceId as string) || c.source,
        content: c.content,
        chunkIndex: c.chunkIndex,
        metadata: c.metadata,
        tokens: Math.ceil(c.content.split(/\s+/).length * 1.3),
        score: rrfScore,
        source: c.source,
        retrievalMethod: (c.vectorRank < candidateLimit + 1 && c.bm25Rank < candidateLimit + 1)
          ? 'hybrid' as const
          : c.vectorRank < candidateLimit + 1
            ? 'vector' as const
            : 'bm25' as const,
      };
    });

    rrfScored.sort((a, b) => b.score - a.score);

    const minScore = query.minScore ?? 0;
    const results = rrfScored
      .filter((c) => c.score >= minScore)
      .slice(0, query.topK);

    Logger.info('[PgVectorRetrieve] Hybrid search complete', {
      vectorCandidates: vectorResults.length,
      bm25Candidates: tsResults.length,
      afterDedup: allCandidates.size,
      returned: results.length,
    });

    return results;
  }
}

// ─── Score-based rerank with relevance threshold ────────────────────────────

class ScoreBasedRerankStage implements RerankStage {
  private readonly _relevanceThreshold: number;

  constructor(relevanceThreshold = 0.0) {
    this._relevanceThreshold = relevanceThreshold;
  }

  async rerank(query: string, chunks: RetrievedChunk[]): Promise<RankedChunk[]> {
    if (chunks.length === 0) return [];

    const queryTerms = new Set(tokenize(query));

    const scored = chunks.map((chunk) => {
      const chunkTerms = tokenize(chunk.content);

      const overlap = chunkTerms.filter((t) => queryTerms.has(t)).length;
      const overlapScore = queryTerms.size > 0 ? overlap / queryTerms.size : 0;

      let proximityBoost = 0;
      const queryArr = Array.from(queryTerms);
      const contentLower = chunk.content.toLowerCase();
      const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      for (let i = 0; i < queryArr.length - 1; i++) {
        try {
          const pattern = new RegExp(`\\b${escapeRegex(queryArr[i])}\\b.{0,30}\\b${escapeRegex(queryArr[i + 1])}\\b`, 'i');
          if (pattern.test(contentLower)) proximityBoost += 0.05;
        } catch {
          // skip invalid regex patterns from adversarial input
        }
      }

      let typeBoost = 0;
      const chunkType = (chunk.metadata?.chunkType as string) || '';
      if (chunkType === 'heading') typeBoost = 0.04;
      if (chunkType === 'table' && /tabla|table|datos|data/i.test(query)) typeBoost = 0.08;
      if (chunkType === 'code' && /código|code|function|función/i.test(query)) typeBoost = 0.08;

      const compositeScore = chunk.score * 0.6 + overlapScore * 0.25 + proximityBoost + typeBoost;

      return { ...chunk, rerankScore: compositeScore };
    });

    scored.sort((a, b) => (b.rerankScore ?? 0) - (a.rerankScore ?? 0));

    const aboveThreshold = scored.filter((c) => (c.rerankScore ?? 0) >= this._relevanceThreshold);

    if (aboveThreshold.length === 0 && this._relevanceThreshold > 0) {
      Logger.info('[Rerank] All chunks below relevance threshold', {
        threshold: this._relevanceThreshold,
        topScore: scored[0]?.rerankScore ?? 0,
      });
      return [];
    }

    const results = (aboveThreshold.length > 0 ? aboveThreshold : scored);
    return results.map((chunk, idx) => ({ ...chunk, rank: idx + 1 }));
  }
}

// ─── Robust generate stage with multi-provider retry ────────────────────────

const PROVIDER_MODELS = [
  { provider: 'openai', model: 'gpt-4o' },
  { provider: 'openrouter', model: 'moonshotai/kimi-k2.5' },
  { provider: 'gemini', model: 'gemini-2.0-flash' },
  { provider: 'xai', model: 'grok-beta' },
];

class RobustGenerateStage implements GenerateStage {
  private readonly _ragTemplate: string;

  constructor(ragTemplate?: string) {
    this._ragTemplate = ragTemplate || DEFAULT_RAG_TEMPLATE;
  }

  async generate(
    query: string,
    context: RankedChunk[],
    options: GenerateOptions,
  ): Promise<GeneratedAnswer> {
    const start = Date.now();
    const maxTokens = options.maxTokens ?? 1024;
    const temperature = options.temperature ?? 0.2;
    const citationStyle = options.citationStyle ?? 'inline';

    if (context.length === 0) {
      const lang = options.language ?? 'en';
      const noContextMsg = lang === 'es'
        ? 'No se encontraron documentos relevantes para responder esta consulta. Por favor, intenta reformular tu pregunta o proporciona más contexto.'
        : 'No relevant documents were found to answer this query. Please try rephrasing your question or providing more context.';

      return {
        content: noContextMsg,
        citations: [],
        tokensUsed: 0,
        model: 'none',
        durationMs: Date.now() - start,
      };
    }

    const contextBlocks = context
      .map((c, i) => {
        const sanitized = sanitizeRAGContent(c.content);
        return `[${i + 1}] (source: ${c.source})\n${sanitized}`;
      })
      .join('\n\n');

    const contextLength = contextBlocks.length;
    const { userPrompt } = buildRAGPrompt(this._ragTemplate, contextBlocks, query);

    const citations: Citation[] = citationStyle === 'none' ? [] : context.map((chunk) => ({
      chunkId: chunk.id,
      documentId: chunk.documentId,
      source: chunk.source,
      snippet: chunk.content.slice(0, 120),
    }));

    let lastError: Error | undefined;

    for (const { provider, model } of PROVIDER_MODELS) {
      try {
        const response = await llmGateway.chat(
          [
            { role: 'system', content: 'You are a helpful assistant that answers questions based on the provided context. Cite sources using [N] notation when relevant.' },
            { role: 'user', content: userPrompt },
          ],
          {
            maxTokens,
            temperature,
            model,
            provider: provider as any,
            skipCache: true,
            enableFallback: false,
          },
        );

        const validation = validateLLMResponse(response.content, contextLength);

        if (!validation.isValid) {
          Logger.warn('[RobustGenerate] Response validation failed, trying next provider', {
            provider,
            model,
            reason: validation.reason,
          });
          recordFailedResponse(provider, validation.reason!);
          continue;
        }

        return {
          content: response.content,
          citations,
          tokensUsed: response.usage?.totalTokens ?? 0,
          model: response.model || model,
          durationMs: Date.now() - start,
        };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        Logger.warn('[RobustGenerate] Provider failed', { provider, model, error: lastError.message });
        recordFailedResponse(provider, `error:${lastError.message.slice(0, 50)}`);
      }
    }

    Logger.error('[RobustGenerate] All providers failed', { error: lastError?.message });
    throw lastError || new Error('All LLM providers failed to generate a valid response');
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

  static create(overrides?: Partial<PipelineConfig>): UnifiedRAGPipeline {
    const relevanceThreshold = overrides?.options?.relevanceThreshold ?? 0.15;
    const ragTemplate = overrides?.options?.ragTemplate;

    const defaults: PipelineConfig = {
      preprocess: new DefaultPreprocessStage(),
      chunk: new DefaultChunkStage(),
      embed: new DefaultEmbedStage(),
      index: new PgVectorIndexStage(),
      retrieve: new PgVectorHybridRetrieveStage(),
      rerank: new ScoreBasedRerankStage(relevanceThreshold),
      generate: new RobustGenerateStage(ragTemplate),
      options: {
        tracing: false,
        metricsEnabled: true,
        maxRetries: 2,
        timeoutMs: 30_000,
        relevanceThreshold,
        ragTemplate,
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
