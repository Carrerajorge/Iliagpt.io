/**
 * Response Cache Service
 * 
 * Caché inteligente para respuestas de chat.
 * Reduce latencia de respuestas simples de ~1500ms a <50ms.
 */

import crypto from 'crypto';

interface CachedResponse {
  content: string;
  role: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
  };
  cachedAt: number;
  hits: number;
}

interface CacheStats {
  hits: number;
  misses: number;
  size: number;
  hitRate: string;
}

class ResponseCache {
  private cache: Map<string, CachedResponse> = new Map();
  private stats = { hits: 0, misses: 0 };
  
  // Configuration
  private readonly TTL = 5 * 60 * 1000; // 5 minutes
  private readonly MAX_SIZE = 1000; // Max cached responses
  private readonly MAX_MESSAGE_LENGTH = 100; // Only cache short messages
  
  // Patterns that should be cached (simple greetings, common questions)
  private readonly CACHEABLE_PATTERNS = [
    /^hola$/i,
    /^hola[,!.]?\s*(cómo estás|como estas)?[?!]?$/i,
    /^hi$/i,
    /^hello$/i,
    /^hey$/i,
    /^buenos?\s*(días|dias|tardes|noches)$/i,
    /^good\s*(morning|afternoon|evening|night)$/i,
    /^thanks?$/i,
    /^gracias$/i,
    /^ok(ay)?$/i,
    /^bye$/i,
    /^adiós$/i,
    /^chao$/i,
  ];
  
  /**
   * Generate cache key from message
   */
  private generateKey(message: string, model?: string): string {
    const normalized = message.toLowerCase().trim();
    const hash = crypto.createHash('md5')
      .update(`${normalized}:${model || 'default'}`)
      .digest('hex');
    return hash;
  }
  
  /**
   * Check if message is cacheable
   */
  isCacheable(message: string): boolean {
    if (!message || message.length > this.MAX_MESSAGE_LENGTH) {
      return false;
    }
    
    const normalized = message.trim();
    return this.CACHEABLE_PATTERNS.some(pattern => pattern.test(normalized));
  }
  
  /**
   * Get cached response
   */
  get(message: string, model?: string): CachedResponse | null {
    if (!this.isCacheable(message)) {
      return null;
    }
    
    const key = this.generateKey(message, model);
    const cached = this.cache.get(key);
    
    if (!cached) {
      this.stats.misses++;
      return null;
    }
    
    // Check TTL
    if (Date.now() - cached.cachedAt > this.TTL) {
      this.cache.delete(key);
      this.stats.misses++;
      return null;
    }
    
    // Update stats
    cached.hits++;
    this.stats.hits++;
    
    console.log(`[Cache] HIT for "${message.substring(0, 30)}..." (${cached.hits} hits)`);
    
    return cached;
  }
  
  /**
   * Store response in cache
   */
  set(message: string, response: { content: string; role: string; usage?: any }, model?: string): void {
    if (!this.isCacheable(message)) {
      return;
    }
    
    // Enforce max size (LRU-like: remove oldest)
    if (this.cache.size >= this.MAX_SIZE) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }
    
    const key = this.generateKey(message, model);
    
    this.cache.set(key, {
      content: response.content,
      role: response.role || 'assistant',
      usage: response.usage || { promptTokens: 0, completionTokens: 0 },
      cachedAt: Date.now(),
      hits: 0
    });
    
    console.log(`[Cache] STORED "${message.substring(0, 30)}..."`);
  }
  
  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    const total = this.stats.hits + this.stats.misses;
    return {
      hits: this.stats.hits,
      misses: this.stats.misses,
      size: this.cache.size,
      hitRate: total > 0 ? ((this.stats.hits / total) * 100).toFixed(1) + '%' : '0%'
    };
  }
  
  /**
   * Clear cache
   */
  clear(): void {
    this.cache.clear();
    this.stats = { hits: 0, misses: 0 };
    console.log('[Cache] Cleared');
  }
  
  /**
   * Pre-warm cache with common responses
   */
  warmUp(): void {
    const commonResponses: Array<{ message: string; response: string }> = [
      { message: 'hola', response: '¡Hola! ¿En qué puedo ayudarte?' },
      { message: 'hola, cómo estás?', response: '¡Hola! Estoy muy bien, gracias por preguntar. ¿En qué puedo ayudarte hoy?' },
      { message: 'hi', response: 'Hi! How can I help you?' },
      { message: 'hello', response: 'Hello! How can I assist you today?' },
      { message: 'buenos días', response: '¡Buenos días! ¿En qué puedo ayudarte?' },
      { message: 'buenas tardes', response: '¡Buenas tardes! ¿En qué puedo ayudarte?' },
      { message: 'buenas noches', response: '¡Buenas noches! ¿En qué puedo ayudarte?' },
      { message: 'gracias', response: '¡De nada! Si necesitas algo más, aquí estoy.' },
      { message: 'thanks', response: "You're welcome! Let me know if you need anything else." },
      { message: 'ok', response: '¿Hay algo más en lo que pueda ayudarte?' },
      { message: 'bye', response: '¡Hasta luego! Que tengas un excelente día.' },
      { message: 'adiós', response: '¡Adiós! Fue un placer ayudarte.' },
    ];
    
    for (const { message, response } of commonResponses) {
      this.set(message, { content: response, role: 'assistant' });
    }
    
    console.log(`[Cache] Warmed up with ${commonResponses.length} responses`);
  }
}

// Singleton instance
export const responseCache = new ResponseCache();

// Warm up on import
responseCache.warmUp();

export default responseCache;
