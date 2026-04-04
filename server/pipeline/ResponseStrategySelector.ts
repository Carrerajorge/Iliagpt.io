/**
 * ResponseStrategySelector — Batch 1 Pipeline Stage
 *
 * Determines *how* to respond — not just what model to call, but what
 * strategy shapes the response: temperature, max_tokens, system prompt
 * additions, and output format. Adapts over time based on explicit
 * user feedback signals stored per-session.
 */

import { z } from "zod";
import { createLogger } from "../utils/logger";
import type { EnrichedMessage, Intent } from "./MessagePreprocessor";

const log = createLogger("ResponseStrategySelector");

// ─── Strategy Definitions ─────────────────────────────────────────────────────

export const ResponseStrategySchema = z.enum([
  "DirectAnswer",
  "StepByStep",
  "CodeGeneration",
  "Analysis",
  "Creative",
  "Tutorial",
  "Comparison",
  "Summary",
]);
export type ResponseStrategy = z.infer<typeof ResponseStrategySchema>;

export type OutputFormat = "markdown" | "plain" | "json" | "code" | "numbered_list" | "bullet_list";

export interface StrategyConfig {
  temperature: number;
  maxTokens: number;
  systemPromptAddition: string;
  outputFormat: OutputFormat;
  reasoning: boolean;       // enable chain-of-thought before answering
  citations: boolean;       // request source citations
  structured: boolean;      // use JSON response format
  streaming: boolean;       // always stream this strategy
}

export const STRATEGY_CONFIGS: Record<ResponseStrategy, StrategyConfig> = {
  DirectAnswer: {
    temperature: 0.5,
    maxTokens: 512,
    systemPromptAddition: "Give a concise, direct answer. Avoid unnecessary preamble.",
    outputFormat: "plain",
    reasoning: false,
    citations: false,
    structured: false,
    streaming: false,
  },
  StepByStep: {
    temperature: 0.4,
    maxTokens: 2048,
    systemPromptAddition:
      "Break your answer into clear numbered steps. Each step should be actionable and self-contained.",
    outputFormat: "numbered_list",
    reasoning: true,
    citations: false,
    structured: false,
    streaming: true,
  },
  CodeGeneration: {
    temperature: 0.2,
    maxTokens: 4096,
    systemPromptAddition:
      "Generate production-quality code. Include type annotations. Add brief inline comments only where logic is non-obvious. Always wrap code in fenced code blocks with the language tag.",
    outputFormat: "code",
    reasoning: false,
    citations: false,
    structured: false,
    streaming: true,
  },
  Analysis: {
    temperature: 0.6,
    maxTokens: 3072,
    systemPromptAddition:
      "Provide a thorough analysis. Structure your response with clear sections: Overview, Key Findings, Implications, and Recommendations.",
    outputFormat: "markdown",
    reasoning: true,
    citations: true,
    structured: false,
    streaming: true,
  },
  Creative: {
    temperature: 0.85,
    maxTokens: 3072,
    systemPromptAddition:
      "Be imaginative and original. Prioritize voice, tone, and engagement over brevity.",
    outputFormat: "markdown",
    reasoning: false,
    citations: false,
    structured: false,
    streaming: true,
  },
  Tutorial: {
    temperature: 0.45,
    maxTokens: 4096,
    systemPromptAddition:
      "Write a practical tutorial. Include: an intro, prerequisites, step-by-step instructions with code examples where relevant, common pitfalls, and a summary.",
    outputFormat: "markdown",
    reasoning: true,
    citations: false,
    structured: false,
    streaming: true,
  },
  Comparison: {
    temperature: 0.5,
    maxTokens: 2560,
    systemPromptAddition:
      "Compare and contrast the options systematically. Use a table where possible. Clearly state trade-offs and end with a recommendation.",
    outputFormat: "markdown",
    reasoning: true,
    citations: false,
    structured: false,
    streaming: true,
  },
  Summary: {
    temperature: 0.35,
    maxTokens: 1024,
    systemPromptAddition:
      "Produce a concise summary that captures all key points. Preserve the most important details; omit redundant or peripheral content.",
    outputFormat: "bullet_list",
    reasoning: false,
    citations: false,
    structured: false,
    streaming: false,
  },
};

// ─── Complexity Estimation ─────────────────────────────────────────────────────

export type ComplexityLevel = "trivial" | "simple" | "moderate" | "complex" | "expert";

interface ComplexitySignal {
  level: ComplexityLevel;
  score: number; // contribution to complexity
}

function estimateComplexity(message: EnrichedMessage): { level: ComplexityLevel; score: number } {
  let score = 0;

  score += Math.min(0.3, message.wordCount / 300);

  if (message.hasCode) score += 0.25;
  if (message.entities.filePaths.length > 0) score += 0.1;
  if (message.entities.urls.length > 2) score += 0.1;

  const technicalTerms =
    /\b(algorithm|architecture|distributed|concurrent|asynchronous|optimization|complexity|protocol|schema|middleware|abstraction|polymorphism|recursion)\b/i;
  if (technicalTerms.test(message.normalizedText)) score += 0.2;

  const multiQuestion = (message.normalizedText.match(/\?/g) ?? []).length;
  if (multiQuestion > 1) score += Math.min(0.2, multiQuestion * 0.05);

  const clamped = Math.max(0, Math.min(1, score));

  let level: ComplexityLevel;
  if (clamped < 0.15) level = "trivial";
  else if (clamped < 0.35) level = "simple";
  else if (clamped < 0.55) level = "moderate";
  else if (clamped < 0.75) level = "complex";
  else level = "expert";

  return { level, score: clamped };
}

// ─── Strategy Selection Rules ─────────────────────────────────────────────────

interface SelectionRule {
  strategy: ResponseStrategy;
  test: (msg: EnrichedMessage, complexity: ComplexityLevel) => boolean;
  priority: number; // lower = checked first
}

const SELECTION_RULES: SelectionRule[] = [
  {
    strategy: "CodeGeneration",
    priority: 1,
    test: (msg) =>
      msg.intent === "code" ||
      /\b(code|function|class|script|program|snippet|implement|write.*function|generate.*code)\b/i.test(
        msg.normalizedText,
      ),
  },
  {
    strategy: "Summary",
    priority: 2,
    test: (msg) =>
      /\b(summarize|summarise|tldr|tl;dr|brief|overview|key points|main points|highlights)\b/i.test(
        msg.normalizedText,
      ),
  },
  {
    strategy: "Comparison",
    priority: 3,
    test: (msg) =>
      /\b(compare|vs\.?|versus|difference between|pros.*cons|which is better|trade.?offs?)\b/i.test(
        msg.normalizedText,
      ),
  },
  {
    strategy: "Tutorial",
    priority: 4,
    test: (msg) =>
      /\b(how to|tutorial|guide|step[- ]by[- ]step|walkthrough|learn|teach me|explain how)\b/i.test(
        msg.normalizedText,
      ),
  },
  {
    strategy: "Analysis",
    priority: 5,
    test: (msg) =>
      msg.intent === "analysis" ||
      /\b(analyze|analyse|evaluate|assess|review|deep dive|examine|investigate)\b/i.test(
        msg.normalizedText,
      ),
  },
  {
    strategy: "Creative",
    priority: 6,
    test: (msg) =>
      msg.intent === "creative" ||
      /\b(write.*story|write.*poem|write.*essay|compose|creative|fiction|imagine)\b/i.test(
        msg.normalizedText,
      ),
  },
  {
    strategy: "StepByStep",
    priority: 7,
    test: (msg, complexity) =>
      complexity === "complex" ||
      complexity === "expert" ||
      /\b(step[- ]by[- ]step|instructions|procedure|process|workflow)\b/i.test(msg.normalizedText),
  },
  {
    strategy: "DirectAnswer",
    priority: 99,
    test: () => true, // fallback
  },
];

// ─── User Preference Learning ─────────────────────────────────────────────────

interface StrategyFeedback {
  strategy: ResponseStrategy;
  positiveVotes: number;
  negativeVotes: number;
  lastUpdated: number;
}

// Simple in-process per-session preference store
// In production, persist to Redis/DB via a service
const sessionPreferences = new Map<string, Map<ResponseStrategy, StrategyFeedback>>();

function getPreferenceMultiplier(sessionId: string, strategy: ResponseStrategy): number {
  const prefs = sessionPreferences.get(sessionId);
  if (!prefs) return 1.0;
  const fb = prefs.get(strategy);
  if (!fb) return 1.0;

  const total = fb.positiveVotes + fb.negativeVotes;
  if (total === 0) return 1.0;

  // Bayesian-style boost/penalty capped at ±30 %
  const ratio = fb.positiveVotes / total;
  return 0.7 + ratio * 0.6; // range [0.7, 1.3]
}

// ─── SelectionResult ──────────────────────────────────────────────────────────

export interface SelectionResult {
  strategy: ResponseStrategy;
  config: StrategyConfig;
  complexity: ComplexityLevel;
  complexityScore: number;
  confidence: number;
  alternativeStrategies: ResponseStrategy[];
  selectionMs: number;
}

// ─── ResponseStrategySelector ─────────────────────────────────────────────────

export class ResponseStrategySelector {
  select(message: EnrichedMessage, sessionId?: string): SelectionResult {
    const t0 = Date.now();

    const { level: complexity, score: complexityScore } = estimateComplexity(message);

    // Sort rules by priority
    const sorted = [...SELECTION_RULES].sort((a, b) => a.priority - b.priority);

    // Collect all matching strategies
    const matches: ResponseStrategy[] = [];
    for (const rule of sorted) {
      if (rule.test(message, complexity)) {
        matches.push(rule.strategy);
      }
    }

    // Apply user preference multipliers to pick the winner
    let bestStrategy: ResponseStrategy = matches[0] ?? "DirectAnswer";
    let bestScore = -Infinity;

    for (const strategy of matches.slice(0, 4)) {
      const baseScore = 1 - sorted.find(r => r.strategy === strategy)!.priority / 100;
      const prefMult = sessionId ? getPreferenceMultiplier(sessionId, strategy) : 1.0;
      const total = baseScore * prefMult;
      if (total > bestScore) {
        bestScore = total;
        bestStrategy = strategy;
      }
    }

    // Adjust config for complexity
    const baseConfig = STRATEGY_CONFIGS[bestStrategy];
    const adjustedConfig = this.adjustForComplexity(baseConfig, complexity);

    const alternatives = matches
      .filter(s => s !== bestStrategy)
      .slice(0, 2) as ResponseStrategy[];

    const result: SelectionResult = {
      strategy: bestStrategy,
      config: adjustedConfig,
      complexity,
      complexityScore,
      confidence: Math.min(0.95, 0.55 + complexityScore * 0.3),
      alternativeStrategies: alternatives,
      selectionMs: Date.now() - t0,
    };

    log.debug("strategy_selected", {
      strategy: bestStrategy,
      complexity,
      sessionId,
      selectionMs: result.selectionMs,
    });

    return result;
  }

  /** Record explicit user feedback to improve future selections */
  recordFeedback(
    sessionId: string,
    strategy: ResponseStrategy,
    positive: boolean,
  ): void {
    if (!sessionPreferences.has(sessionId)) {
      sessionPreferences.set(sessionId, new Map());
    }
    const prefs = sessionPreferences.get(sessionId)!;
    const existing = prefs.get(strategy) ?? {
      strategy,
      positiveVotes: 0,
      negativeVotes: 0,
      lastUpdated: Date.now(),
    };

    if (positive) existing.positiveVotes++;
    else existing.negativeVotes++;
    existing.lastUpdated = Date.now();
    prefs.set(strategy, existing);

    log.info("strategy_feedback_recorded", { sessionId, strategy, positive });
  }

  /** Return session preferences summary for debugging */
  getSessionPreferences(sessionId: string): StrategyFeedback[] {
    const prefs = sessionPreferences.get(sessionId);
    return prefs ? [...prefs.values()] : [];
  }

  private adjustForComplexity(
    base: StrategyConfig,
    complexity: ComplexityLevel,
  ): StrategyConfig {
    const multipliers: Record<ComplexityLevel, { tokens: number; temp: number }> = {
      trivial: { tokens: 0.5, temp: 0.9 },
      simple:  { tokens: 0.75, temp: 1.0 },
      moderate: { tokens: 1.0, temp: 1.0 },
      complex:  { tokens: 1.4, temp: 0.95 },
      expert:   { tokens: 1.8, temp: 0.85 },
    };

    const m = multipliers[complexity];
    return {
      ...base,
      maxTokens: Math.min(8192, Math.round(base.maxTokens * m.tokens)),
      temperature: Math.min(1.0, Math.round(base.temperature * m.temp * 100) / 100),
    };
  }
}

export const responseStrategySelector = new ResponseStrategySelector();
