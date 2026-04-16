import { LRUCache } from "lru-cache";
import crypto from "crypto";

interface CachedResponse {
  response: string;
  timestamp: number;
  hitCount: number;
  model: string;
  tokens: number;
}

interface CacheStats {
  hits: number;
  misses: number;
  size: number;
  hitRate: number;
}

class SemanticResponseCache {
  private exactCache: LRUCache<string, CachedResponse>;
  private normalizedCache: LRUCache<string, CachedResponse>;
  private stats = { hits: 0, misses: 0 };
  private readonly TTL = 3600000;

  constructor() {
    this.exactCache = new LRUCache<string, CachedResponse>({
      max: 1000,
      ttl: this.TTL,
    });

    this.normalizedCache = new LRUCache<string, CachedResponse>({
      max: 5000,
      ttl: this.TTL,
    });
  }

  private hashPrompt(prompt: string): string {
    return crypto.createHash("sha256").update(prompt).digest("hex").slice(0, 16);
  }

  private normalizePrompt(prompt: string): string {
    return prompt
      .toLowerCase()
      .trim()
      .replace(/\s+/g, " ")
      .replace(/[¿?!¡.,;:]+/g, "")
      .replace(/\b(el|la|los|las|un|una|unos|unas|de|del|en|a|the|a|an)\b/g, "")
      .trim();
  }

  private extractKeywords(prompt: string): string[] {
    const normalized = this.normalizePrompt(prompt);
    const words = normalized.split(/\s+/).filter(w => w.length > 2);
    return [...new Set(words)].sort();
  }

  get(prompt: string, model?: string): CachedResponse | null {
    const exactKey = this.hashPrompt(prompt);
    const exactMatch = this.exactCache.get(exactKey);
    
    if (exactMatch && (!model || exactMatch.model === model)) {
      this.stats.hits++;
      exactMatch.hitCount++;
      return exactMatch;
    }

    const normalizedKey = this.hashPrompt(this.normalizePrompt(prompt));
    const normalizedMatch = this.normalizedCache.get(normalizedKey);
    
    if (normalizedMatch && (!model || normalizedMatch.model === model)) {
      this.stats.hits++;
      normalizedMatch.hitCount++;
      return normalizedMatch;
    }

    this.stats.misses++;
    return null;
  }

  set(prompt: string, response: string, model: string, tokens: number): void {
    const exactKey = this.hashPrompt(prompt);
    const normalizedKey = this.hashPrompt(this.normalizePrompt(prompt));

    const cached: CachedResponse = {
      response,
      timestamp: Date.now(),
      hitCount: 0,
      model,
      tokens,
    };

    this.exactCache.set(exactKey, cached);
    this.normalizedCache.set(normalizedKey, cached);
  }

  shouldCache(prompt: string, response: string): boolean {
    if (prompt.length < 10) return false;
    if (response.length < 50) return false;
    
    const timePatterns = [
      /\b(hoy|ahora|actual|current|today|now|latest)\b/i,
      /\b(2024|2025|2026)\b/,
      /\b(ayer|yesterday|last week|la semana pasada)\b/i,
    ];
    
    if (timePatterns.some(p => p.test(prompt))) {
      return false;
    }

    const personalPatterns = [
      /\b(mi|my|yo|i am|tengo|i have)\b/i,
      /\b(tu|your|usted)\b/i,
    ];
    
    if (personalPatterns.some(p => p.test(prompt))) {
      return false;
    }

    return true;
  }

  getStats(): CacheStats {
    const total = this.stats.hits + this.stats.misses;
    return {
      hits: this.stats.hits,
      misses: this.stats.misses,
      size: this.exactCache.size + this.normalizedCache.size,
      hitRate: total > 0 ? this.stats.hits / total : 0,
    };
  }

  clear(): void {
    this.exactCache.clear();
    this.normalizedCache.clear();
    this.stats = { hits: 0, misses: 0 };
  }

  prune(): void {
    this.exactCache.purgeStale();
    this.normalizedCache.purgeStale();
  }
}

export const semanticResponseCache = new SemanticResponseCache();

export default semanticResponseCache;
