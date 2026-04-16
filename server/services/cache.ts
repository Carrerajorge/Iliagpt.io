import Redis from "ioredis";
import { ICacheService } from "../lib/interfaces";
import { Logger } from "../lib/logger";

export class RedisCacheService implements ICacheService {
    private client: Redis | null = null;

    constructor() {
        const isTestEnv = process.env.NODE_ENV === "test";
        const allowRedisInTests = process.env.REDIS_ENABLE_IN_TESTS === "1" || process.env.REDIS_ENABLE_IN_TESTS === "true";
        // In tests, default to no-op mode unless explicitly enabled.
        // This prevents noisy connection errors when a local Redis is not running but REDIS_URL/HOST are present in .env.
        if (isTestEnv && !allowRedisInTests) {
            Logger.info("[RedisCacheService] Redis disabled in test env (set REDIS_ENABLE_IN_TESTS=1 to enable)");
            return;
        }

        // Only initialize Redis if REDIS_URL is configured
        if (!process.env.REDIS_URL && !process.env.REDIS_HOST) {
            Logger.info('[RedisCacheService] No Redis configured, running in no-op mode');
            return;
        }

        // Use REDIS_URL directly if available (Docker/production), otherwise use host/port
        if (process.env.REDIS_URL) {
            this.client = new Redis(process.env.REDIS_URL, {
                keyPrefix: 'cache:',
            });
        } else {
            this.client = new Redis({
                host: process.env.REDIS_HOST || 'localhost',
                port: parseInt(process.env.REDIS_PORT || '6379'),
                password: process.env.REDIS_PASSWORD || undefined,
                keyPrefix: 'cache:',
            });
        }

        this.client.on('error', (err) => {
            Logger.error('Redis Cache Error', err);
        });
    }

    async get<T>(key: string): Promise<T | null> {
        if (!this.client) return null;
        try {
            const data = await this.client.get(key);
            if (!data) return null;
            return JSON.parse(data) as T;
        } catch (error) {
            Logger.error(`Cache Get Error (${key})`, error);
            return null;
        }
    }

    async set<T>(key: string, value: T, ttlSeconds: number = 300): Promise<void> {
        if (!this.client) return;
        try {
            const data = JSON.stringify(value);
            await this.client.setex(key, ttlSeconds, data);
        } catch (error) {
            Logger.error(`Cache Set Error (${key})`, error);
        }
    }

    async del(key: string): Promise<void> {
        if (!this.client) return;
        try {
            await this.client.del(key);
        } catch (error) {
            Logger.error(`Cache Del Error (${key})`, error);
        }
    }
}

// Singleton
let cacheInstance: RedisCacheService | null = null;

export function getCacheService(): ICacheService {
    if (!cacheInstance) {
        cacheInstance = new RedisCacheService();
    }
    return cacheInstance;
}

export const cacheService = {
    getCacheService
};
