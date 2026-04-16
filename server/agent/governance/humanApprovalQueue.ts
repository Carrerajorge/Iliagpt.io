import { EventEmitter } from "events";
import crypto from "crypto";

export type ApprovalStatus = "pending" | "approved" | "denied" | "expired" | "escalated";

export interface ApprovalRequest {
  id: string;
  action: string;
  description: string;
  riskLevel: string;
  impact: string;
  reversibility: "reversible" | "partially_reversible" | "irreversible";
  requestedBy: string;
  requestedAt: number;
  expiresAt: number;
  status: ApprovalStatus;
  reviewedBy: string | null;
  reviewedAt: number | null;
  reviewNotes: string | null;
  metadata: Record<string, unknown>;
  escalationLevel: number;
}

export interface ApprovalDecision {
  requestId: string;
  decision: "approved" | "denied";
  reviewedBy: string;
  notes: string;
}

export interface ApprovalConfig {
  defaultTimeoutMs: number;
  maxEscalationLevel: number;
  autoDenyOnExpiry: boolean;
  escalationIntervalMs: number;
}

const DEFAULT_CONFIG: ApprovalConfig = {
  defaultTimeoutMs: 300000,
  maxEscalationLevel: 3,
  autoDenyOnExpiry: true,
  escalationIntervalMs: 120000,
};

export class HumanApprovalQueue extends EventEmitter {
  private queue: Map<string, ApprovalRequest> = new Map();
  private history: ApprovalRequest[] = [];
  private config: ApprovalConfig;
  private expiryTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(config?: Partial<ApprovalConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  submit(params: {
    action: string;
    description: string;
    riskLevel: string;
    impact: string;
    reversibility: "reversible" | "partially_reversible" | "irreversible";
    requestedBy: string;
    metadata?: Record<string, unknown>;
    timeoutMs?: number;
  }): ApprovalRequest {
    const id = crypto.randomUUID();
    const now = Date.now();
    const timeoutMs = params.timeoutMs ?? this.config.defaultTimeoutMs;

    const request: ApprovalRequest = {
      id,
      action: params.action,
      description: params.description,
      riskLevel: params.riskLevel,
      impact: params.impact,
      reversibility: params.reversibility,
      requestedBy: params.requestedBy,
      requestedAt: now,
      expiresAt: now + timeoutMs,
      status: "pending",
      reviewedBy: null,
      reviewedAt: null,
      reviewNotes: null,
      metadata: params.metadata ?? {},
      escalationLevel: 0,
    };

    this.queue.set(id, request);
    this.emit("submitted", request);

    const timer = setTimeout(() => {
      this.handleExpiry(id);
    }, timeoutMs);
    this.expiryTimers.set(id, timer);

    return request;
  }

  decide(decision: ApprovalDecision): ApprovalRequest {
    const request = this.queue.get(decision.requestId);
    if (!request) {
      throw new Error(`Approval request ${decision.requestId} not found`);
    }

    if (request.status !== "pending" && request.status !== "escalated") {
      throw new Error(`Request ${decision.requestId} is already ${request.status}`);
    }

    request.status = decision.decision;
    request.reviewedBy = decision.reviewedBy;
    request.reviewedAt = Date.now();
    request.reviewNotes = decision.notes;

    const timer = this.expiryTimers.get(decision.requestId);
    if (timer) {
      clearTimeout(timer);
      this.expiryTimers.delete(decision.requestId);
    }

    this.queue.delete(decision.requestId);
    this.history.push({ ...request });

    this.emit("decided", request);
    this.emit(decision.decision, request);

    return request;
  }

  private handleExpiry(id: string): void {
    const request = this.queue.get(id);
    if (!request || request.status !== "pending") return;

    if (request.escalationLevel < this.config.maxEscalationLevel) {
      request.escalationLevel++;
      request.status = "escalated";
      request.expiresAt = Date.now() + this.config.escalationIntervalMs;

      const timer = setTimeout(() => {
        this.handleExpiry(id);
      }, this.config.escalationIntervalMs);
      this.expiryTimers.set(id, timer);

      this.emit("escalated", request);
      return;
    }

    if (this.config.autoDenyOnExpiry) {
      request.status = "expired";
      request.reviewedAt = Date.now();
      request.reviewNotes = "Auto-denied: approval timeout exceeded after max escalation";

      this.queue.delete(id);
      this.expiryTimers.delete(id);
      this.history.push({ ...request });

      this.emit("expired", request);
      this.emit("denied", request);
    }
  }

  getPending(): ApprovalRequest[] {
    return Array.from(this.queue.values()).filter(
      r => r.status === "pending" || r.status === "escalated"
    );
  }

  getHistory(limit: number = 50): ApprovalRequest[] {
    return this.history.slice(-limit);
  }

  getRequest(id: string): ApprovalRequest | undefined {
    return this.queue.get(id) || this.history.find(r => r.id === id);
  }

  getStats() {
    const pending = this.getPending();
    const recentHistory = this.history.slice(-100);
    const approved = recentHistory.filter(r => r.status === "approved").length;
    const denied = recentHistory.filter(r => r.status === "denied").length;
    const expired = recentHistory.filter(r => r.status === "expired").length;

    return {
      pendingCount: pending.length,
      escalatedCount: pending.filter(r => r.status === "escalated").length,
      recentApproved: approved,
      recentDenied: denied,
      recentExpired: expired,
      totalProcessed: this.history.length,
      averageResponseTimeMs: this.calculateAverageResponseTime(recentHistory),
    };
  }

  private calculateAverageResponseTime(items: ApprovalRequest[]): number {
    const reviewed = items.filter(r => r.reviewedAt && r.status !== "expired");
    if (reviewed.length === 0) return 0;
    const total = reviewed.reduce((sum, r) => sum + ((r.reviewedAt || 0) - r.requestedAt), 0);
    return Math.round(total / reviewed.length);
  }

  cleanup(): void {
    for (const timer of this.expiryTimers.values()) {
      clearTimeout(timer);
    }
    this.expiryTimers.clear();
  }
}

export const humanApprovalQueue = new HumanApprovalQueue();
