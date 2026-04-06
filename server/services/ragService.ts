/**
 * RAG++ (Retrieval Augmented Generation) Service
 * Enhanced with query rewriting, LLM-based reranking, evidence packs with citations,
 * freshness/TTL scoring, and multi-hop retrieval
 */

import crypto from "crypto";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { llmGateway } from "../lib/llmGateway";
import { getSemanticEmbeddingVector } from "./semanticEmbeddings";

const EMBEDDING_DIM = 256;
const CHUNK_SIZE = 800;
const CHUNK_OVERLAP = 200;
const FRESHNESS_HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000;
const MULTI_HOP_MIN_SCORE = 0.35;
const MULTI_HOP_MAX_ROUNDS = 3;
const RERANK_MODEL = process.env.RAG_RERANK_MODEL || "gpt-4o-mini";

export interface EvidenceCitation {
  sourceDoc: string | null;
  sourceUrl: string | null;
  chunkIndex: number;
  relevanceScore: number;
  contentSnippet: string;
  timestamp: number | null;
  parentDocId: string | null;
  contentType: string;
}

export interface EvidencePack {
  query: string;
  subQueries: string[];
  citations: EvidenceCitation[];
  totalResults: number;
  hopsUsed: number;
  rerankApplied: boolean;
}

export interface EnhancedSearchResult {
  content: string;
  score: number;
  chatId: string;
  metadata?: any;
  contentType?: string;
  citation: EvidenceCitation;
  freshnessFactor: number;
}

function localEmbed(text: string): number[] {
  const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 1);
  const vector = new Array(EMBEDDING_DIM).fill(0);

  const stopWords = new Set(["el","la","los","las","de","que","y","en","un","una","es","por","para","con","del","al","se","no","a","the","is","are","to","of","and","in","for","with"]);
  const meaningful = words.filter(w => !stopWords.has(w));

  for (const word of meaningful) {
    const h1 = word.split('').reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0);
    const h2 = word.split('').reduce((a, c) => ((a << 7) + a + c.charCodeAt(0)) | 0, 5381);
    vector[Math.abs(h1) % EMBEDDING_DIM] += 1;
    vector[Math.abs(h2) % EMBEDDING_DIM] += 0.5;

    for (let i = 0; i < word.length - 2; i++) {
      const trigram = word.slice(i, i + 3);
      const th = trigram.split('').reduce((a, c) => ((a << 3) - a + c.charCodeAt(0)) | 0, 0);
      vector[Math.abs(th) % EMBEDDING_DIM] += 0.3;
    }
  }

  for (let i = 0; i < meaningful.length - 1; i++) {
    const bigram = meaningful[i] + ' ' + meaningful[i + 1];
    const bh = bigram.split('').reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0);
    vector[Math.abs(bh) % EMBEDDING_DIM] += 0.7;
  }

  const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  return magnitude > 0 ? vector.map(v => v / magnitude) : vector;
}

async function embedText(
  text: string,
  purpose: "document" | "query",
  cacheNamespace: string,
): Promise<number[]> {
  try {
    const vector = await getSemanticEmbeddingVector(text, {
      dimensions: EMBEDDING_DIM,
      purpose,
      cacheNamespace,
      maxChars: 8_000,
    });
    if (Array.isArray(vector) && vector.length > 0) {
      return vector;
    }
  } catch (error) {
    console.warn("[RAGService] Semantic embedding failed, using local fallback", {
      purpose,
      cacheNamespace,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return localEmbed(text);
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i] * b[i];
  }
  return dot;
}

function chunkDocument(text: string, chunkSize = CHUNK_SIZE, overlap = CHUNK_OVERLAP): string[] {
  if (text.length <= chunkSize) return [text];

  const sections = text.split(/\n{2,}|\r\n{2,}/);
  const chunks: string[] = [];
  let currentChunk = "";

  for (const section of sections) {
    if (section.length > chunkSize) {
      if (currentChunk.length > 0) {
        chunks.push(currentChunk.trim());
        currentChunk = "";
      }
      const sentences = section.split(/(?<=[.!?])\s+/);
      let sentenceChunk = "";
      for (const sentence of sentences) {
        if (sentenceChunk.length + sentence.length > chunkSize && sentenceChunk.length > 0) {
          chunks.push(sentenceChunk.trim());
          const overlapText = sentenceChunk.slice(-overlap);
          sentenceChunk = overlapText + " " + sentence;
        } else {
          sentenceChunk += (sentenceChunk ? " " : "") + sentence;
        }
      }
      if (sentenceChunk.trim()) {
        currentChunk = sentenceChunk;
      }
    } else if (currentChunk.length + section.length > chunkSize) {
      chunks.push(currentChunk.trim());
      const overlapText = currentChunk.slice(-overlap);
      currentChunk = overlapText + "\n\n" + section;
    } else {
      currentChunk += (currentChunk ? "\n\n" : "") + section;
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks.filter(c => c.length > 20);
}

function extractKeyPhrases(text: string): string[] {
  const phrases: string[] = [];
  const headings = text.match(/^#{1,6}\s+.+$/gm);
  if (headings) phrases.push(...headings.map(h => h.replace(/^#+\s*/, '')));

  const boldText = text.match(/\*\*([^*]+)\*\*/g);
  if (boldText) phrases.push(...boldText.map(b => b.replace(/\*\*/g, '')));

  const numberedItems = text.match(/^\d+[.)]\s+.{10,80}$/gm);
  if (numberedItems) phrases.push(...numberedItems.map(n => n.replace(/^\d+[.)]\s*/, '')));

  return [...new Set(phrases)].slice(0, 20);
}

function bm25Score(query: string, doc: string): number {
  const k1 = 1.2, b = 0.75;
  const queryTerms = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  const docTerms = doc.toLowerCase().split(/\s+/);
  const docLen = docTerms.length;
  const avgDocLen = 200;
  const termFreq = new Map<string, number>();
  for (const t of docTerms) {
    termFreq.set(t, (termFreq.get(t) || 0) + 1);
  }

  let score = 0;
  for (const term of queryTerms) {
    const tf = termFreq.get(term) || 0;
    if (tf > 0) {
      const idf = Math.log(1 + 1);
      const tfNorm = (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * docLen / avgDocLen));
      score += idf * tfNorm;
    }
  }
  return score;
}

function computeFreshnessFactor(timestamp: number | null): number {
  if (!timestamp) return 0.5;
  const ageMs = Date.now() - timestamp;
  if (ageMs <= 0) return 1.0;
  return Math.pow(0.5, ageMs / FRESHNESS_HALF_LIFE_MS);
}

function rewriteQueryLocal(query: string): string[] {
  const subQueries: string[] = [query];

  const conjunctions = /\b(and|y|also|además|as well as|junto con)\b/i;
  if (conjunctions.test(query)) {
    const parts = query.split(conjunctions).filter(p => p.trim().length > 3 && !conjunctions.test(p));
    for (const part of parts) {
      const trimmed = part.trim();
      if (trimmed.length > 5) subQueries.push(trimmed);
    }
  }

  const synonymMap: Record<string, string[]> = {
    "error": ["bug", "issue", "problem", "fallo", "problema"],
    "bug": ["error", "issue", "defect", "fallo"],
    "create": ["make", "build", "generate", "crear", "generar"],
    "crear": ["create", "make", "construir", "generar"],
    "delete": ["remove", "drop", "eliminar", "borrar"],
    "eliminar": ["delete", "remove", "borrar", "quitar"],
    "search": ["find", "look", "query", "buscar"],
    "buscar": ["search", "find", "encontrar", "hallar"],
    "update": ["modify", "change", "edit", "actualizar", "modificar"],
    "actualizar": ["update", "modify", "cambiar", "editar"],
    "file": ["document", "archivo", "documento"],
    "archivo": ["file", "document", "fichero"],
    "function": ["method", "procedure", "función"],
    "función": ["function", "method", "procedimiento"],
    "database": ["db", "store", "base de datos"],
    "api": ["endpoint", "service", "servicio"],
    "config": ["configuration", "settings", "configuración"],
    "install": ["setup", "deploy", "instalar"],
    "test": ["spec", "check", "verify", "prueba", "verificar"],
  };

  const queryLower = query.toLowerCase();
  const queryWords = queryLower.split(/\s+/);
  const expanded: string[] = [];
  for (const word of queryWords) {
    if (synonymMap[word]) {
      for (const syn of synonymMap[word].slice(0, 2)) {
        expanded.push(query.replace(new RegExp(`\\b${word}\\b`, 'i'), syn));
      }
    }
  }
  if (expanded.length > 0) {
    subQueries.push(...expanded.slice(0, 3));
  }

  return [...new Set(subQueries)].slice(0, 5);
}

async function rewriteQueryWithLLM(query: string): Promise<string[]> {
  try {
    const response = await llmGateway.chat(
      [
        {
          role: "system" as const,
          content: `You are a query rewriting assistant for a RAG system. Given a user query, output a JSON array of 2-4 alternative search queries that capture the same intent but use different terms, decompose compound questions, or expand abbreviations. Be concise. Output ONLY a JSON array of strings, no explanation.`
        },
        {
          role: "user" as const,
          content: query
        }
      ],
      { model: RERANK_MODEL, temperature: 0.3, maxTokens: 200, timeout: 5000 }
    );

    const parsed = JSON.parse(response.content.trim().replace(/^```json?\s*/, '').replace(/\s*```$/, ''));
    if (Array.isArray(parsed)) {
      return [query, ...parsed.map((q: any) => String(q)).filter((q: string) => q.length > 3)].slice(0, 5);
    }
  } catch {
    console.warn("[RAGService] LLM query rewrite failed, using local rewrite fallback");
  }
  return rewriteQueryLocal(query);
}

async function rerankWithLLM(
  query: string,
  results: Array<{ content: string; score: number; index: number }>
): Promise<number[]> {
  if (results.length <= 1) return results.map(r => r.index);

  try {
    const candidates = results.slice(0, 10).map((r, i) => `[${i}] ${r.content.substring(0, 300)}`).join('\n\n');

    const response = await llmGateway.chat(
      [
        {
          role: "system" as const,
          content: `You are a relevance judge. Given a query and candidate passages, rank them by relevance. Output ONLY a JSON array of passage indices (the [N] numbers) ordered from most to least relevant. No explanation.`
        },
        {
          role: "user" as const,
          content: `Query: ${query}\n\nPassages:\n${candidates}`
        }
      ],
      { model: RERANK_MODEL, temperature: 0, maxTokens: 100, timeout: 8000 }
    );

    const parsed = JSON.parse(response.content.trim().replace(/^```json?\s*/, '').replace(/\s*```$/, ''));
    if (Array.isArray(parsed)) {
      const validIndices = parsed
        .map((i: any) => Number(i))
        .filter((i: number) => !isNaN(i) && i >= 0 && i < results.length);
      if (validIndices.length > 0) {
        const remaining = results
          .map((_, i) => i)
          .filter(i => !validIndices.includes(i));
        return [...validIndices, ...remaining].map(i => results[i].index);
      }
    }
  } catch {
    console.warn("[RAGService] LLM reranking failed, using score-order fallback");
  }
  return results.map(r => r.index);
}

const ensureTables = async () => {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS rag_documents (
        id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR(255) NOT NULL,
        chat_id VARCHAR(255),
        content TEXT NOT NULL,
        content_type VARCHAR(50) DEFAULT 'message',
        embedding JSONB,
        metadata JSONB DEFAULT '{}',
        chunk_index INTEGER DEFAULT 0,
        parent_doc_id VARCHAR(255),
        key_phrases JSONB DEFAULT '[]',
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_rag_user ON rag_documents(user_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_rag_chat ON rag_documents(chat_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_rag_parent ON rag_documents(parent_doc_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_rag_type ON rag_documents(content_type)`);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS user_preferences (
        id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR(255) UNIQUE NOT NULL,
        preferences JSONB DEFAULT '{}',
        communication_style JSONB DEFAULT '{}',
        topics_of_interest JSONB DEFAULT '[]',
        language VARCHAR(10) DEFAULT 'es',
        timezone VARCHAR(50),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS workspace_context (
        id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR(255) NOT NULL,
        file_path TEXT,
        file_type VARCHAR(50),
        content_summary TEXT,
        embedding JSONB,
        last_accessed TIMESTAMP DEFAULT NOW(),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
  } catch (e) {
    console.warn("[RAGService] ensureTables failed", e);
  }
};

ensureTables();

export class RAGService {
  async indexMessage(
    userId: string,
    chatId: string,
    content: string,
    role: "user" | "assistant"
  ): Promise<void> {
    if (content.length < 20) return;

    const embedding = await embedText(content, "document", `rag:message:${userId}`);
    const keyPhrases = extractKeyPhrases(content);

    await db.execute(sql`
      INSERT INTO rag_documents (user_id, chat_id, content, content_type, embedding, metadata, key_phrases)
      VALUES (${userId}, ${chatId}, ${content.substring(0, 4000)}, ${role},
              ${JSON.stringify(embedding)}, ${JSON.stringify({ role, timestamp: Date.now() })},
              ${JSON.stringify(keyPhrases)})
    `);
  }

  async indexDocument(
    userId: string,
    documentContent: string,
    metadata: {
      fileName?: string;
      fileType?: string;
      chatId?: string;
      sourceUrl?: string;
    } = {}
  ): Promise<{ chunks: number; docId: string }> {
    const docId = `doc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const chunks = chunkDocument(documentContent);

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const sha256 = crypto.createHash("sha256").update(chunk).digest("hex");

      const dup = await db.execute(sql`
        SELECT 1 AS x FROM rag_documents
        WHERE user_id = ${userId}
          AND content_type = 'document_chunk'
          AND (metadata::jsonb->>'sha256') = ${sha256}
        LIMIT 1
      `);
      if (Array.isArray(dup) && dup.length > 0) {
        continue;
      }

      const embedding = await embedText(chunk, "document", `rag:document:${userId}`);
      const keyPhrases = extractKeyPhrases(chunk);

      await db.execute(sql`
        INSERT INTO rag_documents (user_id, chat_id, content, content_type, embedding, metadata, chunk_index, parent_doc_id, key_phrases)
        VALUES (${userId}, ${metadata.chatId || null}, ${chunk}, 'document_chunk',
                ${JSON.stringify(embedding)},
                ${JSON.stringify({
                  fileName: metadata.fileName,
                  fileType: metadata.fileType,
                  sourceUrl: metadata.sourceUrl,
                  totalChunks: chunks.length,
                  chunkIndex: i,
                  docId,
                  timestamp: Date.now(),
                  sha256,
                })},
                ${i}, ${docId}, ${JSON.stringify(keyPhrases)})
      `);
    }

    return { chunks: chunks.length, docId };
  }

  async search(
    userId: string,
    query: string,
    options: {
      limit?: number;
      chatId?: string;
      minScore?: number;
      contentTypes?: string[];
    } = {}
  ): Promise<Array<{ content: string; score: number; chatId: string; metadata?: any }>> {
    const { limit = 5, chatId, minScore = 0.2, contentTypes } = options;

    const queryEmbedding = await embedText(query, "query", `rag:search:${userId}`);

    const result = chatId
      ? await db.execute(sql`
          SELECT content, chat_id, embedding, metadata, key_phrases, content_type, chunk_index, parent_doc_id, created_at FROM rag_documents
          WHERE user_id = ${userId} AND (chat_id IS NULL OR chat_id != ${chatId})
          ORDER BY created_at DESC
          LIMIT 200
        `)
      : await db.execute(sql`
          SELECT content, chat_id, embedding, metadata, key_phrases, content_type, chunk_index, parent_doc_id, created_at FROM rag_documents
          WHERE user_id = ${userId}
          ORDER BY created_at DESC
          LIMIT 200
        `);

    const rows = (result.rows || []).filter((row: any) => {
      if (contentTypes && contentTypes.length > 0) {
        return contentTypes.includes(row.content_type);
      }
      return true;
    });

    const scored = rows
      .map((row: any) => {
        const docEmbedding = typeof row.embedding === 'string'
          ? JSON.parse(row.embedding)
          : row.embedding;

        const vectorScore = cosineSimilarity(queryEmbedding, docEmbedding || []);
        const textScore = bm25Score(query, row.content || "");

        const keyPhrases: string[] = typeof row.key_phrases === 'string'
          ? JSON.parse(row.key_phrases)
          : (row.key_phrases || []);
        const phraseBoost = keyPhrases.some(p =>
          query.toLowerCase().includes(p.toLowerCase())
        ) ? 0.15 : 0;

        const meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata || {});
        const docTimestamp = meta.timestamp || (row.created_at ? new Date(row.created_at).getTime() : null);
        const freshness = computeFreshnessFactor(docTimestamp);

        const baseScore = (vectorScore * 0.45) + (Math.min(textScore / 5, 0.5) * 0.3) + phraseBoost;
        const hybridScore = baseScore * (0.85 + 0.15 * freshness);

        return {
          content: row.content,
          chatId: row.chat_id,
          score: hybridScore,
          metadata: meta,
          contentType: row.content_type,
          freshnessFactor: freshness,
          chunkIndex: row.chunk_index || 0,
          parentDocId: row.parent_doc_id || null,
        };
      })
      .filter(r => r.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return scored;
  }

  async enhancedSearch(
    userId: string,
    query: string,
    options: {
      limit?: number;
      chatId?: string;
      minScore?: number;
      contentTypes?: string[];
      enableRewriting?: boolean;
      enableReranking?: boolean;
      enableMultiHop?: boolean;
      useLLMRewrite?: boolean;
    } = {}
  ): Promise<{ results: EnhancedSearchResult[]; evidencePack: EvidencePack }> {
    const {
      limit = 5,
      chatId,
      minScore = 0.2,
      contentTypes,
      enableRewriting = true,
      enableReranking = true,
      enableMultiHop = true,
      useLLMRewrite = false,
    } = options;

    let subQueries: string[];
    if (enableRewriting) {
      subQueries = useLLMRewrite ? await rewriteQueryWithLLM(query) : rewriteQueryLocal(query);
    } else {
      subQueries = [query];
    }

    const allResultsMap = new Map<string, any>();
    let hopsUsed = 1;

    for (const sq of subQueries) {
      const results = await this.search(userId, sq, {
        limit: limit * 2,
        chatId,
        minScore: minScore * 0.8,
        contentTypes,
      });
      for (const r of results) {
        const key = r.content.substring(0, 100);
        const existing = allResultsMap.get(key);
        if (!existing || existing.score < r.score) {
          allResultsMap.set(key, r);
        }
      }
    }

    if (enableMultiHop) {
      const currentResults = Array.from(allResultsMap.values());
      const avgScore = currentResults.length > 0
        ? currentResults.reduce((s, r) => s + r.score, 0) / currentResults.length
        : 0;

      if (avgScore < MULTI_HOP_MIN_SCORE && currentResults.length < limit) {
        for (let hop = 1; hop < MULTI_HOP_MAX_ROUNDS; hop++) {
          hopsUsed++;
          const topContent = currentResults
            .sort((a, b) => b.score - a.score)
            .slice(0, 2)
            .map(r => r.content.substring(0, 100));

          const refinedQueries = topContent.map(c => {
            const words = c.split(/\s+/).filter(w => w.length > 3).slice(0, 5);
            return `${query} ${words.join(' ')}`;
          });

          for (const rq of refinedQueries) {
            const moreResults = await this.search(userId, rq, {
              limit: limit,
              chatId,
              minScore: minScore * 0.7,
              contentTypes,
            });
            for (const r of moreResults) {
              const key = r.content.substring(0, 100);
              const existing = allResultsMap.get(key);
              if (!existing || existing.score < r.score) {
                allResultsMap.set(key, r);
              }
            }
          }

          const updatedResults = Array.from(allResultsMap.values());
          const newAvg = updatedResults.length > 0
            ? updatedResults.reduce((s, r) => s + r.score, 0) / updatedResults.length
            : 0;
          if (newAvg >= MULTI_HOP_MIN_SCORE || updatedResults.length >= limit) break;
        }
      }
    }

    let finalResults = Array.from(allResultsMap.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, limit * 2);

    let rerankApplied = false;
    if (enableReranking && finalResults.length > 2) {
      try {
        const indexed = finalResults.map((r, i) => ({ content: r.content, score: r.score, index: i }));
        const rerankedOrder = await rerankWithLLM(query, indexed);
        const reranked = rerankedOrder.map(idx => finalResults[idx]).filter(Boolean);
        if (reranked.length > 0) {
          finalResults = reranked;
          rerankApplied = true;
        }
      } catch {
      }
    }

    const topResults = finalResults.slice(0, limit);

    const enhancedResults: EnhancedSearchResult[] = topResults.map(r => ({
      content: r.content,
      score: r.score,
      chatId: r.chatId,
      metadata: r.metadata,
      contentType: r.contentType,
      freshnessFactor: r.freshnessFactor || computeFreshnessFactor(r.metadata?.timestamp),
      citation: {
        sourceDoc: r.metadata?.fileName || null,
        sourceUrl: r.metadata?.sourceUrl || null,
        chunkIndex: r.chunkIndex || r.metadata?.chunkIndex || 0,
        relevanceScore: r.score,
        contentSnippet: r.content.substring(0, 200),
        timestamp: r.metadata?.timestamp || null,
        parentDocId: r.parentDocId || r.metadata?.docId || null,
        contentType: r.contentType || 'unknown',
      },
    }));

    const evidencePack: EvidencePack = {
      query,
      subQueries,
      citations: enhancedResults.map(r => r.citation),
      totalResults: allResultsMap.size,
      hopsUsed,
      rerankApplied,
    };

    return { results: enhancedResults, evidencePack };
  }

  async getContextForMessage(
    userId: string,
    message: string,
    currentChatId?: string
  ): Promise<string> {
    try {
      const { results, evidencePack } = await this.enhancedSearch(userId, message, {
        limit: 5,
        chatId: currentChatId,
        minScore: 0.25,
        enableRewriting: true,
        enableReranking: false,
        enableMultiHop: true,
        useLLMRewrite: false,
      });

      if (results.length === 0) return "";

      const contextParts = results.map((r, i) => {
        const citation = r.citation;
        const sourceLabel = citation.sourceDoc
          ? ` (doc: ${citation.sourceDoc})`
          : citation.sourceUrl
            ? ` (fuente: ${citation.sourceUrl})`
            : '';
        const freshnessLabel = r.freshnessFactor > 0.8 ? ' 🟢' : r.freshnessFactor > 0.4 ? ' 🟡' : ' 🔴';
        const scoreLabel = ` [score: ${r.score.toFixed(3)}]`;
        return `[Evidencia ${i + 1}${sourceLabel}${scoreLabel}${freshnessLabel}]: ${r.content.substring(0, 500)}`;
      });

      const stats = `hops=${evidencePack.hopsUsed}, queries=${evidencePack.subQueries.length}, total_candidates=${evidencePack.totalResults}`;
      return `\n\n[RAG++ - ${results.length} evidencias | ${stats}]\n${contextParts.join("\n\n")}\n`;
    } catch (error) {
      console.warn("[RAGService] Enhanced context fallback activated", error);
      const results = await this.search(userId, message, {
        limit: 5,
        chatId: currentChatId,
        minScore: 0.25
      });

      if (results.length === 0) return "";

      const contextParts = results.map((r, i) => {
        const source = r.metadata?.fileName
          ? ` (de: ${r.metadata.fileName})`
          : r.metadata?.sourceUrl
            ? ` (fuente: ${r.metadata.sourceUrl})`
            : '';
        return `[Contexto ${i + 1}${source}]: ${r.content.substring(0, 500)}`;
      });

      return `\n\n[Contexto RAG - ${results.length} fragmentos relevantes]\n${contextParts.join("\n\n")}\n`;
    }
  }

  async getContextWithEvidence(
    userId: string,
    message: string,
    currentChatId?: string
  ): Promise<{ context: string; evidencePack: EvidencePack | null }> {
    try {
      const { results, evidencePack } = await this.enhancedSearch(userId, message, {
        limit: 5,
        chatId: currentChatId,
        minScore: 0.25,
        enableRewriting: true,
        enableReranking: true,
        enableMultiHop: true,
        useLLMRewrite: false,
      });

      if (results.length === 0) return { context: "", evidencePack: null };

      const contextParts = results.map((r, i) => {
        const citation = r.citation;
        const sourceLabel = citation.sourceDoc
          ? ` (doc: ${citation.sourceDoc})`
          : citation.sourceUrl
            ? ` (fuente: ${citation.sourceUrl})`
            : '';
        return `[Evidencia ${i + 1}${sourceLabel} | relevancia: ${r.score.toFixed(3)}]: ${r.content.substring(0, 500)}`;
      });

      const context = `\n\n[RAG++ Evidence Pack - ${results.length} resultados]\n${contextParts.join("\n\n")}\n`;
      return { context, evidencePack };
    } catch (error) {
      console.warn("[RAGService] Evidence context generation failed", error);
      return { context: "", evidencePack: null };
    }
  }

  async getDocumentChunks(docId: string): Promise<Array<{ content: string; chunkIndex: number }>> {
    const result = await db.execute(sql`
      SELECT content, chunk_index FROM rag_documents
      WHERE parent_doc_id = ${docId}
      ORDER BY chunk_index ASC
    `);
    return (result.rows || []).map((row: any) => ({
      content: row.content,
      chunkIndex: row.chunk_index,
    }));
  }

  async getStats(userId: string): Promise<{ totalDocs: number; totalChunks: number; types: Record<string, number> }> {
    const result = await db.execute(sql`
      SELECT content_type, COUNT(*) as cnt FROM rag_documents
      WHERE user_id = ${userId}
      GROUP BY content_type
    `);
    const types: Record<string, number> = {};
    let total = 0;
    for (const row of (result.rows || []) as any[]) {
      types[row.content_type] = Number(row.cnt);
      total += Number(row.cnt);
    }
    return { totalDocs: total, totalChunks: total, types };
  }
}

export class UserPersonalizationService {
  async getPreferences(userId: string): Promise<Record<string, any>> {
    const result = await db.execute(sql`
      SELECT * FROM user_preferences WHERE user_id = ${userId}
    `);

    if (result.rows?.length) {
      return result.rows[0] as Record<string, any>;
    }

    await db.execute(sql`
      INSERT INTO user_preferences (user_id) VALUES (${userId})
      ON CONFLICT (user_id) DO NOTHING
    `);

    return {
      preferences: {},
      communication_style: {},
      topics_of_interest: [],
      language: 'es'
    };
  }

  async updatePreferences(
    userId: string,
    updates: {
      preferences?: Record<string, any>;
      communicationStyle?: Record<string, any>;
      topicsOfInterest?: string[];
      language?: string;
      timezone?: string;
    }
  ): Promise<void> {
    const { preferences, communicationStyle, topicsOfInterest, language, timezone } = updates;

    await db.execute(sql`
      INSERT INTO user_preferences (user_id, preferences, communication_style, topics_of_interest, language, timezone)
      VALUES (${userId}, ${JSON.stringify(preferences || {})}, ${JSON.stringify(communicationStyle || {})},
              ${JSON.stringify(topicsOfInterest || [])}, ${language || 'es'}, ${timezone})
      ON CONFLICT (user_id) DO UPDATE SET
        preferences = COALESCE(${preferences ? JSON.stringify(preferences) : null}, user_preferences.preferences),
        communication_style = COALESCE(${communicationStyle ? JSON.stringify(communicationStyle) : null}, user_preferences.communication_style),
        topics_of_interest = COALESCE(${topicsOfInterest ? JSON.stringify(topicsOfInterest) : null}, user_preferences.topics_of_interest),
        language = COALESCE(${language}, user_preferences.language),
        timezone = COALESCE(${timezone}, user_preferences.timezone),
        updated_at = NOW()
    `);
  }

  async learnFromConversation(
    userId: string,
    messages: Array<{ role: string; content: string }>
  ): Promise<void> {
    const userMessages = messages.filter(m => m.role === 'user').map(m => m.content);
    const allText = userMessages.join(' ').toLowerCase();

    const spanishWords = (allText.match(/\b(el|la|los|las|de|que|y|en|un|una|es|por|para)\b/g) || []).length;
    const englishWords = (allText.match(/\b(the|a|an|is|are|to|of|and|in|for|with)\b/g) || []).length;

    const detectedLanguage = spanishWords > englishWords ? 'es' : 'en';

    const topics: string[] = [];
    const topicPatterns: Record<string, RegExp> = {
      'programación': /\b(código|programar|python|javascript|api|función|error|bug)\b/i,
      'negocios': /\b(ventas|clientes|marketing|empresa|negocio|inversión)\b/i,
      'creatividad': /\b(diseño|imagen|crear|arte|historia|escribir)\b/i,
      'educación': /\b(aprender|estudiar|curso|explicar|entender)\b/i,
      'datos': /\b(datos|análisis|estadística|gráfico|reporte)\b/i
    };

    for (const [topic, pattern] of Object.entries(topicPatterns)) {
      if (pattern.test(allText)) {
        topics.push(topic);
      }
    }

    const style: Record<string, any> = {};
    const formalIndicators = (allText.match(/\b(usted|por favor|gracias|estimado|cordialmente)\b/g) || []).length;
    const informalIndicators = (allText.match(/\b(tu|oye|mira|genial|cool|jaja)\b/g) || []).length;
    style.formality = formalIndicators > informalIndicators ? 'formal' : 'casual';

    const avgLength = userMessages.reduce((sum, m) => sum + m.length, 0) / (userMessages.length || 1);
    style.detailLevel = avgLength > 100 ? 'detailed' : 'concise';

    await this.updatePreferences(userId, {
      language: detectedLanguage,
      topicsOfInterest: topics,
      communicationStyle: style
    });
  }

  async getPersonalizationContext(userId: string): Promise<string> {
    const prefs = await this.getPreferences(userId);

    const parts: string[] = [];

    if (prefs.language) {
      parts.push(`Idioma preferido: ${prefs.language === 'es' ? 'Español' : 'English'}`);
    }

    if (prefs.communication_style?.formality) {
      parts.push(`Estilo: ${prefs.communication_style.formality === 'formal' ? 'Formal y profesional' : 'Casual y amigable'}`);
    }

    if (prefs.communication_style?.detailLevel) {
      parts.push(`Nivel de detalle: ${prefs.communication_style.detailLevel === 'detailed' ? 'Respuestas detalladas' : 'Respuestas concisas'}`);
    }

    if (prefs.topics_of_interest?.length) {
      parts.push(`Temas de interés: ${prefs.topics_of_interest.join(', ')}`);
    }

    if (parts.length === 0) return '';

    return `\n\n[Preferencias del usuario]\n${parts.join('\n')}\n`;
  }
}

export class WorkspaceContextService {
  async indexFile(
    userId: string,
    filePath: string,
    content: string,
    fileType: string
  ): Promise<void> {
    const summary = content.substring(0, 500);
    const embedding = await embedText(content, "document", `workspace:file:${userId}`);

    await db.execute(sql`
      INSERT INTO workspace_context (user_id, file_path, file_type, content_summary, embedding)
      VALUES (${userId}, ${filePath}, ${fileType}, ${summary}, ${JSON.stringify(embedding)})
      ON CONFLICT DO NOTHING
    `);
  }

  async getRelevantFiles(
    userId: string,
    query: string,
    limit = 3
  ): Promise<Array<{ filePath: string; summary: string; score: number }>> {
    const queryEmbedding = await embedText(query, "query", `workspace:query:${userId}`);

    const result = await db.execute(sql`
      SELECT file_path, content_summary, embedding FROM workspace_context
      WHERE user_id = ${userId}
      ORDER BY last_accessed DESC
      LIMIT 50
    `);

    const scored = (result.rows || [])
      .map((row: any) => {
        const docEmbedding = typeof row.embedding === 'string'
          ? JSON.parse(row.embedding)
          : row.embedding;
        const score = cosineSimilarity(queryEmbedding, docEmbedding || []);
        return {
          filePath: row.file_path,
          summary: row.content_summary,
          score
        };
      })
      .filter(r => r.score >= 0.3)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return scored;
  }

  async getWorkspaceContext(userId: string, message: string): Promise<string> {
    const files = await this.getRelevantFiles(userId, message, 2);

    if (files.length === 0) return '';

    const context = files
      .map(f => `[${f.filePath}]: ${f.summary.substring(0, 200)}...`)
      .join('\n');

    return `\n\n[Archivos relacionados del workspace]\n${context}\n`;
  }
}

export const ragService = new RAGService();
export const personalizationService = new UserPersonalizationService();
export const workspaceContextService = new WorkspaceContextService();

export async function buildEnhancedContext(
  userId: string,
  message: string,
  chatId?: string
): Promise<string> {
  const [ragContext, personalContext, workspaceContext] = await Promise.all([
    ragService.getContextForMessage(userId, message, chatId),
    personalizationService.getPersonalizationContext(userId),
    workspaceContextService.getWorkspaceContext(userId, message)
  ]);

  return personalContext + ragContext + workspaceContext;
}

export async function buildEnhancedContextWithEvidence(
  userId: string,
  message: string,
  chatId?: string
): Promise<{ context: string; evidencePack: EvidencePack | null }> {
  const [ragResult, personalContext, workspaceContext] = await Promise.all([
    ragService.getContextWithEvidence(userId, message, chatId),
    personalizationService.getPersonalizationContext(userId),
    workspaceContextService.getWorkspaceContext(userId, message)
  ]);

  const context = personalContext + ragResult.context + workspaceContext;
  return { context, evidencePack: ragResult.evidencePack };
}
