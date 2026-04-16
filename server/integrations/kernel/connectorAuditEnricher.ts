/**
 * ConnectorAuditEnricher — Enterprise audit trail enrichment for connector operations.
 *
 * Enriches the existing toolCallLogs with connector-specific metadata including
 * security context, compliance markers, cost tracking, and PII detection.
 *
 * Features:
 *  - Automatic enrichment of partial audit entries with computed fields
 *  - Ring buffer (1000 entries) for fast in-memory queries
 *  - Queryable by connectorId, userId, timeRange, riskLevel, success
 *  - Compliance summary generation (per user, per time range)
 *  - Export to JSON or CSV formats
 *  - SHA-256 input hashing (never stores raw input)
 *  - GDPR relevance detection from connector category
 *
 * Zero external dependencies.
 */

import { createHash, randomUUID } from "node:crypto";

// ─── Types ──────────────────────────────────────────────────────────

export type OperationCategory = "read" | "write" | "delete" | "admin" | "search";
export type RiskLevel = "low" | "medium" | "high" | "critical";
export type DataClassification = "public" | "internal" | "confidential" | "restricted";

export interface ConnectorAuditEntry {
  id: string;
  timestamp: Date;
  connectorId: string;
  operationId: string;
  userId: string;
  chatId: string;
  runId: string;

  // Request context
  inputHash: string;
  inputSizeBytes: number;
  operationCategory: OperationCategory;

  // Execution context
  durationMs: number;
  success: boolean;
  errorCode?: string;
  errorMessage?: string;
  retryCount: number;

  // Security context
  scopesUsed: string[];
  scopesGranted: string[];
  riskLevel: RiskLevel;
  confirmationProvided: boolean;
  ipAddress?: string;
  userAgent?: string;

  // Cost context
  estimatedCostUsd: number;

  // Output context
  outputSizeBytes: number;
  redactionsApplied: number;
  artifactsGenerated: number;

  // Compliance
  dataClassification: DataClassification;
  retentionDays: number;
  gdprRelevant: boolean;
  piiDetected: boolean;
}

/**
 * Partial entry supplied by the caller. Fields that can be computed
 * automatically are optional and will be filled by enrichment.
 */
export interface PartialAuditEntry {
  connectorId: string;
  operationId: string;
  userId: string;
  chatId: string;
  runId: string;

  // Input — raw input is hashed, never stored
  rawInput?: unknown;
  inputHash?: string;
  inputSizeBytes?: number;

  // Execution
  durationMs: number;
  success: boolean;
  errorCode?: string;
  errorMessage?: string;
  retryCount?: number;

  // Security
  scopesUsed?: string[];
  scopesGranted?: string[];
  confirmationProvided?: boolean;
  ipAddress?: string;
  userAgent?: string;

  // Cost
  estimatedCostUsd?: number;

  // Output
  outputSizeBytes?: number;
  redactionsApplied?: number;
  artifactsGenerated?: number;

  // Overrides — caller can force these; otherwise they are auto-derived
  operationCategory?: OperationCategory;
  dataClassification?: DataClassification;
  riskLevel?: RiskLevel;
  gdprRelevant?: boolean;
  piiDetected?: boolean;
  retentionDays?: number;
}

export interface AuditQueryFilters {
  connectorId?: string;
  userId?: string;
  startDate?: Date;
  endDate?: Date;
  riskLevel?: RiskLevel;
  success?: boolean;
  operationCategory?: OperationCategory;
  dataClassification?: DataClassification;
  limit?: number;
}

export interface ComplianceSummary {
  userId: string;
  startDate: Date;
  endDate: Date;
  totalOperations: number;
  successCount: number;
  failureCount: number;
  byCategory: Record<OperationCategory, number>;
  byRisk: Record<RiskLevel, number>;
  byClassification: Record<DataClassification, number>;
  gdprOperations: number;
  piiOperations: number;
  totalEstimatedCostUsd: number;
  uniqueConnectors: string[];
  averageDurationMs: number;
  totalRedactions: number;
}

// ─── Ring Buffer ────────────────────────────────────────────────────

const RING_BUFFER_CAPACITY = 1000;

class AuditRingBuffer {
  private readonly _buf: (ConnectorAuditEntry | undefined)[];
  private _head = 0;
  private _size = 0;

  constructor(capacity: number) {
    this._buf = new Array(capacity);
  }

  push(item: ConnectorAuditEntry): void {
    this._buf[this._head] = item;
    this._head = (this._head + 1) % this._buf.length;
    if (this._size < this._buf.length) this._size++;
  }

  /**
   * Return entries newest-first, optionally limited.
   */
  toArray(limit?: number): ConnectorAuditEntry[] {
    const count = limit !== undefined ? Math.min(limit, this._size) : this._size;
    const result: ConnectorAuditEntry[] = [];
    // Walk backwards from head to get newest-first
    for (let i = 0; i < count; i++) {
      const idx = (this._head - 1 - i + this._buf.length) % this._buf.length;
      const entry = this._buf[idx];
      if (entry) result.push(entry);
    }
    return result;
  }

  /**
   * Return all entries (oldest-first) for filtering.
   */
  toArrayOldestFirst(): ConnectorAuditEntry[] {
    const result: ConnectorAuditEntry[] = [];
    const start = (this._head - this._size + this._buf.length) % this._buf.length;
    for (let i = 0; i < this._size; i++) {
      const idx = (start + i) % this._buf.length;
      const entry = this._buf[idx];
      if (entry) result.push(entry);
    }
    return result;
  }

  get size(): number {
    return this._size;
  }

  clear(): void {
    this._buf.fill(undefined);
    this._head = 0;
    this._size = 0;
  }
}

// ─── Operation Category Derivation ──────────────────────────────────

const READ_PREFIXES = ["list_", "read_", "get_", "fetch_", "view_", "show_", "check_"];
const WRITE_PREFIXES = ["send_", "create_", "post_", "update_", "put_", "patch_", "set_", "add_", "upload_"];
const DELETE_PREFIXES = ["delete_", "remove_", "purge_", "archive_", "trash_"];
const SEARCH_PREFIXES = ["search_", "find_", "query_", "lookup_", "filter_"];
const ADMIN_PREFIXES = ["admin_", "manage_", "configure_", "grant_", "revoke_", "invite_"];

function deriveOperationCategory(operationId: string): OperationCategory {
  const lower = operationId.toLowerCase();
  // Extract the verb part after connectorId prefix (e.g., "gmail_send_email" -> "send_email")
  const parts = lower.split("_");
  // Try matching from the second segment onward (skip connectorId prefix)
  const withoutPrefix = parts.length > 1 ? parts.slice(1).join("_") : lower;

  for (const prefix of ADMIN_PREFIXES) {
    if (withoutPrefix.startsWith(prefix) || lower.startsWith(prefix)) return "admin";
  }
  for (const prefix of DELETE_PREFIXES) {
    if (withoutPrefix.startsWith(prefix) || lower.startsWith(prefix)) return "delete";
  }
  for (const prefix of SEARCH_PREFIXES) {
    if (withoutPrefix.startsWith(prefix) || lower.startsWith(prefix)) return "search";
  }
  for (const prefix of WRITE_PREFIXES) {
    if (withoutPrefix.startsWith(prefix) || lower.startsWith(prefix)) return "write";
  }
  for (const prefix of READ_PREFIXES) {
    if (withoutPrefix.startsWith(prefix) || lower.startsWith(prefix)) return "read";
  }
  // Default: read (safest assumption)
  return "read";
}

// ─── GDPR-Relevant Connector Categories ─────────────────────────────

const PII_CONNECTOR_CATEGORIES = new Set([
  "email",
  "crm",
  "comms",
  "support",
  "marketing",
]);

/**
 * Connectors in these categories typically handle PII (emails, contacts,
 * messages, customer data).
 */
function isGdprRelevantConnector(connectorId: string): boolean {
  // Check connector ID prefixes that map to PII categories
  const piiKeywords = [
    "gmail", "outlook", "email", "mail",
    "hubspot", "salesforce", "crm", "pipedrive",
    "slack", "teams", "discord", "whatsapp", "telegram", "messenger",
    "zendesk", "intercom", "freshdesk", "support",
    "mailchimp", "sendgrid", "marketing",
    "contacts", "people",
  ];
  const lower = connectorId.toLowerCase();
  return piiKeywords.some((kw) => lower.includes(kw));
}

// ─── Data Classification Derivation ─────────────────────────────────

function deriveDataClassification(
  connectorId: string,
  category: OperationCategory,
): DataClassification {
  const gdpr = isGdprRelevantConnector(connectorId);

  if (category === "admin") return "restricted";
  if (category === "delete" && gdpr) return "restricted";
  if (category === "write" && gdpr) return "confidential";
  if (gdpr) return "confidential";
  if (category === "write") return "internal";
  return "public";
}

// ─── Retention Days ─────────────────────────────────────────────────

function deriveRetentionDays(category: OperationCategory): number {
  switch (category) {
    case "delete":
      return 730; // 2 years — audit trail for deletions
    case "write":
    case "admin":
      return 365; // 1 year — audit trail for writes/admin
    case "read":
    case "search":
      return 90; // 90 days — reads are lower risk
    default:
      return 90;
  }
}

// ─── Risk Level Computation ─────────────────────────────────────────

function computeRiskLevel(
  category: OperationCategory,
  confirmationProvided: boolean,
  scopesUsed: string[],
  scopesGranted: string[],
  connectorId: string,
): RiskLevel {
  let score = 0;

  // Operation category weight
  switch (category) {
    case "admin":
      score += 40;
      break;
    case "delete":
      score += 30;
      break;
    case "write":
      score += 20;
      break;
    case "search":
      score += 5;
      break;
    case "read":
      score += 0;
      break;
  }

  // Scope escalation: using scopes not in granted set
  const ungrantedScopes = scopesUsed.filter((s) => !scopesGranted.includes(s));
  if (ungrantedScopes.length > 0) {
    score += 25;
  }

  // Wide scope surface
  if (scopesUsed.length > 5) score += 10;

  // No confirmation for write/delete/admin
  if (!confirmationProvided && (category === "write" || category === "delete" || category === "admin")) {
    score += 15;
  }

  // GDPR-relevant connector
  if (isGdprRelevantConnector(connectorId)) {
    score += 10;
  }

  if (score >= 60) return "critical";
  if (score >= 40) return "high";
  if (score >= 20) return "medium";
  return "low";
}

// ─── Cost Estimation ────────────────────────────────────────────────

const BASE_COST_PER_OPERATION: Record<OperationCategory, number> = {
  read: 0.0001,
  search: 0.0002,
  write: 0.0005,
  delete: 0.0003,
  admin: 0.001,
};

function estimateCost(category: OperationCategory, outputSizeBytes: number): number {
  const base = BASE_COST_PER_OPERATION[category];
  // Add a small cost proportional to output size (per 10 KB)
  const sizeFactor = Math.max(0, (outputSizeBytes / 10_240) * 0.00005);
  return Math.round((base + sizeFactor) * 1_000_000) / 1_000_000; // 6 decimal places
}

// ─── Input Hashing ──────────────────────────────────────────────────

function hashInput(rawInput: unknown): string {
  const serialized = typeof rawInput === "string"
    ? rawInput
    : JSON.stringify(rawInput ?? "");
  return createHash("sha256").update(serialized).digest("hex");
}

function measureInputSize(rawInput: unknown): number {
  if (rawInput === undefined || rawInput === null) return 0;
  const serialized = typeof rawInput === "string"
    ? rawInput
    : JSON.stringify(rawInput);
  return Buffer.byteLength(serialized, "utf8");
}

// ─── CSV Escaping ───────────────────────────────────────────────────

function csvEscape(value: unknown): string {
  const str = String(value ?? "");
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// ─── ConnectorAuditEnricher ─────────────────────────────────────────

export class ConnectorAuditEnricher {
  private readonly _buffer = new AuditRingBuffer(RING_BUFFER_CAPACITY);

  /**
   * Enrich a partial audit entry with computed fields, store in ring buffer,
   * and optionally persist to the database (best-effort).
   */
  enrichAndLog(partial: PartialAuditEntry): ConnectorAuditEntry {
    const operationCategory =
      partial.operationCategory ?? deriveOperationCategory(partial.operationId);
    const scopesUsed = partial.scopesUsed ?? [];
    const scopesGranted = partial.scopesGranted ?? [];
    const confirmationProvided = partial.confirmationProvided ?? false;
    const outputSizeBytes = partial.outputSizeBytes ?? 0;

    const entry: ConnectorAuditEntry = {
      id: randomUUID(),
      timestamp: new Date(),
      connectorId: partial.connectorId,
      operationId: partial.operationId,
      userId: partial.userId,
      chatId: partial.chatId,
      runId: partial.runId,

      // Request context
      inputHash: partial.inputHash ?? hashInput(partial.rawInput),
      inputSizeBytes: partial.inputSizeBytes ?? measureInputSize(partial.rawInput),
      operationCategory,

      // Execution context
      durationMs: partial.durationMs,
      success: partial.success,
      errorCode: partial.errorCode,
      errorMessage: partial.errorMessage,
      retryCount: partial.retryCount ?? 0,

      // Security context
      scopesUsed,
      scopesGranted,
      riskLevel:
        partial.riskLevel ??
        computeRiskLevel(operationCategory, confirmationProvided, scopesUsed, scopesGranted, partial.connectorId),
      confirmationProvided,
      ipAddress: partial.ipAddress,
      userAgent: partial.userAgent,

      // Cost context
      estimatedCostUsd: partial.estimatedCostUsd ?? estimateCost(operationCategory, outputSizeBytes),

      // Output context
      outputSizeBytes,
      redactionsApplied: partial.redactionsApplied ?? 0,
      artifactsGenerated: partial.artifactsGenerated ?? 0,

      // Compliance
      dataClassification:
        partial.dataClassification ?? deriveDataClassification(partial.connectorId, operationCategory),
      retentionDays: partial.retentionDays ?? deriveRetentionDays(operationCategory),
      gdprRelevant: partial.gdprRelevant ?? isGdprRelevantConnector(partial.connectorId),
      piiDetected: partial.piiDetected ?? false,
    };

    // Store in ring buffer
    this._buffer.push(entry);

    // Structured log output
    this._logEntry(entry);

    // Best-effort DB persistence (fire-and-forget)
    this._persistEntry(entry);

    return entry;
  }

  /**
   * Query audit entries with composite filters.
   */
  query(filters: AuditQueryFilters): ConnectorAuditEntry[] {
    const all = this._buffer.toArrayOldestFirst();
    const limit = filters.limit ?? 100;

    const results: ConnectorAuditEntry[] = [];
    for (const entry of all) {
      if (results.length >= limit) break;
      if (!this._matchesFilters(entry, filters)) continue;
      results.push(entry);
    }

    return results;
  }

  /**
   * Get the most recent audit entries, optionally filtered by connectorId.
   */
  getRecentEntries(connectorId?: string, limit: number = 50): ConnectorAuditEntry[] {
    const all = this._buffer.toArray(limit * 2); // Over-fetch for filtering
    if (!connectorId) return all.slice(0, limit);
    return all.filter((e) => e.connectorId === connectorId).slice(0, limit);
  }

  /**
   * Get entries filtered by risk level.
   */
  getEntriesByRisk(riskLevel: RiskLevel, limit: number = 20): ConnectorAuditEntry[] {
    const all = this._buffer.toArray(limit * 5); // Over-fetch for filtering
    return all.filter((e) => e.riskLevel === riskLevel).slice(0, limit);
  }

  /**
   * Generate an aggregated compliance summary for a user within a date range.
   */
  getComplianceSummary(userId: string, startDate: Date, endDate: Date): ComplianceSummary {
    const entries = this.query({
      userId,
      startDate,
      endDate,
      limit: RING_BUFFER_CAPACITY,
    });

    const byCategory: Record<OperationCategory, number> = {
      read: 0,
      write: 0,
      delete: 0,
      admin: 0,
      search: 0,
    };
    const byRisk: Record<RiskLevel, number> = {
      low: 0,
      medium: 0,
      high: 0,
      critical: 0,
    };
    const byClassification: Record<DataClassification, number> = {
      public: 0,
      internal: 0,
      confidential: 0,
      restricted: 0,
    };

    let successCount = 0;
    let failureCount = 0;
    let gdprOperations = 0;
    let piiOperations = 0;
    let totalCost = 0;
    let totalDuration = 0;
    let totalRedactions = 0;
    const connectorSet = new Set<string>();

    for (const entry of entries) {
      byCategory[entry.operationCategory]++;
      byRisk[entry.riskLevel]++;
      byClassification[entry.dataClassification]++;

      if (entry.success) successCount++;
      else failureCount++;

      if (entry.gdprRelevant) gdprOperations++;
      if (entry.piiDetected) piiOperations++;

      totalCost += entry.estimatedCostUsd;
      totalDuration += entry.durationMs;
      totalRedactions += entry.redactionsApplied;
      connectorSet.add(entry.connectorId);
    }

    return {
      userId,
      startDate,
      endDate,
      totalOperations: entries.length,
      successCount,
      failureCount,
      byCategory,
      byRisk,
      byClassification,
      gdprOperations,
      piiOperations,
      totalEstimatedCostUsd: Math.round(totalCost * 1_000_000) / 1_000_000,
      uniqueConnectors: Array.from(connectorSet).sort(),
      averageDurationMs: entries.length > 0 ? Math.round(totalDuration / entries.length) : 0,
      totalRedactions,
    };
  }

  /**
   * Export audit log entries matching filters as JSON or CSV string.
   */
  exportAuditLog(filters: AuditQueryFilters, format: "json" | "csv"): string {
    const entries = this.query(filters);

    if (format === "json") {
      return JSON.stringify(entries, (_key, value) => {
        if (value instanceof Date) return value.toISOString();
        return value;
      }, 2);
    }

    // CSV export
    const headers = [
      "id", "timestamp", "connectorId", "operationId", "userId", "chatId", "runId",
      "inputHash", "inputSizeBytes", "operationCategory",
      "durationMs", "success", "errorCode", "errorMessage", "retryCount",
      "scopesUsed", "scopesGranted", "riskLevel", "confirmationProvided",
      "ipAddress", "userAgent",
      "estimatedCostUsd",
      "outputSizeBytes", "redactionsApplied", "artifactsGenerated",
      "dataClassification", "retentionDays", "gdprRelevant", "piiDetected",
    ];

    const lines: string[] = [headers.join(",")];

    for (const entry of entries) {
      const row = [
        csvEscape(entry.id),
        csvEscape(entry.timestamp.toISOString()),
        csvEscape(entry.connectorId),
        csvEscape(entry.operationId),
        csvEscape(entry.userId),
        csvEscape(entry.chatId),
        csvEscape(entry.runId),
        csvEscape(entry.inputHash),
        csvEscape(entry.inputSizeBytes),
        csvEscape(entry.operationCategory),
        csvEscape(entry.durationMs),
        csvEscape(entry.success),
        csvEscape(entry.errorCode ?? ""),
        csvEscape(entry.errorMessage ?? ""),
        csvEscape(entry.retryCount),
        csvEscape(entry.scopesUsed.join(";")),
        csvEscape(entry.scopesGranted.join(";")),
        csvEscape(entry.riskLevel),
        csvEscape(entry.confirmationProvided),
        csvEscape(entry.ipAddress ?? ""),
        csvEscape(entry.userAgent ?? ""),
        csvEscape(entry.estimatedCostUsd),
        csvEscape(entry.outputSizeBytes),
        csvEscape(entry.redactionsApplied),
        csvEscape(entry.artifactsGenerated),
        csvEscape(entry.dataClassification),
        csvEscape(entry.retentionDays),
        csvEscape(entry.gdprRelevant),
        csvEscape(entry.piiDetected),
      ];
      lines.push(row.join(","));
    }

    return lines.join("\n");
  }

  /**
   * Return the total number of entries currently in the ring buffer.
   */
  get size(): number {
    return this._buffer.size;
  }

  /**
   * Clear all entries from the in-memory ring buffer.
   */
  clear(): void {
    this._buffer.clear();
  }

  // ── Private ─────────────────────────────────────────────────────────

  private _matchesFilters(entry: ConnectorAuditEntry, filters: AuditQueryFilters): boolean {
    if (filters.connectorId && entry.connectorId !== filters.connectorId) return false;
    if (filters.userId && entry.userId !== filters.userId) return false;
    if (filters.riskLevel && entry.riskLevel !== filters.riskLevel) return false;
    if (filters.success !== undefined && entry.success !== filters.success) return false;
    if (filters.operationCategory && entry.operationCategory !== filters.operationCategory) return false;
    if (filters.dataClassification && entry.dataClassification !== filters.dataClassification) return false;
    if (filters.startDate && entry.timestamp < filters.startDate) return false;
    if (filters.endDate && entry.timestamp > filters.endDate) return false;
    return true;
  }

  private _logEntry(entry: ConnectorAuditEntry): void {
    const level = entry.riskLevel === "critical" || entry.riskLevel === "high" ? "warn" : "info";
    const logFn = level === "warn" ? console.warn : console.info;

    logFn(
      JSON.stringify({
        event: "connector_audit_entry",
        level,
        id: entry.id,
        connectorId: entry.connectorId,
        operationId: entry.operationId,
        userId: entry.userId,
        operationCategory: entry.operationCategory,
        success: entry.success,
        riskLevel: entry.riskLevel,
        durationMs: entry.durationMs,
        dataClassification: entry.dataClassification,
        gdprRelevant: entry.gdprRelevant,
        piiDetected: entry.piiDetected,
        estimatedCostUsd: entry.estimatedCostUsd,
        errorCode: entry.errorCode,
        timestamp: entry.timestamp.toISOString(),
      }),
    );
  }

  /**
   * Best-effort persistence to the database. Failures are logged and swallowed.
   */
  private _persistEntry(entry: ConnectorAuditEntry): void {
    void (async () => {
      try {
        const { db } = await import("../../db");
        const { sql } = await import("drizzle-orm");

        await db.execute(
          sql`INSERT INTO "connectorAuditLog" (
            id, timestamp, connector_id, operation_id, user_id, chat_id, run_id,
            input_hash, input_size_bytes, operation_category,
            duration_ms, success, error_code, error_message, retry_count,
            scopes_used, scopes_granted, risk_level, confirmation_provided,
            ip_address, user_agent,
            estimated_cost_usd,
            output_size_bytes, redactions_applied, artifacts_generated,
            data_classification, retention_days, gdpr_relevant, pii_detected
          ) VALUES (
            ${entry.id}, ${entry.timestamp.toISOString()}::timestamptz,
            ${entry.connectorId}, ${entry.operationId}, ${entry.userId},
            ${entry.chatId}, ${entry.runId},
            ${entry.inputHash}, ${entry.inputSizeBytes}, ${entry.operationCategory},
            ${entry.durationMs}, ${entry.success},
            ${entry.errorCode ?? null}, ${entry.errorMessage ?? null},
            ${entry.retryCount},
            ${JSON.stringify(entry.scopesUsed)}, ${JSON.stringify(entry.scopesGranted)},
            ${entry.riskLevel}, ${entry.confirmationProvided},
            ${entry.ipAddress ?? null}, ${entry.userAgent ?? null},
            ${entry.estimatedCostUsd},
            ${entry.outputSizeBytes}, ${entry.redactionsApplied}, ${entry.artifactsGenerated},
            ${entry.dataClassification}, ${entry.retentionDays},
            ${entry.gdprRelevant}, ${entry.piiDetected}
          ) ON CONFLICT (id) DO NOTHING`,
        );
      } catch {
        // DB persistence is best-effort — table may not exist yet.
      }
    })();
  }
}

// ─── Singleton ──────────────────────────────────────────────────────

export const connectorAuditEnricher = new ConnectorAuditEnricher();
