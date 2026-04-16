import { LRUCache } from "lru-cache";
import { createHash } from "crypto";
import type { IntentResult, ROUTER_VERSION } from "../../../shared/schemas/intent";

interface CacheEntry {
  result: IntentResult;
  timestamp: number;
  hits: number;
}

interface CacheStats {
  hits: number;
  misses: number;
  size: number;
  maxSize: number;
  hitRate: number;
}

const cache = new LRUCache<string, CacheEntry>({
  max: 10000,
  ttl: 1000 * 60 * 60,
  updateAgeOnGet: true,
  allowStale: false
});

let cacheHits = 0;
let cacheMisses = 0;

function generateCacheKey(
  normalizedText: string,
  routerVersion: string
): string {
  const combined = `${routerVersion}:${normalizedText}`;
  return createHash("sha256").update(combined).digest("hex").substring(0, 32);
}

export function getCached(
  normalizedText: string,
  routerVersion: string
): IntentResult | null {
  const key = generateCacheKey(normalizedText, routerVersion);
  const entry = cache.get(key);

  if (entry) {
    cacheHits++;
    entry.hits++;
    return { ...entry.result, cache_hit: true };
  }

  cacheMisses++;
  return null;
}

export function setCached(
  normalizedText: string,
  routerVersion: string,
  result: IntentResult
): void {
  const key = generateCacheKey(normalizedText, routerVersion);
  
  cache.set(key, {
    result: { ...result, cache_hit: false },
    timestamp: Date.now(),
    hits: 0
  });
}

export function invalidateCache(): void {
  cache.clear();
  cacheHits = 0;
  cacheMisses = 0;
  console.log("[IntentRouter] Cache invalidated");
}

export function getCacheStats(): CacheStats {
  const total = cacheHits + cacheMisses;
  return {
    hits: cacheHits,
    misses: cacheMisses,
    size: cache.size,
    maxSize: 10000,
    hitRate: total > 0 ? cacheHits / total : 0
  };
}

export function warmCache(
  examples: Array<{ text: string; result: IntentResult }>,
  routerVersion: string
): number {
  let warmed = 0;
  
  for (const { text, result } of examples) {
    const normalized = text.toLowerCase().trim();
    setCached(normalized, routerVersion, result);
    warmed++;
  }
  
  console.log(`[IntentRouter] Cache warmed with ${warmed} entries`);
  return warmed;
}

export function pruneCache(maxAge: number = 1000 * 60 * 30): number {
  const now = Date.now();
  let pruned = 0;
  
  for (const [key, entry] of cache.entries()) {
    if (now - entry.timestamp > maxAge && entry.hits === 0) {
      cache.delete(key);
      pruned++;
    }
  }
  
  console.log(`[IntentRouter] Pruned ${pruned} stale cache entries`);
  return pruned;
}

export function getHotEntries(limit: number = 10): Array<{ key: string; hits: number }> {
  const entries: Array<{ key: string; hits: number }> = [];
  
  for (const [key, entry] of cache.entries()) {
    entries.push({ key, hits: entry.hits });
  }
  
  return entries.sort((a, b) => b.hits - a.hits).slice(0, limit);
}
