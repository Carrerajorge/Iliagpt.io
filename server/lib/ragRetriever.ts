/**
 * RAGRetriever - Hybrid BM25 + Vector Search for Conversation Memory
 * Combines lexical (BM25) and semantic (Vector) search for optimal retrieval
 */

import { BM25Engine, VectorStore, Utils, BM25Stats, VectorStats } from './searchEngines';

export type DocumentType = 'message' | 'artifact' | 'image' | 'fact';

export interface IndexedMessage {
  messageId: string;
  content: string;
  role: string;
  metadata?: Record<string, unknown>;
}

export interface IndexedArtifact {
  artifactId: string;
  extractedText?: string;
  chunks?: Array<{ text: string; chunkId?: string }>;
  metadata?: Record<string, unknown>;
}

export interface IndexedImage {
  imageId: string;
  prompt: string;
  visionDescription?: string;
  metadata?: Record<string, unknown>;
}

export interface IndexedMemoryFact {
  factId: string;
  content: string;
  type: string;
  metadata?: Record<string, unknown>;
}

export interface SearchOptions {
  topK?: number;
  minScore?: number;
  hybridAlpha?: number;
  filterTypes?: DocumentType[];
}

export interface SearchResult {
  id: string;
  score: number;
  type: DocumentType;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface RAGStats {
  bm25Stats: BM25Stats;
  vectorStats: VectorStats;
  threadId: string;
}

interface DocumentRecord {
  id: string;
  type: DocumentType;
  content: string;
  metadata?: Record<string, unknown>;
}

export class RAGRetriever {
  private threadId: string;
  private bm25Engine: BM25Engine;
  private vectorStore: VectorStore;
  private documentRegistry: Map<string, DocumentRecord>;

  constructor(threadId: string, vectorDimension: number = 384) {
    this.threadId = threadId;
    this.bm25Engine = new BM25Engine();
    this.vectorStore = new VectorStore(vectorDimension);
    this.documentRegistry = new Map();
  }

  indexMessage(message: IndexedMessage): void {
    if (!message.content) return;

    const docId = `msg_${message.messageId}`;
    const metadata = {
      ...message.metadata,
      type: 'message' as DocumentType,
      messageId: message.messageId,
      role: message.role
    };

    this.bm25Engine.addDocument(docId, message.content, metadata);
    this.vectorStore.addDocument(docId, message.content, undefined, metadata);
    this.documentRegistry.set(docId, {
      id: docId,
      type: 'message',
      content: message.content,
      metadata
    });
  }

  indexArtifact(artifact: IndexedArtifact): void {
    const baseMetadata = {
      ...artifact.metadata,
      type: 'artifact' as DocumentType,
      artifactId: artifact.artifactId
    };

    if (artifact.chunks && artifact.chunks.length > 0) {
      for (let i = 0; i < artifact.chunks.length; i++) {
        const chunk = artifact.chunks[i];
        if (!chunk.text) continue;

        const chunkId = chunk.chunkId || `chunk_${i}`;
        const docId = `artifact_${artifact.artifactId}_${chunkId}`;
        const chunkMetadata = {
          ...baseMetadata,
          chunkId,
          chunkIndex: i
        };

        this.bm25Engine.addDocument(docId, chunk.text, chunkMetadata);
        this.vectorStore.addDocument(docId, chunk.text, undefined, chunkMetadata);
        this.documentRegistry.set(docId, {
          id: docId,
          type: 'artifact',
          content: chunk.text,
          metadata: chunkMetadata
        });
      }
    }

    if (artifact.extractedText) {
      const docId = `artifact_${artifact.artifactId}_full`;
      this.bm25Engine.addDocument(docId, artifact.extractedText, baseMetadata);
      this.vectorStore.addDocument(docId, artifact.extractedText, undefined, baseMetadata);
      this.documentRegistry.set(docId, {
        id: docId,
        type: 'artifact',
        content: artifact.extractedText,
        metadata: baseMetadata
      });
    }
  }

  indexImage(image: IndexedImage): void {
    const text = [image.prompt, image.visionDescription].filter(Boolean).join(' ').trim();
    if (!text) return;

    const docId = `img_${image.imageId}`;
    const metadata = {
      ...image.metadata,
      type: 'image' as DocumentType,
      imageId: image.imageId,
      prompt: image.prompt,
      visionDescription: image.visionDescription
    };

    this.bm25Engine.addDocument(docId, text, metadata);
    this.vectorStore.addDocument(docId, text, undefined, metadata);
    this.documentRegistry.set(docId, {
      id: docId,
      type: 'image',
      content: text,
      metadata
    });
  }

  indexMemoryFact(fact: IndexedMemoryFact): void {
    if (!fact.content) return;

    const docId = `fact_${fact.factId}`;
    const metadata = {
      ...fact.metadata,
      type: 'fact' as DocumentType,
      factId: fact.factId,
      factType: fact.type
    };

    this.bm25Engine.addDocument(docId, fact.content, metadata);
    this.vectorStore.addDocument(docId, fact.content, undefined, metadata);
    this.documentRegistry.set(docId, {
      id: docId,
      type: 'fact',
      content: fact.content,
      metadata
    });
  }

  search(query: string, options: SearchOptions = {}): SearchResult[] {
    const {
      topK = 10,
      minScore = 0,
      hybridAlpha = 0.5,
      filterTypes
    } = options;

    if (!query.trim()) return [];

    const bm25Results = this.bm25Engine.search(query, topK * 3);
    const vectorResults = this.vectorStore.searchByText(query, topK * 3, 0);

    const maxBM25Score = bm25Results.length > 0 
      ? Math.max(...bm25Results.map(r => r.score)) 
      : 1;

    const scoreMap = new Map<string, {
      bm25Score: number;
      vectorScore: number;
      document: DocumentRecord;
    }>();

    for (const result of bm25Results) {
      const doc = this.documentRegistry.get(result.id);
      if (!doc) continue;

      const normalizedBM25 = maxBM25Score > 0 ? result.score / maxBM25Score : 0;
      scoreMap.set(result.id, {
        bm25Score: normalizedBM25,
        vectorScore: 0,
        document: doc
      });
    }

    for (const result of vectorResults) {
      const doc = this.documentRegistry.get(result.id);
      if (!doc) continue;

      const existing = scoreMap.get(result.id);
      if (existing) {
        existing.vectorScore = result.score;
      } else {
        scoreMap.set(result.id, {
          bm25Score: 0,
          vectorScore: result.score,
          document: doc
        });
      }
    }

    const results: SearchResult[] = [];

    for (const [id, scores] of scoreMap) {
      const finalScore = hybridAlpha * scores.vectorScore + (1 - hybridAlpha) * scores.bm25Score;

      if (finalScore < minScore) continue;

      if (filterTypes && filterTypes.length > 0) {
        if (!filterTypes.includes(scores.document.type)) continue;
      }

      results.push({
        id,
        score: finalScore,
        type: scores.document.type,
        content: scores.document.content,
        metadata: scores.document.metadata
      });
    }

    results.sort((a, b) => b.score - a.score);

    return results.slice(0, topK);
  }

  removeDocument(id: string): void {
    this.bm25Engine.removeDocument(id);
    this.vectorStore.removeDocument(id);
    this.documentRegistry.delete(id);
  }

  clear(): void {
    this.bm25Engine.clear();
    this.vectorStore.clear();
    this.documentRegistry.clear();
  }

  getStats(): RAGStats {
    return {
      bm25Stats: this.bm25Engine.getStats(),
      vectorStats: this.vectorStore.getStats(),
      threadId: this.threadId
    };
  }
}
