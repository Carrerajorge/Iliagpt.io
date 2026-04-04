/**
 * SelfReflectingAgent — Agent wrapper that reflects on its own actions.
 *
 * After each tool call the agent asks: "Did this achieve my goal?
 * What did I learn? Should I adjust my plan?" Maintains a reflection
 * journal, detects failure patterns, tracks confidence, and escalates
 * when confidence drops below a threshold.
 */

import Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "crypto";
import { Logger } from "../lib/logger";
import { FAST_MODEL, REASONING_MODEL } from "./ClaudeAgentBackbone";
import type { HierarchicalPlan, PlanStep } from "./AgentPlannerWithThinking";

// ─── Types ─────────────────────────────────────────────────────────────────────
export type ReflectionDecision =
  | "continue"
  | "revise_plan"
  | "ask_user"
  | "abort"
  | "retry_step";

export interface ReflectionEntry {
  id: string;
  stepDescription: string;
  toolName: string;
  toolOutput: string;
  reflection: string;
  decision: ReflectionDecision;
  confidence: number; // 0–1
  patternFlags: PatternFlag[];
  timestamp: Date;
}

export type PatternFlag =
  | "repeated_failure"
  | "circular_behavior"
  | "scope_creep"
  | "tool_misuse"
  | "unexpected_result";

export interface ReflectionJournal {
  sessionId: string;
  taskGoal: string;
  entries: ReflectionEntry[];
  overallConfidence: number;
  planRevisions: number;
  patternCounts: Record<PatternFlag, number>;
}

export interface ReflectionResult {
  entry: ReflectionEntry;
  shouldRevise: boolean;
  shouldEscalate: boolean;
  revisedStepDescription?: string;
}

export interface EscalationRequest {
  sessionId: string;
  reason: string;
  confidence: number;
  recentReflections: ReflectionEntry[];
  suggestedActions: string[];
}

// ─── Reflection prompts ────────────────────────────────────────────────────────
function buildReflectionPrompt(
  goal: string,
  stepDescription: string,
  toolName: string,
  toolOutput: string,
  priorReflections: string
): string {
  return `You are an AI agent reflecting on your own actions. Evaluate objectively.

TASK GOAL: ${goal}
CURRENT STEP: ${stepDescription}
TOOL USED: ${toolName}
TOOL OUTPUT (first 2000 chars): ${toolOutput.slice(0, 2000)}

PRIOR REFLECTIONS (last 3):
${priorReflections || "none"}

Answer these questions in JSON:
{
  "achieved_goal": true/false,
  "learned": "what new information did this reveal",
  "issues": "any problems with the output (empty string if none)",
  "decision": "continue|revise_plan|ask_user|abort|retry_step",
  "confidence": 0.0-1.0,
  "reflection": "2-3 sentence summary of what happened and why",
  "pattern_flags": [] // array of: "repeated_failure"|"circular_behavior"|"scope_creep"|"tool_misuse"|"unexpected_result"
}

Be honest. If output looks wrong, say so. Confidence < 0.5 means you are genuinely unsure.`;
}

function buildRevisionPrompt(
  goal: string,
  stepDescription: string,
  issue: string
): string {
  return `An agent step has an issue. Suggest a revised step description.

GOAL: ${goal}
ORIGINAL STEP: ${stepDescription}
ISSUE IDENTIFIED: ${issue}

Return a JSON object:
{ "revised_step": "new step description that addresses the issue" }

Keep it concise and actionable.`;
}

// ─── SelfReflectingAgent ───────────────────────────────────────────────────────
export class SelfReflectingAgent {
  private readonly client: Anthropic;
  private readonly journal: ReflectionJournal;
  private readonly confidenceThreshold: number;
  private readonly escalationCallback?: (req: EscalationRequest) => Promise<void>;

  constructor(options: {
    sessionId?: string;
    taskGoal: string;
    confidenceThreshold?: number;
    onEscalation?: (req: EscalationRequest) => Promise<void>;
  }) {
    this.client = new Anthropic();
    this.confidenceThreshold = options.confidenceThreshold ?? 0.35;
    this.escalationCallback = options.onEscalation;

    this.journal = {
      sessionId: options.sessionId ?? randomUUID(),
      taskGoal: options.taskGoal,
      entries: [],
      overallConfidence: 1.0,
      planRevisions: 0,
      patternCounts: {
        repeated_failure: 0,
        circular_behavior: 0,
        scope_creep: 0,
        tool_misuse: 0,
        unexpected_result: 0,
      },
    };

    Logger.info("[SelfReflectingAgent] Initialised", {
      sessionId: this.journal.sessionId,
      goal: options.taskGoal,
      confidenceThreshold: this.confidenceThreshold,
    });
  }

  // ─── Public API ──────────────────────────────────────────────────────────────

  /** Reflect on a completed tool call and update the journal. */
  async reflect(
    step: Pick<PlanStep, "description" | "requiredTools">,
    toolName: string,
    toolOutput: string
  ): Promise<ReflectionResult> {
    const priorText = this.journal.entries
      .slice(-3)
      .map((e) => `[${e.toolName}] ${e.reflection}`)
      .join("\n");

    const prompt = buildReflectionPrompt(
      this.journal.taskGoal,
      step.description,
      toolName,
      toolOutput,
      priorText
    );

    let parsed: any = {};
    try {
      const response = await this.client.messages.create({
        model: FAST_MODEL,
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      });

      const textBlock = response.content.find((b) => b.type === "text");
      const text = textBlock?.type === "text" ? textBlock.text : "{}";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    } catch (err) {
      Logger.error("[SelfReflectingAgent] Reflection parse failed", err);
      parsed = { decision: "continue", confidence: 0.5, reflection: "Reflection unavailable.", pattern_flags: [] };
    }

    const decision = this.sanitiseDecision(parsed.decision);
    const confidence = Math.min(1, Math.max(0, typeof parsed.confidence === "number" ? parsed.confidence : 0.5));
    const patternFlags: PatternFlag[] = (parsed.pattern_flags ?? []).filter(
      (f: any): f is PatternFlag =>
        ["repeated_failure", "circular_behavior", "scope_creep", "tool_misuse", "unexpected_result"].includes(f)
    );

    const entry: ReflectionEntry = {
      id: randomUUID(),
      stepDescription: step.description,
      toolName,
      toolOutput: toolOutput.slice(0, 500),
      reflection: String(parsed.reflection ?? ""),
      decision,
      confidence,
      patternFlags,
      timestamp: new Date(),
    };

    this.journal.entries.push(entry);
    this.updatePatternCounts(patternFlags);
    this.updateOverallConfidence(confidence);

    Logger.info("[SelfReflectingAgent] Reflection recorded", {
      sessionId: this.journal.sessionId,
      decision,
      confidence,
      patternFlags,
    });

    const shouldRevise = decision === "revise_plan" || this.detectCircularBehavior();
    const shouldEscalate =
      confidence < this.confidenceThreshold ||
      decision === "ask_user" ||
      decision === "abort" ||
      this.journal.patternCounts.repeated_failure >= 3;

    let revisedStepDescription: string | undefined;
    if (shouldRevise && parsed.issues) {
      revisedStepDescription = await this.suggestRevision(step.description, parsed.issues);
      this.journal.planRevisions++;
    }

    if (shouldEscalate) {
      await this.triggerEscalation(entry, parsed.issues ?? "Low confidence in progress");
    }

    return { entry, shouldRevise, shouldEscalate, revisedStepDescription };
  }

  /** Get the full reflection journal. */
  getJournal(): Readonly<ReflectionJournal> {
    return { ...this.journal, entries: [...this.journal.entries] };
  }

  /** Get a concise text summary of all reflections so far. */
  summarise(): string {
    const entries = this.journal.entries;
    if (entries.length === 0) return "No reflections yet.";

    const lines = entries.map(
      (e, i) =>
        `[${i + 1}] ${e.toolName}: ${e.reflection} (confidence: ${(e.confidence * 100).toFixed(0)}%, decision: ${e.decision})`
    );

    return [
      `Reflection Journal — ${entries.length} entries`,
      `Overall confidence: ${(this.journal.overallConfidence * 100).toFixed(0)}%`,
      `Plan revisions: ${this.journal.planRevisions}`,
      "",
      ...lines,
    ].join("\n");
  }

  /** Reset the journal for a new task. */
  reset(newGoal: string): void {
    this.journal.taskGoal = newGoal;
    this.journal.entries = [];
    this.journal.overallConfidence = 1.0;
    this.journal.planRevisions = 0;
    Object.keys(this.journal.patternCounts).forEach(
      (k) => ((this.journal.patternCounts as any)[k] = 0)
    );
  }

  // ─── Private helpers ─────────────────────────────────────────────────────────

  private async suggestRevision(stepDescription: string, issue: string): Promise<string> {
    try {
      const prompt = buildRevisionPrompt(this.journal.taskGoal, stepDescription, issue);
      const response = await this.client.messages.create({
        model: FAST_MODEL,
        max_tokens: 256,
        messages: [{ role: "user", content: prompt }],
      });
      const textBlock = response.content.find((b) => b.type === "text");
      const text = textBlock?.type === "text" ? textBlock.text : "{}";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
      return String(parsed.revised_step ?? stepDescription);
    } catch {
      return stepDescription;
    }
  }

  private async triggerEscalation(entry: ReflectionEntry, reason: string): Promise<void> {
    const request: EscalationRequest = {
      sessionId: this.journal.sessionId,
      reason,
      confidence: entry.confidence,
      recentReflections: this.journal.entries.slice(-5),
      suggestedActions: this.buildSuggestedActions(entry),
    };

    Logger.warn("[SelfReflectingAgent] Escalating to user", {
      sessionId: this.journal.sessionId,
      reason,
      confidence: entry.confidence,
    });

    await this.escalationCallback?.(request);
  }

  private buildSuggestedActions(entry: ReflectionEntry): string[] {
    const actions: string[] = [];
    if (entry.patternFlags.includes("repeated_failure")) actions.push("Try an alternative tool or approach");
    if (entry.patternFlags.includes("circular_behavior")) actions.push("Break out of the loop by changing the strategy");
    if (entry.patternFlags.includes("scope_creep")) actions.push("Refocus on the original goal");
    if (entry.confidence < this.confidenceThreshold) actions.push("Provide clarification or additional context");
    if (entry.decision === "abort") actions.push("Manually review and restart with clearer instructions");
    if (actions.length === 0) actions.push("Review the last tool output and decide whether to continue");
    return actions;
  }

  private detectCircularBehavior(): boolean {
    const recent = this.journal.entries.slice(-6);
    if (recent.length < 4) return false;

    // Detect same tool + same failure pattern 3+ times in last 6 entries
    const failureCounts = new Map<string, number>();
    for (const e of recent) {
      if (e.decision === "retry_step" || e.decision === "revise_plan") {
        const key = `${e.toolName}`;
        failureCounts.set(key, (failureCounts.get(key) ?? 0) + 1);
        if ((failureCounts.get(key) ?? 0) >= 3) return true;
      }
    }
    return false;
  }

  private updatePatternCounts(flags: PatternFlag[]): void {
    for (const flag of flags) {
      this.journal.patternCounts[flag] = (this.journal.patternCounts[flag] ?? 0) + 1;
    }
  }

  private updateOverallConfidence(latestConfidence: number): void {
    // Exponential moving average with α=0.3
    this.journal.overallConfidence =
      0.3 * latestConfidence + 0.7 * this.journal.overallConfidence;
  }

  private sanitiseDecision(raw: unknown): ReflectionDecision {
    const valid: ReflectionDecision[] = ["continue", "revise_plan", "ask_user", "abort", "retry_step"];
    return valid.includes(raw as ReflectionDecision) ? (raw as ReflectionDecision) : "continue";
  }
}
