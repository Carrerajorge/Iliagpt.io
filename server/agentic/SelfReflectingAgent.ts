import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import pino from "pino";
import {
  getClaudeAgentBackbone,
  CLAUDE_MODELS,
  type AgentMessage,
} from "./ClaudeAgentBackbone.js";

const logger = pino({ name: "SelfReflectingAgent" });

// ─── Types ────────────────────────────────────────────────────────────────────

export type ReflectionTrigger =
  | "post_action"
  | "goal_check"
  | "periodic"
  | "failure"
  | "completion"
  | "forced";

export type ReflectionOutcome =
  | "on_track"
  | "adjust_approach"
  | "replan"
  | "escalate_to_user"
  | "abandon_goal"
  | "success";

export interface ActionRecord {
  actionId: string;
  agentId: string;
  actionType: string;
  description: string;
  toolUsed?: string;
  toolInput?: Record<string, unknown>;
  result?: unknown;
  success: boolean;
  error?: string;
  tokensUsed: number;
  durationMs: number;
  timestamp: number;
  goalRelevance?: number; // 0-1 how relevant was this to the goal
}

export interface ReflectionEntry {
  reflectionId: string;
  agentId: string;
  trigger: ReflectionTrigger;
  timestamp: number;

  // What the agent reflected on
  actionsReviewed: string[]; // actionIds
  currentGoal: string;
  goalProgress: number; // 0-1 estimated progress

  // Reflection content
  thinkingContent: string;
  observations: string[];
  lessons: string[];
  adjustments: string[];

  // Outcome
  outcome: ReflectionOutcome;
  confidence: number; // 0-1 how confident in outcome assessment
  shouldEscalate: boolean;
  escalationReason?: string;

  // Pattern flags
  patternFlags: PatternFlag[];
}

export interface PatternFlag {
  type:
    | "repeated_failure"
    | "circular_behavior"
    | "goal_drift"
    | "low_progress"
    | "tool_overuse"
    | "excessive_reflection";
  description: string;
  severity: "low" | "medium" | "high" | "critical";
  evidence: string[];
  firstDetected: number;
  occurrences: number;
}

export interface ConfidenceTracker {
  agentId: string;
  goalConfidence: number; // 0-1
  methodConfidence: number; // 0-1
  toolConfidence: Record<string, number>; // tool → confidence
  overallTrend: "improving" | "stable" | "declining";
  lastUpdated: number;
  history: Array<{ timestamp: number; overall: number; reason: string }>;
}

export interface ReflectionConfig {
  reflectEveryNActions?: number; // default 3
  minConfidenceThreshold?: number; // default 0.3 — below this, escalate
  maxReflectionDepth?: number; // default 5 — max consecutive reflections
  enablePatternDetection?: boolean; // default true
  thinkingBudgetTokens?: number; // default 8000
  escalateOnCriticalPattern?: boolean; // default true
}

// ─── Pattern detector ─────────────────────────────────────────────────────────

class PatternDetector {
  private flagHistory = new Map<string, PatternFlag>(); // type → flag

  detect(
    actions: ActionRecord[],
    reflections: ReflectionEntry[],
    goal: string
  ): PatternFlag[] {
    const flags: PatternFlag[] = [];

    // Repeated failure: 3+ consecutive failed actions
    const recentActions = actions.slice(-10);
    const consecutiveFails = this.longestFailStreak(recentActions);
    if (consecutiveFails >= 3) {
      flags.push(
        this.makeFlag("repeated_failure", consecutiveFails, [
          `${consecutiveFails} consecutive failed actions`,
          recentActions
            .filter((a) => !a.success)
            .slice(-3)
            .map((a) => a.description)
            .join("; "),
        ])
      );
    }

    // Circular behavior: same tool + similar input 3+ times in last 8 actions
    const toolUsageCounts = new Map<string, number>();
    for (const action of recentActions) {
      if (action.toolUsed) {
        toolUsageCounts.set(
          action.toolUsed,
          (toolUsageCounts.get(action.toolUsed) ?? 0) + 1
        );
      }
    }
    for (const [tool, count] of toolUsageCounts.entries()) {
      if (count >= 3) {
        flags.push(
          this.makeFlag("circular_behavior", count, [
            `Tool '${tool}' called ${count} times in last ${recentActions.length} actions`,
          ])
        );
      }
    }

    // Goal drift: recent actions have low goalRelevance
    const relevanceScores = recentActions
      .map((a) => a.goalRelevance ?? 0.5)
      .slice(-5);
    const avgRelevance =
      relevanceScores.reduce((s, r) => s + r, 0) / relevanceScores.length;
    if (avgRelevance < 0.35 && recentActions.length >= 5) {
      flags.push(
        this.makeFlag("goal_drift", 1, [
          `Average goal relevance = ${avgRelevance.toFixed(2)} over last 5 actions`,
          `Goal: ${goal.slice(0, 80)}`,
        ])
      );
    }

    // Low progress: multiple reflections with no improvement
    const recentReflections = reflections.slice(-5);
    const progressValues = recentReflections.map((r) => r.goalProgress);
    if (progressValues.length >= 3) {
      const progressRange =
        Math.max(...progressValues) - Math.min(...progressValues);
      if (progressRange < 0.05) {
        flags.push(
          this.makeFlag("low_progress", progressValues.length, [
            `Goal progress stuck at ~${(progressValues.at(-1) ?? 0).toFixed(2)} across ${progressValues.length} reflections`,
          ])
        );
      }
    }

    // Excessive reflection: agent reflecting more than acting
    const reflectionRatio =
      actions.length > 0 ? reflections.length / actions.length : 0;
    if (reflectionRatio > 2 && reflections.length > 4) {
      flags.push(
        this.makeFlag("excessive_reflection", reflections.length, [
          `${reflections.length} reflections vs ${actions.length} actions (ratio: ${reflectionRatio.toFixed(1)})`,
        ])
      );
    }

    // Update history and assign severity
    for (const flag of flags) {
      const existing = this.flagHistory.get(flag.type);
      if (existing) {
        flag.occurrences = existing.occurrences + 1;
        flag.firstDetected = existing.firstDetected;
        flag.severity = this.escalateSeverity(flag.type, flag.occurrences);
      }
      this.flagHistory.set(flag.type, flag);
    }

    return flags;
  }

  private longestFailStreak(actions: ActionRecord[]): number {
    let max = 0;
    let current = 0;
    for (const a of actions) {
      if (!a.success) {
        current++;
        max = Math.max(max, current);
      } else {
        current = 0;
      }
    }
    return max;
  }

  private makeFlag(
    type: PatternFlag["type"],
    occurrences: number,
    evidence: string[]
  ): PatternFlag {
    return {
      type,
      description: this.flagDescription(type),
      severity: this.escalateSeverity(type, occurrences),
      evidence,
      firstDetected: Date.now(),
      occurrences,
    };
  }

  private flagDescription(type: PatternFlag["type"]): string {
    const descriptions: Record<PatternFlag["type"], string> = {
      repeated_failure: "Multiple consecutive action failures detected",
      circular_behavior: "Agent repeating same actions without progress",
      goal_drift: "Actions diverging from stated goal",
      low_progress: "Goal progress stagnant across multiple reflections",
      tool_overuse: "Over-relying on a single tool",
      excessive_reflection: "Reflecting more than acting — analysis paralysis",
    };
    return descriptions[type];
  }

  private escalateSeverity(
    type: PatternFlag["type"],
    occurrences: number
  ): PatternFlag["severity"] {
    if (occurrences >= 5) return "critical";
    if (occurrences >= 3) return "high";
    if (
      type === "circular_behavior" ||
      type === "repeated_failure"
    ) {
      return occurrences >= 2 ? "high" : "medium";
    }
    return "medium";
  }

  reset(): void {
    this.flagHistory.clear();
  }
}

// ─── SelfReflectingAgent ──────────────────────────────────────────────────────

export class SelfReflectingAgent extends EventEmitter {
  private actions = new Map<string, ActionRecord[]>(); // agentId → actions
  private reflections = new Map<string, ReflectionEntry[]>(); // agentId → reflections
  private confidence = new Map<string, ConfidenceTracker>(); // agentId → tracker
  private patternDetectors = new Map<string, PatternDetector>(); // agentId → detector
  private actionCounters = new Map<string, number>(); // agentId → count since last reflection
  private reflectionDepth = new Map<string, number>(); // agentId → consecutive reflections

  constructor(
    private readonly backbone = getClaudeAgentBackbone(),
    private readonly config: ReflectionConfig = {}
  ) {
    super();
    const {
      reflectEveryNActions = 3,
      minConfidenceThreshold = 0.3,
      maxReflectionDepth = 5,
      enablePatternDetection = true,
      thinkingBudgetTokens = 8_000,
      escalateOnCriticalPattern = true,
    } = config;

    this.config = {
      reflectEveryNActions,
      minConfidenceThreshold,
      maxReflectionDepth,
      enablePatternDetection,
      thinkingBudgetTokens,
      escalateOnCriticalPattern,
    };

    logger.info("[SelfReflectingAgent] Initialized");
  }

  // ── Action recording ──────────────────────────────────────────────────────────

  recordAction(action: Omit<ActionRecord, "actionId" | "timestamp">): ActionRecord {
    const record: ActionRecord = {
      ...action,
      actionId: randomUUID(),
      timestamp: Date.now(),
    };

    const agentActions = this.actions.get(action.agentId) ?? [];
    agentActions.push(record);
    this.actions.set(action.agentId, agentActions);

    // Track action count since last reflection
    const count = (this.actionCounters.get(action.agentId) ?? 0) + 1;
    this.actionCounters.set(action.agentId, count);

    // Reset reflection depth when acting (not consecutive reflections)
    this.reflectionDepth.set(action.agentId, 0);

    logger.debug(
      { agentId: action.agentId, type: action.actionType, success: action.success },
      "[SelfReflectingAgent] Action recorded"
    );

    this.emit("action:recorded", record);

    // Auto-trigger reflection if threshold reached
    if (count >= (this.config.reflectEveryNActions ?? 3)) {
      // Don't await — reflection happens asynchronously
      this.emit("reflection:due", { agentId: action.agentId, trigger: "post_action" });
    }

    return record;
  }

  // ── Reflection ────────────────────────────────────────────────────────────────

  async reflect(
    agentId: string,
    goal: string,
    trigger: ReflectionTrigger = "post_action"
  ): Promise<ReflectionEntry> {
    const depth = this.reflectionDepth.get(agentId) ?? 0;
    const maxDepth = this.config.maxReflectionDepth ?? 5;

    if (depth >= maxDepth) {
      logger.warn(
        { agentId, depth, maxDepth },
        "[SelfReflectingAgent] Max reflection depth reached — forcing escalation"
      );
      return this.buildForcedEscalationReflection(agentId, goal, depth);
    }

    this.reflectionDepth.set(agentId, depth + 1);

    const agentActions = this.actions.get(agentId) ?? [];
    const agentReflections = this.reflections.get(agentId) ?? [];
    const lastReflection = agentReflections.at(-1);

    // Detect patterns before calling LLM
    let patternFlags: PatternFlag[] = [];
    if (this.config.enablePatternDetection) {
      const detector =
        this.patternDetectors.get(agentId) ?? new PatternDetector();
      this.patternDetectors.set(agentId, detector);
      patternFlags = detector.detect(agentActions, agentReflections, goal);
    }

    // Build reflection context
    const recentActions = agentActions.slice(-8);
    const actionSummary = recentActions
      .map(
        (a) =>
          `[${a.success ? "✓" : "✗"}] ${a.actionType}: ${a.description}${
            a.error ? ` → ERROR: ${a.error}` : ""
          }`
      )
      .join("\n");

    const patternSummary =
      patternFlags.length > 0
        ? `\nDETECTED PATTERNS:\n${patternFlags
            .map((p) => `- [${p.severity.toUpperCase()}] ${p.type}: ${p.description}`)
            .join("\n")}`
        : "";

    const lastProgressNote = lastReflection
      ? `\nLast reflection: progress was ${(lastReflection.goalProgress * 100).toFixed(0)}%, outcome was '${lastReflection.outcome}'`
      : "";

    const systemPrompt = `You are a metacognitive AI agent performing self-reflection. Your job is to:
1. Honestly assess whether recent actions moved toward the goal
2. Identify what worked, what failed, and why
3. Determine if the approach needs adjustment
4. Detect any problematic patterns like repetition or goal drift
5. Decide if human escalation is needed

Be honest and critical. Output valid JSON only.`;

    const messages: AgentMessage[] = [
      {
        role: "user",
        content: `Reflect on recent agent actions and assess goal progress.

GOAL: ${goal}

RECENT ACTIONS (last ${recentActions.length}):
${actionSummary}
${patternSummary}${lastProgressNote}

Output JSON with exactly this schema:
{
  "goalProgress": 0.0-1.0,
  "observations": ["observation 1", "observation 2"],
  "lessons": ["lesson learned 1"],
  "adjustments": ["what to do differently"],
  "outcome": "on_track|adjust_approach|replan|escalate_to_user|abandon_goal|success",
  "confidence": 0.0-1.0,
  "shouldEscalate": false,
  "escalationReason": null
}

Be concise. Return ONLY valid JSON.`,
      },
    ];

    const response = await this.backbone.call(messages, {
      model: CLAUDE_MODELS.SONNET,
      maxTokens: 2048,
      system: systemPrompt,
      thinking: {
        enabled: true,
        budgetTokens: this.config.thinkingBudgetTokens ?? 8_000,
      },
    });

    // Parse reflection
    let parsed: Partial<ReflectionEntry> = {};
    try {
      const jsonMatch = response.text.match(/\{[\s\S]*\}/);
      if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
    } catch (err) {
      logger.error({ err }, "[SelfReflectingAgent] Failed to parse reflection JSON");
    }

    // Check for critical patterns that force escalation
    const hasCriticalPattern = patternFlags.some((f) => f.severity === "critical");
    const confidenceTooLow =
      (parsed.confidence ?? 1) < (this.config.minConfidenceThreshold ?? 0.3);
    const forceEscalate =
      (this.config.escalateOnCriticalPattern && hasCriticalPattern) ||
      confidenceTooLow;

    const entry: ReflectionEntry = {
      reflectionId: randomUUID(),
      agentId,
      trigger,
      timestamp: Date.now(),
      actionsReviewed: recentActions.map((a) => a.actionId),
      currentGoal: goal,
      goalProgress: Number(parsed.goalProgress ?? 0.5),
      thinkingContent: response.thinkingContent,
      observations: Array.isArray(parsed.observations) ? parsed.observations : [],
      lessons: Array.isArray(parsed.lessons) ? parsed.lessons : [],
      adjustments: Array.isArray(parsed.adjustments) ? parsed.adjustments : [],
      outcome: forceEscalate
        ? "escalate_to_user"
        : ((parsed.outcome as ReflectionOutcome) ?? "on_track"),
      confidence: Number(parsed.confidence ?? 0.5),
      shouldEscalate: forceEscalate || Boolean(parsed.shouldEscalate),
      escalationReason: forceEscalate
        ? hasCriticalPattern
          ? `Critical pattern detected: ${patternFlags
              .filter((f) => f.severity === "critical")
              .map((f) => f.type)
              .join(", ")}`
          : `Confidence too low: ${(parsed.confidence ?? 0).toFixed(2)}`
        : (parsed.escalationReason as string | undefined),
      patternFlags,
    };

    // Store reflection
    const agentReflectionsUpdated = this.reflections.get(agentId) ?? [];
    agentReflectionsUpdated.push(entry);
    this.reflections.set(agentId, agentReflectionsUpdated);

    // Update confidence tracker
    this.updateConfidence(agentId, entry);

    // Reset action counter
    this.actionCounters.set(agentId, 0);

    logger.info(
      {
        agentId,
        reflectionId: entry.reflectionId,
        outcome: entry.outcome,
        progress: entry.goalProgress,
        patterns: patternFlags.length,
        escalate: entry.shouldEscalate,
      },
      "[SelfReflectingAgent] Reflection completed"
    );

    this.emit("reflection:completed", entry);

    if (entry.shouldEscalate) {
      this.emit("escalation:required", {
        agentId,
        reflection: entry,
        reason: entry.escalationReason,
      });
    }

    return entry;
  }

  // ── Goal check ────────────────────────────────────────────────────────────────

  async checkGoalAchieved(
    agentId: string,
    goal: string,
    finalResult: unknown
  ): Promise<{ achieved: boolean; confidence: number; summary: string }> {
    const messages: AgentMessage[] = [
      {
        role: "user",
        content: `Did the agent achieve its goal?

GOAL: ${goal}

FINAL RESULT:
${JSON.stringify(finalResult, null, 2).slice(0, 1000)}

Output JSON: { "achieved": true/false, "confidence": 0-1, "summary": "brief explanation" }`,
      },
    ];

    const response = await this.backbone.call(messages, {
      model: CLAUDE_MODELS.HAIKU,
      maxTokens: 512,
      system: "You assess whether an AI agent achieved its stated goal. Be objective.",
    });

    try {
      const jsonMatch = response.text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        const result = {
          achieved: Boolean(parsed.achieved),
          confidence: Number(parsed.confidence ?? 0.5),
          summary: String(parsed.summary ?? ""),
        };

        // Record completion reflection
        await this.reflect(agentId, goal, "completion");

        this.emit("goal:assessed", { agentId, goal, ...result });
        return result;
      }
    } catch (err) {
      logger.error({ err }, "[SelfReflectingAgent] Failed to parse goal check");
    }

    return { achieved: false, confidence: 0, summary: "Unable to assess" };
  }

  // ── Confidence tracking ────────────────────────────────────────────────────────

  private updateConfidence(agentId: string, reflection: ReflectionEntry): void {
    const existing = this.confidence.get(agentId) ?? {
      agentId,
      goalConfidence: 0.5,
      methodConfidence: 0.5,
      toolConfidence: {},
      overallTrend: "stable" as const,
      lastUpdated: Date.now(),
      history: [],
    };

    // Update goal confidence based on progress
    existing.goalConfidence =
      existing.goalConfidence * 0.7 + reflection.goalProgress * 0.3;

    // Update method confidence based on reflection outcome
    const outcomeBoost: Record<ReflectionOutcome, number> = {
      on_track: 0.1,
      success: 0.2,
      adjust_approach: -0.05,
      replan: -0.15,
      escalate_to_user: -0.2,
      abandon_goal: -0.3,
    };
    existing.methodConfidence = Math.max(
      0,
      Math.min(
        1,
        existing.methodConfidence + (outcomeBoost[reflection.outcome] ?? 0)
      )
    );

    // Update tool confidence from recent actions
    const agentActions = this.actions.get(agentId) ?? [];
    const recentToolActions = agentActions.slice(-20).filter((a) => a.toolUsed);
    for (const action of recentToolActions) {
      const tool = action.toolUsed!;
      const prev = existing.toolConfidence[tool] ?? 0.5;
      existing.toolConfidence[tool] = prev * 0.85 + (action.success ? 0.15 : 0);
    }

    // Compute trend
    const overall =
      (existing.goalConfidence + existing.methodConfidence) / 2;
    const recentHistory = existing.history.slice(-3);
    if (recentHistory.length >= 2) {
      const avgPrev =
        recentHistory.reduce((s, h) => s + h.overall, 0) / recentHistory.length;
      if (overall > avgPrev + 0.05) existing.overallTrend = "improving";
      else if (overall < avgPrev - 0.05) existing.overallTrend = "declining";
      else existing.overallTrend = "stable";
    }

    existing.history.push({
      timestamp: Date.now(),
      overall,
      reason: reflection.outcome,
    });
    if (existing.history.length > 50) existing.history.shift();

    existing.lastUpdated = Date.now();
    this.confidence.set(agentId, existing);
  }

  // ── Forced escalation (max depth exceeded) ────────────────────────────────────

  private buildForcedEscalationReflection(
    agentId: string,
    goal: string,
    depth: number
  ): ReflectionEntry {
    const entry: ReflectionEntry = {
      reflectionId: randomUUID(),
      agentId,
      trigger: "forced",
      timestamp: Date.now(),
      actionsReviewed: [],
      currentGoal: goal,
      goalProgress: 0,
      thinkingContent: "",
      observations: [
        `Maximum reflection depth of ${depth} reached without resolution`,
      ],
      lessons: [
        "Agent is unable to self-resolve — human guidance required",
      ],
      adjustments: ["Escalate to human operator"],
      outcome: "escalate_to_user",
      confidence: 0,
      shouldEscalate: true,
      escalationReason: `Reflection depth exceeded ${depth}/${this.config.maxReflectionDepth}`,
      patternFlags: [
        {
          type: "excessive_reflection",
          description: "Max reflection depth exceeded",
          severity: "critical",
          evidence: [`Depth: ${depth}`],
          firstDetected: Date.now(),
          occurrences: depth,
        },
      ],
    };

    const agentReflections = this.reflections.get(agentId) ?? [];
    agentReflections.push(entry);
    this.reflections.set(agentId, agentReflections);

    this.emit("escalation:required", {
      agentId,
      reflection: entry,
      reason: entry.escalationReason,
    });

    return entry;
  }

  // ── Queries ───────────────────────────────────────────────────────────────────

  getReflectionHistory(agentId: string, limit = 20): ReflectionEntry[] {
    return (this.reflections.get(agentId) ?? []).slice(-limit).reverse();
  }

  getConfidence(agentId: string): ConfidenceTracker | null {
    return this.confidence.get(agentId) ?? null;
  }

  getActionHistory(agentId: string, limit = 50): ActionRecord[] {
    return (this.actions.get(agentId) ?? []).slice(-limit);
  }

  getActivePatterns(agentId: string): PatternFlag[] {
    const reflections = this.reflections.get(agentId) ?? [];
    const latest = reflections.at(-1);
    return latest?.patternFlags ?? [];
  }

  clearAgentState(agentId: string): void {
    this.actions.delete(agentId);
    this.reflections.delete(agentId);
    this.confidence.delete(agentId);
    this.patternDetectors.get(agentId)?.reset();
    this.patternDetectors.delete(agentId);
    this.actionCounters.delete(agentId);
    this.reflectionDepth.delete(agentId);
    logger.info({ agentId }, "[SelfReflectingAgent] Agent state cleared");
  }

  getSummary(agentId: string) {
    const actions = this.actions.get(agentId) ?? [];
    const reflections = this.reflections.get(agentId) ?? [];
    const conf = this.confidence.get(agentId);
    const patterns = this.getActivePatterns(agentId);

    return {
      agentId,
      totalActions: actions.length,
      successfulActions: actions.filter((a) => a.success).length,
      totalReflections: reflections.length,
      lastOutcome: reflections.at(-1)?.outcome,
      goalProgress: reflections.at(-1)?.goalProgress ?? 0,
      confidenceTrend: conf?.overallTrend ?? "unknown",
      activePatterns: patterns.map((p) => ({ type: p.type, severity: p.severity })),
      needsEscalation: reflections.at(-1)?.shouldEscalate ?? false,
    };
  }
}

// ─── Singleton ─────────────────────────────────────────────────────────────────

let _instance: SelfReflectingAgent | null = null;

export function getSelfReflectingAgent(
  config?: ReflectionConfig
): SelfReflectingAgent {
  if (!_instance) _instance = new SelfReflectingAgent(undefined, config);
  return _instance;
}
