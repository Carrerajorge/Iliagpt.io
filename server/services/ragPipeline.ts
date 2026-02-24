import { db } from "../db";
import { fileChunks, files } from "@shared/schema";
import { eq, sql, and, inArray } from "drizzle-orm";
import { parseDocument, extractContent } from "./documentIngestion";
import { GoogleGenAI } from "@google/genai";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

export interface ChunkMetadata {
  pageNumber?: number;
  sectionTitle?: string;
  sectionType?: 'title' | 'heading' | 'paragraph' | 'list' | 'table' | 'code';
  startOffset: number;
  endOffset: number;
  hasTable?: boolean;
  hasFigure?: boolean;
  language?: string;
}

export interface SemanticChunk {
  content: string;
  chunkIndex: number;
  metadata: ChunkMetadata;
  tokens?: number;
}

export interface RetrievedChunk {
  id: string;
  content: string;
  score: number;
  pageNumber?: number;
  sectionTitle?: string;
  matchType: 'vector' | 'keyword' | 'hybrid';
  metadata?: ChunkMetadata;
}

export interface RAGContext {
  chunks: RetrievedChunk[];
  totalChunks: number;
  queryEmbedding?: number[];
  processingTimeMs: number;
}

export interface CitedResponse {
  content: string;
  citations: Citation[];
  confidence: number;
}

export interface Citation {
  text: string;
  pageNumber?: number;
  sectionTitle?: string;
  chunkId: string;
  relevanceScore: number;
}

const CHUNK_CONFIG = {
  targetSize: 800,
  maxSize: 1200,
  minSize: 100,
  overlap: 150,
  sentenceOverlap: 2
};

export function semanticChunk(text: string, pageInfo?: Map<number, { start: number; end: number }>): SemanticChunk[] {
  const chunks: SemanticChunk[] = [];
  
  const paragraphs = text.split(/\n\n+/);
  let currentChunk = '';
  let currentOffset = 0;
  let chunkIndex = 0;
  let currentPageNumber = 1;
  
  const detectSectionType = (text: string): ChunkMetadata['sectionType'] => {
    if (text.match(/^#{1,6}\s/m) || text.match(/^[A-Z][A-Z\s]{3,}$/m)) return 'heading';
    if (text.match(/^\s*[-*•]\s/m) || text.match(/^\s*\d+\.\s/m)) return 'list';
    if (text.match(/\|.*\|.*\|/)) return 'table';
    if (text.match(/```|^\s{4,}\S/m)) return 'code';
    return 'paragraph';
  };
  
  const extractSectionTitle = (text: string): string | undefined => {
    const headingMatch = text.match(/^#{1,6}\s+(.+)$/m) || text.match(/^([A-Z][A-Za-z\s]{2,50})$/m);
    return headingMatch?.[1]?.trim();
  };
  
  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trim();
    if (!trimmed) continue;
    
    if (pageInfo) {
      for (const [page, range] of pageInfo) {
        if (currentOffset >= range.start && currentOffset < range.end) {
          currentPageNumber = page;
          break;
        }
      }
    }
    
    if (currentChunk.length + trimmed.length > CHUNK_CONFIG.maxSize && currentChunk.length >= CHUNK_CONFIG.minSize) {
      chunks.push({
        content: currentChunk.trim(),
        chunkIndex,
        metadata: {
          pageNumber: currentPageNumber,
          sectionType: detectSectionType(currentChunk),
          sectionTitle: extractSectionTitle(currentChunk),
          startOffset: currentOffset - currentChunk.length,
          endOffset: currentOffset,
          hasTable: /\|.*\|.*\|/.test(currentChunk),
          hasFigure: /\[?(figure|figura|image|imagen|chart|gráfico)\s*\d*\]?/i.test(currentChunk)
        }
      });
      chunkIndex++;
      
      const sentences = currentChunk.split(/[.!?]+\s+/);
      const overlapSentences = sentences.slice(-CHUNK_CONFIG.sentenceOverlap);
      currentChunk = overlapSentences.join('. ') + ' ' + trimmed;
    } else {
      currentChunk += (currentChunk ? '\n\n' : '') + trimmed;
    }
    
    currentOffset += trimmed.length + 2;
  }
  
  if (currentChunk.trim().length >= CHUNK_CONFIG.minSize) {
    chunks.push({
      content: currentChunk.trim(),
      chunkIndex,
      metadata: {
        pageNumber: currentPageNumber,
        sectionType: detectSectionType(currentChunk),
        sectionTitle: extractSectionTitle(currentChunk),
        startOffset: currentOffset - currentChunk.length,
        endOffset: currentOffset,
        hasTable: /\|.*\|.*\|/.test(currentChunk),
        hasFigure: /\[?(figure|figura|image|imagen|chart|gráfico)\s*\d*\]?/i.test(currentChunk)
      }
    });
  }
  
  return chunks;
}

export async function generateEmbeddingGemini(text: string): Promise<number[]> {
  const isTestEnv = process.env.NODE_ENV === 'test' || !!process.env.VITEST_WORKER_ID || !!process.env.VITEST_POOL_ID;
  if (!GEMINI_API_KEY || isTestEnv) {
    return generateFallbackEmbedding(text);
  }
  
  try {
    const genAI = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    const result = await genAI.models.embedContent({
      model: process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-001',
      contents: [{ role: 'user', parts: [{ text: text.slice(0, 8000) }] }]
    });
    
    if (result.embeddings?.[0]?.values) {
      return result.embeddings[0].values;
    }
    if (result.embedding?.values) {
      return result.embedding.values;
    }
    return generateFallbackEmbedding(text);
  } catch (error) {
    console.error('[RAG] Embedding error:', error);
    return generateFallbackEmbedding(text);
  }
}

function generateFallbackEmbedding(text: string): number[] {
  const DIMENSIONS = 768;
  const embedding = new Array(DIMENSIONS).fill(0);
  
  const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  words.forEach((word, idx) => {
    let hash = 0;
    for (let i = 0; i < word.length; i++) {
      hash = ((hash << 5) - hash) + word.charCodeAt(i);
      hash = hash & hash;
    }
    const position = Math.abs(hash) % DIMENSIONS;
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

export async function generateEmbeddingsBatch(texts: string[]): Promise<number[][]> {
  const embeddings: number[][] = [];
  const batchSize = 10;
  
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const batchEmbeddings = await Promise.all(
      batch.map(text => generateEmbeddingGemini(text))
    );
    embeddings.push(...batchEmbeddings);
  }
  
  return embeddings;
}

export async function indexDocument(
  fileId: string,
  buffer: Buffer,
  mimeType: string,
  fileName: string
): Promise<{ chunksCreated: number; processingTimeMs: number }> {
  const startTime = Date.now();
  
  const text = await extractContent(buffer, mimeType, fileName);
  if (!text || text.length < 10) {
    throw new Error('No extractable text content found in document');
  }
  
  const chunks = semanticChunk(text);
  console.log(`[RAG] Created ${chunks.length} semantic chunks for ${fileName}`);
  
  await db.delete(fileChunks).where(eq(fileChunks.fileId, fileId));
  
  const embeddings = await generateEmbeddingsBatch(chunks.map(c => c.content));
  
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    await db.insert(fileChunks).values({
      fileId,
      content: chunk.content,
      embedding: embeddings[i],
      pageNumber: chunk.metadata.pageNumber,
      chunkIndex: chunk.chunkIndex,
      metadata: chunk.metadata
    });
  }
  
  return {
    chunksCreated: chunks.length,
    processingTimeMs: Date.now() - startTime
  };
}

function calculateBM25Score(query: string, document: string): number {
  const k1 = 1.5;
  const b = 0.75;
  const avgDocLength = 500;
  
  const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
  const docTerms = document.toLowerCase().split(/\s+/);
  const docLength = docTerms.length;
  
  const termFreq = new Map<string, number>();
  for (const term of docTerms) {
    termFreq.set(term, (termFreq.get(term) || 0) + 1);
  }
  
  let score = 0;
  for (const term of queryTerms) {
    const tf = termFreq.get(term) || 0;
    if (tf > 0) {
      const idf = Math.log(1 + 1);
      const numerator = tf * (k1 + 1);
      const denominator = tf + k1 * (1 - b + b * (docLength / avgDocLength));
      score += idf * (numerator / denominator);
    }
  }
  
  return score;
}

function cosineSimilarity(a: number[], b: number[]): number {
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

export async function hybridRetrieve(
  query: string,
  fileIds: string[],
  options: {
    topK?: number;
    vectorWeight?: number;
    keywordWeight?: number;
    minScore?: number;
  } = {}
): Promise<RAGContext> {
  const startTime = Date.now();
  const { topK = 5, vectorWeight = 0.7, keywordWeight = 0.3, minScore = 0.1 } = options;
  
  const queryEmbedding = await generateEmbeddingGemini(query);
  
  const allChunks = await db
    .select()
    .from(fileChunks)
    .where(inArray(fileChunks.fileId, fileIds));
  
  if (allChunks.length === 0) {
    return {
      chunks: [],
      totalChunks: 0,
      queryEmbedding,
      processingTimeMs: Date.now() - startTime
    };
  }
  
  const scoredChunks: Array<{
    chunk: typeof allChunks[0];
    vectorScore: number;
    keywordScore: number;
    hybridScore: number;
  }> = [];
  
  for (const chunk of allChunks) {
    const vectorScore = chunk.embedding 
      ? cosineSimilarity(queryEmbedding, chunk.embedding)
      : 0;
    
    const keywordScore = calculateBM25Score(query, chunk.content);
    const normalizedKeywordScore = Math.min(keywordScore / 10, 1);
    
    const hybridScore = (vectorScore * vectorWeight) + (normalizedKeywordScore * keywordWeight);
    
    if (hybridScore >= minScore) {
      scoredChunks.push({
        chunk,
        vectorScore,
        keywordScore: normalizedKeywordScore,
        hybridScore
      });
    }
  }
  
  scoredChunks.sort((a, b) => b.hybridScore - a.hybridScore);
  
  const topChunks = scoredChunks.slice(0, topK);
  
  const retrievedChunks: RetrievedChunk[] = topChunks.map(({ chunk, vectorScore, keywordScore, hybridScore }) => ({
    id: chunk.id,
    content: chunk.content,
    score: hybridScore,
    pageNumber: chunk.pageNumber ?? undefined,
    sectionTitle: (chunk.metadata as ChunkMetadata)?.sectionTitle,
    matchType: vectorScore > keywordScore ? 'vector' : keywordScore > vectorScore ? 'keyword' : 'hybrid',
    metadata: chunk.metadata as ChunkMetadata
  }));
  
  return {
    chunks: retrievedChunks,
    totalChunks: allChunks.length,
    queryEmbedding,
    processingTimeMs: Date.now() - startTime
  };
}

export function rerank(
  query: string,
  chunks: RetrievedChunk[],
  options: { diversityPenalty?: number } = {}
): RetrievedChunk[] {
  const { diversityPenalty = 0.1 } = options;
  
  const queryTerms = new Set(query.toLowerCase().split(/\s+/).filter(t => t.length > 2));
  
  const rerankedChunks = chunks.map(chunk => {
    let boost = 0;
    
    const chunkTerms = chunk.content.toLowerCase().split(/\s+/);
    const exactMatches = chunkTerms.filter(t => queryTerms.has(t)).length;
    boost += exactMatches * 0.05;
    
    if (chunk.sectionTitle) {
      const titleTerms = chunk.sectionTitle.toLowerCase().split(/\s+/);
      const titleMatches = titleTerms.filter(t => queryTerms.has(t)).length;
      boost += titleMatches * 0.1;
    }
    
    if (chunk.metadata?.sectionType === 'heading') boost += 0.05;
    if (chunk.metadata?.hasTable && query.match(/tabla|table|datos|data/i)) boost += 0.1;
    if (chunk.metadata?.hasFigure && query.match(/figura|figure|imagen|image|gráfico|chart/i)) boost += 0.1;
    
    return {
      ...chunk,
      score: chunk.score + boost
    };
  });
  
  rerankedChunks.sort((a, b) => b.score - a.score);
  
  const diverseChunks: RetrievedChunk[] = [];
  const seenPages = new Set<number>();
  
  for (const chunk of rerankedChunks) {
    if (chunk.pageNumber && seenPages.has(chunk.pageNumber)) {
      chunk.score -= diversityPenalty;
    }
    if (chunk.pageNumber) seenPages.add(chunk.pageNumber);
    diverseChunks.push(chunk);
  }
  
  diverseChunks.sort((a, b) => b.score - a.score);
  
  return diverseChunks;
}

export function buildPromptWithContext(
  query: string,
  chunks: RetrievedChunk[],
  options: {
    maxContextTokens?: number;
    includePageNumbers?: boolean;
    language?: 'es' | 'en';
  } = {}
): { prompt: string; citations: Citation[] } {
  const { maxContextTokens = 4000, includePageNumbers = true, language = 'es' } = options;
  
  const citations: Citation[] = [];
  let contextParts: string[] = [];
  let estimatedTokens = 0;
  
  for (const chunk of chunks) {
    const chunkTokens = Math.ceil(chunk.content.length / 4);
    if (estimatedTokens + chunkTokens > maxContextTokens) break;
    
    let reference = '';
    if (includePageNumbers && chunk.pageNumber) {
      reference = `[Página ${chunk.pageNumber}${chunk.sectionTitle ? ` - ${chunk.sectionTitle}` : ''}]`;
    }
    
    contextParts.push(`${reference}\n${chunk.content}`);
    estimatedTokens += chunkTokens;
    
    citations.push({
      text: chunk.content.slice(0, 200) + (chunk.content.length > 200 ? '...' : ''),
      pageNumber: chunk.pageNumber,
      sectionTitle: chunk.sectionTitle,
      chunkId: chunk.id,
      relevanceScore: chunk.score
    });
  }
  
  const systemInstructions = language === 'es' 
    ? `Eres un asistente experto en análisis de documentos. Responde basándote ÚNICAMENTE en el contexto proporcionado. Si la información no está en el contexto, indícalo claramente. Cita las páginas cuando sea relevante usando el formato [p. X].`
    : `You are an expert document analysis assistant. Answer based ONLY on the provided context. If the information is not in the context, clearly indicate this. Cite page numbers when relevant using [p. X] format.`;
  
  const prompt = `${systemInstructions}

## Contexto del documento:
${contextParts.join('\n\n---\n\n')}

## Pregunta del usuario:
${query}

## Instrucciones:
- Responde de manera precisa y concisa
- Cita las páginas relevantes cuando proporciones información
- Si no encuentras la respuesta en el contexto, indícalo
- Usa el mismo idioma que la pregunta`;

  return { prompt, citations };
}

export interface TableData {
  headers: string[];
  rows: string[][];
  pageNumber?: number;
  caption?: string;
}

export function parseTablesFromChunks(chunks: RetrievedChunk[]): TableData[] {
  const tables: TableData[] = [];
  
  for (const chunk of chunks) {
    if (!chunk.metadata?.hasTable) continue;
    
    const tableMatches = chunk.content.match(/\|[^\n]+\|(?:\n\|[^\n]+\|)+/g);
    if (!tableMatches) continue;
    
    for (const tableStr of tableMatches) {
      const lines = tableStr.split('\n').filter(l => l.trim());
      if (lines.length < 2) continue;
      
      const parseRow = (row: string): string[] => 
        row.split('|').map(cell => cell.trim()).filter(cell => cell && !cell.match(/^-+$/));
      
      const headers = parseRow(lines[0]);
      const rows: string[][] = [];
      
      for (let i = 1; i < lines.length; i++) {
        const row = parseRow(lines[i]);
        if (row.length > 0 && !row.every(cell => cell.match(/^-+$/))) {
          rows.push(row);
        }
      }
      
      if (headers.length > 0 && rows.length > 0) {
        tables.push({
          headers,
          rows,
          pageNumber: chunk.pageNumber
        });
      }
    }
  }
  
  return tables;
}

export async function answerWithRAG(
  query: string,
  fileIds: string[],
  options: {
    topK?: number;
    includeVisual?: boolean;
    language?: 'es' | 'en';
  } = {}
): Promise<{
  context: RAGContext;
  prompt: string;
  citations: Citation[];
  tables: TableData[];
}> {
  const { topK = 5, language = 'es' } = options;
  
  const context = await hybridRetrieve(query, fileIds, { topK: topK * 2 });
  
  const rerankedChunks = rerank(query, context.chunks);
  const finalChunks = rerankedChunks.slice(0, topK);
  
  const { prompt, citations } = buildPromptWithContext(query, finalChunks, { language });
  
  const tables = parseTablesFromChunks(finalChunks);
  
  return {
    context: { ...context, chunks: finalChunks },
    prompt,
    citations,
    tables
  };
}

export const ragPipeline = {
  semanticChunk,
  indexDocument,
  hybridRetrieve,
  rerank,
  buildPromptWithContext,
  parseTablesFromChunks,
  answerWithRAG,
  generateEmbeddingGemini,
  generateEmbeddingsBatch
};
