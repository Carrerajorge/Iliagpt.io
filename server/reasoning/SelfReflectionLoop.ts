/**
 * SelfReflectionLoop — Batch 1 Reasoning
 *
 * After a response is generated, runs a structured reflection step to:
 *  - Verify the question was fully answered
 *  - Detect factual errors or gaps
 *  - Check whether important context was missed
 *  - Determine if a follow-up question would help
 *  - Optionally produce a targeted improvement and/or append follow-up suggestions
 *
 * Uses a real LLM call (fast/cheap model) to perform reflection.
 * The result is used by the pipeline to decide whether to:
 *   a) Send the response as-is (reflection passed)
 *   b) Append a follow-up suggestion
 *   c) Trigger a targeted improvement pass (costly — only on low scores)
 */

import { createLogger } from "../utils/logger";
import { llmGateway } from "../lib/llmGateway";

const log = createLogger("SelfReflectionLoop");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ReflectionInput {
  userMessage: string;
  assistantResponse: string;
  conversationHistory?: Array<{ role: "user" | "assistant"; content: string }>;
  contextSnippets?: string[];
}

export interface ReflectionDimension {
  name: string;
  score: number;         // 0–1
  note: string;          // short explanation
}

export interface ReflectionResult {
  passed: boolean;                   // true if all dimensions ≥ threshold
  overallScore: number;              // 0–1
  dimensions: ReflectionDimension[];
  issues: string[];
  followUpSuggestions: string[];     // questions to append to response
  shouldImprove: boolean;            // true → trigger improvement pass
  improvementFocus: string;          // what to fix in the improvement pass
  reflectionMs: number;
}

export interface ImprovementResult {
  improvedResponse: string;
  changesSummary: string;
  tokensUsed: number;
}

export interface ReflectionConfig {
  passingThreshold: number;        // default 0.65
  improvementThreshold: number;    // below this → trigger improvement (default 0.45)
  model: string;
  maxFollowUpSuggestions: number;
  enableImprovement: boolean;      // if false, never triggers improvement pass
}

// ─── Reflection Prompt ────────────────────────────────────────────────────────

const REFLECTION_SYSTEM = `You are a quality auditor for AI assistant responses.
Evaluate the assistant's response on these dimensions and return a JSON object:
{
  "completeness": <0-1>,
  "completeness_note": "<short note>",
  "accuracy": <0-1>,
  "accuracy_note": "<short note>",
  "context_usage": <0-1>,
  "context_usage_note": "<short note>",
  "clarity": <0-1>,
  "clarity_note": "<short note>",
  "issues": ["<issue1>", ...],
  "follow_up_suggestions": ["<question1>", "<question2>"],
  "improvement_focus": "<what to fix if improvement is needed>"
}

Be strict: score < 0.6 means a real problem exists. Return ONLY the JSON object.`;

const IMPROVEMENT_SYSTEM = `You are a response improver.
Given the original response, the user's question, and identified issues,
produce an improved version of the response that addresses the issues.
Keep what was good; fix what was wrong. Be concise.
Output ONLY the improved response text.`;

// ─── Parser ───────────────────────────────────────────────────────────────────

interface RawReflection {
  completeness: number;
  completeness_note: string;
  accuracy: number;
  accuracy_note: string;
  context_usage: number;
  context_usage_note: string;
  clarity: number;
  clarity_note: string;
  issues: string[];
  follow_up_suggestions: string[];
  improvement_focus: string;
}

function parseReflection(raw: string): RawReflection | null {
  try {
    const trimmed = raw.trim();
    const obj = JSON.parse(trimmed);
    return {
      completeness: Number(obj.completeness) || 0.7,
      completeness_note: String(obj.completeness_note ?? ""),
      accuracy: Number(obj.accuracy) || 0.7,
      accuracy_note: String(obj.accuracy_note ?? ""),
      context_usage: Number(obj.context_usage) || 0.7,
      context_usage_note: String(obj.context_usage_note ?? ""),
      clarity: Number(obj.clarity) || 0.8,
      clarity_note: String(obj.clarity_note ?? ""),
      issues: Array.isArray(obj.issues) ? obj.issues.map(String) : [],
      follow_up_suggestions: Array.isArray(obj.follow_up_suggestions)
        ? obj.follow_up_suggestions.map(String)
        : [],
      improvement_focus: String(obj.improvement_focus ?? ""),
    };
  } catch {
    return null;
  }
}

// ─── SelfReflectionLoop ───────────────────────────────────────────────────────

const DEFAULT_CONFIG: ReflectionConfig = {
  passingThreshold: 0.65,
  improvementThreshold: 0.45,
  model: "gemini-2.5-flash",
  maxFollowUpSuggestions: 2,
  enableImprovement: true,
};

export class SelfReflectionLoop {
  private config: ReflectionConfig;

  constructor(config: Partial<ReflectionConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async reflect(input: ReflectionInput): Promise<ReflectionResult> {
    const t0 = Date.now();

    // Build context for the reflector
    const historyText =
      input.conversationHistory && input.conversationHistory.length > 0
        ? input.conversationHistory
            .slice(-4)
            .map(m => `${m.role}: ${m.content}`)
            .join("\n")
        : "(No prior history)";

    const contextText =
      input.contextSnippets && input.contextSnippets.length > 0
        ? `\nRelevant context:\n${input.contextSnippets.join("\n").slice(0, 800)}`
        : "";

    const reflectionResponse = await llmGateway.chat(
      [
        { role: "system", content: REFLECTION_SYSTEM },
        {
          role: "user",
          content:
            `User's question: ${input.userMessage}\n\n` +
            `Prior conversation:\n${historyText}` +
            contextText +
            `\n\nAssistant's response:\n${input.assistantResponse}\n\n` +
            "Evaluate the response quality.",
        },
      ],
      {
        model: this.config.model,
        temperature: 0.15,
        timeout: 20_000,
      },
    );

    const parsed = parseReflection(reflectionResponse.content);

    if (!parsed) {
      log.warn("reflection_parse_failed");
      return this.buildFallbackResult(t0);
    }

    const dimensions: ReflectionDimension[] = [
      { name: "completeness", score: parsed.completeness, note: parsed.completeness_note },
      { name: "accuracy",     score: parsed.accuracy,     note: parsed.accuracy_note },
      { name: "context_usage", score: parsed.context_usage, note: parsed.context_usage_note },
      { name: "clarity",      score: parsed.clarity,      note: parsed.clarity_note },
    ];

    const overallScore =
      dimensions.reduce((s, d) => s + d.score, 0) / dimensions.length;

    const passed = overallScore >= this.config.passingThreshold;
    const shouldImprove =
      this.config.enableImprovement &&
      overallScore < this.config.improvementThreshold;

    const followUpSuggestions = parsed.follow_up_suggestions
      .filter(s => s.length > 5)
      .slice(0, this.config.maxFollowUpSuggestions);

    const result: ReflectionResult = {
      passed,
      overallScore: Math.round(overallScore * 1000) / 1000,
      dimensions,
      issues: parsed.issues.slice(0, 4),
      followUpSuggestions,
      shouldImprove,
      improvementFocus: parsed.improvement_focus,
      reflectionMs: Date.now() - t0,
    };

    log.info("reflection_complete", {
      passed,
      overallScore: result.overallScore,
      shouldImprove,
      issueCount: result.issues.length,
      followUpCount: followUpSuggestions.length,
      reflectionMs: result.reflectionMs,
    });

    return result;
  }

  /**
   * Targeted improvement pass — only triggered when reflection score < improvementThreshold.
   * Returns an improved version of the response that addresses identified issues.
   */
  async improve(
    input: ReflectionInput,
    reflection: ReflectionResult,
  ): Promise<ImprovementResult> {
    const issues = reflection.issues.join("\n- ");
    const focus = reflection.improvementFocus;
    const lowScoreDims = reflection.dimensions
      .filter(d => d.score < 0.6)
      .map(d => `${d.name}: ${d.note}`)
      .join("\n");

    const improvementResponse = await llmGateway.chat(
      [
        { role: "system", content: IMPROVEMENT_SYSTEM },
        {
          role: "user",
          content:
            `Original question: ${input.userMessage}\n\n` +
            `Original response:\n${input.assistantResponse}\n\n` +
            `Identified issues:\n- ${issues}\n\n` +
            `Low-scoring dimensions:\n${lowScoreDims}\n\n` +
            `Focus of improvement: ${focus}\n\n` +
            "Write the improved response:",
        },
      ],
      {
        model: this.config.model,
        temperature: 0.4,
        timeout: 30_000,
      },
    );

    const improved = improvementResponse.content;
    const tokensUsed = improvementResponse.usage?.totalTokens ?? Math.ceil(improved.length / 4);

    // Brief summary of what changed
    const changesSummary = focus
      ? `Addressed: ${focus}`
      : `Improved ${reflection.issues.slice(0, 2).join("; ")}`;

    log.info("improvement_complete", {
      originalLength: input.assistantResponse.length,
      improvedLength: improved.length,
      tokensUsed,
      changesSummary,
    });

    return { improvedResponse: improved, changesSummary, tokensUsed };
  }

  /**
   * Convenience: reflect and auto-improve if needed.
   * Returns the final response (possibly improved) and metadata.
   */
  async reflectAndImprove(
    input: ReflectionInput,
  ): Promise<{
    finalResponse: string;
    reflection: ReflectionResult;
    improved: boolean;
    followUpSuggestions: string[];
  }> {
    const reflection = await this.reflect(input);

    if (reflection.shouldImprove) {
      log.info("triggering_improvement_pass", {
        overallScore: reflection.overallScore,
        focus: reflection.improvementFocus,
      });
      const improvement = await this.improve(input, reflection);
      return {
        finalResponse: improvement.improvedResponse,
        reflection,
        improved: true,
        followUpSuggestions: reflection.followUpSuggestions,
      };
    }

    return {
      finalResponse: input.assistantResponse,
      reflection,
      improved: false,
      followUpSuggestions: reflection.followUpSuggestions,
    };
  }

  private buildFallbackResult(t0: number): ReflectionResult {
    return {
      passed: true,
      overallScore: 0.7,
      dimensions: [
        { name: "completeness", score: 0.7, note: "reflection unavailable" },
        { name: "accuracy",     score: 0.7, note: "reflection unavailable" },
        { name: "context_usage", score: 0.7, note: "reflection unavailable" },
        { name: "clarity",      score: 0.7, note: "reflection unavailable" },
      ],
      issues: [],
      followUpSuggestions: [],
      shouldImprove: false,
      improvementFocus: "",
      reflectionMs: Date.now() - t0,
    };
  }
}

export const selfReflectionLoop = new SelfReflectionLoop();
