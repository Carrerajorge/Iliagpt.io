/**
 * Search Engines for Conversation Memory System
 * - Utils: Common utilities for text processing and embeddings
 * - BM25Engine: BM25 full-text search engine
 * - VectorStore: Vector similarity search store
 */

export interface DocumentEntry {
  id: string;
  tokens: string[];
  originalText: string;
  metadata: Record<string, unknown>;
}

export interface VectorDocument {
  id: string;
  embedding: number[];
  text: string;
  metadata: Record<string, unknown>;
}

export interface SearchResult {
  id: string;
  score: number;
  document: DocumentEntry | VectorDocument;
}

export interface BM25Stats {
  documentCount: number;
  uniqueTerms: number;
  avgDocLength: number;
}

export interface VectorStats {
  documentCount: number;
  dimension: number;
}

export class Utils {
  static readonly STOP_WORDS: Set<string> = new Set([
    // Spanish
    'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'de', 'del', 'al', 'y', 'o', 'que',
    'en', 'es', 'por', 'con', 'para', 'se', 'su', 'sus', 'como', 'pero', 'más', 'este', 'esta',
    'estos', 'estas', 'ese', 'esa', 'esos', 'esas', 'aquel', 'aquella', 'aquellos', 'aquellas',
    'lo', 'le', 'les', 'me', 'te', 'nos', 'os', 'mi', 'tu', 'yo', 'él', 'ella', 'nosotros',
    'ellos', 'ellas', 'ustedes', 'vosotros', 'qué', 'cuál', 'quién', 'cómo', 'dónde', 'cuándo',
    'sin', 'sobre', 'entre', 'hasta', 'desde', 'hacia', 'durante', 'según', 'tras', 'mediante',
    // English
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
    'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'shall',
    'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through',
    'during', 'before', 'after', 'above', 'below', 'between', 'under', 'again', 'further',
    'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each', 'few',
    'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same',
    'so', 'than', 'too', 'very', 'just', 'can', 'now', 'this', 'that', 'these', 'those',
    'and', 'but', 'if', 'or', 'because', 'until', 'while', 'although', 'though', 'since',
    'it', 'its', 'you', 'your', 'we', 'our', 'they', 'their', 'he', 'his', 'she', 'her',
    'i', 'me', 'my', 'myself', 'what', 'which', 'who', 'whom', 'whose'
  ]);

  static estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  static tokenize(text: string): string[] {
    if (!text) return [];
    return text
      .toLowerCase()
      .replace(/[^\w\sáéíóúñüàèìòùâêîôûäëïöü]/g, ' ')
      .split(/\s+/)
      .filter(token => token.length > 2)
      .filter(token => !this.STOP_WORDS.has(token));
  }

  static generateSimpleEmbedding(text: string, dimension: number = 384): number[] {
    const tokens = this.tokenize(text);
    const embedding = new Array<number>(dimension).fill(0);

    for (let i = 0; i < tokens.length; i++) {
      const hash = this.simpleHash(tokens[i]);
      for (let j = 0; j < dimension; j++) {
        embedding[j] += Math.sin(hash * (j + 1)) / tokens.length;
      }
    }

    const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    return magnitude > 0 ? embedding.map(v => v / magnitude) : embedding;
  }

  static cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let magnitudeA = 0;
    let magnitudeB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      magnitudeA += a[i] * a[i];
      magnitudeB += b[i] * b[i];
    }

    const magnitude = Math.sqrt(magnitudeA) * Math.sqrt(magnitudeB);
    return magnitude > 0 ? dotProduct / magnitude : 0;
  }

  static chunkText(text: string, chunkSize: number = 512, overlap: number = 50): string[] {
    if (!text) return [];

    const words = text.split(/\s+/);
    const chunks: string[] = [];
    let currentChunk: string[] = [];
    let currentTokens = 0;

    for (const word of words) {
      const wordTokens = this.estimateTokens(word);

      if (currentTokens + wordTokens > chunkSize && currentChunk.length > 0) {
        chunks.push(currentChunk.join(' '));
        const overlapWords = Math.floor(overlap / 4);
        currentChunk = currentChunk.slice(-overlapWords);
        currentTokens = this.estimateTokens(currentChunk.join(' '));
      }

      currentChunk.push(word);
      currentTokens += wordTokens;
    }

    if (currentChunk.length > 0) {
      chunks.push(currentChunk.join(' '));
    }

    return chunks;
  }

  private static simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash;
  }
}

export class BM25Engine {
  private documents: Map<string, DocumentEntry> = new Map();
  private documentFrequency: Map<string, number> = new Map();
  private averageDocLength: number = 0;
  private readonly k1: number = 1.5;
  private readonly b: number = 0.75;

  addDocument(id: string, text: string, metadata: Record<string, unknown> = {}): void {
    const tokens = Utils.tokenize(text);
    const uniqueTokens = new Set(tokens);

    for (const token of uniqueTokens) {
      this.documentFrequency.set(token, (this.documentFrequency.get(token) || 0) + 1);
    }

    this.documents.set(id, { id, tokens, originalText: text, metadata });
    this.updateAverageDocLength();
  }

  removeDocument(id: string): void {
    const doc = this.documents.get(id);
    if (!doc) return;

    const uniqueTokens = new Set(doc.tokens);
    for (const token of uniqueTokens) {
      const freq = this.documentFrequency.get(token) || 0;
      if (freq <= 1) {
        this.documentFrequency.delete(token);
      } else {
        this.documentFrequency.set(token, freq - 1);
      }
    }

    this.documents.delete(id);
    this.updateAverageDocLength();
  }

  search(query: string, topK: number = 10): SearchResult[] {
    const queryTokens = Utils.tokenize(query);
    if (queryTokens.length === 0) return [];

    const scores: Array<{ id: string; score: number }> = [];
    const N = this.documents.size;

    for (const [docId, doc] of this.documents) {
      let score = 0;

      for (const queryToken of queryTokens) {
        const tf = doc.tokens.filter(t => t === queryToken).length;
        if (tf === 0) continue;

        const df = this.documentFrequency.get(queryToken) || 0;
        const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);
        const docLength = doc.tokens.length;
        const numerator = tf * (this.k1 + 1);
        const denominator = tf + this.k1 * (1 - this.b + this.b * (docLength / this.averageDocLength));

        score += idf * (numerator / denominator);
      }

      if (score > 0) {
        scores.push({ id: docId, score });
      }
    }

    scores.sort((a, b) => b.score - a.score);

    return scores.slice(0, topK).map(s => ({
      id: s.id,
      score: s.score,
      document: this.documents.get(s.id)!
    }));
  }

  clear(): void {
    this.documents.clear();
    this.documentFrequency.clear();
    this.averageDocLength = 0;
  }

  getStats(): BM25Stats {
    return {
      documentCount: this.documents.size,
      uniqueTerms: this.documentFrequency.size,
      avgDocLength: this.averageDocLength
    };
  }

  private updateAverageDocLength(): void {
    if (this.documents.size === 0) {
      this.averageDocLength = 0;
      return;
    }

    let totalLength = 0;
    for (const doc of this.documents.values()) {
      totalLength += doc.tokens.length;
    }
    this.averageDocLength = totalLength / this.documents.size;
  }
}

export class VectorStore {
  private documents: Map<string, VectorDocument> = new Map();
  private readonly dimension: number;

  constructor(dimension: number = 384) {
    this.dimension = dimension;
  }

  addDocument(
    id: string,
    text: string,
    embedding?: number[],
    metadata: Record<string, unknown> = {}
  ): void {
    const finalEmbedding = embedding || Utils.generateSimpleEmbedding(text, this.dimension);
    this.documents.set(id, { id, embedding: finalEmbedding, text, metadata });
  }

  removeDocument(id: string): void {
    this.documents.delete(id);
  }

  search(
    queryEmbedding: number[],
    topK: number = 10,
    minScore: number = 0
  ): SearchResult[] {
    const results: SearchResult[] = [];

    for (const doc of this.documents.values()) {
      const score = Utils.cosineSimilarity(queryEmbedding, doc.embedding);
      if (score >= minScore) {
        results.push({ id: doc.id, score, document: doc });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  searchByText(
    query: string,
    topK: number = 10,
    minScore: number = 0
  ): SearchResult[] {
    const queryEmbedding = Utils.generateSimpleEmbedding(query, this.dimension);
    return this.search(queryEmbedding, topK, minScore);
  }

  clear(): void {
    this.documents.clear();
  }

  getStats(): VectorStats {
    return {
      documentCount: this.documents.size,
      dimension: this.dimension
    };
  }
}
