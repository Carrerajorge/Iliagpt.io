import { LRUCache } from "lru-cache";
import type { IntentResult } from "../../../shared/schemas/intent";
import { logStructured } from "./telemetry";

const CACHE_MAX_SIZE = 50000;
const SIMILARITY_THRESHOLD = 0.95;
const CACHE_TTL_MS = 1000 * 60 * 60 * 2;

interface SemanticCacheEntry {
  embedding: number[];
  result: IntentResult;
  timestamp: number;
  hits: number;
}

interface SemanticCacheStats {
  hits: number;
  misses: number;
  size: number;
  maxSize: number;
  hitRate: number;
  avgHitsPerEntry: number;
  similarityThreshold: number;
}

const cache = new LRUCache<string, SemanticCacheEntry>({
  max: CACHE_MAX_SIZE,
  ttl: CACHE_TTL_MS,
  updateAgeOnGet: true,
  allowStale: false,
  dispose: (entry, key) => {
    embeddingIndex.delete(key);
  }
});

const embeddingIndex = new Map<string, number[]>();

let cacheHits = 0;
let cacheMisses = 0;

function generateBucketKey(embedding: number[]): string {
  const buckets: number[] = [];
  const step = Math.floor(embedding.length / 8);
  
  for (let i = 0; i < 8; i++) {
    let sum = 0;
    const start = i * step;
    const end = Math.min(start + step, embedding.length);
    
    for (let j = start; j < end; j++) {
      sum += embedding[j];
    }
    
    buckets.push(Math.floor(sum * 10));
  }
  
  return buckets.join("_");
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

function findNearestNeighbors(
  queryEmbedding: number[], 
  candidateKeys: string[],
  k: number = 5
): Array<{ key: string; similarity: number }> {
  const results: Array<{ key: string; similarity: number }> = [];
  
  for (const key of candidateKeys) {
    const cachedEmbedding = embeddingIndex.get(key);
    if (!cachedEmbedding) continue;
    
    const similarity = cosineSimilarity(queryEmbedding, cachedEmbedding);
    results.push({ key, similarity });
  }
  
  results.sort((a, b) => b.similarity - a.similarity);
  return results.slice(0, k);
}

export function getSemanticCacheHit(
  embedding: number[]
): { result: IntentResult; similarity: number } | null {
  const bucketKey = generateBucketKey(embedding);
  
  const candidateKeys: string[] = [];
  for (const [key] of embeddingIndex) {
    const entry = cache.get(key);
    if (entry) {
      const entryBucket = generateBucketKey(entry.embedding);
      const bucketDistance = Math.abs(
        parseInt(bucketKey.split("_")[0] || "0") - 
        parseInt(entryBucket.split("_")[0] || "0")
      );
      
      if (bucketDistance <= 5) {
        candidateKeys.push(key);
      }
    }
  }
  
  if (candidateKeys.length === 0) {
    const allKeys = Array.from(embeddingIndex.keys());
    const sampleSize = Math.min(100, allKeys.length);
    for (let i = 0; i < sampleSize; i++) {
      const randomIdx = Math.floor(Math.random() * allKeys.length);
      candidateKeys.push(allKeys[randomIdx]);
    }
  }
  
  const neighbors = findNearestNeighbors(embedding, candidateKeys, 3);
  
  for (const { key, similarity } of neighbors) {
    if (similarity >= SIMILARITY_THRESHOLD) {
      const entry = cache.get(key);
      if (entry) {
        entry.hits++;
        cacheHits++;
        
        logStructured("info", "Semantic cache hit", {
          similarity: similarity.toFixed(4),
          intent: entry.result.intent,
          cache_entry_hits: entry.hits
        });
        
        return {
          result: { ...entry.result, cache_hit: true },
          similarity
        };
      }
    }
  }
  
  cacheMisses++;
  return null;
}

export function setSemanticCache(
  embedding: number[],
  result: IntentResult
): void {
  const key = `sem_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  
  const entry: SemanticCacheEntry = {
    embedding,
    result: { ...result, cache_hit: false },
    timestamp: Date.now(),
    hits: 0
  };
  
  cache.set(key, entry);
  embeddingIndex.set(key, embedding);
  
  logStructured("info", "Semantic cache entry added", {
    key,
    intent: result.intent,
    cache_size: cache.size
  });
}

export function getSemanticCacheStats(): SemanticCacheStats {
  const total = cacheHits + cacheMisses;
  let totalHits = 0;
  
  for (const [, entry] of cache.entries()) {
    totalHits += entry.hits;
  }
  
  return {
    hits: cacheHits,
    misses: cacheMisses,
    size: cache.size,
    maxSize: CACHE_MAX_SIZE,
    hitRate: total > 0 ? cacheHits / total : 0,
    avgHitsPerEntry: cache.size > 0 ? totalHits / cache.size : 0,
    similarityThreshold: SIMILARITY_THRESHOLD
  };
}

export function clearSemanticCache(): void {
  cache.clear();
  embeddingIndex.clear();
  cacheHits = 0;
  cacheMisses = 0;
  
  logStructured("info", "Semantic cache cleared", {});
}

export function pruneSemanticCache(maxAge: number = CACHE_TTL_MS / 2): number {
  const now = Date.now();
  let pruned = 0;
  
  for (const [key, entry] of cache.entries()) {
    if (now - entry.timestamp > maxAge && entry.hits === 0) {
      cache.delete(key);
      embeddingIndex.delete(key);
      pruned++;
    }
  }
  
  if (pruned > 0) {
    logStructured("info", "Semantic cache pruned", {
      pruned_entries: pruned,
      remaining_entries: cache.size
    });
  }
  
  return pruned;
}

export function getHotSemanticEntries(limit: number = 10): Array<{
  intent: string;
  hits: number;
  age_ms: number;
}> {
  const entries: Array<{
    intent: string;
    hits: number;
    age_ms: number;
  }> = [];
  
  const now = Date.now();
  
  for (const [, entry] of cache.entries()) {
    entries.push({
      intent: entry.result.intent,
      hits: entry.hits,
      age_ms: now - entry.timestamp
    });
  }
  
  return entries.sort((a, b) => b.hits - a.hits).slice(0, limit);
}

export function warmSemanticCache(
  examples: Array<{ embedding: number[]; result: IntentResult }>
): number {
  let warmed = 0;
  
  for (const { embedding, result } of examples) {
    setSemanticCache(embedding, result);
    warmed++;
  }
  
  logStructured("info", "Semantic cache warmed", {
    entries_added: warmed
  });
  
  return warmed;
}
