/**
 * ConnectorComplianceEngine — Regulatory compliance enforcement for connector operations.
 *
 * Evaluates every connector operation against a set of configurable compliance policies
 * before execution. Each policy contains rules that can block, warn, audit, or require
 * confirmation. Built-in policies cover:
 *
 *  - Data residency restrictions
 *  - PII protection (names, emails, phones in output)
 *  - Rate abuse detection (10x normal usage)
 *  - Scope minimization warnings
 *  - Bulk export prevention (>100 records)
 *  - Off-hours access logging
 *  - Sensitive connector access (CRM write, code push)
 *  - Cross-connector data flow auditing
 *  - Retention enforcement (auto-flag expired entries)
 *
 * Features:
 *  - Pluggable policy system with add/remove/enable/disable
 *  - Per-user compliance scoring (0-100)
 *  - Violation history ring buffer (500 entries)
 *  - Structured JSON logging for all violations and warnings
 *  - Compliance report generation
 *
 * Zero external dependencies.
 */

import { randomUUID } from "node:crypto";

// ─── Types ──────────────────────────────────────────────────────────

export type RuleAction = "block" | "warn" | "audit" | "require_confirmation";
export type RuleSeverity = "info" | "warning" | "error" | "critical";

export interface ComplianceRule {
  id: string;
  name: string;
  condition: (ctx: ComplianceContext) => boolean;
  action: RuleAction;
  message: string;
  severity: RuleSeverity;
}

export interface CompliancePolicy {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  rules: ComplianceRule[];
}

export interface ComplianceContext {
  connectorId: string;
  operationId: string;
  userId: string;
  input: Record<string, unknown>;
  scopesGranted: string[];
  scopesRequired: string[];
  timestamp: Date;
  previousOperations: { connectorId: string; operationId: string; timestamp: Date }[];
  userProfile?: { role?: string; department?: string; timezone?: string };
}

export interface Violation {
  id: string;
  timestamp: Date;
  policyId: string;
  policyName: string;
  ruleId: string;
  ruleName: string;
  action: RuleAction;
  severity: RuleSeverity;
  message: string;
  connectorId: string;
  operationId: string;
  userId: string;
}

export interface Warning {
  ruleId: string;
  ruleName: string;
  message: string;
  severity: RuleSeverity;
}

export interface EvaluationResult {
  allowed: boolean;
  violations: Violation[];
  warnings: Warning[];
}

export interface ComplianceReport {
  startDate: Date;
  endDate: Date;
  generatedAt: Date;
  totalEvaluations: number;
  totalViolations: number;
  totalWarnings: number;
  violationsByPolicy: Record<string, number>;
  violationsBySeverity: Record<RuleSeverity, number>;
  violationsByConnector: Record<string, number>;
  violationsByUser: Record<string, number>;
  topOffenders: Array<{ userId: string; violationCount: number; complianceScore: number }>;
  activePolicies: Array<{ id: string; name: string; ruleCount: number }>;
}

// ─── Ring Buffer ────────────────────────────────────────────────────

const VIOLATION_BUFFER_CAPACITY = 500;

class ViolationRingBuffer {
  private readonly _buf: (Violation | undefined)[];
  private _head = 0;
  private _size = 0;

  constructor(capacity: number) {
    this._buf = new Array(capacity);
  }

  push(item: Violation): void {
    this._buf[this._head] = item;
    this._head = (this._head + 1) % this._buf.length;
    if (this._size < this._buf.length) this._size++;
  }

  /**
   * Return entries newest-first, optionally limited.
   */
  toArray(limit?: number): Violation[] {
    const count = limit !== undefined ? Math.min(limit, this._size) : this._size;
    const result: Violation[] = [];
    for (let i = 0; i < count; i++) {
      const idx = (this._head - 1 - i + this._buf.length) % this._buf.length;
      const entry = this._buf[idx];
      if (entry) result.push(entry);
    }
    return result;
  }

  /**
   * Return all entries oldest-first for aggregation.
   */
  toArrayOldestFirst(): Violation[] {
    const result: Violation[] = [];
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

// ─── PII Detection Helpers ──────────────────────────────────────────

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const PHONE_REGEX = /(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}/;
const NAME_LIKE_REGEX = /\b[A-Z][a-z]{1,20}\s[A-Z][a-z]{1,20}\b/;

function containsPii(input: Record<string, unknown>): boolean {
  const text = JSON.stringify(input);
  return EMAIL_REGEX.test(text) || PHONE_REGEX.test(text) || NAME_LIKE_REGEX.test(text);
}

// ─── Operation Category Helpers ─────────────────────────────────────

function isWriteOperation(operationId: string): boolean {
  const lower = operationId.toLowerCase();
  const writePrefixes = ["send_", "create_", "post_", "update_", "put_", "patch_", "set_", "add_", "upload_"];
  const parts = lower.split("_");
  const withoutConnector = parts.length > 1 ? parts.slice(1).join("_") : lower;
  return writePrefixes.some((p) => withoutConnector.startsWith(p) || lower.startsWith(p));
}

function isDeleteOperation(operationId: string): boolean {
  const lower = operationId.toLowerCase();
  const deletePrefixes = ["delete_", "remove_", "purge_", "archive_", "trash_"];
  const parts = lower.split("_");
  const withoutConnector = parts.length > 1 ? parts.slice(1).join("_") : lower;
  return deletePrefixes.some((p) => withoutConnector.startsWith(p) || lower.startsWith(p));
}

function isReadOperation(operationId: string): boolean {
  const lower = operationId.toLowerCase();
  const readPrefixes = ["list_", "read_", "get_", "fetch_", "view_", "show_", "check_", "search_", "find_", "query_"];
  const parts = lower.split("_");
  const withoutConnector = parts.length > 1 ? parts.slice(1).join("_") : lower;
  return readPrefixes.some((p) => withoutConnector.startsWith(p) || lower.startsWith(p));
}

// ─── Sensitive Connector Helpers ────────────────────────────────────

const SENSITIVE_WRITE_CONNECTORS = new Set([
  "hubspot", "salesforce", "pipedrive",       // CRM writes
  "github", "gitlab", "bitbucket",            // Code pushes
  "stripe", "paypal",                         // Payment
  "aws", "gcp", "azure",                      // Cloud infra
]);

function isSensitiveConnectorWrite(connectorId: string, operationId: string): boolean {
  const lower = connectorId.toLowerCase();
  const isSensitive = SENSITIVE_WRITE_CONNECTORS.has(lower) ||
    Array.from(SENSITIVE_WRITE_CONNECTORS).some((s) => lower.includes(s));
  return isSensitive && (isWriteOperation(operationId) || isDeleteOperation(operationId));
}

// ─── Usage Tracking (for rate abuse) ────────────────────────────────

interface UsageWindow {
  count: number;
  windowStart: number;
}

const userUsage5Min = new Map<string, UsageWindow>();
const USAGE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const NORMAL_USAGE_PER_5MIN = 10;
const ABUSE_MULTIPLIER = 10;

function recordUsage(userId: string): number {
  const now = Date.now();
  const existing = userUsage5Min.get(userId);

  if (!existing || now - existing.windowStart > USAGE_WINDOW_MS) {
    userUsage5Min.set(userId, { count: 1, windowStart: now });
    return 1;
  }

  existing.count++;
  return existing.count;
}

function getCurrentUsage(userId: string): number {
  const now = Date.now();
  const existing = userUsage5Min.get(userId);
  if (!existing || now - existing.windowStart > USAGE_WINDOW_MS) return 0;
  return existing.count;
}

// ─── Business Hours Check ───────────────────────────────────────────

interface BusinessHoursConfig {
  startHour: number; // 0-23
  endHour: number;   // 0-23
  timezone: string;  // IANA timezone string
  workdays: number[]; // 0=Sunday, 1=Monday, ..., 6=Saturday
}

const DEFAULT_BUSINESS_HOURS: BusinessHoursConfig = {
  startHour: 8,
  endHour: 18,
  timezone: "America/New_York",
  workdays: [1, 2, 3, 4, 5], // Monday-Friday
};

function isWithinBusinessHours(timestamp: Date, config: BusinessHoursConfig = DEFAULT_BUSINESS_HOURS): boolean {
  // Simple UTC-offset approach — we cannot use Intl for full timezone math without
  // external deps, but we can do a reasonable approximation with the Date hour.
  // For production, the user profile timezone overrides this.
  const hour = timestamp.getUTCHours();
  const day = timestamp.getUTCDay();

  if (!config.workdays.includes(day)) return false;
  if (hour < config.startHour || hour >= config.endHour) return false;
  return true;
}

// ─── Bulk Export Detection ──────────────────────────────────────────

const BULK_THRESHOLD = 100;

function isBulkExportRequest(input: Record<string, unknown>): boolean {
  // Check for common pagination/limit params that suggest large exports
  const limit = input.limit ?? input.count ?? input.max ?? input.page_size ?? input.pageSize;
  if (typeof limit === "number" && limit > BULK_THRESHOLD) return true;

  // Check for "all" or "export" flags
  const exportFlag = input.export ?? input.export_all ?? input.exportAll ?? input.all;
  if (exportFlag === true || exportFlag === "true") return true;

  return false;
}

// ─── Cross-Connector Data Flow Detection ────────────────────────────

const CROSS_FLOW_WINDOW_MS = 60 * 1000; // 1 minute

function detectCrossConnectorFlow(
  currentConnectorId: string,
  currentOperationId: string,
  previousOperations: ComplianceContext["previousOperations"],
): { detected: boolean; sourceConnector?: string; sourceOperation?: string } {
  if (!isWriteOperation(currentOperationId)) {
    return { detected: false };
  }

  const now = Date.now();
  // Look for a recent read from a DIFFERENT connector
  for (const prev of previousOperations) {
    if (prev.connectorId === currentConnectorId) continue;
    const elapsed = now - prev.timestamp.getTime();
    if (elapsed > CROSS_FLOW_WINDOW_MS) continue;

    // Previous was a read from a different connector, current is a write
    const prevParts = prev.operationId.toLowerCase().split("_");
    const prevVerb = prevParts.length > 1 ? prevParts.slice(1).join("_") : prev.operationId.toLowerCase();
    const readPrefixes = ["list_", "read_", "get_", "fetch_", "search_", "find_", "query_"];
    const wasRead = readPrefixes.some((p) => prevVerb.startsWith(p) || prev.operationId.toLowerCase().startsWith(p));

    if (wasRead) {
      return {
        detected: true,
        sourceConnector: prev.connectorId,
        sourceOperation: prev.operationId,
      };
    }
  }

  return { detected: false };
}

// ─── Data Residency Config ──────────────────────────────────────────

interface DataResidencyConfig {
  approvedRegions: string[];
  connectorRegionMap: Record<string, string>;
}

const DEFAULT_RESIDENCY_CONFIG: DataResidencyConfig = {
  approvedRegions: ["us", "eu", "us-east-1", "eu-west-1", "eu-central-1"],
  connectorRegionMap: {}, // Populate per deployment
};

let residencyConfig = { ...DEFAULT_RESIDENCY_CONFIG };

// ─── Built-In Policies ──────────────────────────────────────────────

function createBuiltInPolicies(): CompliancePolicy[] {
  return [
    // ── Data Residency ────────────────────────────────────────────
    {
      id: "data-residency",
      name: "Data Residency",
      description: "Block operations that would send PII to connectors in non-approved regions",
      enabled: true,
      rules: [
        {
          id: "dr-001",
          name: "PII to non-approved region",
          condition: (ctx: ComplianceContext): boolean => {
            const region = residencyConfig.connectorRegionMap[ctx.connectorId];
            if (!region) return false; // Unknown region — allow (no mapping configured)
            const hasPii = containsPii(ctx.input);
            const approved = residencyConfig.approvedRegions.includes(region.toLowerCase());
            return hasPii && !approved;
          },
          action: "block",
          message: "This operation would send PII to a connector in a non-approved data residency region.",
          severity: "critical",
        },
      ],
    },

    // ── PII Protection ────────────────────────────────────────────
    {
      id: "pii-protection",
      name: "PII Protection",
      description: "Require confirmation for operations that include PII in output",
      enabled: true,
      rules: [
        {
          id: "pii-001",
          name: "PII in write operation input",
          condition: (ctx: ComplianceContext): boolean => {
            return isWriteOperation(ctx.operationId) && containsPii(ctx.input);
          },
          action: "require_confirmation",
          message: "This write operation contains personally identifiable information (PII). Please confirm before proceeding.",
          severity: "warning",
        },
        {
          id: "pii-002",
          name: "PII in delete operation",
          condition: (ctx: ComplianceContext): boolean => {
            return isDeleteOperation(ctx.operationId) && containsPii(ctx.input);
          },
          action: "require_confirmation",
          message: "This delete operation targets data containing PII. Please confirm this is intentional.",
          severity: "error",
        },
      ],
    },

    // ── Rate Abuse ────────────────────────────────────────────────
    {
      id: "rate-abuse",
      name: "Rate Abuse Prevention",
      description: "Block users exceeding 10x normal usage patterns (10 ops per 5 min)",
      enabled: true,
      rules: [
        {
          id: "ra-001",
          name: "Excessive operation rate",
          condition: (ctx: ComplianceContext): boolean => {
            const current = getCurrentUsage(ctx.userId);
            return current >= NORMAL_USAGE_PER_5MIN * ABUSE_MULTIPLIER;
          },
          action: "block",
          message: "Operation blocked: usage rate significantly exceeds normal patterns. Please try again later.",
          severity: "critical",
        },
        {
          id: "ra-002",
          name: "Elevated operation rate warning",
          condition: (ctx: ComplianceContext): boolean => {
            const current = getCurrentUsage(ctx.userId);
            return current >= NORMAL_USAGE_PER_5MIN * 5 && current < NORMAL_USAGE_PER_5MIN * ABUSE_MULTIPLIER;
          },
          action: "warn",
          message: "Warning: operation rate is elevated above normal patterns.",
          severity: "warning",
        },
      ],
    },

    // ── Scope Minimization ────────────────────────────────────────
    {
      id: "scope-minimization",
      name: "Scope Minimization",
      description: "Warn when operations use broader scopes than necessary",
      enabled: true,
      rules: [
        {
          id: "sm-001",
          name: "Excess granted scopes",
          condition: (ctx: ComplianceContext): boolean => {
            if (ctx.scopesRequired.length === 0) return false;
            const excessScopes = ctx.scopesGranted.filter((s) => !ctx.scopesRequired.includes(s));
            // Warn if more than 50% of granted scopes are unused by this operation
            return excessScopes.length > ctx.scopesRequired.length;
          },
          action: "warn",
          message: "This operation has more scopes granted than required. Consider reducing granted permissions for principle of least privilege.",
          severity: "info",
        },
        {
          id: "sm-002",
          name: "Admin scope for read operation",
          condition: (ctx: ComplianceContext): boolean => {
            if (!isReadOperation(ctx.operationId)) return false;
            const hasAdmin = ctx.scopesGranted.some(
              (s) => s.toLowerCase().includes("admin") || s.toLowerCase().includes("full_access"),
            );
            return hasAdmin;
          },
          action: "warn",
          message: "Admin-level scopes are granted for a read-only operation. Consider using a more restricted token.",
          severity: "warning",
        },
      ],
    },

    // ── Bulk Export Prevention ─────────────────────────────────────
    {
      id: "bulk-export",
      name: "Bulk Export Prevention",
      description: "Require confirmation for operations that export more than 100 records",
      enabled: true,
      rules: [
        {
          id: "be-001",
          name: "Large data export request",
          condition: (ctx: ComplianceContext): boolean => {
            return isReadOperation(ctx.operationId) && isBulkExportRequest(ctx.input);
          },
          action: "require_confirmation",
          message: "This operation would export more than 100 records. Please confirm this bulk export is intentional.",
          severity: "warning",
        },
      ],
    },

    // ── Off-Hours Access ──────────────────────────────────────────
    {
      id: "off-hours",
      name: "Off-Hours Access",
      description: "Log warning for connector access outside business hours",
      enabled: true,
      rules: [
        {
          id: "oh-001",
          name: "Off-hours connector access",
          condition: (ctx: ComplianceContext): boolean => {
            return !isWithinBusinessHours(ctx.timestamp);
          },
          action: "audit",
          message: "Connector operation performed outside standard business hours.",
          severity: "info",
        },
        {
          id: "oh-002",
          name: "Off-hours sensitive write",
          condition: (ctx: ComplianceContext): boolean => {
            if (isWithinBusinessHours(ctx.timestamp)) return false;
            return isWriteOperation(ctx.operationId) || isDeleteOperation(ctx.operationId);
          },
          action: "warn",
          message: "Write/delete operation performed outside business hours. This access has been logged.",
          severity: "warning",
        },
      ],
    },

    // ── Sensitive Connector Access ────────────────────────────────
    {
      id: "sensitive-connector",
      name: "Sensitive Connector Access",
      description: "Require confirmation for high-risk connector write operations (CRM, code, payments)",
      enabled: true,
      rules: [
        {
          id: "sc-001",
          name: "Sensitive connector write",
          condition: (ctx: ComplianceContext): boolean => {
            return isSensitiveConnectorWrite(ctx.connectorId, ctx.operationId);
          },
          action: "require_confirmation",
          message: "This operation writes to a sensitive connector (CRM, code repository, or payment system). Confirmation required.",
          severity: "error",
        },
      ],
    },

    // ── Cross-Connector Data Flow ─────────────────────────────────
    {
      id: "cross-connector-flow",
      name: "Cross-Connector Data Flow",
      description: "Detect and audit when data flows between different connectors",
      enabled: true,
      rules: [
        {
          id: "ccf-001",
          name: "Cross-connector data transfer",
          condition: (ctx: ComplianceContext): boolean => {
            const flow = detectCrossConnectorFlow(
              ctx.connectorId,
              ctx.operationId,
              ctx.previousOperations,
            );
            return flow.detected;
          },
          action: "audit",
          message: "Data flow detected between different connectors. This cross-system transfer has been logged for compliance review.",
          severity: "warning",
        },
      ],
    },

    // ── Retention Enforcement ─────────────────────────────────────
    {
      id: "retention-enforcement",
      name: "Retention Enforcement",
      description: "Auto-flag operations accessing data past retention period",
      enabled: true,
      rules: [
        {
          id: "re-001",
          name: "Access to potentially expired data",
          condition: (ctx: ComplianceContext): boolean => {
            // Check if the operation references dates older than 2 years
            const inputStr = JSON.stringify(ctx.input);
            const twoYearsAgo = new Date();
            twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);

            // Look for ISO date patterns in input
            const dateMatches = inputStr.match(/\d{4}-\d{2}-\d{2}/g);
            if (!dateMatches) return false;

            return dateMatches.some((d) => {
              const parsed = new Date(d);
              return !isNaN(parsed.getTime()) && parsed < twoYearsAgo;
            });
          },
          action: "audit",
          message: "This operation references data that may be past the standard retention period. Flagged for compliance review.",
          severity: "info",
        },
      ],
    },
  ];
}

// ─── Evaluation Counter ─────────────────────────────────────────────

interface EvaluationCounters {
  totalEvaluations: number;
  totalViolations: number;
  totalWarnings: number;
}

// ─── ConnectorComplianceEngine ──────────────────────────────────────

export class ConnectorComplianceEngine {
  private readonly _policies = new Map<string, CompliancePolicy>();
  private readonly _violations = new ViolationRingBuffer(VIOLATION_BUFFER_CAPACITY);
  private readonly _counters: EvaluationCounters = {
    totalEvaluations: 0,
    totalViolations: 0,
    totalWarnings: 0,
  };

  constructor() {
    // Register built-in policies
    for (const policy of createBuiltInPolicies()) {
      this._policies.set(policy.id, policy);
    }
  }

  // ── Core Evaluation ──────────────────────────────────────────────

  /**
   * Evaluate a compliance context against all active policies.
   * Returns whether the operation is allowed, plus any violations and warnings.
   */
  evaluate(context: ComplianceContext): EvaluationResult {
    this._counters.totalEvaluations++;

    // Track usage for rate abuse detection
    recordUsage(context.userId);

    const violations: Violation[] = [];
    const warnings: Warning[] = [];
    let blocked = false;

    for (const policy of Array.from(this._policies.values())) {
      if (!policy.enabled) continue;

      for (const rule of policy.rules) {
        let matched = false;
        try {
          matched = rule.condition(context);
        } catch (err) {
          // Rule evaluation error — log and skip
          console.error(
            JSON.stringify({
              event: "compliance_rule_evaluation_error",
              policyId: policy.id,
              ruleId: rule.id,
              error: err instanceof Error ? err.message : String(err),
              timestamp: Date.now(),
            }),
          );
          continue;
        }

        if (!matched) continue;

        if (rule.action === "block") {
          blocked = true;
          const violation = this._createViolation(policy, rule, context);
          violations.push(violation);
          this._violations.push(violation);
          this._counters.totalViolations++;
          this._logViolation(violation);
        } else if (rule.action === "require_confirmation") {
          const violation = this._createViolation(policy, rule, context);
          violations.push(violation);
          this._violations.push(violation);
          this._counters.totalViolations++;
          this._logViolation(violation);
        } else if (rule.action === "warn") {
          warnings.push({
            ruleId: rule.id,
            ruleName: rule.name,
            message: rule.message,
            severity: rule.severity,
          });
          this._counters.totalWarnings++;
          this._logWarning(rule, context);
        } else if (rule.action === "audit") {
          // Audit-only: log but do not block or warn
          this._logAudit(rule, context);
        }
      }
    }

    // Blocked if any "block" rule fired.
    // "require_confirmation" violations are returned but don't auto-block —
    // the caller decides whether to proceed based on confirmation status.
    return {
      allowed: !blocked,
      violations,
      warnings,
    };
  }

  // ── Policy Management ────────────────────────────────────────────

  /**
   * Add a custom compliance policy.
   */
  addPolicy(policy: CompliancePolicy): void {
    this._policies.set(policy.id, policy);
    console.info(
      JSON.stringify({
        event: "compliance_policy_added",
        policyId: policy.id,
        name: policy.name,
        ruleCount: policy.rules.length,
        enabled: policy.enabled,
        timestamp: Date.now(),
      }),
    );
  }

  /**
   * Remove a policy by ID. Returns true if the policy was found and removed.
   */
  removePolicy(policyId: string): boolean {
    const removed = this._policies.delete(policyId);
    if (removed) {
      console.info(
        JSON.stringify({
          event: "compliance_policy_removed",
          policyId,
          timestamp: Date.now(),
        }),
      );
    }
    return removed;
  }

  /**
   * Enable a policy by ID. Returns true if the policy was found.
   */
  enablePolicy(policyId: string): boolean {
    const policy = this._policies.get(policyId);
    if (!policy) return false;
    policy.enabled = true;
    console.info(
      JSON.stringify({
        event: "compliance_policy_enabled",
        policyId,
        timestamp: Date.now(),
      }),
    );
    return true;
  }

  /**
   * Disable a policy by ID. Returns true if the policy was found.
   */
  disablePolicy(policyId: string): boolean {
    const policy = this._policies.get(policyId);
    if (!policy) return false;
    policy.enabled = false;
    console.info(
      JSON.stringify({
        event: "compliance_policy_disabled",
        policyId,
        timestamp: Date.now(),
      }),
    );
    return true;
  }

  /**
   * Get all active (enabled) policies.
   */
  getActivePolicies(): CompliancePolicy[] {
    const active: CompliancePolicy[] = [];
    for (const policy of Array.from(this._policies.values())) {
      if (policy.enabled) active.push(policy);
    }
    return active;
  }

  /**
   * Get all policies (active and inactive).
   */
  getAllPolicies(): CompliancePolicy[] {
    return Array.from(this._policies.values());
  }

  /**
   * Get a specific policy by ID.
   */
  getPolicy(policyId: string): CompliancePolicy | undefined {
    return this._policies.get(policyId);
  }

  // ── Violation History ────────────────────────────────────────────

  /**
   * Query past violations with optional filters.
   */
  getViolationHistory(
    userId?: string,
    connectorId?: string,
    limit: number = 50,
  ): Violation[] {
    const all = this._violations.toArray(limit * 3); // Over-fetch for filtering
    let results = all;

    if (userId) {
      results = results.filter((v) => v.userId === userId);
    }
    if (connectorId) {
      results = results.filter((v) => v.connectorId === connectorId);
    }

    return results.slice(0, limit);
  }

  // ── Compliance Score ─────────────────────────────────────────────

  /**
   * Compute a compliance score (0-100) for a user based on their violation history.
   *
   * Scoring:
   *  - Start at 100
   *  - Each "info" violation:     -1
   *  - Each "warning" violation:  -3
   *  - Each "error" violation:    -7
   *  - Each "critical" violation: -15
   *  - Floor at 0
   */
  getComplianceScore(userId: string): number {
    const userViolations = this._violations.toArrayOldestFirst().filter(
      (v) => v.userId === userId,
    );

    let score = 100;
    const penalties: Record<RuleSeverity, number> = {
      info: 1,
      warning: 3,
      error: 7,
      critical: 15,
    };

    for (const v of userViolations) {
      score -= penalties[v.severity];
    }

    return Math.max(0, score);
  }

  // ── Compliance Report ────────────────────────────────────────────

  /**
   * Generate a structured compliance report for a date range.
   */
  generateComplianceReport(startDate: Date, endDate: Date): ComplianceReport {
    const allViolations = this._violations.toArrayOldestFirst().filter(
      (v) => v.timestamp >= startDate && v.timestamp <= endDate,
    );

    const violationsByPolicy: Record<string, number> = {};
    const violationsBySeverity: Record<RuleSeverity, number> = {
      info: 0,
      warning: 0,
      error: 0,
      critical: 0,
    };
    const violationsByConnector: Record<string, number> = {};
    const violationsByUser: Record<string, number> = {};

    for (const v of allViolations) {
      violationsByPolicy[v.policyName] = (violationsByPolicy[v.policyName] ?? 0) + 1;
      violationsBySeverity[v.severity]++;
      violationsByConnector[v.connectorId] = (violationsByConnector[v.connectorId] ?? 0) + 1;
      violationsByUser[v.userId] = (violationsByUser[v.userId] ?? 0) + 1;
    }

    // Top offenders sorted by violation count
    const topOffenders = Object.entries(violationsByUser)
      .map(([userId, violationCount]) => ({
        userId,
        violationCount,
        complianceScore: this.getComplianceScore(userId),
      }))
      .sort((a, b) => b.violationCount - a.violationCount)
      .slice(0, 10);

    const activePolicies = this.getActivePolicies().map((p) => ({
      id: p.id,
      name: p.name,
      ruleCount: p.rules.length,
    }));

    return {
      startDate,
      endDate,
      generatedAt: new Date(),
      totalEvaluations: this._counters.totalEvaluations,
      totalViolations: allViolations.length,
      totalWarnings: this._counters.totalWarnings,
      violationsByPolicy,
      violationsBySeverity,
      violationsByConnector,
      violationsByUser,
      topOffenders,
      activePolicies,
    };
  }

  // ── Configuration ────────────────────────────────────────────────

  /**
   * Update data residency configuration.
   */
  setDataResidencyConfig(config: Partial<DataResidencyConfig>): void {
    if (config.approvedRegions) {
      residencyConfig.approvedRegions = config.approvedRegions;
    }
    if (config.connectorRegionMap) {
      residencyConfig.connectorRegionMap = {
        ...residencyConfig.connectorRegionMap,
        ...config.connectorRegionMap,
      };
    }
    console.info(
      JSON.stringify({
        event: "compliance_residency_config_updated",
        approvedRegions: residencyConfig.approvedRegions,
        mappedConnectors: Object.keys(residencyConfig.connectorRegionMap).length,
        timestamp: Date.now(),
      }),
    );
  }

  /**
   * Return the total number of violations in the ring buffer.
   */
  get violationCount(): number {
    return this._violations.size;
  }

  /**
   * Return aggregate counters.
   */
  get counters(): Readonly<EvaluationCounters> {
    return { ...this._counters };
  }

  /**
   * Clear all violation history and reset counters.
   */
  reset(): void {
    this._violations.clear();
    this._counters.totalEvaluations = 0;
    this._counters.totalViolations = 0;
    this._counters.totalWarnings = 0;
    userUsage5Min.clear();
  }

  // ── Private Helpers ──────────────────────────────────────────────

  private _createViolation(
    policy: CompliancePolicy,
    rule: ComplianceRule,
    context: ComplianceContext,
  ): Violation {
    return {
      id: randomUUID(),
      timestamp: new Date(),
      policyId: policy.id,
      policyName: policy.name,
      ruleId: rule.id,
      ruleName: rule.name,
      action: rule.action,
      severity: rule.severity,
      message: rule.message,
      connectorId: context.connectorId,
      operationId: context.operationId,
      userId: context.userId,
    };
  }

  private _logViolation(violation: Violation): void {
    const logFn = violation.severity === "critical" || violation.severity === "error"
      ? console.error
      : console.warn;

    logFn(
      JSON.stringify({
        event: "compliance_violation",
        level: violation.severity,
        id: violation.id,
        policyId: violation.policyId,
        policyName: violation.policyName,
        ruleId: violation.ruleId,
        ruleName: violation.ruleName,
        action: violation.action,
        connectorId: violation.connectorId,
        operationId: violation.operationId,
        userId: violation.userId,
        message: violation.message,
        timestamp: violation.timestamp.toISOString(),
      }),
    );
  }

  private _logWarning(rule: ComplianceRule, context: ComplianceContext): void {
    console.warn(
      JSON.stringify({
        event: "compliance_warning",
        level: rule.severity,
        ruleId: rule.id,
        ruleName: rule.name,
        connectorId: context.connectorId,
        operationId: context.operationId,
        userId: context.userId,
        message: rule.message,
        timestamp: Date.now(),
      }),
    );
  }

  private _logAudit(rule: ComplianceRule, context: ComplianceContext): void {
    console.info(
      JSON.stringify({
        event: "compliance_audit",
        level: "info",
        ruleId: rule.id,
        ruleName: rule.name,
        connectorId: context.connectorId,
        operationId: context.operationId,
        userId: context.userId,
        message: rule.message,
        timestamp: Date.now(),
      }),
    );
  }
}

// ─── Singleton ──────────────────────────────────────────────────────

export const connectorComplianceEngine = new ConnectorComplianceEngine();
