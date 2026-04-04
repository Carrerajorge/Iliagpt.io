import crypto from "crypto";
import type { Request, Response, NextFunction, RequestHandler } from "express";
import Redis from "ioredis";
import { db } from "../db";
import { Logger } from "../lib/logger";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AuditEntry {
  id: string;
  timestamp: Date;
  userId?: string;
  tenantId?: string;
  action: string;
  resource: string;
  resourceId?: string;
  outcome: "success" | "failure" | "denied";
  ipAddress?: string;
  userAgent?: string;
  details?: Record<string, any>;
  hash: string;
  previousHash: string;
}

export interface AuditFilter {
  userId?: string;
  tenantId?: string;
  action?: string;
  resource?: string;
  outcome?: AuditEntry["outcome"];
  fromDate?: Date;
  toDate?: Date;
  limit?: number;
  offset?: number;
}

export interface IntegrityReport {
  valid: boolean;
  checkedEntries: number;
  firstBrokenEntry?: string;
  details: string;
}

export interface TamperReport {
  tampered: boolean;
  suspectEntries: string[];
  checkedAt: Date;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const LAST_HASH_KEY = "audit:last_hash";
const RECENT_ENTRIES_KEY = "audit:recent";
const BUFFER_SIZE = 1000;
const GENESIS_HASH = "0000000000000000000000000000000000000000000000000000000000000000";

// ─── AuditTrail ───────────────────────────────────────────────────────────────

class AuditTrail {
  private lastHashCache: string = GENESIS_HASH;
  private redis: Redis;
  private hashLock = false; // simple in-process mutex for hash chaining

  constructor() {
    this.redis = new Redis(process.env.REDIS_URL || "redis://127.0.0.1:6379", {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => Math.min(times * 50, 2000),
    });
    this.redis.on("error", (err: Error) => {
      Logger.warn("[AuditTrail] Redis error", { error: err.message });
    });
  }

  // ── Logging ──────────────────────────────────────────────────────────────────

  async log(
    entry: Omit<AuditEntry, "id" | "hash" | "previousHash" | "timestamp">
  ): Promise<AuditEntry> {
    // Wait for any concurrent hash computation to finish
    while (this.hashLock) {
      await new Promise((r) => setTimeout(r, 5));
    }
    this.hashLock = true;

    try {
      const previousHash = await this.getLastHash();
      const id = crypto.randomUUID();
      const timestamp = new Date();

      const partial: Omit<AuditEntry, "hash"> = {
        id,
        timestamp,
        previousHash,
        ...entry,
      };

      const hash = this.computeHash(previousHash, partial);

      const full: AuditEntry = { ...partial, hash };

      // Update last hash in Redis
      await this.redis.set(LAST_HASH_KEY, hash);
      this.lastHashCache = hash;

      // Buffer in Redis for recent queries
      await this.redis.lpush(RECENT_ENTRIES_KEY, JSON.stringify(full));
      await this.redis.ltrim(RECENT_ENTRIES_KEY, 0, BUFFER_SIZE - 1);

      // Persist to DB via fire-and-forget (best effort)
      this.persistToDB(full).catch((err) =>
        Logger.error("[AuditTrail] DB persist failed", err)
      );

      return full;
    } finally {
      this.hashLock = false;
    }
  }

  // ── Query ────────────────────────────────────────────────────────────────────

  async query(filter: AuditFilter): Promise<AuditEntry[]> {
    const limit = filter.limit ?? 100;
    const offset = filter.offset ?? 0;

    // Try to fetch from Redis buffer first (recent entries)
    const raw = await this.redis.lrange(RECENT_ENTRIES_KEY, offset, offset + limit - 1);
    let entries: AuditEntry[] = raw.map((r) => JSON.parse(r));

    // Apply filters
    entries = entries.filter((e) => {
      if (filter.userId && e.userId !== filter.userId) return false;
      if (filter.tenantId && e.tenantId !== filter.tenantId) return false;
      if (filter.action && e.action !== filter.action) return false;
      if (filter.resource && e.resource !== filter.resource) return false;
      if (filter.outcome && e.outcome !== filter.outcome) return false;
      if (filter.fromDate && new Date(e.timestamp) < filter.fromDate) return false;
      if (filter.toDate && new Date(e.timestamp) > filter.toDate) return false;
      return true;
    });

    return entries;
  }

  // ── Integrity verification ────────────────────────────────────────────────────

  async verifyIntegrity(fromId?: string, toId?: string): Promise<IntegrityReport> {
    const raw = await this.redis.lrange(RECENT_ENTRIES_KEY, 0, -1);
    const entries: AuditEntry[] = raw.map((r) => JSON.parse(r)).reverse(); // oldest first

    let checkedEntries = 0;
    let prevHash = GENESIS_HASH;

    for (const entry of entries) {
      if (fromId && entry.id === fromId) {
        prevHash = entry.previousHash;
      }

      const { hash, ...partial } = entry;
      const computed = this.computeHash(entry.previousHash, partial);

      if (computed !== hash) {
        return {
          valid: false,
          checkedEntries,
          firstBrokenEntry: entry.id,
          details: `Hash mismatch at entry ${entry.id}`,
        };
      }

      if (prevHash !== GENESIS_HASH && entry.previousHash !== prevHash) {
        return {
          valid: false,
          checkedEntries,
          firstBrokenEntry: entry.id,
          details: `Chain break at entry ${entry.id}`,
        };
      }

      prevHash = hash;
      checkedEntries++;

      if (toId && entry.id === toId) break;
    }

    return { valid: true, checkedEntries, details: "All entries verified" };
  }

  async detectTampering(): Promise<TamperReport> {
    const report = await this.verifyIntegrity();
    return {
      tampered: !report.valid,
      suspectEntries: report.firstBrokenEntry ? [report.firstBrokenEntry] : [],
      checkedAt: new Date(),
    };
  }

  // ── Compliance export ─────────────────────────────────────────────────────────

  async exportCompliance(
    format: "csv" | "json" | "pdf",
    filter: AuditFilter
  ): Promise<Buffer> {
    const entries = await this.query({ ...filter, limit: 10000 });

    if (format === "json") {
      return Buffer.from(JSON.stringify(entries, null, 2), "utf8");
    }

    if (format === "csv") {
      const headers = [
        "id", "timestamp", "userId", "tenantId", "action", "resource",
        "resourceId", "outcome", "ipAddress", "userAgent", "hash",
      ].join(",");
      const rows = entries.map((e) =>
        [
          e.id, e.timestamp.toString(), e.userId ?? "", e.tenantId ?? "",
          e.action, e.resource, e.resourceId ?? "", e.outcome,
          e.ipAddress ?? "", (e.userAgent ?? "").replace(/,/g, ";"), e.hash,
        ]
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(",")
      );
      return Buffer.from([headers, ...rows].join("\n"), "utf8");
    }

    // PDF: return simple text representation (full PDF generation requires external lib)
    const text = entries
      .map((e) => `[${e.timestamp}] ${e.outcome.toUpperCase()} ${e.action} on ${e.resource} by ${e.userId ?? "system"}`)
      .join("\n");
    return Buffer.from(text, "utf8");
  }

  // ── Retention ────────────────────────────────────────────────────────────────

  async applyRetentionPolicy(retainDays: number): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retainDays);

    const raw = await this.redis.lrange(RECENT_ENTRIES_KEY, 0, -1);
    const toKeep: string[] = [];
    let deleted = 0;

    for (const r of raw) {
      const entry: AuditEntry = JSON.parse(r);
      if (new Date(entry.timestamp) >= cutoff) {
        toKeep.push(r);
      } else {
        deleted++;
      }
    }

    if (deleted > 0) {
      await this.redis.del(RECENT_ENTRIES_KEY);
      if (toKeep.length > 0) {
        await this.redis.rpush(RECENT_ENTRIES_KEY, ...toKeep);
      }
    }

    Logger.info("[AuditTrail] Retention policy applied", { deleted, retainDays });
    return deleted;
  }

  async getLastHash(): Promise<string> {
    const stored = await this.redis.get(LAST_HASH_KEY);
    return stored ?? GENESIS_HASH;
  }

  // ── Express middleware ────────────────────────────────────────────────────────

  middleware(): RequestHandler {
    return (req: Request, res: Response, next: NextFunction) => {
      res.on("finish", () => {
        const outcome: AuditEntry["outcome"] =
          res.statusCode < 400 ? "success" : res.statusCode === 403 ? "denied" : "failure";

        this.log({
          userId: (req as any).userId,
          tenantId: (req as any).tenantId,
          action: `${req.method} ${req.route?.path ?? req.path}`,
          resource: req.path,
          outcome,
          ipAddress: (req.ip || req.socket?.remoteAddress || "").replace(/^::ffff:/, ""),
          userAgent: req.get("user-agent"),
          details: { statusCode: res.statusCode },
        }).catch((err) => Logger.error("[AuditTrail] Middleware log failed", err));
      });

      next();
    };
  }

  // ── Private helpers ───────────────────────────────────────────────────────────

  private computeHash(previousHash: string, entry: Omit<AuditEntry, "hash">): string {
    const canonical = this.serializeForHash(entry);
    return crypto
      .createHash("sha256")
      .update(previousHash + canonical)
      .digest("hex");
  }

  private serializeForHash(entry: any): string {
    // Deterministic JSON: sort keys, exclude 'hash' field
    const { hash: _omit, ...rest } = entry;
    const sorted = Object.keys(rest)
      .sort()
      .reduce<Record<string, any>>((acc, k) => {
        acc[k] = rest[k];
        return acc;
      }, {});
    return JSON.stringify(sorted, (_key, value) => {
      if (value instanceof Date) return value.toISOString();
      return value;
    });
  }

  private async persistToDB(entry: AuditEntry): Promise<void> {
    // Attempt to insert into audit_logs table if it exists
    try {
      await (db as any).execute(
        `INSERT INTO audit_logs (id, user_id, action, resource, resource_id, outcome, ip_address, user_agent, details, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (id) DO NOTHING`,
        [
          entry.id,
          entry.userId ?? null,
          entry.action,
          entry.resource,
          entry.resourceId ?? null,
          entry.outcome,
          entry.ipAddress ?? null,
          entry.userAgent ?? null,
          JSON.stringify(entry.details ?? {}),
          entry.timestamp,
        ]
      );
    } catch {
      // Silently swallow — table may not exist in all envs
    }
  }
}

export const auditTrail = new AuditTrail();
