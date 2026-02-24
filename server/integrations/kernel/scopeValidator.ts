/**
 * Scope Validator — Scope-based access control for connector operations.
 *
 * Three components:
 *  1. ScopeValidator       – Verify granted scopes are a superset of required scopes
 *  2. ScopeEscalationDetector – Detect when an operation requests more than previously granted
 *  3. OperationRiskAssessor   – Assess risk level of an operation (confirmation / audit gates)
 *
 * Zero external dependencies.
 */

import type { ConnectorManifest, ConnectorCapability, DataAccessLevel } from "./types";

// ─── ScopeValidator ─────────────────────────────────────────────────

export interface ScopeValidationResult {
  allowed: boolean;
  missing: string[];
  reason?: string;
}

export class ScopeValidator {
  /**
   * Check that `grantedScopes` satisfy the required scopes for an operation.
   *
   * Supports:
   *  - Exact match:     `gmail.send`  matches `gmail.send`
   *  - Wildcard match:  `gmail.*`     matches `gmail.send`, `gmail.read`
   *  - Hierarchical:    `admin`       implies all sub-scopes (`admin.users`, `admin.billing`, etc.)
   *
   * @param manifest      Full connector manifest (to look up the capability)
   * @param operationId   The operation being requested
   * @param grantedScopes Scopes the user currently has
   */
  validate(
    manifest: ConnectorManifest,
    operationId: string,
    grantedScopes: string[]
  ): ScopeValidationResult {
    const capability = manifest.capabilities.find((c) => c.operationId === operationId);
    if (!capability) {
      return {
        allowed: false,
        missing: [],
        reason: `Operation "${operationId}" not found in connector "${manifest.connectorId}"`,
      };
    }

    if (capability.requiredScopes.length === 0) {
      return { allowed: true, missing: [] };
    }

    const missing: string[] = [];

    for (const required of capability.requiredScopes) {
      if (!this.scopeSatisfied(required, grantedScopes)) {
        missing.push(required);
      }
    }

    if (missing.length > 0) {
      return {
        allowed: false,
        missing,
        reason: `Missing required scopes: ${missing.join(", ")}`,
      };
    }

    return { allowed: true, missing: [] };
  }

  /**
   * Check if a single required scope is satisfied by any of the granted scopes.
   */
  private scopeSatisfied(required: string, granted: string[]): boolean {
    for (const g of granted) {
      // Exact match
      if (g === required) return true;

      // Wildcard: `gmail.*` matches `gmail.send`
      if (g.endsWith(".*")) {
        const prefix = g.slice(0, -1); // "gmail."
        if (required.startsWith(prefix)) return true;
      }

      // Hierarchical: `admin` implies `admin.users`, `admin.billing.read`, etc.
      // The granted scope is a prefix of the required scope separated by a dot
      if (required.startsWith(g + ".")) return true;

      // Full URL scopes (Google-style): do partial path matching
      // e.g., granted `https://www.googleapis.com/auth/gmail` matches
      //        required `https://www.googleapis.com/auth/gmail.readonly`
      if (required.startsWith(g) && (required[g.length] === "." || required[g.length] === "/")) {
        return true;
      }
    }
    return false;
  }
}

// ─── ScopeEscalationDetector ────────────────────────────────────────

export type RiskLevel = "low" | "medium" | "high";

export interface EscalationResult {
  escalated: boolean;
  newScopes: string[];
  riskLevel: RiskLevel;
}

/** Keywords that indicate write / destructive operations */
const WRITE_SCOPE_KEYWORDS = [
  "send", "create", "delete", "update", "write", "modify",
  "remove", "destroy", "publish", "post", "put", "patch",
  "insert", "compose", "draft", "forward", "reply",
];

/** Keywords that indicate admin-level access */
const ADMIN_SCOPE_KEYWORDS = [
  "admin", "manage", "owner", "superuser", "root",
  "full_access", "full-access", "unrestricted",
];

/** Keywords that indicate read-only access */
const READ_SCOPE_KEYWORDS = [
  "read", "readonly", "list", "get", "view", "search", "fetch", "query",
];

export class ScopeEscalationDetector {
  /**
   * Detect if the requested scopes escalate beyond what was previously granted.
   *
   * @param previousScopes Scopes the user had before this request
   * @param requestedScopes Scopes being requested now
   */
  detectEscalation(
    previousScopes: string[],
    requestedScopes: string[]
  ): EscalationResult {
    const previousSet = new Set(previousScopes);
    const newScopes = requestedScopes.filter((s) => !previousSet.has(s));

    if (newScopes.length === 0) {
      return { escalated: false, newScopes: [], riskLevel: "low" };
    }

    // Determine risk level based on the nature of the new scopes
    let riskLevel: RiskLevel = "low";

    for (const scope of newScopes) {
      const scopeLower = scope.toLowerCase();

      // Check for admin scopes — highest risk
      if (ADMIN_SCOPE_KEYWORDS.some((kw) => scopeLower.includes(kw))) {
        riskLevel = "high";
        break; // can't go higher
      }

      // Check for write scopes — high risk
      if (WRITE_SCOPE_KEYWORDS.some((kw) => scopeLower.includes(kw))) {
        riskLevel = riskLevel === "low" ? "high" : riskLevel;
      }

      // Check for read scopes — low risk escalation (still escalation)
      if (READ_SCOPE_KEYWORDS.some((kw) => scopeLower.includes(kw))) {
        // keep current level, at minimum "low"
      }
    }

    // If we have new scopes but none matched known keywords, treat as medium
    if (riskLevel === "low" && newScopes.length > 0) {
      riskLevel = "medium";
    }

    return {
      escalated: true,
      newScopes,
      riskLevel,
    };
  }
}

// ─── OperationRiskAssessor ──────────────────────────────────────────

export interface RiskFactor {
  factor: string;
  severity: RiskLevel;
  detail: string;
}

export interface RiskAssessment {
  riskLevel: RiskLevel;
  factors: RiskFactor[];
  requiresConfirmation: boolean;
  auditRequired: boolean;
}

/** Threshold for bulk operations */
const BULK_THRESHOLD = 10;

/** Keys in the input that suggest external recipients */
const RECIPIENT_KEYS = new Set([
  "to", "cc", "bcc", "recipient", "recipients",
  "email", "emails", "channel", "user", "users",
  "target", "targets",
]);

/** Keys that suggest shared resources */
const SHARED_RESOURCE_KEYS = new Set([
  "shared", "public", "team", "workspace",
  "organization", "org", "group",
]);

export class OperationRiskAssessor {
  /**
   * Assess the risk level of an operation based on its capability metadata
   * and the actual input being passed.
   *
   * @param manifest    Connector manifest (for capability lookup)
   * @param operationId The operation being executed
   * @param input       The actual input values
   */
  assessRisk(
    manifest: ConnectorManifest,
    operationId: string,
    input: Record<string, unknown>
  ): RiskAssessment {
    const capability = manifest.capabilities.find((c) => c.operationId === operationId);
    if (!capability) {
      return {
        riskLevel: "high",
        factors: [{ factor: "unknown_operation", severity: "high", detail: `Operation "${operationId}" not found` }],
        requiresConfirmation: true,
        auditRequired: true,
      };
    }

    const factors: RiskFactor[] = [];

    // Factor 1: Data access level
    this.assessAccessLevel(capability, factors);

    // Factor 2: Delete operations
    this.assessDeleteRisk(operationId, capability, factors);

    // Factor 3: Bulk operations
    this.assessBulkRisk(input, factors);

    // Factor 4: External recipients
    this.assessExternalRecipients(input, factors);

    // Factor 5: Shared resource operations
    this.assessSharedResources(input, operationId, factors);

    // Factor 6: Confirmation flag from manifest
    if (capability.confirmationRequired) {
      factors.push({
        factor: "manifest_confirmation",
        severity: "high",
        detail: "Operation marked as requiring confirmation in manifest",
      });
    }

    // Compute overall risk level
    const riskLevel = this.computeOverallRisk(factors);

    return {
      riskLevel,
      factors,
      requiresConfirmation: riskLevel === "high",
      auditRequired: riskLevel === "high" || riskLevel === "medium",
    };
  }

  private assessAccessLevel(capability: ConnectorCapability, factors: RiskFactor[]): void {
    if (capability.dataAccessLevel === "admin") {
      factors.push({
        factor: "admin_access",
        severity: "high",
        detail: "Operation requires admin-level access",
      });
    } else if (capability.dataAccessLevel === "write") {
      factors.push({
        factor: "write_access",
        severity: "medium",
        detail: "Operation performs write operations",
      });
    }
  }

  private assessDeleteRisk(
    operationId: string,
    capability: ConnectorCapability,
    factors: RiskFactor[]
  ): void {
    const opLower = operationId.toLowerCase();
    const isDelete =
      opLower.includes("delete") ||
      opLower.includes("remove") ||
      opLower.includes("destroy") ||
      opLower.includes("trash") ||
      opLower.includes("purge");

    if (isDelete) {
      factors.push({
        factor: "delete_operation",
        severity: "high",
        detail: "Operation performs deletion",
      });
    }
  }

  private assessBulkRisk(input: Record<string, unknown>, factors: RiskFactor[]): void {
    for (const [key, value] of Object.entries(input)) {
      if (Array.isArray(value) && value.length > BULK_THRESHOLD) {
        factors.push({
          factor: "bulk_operation",
          severity: "medium",
          detail: `Array parameter "${key}" has ${value.length} items (threshold: ${BULK_THRESHOLD})`,
        });
        break; // one bulk warning is enough
      }
    }

    // Check for numeric batch sizes
    for (const [key, value] of Object.entries(input)) {
      const keyLower = key.toLowerCase();
      if (
        (keyLower.includes("batch") || keyLower.includes("count") || keyLower.includes("limit")) &&
        typeof value === "number" &&
        value > BULK_THRESHOLD
      ) {
        factors.push({
          factor: "bulk_operation",
          severity: "medium",
          detail: `Numeric parameter "${key}" = ${value} exceeds bulk threshold`,
        });
        break;
      }
    }
  }

  private assessExternalRecipients(input: Record<string, unknown>, factors: RiskFactor[]): void {
    for (const [key, value] of Object.entries(input)) {
      if (!RECIPIENT_KEYS.has(key.toLowerCase())) continue;

      if (typeof value === "string" && value.length > 0) {
        factors.push({
          factor: "external_recipient",
          severity: "medium",
          detail: `Operation targets external recipient(s) via "${key}"`,
        });
        break;
      }

      if (Array.isArray(value) && value.length > 0) {
        factors.push({
          factor: "external_recipient",
          severity: "medium",
          detail: `Operation targets ${value.length} external recipient(s) via "${key}"`,
        });
        break;
      }
    }
  }

  private assessSharedResources(
    input: Record<string, unknown>,
    operationId: string,
    factors: RiskFactor[]
  ): void {
    // Check if the operation name suggests shared resources
    const opLower = operationId.toLowerCase();
    if (opLower.includes("share") || opLower.includes("publish") || opLower.includes("public")) {
      factors.push({
        factor: "shared_resource",
        severity: "medium",
        detail: "Operation involves sharing or publishing resources",
      });
      return;
    }

    // Check if input references shared resources
    for (const [key] of Object.entries(input)) {
      if (SHARED_RESOURCE_KEYS.has(key.toLowerCase())) {
        factors.push({
          factor: "shared_resource",
          severity: "medium",
          detail: `Input references shared resource via "${key}" parameter`,
        });
        break;
      }
    }
  }

  private computeOverallRisk(factors: RiskFactor[]): RiskLevel {
    if (factors.length === 0) return "low";

    let hasHigh = false;
    let hasMedium = false;

    for (const f of factors) {
      if (f.severity === "high") hasHigh = true;
      if (f.severity === "medium") hasMedium = true;
    }

    if (hasHigh) return "high";
    if (hasMedium) return "medium";
    return "low";
  }
}

// ─── Singletons ─────────────────────────────────────────────────────

export const scopeValidator = new ScopeValidator();
export const escalationDetector = new ScopeEscalationDetector();
export const riskAssessor = new OperationRiskAssessor();
