import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import pino from "pino";
import {
  getClaudeAgentBackbone,
  CLAUDE_MODELS,
  type AgentMessage,
} from "./ClaudeAgentBackbone.js";

const logger = pino({ name: "HumanInTheLoop" });

// ─── Types ────────────────────────────────────────────────────────────────────

export type RiskLevel = "low" | "medium" | "high" | "critical";

export type ApprovalStatus =
  | "pending"
  | "auto_approved"
  | "approved"
  | "rejected"
  | "modified"
  | "expired"
  | "batched";

export interface ActionProposal {
  proposalId: string;
  agentId: string;
  sessionId: string;
  userId: string;
  /** The action the agent wants to take */
  action: string;
  actionType: string;
  /** Structured input to the action */
  input: Record<string, unknown>;
  /** Why the agent wants to do this */
  rationale: string;
  /** Consequences if action is taken */
  preview: ActionPreview;
  riskLevel: RiskLevel;
  riskFactors: string[];
  /** Modified input if user chooses to modify */
  modifiedInput?: Record<string, unknown>;
  status: ApprovalStatus;
  requestedAt: number;
  resolvedAt?: number;
  resolvedBy?: string;
  expiresAt: number;
  /** Whether this was batched with other low-risk actions */
  batchId?: string;
}

export interface ActionPreview {
  summary: string;
  affectedResources: string[];
  reversible: boolean;
  estimatedImpact: "minimal" | "moderate" | "significant" | "irreversible";
  sideEffects: string[];
  alternativeActions?: string[];
}

export interface UserPreference {
  userId: string;
  pattern: string; // action type or keyword pattern
  preferredDecision: "auto_approve" | "auto_reject" | "always_review";
  confidence: number; // 0-1 from observed behavior
  learnedAt: number;
  updatedAt: number;
  sampleSize: number;
}

export interface ApprovalBatch {
  batchId: string;
  agentId: string;
  userId: string;
  proposals: string[]; // proposalIds
  createdAt: number;
  expiresAt: number;
  status: "pending" | "resolved" | "expired";
}

export interface HITLConfig {
  /** Auto-approve actions below this risk level */
  autoApproveBelow?: RiskLevel; // default "low"
  /** Timeout in ms for pending approvals */
  approvalTimeoutMs?: number; // default 300_000 (5 minutes)
  /** Batch low-risk actions and present at once */
  enableBatching?: boolean; // default true
  /** Batch window in ms */
  batchWindowMs?: number; // default 30_000
  /** Enable preference learning */
  enablePreferenceLearning?: boolean; // default true
  /** Min samples to trust a learned preference */
  minSamplesForLearning?: number; // default 5
}

// ─── Risk classifier ──────────────────────────────────────────────────────────

const RISK_KEYWORDS: Record<RiskLevel, string[]> = {
  low: [
    "read",
    "get",
    "list",
    "fetch",
    "search",
    "query",
    "view",
    "analyze",
    "summarize",
    "describe",
  ],
  medium: [
    "create",
    "write",
    "update",
    "modify",
    "post",
    "send",
    "save",
    "insert",
    "upload",
  ],
  high: [
    "delete",
    "remove",
    "drop",
    "truncate",
    "reset",
    "replace",
    "overwrite",
    "publish",
    "deploy",
    "execute",
    "run",
    "install",
  ],
  critical: [
    "rm -rf",
    "format",
    "wipe",
    "destroy",
    "shutdown",
    "kill",
    "terminate",
    "revoke",
    "mass",
    "bulk delete",
    "drop table",
    "truncate table",
  ],
};

function quickClassifyRisk(
  action: string,
  actionType: string
): RiskLevel {
  const combined = `${action} ${actionType}`.toLowerCase();

  // Check from most critical to least
  for (const level of ["critical", "high", "medium", "low"] as RiskLevel[]) {
    if (RISK_KEYWORDS[level].some((kw) => combined.includes(kw))) {
      return level;
    }
  }

  return "medium"; // default to medium if unknown
}

// ─── HumanInTheLoop ───────────────────────────────────────────────────────────

export class HumanInTheLoop extends EventEmitter {
  private proposals = new Map<string, ActionProposal>();
  private pendingByUser = new Map<string, Set<string>>(); // userId → proposalIds
  private batches = new Map<string, ApprovalBatch>();
  private batchTimers = new Map<string, NodeJS.Timeout>(); // userId:agentId → timer
  private preferences = new Map<string, UserPreference[]>(); // userId → preferences
  private decisionHistory: Array<{
    userId: string;
    actionType: string;
    riskLevel: RiskLevel;
    decision: "approved" | "rejected" | "modified";
    timestamp: number;
  }> = [];

  constructor(
    private readonly backbone = getClaudeAgentBackbone(),
    private readonly config: HITLConfig = {}
  ) {
    super();
    const {
      autoApproveBelow = "low",
      approvalTimeoutMs = 300_000,
      enableBatching = true,
      batchWindowMs = 30_000,
      enablePreferenceLearning = true,
      minSamplesForLearning = 5,
    } = config;

    this.config = {
      autoApproveBelow,
      approvalTimeoutMs,
      enableBatching,
      batchWindowMs,
      enablePreferenceLearning,
      minSamplesForLearning,
    };

    logger.info("[HumanInTheLoop] Initialized");
  }

  // ── Proposal creation ─────────────────────────────────────────────────────────

  async propose(
    agentId: string,
    sessionId: string,
    userId: string,
    action: string,
    actionType: string,
    input: Record<string, unknown>,
    rationale: string
  ): Promise<ActionProposal> {
    // Quick risk classification
    const quickRisk = quickClassifyRisk(action, actionType);

    // Get detailed risk + preview from LLM
    const { riskLevel, riskFactors, preview } = await this.assessRisk(
      action,
      actionType,
      input,
      rationale,
      quickRisk
    );

    const expiresAt =
      Date.now() + (this.config.approvalTimeoutMs ?? 300_000);

    const proposal: ActionProposal = {
      proposalId: randomUUID(),
      agentId,
      sessionId,
      userId,
      action,
      actionType,
      input,
      rationale,
      preview,
      riskLevel,
      riskFactors,
      status: "pending",
      requestedAt: Date.now(),
      expiresAt,
    };

    this.proposals.set(proposal.proposalId, proposal);

    // Track by user
    const userPending = this.pendingByUser.get(userId) ?? new Set();
    userPending.add(proposal.proposalId);
    this.pendingByUser.set(userId, userPending);

    // Set expiry timer
    setTimeout(() => this.expireProposal(proposal.proposalId), expiresAt - Date.now());

    logger.info(
      {
        proposalId: proposal.proposalId,
        agentId,
        actionType,
        riskLevel,
        userId,
      },
      "[HumanInTheLoop] Action proposed"
    );

    this.emit("proposal:created", proposal);

    // Route based on risk level and user preferences
    const resolved = await this.autoRoute(proposal);
    return resolved;
  }

  // ── Auto-routing ──────────────────────────────────────────────────────────────

  private async autoRoute(proposal: ActionProposal): Promise<ActionProposal> {
    const riskLevels: RiskLevel[] = ["low", "medium", "high", "critical"];
    const autoApproveBelow = this.config.autoApproveBelow ?? "low";
    const autoApproveIndex = riskLevels.indexOf(autoApproveBelow);
    const proposalIndex = riskLevels.indexOf(proposal.riskLevel);

    // Check user preferences first
    const learnedDecision = this.getLearnedDecision(
      proposal.userId,
      proposal.actionType
    );

    if (learnedDecision === "auto_approve") {
      return this.autoApprove(proposal, "learned_preference");
    }

    if (learnedDecision === "auto_reject") {
      return this.autoReject(proposal, "learned_preference");
    }

    // Auto-approve below threshold
    if (proposalIndex <= autoApproveIndex) {
      return this.autoApprove(proposal, "below_risk_threshold");
    }

    // Batch medium risk
    if (
      this.config.enableBatching &&
      proposal.riskLevel === "medium"
    ) {
      return this.addToBatch(proposal);
    }

    // Require manual approval for high/critical
    this.emit("approval:required", proposal);
    return proposal;
  }

  private autoApprove(
    proposal: ActionProposal,
    reason: string
  ): ActionProposal {
    proposal.status = "auto_approved";
    proposal.resolvedAt = Date.now();
    proposal.resolvedBy = "system";

    logger.debug(
      {
        proposalId: proposal.proposalId,
        reason,
        riskLevel: proposal.riskLevel,
      },
      "[HumanInTheLoop] Auto-approved"
    );

    this.emit("proposal:auto_approved", { proposal, reason });
    return proposal;
  }

  private autoReject(
    proposal: ActionProposal,
    reason: string
  ): ActionProposal {
    proposal.status = "rejected";
    proposal.resolvedAt = Date.now();
    proposal.resolvedBy = "system";

    this.emit("proposal:rejected", { proposal, reason });
    return proposal;
  }

  private addToBatch(proposal: ActionProposal): ActionProposal {
    const batchKey = `${proposal.userId}:${proposal.agentId}`;
    proposal.status = "batched";

    let batchId = this.getBatchForKey(batchKey);

    if (!batchId) {
      const batch: ApprovalBatch = {
        batchId: randomUUID(),
        agentId: proposal.agentId,
        userId: proposal.userId,
        proposals: [],
        createdAt: Date.now(),
        expiresAt: Date.now() + (this.config.batchWindowMs ?? 30_000),
        status: "pending",
      };
      batchId = batch.batchId;
      this.batches.set(batchId, batch);

      // Set batch flush timer
      const timer = setTimeout(
        () => this.flushBatch(batchKey, batchId!),
        this.config.batchWindowMs ?? 30_000
      );
      this.batchTimers.set(batchKey, timer);
    }

    const batch = this.batches.get(batchId)!;
    batch.proposals.push(proposal.proposalId);
    proposal.batchId = batchId;

    logger.debug(
      { proposalId: proposal.proposalId, batchId, size: batch.proposals.length },
      "[HumanInTheLoop] Added to batch"
    );

    this.emit("proposal:batched", { proposal, batchId });
    return proposal;
  }

  private getBatchForKey(batchKey: string): string | null {
    const [userId, agentId] = batchKey.split(":");
    for (const [id, batch] of this.batches.entries()) {
      if (
        batch.userId === userId &&
        batch.agentId === agentId &&
        batch.status === "pending" &&
        batch.expiresAt > Date.now()
      ) {
        return id;
      }
    }
    return null;
  }

  private flushBatch(batchKey: string, batchId: string): void {
    const batch = this.batches.get(batchId);
    if (!batch || batch.status !== "pending") return;

    this.batchTimers.delete(batchKey);

    const proposals = batch.proposals
      .map((id) => this.proposals.get(id))
      .filter(Boolean) as ActionProposal[];

    this.emit("batch:ready", { batch, proposals });
    logger.info(
      { batchId, proposals: batch.proposals.length },
      "[HumanInTheLoop] Batch ready for review"
    );
  }

  // ── Manual approval ───────────────────────────────────────────────────────────

  approve(
    proposalId: string,
    approvedBy: string,
    modifiedInput?: Record<string, unknown>
  ): ActionProposal {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) throw new Error(`Proposal '${proposalId}' not found`);

    if (proposal.status !== "pending" && proposal.status !== "batched") {
      throw new Error(`Proposal '${proposalId}' is not pending (status: ${proposal.status})`);
    }

    proposal.status = modifiedInput ? "modified" : "approved";
    proposal.resolvedAt = Date.now();
    proposal.resolvedBy = approvedBy;
    if (modifiedInput) proposal.modifiedInput = modifiedInput;

    // Remove from pending
    this.pendingByUser.get(proposal.userId)?.delete(proposalId);

    // Learn from decision
    if (this.config.enablePreferenceLearning) {
      this.learnFromDecision(
        proposal.userId,
        proposal.actionType,
        proposal.riskLevel,
        "approved"
      );
    }

    logger.info(
      { proposalId, approvedBy, modified: !!modifiedInput },
      "[HumanInTheLoop] Proposal approved"
    );

    this.emit("proposal:approved", { proposal, approvedBy });
    return proposal;
  }

  reject(
    proposalId: string,
    rejectedBy: string,
    reason?: string
  ): ActionProposal {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) throw new Error(`Proposal '${proposalId}' not found`);

    proposal.status = "rejected";
    proposal.resolvedAt = Date.now();
    proposal.resolvedBy = rejectedBy;

    this.pendingByUser.get(proposal.userId)?.delete(proposalId);

    if (this.config.enablePreferenceLearning) {
      this.learnFromDecision(
        proposal.userId,
        proposal.actionType,
        proposal.riskLevel,
        "rejected"
      );
    }

    logger.info({ proposalId, rejectedBy, reason }, "[HumanInTheLoop] Proposal rejected");
    this.emit("proposal:rejected", { proposal, rejectedBy, reason });
    return proposal;
  }

  approveBatch(
    batchId: string,
    approvedBy: string,
    individualOverrides: Record<string, "approve" | "reject"> = {}
  ): ActionProposal[] {
    const batch = this.batches.get(batchId);
    if (!batch) throw new Error(`Batch '${batchId}' not found`);

    batch.status = "resolved";
    const results: ActionProposal[] = [];

    for (const proposalId of batch.proposals) {
      const decision = individualOverrides[proposalId] ?? "approve";
      try {
        if (decision === "approve") {
          results.push(this.approve(proposalId, approvedBy));
        } else {
          results.push(this.reject(proposalId, approvedBy));
        }
      } catch {
        // Proposal may have expired
      }
    }

    this.emit("batch:resolved", { batchId, results });
    return results;
  }

  // ── Risk assessment ───────────────────────────────────────────────────────────

  private async assessRisk(
    action: string,
    actionType: string,
    input: Record<string, unknown>,
    rationale: string,
    quickRisk: RiskLevel
  ): Promise<{ riskLevel: RiskLevel; riskFactors: string[]; preview: ActionPreview }> {
    // For low risk, skip LLM call
    if (quickRisk === "low") {
      return {
        riskLevel: "low",
        riskFactors: [],
        preview: {
          summary: `${actionType}: ${action.slice(0, 100)}`,
          affectedResources: [],
          reversible: true,
          estimatedImpact: "minimal",
          sideEffects: [],
        },
      };
    }

    const messages: AgentMessage[] = [
      {
        role: "user",
        content: `Assess the risk of this AI agent action.

ACTION: ${action}
TYPE: ${actionType}
INPUT: ${JSON.stringify(input, null, 2).slice(0, 500)}
RATIONALE: ${rationale}
INITIAL RISK ESTIMATE: ${quickRisk}

Output JSON:
{
  "riskLevel": "low|medium|high|critical",
  "riskFactors": ["factor 1", "factor 2"],
  "preview": {
    "summary": "what will happen",
    "affectedResources": ["resource1"],
    "reversible": true,
    "estimatedImpact": "minimal|moderate|significant|irreversible",
    "sideEffects": ["side effect 1"],
    "alternativeActions": ["safer alternative"]
  }
}

Return ONLY valid JSON.`,
      },
    ];

    try {
      const response = await this.backbone.call(messages, {
        model: CLAUDE_MODELS.HAIKU,
        maxTokens: 512,
        system:
          "You assess AI agent action risks for human oversight. Be precise and conservative.",
      });

      const jsonMatch = response.text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as {
          riskLevel?: RiskLevel;
          riskFactors?: string[];
          preview?: ActionPreview;
        };

        return {
          riskLevel: parsed.riskLevel ?? quickRisk,
          riskFactors: Array.isArray(parsed.riskFactors) ? parsed.riskFactors : [],
          preview: parsed.preview ?? {
            summary: `${actionType}: ${action.slice(0, 100)}`,
            affectedResources: [],
            reversible: true,
            estimatedImpact: "moderate",
            sideEffects: [],
          },
        };
      }
    } catch {
      // Fall through to quick risk
    }

    return {
      riskLevel: quickRisk,
      riskFactors: [`${actionType} action detected`],
      preview: {
        summary: `${actionType}: ${action.slice(0, 100)}`,
        affectedResources: [],
        reversible: quickRisk === "low" || quickRisk === "medium",
        estimatedImpact:
          quickRisk === "critical"
            ? "irreversible"
            : quickRisk === "high"
            ? "significant"
            : "moderate",
        sideEffects: [],
      },
    };
  }

  // ── Preference learning ───────────────────────────────────────────────────────

  private learnFromDecision(
    userId: string,
    actionType: string,
    riskLevel: RiskLevel,
    decision: "approved" | "rejected" | "modified"
  ): void {
    this.decisionHistory.push({
      userId,
      actionType,
      riskLevel,
      decision,
      timestamp: Date.now(),
    });

    // Only learn from consistent behavior
    const minSamples = this.config.minSamplesForLearning ?? 5;
    const userHistory = this.decisionHistory.filter(
      (d) =>
        d.userId === userId &&
        d.actionType === actionType &&
        d.riskLevel === riskLevel &&
        d.timestamp > Date.now() - 30 * 24 * 60 * 60 * 1000 // last 30 days
    );

    if (userHistory.length < minSamples) return;

    const approveRate =
      userHistory.filter((d) => d.decision === "approved").length /
      userHistory.length;

    let preferredDecision: UserPreference["preferredDecision"];
    if (approveRate >= 0.9) preferredDecision = "auto_approve";
    else if (approveRate <= 0.1) preferredDecision = "auto_reject";
    else return; // Mixed — don't learn

    const userPrefs = this.preferences.get(userId) ?? [];
    const pattern = `${actionType}:${riskLevel}`;
    const existing = userPrefs.find((p) => p.pattern === pattern);

    if (existing) {
      existing.confidence = approveRate >= 0.9 ? approveRate : 1 - approveRate;
      existing.preferredDecision = preferredDecision;
      existing.sampleSize = userHistory.length;
      existing.updatedAt = Date.now();
    } else {
      userPrefs.push({
        userId,
        pattern,
        preferredDecision,
        confidence: approveRate >= 0.9 ? approveRate : 1 - approveRate,
        learnedAt: Date.now(),
        updatedAt: Date.now(),
        sampleSize: userHistory.length,
      });
      this.preferences.set(userId, userPrefs);

      logger.info(
        { userId, pattern, preferredDecision, confidence: approveRate },
        "[HumanInTheLoop] Preference learned"
      );

      this.emit("preference:learned", { userId, pattern, preferredDecision });
    }
  }

  private getLearnedDecision(
    userId: string,
    actionType: string
  ): UserPreference["preferredDecision"] | null {
    const prefs = this.preferences.get(userId) ?? [];
    // Check exact match first, then type-only match
    for (const riskLevel of ["low", "medium", "high", "critical"] as RiskLevel[]) {
      const pref = prefs.find(
        (p) => p.pattern === `${actionType}:${riskLevel}` && p.confidence >= 0.9
      );
      if (pref) return pref.preferredDecision;
    }
    return null;
  }

  // ── Expiry ────────────────────────────────────────────────────────────────────

  private expireProposal(proposalId: string): void {
    const proposal = this.proposals.get(proposalId);
    if (!proposal || proposal.status !== "pending") return;

    proposal.status = "expired";
    this.pendingByUser.get(proposal.userId)?.delete(proposalId);

    logger.warn(
      { proposalId, agentId: proposal.agentId },
      "[HumanInTheLoop] Proposal expired"
    );

    this.emit("proposal:expired", proposal);
  }

  // ── Queries ───────────────────────────────────────────────────────────────────

  getPendingProposals(userId: string): ActionProposal[] {
    const ids = this.pendingByUser.get(userId) ?? new Set();
    return Array.from(ids)
      .map((id) => this.proposals.get(id))
      .filter(
        (p): p is ActionProposal =>
          !!p && p.status === "pending" && p.expiresAt > Date.now()
      )
      .sort((a, b) => {
        // Sort: critical first, then by age (oldest first)
        const riskOrder: RiskLevel[] = ["critical", "high", "medium", "low"];
        const riskDiff =
          riskOrder.indexOf(a.riskLevel) - riskOrder.indexOf(b.riskLevel);
        return riskDiff !== 0 ? riskDiff : a.requestedAt - b.requestedAt;
      });
  }

  getPendingBatches(userId: string): ApprovalBatch[] {
    return Array.from(this.batches.values()).filter(
      (b) =>
        b.userId === userId &&
        b.status === "pending" &&
        b.expiresAt > Date.now()
    );
  }

  getProposal(proposalId: string): ActionProposal | null {
    return this.proposals.get(proposalId) ?? null;
  }

  getUserPreferences(userId: string): UserPreference[] {
    return this.preferences.get(userId) ?? [];
  }

  clearUserPreferences(userId: string): void {
    this.preferences.delete(userId);
    this.emit("preferences:cleared", { userId });
  }

  getStats() {
    const allProposals = Array.from(this.proposals.values());
    return {
      totalProposals: allProposals.length,
      pending: allProposals.filter((p) => p.status === "pending").length,
      autoApproved: allProposals.filter((p) => p.status === "auto_approved").length,
      approved: allProposals.filter((p) => p.status === "approved").length,
      rejected: allProposals.filter((p) => p.status === "rejected").length,
      expired: allProposals.filter((p) => p.status === "expired").length,
      batched: allProposals.filter((p) => p.status === "batched").length,
      learnedPreferences: [...this.preferences.values()].reduce(
        (s, prefs) => s + prefs.length,
        0
      ),
      pendingBatches: Array.from(this.batches.values()).filter(
        (b) => b.status === "pending"
      ).length,
    };
  }
}

// ─── Singleton ─────────────────────────────────────────────────────────────────

let _instance: HumanInTheLoop | null = null;

export function getHumanInTheLoop(config?: HITLConfig): HumanInTheLoop {
  if (!_instance) _instance = new HumanInTheLoop(undefined, config);
  return _instance;
}
