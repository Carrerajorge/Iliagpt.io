/**
 * Brief Critic / Validator
 *
 * Evaluates the quality of a RequestBrief against deterministic checks.
 * Used by the validate_brief node in the analysis graph.
 *
 * No LLM needed — all checks are rule-based for speed and reliability.
 */

import type { RequestBrief } from "../requestUnderstanding/briefSchema";
import type { IntentType } from "../requestSpec";

export interface CriticIssue {
  field: string;
  severity: "warning" | "error";
  message: string;
  penalty: number; // score deduction
}

export interface CriticResult {
  score: number; // 0-1
  passed: boolean; // score >= threshold
  issues: CriticIssue[];
  suggestions: string[];
}

const PASS_THRESHOLD = 0.6;

/**
 * Run all deterministic checks on a brief and return a scored result.
 */
export function critiqueBrief(params: {
  brief: RequestBrief;
  originalMessage: string;
  intent: IntentType;
  confidence: number;
}): CriticResult {
  const { brief, originalMessage, intent, confidence } = params;
  const issues: CriticIssue[] = [];
  const suggestions: string[] = [];

  // ── Check 1: Subtasks completeness ─────────────────────────────
  if (!brief.subtasks || brief.subtasks.length < 2) {
    issues.push({
      field: "subtasks",
      severity: "error",
      message: `Less than 2 subtasks (found ${brief.subtasks?.length ?? 0})`,
      penalty: 0.3,
    });
    suggestions.push("Add more subtasks to break down the work");
  } else if (brief.subtasks.some((s) => !s.title || s.title.length < 3)) {
    issues.push({
      field: "subtasks",
      severity: "warning",
      message: "Some subtasks have very short or empty titles",
      penalty: 0.1,
    });
  }

  // ── Check 2: Deliverable format ────────────────────────────────
  if (!brief.deliverable?.format || brief.deliverable.format.length < 2) {
    issues.push({
      field: "deliverable.format",
      severity: "error",
      message: "Deliverable missing format specification",
      penalty: 0.2,
    });
    suggestions.push("Specify the output format (e.g., 'docx', 'pptx', 'text')");
  }

  if (!brief.deliverable?.description || brief.deliverable.description.length < 5) {
    issues.push({
      field: "deliverable.description",
      severity: "warning",
      message: "Deliverable description is too short",
      penalty: 0.1,
    });
  }

  // ── Check 3: Intent alignment ──────────────────────────────────
  if (brief.intent?.primary_intent) {
    const briefIntent = brief.intent.primary_intent.toLowerCase();
    const classifiedIntent = intent.toLowerCase();
    // Allow partial matches (e.g., "document creation" matches "document_generation")
    const intentWords = classifiedIntent.replace(/_/g, " ").split(" ");
    const hasOverlap = intentWords.some((w) => briefIntent.includes(w));
    if (!hasOverlap && briefIntent !== classifiedIntent) {
      issues.push({
        field: "intent",
        severity: "warning",
        message: `Brief intent "${briefIntent}" doesn't align with classified "${classifiedIntent}"`,
        penalty: 0.15,
      });
    }
  }

  // ── Check 4: Blocker consistency ───────────────────────────────
  if (brief.blocker?.is_blocked) {
    if (!brief.blocker.question || brief.blocker.question.trim().length < 10) {
      issues.push({
        field: "blocker",
        severity: "error",
        message: "Brief is blocked but no clarification question provided",
        penalty: 0.2,
      });
      suggestions.push("If the brief is blocked, provide a specific clarification question");
    }
  }

  // ── Check 5: Success criteria for complex/low-confidence tasks ─
  if (confidence < 0.7 && (!brief.success_criteria || brief.success_criteria.length === 0)) {
    issues.push({
      field: "success_criteria",
      severity: "warning",
      message: "No success criteria defined for a low-confidence classification",
      penalty: 0.1,
    });
    suggestions.push("Define success criteria to validate the output");
  }

  // ── Check 6: Assumptions transparency ──────────────────────────
  if ((!brief.assumptions || brief.assumptions.length === 0) && originalMessage.length > 100) {
    issues.push({
      field: "assumptions",
      severity: "warning",
      message: "No assumptions documented for a complex request",
      penalty: 0.05,
    });
  }

  // ── Check 7: Risks for high-stakes intents ─────────────────────
  const highStakesIntents: Set<IntentType> = new Set([
    "web_automation",
    "code_generation",
    "data_analysis",
  ]);
  if (highStakesIntents.has(intent) && (!brief.risks || brief.risks.length === 0)) {
    issues.push({
      field: "risks",
      severity: "warning",
      message: `No risks identified for high-stakes intent "${intent}"`,
      penalty: 0.1,
    });
    suggestions.push("Identify potential risks for this type of task");
  }

  // ── Calculate final score ──────────────────────────────────────
  const totalPenalty = issues.reduce((sum, issue) => sum + issue.penalty, 0);
  const score = Math.max(1.0 - totalPenalty, 0);
  const passed = score >= PASS_THRESHOLD;

  return { score, passed, issues, suggestions };
}
