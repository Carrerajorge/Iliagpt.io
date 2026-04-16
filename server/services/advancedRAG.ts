import { GoogleGenAI } from '@google/genai';
import { db } from '../db';
import { fileChunks, files } from '@shared/schema';
import { eq, inArray, sql, and, gte, lte, like } from 'drizzle-orm';
import { LRUCache } from 'lru-cache';
import crypto from 'crypto';

const isTestEnv = process.env.NODE_ENV === 'test' || !!process.env.VITEST_WORKER_ID || !!process.env.VITEST_POOL_ID;

// Avoid network calls during tests.
const genAI = !isTestEnv && process.env.GEMINI_API_KEY ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }) : null;

// Configurable because some projects/keys don't have `text-embedding-004`.
const EMBEDDING_MODEL = process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-001';
const LLM_MODEL = 'gemini-2.0-flash';

interface SemanticChunk {
  content: string;
  embedding?: number[];
  pageNumber?: number;
  sectionTitle?: string;
  metadata: {
    sectionType: 'heading' | 'paragraph' | 'table' | 'code' | 'list' | 'figure';
    hasTable: boolean;
    hasFigure: boolean;
    startSentence: number;
    endSentence: number;
    semanticDensity: number;
    documentPosition: number;
    hierarchy: string[];
  };
}

interface RetrievedChunk extends SemanticChunk {
  id: string;
  fileId: string;
  score: number;
  bm25Score: number;
  vectorScore: number;
  rerankerScore?: number;
}

interface QueryExpansion {
  original: string;
  hypothetical: string;
  subQueries: string[];
  keywords: string[];
  filters: MetadataFilters;
}

interface MetadataFilters {
  sectionTypes?: string[];
  pageRange?: { start: number; end: number };
  hasTable?: boolean;
  hasFigure?: boolean;
  dateRange?: { start: Date; end: Date };
}

interface RAGResult {
  chunks: RetrievedChunk[];
  answer: string;
  citations: Citation[];
  confidence: number;
  reasoning: string[];
  tables: TableData[];
  suggestedFollowups: string[];
}

interface Citation {
  text: string;
  pageNumber?: number;
  sectionTitle?: string;
  chunkId: string;
  relevanceScore: number;
  excerptStart: number;
  excerptEnd: number;
}

interface TableData {
  headers: string[];
  rows: string[][];
  pageNumber?: number;
  caption?: string;
  summary?: string;
}

interface CacheEntry {
  queryHash: string;
  result: RAGResult;
  timestamp: number;
  hitCount: number;
  similarQueries: string[];
}

const semanticCache = new LRUCache<string, CacheEntry>({
  max: 1000,
  ttl: 1000 * 60 * 60,
});

const embeddingCache = new LRUCache<string, number[]>({
  max: 5000,
  ttl: 1000 * 60 * 60 * 24,
});

function splitIntoSentences(text: string): string[] {
  const sentencePattern = /[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g;
  const matches = text.match(sentencePattern) || [];
  return matches.map(s => s.trim()).filter(s => s.length > 0);
}

async function computeSentenceEmbeddings(sentences: string[]): Promise<number[][]> {
  const embeddings: number[][] = [];
  const batchSize = 20;
  
  for (let i = 0; i < sentences.length; i += batchSize) {
    const batch = sentences.slice(i, i + batchSize);
    const batchEmbeddings = await Promise.all(
      batch.map(async (sentence) => {
        const cacheKey = `sent:${crypto.createHash('md5').update(sentence).digest('hex')}`;
        const cached = embeddingCache.get(cacheKey);
        if (cached) return cached;
        
        try {
          if (!genAI) {
            const embedding = generateFallbackEmbedding(sentence);
            embeddingCache.set(cacheKey, embedding);
            return embedding;
          }

          const result = await genAI.models.embedContent({
            model: EMBEDDING_MODEL,
            contents: [{ role: 'user', parts: [{ text: sentence }] }],
          });
          const embedding = result.embeddings?.[0]?.values || generateFallbackEmbedding(sentence);
          embeddingCache.set(cacheKey, embedding);
          return embedding;
        } catch (err) {
          console.error('[AdvancedRAG] Embedding error:', err);
          return generateFallbackEmbedding(sentence);
        }
      })
    );
    embeddings.push(...batchEmbeddings);
  }
  
  return embeddings;
}

function generateFallbackEmbedding(text: string): number[] {
  const hash = crypto.createHash('sha256').update(text).digest();
  const embedding = new Array(768).fill(0);
  for (let i = 0; i < 768; i++) {
    embedding[i] = (hash[i % hash.length] / 255) * 2 - 1;
  }
  return embedding;
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dotProduct = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB) || 1);
}

function findSemanticBoundaries(
  sentences: string[],
  embeddings: number[][],
  threshold: number = 0.4
): number[] {
  const boundaries: number[] = [0];
  
  for (let i = 1; i < embeddings.length; i++) {
    const similarity = cosineSimilarity(embeddings[i - 1], embeddings[i]);
    if (similarity < threshold) {
      boundaries.push(i);
    }
  }
  
  boundaries.push(sentences.length);
  return boundaries;
}

function detectSectionType(text: string): SemanticChunk['metadata']['sectionType'] {
  const trimmed = text.trim();
  
  if (trimmed.match(/^#{1,6}\s|^[A-Z][A-Z0-9\s]{0,50}$/m)) return 'heading';
  if (trimmed.includes('|') && trimmed.split('\n').filter(l => l.includes('|')).length > 2) return 'table';
  if (trimmed.match(/```|^\s{4,}[a-zA-Z]/m)) return 'code';
  if (trimmed.match(/^[\s]*[-*•]\s|^[\s]*\d+\.\s/m)) return 'list';
  if (trimmed.match(/figura|figure|imagen|image|gráfico|chart|diagrama/i)) return 'figure';
  
  return 'paragraph';
}

function calculateSemanticDensity(text: string): number {
  const words = text.split(/\s+/).filter(w => w.length > 2);
  const uniqueWords = new Set(words.map(w => w.toLowerCase()));
  const sentences = splitIntoSentences(text);
  
  const lexicalDiversity = uniqueWords.size / (words.length || 1);
  const avgSentenceLength = words.length / (sentences.length || 1);
  const technicalTerms = (text.match(/[A-Z][a-z]*[A-Z][a-z]*|\b\w+tion\b|\b\w+ment\b|\b\w+ity\b/g) || []).length;
  
  return (lexicalDiversity * 0.4 + (avgSentenceLength / 30) * 0.3 + (technicalTerms / words.length) * 0.3);
}

export async function advancedSemanticChunk(
  content: string,
  options: {
    targetChunkSize?: number;
    maxChunkSize?: number;
    minChunkSize?: number;
    overlapSentences?: number;
  } = {}
): Promise<SemanticChunk[]> {
  const {
    targetChunkSize = 800,
    maxChunkSize = 1200,
    minChunkSize = 200,
    overlapSentences = 2
  } = options;
  
  const sentences = splitIntoSentences(content);
  if (sentences.length === 0) return [];
  
  const embeddings = await computeSentenceEmbeddings(sentences);
  const boundaries = findSemanticBoundaries(sentences, embeddings);
  
  const chunks: SemanticChunk[] = [];
  let currentHierarchy: string[] = [];
  
  for (let i = 0; i < boundaries.length - 1; i++) {
    const start = Math.max(0, boundaries[i] - overlapSentences);
    const end = boundaries[i + 1];
    
    const chunkSentences = sentences.slice(start, end);
    const chunkContent = chunkSentences.join(' ');
    const chunkTokens = Math.ceil(chunkContent.length / 4);
    
    if (chunkTokens < minChunkSize && i < boundaries.length - 2) {
      continue;
    }
    
    if (chunkTokens > maxChunkSize) {
      const subChunks = splitLargeChunk(chunkContent, targetChunkSize, maxChunkSize);
      for (const subChunk of subChunks) {
        const sectionType = detectSectionType(subChunk);
        if (sectionType === 'heading') {
          currentHierarchy = [subChunk.trim().slice(0, 100)];
        }
        
        chunks.push({
          content: subChunk,
          metadata: {
            sectionType,
            hasTable: subChunk.includes('|') && subChunk.split('\n').filter(l => l.includes('|')).length > 2,
            hasFigure: !!subChunk.match(/figura|figure|imagen|image|gráfico|chart/i),
            startSentence: start,
            endSentence: end,
            semanticDensity: calculateSemanticDensity(subChunk),
            documentPosition: i / (boundaries.length - 1),
            hierarchy: [...currentHierarchy]
          }
        });
      }
    } else {
      const sectionType = detectSectionType(chunkContent);
      if (sectionType === 'heading') {
        currentHierarchy = [chunkContent.trim().slice(0, 100)];
      }
      
      chunks.push({
        content: chunkContent,
        metadata: {
          sectionType,
          hasTable: chunkContent.includes('|') && chunkContent.split('\n').filter(l => l.includes('|')).length > 2,
          hasFigure: !!chunkContent.match(/figura|figure|imagen|image|gráfico|chart/i),
          startSentence: start,
          endSentence: end,
          semanticDensity: calculateSemanticDensity(chunkContent),
          documentPosition: i / (boundaries.length - 1),
          hierarchy: [...currentHierarchy]
        }
      });
    }
  }
  
  return chunks;
}

function splitLargeChunk(content: string, targetSize: number, maxSize: number): string[] {
  const sentences = splitIntoSentences(content);
  const subChunks: string[] = [];
  let current: string[] = [];
  let currentTokens = 0;
  
  for (const sentence of sentences) {
    const sentenceTokens = Math.ceil(sentence.length / 4);
    
    if (currentTokens + sentenceTokens > maxSize && current.length > 0) {
      subChunks.push(current.join(' '));
      current = [sentence];
      currentTokens = sentenceTokens;
    } else {
      current.push(sentence);
      currentTokens += sentenceTokens;
    }
  }
  
  if (current.length > 0) {
    subChunks.push(current.join(' '));
  }
  
  return subChunks;
}

export async function expandQuery(query: string): Promise<QueryExpansion> {
  const hydePrompt = `Genera un párrafo hipotético de documento académico/técnico que respondería perfectamente a esta pregunta. El párrafo debe ser informativo, preciso y contener terminología relevante:

Pregunta: ${query}

Documento hipotético:`;

  const subQueryPrompt = `Descompón esta pregunta en 2-4 sub-preguntas más específicas que ayudarían a responderla completamente:

Pregunta: ${query}

Sub-preguntas (una por línea):`;

  const filterPrompt = `Analiza esta pregunta y extrae filtros de metadatos implícitos.
Responde en JSON con estas posibles claves:
- sectionTypes: array de ["heading", "paragraph", "table", "code", "list", "figure"]
- hasTable: boolean si busca datos tabulares
- hasFigure: boolean si busca gráficos/imágenes
- pageRange: {start: number, end: number} si menciona páginas

Pregunta: ${query}

JSON:`;

  try {
    if (!genAI) throw new Error('GEMINI_API_KEY not configured');

    const [hydeResult, subQueryResult, filterResult] = await Promise.all([
      (genAI as any).models.generateContent({
        model: LLM_MODEL,
        contents: [{ role: 'user', parts: [{ text: hydePrompt }] }],
      }),
      (genAI as any).models.generateContent({
        model: LLM_MODEL,
        contents: [{ role: 'user', parts: [{ text: subQueryPrompt }] }],
      }),
      (genAI as any).models.generateContent({
        model: LLM_MODEL,
        contents: [{ role: 'user', parts: [{ text: filterPrompt }] }],
      })
    ]);
    
    const hypothetical = hydeResult.text || '';
    const subQueries = (subQueryResult.text || '')
      .split('\n')
      .map(s => s.replace(/^\d+\.\s*|-\s*/, '').trim())
      .filter(s => s.length > 10);
    
    let filters: MetadataFilters = {};
    try {
      const filterText = filterResult.text || '{}';
      const jsonMatch = filterText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        filters = JSON.parse(jsonMatch[0]);
      }
    } catch {
      filters = {};
    }
    
    const keywords = extractKeywords(query);
    
    return {
      original: query,
      hypothetical,
      subQueries,
      keywords,
      filters
    };
  } catch (error) {
    console.error('[AdvancedRAG] Query expansion error:', error);
    return {
      original: query,
      hypothetical: query,
      subQueries: [query],
      keywords: extractKeywords(query),
      filters: {}
    };
  }
}

function extractKeywords(text: string): string[] {
  const stopwords = new Set([
    'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'de', 'del', 'al', 'a', 'en', 'con', 'por', 'para',
    'the', 'a', 'an', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were',
    'que', 'qué', 'cómo', 'cuál', 'cuándo', 'dónde', 'what', 'how', 'which', 'when', 'where', 'why',
    'y', 'o', 'pero', 'and', 'or', 'but', 'es', 'son', 'está', 'están', 'ser', 'estar', 'tiene', 'tienen'
  ]);
  
  const words = text.toLowerCase()
    .replace(/[^\w\sáéíóúñü]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopwords.has(w));
  
  const frequency = new Map<string, number>();
  for (const word of words) {
    frequency.set(word, (frequency.get(word) || 0) + 1);
  }
  
  return Array.from(frequency.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([word]) => word);
}

function calculateBM25Score(
  query: string,
  document: string,
  avgDocLength: number,
  k1: number = 1.5,
  b: number = 0.75
): number {
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
    if (tf === 0) continue;
    
    const idf = Math.log(1 + 1 / (tf / docLength + 0.5));
    const tfNorm = (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (docLength / avgDocLength)));
    score += idf * tfNorm;
  }
  
  return score;
}

export async function hybridRetrieveAdvanced(
  query: string,
  fileIds: string[],
  expansion: QueryExpansion,
  options: {
    topK?: number;
    vectorWeight?: number;
    bm25Weight?: number;
    minScore?: number;
    filters?: MetadataFilters;
  } = {}
): Promise<RetrievedChunk[]> {
  const {
    topK = 10,
    vectorWeight = 0.6,
    bm25Weight = 0.4,
    minScore = 0.1,
    filters = expansion.filters
  } = options;
  
  const allChunks = await db
    .select()
    .from(fileChunks)
    .where(inArray(fileChunks.fileId, fileIds));
  
  if (allChunks.length === 0) {
    return [];
  }
  
  const avgDocLength = allChunks.reduce((sum, c) => sum + c.content.split(/\s+/).length, 0) / allChunks.length;
  
  const [queryEmbedding, hydeEmbedding] = await Promise.all([
    generateQueryEmbedding(query),
    expansion.hypothetical ? generateQueryEmbedding(expansion.hypothetical) : Promise.resolve(null)
  ]);
  
  const combinedEmbedding = hydeEmbedding
    ? queryEmbedding.map((v, i) => v * 0.6 + hydeEmbedding[i] * 0.4)
    : queryEmbedding;
  
  const scoredChunks: RetrievedChunk[] = allChunks.map(chunk => {
    const chunkEmbedding = chunk.embedding as number[] | null;
    
    let vectorScore = 0;
    if (chunkEmbedding && chunkEmbedding.length === combinedEmbedding.length) {
      vectorScore = cosineSimilarity(combinedEmbedding, chunkEmbedding);
    }
    
    const bm25Score = calculateBM25Score(query, chunk.content, avgDocLength);
    const normalizedBM25 = Math.min(bm25Score / 10, 1);
    
    const combinedScore = vectorWeight * vectorScore + bm25Weight * normalizedBM25;
    
    const metadata = (chunk.metadata as SemanticChunk['metadata']) || {
      sectionType: 'paragraph',
      hasTable: false,
      hasFigure: false,
      startSentence: 0,
      endSentence: 0,
      semanticDensity: 0.5,
      documentPosition: 0.5,
      hierarchy: []
    };
    
    return {
      id: chunk.id,
      fileId: chunk.fileId,
      content: chunk.content,
      pageNumber: chunk.pageNumber || undefined,
      sectionTitle: chunk.sectionTitle || undefined,
      metadata,
      score: combinedScore,
      bm25Score: normalizedBM25,
      vectorScore
    };
  });
  
  let filtered = scoredChunks.filter(c => c.score >= minScore);
  
  if (filters.sectionTypes && filters.sectionTypes.length > 0) {
    filtered = filtered.filter(c => filters.sectionTypes!.includes(c.metadata.sectionType));
  }
  if (filters.hasTable !== undefined) {
    filtered = filtered.filter(c => c.metadata.hasTable === filters.hasTable);
  }
  if (filters.hasFigure !== undefined) {
    filtered = filtered.filter(c => c.metadata.hasFigure === filters.hasFigure);
  }
  if (filters.pageRange && filters.pageRange.start !== undefined) {
    filtered = filtered.filter(c => 
      !c.pageNumber || (c.pageNumber >= filters.pageRange!.start && c.pageNumber <= filters.pageRange!.end)
    );
  }
  
  filtered.sort((a, b) => b.score - a.score);
  
  return filtered.slice(0, topK * 2);
}

async function generateQueryEmbedding(query: string): Promise<number[]> {
  const cacheKey = `query:${crypto.createHash('md5').update(query).digest('hex')}`;
  const cached = embeddingCache.get(cacheKey);
  if (cached) return cached;
  
  try {
    const result = await genAI.models.embedContent({
      model: EMBEDDING_MODEL,
      contents: [{ role: 'user', parts: [{ text: query }] }],
    });
    const embedding = result.embeddings?.[0]?.values || generateFallbackEmbedding(query);
    embeddingCache.set(cacheKey, embedding);
    return embedding;
  } catch (err) {
    console.error('[AdvancedRAG] Query embedding error:', err);
    return generateFallbackEmbedding(query);
  }
}

export async function crossEncoderRerank(
  query: string,
  chunks: RetrievedChunk[],
  topK: number = 5
): Promise<RetrievedChunk[]> {
  const rerankPrompt = `Eres un experto en relevancia de búsqueda. Evalúa qué tan relevante es cada pasaje para responder la pregunta.

Pregunta: ${query}

Evalúa cada pasaje del 0.0 a 1.0 donde 1.0 es perfectamente relevante.
Responde SOLO con números separados por comas, uno por cada pasaje.

${chunks.slice(0, 20).map((c, i) => `[Pasaje ${i + 1}]: ${c.content.slice(0, 300)}...`).join('\n\n')}

Puntuaciones (solo números separados por comas):`;

  try {
    if (!genAI) throw new Error('GEMINI_API_KEY not configured');

    const result = await (genAI as any).models.generateContent({
      model: LLM_MODEL,
      contents: [{ role: 'user', parts: [{ text: rerankPrompt }] }],
    });
    
    const scoreText = result.text || '';
    const scores = scoreText.match(/[\d.]+/g)?.map(Number) || [];
    
    const rerankedChunks = chunks.slice(0, 20).map((chunk, i) => ({
      ...chunk,
      rerankerScore: scores[i] || chunk.score,
      score: (chunk.score + (scores[i] || chunk.score)) / 2
    }));
    
    rerankedChunks.sort((a, b) => b.score - a.score);
    
    return applyMMRDiversification(rerankedChunks, topK);
  } catch (error) {
    console.error('[AdvancedRAG] Cross-encoder rerank error:', error);
    return chunks.slice(0, topK);
  }
}

function applyMMRDiversification(
  chunks: RetrievedChunk[],
  topK: number,
  lambda: number = 0.7
): RetrievedChunk[] {
  if (chunks.length === 0) return [];
  
  const selected: RetrievedChunk[] = [chunks[0]];
  const remaining = chunks.slice(1);
  
  while (selected.length < topK && remaining.length > 0) {
    let bestIdx = 0;
    let bestMMR = -Infinity;
    
    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i];
      const relevance = candidate.score;
      
      let maxSimilarity = 0;
      for (const sel of selected) {
        const sim = calculateTextSimilarity(candidate.content, sel.content);
        maxSimilarity = Math.max(maxSimilarity, sim);
      }
      
      const mmr = lambda * relevance - (1 - lambda) * maxSimilarity;
      
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

function calculateTextSimilarity(text1: string, text2: string): number {
  const words1 = new Set(text1.toLowerCase().split(/\s+/));
  const words2 = new Set(text2.toLowerCase().split(/\s+/));
  const intersection = new Set([...words1].filter(x => words2.has(x)));
  const union = new Set([...words1, ...words2]);
  return intersection.size / union.size;
}

export async function contextualCompression(
  query: string,
  chunks: RetrievedChunk[]
): Promise<RetrievedChunk[]> {
  const compressionPrompt = `Extrae SOLO las oraciones más relevantes de cada pasaje que ayuden a responder la pregunta. 
Mantén la información original sin modificar, solo selecciona las partes más importantes.

Pregunta: ${query}

${chunks.map((c, i) => `[Pasaje ${i + 1}]:\n${c.content}`).join('\n\n---\n\n')}

Para cada pasaje, devuelve SOLO las oraciones relevantes (mantén numeración):`;

  try {
    if (!genAI) throw new Error('GEMINI_API_KEY not configured');

    const result = await (genAI as any).models.generateContent({
      model: LLM_MODEL,
      contents: [{ role: 'user', parts: [{ text: compressionPrompt }] }],
    });
    
    const compressedText = result.text || '';
    const sections = compressedText.split(/\[Pasaje \d+\]/i).filter(s => s.trim());
    
    return chunks.map((chunk, i) => ({
      ...chunk,
      content: sections[i]?.trim() || chunk.content
    }));
  } catch (error) {
    console.error('[AdvancedRAG] Contextual compression error:', error);
    return chunks;
  }
}

export async function multiHopRetrieval(
  query: string,
  fileIds: string[],
  maxHops: number = 3
): Promise<{ chunks: RetrievedChunk[]; reasoning: string[] }> {
  const reasoning: string[] = [];
  let allChunks: RetrievedChunk[] = [];
  let currentQuery = query;
  
  for (let hop = 0; hop < maxHops; hop++) {
    reasoning.push(`Hop ${hop + 1}: Buscando "${currentQuery.slice(0, 100)}..."`);
    
    const expansion = await expandQuery(currentQuery);
    const chunks = await hybridRetrieveAdvanced(currentQuery, fileIds, expansion, { topK: 5 });
    
    if (chunks.length === 0) {
      reasoning.push(`Hop ${hop + 1}: No se encontraron resultados relevantes.`);
      break;
    }
    
    const newChunks = chunks.filter(c => !allChunks.some(ac => ac.id === c.id));
    allChunks.push(...newChunks);
    
    const needsMoreContext = await checkNeedsMoreContext(query, allChunks);
    
    if (!needsMoreContext.needsMore) {
      reasoning.push(`Hop ${hop + 1}: Contexto suficiente encontrado.`);
      break;
    }
    
    currentQuery = needsMoreContext.followupQuery;
    reasoning.push(`Hop ${hop + 1}: Se necesita más contexto sobre "${currentQuery.slice(0, 50)}..."`);
  }
  
  return { chunks: allChunks, reasoning };
}

async function checkNeedsMoreContext(
  originalQuery: string,
  currentChunks: RetrievedChunk[]
): Promise<{ needsMore: boolean; followupQuery: string }> {
  const checkPrompt = `Analiza si el contexto actual es suficiente para responder completamente la pregunta.

Pregunta original: ${originalQuery}

Contexto actual (resumen):
${currentChunks.slice(0, 5).map(c => c.content.slice(0, 200)).join('\n---\n')}

¿Se necesita buscar más información? Si es así, ¿qué pregunta de seguimiento ayudaría?

Responde en formato:
SUFICIENTE: [sí/no]
SEGUIMIENTO: [pregunta de seguimiento si es necesario, o "ninguno"]`;

  try {
    if (!genAI) throw new Error('GEMINI_API_KEY not configured');

    const result = await (genAI as any).models.generateContent({
      model: LLM_MODEL,
      contents: [{ role: 'user', parts: [{ text: checkPrompt }] }],
    });
    
    const response = result.text || '';
    const needsMore = !response.toLowerCase().includes('suficiente: sí');
    const followupMatch = response.match(/SEGUIMIENTO:\s*(.+)/i);
    const followupQuery = followupMatch?.[1]?.trim() || originalQuery;
    
    return { needsMore, followupQuery };
  } catch {
    return { needsMore: false, followupQuery: originalQuery };
  }
}

function generateSemanticHash(query: string): string {
  const normalized = query.toLowerCase()
    .replace(/[^\w\sáéíóúñü]/g, '')
    .split(/\s+/)
    .sort()
    .join(' ');
  return crypto.createHash('md5').update(normalized).digest('hex');
}

export function getCachedResult(query: string): CacheEntry | null {
  const queryHash = generateSemanticHash(query);
  const cached = semanticCache.get(queryHash);
  
  if (cached) {
    cached.hitCount++;
    semanticCache.set(queryHash, cached);
    return cached;
  }
  
  for (const [hash, entry] of semanticCache.entries()) {
    const similarity = calculateTextSimilarity(query, entry.result.chunks[0]?.content || '');
    if (similarity > 0.85) {
      entry.hitCount++;
      entry.similarQueries.push(query);
      semanticCache.set(hash, entry);
      return entry;
    }
  }
  
  return null;
}

export function setCacheResult(query: string, result: RAGResult): void {
  const queryHash = generateSemanticHash(query);
  const entry: CacheEntry = {
    queryHash,
    result,
    timestamp: Date.now(),
    hitCount: 1,
    similarQueries: [query]
  };
  semanticCache.set(queryHash, entry);
}

export async function generateAnswerWithCitations(
  query: string,
  chunks: RetrievedChunk[],
  options: {
    language?: 'es' | 'en';
    maxTokens?: number;
    includeFollowups?: boolean;
  } = {}
): Promise<{
  answer: string;
  citations: Citation[];
  suggestedFollowups: string[];
  confidence: number;
}> {
  const { language = 'es', maxTokens = 2000, includeFollowups = true } = options;
  
  const contextParts = chunks.map((c, i) => {
    const ref = c.pageNumber ? `[Fuente ${i + 1}, p.${c.pageNumber}]` : `[Fuente ${i + 1}]`;
    return `${ref}\n${c.content}`;
  });
  
  const systemPrompt = language === 'es'
    ? `Eres un asistente experto en análisis de documentos. Responde basándote ÚNICAMENTE en el contexto proporcionado.

REGLAS ESTRICTAS:
1. Cita tus fuentes usando [Fuente N] donde N es el número de la fuente
2. Si la información no está en el contexto, di "No encontré información sobre esto en el documento"
3. Sé preciso y conciso
4. Para datos numéricos o estadísticas, cita la fuente exacta`
    : `You are an expert document analysis assistant. Answer based ONLY on the provided context.

STRICT RULES:
1. Cite your sources using [Source N] where N is the source number
2. If information is not in context, say "I couldn't find information about this in the document"
3. Be precise and concise
4. For numerical data or statistics, cite the exact source`;

  const prompt = `${systemPrompt}

## Contexto del documento:
${contextParts.join('\n\n---\n\n')}

## Pregunta:
${query}

## Tu respuesta (con citas):`;

  try {
    if (!genAI) throw new Error('GEMINI_API_KEY not configured');

    const result = await (genAI as any).models.generateContent({
      model: LLM_MODEL,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    });
    
    const answer = result.text || 'No se pudo generar una respuesta.';
    
    const citationRefs = answer.match(/\[(?:Fuente|Source)\s*\d+(?:,\s*p\.\s*\d+)?\]/gi) || [];
    const citations: Citation[] = [];
    
    for (const ref of new Set(citationRefs)) {
      const numMatch = ref.match(/\d+/);
      if (numMatch) {
        const idx = parseInt(numMatch[0]) - 1;
        if (idx >= 0 && idx < chunks.length) {
          citations.push({
            text: chunks[idx].content.slice(0, 300),
            pageNumber: chunks[idx].pageNumber,
            sectionTitle: chunks[idx].sectionTitle,
            chunkId: chunks[idx].id,
            relevanceScore: chunks[idx].score,
            excerptStart: 0,
            excerptEnd: 300
          });
        }
      }
    }
    
    let suggestedFollowups: string[] = [];
    if (includeFollowups) {
      suggestedFollowups = await generateFollowupQuestions(query, answer, chunks);
    }
    
    const confidence = calculateAnswerConfidence(answer, citations, chunks);
    
    return { answer, citations, suggestedFollowups, confidence };
  } catch (error) {
    console.error('[AdvancedRAG] Generate answer error:', error);
    return {
      answer: 'Error al generar la respuesta.',
      citations: [],
      suggestedFollowups: [],
      confidence: 0
    };
  }
}

async function generateFollowupQuestions(
  query: string,
  answer: string,
  chunks: RetrievedChunk[]
): Promise<string[]> {
  const prompt = `Basándote en esta conversación sobre un documento, sugiere 3 preguntas de seguimiento relevantes que el usuario podría hacer.

Pregunta original: ${query}
Respuesta dada: ${answer.slice(0, 500)}

Genera 3 preguntas de seguimiento cortas y específicas (una por línea):`;

  try {
    if (!genAI) throw new Error('GEMINI_API_KEY not configured');

    const result = await (genAI as any).models.generateContent({
      model: LLM_MODEL,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    });
    
    return (result.text || '')
      .split('\n')
      .map(q => q.replace(/^\d+\.\s*|-\s*/, '').trim())
      .filter(q => q.length > 10)
      .slice(0, 3);
  } catch {
    return [];
  }
}

function calculateAnswerConfidence(
  answer: string,
  citations: Citation[],
  chunks: RetrievedChunk[]
): number {
  let confidence = 0.5;
  
  if (citations.length > 0) {
    confidence += 0.1 * Math.min(citations.length, 3);
  }
  
  const avgScore = chunks.reduce((sum, c) => sum + c.score, 0) / (chunks.length || 1);
  confidence += avgScore * 0.2;
  
  if (answer.includes('No encontré') || answer.includes("couldn't find")) {
    confidence -= 0.3;
  }
  
  if (answer.length > 200) {
    confidence += 0.1;
  }
  
  return Math.max(0, Math.min(1, confidence));
}

export async function fullRAGPipeline(
  query: string,
  fileIds: string[],
  options: {
    topK?: number;
    language?: 'es' | 'en';
    useMultiHop?: boolean;
    useCompression?: boolean;
    useCache?: boolean;
  } = {}
): Promise<RAGResult> {
  const {
    topK = 5,
    language = 'es',
    useMultiHop = false,
    useCompression = true,
    useCache = true
  } = options;
  
  if (useCache) {
    const cached = getCachedResult(query);
    if (cached) {
      console.log('[AdvancedRAG] Cache hit for query');
      return cached.result;
    }
  }
  
  const expansion = await expandQuery(query);
  console.log('[AdvancedRAG] Query expanded:', {
    subQueries: expansion.subQueries.length,
    keywords: expansion.keywords.length,
    hasFilters: Object.keys(expansion.filters).length > 0
  });
  
  let chunks: RetrievedChunk[];
  let reasoning: string[] = [];
  
  if (useMultiHop) {
    const multiHopResult = await multiHopRetrieval(query, fileIds);
    chunks = multiHopResult.chunks;
    reasoning = multiHopResult.reasoning;
  } else {
    chunks = await hybridRetrieveAdvanced(query, fileIds, expansion, { topK: topK * 2 });
    reasoning = ['Single-hop retrieval completed'];
  }
  
  chunks = await crossEncoderRerank(query, chunks, topK);
  reasoning.push(`Reranked to ${chunks.length} chunks`);
  
  if (useCompression) {
    chunks = await contextualCompression(query, chunks);
    reasoning.push('Applied contextual compression');
  }
  
  const { answer, citations, suggestedFollowups, confidence } = await generateAnswerWithCitations(
    query,
    chunks,
    { language, includeFollowups: true }
  );
  
  const tables = extractTablesFromChunks(chunks);
  
  const result: RAGResult = {
    chunks,
    answer,
    citations,
    confidence,
    reasoning,
    tables,
    suggestedFollowups
  };
  
  if (useCache) {
    setCacheResult(query, result);
  }
  
  return result;
}

function extractTablesFromChunks(chunks: RetrievedChunk[]): TableData[] {
  const tables: TableData[] = [];
  
  for (const chunk of chunks) {
    if (!chunk.metadata.hasTable) continue;
    
    const tableMatch = chunk.content.match(/\|[^\n]+\|[\s\S]*?\|[^\n]+\|/g);
    if (!tableMatch) continue;
    
    for (const tableText of tableMatch) {
      const lines = tableText.split('\n').filter(l => l.includes('|'));
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

export const advancedRAG = {
  advancedSemanticChunk,
  expandQuery,
  hybridRetrieveAdvanced,
  crossEncoderRerank,
  contextualCompression,
  multiHopRetrieval,
  generateAnswerWithCitations,
  fullRAGPipeline,
  getCachedResult,
  setCacheResult
};
