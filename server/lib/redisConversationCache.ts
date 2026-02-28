import Redis from "ioredis";
import { HydratedConversationState } from "@shared/schema";

const CACHE_TTL_SECONDS = 3600;
const CACHE_PREFIX = "conv:state:";

class RedisConversationCache {
  private client: Redis | null = null;
  private isConnected = false;
  private localCache = new Map<string, { data: HydratedConversationState; expiresAt: number }>();

  constructor() {
    this.initializeRedis();
  }

  private async initializeRedis() {
    if (process.env.NODE_ENV === "test" && process.env.ENABLE_REDIS_IN_TEST !== "true") {
      console.log("[RedisConversationCache] Skipping Redis in test environment (in-memory fallback)");
      return;
    }

    if (process.env.NODE_ENV !== "production") {
      console.log("[RedisConversationCache] Redis disabled in development (in-memory fallback)");
      return;
    }

    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      console.log("[RedisConversationCache] No REDIS_URL, using in-memory fallback");
      return;
    }

    try {
      this.client = new Redis(redisUrl, {
        maxRetriesPerRequest: 3,
        retryDelayOnFailover: 100,
        enableReadyCheck: true,
        lazyConnect: true,
      });

      this.client.on("connect", () => {
        console.log("[RedisConversationCache] Connected to Redis");
        this.isConnected = true;
      });

      this.client.on("error", (err) => {
        console.error("[RedisConversationCache] Redis error:", err.message);
        this.isConnected = false;
      });

      this.client.on("close", () => {
        console.log("[RedisConversationCache] Redis connection closed");
        this.isConnected = false;
      });

      await this.client.connect();
    } catch (error: any) {
      console.error("[RedisConversationCache] Failed to connect:", error.message);
      this.client = null;
    }
  }

  private getCacheKey(chatId: string, userId?: string): string {
    const userPart = userId ? `:u:${userId}` : "";
    return `${CACHE_PREFIX}${chatId}${userPart}`;
  }

  async get(chatId: string, userId?: string): Promise<HydratedConversationState | null> {
    const key = this.getCacheKey(chatId, userId);

    if (this.client && this.isConnected) {
      try {
        const cached = await this.client.get(key);
        if (cached) {
          console.log(`[RedisConversationCache] Cache HIT for ${chatId}`);
          return JSON.parse(cached);
        }
      } catch (error: any) {
        console.error("[RedisConversationCache] Get error:", error.message);
      }
    }

    const local = this.localCache.get(key);
    if (local && local.expiresAt > Date.now()) {
      console.log(`[RedisConversationCache] Local cache HIT for ${chatId}`);
      return local.data;
    }

    console.log(`[RedisConversationCache] Cache MISS for ${chatId}`);
    return null;
  }

  async set(
    chatId: string,
    state: HydratedConversationState,
    userId?: string,
    ttlSeconds: number = CACHE_TTL_SECONDS
  ): Promise<void> {
    const key = this.getCacheKey(chatId, userId);
    const serialized = JSON.stringify(state);

    this.localCache.set(key, {
      data: state,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });

    if (this.client && this.isConnected) {
      try {
        await this.client.setex(key, ttlSeconds, serialized);
        console.log(`[RedisConversationCache] Cached state for ${chatId} (TTL: ${ttlSeconds}s)`);
      } catch (error: any) {
        console.error("[RedisConversationCache] Set error:", error.message);
      }
    }
  }

  async invalidate(chatId: string, userId?: string): Promise<void> {
    const key = this.getCacheKey(chatId, userId);

    this.localCache.delete(key);

    if (this.client && this.isConnected) {
      try {
        await this.client.del(key);
        console.log(`[RedisConversationCache] Invalidated cache for ${chatId}`);
      } catch (error: any) {
        console.error("[RedisConversationCache] Invalidate error:", error.message);
      }
    }
  }

  async invalidateAll(chatId: string): Promise<void> {
    const pattern = `${CACHE_PREFIX}${chatId}*`;

    for (const key of this.localCache.keys()) {
      if (key.startsWith(`${CACHE_PREFIX}${chatId}`)) {
        this.localCache.delete(key);
      }
    }

    if (this.client && this.isConnected) {
      try {
        const keys = await this.client.keys(pattern);
        if (keys.length > 0) {
          await this.client.del(...keys);
          console.log(`[RedisConversationCache] Invalidated ${keys.length} keys for ${chatId}`);
        }
      } catch (error: any) {
        console.error("[RedisConversationCache] InvalidateAll error:", error.message);
      }
    }
  }

  async updatePartial(
    chatId: string,
    updater: (state: HydratedConversationState) => HydratedConversationState,
    userId?: string
  ): Promise<HydratedConversationState | null> {
    const current = await this.get(chatId, userId);
    if (!current) return null;

    const updated = updater(current);
    await this.set(chatId, updated, userId);
    return updated;
  }

  getStats(): { localSize: number; isRedisConnected: boolean } {
    return {
      localSize: this.localCache.size,
      isRedisConnected: this.isConnected,
    };
  }

  async cleanup(): Promise<void> {
    const now = Date.now();
    for (const [key, value] of this.localCache.entries()) {
      if (value.expiresAt < now) {
        this.localCache.delete(key);
      }
    }
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.client = null;
      this.isConnected = false;
    }
    this.localCache.clear();
  }
}

export const redisConversationCache = new RedisConversationCache();

setInterval(() => {
  redisConversationCache.cleanup();
}, 60000);
