import crypto from "crypto";
import bcrypt from "bcrypt";
import type { Request, Response, NextFunction, RequestHandler } from "express";
import Redis from "ioredis";
import { Logger } from "../lib/logger";

// ─── Types ────────────────────────────────────────────────────────────────────

export type APIScope =
  | "read:chats"
  | "write:chats"
  | "read:documents"
  | "write:documents"
  | "execute:agents"
  | "manage:settings"
  | "admin";

export interface APIKey {
  id: string;
  keyHash: string;
  prefix: string;
  userId: string;
  name: string;
  scopes: APIScope[];
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  usageCount: number;
  rateLimit: number;       // requests per minute
  status: "active" | "revoked" | "expired";
  createdAt: Date;
}

export interface KeyOptions {
  expiresAt?: Date;
  rateLimit?: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
  limit: number;
}

export interface KeyUsageStats {
  keyId: string;
  period: string;
  totalRequests: number;
  endpoints: Record<string, number>;
  lastUsedAt: Date | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const KEY_STORE_PREFIX = "apikey:";
const USER_KEYS_PREFIX = "apikey:user:";
const RATE_LIMIT_PREFIX = "apikey:rl:";
const USAGE_PREFIX = "apikey:usage:";
const BCRYPT_ROUNDS = 10;
const DEFAULT_RATE_LIMIT = 60;  // requests per minute

// ─── APIKeyManager ────────────────────────────────────────────────────────────

class APIKeyManager {
  private redis: Redis;

  constructor() {
    this.redis = new Redis(process.env.REDIS_URL || "redis://127.0.0.1:6379", {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => Math.min(times * 50, 2000),
    });
    this.redis.on("error", (err: Error) => {
      Logger.warn("[APIKeyManager] Redis error", { error: err.message });
    });
  }

  // ── Create ───────────────────────────────────────────────────────────────────

  async createKey(
    userId: string,
    name: string,
    scopes: APIScope[],
    options: KeyOptions = {}
  ): Promise<{ key: APIKey; rawKey: string }> {
    const rawKey = this.generateRawKey();
    const keyHash = await this.hashKey(rawKey);
    const prefix = rawKey.slice(0, 12); // "sk-iliagXXXX"

    const key: APIKey = {
      id: crypto.randomUUID(),
      keyHash,
      prefix,
      userId,
      name,
      scopes,
      expiresAt: options.expiresAt ?? null,
      lastUsedAt: null,
      usageCount: 0,
      rateLimit: options.rateLimit ?? DEFAULT_RATE_LIMIT,
      status: "active",
      createdAt: new Date(),
    };

    // Store in Redis
    await this.redis.set(`${KEY_STORE_PREFIX}${key.id}`, JSON.stringify(key));
    // Index by user
    await this.redis.sadd(`${USER_KEYS_PREFIX}${userId}`, key.id);
    // Also store a lookup index from prefix -> id for fast lookups during validation
    // We can't index by full hash, so prefix + brute-force small user set
    await this.redis.set(`${KEY_STORE_PREFIX}prefix:${prefix}`, key.id);

    Logger.info("[APIKeyManager] Key created", { keyId: key.id, userId, name, scopes });

    return { key, rawKey };
  }

  // ── Validate ─────────────────────────────────────────────────────────────────

  async validateKey(rawKey: string): Promise<APIKey | null> {
    if (!rawKey || rawKey.length < 12) return null;

    const prefix = rawKey.slice(0, 12);
    const keyId = await this.redis.get(`${KEY_STORE_PREFIX}prefix:${prefix}`);
    if (!keyId) return null;

    const raw = await this.redis.get(`${KEY_STORE_PREFIX}${keyId}`);
    if (!raw) return null;

    const key: APIKey = JSON.parse(raw);

    if (key.status !== "active") return null;
    if (key.expiresAt && new Date(key.expiresAt) < new Date()) {
      key.status = "expired";
      await this.redis.set(`${KEY_STORE_PREFIX}${key.id}`, JSON.stringify(key));
      return null;
    }

    const valid = await bcrypt.compare(rawKey, key.keyHash);
    if (!valid) return null;

    // Update usage
    key.lastUsedAt = new Date();
    key.usageCount++;
    await this.redis.set(`${KEY_STORE_PREFIX}${key.id}`, JSON.stringify(key));

    return key;
  }

  // ── Revoke ───────────────────────────────────────────────────────────────────

  async revokeKey(keyId: string, userId: string): Promise<void> {
    const raw = await this.redis.get(`${KEY_STORE_PREFIX}${keyId}`);
    if (!raw) throw new Error("Key not found");

    const key: APIKey = JSON.parse(raw);
    if (key.userId !== userId) throw new Error("Key does not belong to user");

    key.status = "revoked";
    await this.redis.set(`${KEY_STORE_PREFIX}${key.id}`, JSON.stringify(key));
    await this.redis.del(`${KEY_STORE_PREFIX}prefix:${key.prefix}`);

    Logger.security("[APIKeyManager] Key revoked", { keyId, userId });
  }

  // ── List ─────────────────────────────────────────────────────────────────────

  async listKeys(userId: string): Promise<APIKey[]> {
    const keyIds = await this.redis.smembers(`${USER_KEYS_PREFIX}${userId}`);
    const keys: APIKey[] = [];

    for (const id of keyIds) {
      const raw = await this.redis.get(`${KEY_STORE_PREFIX}${id}`);
      if (raw) {
        const key: APIKey = JSON.parse(raw);
        // Omit keyHash from listing for security
        keys.push({ ...key, keyHash: "[redacted]" });
      }
    }

    return keys;
  }

  // ── Rotate ───────────────────────────────────────────────────────────────────

  async rotateKey(keyId: string, userId: string): Promise<{ key: APIKey; rawKey: string }> {
    const raw = await this.redis.get(`${KEY_STORE_PREFIX}${keyId}`);
    if (!raw) throw new Error("Key not found");

    const oldKey: APIKey = JSON.parse(raw);
    if (oldKey.userId !== userId) throw new Error("Key does not belong to user");

    // Revoke old
    await this.revokeKey(keyId, userId);

    // Create new with same settings
    return this.createKey(userId, `${oldKey.name} (rotated)`, oldKey.scopes, {
      expiresAt: oldKey.expiresAt ?? undefined,
      rateLimit: oldKey.rateLimit,
    });
  }

  // ── Rate limiting ─────────────────────────────────────────────────────────────

  async checkRateLimit(keyId: string): Promise<RateLimitResult> {
    const raw = await this.redis.get(`${KEY_STORE_PREFIX}${keyId}`);
    if (!raw) return { allowed: false, remaining: 0, resetAt: new Date(), limit: 0 };

    const key: APIKey = JSON.parse(raw);
    const windowKey = `${RATE_LIMIT_PREFIX}${keyId}:${Math.floor(Date.now() / 60000)}`;

    const count = await this.redis.incr(windowKey);
    if (count === 1) {
      await this.redis.expire(windowKey, 60);
    }

    const resetAt = new Date((Math.floor(Date.now() / 60000) + 1) * 60000);
    const allowed = count <= key.rateLimit;

    if (!allowed) {
      Logger.warn("[APIKeyManager] Rate limit exceeded", { keyId, count, limit: key.rateLimit });
    }

    return {
      allowed,
      remaining: Math.max(0, key.rateLimit - count),
      resetAt,
      limit: key.rateLimit,
    };
  }

  // ── Usage tracking ────────────────────────────────────────────────────────────

  async trackUsage(keyId: string, endpoint: string): Promise<void> {
    const day = new Date().toISOString().slice(0, 10);
    const usageKey = `${USAGE_PREFIX}${keyId}:${day}`;
    const endpointKey = `${USAGE_PREFIX}${keyId}:endpoint:${endpoint}:${day}`;

    await this.redis.incr(usageKey);
    await this.redis.expire(usageKey, 90 * 24 * 3600); // 90 days
    await this.redis.incr(endpointKey);
    await this.redis.expire(endpointKey, 90 * 24 * 3600);
  }

  async getUsageStats(keyId: string, period: string): Promise<KeyUsageStats> {
    const days = period === "week" ? 7 : period === "month" ? 30 : 1;
    let totalRequests = 0;
    const endpoints: Record<string, number> = {};

    for (let i = 0; i < days; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const day = d.toISOString().slice(0, 10);
      const count = parseInt((await this.redis.get(`${USAGE_PREFIX}${keyId}:${day}`)) || "0", 10);
      totalRequests += count;
    }

    // Scan endpoint keys
    const pattern = `${USAGE_PREFIX}${keyId}:endpoint:*`;
    let cursor = "0";
    do {
      const [next, keys] = await this.redis.scan(cursor, "MATCH", pattern, "COUNT", 50);
      cursor = next;
      for (const k of keys) {
        const ep = k.split(":endpoint:")[1]?.split(":")[0];
        if (ep) {
          const val = parseInt((await this.redis.get(k)) || "0", 10);
          endpoints[ep] = (endpoints[ep] || 0) + val;
        }
      }
    } while (cursor !== "0");

    const raw = await this.redis.get(`${KEY_STORE_PREFIX}${keyId}`);
    const key: APIKey | null = raw ? JSON.parse(raw) : null;

    return {
      keyId,
      period,
      totalRequests,
      endpoints,
      lastUsedAt: key?.lastUsedAt ? new Date(key.lastUsedAt) : null,
    };
  }

  // ── Scope checking ────────────────────────────────────────────────────────────

  hasScope(key: APIKey, requiredScope: APIScope): boolean {
    if (key.scopes.includes("admin")) return true;
    return key.scopes.includes(requiredScope);
  }

  // ── Express middleware ─────────────────────────────────────────────────────────

  requireScope(...scopes: APIScope[]): RequestHandler {
    return async (req: Request, res: Response, next: NextFunction) => {
      const apiKey = req.headers["x-api-key"] as string | undefined;
      if (!apiKey) {
        return res.status(401).json({ error: "API key required" });
      }

      const key = await this.validateKey(apiKey);
      if (!key) {
        return res.status(401).json({ error: "Invalid or expired API key" });
      }

      const rl = await this.checkRateLimit(key.id);
      if (!rl.allowed) {
        res.setHeader("X-RateLimit-Limit", rl.limit);
        res.setHeader("X-RateLimit-Remaining", 0);
        res.setHeader("X-RateLimit-Reset", Math.floor(rl.resetAt.getTime() / 1000));
        return res.status(429).json({ error: "Rate limit exceeded" });
      }

      for (const scope of scopes) {
        if (!this.hasScope(key, scope)) {
          Logger.security("[APIKeyManager] Scope denied", { keyId: key.id, required: scope, has: key.scopes });
          return res.status(403).json({ error: `Missing required scope: ${scope}` });
        }
      }

      (req as any).apiKey = key;
      (req as any).userId = key.userId;

      await this.trackUsage(key.id, req.path);

      res.setHeader("X-RateLimit-Limit", rl.limit);
      res.setHeader("X-RateLimit-Remaining", rl.remaining);
      res.setHeader("X-RateLimit-Reset", Math.floor(rl.resetAt.getTime() / 1000));

      next();
    };
  }

  // ── Private helpers ───────────────────────────────────────────────────────────

  private generateRawKey(): string {
    const random = crypto.randomBytes(32).toString("base64url");
    return `sk-iliag${random}`;
  }

  private async hashKey(rawKey: string): Promise<string> {
    return bcrypt.hash(rawKey, BCRYPT_ROUNDS);
  }
}

export const apiKeyManager = new APIKeyManager();
