import { createHash } from "crypto";

export interface StoredChunk {
  id: string;
  docId: string;
  filename: string;
  content: string;
  contentHash: string;
  location: {
    page?: number;
    sheet?: string;
    slide?: number;
    row?: number;
    cell?: string;
  };
  offsets: {
    start: number;
    end: number;
  };
  tokenEstimate: number;
  createdAt: number;
}

export interface DocumentIndex {
  docId: string;
  filename: string;
  totalChunks: number;
  uniqueLocations: Set<string>;
  addedAt: number;
}

export interface CoverageReport {
  totalDocuments: number;
  totalChunks: number;
  uniqueChunks: number;
  duplicatesRemoved: number;
  documents: Array<{
    docId: string;
    filename: string;
    chunkCount: number;
    locations: string[];
    hasCoverage: boolean;
  }>;
  coverageRate: number;
}

function computeContentHash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex").substring(0, 16);
}

function generateChunkId(docId: string, index: number): string {
  const timestamp = Date.now().toString(36);
  return `chunk_${docId.substring(0, 8)}_${index}_${timestamp}`;
}

function estimateTokens(content: string): number {
  return Math.ceil(content.length / 4);
}

function locationToKey(location: StoredChunk["location"]): string {
  const parts: string[] = [];
  if (location.page !== undefined) parts.push(`p${location.page}`);
  if (location.sheet) parts.push(`s:${location.sheet}`);
  if (location.slide !== undefined) parts.push(`sl${location.slide}`);
  if (location.row !== undefined) parts.push(`r${location.row}`);
  if (location.cell) parts.push(`c:${location.cell}`);
  return parts.join("_") || "default";
}

export class PareChunkStore {
  private chunks: Map<string, StoredChunk>;
  private documentIndex: Map<string, DocumentIndex>;
  private contentHashIndex: Set<string>;
  private duplicatesRemoved: number;
  private maxChunksPerDoc: number;

  constructor(options?: { maxChunksPerDoc?: number }) {
    this.chunks = new Map();
    this.documentIndex = new Map();
    this.contentHashIndex = new Set();
    this.duplicatesRemoved = 0;
    this.maxChunksPerDoc = options?.maxChunksPerDoc || 50;
  }

  addChunks(
    docId: string,
    filename: string,
    chunks: Array<{
      content: string;
      location?: StoredChunk["location"];
      offsets?: StoredChunk["offsets"];
    }>
  ): { added: number; duplicates: number; stored: StoredChunk[] } {
    let added = 0;
    let duplicates = 0;
    const stored: StoredChunk[] = [];

    let docIndex = this.documentIndex.get(docId);
    if (!docIndex) {
      docIndex = {
        docId,
        filename,
        totalChunks: 0,
        uniqueLocations: new Set(),
        addedAt: Date.now(),
      };
      this.documentIndex.set(docId, docIndex);
    }

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const contentHash = computeContentHash(chunk.content);

      if (this.contentHashIndex.has(contentHash)) {
        duplicates++;
        this.duplicatesRemoved++;
        continue;
      }

      const location = chunk.location || {};
      const offsets = chunk.offsets || { start: 0, end: chunk.content.length };

      const storedChunk: StoredChunk = {
        id: generateChunkId(docId, i),
        docId,
        filename,
        content: chunk.content,
        contentHash,
        location,
        offsets,
        tokenEstimate: estimateTokens(chunk.content),
        createdAt: Date.now(),
      };

      this.chunks.set(storedChunk.id, storedChunk);
      this.contentHashIndex.add(contentHash);
      
      const locationKey = locationToKey(location);
      docIndex.uniqueLocations.add(locationKey);
      docIndex.totalChunks++;

      stored.push(storedChunk);
      added++;
    }

    if (added === 0 && chunks.length > 0) {
      const firstChunk = chunks[0];
      const fallbackChunk: StoredChunk = {
        id: generateChunkId(docId, 0),
        docId,
        filename,
        content: firstChunk.content.substring(0, 500),
        contentHash: computeContentHash(firstChunk.content.substring(0, 500) + "_fallback"),
        location: firstChunk.location || {},
        offsets: { start: 0, end: Math.min(500, firstChunk.content.length) },
        tokenEstimate: estimateTokens(firstChunk.content.substring(0, 500)),
        createdAt: Date.now(),
      };

      this.chunks.set(fallbackChunk.id, fallbackChunk);
      this.contentHashIndex.add(fallbackChunk.contentHash);
      docIndex.totalChunks++;
      stored.push(fallbackChunk);
      added++;
    }

    return { added, duplicates, stored };
  }

  getChunks(docId: string): StoredChunk[] {
    const result: StoredChunk[] = [];
    for (const chunk of this.chunks.values()) {
      if (chunk.docId === docId) {
        result.push(chunk);
      }
    }
    return result.sort((a, b) => a.offsets.start - b.offsets.start);
  }

  getAllChunks(): StoredChunk[] {
    return Array.from(this.chunks.values());
  }

  getChunkById(chunkId: string): StoredChunk | undefined {
    return this.chunks.get(chunkId);
  }

  getDiverseSample(maxPerDoc?: number): StoredChunk[] {
    const limit = maxPerDoc || this.maxChunksPerDoc;
    const result: StoredChunk[] = [];
    const docChunks = new Map<string, StoredChunk[]>();

    for (const chunk of this.chunks.values()) {
      let arr = docChunks.get(chunk.docId);
      if (!arr) {
        arr = [];
        docChunks.set(chunk.docId, arr);
      }
      arr.push(chunk);
    }

    for (const [docId, chunks] of docChunks) {
      const sorted = chunks.sort((a, b) => a.offsets.start - b.offsets.start);
      
      if (sorted.length <= limit) {
        result.push(...sorted);
      } else {
        const step = sorted.length / limit;
        for (let i = 0; i < limit; i++) {
          const idx = Math.min(Math.floor(i * step), sorted.length - 1);
          result.push(sorted[idx]);
        }
      }
    }

    return result;
  }

  getCoverageReport(): CoverageReport {
    const documents: CoverageReport["documents"] = [];
    let totalChunks = 0;

    for (const [docId, index] of this.documentIndex) {
      const chunks = this.getChunks(docId);
      totalChunks += chunks.length;

      documents.push({
        docId,
        filename: index.filename,
        chunkCount: chunks.length,
        locations: Array.from(index.uniqueLocations),
        hasCoverage: chunks.length > 0,
      });
    }

    const documentsWithCoverage = documents.filter(d => d.hasCoverage).length;
    const coverageRate = documents.length > 0 
      ? documentsWithCoverage / documents.length 
      : 1;

    return {
      totalDocuments: this.documentIndex.size,
      totalChunks,
      uniqueChunks: this.chunks.size,
      duplicatesRemoved: this.duplicatesRemoved,
      documents,
      coverageRate,
    };
  }

  hasDocument(docId: string): boolean {
    return this.documentIndex.has(docId);
  }

  removeDocument(docId: string): number {
    const index = this.documentIndex.get(docId);
    if (!index) return 0;

    let removed = 0;
    for (const [chunkId, chunk] of this.chunks) {
      if (chunk.docId === docId) {
        this.contentHashIndex.delete(chunk.contentHash);
        this.chunks.delete(chunkId);
        removed++;
      }
    }

    this.documentIndex.delete(docId);
    return removed;
  }

  clear(): void {
    this.chunks.clear();
    this.documentIndex.clear();
    this.contentHashIndex.clear();
    this.duplicatesRemoved = 0;
  }

  getStats(): {
    totalDocuments: number;
    totalChunks: number;
    duplicatesRemoved: number;
    memoryEstimateBytes: number;
  } {
    let memoryEstimate = 0;
    for (const chunk of this.chunks.values()) {
      memoryEstimate += chunk.content.length * 2;
      memoryEstimate += 200;
    }

    return {
      totalDocuments: this.documentIndex.size,
      totalChunks: this.chunks.size,
      duplicatesRemoved: this.duplicatesRemoved,
      memoryEstimateBytes: memoryEstimate,
    };
  }
}

export function createChunkStore(options?: { maxChunksPerDoc?: number }): PareChunkStore {
  return new PareChunkStore(options);
}
