/**
 * EmbeddingIndex: Approximate Nearest-Neighbor search for embedding vectors.
 *
 * Uses a flat (brute-force) scan for small indices and a simplified bucket-based
 * locality-sensitive hashing (LSH) approach for larger ones.
 * Supports persistence to/from Redis for warm restarts.
 *
 * Improvement 11 – Edge Caching for LLM Responses
 */

import Redis from "ioredis";
import { Logger } from "../lib/logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface IndexEntry {
  id: string;
  embedding: number[];
  metadata: any;
}

interface SearchResult {
  id: string;
  score: number;
  metadata: any;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FLAT_THRESHOLD = 200; // use flat search below this count
const LSH_NUM_PLANES = 16; // random hyperplanes per hash function
const LSH_NUM_TABLES = 4; // number of independent hash tables
const REDIS_SNAPSHOT_TTL = 3600 * 24; // 24 hours

// ---------------------------------------------------------------------------
// LSH Table
// ---------------------------------------------------------------------------

class LSHTable {
  private planes: number[][];
  private buckets: Map<string, Set<number>> = new Map();

  constructor(dim: number, numPlanes: number) {
    // Random hyperplanes (normal distribution approximated via Box-Muller)
    this.planes = Array.from({ length: numPlanes }, () =>
      EmbeddingIndex.randomUnitVector(dim)
    );
  }

  hash(embedding: number[]): string {
    const bits = this.planes.map((plane) => {
      const dot = plane.reduce((sum, v, i) => sum + v * (embedding[i] ?? 0), 0);
      return dot >= 0 ? "1" : "0";
    });
    return bits.join("");
  }

  add(idx: number, embedding: number[]): void {
    const h = this.hash(embedding);
    if (!this.buckets.has(h)) this.buckets.set(h, new Set());
    this.buckets.get(h)!.add(idx);
  }

  remove(idx: number, embedding: number[]): void {
    const h = this.hash(embedding);
    this.buckets.get(h)?.delete(idx);
  }

  getCandidates(embedding: number[]): Set<number> {
    const h = this.hash(embedding);
    return this.buckets.get(h) ?? new Set();
  }

  clear(): void {
    this.buckets.clear();
  }
}

// ---------------------------------------------------------------------------
// EmbeddingIndex
// ---------------------------------------------------------------------------

export class EmbeddingIndex {
  private entries: IndexEntry[] = [];
  private idToIndex: Map<string, number> = new Map();
  private maxSize: number;
  private lshTables: LSHTable[] = [];
  private dim: number | null = null;

  constructor(maxSize = 1000) {
    this.maxSize = maxSize;
  }

  // -------------------------------------------------------------------------
  // Mutation
  // -------------------------------------------------------------------------

  add(id: string, embedding: number[], metadata?: any): void {
    if (this.idToIndex.has(id)) {
      // Update existing entry
      const idx = this.idToIndex.get(id)!;
      const old = this.entries[idx];
      // Remove from LSH tables
      for (const table of this.lshTables) {
        table.remove(idx, old.embedding);
      }
      this.entries[idx] = { id, embedding, metadata };
      for (const table of this.lshTables) {
        table.add(idx, embedding);
      }
      return;
    }

    // Enforce max size by removing the oldest entry
    if (this.entries.length >= this.maxSize) {
      const evicted = this.entries[0];
      this.idToIndex.delete(evicted.id);
      this.entries.shift();
      // Rebuild index map since indices shifted
      this.rebuildIdMap();
      // Rebuild LSH tables fully (cheap for typical sizes)
      this.rebuildLSH();
    }

    // Initialise LSH tables lazily based on embedding dimension
    if (this.dim === null && embedding.length > 0) {
      this.dim = embedding.length;
      this.lshTables = Array.from(
        { length: LSH_NUM_TABLES },
        () => new LSHTable(this.dim!, LSH_NUM_PLANES)
      );
    }

    const idx = this.entries.length;
    this.entries.push({ id, embedding, metadata });
    this.idToIndex.set(id, idx);

    for (const table of this.lshTables) {
      table.add(idx, embedding);
    }
  }

  remove(id: string): boolean {
    const idx = this.idToIndex.get(id);
    if (idx === undefined) return false;

    const entry = this.entries[idx];

    for (const table of this.lshTables) {
      table.remove(idx, entry.embedding);
    }

    // Mark as deleted (tombstone) – rebuild on next search if too fragmented
    this.entries.splice(idx, 1);
    this.idToIndex.delete(id);
    this.rebuildIdMap();
    this.rebuildLSH();

    return true;
  }

  clear(): void {
    this.entries = [];
    this.idToIndex.clear();
    for (const table of this.lshTables) {
      table.clear();
    }
  }

  // -------------------------------------------------------------------------
  // Search
  // -------------------------------------------------------------------------

  search(
    queryEmbedding: number[],
    k = 5,
    threshold = 0.0
  ): SearchResult[] {
    if (this.entries.length === 0) return [];

    let candidates: number[];

    if (this.entries.length <= FLAT_THRESHOLD || this.lshTables.length === 0) {
      // Flat search – examine all entries
      candidates = this.entries.map((_, i) => i);
    } else {
      // LSH candidate retrieval – union across all tables
      const candidateSet = new Set<number>();
      for (const table of this.lshTables) {
        for (const idx of table.getCandidates(queryEmbedding)) {
          candidateSet.add(idx);
        }
      }

      // If LSH returns too few candidates, fall back to flat search
      if (candidateSet.size < k) {
        candidates = this.entries.map((_, i) => i);
      } else {
        candidates = Array.from(candidateSet);
      }
    }

    // Score candidates
    const scored: SearchResult[] = candidates
      .filter((idx) => idx < this.entries.length)
      .map((idx) => {
        const entry = this.entries[idx];
        const score = this.cosineSimilarity(queryEmbedding, entry.embedding);
        return { id: entry.id, score, metadata: entry.metadata };
      })
      .filter((r) => r.score >= threshold);

    // Sort descending by score and return top k
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k);
  }

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  async saveToRedis(redis: Redis, key: string): Promise<void> {
    try {
      const snapshot = JSON.stringify({
        entries: this.entries,
        maxSize: this.maxSize,
        dim: this.dim,
        savedAt: new Date().toISOString(),
      });
      await redis.set(key, snapshot, "EX", REDIS_SNAPSHOT_TTL);
      Logger.info("EmbeddingIndex.saveToRedis", { key, entries: this.entries.length });
    } catch (err) {
      Logger.error("EmbeddingIndex.saveToRedis error", err);
    }
  }

  async loadFromRedis(redis: Redis, key: string): Promise<void> {
    try {
      const raw = await redis.get(key);
      if (!raw) return;

      const snapshot = JSON.parse(raw) as {
        entries: IndexEntry[];
        maxSize: number;
        dim: number | null;
      };

      this.clear();
      this.maxSize = snapshot.maxSize;
      this.dim = snapshot.dim;

      if (this.dim) {
        this.lshTables = Array.from(
          { length: LSH_NUM_TABLES },
          () => new LSHTable(this.dim!, LSH_NUM_PLANES)
        );
      }

      for (const entry of snapshot.entries) {
        this.add(entry.id, entry.embedding, entry.metadata);
      }

      Logger.info("EmbeddingIndex.loadFromRedis", {
        key,
        entries: this.entries.length,
      });
    } catch (err) {
      Logger.error("EmbeddingIndex.loadFromRedis error", err);
    }
  }

  // -------------------------------------------------------------------------
  // Accessors
  // -------------------------------------------------------------------------

  getSize(): number {
    return this.entries.length;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private cosineSimilarity(a: number[], b: number[]): number {
    const len = Math.min(a.length, b.length);
    if (len === 0) return 0;

    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < len; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom > 0 ? dot / denom : 0;
  }

  private rebuildIdMap(): void {
    this.idToIndex.clear();
    for (let i = 0; i < this.entries.length; i++) {
      this.idToIndex.set(this.entries[i].id, i);
    }
  }

  private rebuildLSH(): void {
    if (!this.dim) return;
    for (const table of this.lshTables) {
      table.clear();
    }
    for (let i = 0; i < this.entries.length; i++) {
      for (const table of this.lshTables) {
        table.add(i, this.entries[i].embedding);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Static helpers (also used by LSHTable)
  // -------------------------------------------------------------------------

  static randomUnitVector(dim: number): number[] {
    // Box-Muller transform for Gaussian samples
    const v: number[] = [];
    for (let i = 0; i < dim; i += 2) {
      const u1 = Math.random() || 1e-10;
      const u2 = Math.random();
      const mag = Math.sqrt(-2 * Math.log(u1));
      v.push(mag * Math.cos(2 * Math.PI * u2));
      if (i + 1 < dim) {
        v.push(mag * Math.sin(2 * Math.PI * u2));
      }
    }
    // L2-normalise
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    return norm > 0 ? v.map((x) => x / norm) : v;
  }
}
