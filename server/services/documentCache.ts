/**
 * Document Cache - ILIAGPT PRO 3.0 (10x Enhanced)
 * 
 * Multi-layer caching for processed documents.
 * Supports TTL, LRU eviction, and cache warming.
 */

import { LRUCache } from "lru-cache";

// ============== Types ==============

export interface CachedDocument {
    id: string;
    originalName: string;
    hash: string;
    content: string;
    chunks: CachedChunk[];
    embeddings?: number[][];
    metadata: DocumentCacheMetadata;
    cachedAt: Date;
    accessCount: number;
    lastAccessedAt: Date;
}

export interface CachedChunk {
    id: string;
    content: string;
    embedding?: number[];
    position: number;
}

export interface DocumentCacheMetadata {
    fileType: string;
    size: number;
    wordCount: number;
    pageCount?: number;
    language?: string;
    quality?: number;
    processingTimeMs: number;
}

export interface CacheConfig {
    maxDocuments?: number;
    maxChunks?: number;
    maxEmbeddings?: number;
    documentTTL?: number;
    chunkTTL?: number;
    embeddingTTL?: number;
    enablePersistence?: boolean;
}

export interface CacheStats {
    documentCount: number;
    chunkCount: number;
    embeddingCount: number;
    hitRate: number;
    memoryUsage: number;
    oldestDocument: Date | null;
}

// ============== Hash Function ==============

function simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash |= 0;
    }
    return Math.abs(hash).toString(16);
}

function generateDocumentHash(content: string, fileName: string): string {
    return `doc_${simpleHash(fileName + content.slice(0, 1000) + content.length)}`;
}

function generateChunkHash(content: string, position: number): string {
    return `chunk_${simpleHash(content.slice(0, 200) + position)}`;
}

// ============== Document Cache ==============

export class DocumentCache {
    private documents: LRUCache<string, CachedDocument>;
    private chunks: LRUCache<string, CachedChunk>;
    private embeddings: LRUCache<string, number[]>;
    private hashToId: Map<string, string> = new Map();
    private hits = 0;
    private misses = 0;

    constructor(config: CacheConfig = {}) {
        const {
            maxDocuments = 500,
            maxChunks = 10000,
            maxEmbeddings = 50000,
            documentTTL = 1000 * 60 * 60 * 24, // 24 hours
            chunkTTL = 1000 * 60 * 60 * 12,    // 12 hours
            embeddingTTL = 1000 * 60 * 60 * 48, // 48 hours
        } = config;

        this.documents = new LRUCache({
            max: maxDocuments,
            ttl: documentTTL,
            updateAgeOnGet: true,
            dispose: (value, key) => this.onDocumentEvicted(key, value),
        });

        this.chunks = new LRUCache({
            max: maxChunks,
            ttl: chunkTTL,
            updateAgeOnGet: true,
        });

        this.embeddings = new LRUCache({
            max: maxEmbeddings,
            ttl: embeddingTTL,
            updateAgeOnGet: true,
        });
    }

    // ======== Document Operations ========

    /**
     * Check if document exists in cache
     */
    hasDocument(content: string, fileName: string): boolean {
        const hash = generateDocumentHash(content, fileName);
        const exists = this.hashToId.has(hash);

        if (exists) {
            this.hits++;
        } else {
            this.misses++;
        }

        return exists;
    }

    /**
     * Get cached document
     */
    getDocument(content: string, fileName: string): CachedDocument | null {
        const hash = generateDocumentHash(content, fileName);
        const id = this.hashToId.get(hash);

        if (!id) {
            this.misses++;
            return null;
        }

        const doc = this.documents.get(id);
        if (!doc) {
            this.hashToId.delete(hash);
            this.misses++;
            return null;
        }

        this.hits++;
        doc.accessCount++;
        doc.lastAccessedAt = new Date();

        return doc;
    }

    /**
     * Get document by ID
     */
    getDocumentById(id: string): CachedDocument | null {
        const doc = this.documents.get(id);
        if (doc) {
            this.hits++;
            doc.accessCount++;
            doc.lastAccessedAt = new Date();
        } else {
            this.misses++;
        }
        return doc || null;
    }

    /**
     * Cache a processed document
     */
    setDocument(
        id: string,
        originalName: string,
        content: string,
        chunks: CachedChunk[],
        metadata: DocumentCacheMetadata,
        embeddings?: number[][]
    ): void {
        const hash = generateDocumentHash(content, originalName);

        const cachedDoc: CachedDocument = {
            id,
            originalName,
            hash,
            content,
            chunks,
            embeddings,
            metadata,
            cachedAt: new Date(),
            accessCount: 1,
            lastAccessedAt: new Date(),
        };

        this.documents.set(id, cachedDoc);
        this.hashToId.set(hash, id);

        // Also cache chunks individually
        for (const chunk of chunks) {
            this.chunks.set(chunk.id, chunk);
            if (chunk.embedding) {
                this.embeddings.set(chunk.id, chunk.embedding);
            }
        }

        // Cache embeddings if provided
        if (embeddings) {
            chunks.forEach((chunk, i) => {
                if (embeddings[i]) {
                    this.embeddings.set(chunk.id, embeddings[i]);
                }
            });
        }
    }

    /**
     * Delete cached document
     */
    deleteDocument(id: string): boolean {
        const doc = this.documents.get(id);
        if (!doc) return false;

        // Remove hash mapping
        this.hashToId.delete(doc.hash);

        // Remove chunks and embeddings
        for (const chunk of doc.chunks) {
            this.chunks.delete(chunk.id);
            this.embeddings.delete(chunk.id);
        }

        this.documents.delete(id);
        return true;
    }

    // ======== Chunk Operations ========

    /**
     * Get cached chunk
     */
    getChunk(chunkId: string): CachedChunk | null {
        const chunk = this.chunks.get(chunkId);
        if (chunk) {
            this.hits++;
        } else {
            this.misses++;
        }
        return chunk || null;
    }

    /**
     * Get chunks by document ID
     */
    getChunksByDocument(documentId: string): CachedChunk[] {
        const doc = this.documents.get(documentId);
        return doc?.chunks || [];
    }

    /**
     * Update chunk embedding
     */
    setChunkEmbedding(chunkId: string, embedding: number[]): void {
        this.embeddings.set(chunkId, embedding);

        const chunk = this.chunks.get(chunkId);
        if (chunk) {
            chunk.embedding = embedding;
        }
    }

    // ======== Embedding Operations ========

    /**
     * Get cached embedding
     */
    getEmbedding(chunkId: string): number[] | null {
        const embedding = this.embeddings.get(chunkId);
        if (embedding) {
            this.hits++;
        } else {
            this.misses++;
        }
        return embedding || null;
    }

    /**
     * Batch get embeddings
     */
    getEmbeddingsBatch(chunkIds: string[]): (number[] | null)[] {
        return chunkIds.map(id => this.getEmbedding(id));
    }

    /**
     * Cache embeddings in batch
     */
    setEmbeddingsBatch(embeddings: { chunkId: string; embedding: number[] }[]): void {
        for (const { chunkId, embedding } of embeddings) {
            this.setChunkEmbedding(chunkId, embedding);
        }
    }

    // ======== Cache Warming ========

    /**
     * Pre-warm cache with popular documents
     */
    async warmCache(
        loader: (id: string) => Promise<CachedDocument | null>,
        documentIds: string[]
    ): Promise<number> {
        let warmed = 0;

        for (const id of documentIds) {
            if (!this.documents.has(id)) {
                const doc = await loader(id);
                if (doc) {
                    this.setDocument(
                        doc.id,
                        doc.originalName,
                        doc.content,
                        doc.chunks,
                        doc.metadata,
                        doc.embeddings
                    );
                    warmed++;
                }
            }
        }

        return warmed;
    }

    // ======== Statistics ========

    /**
     * Get cache statistics
     */
    getStats(): CacheStats {
        const total = this.hits + this.misses;
        let oldestDoc: Date | null = null;

        for (const doc of this.documents.values()) {
            if (!oldestDoc || doc.cachedAt < oldestDoc) {
                oldestDoc = doc.cachedAt;
            }
        }

        return {
            documentCount: this.documents.size,
            chunkCount: this.chunks.size,
            embeddingCount: this.embeddings.size,
            hitRate: total > 0 ? this.hits / total : 0,
            memoryUsage: this.estimateMemoryUsage(),
            oldestDocument: oldestDoc,
        };
    }

    private estimateMemoryUsage(): number {
        let bytes = 0;

        for (const doc of this.documents.values()) {
            bytes += doc.content.length * 2; // UTF-16
            bytes += JSON.stringify(doc.metadata).length;
        }

        for (const chunk of this.chunks.values()) {
            bytes += chunk.content.length * 2;
        }

        bytes += this.embeddings.size * 768 * 4; // float32

        return bytes;
    }

    /**
     * Reset statistics
     */
    resetStats(): void {
        this.hits = 0;
        this.misses = 0;
    }

    // ======== Cache Management ========

    /**
     * Clear all caches
     */
    clear(): void {
        this.documents.clear();
        this.chunks.clear();
        this.embeddings.clear();
        this.hashToId.clear();
        this.resetStats();
    }

    /**
     * Remove expired entries
     */
    prune(): number {
        const before = this.documents.size + this.chunks.size + this.embeddings.size;

        this.documents.purgeStale();
        this.chunks.purgeStale();
        this.embeddings.purgeStale();

        const after = this.documents.size + this.chunks.size + this.embeddings.size;
        return before - after;
    }

    private onDocumentEvicted(key: string, doc: CachedDocument): void {
        // Cleanup hash mapping
        this.hashToId.delete(doc.hash);

        // Cleanup chunks and embeddings
        for (const chunk of doc.chunks) {
            this.chunks.delete(chunk.id);
            this.embeddings.delete(chunk.id);
        }
    }
}

// ============== Singleton ==============

let cacheInstance: DocumentCache | null = null;

export function getDocumentCache(config?: CacheConfig): DocumentCache {
    if (!cacheInstance) {
        cacheInstance = new DocumentCache(config);
    }
    return cacheInstance;
}

export default DocumentCache;
