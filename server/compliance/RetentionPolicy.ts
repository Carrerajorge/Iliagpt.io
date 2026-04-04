import crypto from "crypto";
import Redis from "ioredis";
import { db } from "../db";
import { Logger } from "../lib/logger";

// ─── Types ────────────────────────────────────────────────────────────────────

export type DataType =
  | "messages"
  | "documents"
  | "audit_logs"
  | "analytics"
  | "user_data"
  | "session_data";

export interface RetentionRule {
  id: string;
  dataType: DataType;
  retentionDays: number;
  legalHold: boolean;
  archiveBeforeDelete: boolean;
  tenantId?: string;
}

export interface PurgeReport {
  startedAt: Date;
  completedAt: Date;
  totalDeleted: number;
  byTable: Record<string, number>;
  errors: string[];
}

export interface RetentionReport {
  rules: RetentionRule[];
  oldestDataByType: Record<string, Date | null>;
  upcomingPurges: Array<{ dataType: string; scheduledAt: Date; estimatedRows: number }>;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const RULES_KEY = "retention:rules";
const LEGAL_HOLDS_KEY_PREFIX = "retention:hold:";
const ARCHIVE_KEY_PREFIX = "retention:archive:";

const TABLE_MAP: Record<DataType, string[]> = {
  messages: ["messages", "chat_messages"],
  documents: ["documents", "document_chunks"],
  audit_logs: ["audit_logs"],
  analytics: ["analytics_events", "usage_logs"],
  user_data: ["users", "user_profiles", "user_settings"],
  session_data: ["sessions", "session_store"],
};

// ─── RetentionPolicyManager ───────────────────────────────────────────────────

class RetentionPolicyManager {
  private rules: Map<string, RetentionRule> = new Map();
  private redis: Redis;

  constructor() {
    this.redis = new Redis(process.env.REDIS_URL || "redis://127.0.0.1:6379", {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => Math.min(times * 50, 2000),
    });
    this.redis.on("error", (err: Error) => {
      Logger.warn("[RetentionPolicy] Redis error", { error: err.message });
    });
    this.loadDefaultRules();
  }

  // ── Rule management ───────────────────────────────────────────────────────────

  async addRule(rule: Omit<RetentionRule, "id">): Promise<RetentionRule> {
    const full: RetentionRule = { ...rule, id: crypto.randomUUID() };
    this.rules.set(full.id, full);
    await this.persistRules();
    Logger.info("[RetentionPolicy] Rule added", { id: full.id, dataType: full.dataType, retentionDays: full.retentionDays });
    return full;
  }

  async removeRule(id: string): Promise<void> {
    this.rules.delete(id);
    await this.persistRules();
    Logger.info("[RetentionPolicy] Rule removed", { id });
  }

  async getRulesForDataType(dataType: string, tenantId?: string): Promise<RetentionRule[]> {
    const all = Array.from(this.rules.values());
    return all.filter((r) => {
      if (r.dataType !== dataType) return false;
      if (r.tenantId && r.tenantId !== tenantId) return false;
      return true;
    });
  }

  // ── Purge job ─────────────────────────────────────────────────────────────────

  async runPurgeJob(): Promise<PurgeReport> {
    const startedAt = new Date();
    const report: PurgeReport = {
      startedAt,
      completedAt: new Date(),
      totalDeleted: 0,
      byTable: {},
      errors: [],
    };

    Logger.info("[RetentionPolicy] Starting purge job");

    for (const rule of this.rules.values()) {
      if (rule.legalHold) continue;

      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - rule.retentionDays);

      const tables = TABLE_MAP[rule.dataType] ?? [];

      for (const tableName of tables) {
        try {
          const deleted = await this.purgeTable(tableName, cutoff, rule.tenantId);
          report.byTable[tableName] = (report.byTable[tableName] ?? 0) + deleted;
          report.totalDeleted += deleted;
        } catch (err: any) {
          const msg = `Failed to purge ${tableName}: ${err.message}`;
          report.errors.push(msg);
          Logger.error("[RetentionPolicy] Purge error", err);
        }
      }
    }

    report.completedAt = new Date();
    Logger.info("[RetentionPolicy] Purge job completed", {
      totalDeleted: report.totalDeleted,
      errors: report.errors.length,
    });

    return report;
  }

  // ── GDPR user data purge ──────────────────────────────────────────────────────

  async purgeUserData(userId: string): Promise<PurgeReport> {
    const startedAt = new Date();
    const report: PurgeReport = {
      startedAt,
      completedAt: new Date(),
      totalDeleted: 0,
      byTable: {},
      errors: [],
    };

    Logger.security("[RetentionPolicy] GDPR user data purge initiated", { userId });

    const userTables = [
      "messages", "chat_messages", "documents", "document_chunks",
      "sessions", "user_settings", "audit_logs",
    ];

    for (const tableName of userTables) {
      try {
        const deleted = await this.purgeUserFromTable(tableName, userId);
        report.byTable[tableName] = deleted;
        report.totalDeleted += deleted;
      } catch (err: any) {
        const msg = `Failed to purge ${tableName}: ${err.message}`;
        report.errors.push(msg);
      }
    }

    report.completedAt = new Date();
    Logger.info("[RetentionPolicy] User data purge completed", { userId, totalDeleted: report.totalDeleted });

    return report;
  }

  // ── Legal hold ────────────────────────────────────────────────────────────────

  async setLegalHold(dataType: string, entityId: string, hold: boolean): Promise<void> {
    const key = `${LEGAL_HOLDS_KEY_PREFIX}${dataType}:${entityId}`;
    if (hold) {
      await this.redis.set(key, "1");
    } else {
      await this.redis.del(key);
    }
    Logger.security("[RetentionPolicy] Legal hold updated", { dataType, entityId, hold });
  }

  async checkLegalHold(dataType: string, entityId: string): Promise<boolean> {
    const key = `${LEGAL_HOLDS_KEY_PREFIX}${dataType}:${entityId}`;
    const result = await this.redis.get(key);
    return result !== null;
  }

  // ── Reports ───────────────────────────────────────────────────────────────────

  async getRetentionReport(): Promise<RetentionReport> {
    const rules = Array.from(this.rules.values());
    const upcomingPurges = rules.map((r) => {
      const scheduledAt = new Date();
      scheduledAt.setDate(scheduledAt.getDate() + 1); // next run
      return { dataType: r.dataType, scheduledAt, estimatedRows: 0 };
    });

    return {
      rules,
      oldestDataByType: {},
      upcomingPurges,
    };
  }

  async scheduleNextPurge(): Promise<Date> {
    const next = new Date();
    next.setHours(2, 0, 0, 0); // 2 AM
    if (next <= new Date()) next.setDate(next.getDate() + 1);
    Logger.info("[RetentionPolicy] Next purge scheduled", { at: next.toISOString() });
    return next;
  }

  // ── Private helpers ───────────────────────────────────────────────────────────

  private async purgeTable(tableName: string, cutoffDate: Date, tenantId?: string): Promise<number> {
    try {
      const params: any[] = [cutoffDate];
      let query = `DELETE FROM "${tableName}" WHERE created_at < $1`;

      if (tenantId) {
        params.push(tenantId);
        query += ` AND tenant_id = $${params.length}`;
      }

      const result = await (db as any).execute(query, params);
      const deleted = result.rowCount ?? 0;

      if (deleted > 0) {
        Logger.info("[RetentionPolicy] Purged rows", { tableName, deleted, cutoffDate });
      }

      return deleted;
    } catch (err: any) {
      // Table may not exist or may not have created_at column — skip
      if (err.code === "42P01" || err.code === "42703") return 0;
      throw err;
    }
  }

  private async purgeUserFromTable(tableName: string, userId: string): Promise<number> {
    try {
      const result = await (db as any).execute(
        `DELETE FROM "${tableName}" WHERE user_id = $1`,
        [userId]
      );
      return result.rowCount ?? 0;
    } catch {
      return 0; // Table may not have user_id or may not exist
    }
  }

  private async archiveBeforePurge(_tableName: string, rows: any[]): Promise<void> {
    const archiveKey = `${ARCHIVE_KEY_PREFIX}${_tableName}:${Date.now()}`;
    await this.redis.set(archiveKey, JSON.stringify(rows), "EX", 90 * 24 * 3600);
  }

  private loadDefaultRules(): void {
    const defaults: Array<Omit<RetentionRule, "id">> = [
      { dataType: "session_data", retentionDays: 30, legalHold: false, archiveBeforeDelete: false },
      { dataType: "analytics", retentionDays: 90, legalHold: false, archiveBeforeDelete: false },
      { dataType: "audit_logs", retentionDays: 365, legalHold: false, archiveBeforeDelete: true },
      { dataType: "messages", retentionDays: 730, legalHold: false, archiveBeforeDelete: false },
      { dataType: "documents", retentionDays: 1825, legalHold: false, archiveBeforeDelete: true },
      { dataType: "user_data", retentionDays: 2555, legalHold: false, archiveBeforeDelete: true },
    ];

    for (const rule of defaults) {
      const full: RetentionRule = { ...rule, id: crypto.randomUUID() };
      this.rules.set(full.id, full);
    }
  }

  private async persistRules(): Promise<void> {
    const data = JSON.stringify(Array.from(this.rules.values()));
    await this.redis.set(RULES_KEY, data);
  }
}

export const retentionPolicy = new RetentionPolicyManager();
