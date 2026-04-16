import crypto from "crypto";
import type { Request, Response, NextFunction, RequestHandler } from "express";
import Redis from "ioredis";
import { LRUCache } from "lru-cache";
import { Logger } from "../lib/logger";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface IPRule {
  id: string;
  tenantId: string;
  cidr: string;
  description?: string;
  type: "allow" | "deny";
  expiresAt?: Date;
  createdAt: Date;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const RULES_KEY_PREFIX = "ipwl:rules:";
const TEMP_ACCESS_KEY_PREFIX = "ipwl:temp:";
const BLOCKED_COUNTRIES_KEY_PREFIX = "ipwl:country:";
const BLOCKED_IPS_KEY_PREFIX = "ipwl:blocked:";
const GLOBAL_TENANT = "__global__";

// ─── IPWhitelistManager ───────────────────────────────────────────────────────

class IPWhitelistManager {
  private redis: Redis;
  private cache: LRUCache<string, boolean>;

  constructor() {
    this.redis = new Redis(process.env.REDIS_URL || "redis://127.0.0.1:6379", {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => Math.min(times * 50, 2000),
    });
    this.redis.on("error", (err: Error) => {
      Logger.warn("[IPWhitelist] Redis error", { error: err.message });
    });

    this.cache = new LRUCache<string, boolean>({
      max: 10_000,
      ttl: 60_000, // 1 minute cache
    });
  }

  // ── Rules ─────────────────────────────────────────────────────────────────────

  async addRule(rule: Omit<IPRule, "id" | "createdAt">): Promise<IPRule> {
    // Validate CIDR
    if (!this.isValidCIDR(rule.cidr)) {
      throw new Error(`Invalid CIDR: ${rule.cidr}`);
    }

    const fullRule: IPRule = {
      ...rule,
      id: crypto.randomUUID(),
      createdAt: new Date(),
    };

    const key = `${RULES_KEY_PREFIX}${rule.tenantId}`;
    await this.redis.hset(key, fullRule.id, JSON.stringify(fullRule));

    // Invalidate cache for this tenant
    this.invalidateTenantCache(rule.tenantId);

    Logger.info("[IPWhitelist] Rule added", { id: fullRule.id, cidr: rule.cidr, type: rule.type, tenantId: rule.tenantId });

    return fullRule;
  }

  async removeRule(ruleId: string, tenantId: string): Promise<void> {
    const key = `${RULES_KEY_PREFIX}${tenantId}`;
    await this.redis.hdel(key, ruleId);
    this.invalidateTenantCache(tenantId);
    Logger.info("[IPWhitelist] Rule removed", { ruleId, tenantId });
  }

  async listRules(tenantId: string): Promise<IPRule[]> {
    const key = `${RULES_KEY_PREFIX}${tenantId}`;
    const raw = await this.redis.hvals(key);
    return raw.map((r) => JSON.parse(r));
  }

  // ── IP checking ───────────────────────────────────────────────────────────────

  async isAllowed(ip: string, tenantId?: string): Promise<boolean> {
    const normalizedIp = ip.replace(/^::ffff:/, "");
    const cacheKey = `${tenantId ?? GLOBAL_TENANT}:${normalizedIp}`;

    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) return cached;

    // Check temporary access
    const tempKey = `${TEMP_ACCESS_KEY_PREFIX}${tenantId ?? GLOBAL_TENANT}:${normalizedIp}`;
    const hasTempAccess = await this.redis.exists(tempKey);
    if (hasTempAccess) {
      this.cache.set(cacheKey, true);
      return true;
    }

    // Check global blocked list
    const blockedKey = `${BLOCKED_IPS_KEY_PREFIX}${tenantId ?? GLOBAL_TENANT}:${normalizedIp}`;
    const isBlocked = await this.redis.exists(blockedKey);
    if (isBlocked) {
      this.cache.set(cacheKey, false);
      return false;
    }

    // Load rules
    const tenants = [GLOBAL_TENANT];
    if (tenantId && tenantId !== GLOBAL_TENANT) tenants.push(tenantId);

    let hasAllowRules = false;
    let explicitlyAllowed = false;
    let explicitlyDenied = false;

    for (const tid of tenants) {
      const rules = await this.listRules(tid);
      const now = new Date();

      for (const rule of rules) {
        if (rule.expiresAt && new Date(rule.expiresAt) < now) continue;

        if (this.cidrContains(rule.cidr, normalizedIp)) {
          if (rule.type === "deny") {
            explicitlyDenied = true;
          } else {
            hasAllowRules = true;
            explicitlyAllowed = true;
          }
        } else if (rule.type === "allow") {
          hasAllowRules = true;
        }
      }
    }

    // Deny rules take precedence over allow rules
    let allowed: boolean;
    if (explicitlyDenied) {
      allowed = false;
    } else if (hasAllowRules) {
      // If there are allow rules and this IP isn't in them, default deny
      allowed = explicitlyAllowed;
    } else {
      // No rules configured → default allow
      allowed = true;
    }

    this.cache.set(cacheKey, allowed);
    return allowed;
  }

  // ── Temporary access ──────────────────────────────────────────────────────────

  async addTemporaryAccess(ip: string, tenantId: string, durationMs: number): Promise<void> {
    const ttlSeconds = Math.ceil(durationMs / 1000);
    const key = `${TEMP_ACCESS_KEY_PREFIX}${tenantId}:${ip.replace(/^::ffff:/, "")}`;
    await this.redis.set(key, "1", "EX", ttlSeconds);
    this.invalidateTenantCache(tenantId);
    Logger.info("[IPWhitelist] Temporary access granted", { ip, tenantId, durationMs });
  }

  async grantTemporaryAccess(
    ip: string,
    tenantId: string,
    durationMs: number,
    reason: string
  ): Promise<void> {
    await this.addTemporaryAccess(ip, tenantId, durationMs);
    Logger.security("[IPWhitelist] Temporary access granted with reason", { ip, tenantId, reason, durationMs });
  }

  // ── Country blocking ──────────────────────────────────────────────────────────

  async blockCountry(countryCode: string, tenantId: string): Promise<void> {
    // Stub: real geo-IP lookup requires an external database (MaxMind GeoIP2, etc.)
    // We store the intention and log it; actual enforcement requires geo-IP middleware
    const key = `${BLOCKED_COUNTRIES_KEY_PREFIX}${tenantId}`;
    await this.redis.sadd(key, countryCode.toUpperCase());
    Logger.info("[IPWhitelist] Country blocked (stub — requires geo-IP middleware)", {
      countryCode,
      tenantId,
    });
  }

  async getBlockedIPs(tenantId: string): Promise<string[]> {
    const pattern = `${BLOCKED_IPS_KEY_PREFIX}${tenantId}:*`;
    const blocked: string[] = [];
    let cursor = "0";

    do {
      const [next, keys] = await this.redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
      cursor = next;
      for (const k of keys) {
        const ip = k.replace(`${BLOCKED_IPS_KEY_PREFIX}${tenantId}:`, "");
        blocked.push(ip);
      }
    } while (cursor !== "0");

    return blocked;
  }

  // ── Express middleware ─────────────────────────────────────────────────────────

  middleware(tenantId?: string): RequestHandler {
    return async (req: Request, res: Response, next: NextFunction) => {
      const ip = this.getClientIP(req);
      const effectiveTenantId = tenantId ?? (req as any).tenantId;

      try {
        const allowed = await this.isAllowed(ip, effectiveTenantId);
        if (!allowed) {
          Logger.security("[IPWhitelist] Request blocked", { ip, tenantId: effectiveTenantId, path: req.path });
          return res.status(403).json({ error: "Access denied: IP not allowed" });
        }
        next();
      } catch (err: any) {
        Logger.error("[IPWhitelist] Middleware error", err);
        next(); // Fail open to avoid blocking legitimate traffic on error
      }
    };
  }

  // ── Private helpers ───────────────────────────────────────────────────────────

  private ipToNumber(ip: string): bigint {
    // Handle IPv4
    if (ip.includes(".")) {
      const parts = ip.split(".").map(Number);
      if (parts.length !== 4 || parts.some((p) => p < 0 || p > 255)) {
        throw new Error(`Invalid IPv4: ${ip}`);
      }
      return BigInt(parts[0]) * 16777216n + BigInt(parts[1]) * 65536n + BigInt(parts[2]) * 256n + BigInt(parts[3]);
    }

    // Handle IPv6
    const expanded = this.expandIPv6(ip);
    return BigInt("0x" + expanded.replace(/:/g, ""));
  }

  private cidrContains(cidr: string, ip: string): boolean {
    try {
      const [network, prefixStr] = cidr.split("/");
      const prefix = parseInt(prefixStr, 10);
      const isIPv6 = cidr.includes(":");

      if (isIPv6 !== ip.includes(":")) return false; // Mismatched families

      const networkNum = this.ipToNumber(network);
      const ipNum = this.ipToNumber(ip);
      const totalBits = isIPv6 ? 128 : 32;
      const shift = BigInt(totalBits - prefix);
      const mask = ((1n << BigInt(prefix)) - 1n) << shift;

      return (networkNum & mask) === (ipNum & mask);
    } catch {
      return false;
    }
  }

  private expandIPv6(ip: string): string {
    if (ip.includes("::")) {
      const parts = ip.split("::");
      const left = parts[0] ? parts[0].split(":") : [];
      const right = parts[1] ? parts[1].split(":") : [];
      const missing = 8 - left.length - right.length;
      const middle = Array(missing).fill("0000");
      return [...left, ...middle, ...right].map((p) => p.padStart(4, "0")).join(":");
    }
    return ip.split(":").map((p) => p.padStart(4, "0")).join(":");
  }

  private isValidCIDR(cidr: string): boolean {
    if (!cidr.includes("/")) return false;
    const [ip, prefix] = cidr.split("/");
    const prefixNum = parseInt(prefix, 10);
    if (isNaN(prefixNum)) return false;
    if (ip.includes(":")) return prefixNum >= 0 && prefixNum <= 128;
    return prefixNum >= 0 && prefixNum <= 32;
  }

  private getClientIP(req: Request): string {
    const forwarded = req.get("x-forwarded-for");
    const ip = forwarded ? forwarded.split(",")[0].trim() : (req.ip || req.socket?.remoteAddress || "unknown");
    return ip.replace(/^::ffff:/, "");
  }

  private invalidateTenantCache(tenantId: string): void {
    // Clear all cached entries for this tenant
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${tenantId}:`) || key.startsWith(`${GLOBAL_TENANT}:`)) {
        this.cache.delete(key);
      }
    }
  }
}

export const ipWhitelist = new IPWhitelistManager();
