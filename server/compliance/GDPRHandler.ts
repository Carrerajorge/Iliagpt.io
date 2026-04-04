import crypto from "crypto";
import Redis from "ioredis";
import { db } from "../db";
import { Logger } from "../lib/logger";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DataExport {
  userId: string;
  requestedAt: Date;
  completedAt?: Date;
  format: "json" | "csv" | "xml";
  data: Record<string, any[]>;
  downloadUrl?: string;
}

export type ConsentPurpose = "analytics" | "marketing" | "functional" | "third_party";

export interface ConsentRecord {
  userId: string;
  purpose: ConsentPurpose;
  granted: boolean;
  grantedAt: Date | null;
  revokedAt: Date | null;
  ipAddress: string;
  userAgent: string;
}

export interface DeletionReport {
  userId: string;
  requestId: string;
  requestedAt: Date;
  completedAt: Date;
  tablesAffected: Record<string, number>;
  anonymized: boolean;
  errors: string[];
}

export interface ProcessingRecord {
  userId: string;
  purposes: string[];
  dataCategories: string[];
  legalBasis: string;
  retentionPeriod: string;
  generatedAt: Date;
}

export interface DataLineage {
  userId: string;
  sources: Array<{ table: string; firstSeen: Date; rowCount: number }>;
  sharedWith: string[];
  exportHistory: Array<{ date: Date; format: string; requestId: string }>;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CONSENT_KEY_PREFIX = "gdpr:consent:";
const EXPORT_HISTORY_KEY_PREFIX = "gdpr:export:";
const SAR_TABLES = [
  "users", "messages", "chat_messages", "documents",
  "sessions", "user_settings", "audit_logs", "api_keys",
];

// ─── GDPRHandler ─────────────────────────────────────────────────────────────

class GDPRHandler {
  private redis: Redis;

  constructor() {
    this.redis = new Redis(process.env.REDIS_URL || "redis://127.0.0.1:6379", {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => Math.min(times * 50, 2000),
    });
    this.redis.on("error", (err: Error) => {
      Logger.warn("[GDPRHandler] Redis error", { error: err.message });
    });
  }

  // ── Data export (Subject Access Request) ─────────────────────────────────────

  async exportUserData(userId: string, format: "json" | "csv" | "xml"): Promise<DataExport> {
    Logger.info("[GDPRHandler] Export requested", { userId, format });

    const requestedAt = new Date();
    const data = await this.collectAllUserData(userId);

    let formattedData: Buffer;
    if (format === "csv") {
      formattedData = Buffer.from(await this.formatAsCSV(data), "utf8");
    } else if (format === "xml") {
      formattedData = Buffer.from(await this.formatAsXML(data), "utf8");
    } else {
      formattedData = Buffer.from(JSON.stringify(data, null, 2), "utf8");
    }

    const exportId = crypto.randomUUID();
    const completedAt = new Date();

    // Store export record in Redis
    const historyKey = `${EXPORT_HISTORY_KEY_PREFIX}${userId}`;
    await this.redis.lpush(historyKey, JSON.stringify({
      exportId,
      requestedAt,
      completedAt,
      format,
      size: formattedData.length,
    }));
    await this.redis.ltrim(historyKey, 0, 49); // keep last 50

    const exportResult: DataExport = {
      userId,
      requestedAt,
      completedAt,
      format,
      data,
    };

    Logger.info("[GDPRHandler] Export completed", { userId, exportId, format, tables: Object.keys(data).length });

    return exportResult;
  }

  // ── Right to erasure ──────────────────────────────────────────────────────────

  async deleteUserData(userId: string, requestId: string): Promise<DeletionReport> {
    Logger.security("[GDPRHandler] Deletion request", { userId, requestId });

    const requestedAt = new Date();
    const tablesAffected: Record<string, number> = {};
    const errors: string[] = [];

    const deletionTables = [
      "messages", "chat_messages", "documents", "document_chunks",
      "sessions", "user_settings", "api_keys",
    ];

    for (const tableName of deletionTables) {
      try {
        const result = await (db as any).execute(
          `DELETE FROM "${tableName}" WHERE user_id = $1`,
          [userId]
        );
        tablesAffected[tableName] = result.rowCount ?? 0;
      } catch (err: any) {
        errors.push(`${tableName}: ${err.message}`);
      }
    }

    // Anonymize the user record rather than deleting it (preserve referential integrity)
    await this.anonymizeUser(userId).catch((err) => {
      errors.push(`anonymize user: ${err.message}`);
    });

    // Clean up consent records
    const purposes: ConsentPurpose[] = ["analytics", "marketing", "functional", "third_party"];
    for (const purpose of purposes) {
      await this.redis.del(`${CONSENT_KEY_PREFIX}${userId}:${purpose}`);
    }

    const report: DeletionReport = {
      userId,
      requestId,
      requestedAt,
      completedAt: new Date(),
      tablesAffected,
      anonymized: true,
      errors,
    };

    Logger.info("[GDPRHandler] Deletion completed", { userId, requestId, errors: errors.length });
    return report;
  }

  // ── Consent management ────────────────────────────────────────────────────────

  async recordConsent(consent: Omit<ConsentRecord, "grantedAt" | "revokedAt">): Promise<void> {
    const key = `${CONSENT_KEY_PREFIX}${consent.userId}:${consent.purpose}`;
    const record: ConsentRecord = {
      ...consent,
      grantedAt: consent.granted ? new Date() : null,
      revokedAt: null,
    };
    await this.redis.set(key, JSON.stringify(record));
    Logger.info("[GDPRHandler] Consent recorded", { userId: consent.userId, purpose: consent.purpose, granted: consent.granted });
  }

  async revokeConsent(userId: string, purpose: string): Promise<void> {
    const key = `${CONSENT_KEY_PREFIX}${userId}:${purpose}`;
    const raw = await this.redis.get(key);

    if (raw) {
      const record: ConsentRecord = JSON.parse(raw);
      record.granted = false;
      record.revokedAt = new Date();
      await this.redis.set(key, JSON.stringify(record));
    } else {
      // Create revoked record even if no prior consent was recorded
      const record: ConsentRecord = {
        userId,
        purpose: purpose as ConsentPurpose,
        granted: false,
        grantedAt: null,
        revokedAt: new Date(),
        ipAddress: "unknown",
        userAgent: "unknown",
      };
      await this.redis.set(key, JSON.stringify(record));
    }

    Logger.info("[GDPRHandler] Consent revoked", { userId, purpose });
  }

  async getConsents(userId: string): Promise<ConsentRecord[]> {
    const purposes: ConsentPurpose[] = ["analytics", "marketing", "functional", "third_party"];
    const records: ConsentRecord[] = [];

    for (const purpose of purposes) {
      const key = `${CONSENT_KEY_PREFIX}${userId}:${purpose}`;
      const raw = await this.redis.get(key);
      if (raw) records.push(JSON.parse(raw));
    }

    return records;
  }

  // ── Processing record (ROPA) ──────────────────────────────────────────────────

  async generateProcessingRecord(userId: string): Promise<ProcessingRecord> {
    const consents = await this.getConsents(userId);
    const activePurposes = consents.filter((c) => c.granted).map((c) => c.purpose);

    return {
      userId,
      purposes: activePurposes.length > 0 ? activePurposes : ["functional"],
      dataCategories: ["identification", "usage_data", "content", "technical_logs"],
      legalBasis: "legitimate_interest",
      retentionPeriod: "as per retention policy",
      generatedAt: new Date(),
    };
  }

  // ── Subject Access Request ────────────────────────────────────────────────────

  async handleAccessRequest(userId: string): Promise<DataExport> {
    return this.exportUserData(userId, "json");
  }

  // ── Anonymization ─────────────────────────────────────────────────────────────

  async anonymizeUser(userId: string): Promise<void> {
    const anonymizedEmail = `anon-${crypto.randomBytes(8).toString("hex")}@deleted.invalid`;
    const anonymizedName = `Deleted User ${crypto.randomBytes(4).toString("hex")}`;

    try {
      await (db as any).execute(
        `UPDATE users SET
           email = $2,
           name = $3,
           avatar_url = NULL,
           bio = NULL,
           phone = NULL,
           updated_at = NOW()
         WHERE id = $1`,
        [userId, anonymizedEmail, anonymizedName]
      );
      Logger.info("[GDPRHandler] User anonymized", { userId });
    } catch (err: any) {
      // Column names may vary — best effort
      Logger.warn("[GDPRHandler] Anonymization partial", { userId, error: err.message });
    }
  }

  // ── Data lineage ──────────────────────────────────────────────────────────────

  async getDataLineage(userId: string): Promise<DataLineage> {
    const historyKey = `${EXPORT_HISTORY_KEY_PREFIX}${userId}`;
    const exportHistory = await this.redis.lrange(historyKey, 0, -1);

    const sources: DataLineage["sources"] = [];

    for (const tableName of SAR_TABLES) {
      try {
        const result = await (db as any).execute(
          `SELECT COUNT(*) as count, MIN(created_at) as first_seen FROM "${tableName}" WHERE user_id = $1`,
          [userId]
        );
        const row = result.rows?.[0];
        if (row && parseInt(row.count, 10) > 0) {
          sources.push({
            table: tableName,
            firstSeen: row.first_seen ? new Date(row.first_seen) : new Date(),
            rowCount: parseInt(row.count, 10),
          });
        }
      } catch {
        // Table may not have user_id column
      }
    }

    return {
      userId,
      sources,
      sharedWith: [], // Would be populated from integration logs in production
      exportHistory: exportHistory.map((h) => {
        const parsed = JSON.parse(h);
        return { date: new Date(parsed.requestedAt), format: parsed.format, requestId: parsed.exportId };
      }),
    };
  }

  // ── Private helpers ───────────────────────────────────────────────────────────

  private async collectAllUserData(userId: string): Promise<Record<string, any[]>> {
    const data: Record<string, any[]> = {};

    for (const tableName of SAR_TABLES) {
      try {
        const result = await (db as any).execute(
          `SELECT * FROM "${tableName}" WHERE user_id = $1 LIMIT 10000`,
          [userId]
        );
        if (result.rows?.length > 0) {
          data[tableName] = result.rows;
        }
      } catch {
        // Skip tables without user_id or missing tables
      }
    }

    // Include consent records
    data.consents = await this.getConsents(userId);

    return data;
  }

  private async formatAsCSV(data: Record<string, any[]>): Promise<string> {
    const sections: string[] = [];

    for (const [tableName, rows] of Object.entries(data)) {
      if (rows.length === 0) continue;
      sections.push(`# Table: ${tableName}`);
      const headers = Object.keys(rows[0]).join(",");
      sections.push(headers);
      for (const row of rows) {
        const values = Object.values(row)
          .map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`)
          .join(",");
        sections.push(values);
      }
      sections.push(""); // blank line between tables
    }

    return sections.join("\n");
  }

  private async formatAsXML(data: Record<string, any[]>): Promise<string> {
    const lines: string[] = ['<?xml version="1.0" encoding="UTF-8"?>', "<UserData>"];

    for (const [tableName, rows] of Object.entries(data)) {
      if (rows.length === 0) continue;
      lines.push(`  <Table name="${tableName}">`);
      for (const row of rows) {
        lines.push("    <Row>");
        for (const [key, value] of Object.entries(row)) {
          const escaped = String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
          lines.push(`      <${key}>${escaped}</${key}>`);
        }
        lines.push("    </Row>");
      }
      lines.push(`  </Table>`);
    }

    lines.push("</UserData>");
    return lines.join("\n");
  }
}

export const gdprHandler = new GDPRHandler();
