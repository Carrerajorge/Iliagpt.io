/**
 * HumanInTheLoop — Risk classification, confirmation gating, batch approvals,
 * timeout handling, audit trail, and preference learning for agent actions.
 */

import { randomUUID } from "crypto";
import { Logger } from "../lib/logger";
import type { ToolCallRequest } from "./ClaudeAgentBackbone";

// ─── Types ─────────────────────────────────────────────────────────────────────
export type RiskLevel = "low" | "medium" | "high" | "critical";

export type ConfirmationStatus = "pending" | "approved" | "rejected" | "timeout" | "auto_approved";

export interface RiskClassification {
  level: RiskLevel;
  category: string;
  reason: string;
  requiresConfirmation: boolean;
  reversible: boolean;
}

export interface ConfirmationRequest {
  id: string;
  sessionId: string;
  toolCall: ToolCallRequest;
  risk: RiskClassification;
  previewDescription: string;
  status: ConfirmationStatus;
  createdAt: Date;
  resolvedAt?: Date;
  userNote?: string;
  batchId?: string;
}

export interface BatchConfirmation {
  id: string;
  sessionId: string;
  requests: ConfirmationRequest[];
  status: ConfirmationStatus;
  createdAt: Date;
  resolvedAt?: Date;
}

export interface AuditEntry {
  id: string;
  sessionId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  riskLevel: RiskLevel;
  status: ConfirmationStatus;
  timestamp: Date;
  userNote?: string;
}

export interface UserPreferences {
  userId: string;
  autoApprove: Record<string, boolean>; // toolName → always approve
  autoReject: Record<string, boolean>; // toolName → always reject
  lastUpdated: Date;
}

export interface HumanInLoopConfig {
  timeoutMs?: number; // how long to wait for user response (default 5 min)
  onConfirmationNeeded?: (request: ConfirmationRequest) => Promise<ConfirmationStatus>;
  onBatchConfirmationNeeded?: (batch: BatchConfirmation) => Promise<ConfirmationStatus>;
  onTimeout?: (request: ConfirmationRequest) => ConfirmationStatus; // default: reject
  minRiskForConfirmation?: RiskLevel; // default: high
}

// ─── Risk classification rules ─────────────────────────────────────────────────
const RISK_RULES: Array<{
  pattern: RegExp;
  level: RiskLevel;
  category: string;
  reason: string;
  reversible: boolean;
}> = [
  // Critical — irreversible destructive
  { pattern: /delete|destroy|drop|truncate|purge|rm -rf|wipe/i, level: "critical", category: "destructive", reason: "Action may permanently delete data", reversible: false },
  // Critical — financial
  { pattern: /payment|charge|invoice|billing|transfer|withdraw|purchase/i, level: "critical", category: "financial", reason: "Action involves financial transaction", reversible: false },
  // High — external messages
  { pattern: /send_email|send_message|post_tweet|publish|broadcast|notify/i, level: "high", category: "communication", reason: "Action sends a message to external parties", reversible: false },
  // High — system changes
  { pattern: /install|uninstall|update_config|deploy|migrate|reboot|shutdown/i, level: "high", category: "system", reason: "Action modifies system configuration", reversible: false },
  // High — security sensitive
  { pattern: /change_password|rotate_key|revoke_token|grant_access|set_permission/i, level: "high", category: "security", reason: "Action modifies security settings", reversible: false },
  // Medium — writes files / creates artifacts
  { pattern: /write_file|create_file|save|upload|overwrite/i, level: "medium", category: "file_write", reason: "Action creates or overwrites files", reversible: true },
  // Medium — external API calls with side effects
  { pattern: /create_issue|update_record|submit_form|webhook/i, level: "medium", category: "external_api", reason: "Action mutates external API state", reversible: true },
  // Low — everything else is read-only by default
];

function classifyRisk(toolCall: ToolCallRequest): RiskClassification {
  const searchText = `${toolCall.name} ${JSON.stringify(toolCall.input)}`.toLowerCase();

  for (const rule of RISK_RULES) {
    if (rule.pattern.test(searchText)) {
      return {
        level: rule.level,
        category: rule.category,
        reason: rule.reason,
        requiresConfirmation: rule.level === "high" || rule.level === "critical",
        reversible: rule.reversible,
      };
    }
  }

  return {
    level: "low",
    category: "read_only",
    reason: "Read-only or non-destructive operation",
    requiresConfirmation: false,
    reversible: true,
  };
}

const RISK_ORDER: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2, critical: 3 };

// ─── HumanInTheLoop ────────────────────────────────────────────────────────────
export class HumanInTheLoop {
  private readonly timeoutMs: number;
  private readonly onConfirmationNeeded?: (req: ConfirmationRequest) => Promise<ConfirmationStatus>;
  private readonly onBatchConfirmationNeeded?: (batch: BatchConfirmation) => Promise<ConfirmationStatus>;
  private readonly onTimeout: (req: ConfirmationRequest) => ConfirmationStatus;
  private readonly minRiskForConfirmation: RiskLevel;

  private pendingRequests = new Map<string, ConfirmationRequest>();
  private auditLog: AuditEntry[] = [];
  private userPreferences = new Map<string, UserPreferences>(); // userId → prefs
  private batchQueue = new Map<string, ConfirmationRequest[]>(); // sessionId → pending low-risk

  constructor(config: HumanInLoopConfig = {}) {
    this.timeoutMs = config.timeoutMs ?? 5 * 60 * 1000;
    this.onConfirmationNeeded = config.onConfirmationNeeded;
    this.onBatchConfirmationNeeded = config.onBatchConfirmationNeeded;
    this.onTimeout = config.onTimeout ?? (() => "rejected");
    this.minRiskForConfirmation = config.minRiskForConfirmation ?? "high";
  }

  // ─── Public API ──────────────────────────────────────────────────────────────

  /** Evaluate whether a tool call needs confirmation before proceeding. */
  async gate(
    sessionId: string,
    userId: string,
    toolCall: ToolCallRequest
  ): Promise<{ allowed: boolean; status: ConfirmationStatus; requestId?: string }> {
    const risk = classifyRisk(toolCall);

    // Check user preferences first
    const prefs = this.userPreferences.get(userId);
    if (prefs?.autoApprove[toolCall.name]) {
      this.appendAudit(sessionId, toolCall, risk, "auto_approved");
      return { allowed: true, status: "auto_approved" };
    }
    if (prefs?.autoReject[toolCall.name]) {
      this.appendAudit(sessionId, toolCall, risk, "rejected");
      return { allowed: false, status: "rejected" };
    }

    // Check if risk meets confirmation threshold
    if (RISK_ORDER[risk.level] < RISK_ORDER[this.minRiskForConfirmation]) {
      // Below threshold — queue for batch or auto-approve low risk
      if (risk.level === "low") {
        this.appendAudit(sessionId, toolCall, risk, "auto_approved");
        return { allowed: true, status: "auto_approved" };
      }
      // Medium — queue for batch
      const batchStatus = this.queueForBatch(sessionId, toolCall, risk);
      if (batchStatus) {
        return { allowed: true, status: "auto_approved" };
      }
    }

    // Requires explicit confirmation
    const request = this.createRequest(sessionId, toolCall, risk);
    this.pendingRequests.set(request.id, request);

    Logger.info("[HumanInTheLoop] Requesting confirmation", {
      requestId: request.id,
      sessionId,
      tool: toolCall.name,
      risk: risk.level,
    });

    const status = await this.waitForConfirmation(request);
    this.appendAudit(sessionId, toolCall, risk, status, request.userNote);

    Logger.info("[HumanInTheLoop] Confirmation resolved", {
      requestId: request.id,
      status,
    });

    return { allowed: status === "approved" || status === "auto_approved", status, requestId: request.id };
  }

  /** Flush pending batch queue for a session and request bulk approval. */
  async flushBatch(sessionId: string): Promise<ConfirmationStatus> {
    const requests = this.batchQueue.get(sessionId) ?? [];
    if (requests.length === 0) return "approved";

    const batch: BatchConfirmation = {
      id: randomUUID(),
      sessionId,
      requests,
      status: "pending",
      createdAt: new Date(),
    };

    this.batchQueue.delete(sessionId);

    Logger.info("[HumanInTheLoop] Flushing batch confirmation", {
      sessionId,
      batchId: batch.id,
      count: requests.length,
    });

    if (this.onBatchConfirmationNeeded) {
      const status = await Promise.race([
        this.onBatchConfirmationNeeded(batch),
        this.timeoutPromise<ConfirmationStatus>(this.timeoutMs, "timeout"),
      ]);
      batch.status = status;
      batch.resolvedAt = new Date();

      for (const req of requests) {
        req.status = status;
        req.resolvedAt = new Date();
        this.appendAudit(sessionId, req.toolCall, req.risk, status);
      }

      return status;
    }

    // No handler — auto-approve medium risk batches
    for (const req of requests) {
      req.status = "auto_approved";
      this.appendAudit(sessionId, req.toolCall, req.risk, "auto_approved");
    }
    return "auto_approved";
  }

  /** Manually resolve a pending confirmation (called by UI or webhook). */
  resolve(requestId: string, approved: boolean, userNote?: string): void {
    const request = this.pendingRequests.get(requestId);
    if (!request) {
      Logger.warn("[HumanInTheLoop] Unknown requestId", { requestId });
      return;
    }
    request.status = approved ? "approved" : "rejected";
    request.resolvedAt = new Date();
    request.userNote = userNote;
    this.pendingRequests.delete(requestId);
  }

  /** Classify risk without gating (utility). */
  classify(toolCall: ToolCallRequest): RiskClassification {
    return classifyRisk(toolCall);
  }

  /** Update user preferences for auto-approve/auto-reject. */
  setPreference(userId: string, toolName: string, action: "auto_approve" | "auto_reject"): void {
    const prefs = this.userPreferences.get(userId) ?? {
      userId,
      autoApprove: {},
      autoReject: {},
      lastUpdated: new Date(),
    };

    if (action === "auto_approve") {
      prefs.autoApprove[toolName] = true;
      delete prefs.autoReject[toolName];
    } else {
      prefs.autoReject[toolName] = true;
      delete prefs.autoApprove[toolName];
    }

    prefs.lastUpdated = new Date();
    this.userPreferences.set(userId, prefs);

    Logger.info("[HumanInTheLoop] User preference updated", { userId, toolName, action });
  }

  /** Learn from approval history — if a tool is always approved, auto-approve it. */
  learnFromHistory(userId: string): string[] {
    const userEntries = this.auditLog.filter(
      (e) => e.status === "approved" || e.status === "auto_approved"
    );

    const toolApprovals = new Map<string, number>();
    const toolTotal = new Map<string, number>();

    for (const entry of userEntries) {
      toolTotal.set(entry.toolName, (toolTotal.get(entry.toolName) ?? 0) + 1);
      if (entry.status === "approved") {
        toolApprovals.set(entry.toolName, (toolApprovals.get(entry.toolName) ?? 0) + 1);
      }
    }

    const autoApproved: string[] = [];
    for (const [toolName, total] of toolTotal) {
      const approvals = toolApprovals.get(toolName) ?? 0;
      if (total >= 5 && approvals / total >= 1.0) {
        this.setPreference(userId, toolName, "auto_approve");
        autoApproved.push(toolName);
      }
    }

    return autoApproved;
  }

  /** Get the full audit trail for a session. */
  getAuditTrail(sessionId: string): AuditEntry[] {
    return this.auditLog.filter((e) => e.sessionId === sessionId);
  }

  /** Get full audit trail across all sessions. */
  getFullAuditLog(): AuditEntry[] {
    return [...this.auditLog];
  }

  // ─── Private helpers ──────────────────────────────────────────────────────────

  private createRequest(
    sessionId: string,
    toolCall: ToolCallRequest,
    risk: RiskClassification
  ): ConfirmationRequest {
    return {
      id: randomUUID(),
      sessionId,
      toolCall,
      risk,
      previewDescription: this.buildPreview(toolCall, risk),
      status: "pending",
      createdAt: new Date(),
    };
  }

  private buildPreview(toolCall: ToolCallRequest, risk: RiskClassification): string {
    const inputSummary = Object.entries(toolCall.input)
      .slice(0, 3)
      .map(([k, v]) => `${k}: ${JSON.stringify(v).slice(0, 60)}`)
      .join(", ");

    return `[${risk.level.toUpperCase()}] Tool "${toolCall.name}" — ${risk.reason}. Input: { ${inputSummary} }`;
  }

  private async waitForConfirmation(request: ConfirmationRequest): Promise<ConfirmationStatus> {
    if (!this.onConfirmationNeeded) {
      // No handler configured — auto-reject high-risk, auto-approve medium
      const status: ConfirmationStatus =
        request.risk.level === "critical" ? "rejected" : "auto_approved";
      request.status = status;
      return status;
    }

    const status = await Promise.race([
      this.onConfirmationNeeded(request),
      this.timeoutPromise<ConfirmationStatus>(this.timeoutMs, this.onTimeout(request)),
    ]);

    request.status = status;
    request.resolvedAt = new Date();
    return status;
  }

  private queueForBatch(
    sessionId: string,
    toolCall: ToolCallRequest,
    risk: RiskClassification
  ): boolean {
    const queue = this.batchQueue.get(sessionId) ?? [];
    const request = this.createRequest(sessionId, toolCall, risk);
    request.batchId = `batch_${sessionId}`;
    queue.push(request);
    this.batchQueue.set(sessionId, queue);
    return true;
  }

  private appendAudit(
    sessionId: string,
    toolCall: ToolCallRequest,
    risk: RiskClassification,
    status: ConfirmationStatus,
    userNote?: string
  ): void {
    this.auditLog.push({
      id: randomUUID(),
      sessionId,
      toolName: toolCall.name,
      toolInput: toolCall.input,
      riskLevel: risk.level,
      status,
      timestamp: new Date(),
      userNote,
    });
  }

  private timeoutPromise<T>(ms: number, value: T): Promise<T> {
    return new Promise((resolve) => setTimeout(() => resolve(value), ms));
  }
}
