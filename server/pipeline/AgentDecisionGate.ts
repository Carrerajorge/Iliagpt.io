/**
 * AgentDecisionGate
 *
 * Second pipeline stage — decides whether to route the message to the full
 * agent executor (with tool calls, multi-step planning, memory retrieval) or
 * short-circuit to a fast direct-answer path.
 *
 * Decision is scored 0–1 along five dimensions:
 *   - Tool requirement  (detected keywords, URLs, file paths, code execution)
 *   - Multi-step need   (planning words, "then", "after that", numbered list)
 *   - Complexity        (word count, nested questions, domain specificity)
 *   - Context need      (references to previous turns, pronouns, "that")
 *   - Ambiguity         (vague requests needing clarification)
 *
 * If agentScore >= AGENT_THRESHOLD (0.5) → route to agent executor.
 * Otherwise → fast path (direct LLM completion, no tools).
 *
 * All logic is deterministic (no LLM calls) and runs in < 2 ms.
 */

import { z }       from 'zod';
import { Logger }  from '../lib/logger';
import type { PreprocessedMessage, Intent } from './MessagePreprocessor';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Minimum agentScore to activate the full agent executor. */
const AGENT_THRESHOLD = 0.50;

/** Minimum agentScore to require clarification before answering. */
const CLARIFICATION_THRESHOLD = 0.75;

// ─── Public schemas ───────────────────────────────────────────────────────────

export const RoutingDecisionSchema = z.enum([
  'fast_answer',     // Direct LLM completion, no tools
  'agent',           // Full agent executor with tools + planning
  'clarify',         // Ask the user for clarification before proceeding
]);
export type RoutingDecision = z.infer<typeof RoutingDecisionSchema>;

export const AgentGateResultSchema = z.object({
  /** Routing decision. */
  decision       : RoutingDecisionSchema,
  /** Composite score 0–1 (higher = more likely needs agent). */
  agentScore     : z.number().min(0).max(1),
  /** Individual dimension scores for transparency / logging. */
  dimensions     : z.object({
    toolRequirement : z.number().min(0).max(1),
    multiStep       : z.number().min(0).max(1),
    complexity      : z.number().min(0).max(1),
    contextNeed     : z.number().min(0).max(1),
    ambiguity       : z.number().min(0).max(1),
  }),
  /** Tools that appear to be required (informational, not binding). */
  likelyTools    : z.array(z.string()),
  /** True if multiple sequential sub-tasks were detected. */
  isMultiStep    : z.boolean(),
  /** True when the request is too vague to answer without clarification. */
  needsClarification: z.boolean(),
  /** Reason for the decision (short human-readable string). */
  reason         : z.string(),
  /** Processing time in ms. */
  processingMs   : z.number().nonneg(),
});
export type AgentGateResult = z.infer<typeof AgentGateResultSchema>;

// ─── Tool-requirement scoring ─────────────────────────────────────────────────

/**
 * Tool keyword map: maps tool names to their trigger patterns.
 * These mirror the actual tools registered in agentTools.
 */
const TOOL_PATTERNS: Record<string, RegExp> = {
  web_search      : /\b(?:search(?:ing)?|look(?:ing)?\s+up|google|find(?:ing)?\s+(?:online|on the web)|latest|current|news|today|recent|up.to.date)\b/i,
  code_interpreter: /\b(?:run|execute|compute|calculate|plot|graph|visualize|simulate|benchmark|test(?:ing)?)\b.*\bcode\b|\bcode\b.*\b(?:run|execute|output|result)\b/i,
  file_read       : /\b(?:read|open|load|parse|import|analyze|process)\b.*\bfile\b|\bfile\b.*\b(?:content|data|text)\b/i,
  file_write      : /\b(?:write|save|create|export|generate)\b.*\bfile\b|\bfile\b.*\b(?:write|save|output)\b/i,
  memory_retrieve : /\b(?:remember|recall|what did|what was|earlier|before|previous(?:ly)?|history|we discussed)\b/i,
  image_analyze   : /\b(?:image|photo|picture|screenshot|diagram|chart|graph|logo|icon)\b/i,
  calculator      : /\b(?:\d[\d\s+\-*\/^%()]*=|\bcompute\b|\bcalculate\b|\bmath\b|\bformula\b|\bequation\b)\b/i,
};

function scoreToolRequirement(
  text: string,
  hasUrls: boolean,
  hasCode: boolean,
  hasFilePaths: boolean,
): { score: number; tools: string[] } {
  const tools: string[] = [];
  let matched = 0;

  for (const [tool, pattern] of Object.entries(TOOL_PATTERNS)) {
    if (pattern.test(text)) {
      tools.push(tool);
      matched++;
    }
  }

  if (hasUrls)      { tools.push('url_fetch'); matched++; }
  if (hasCode)      { tools.push('code_interpreter'); }  // don't double-count
  if (hasFilePaths) { tools.push('file_read');        }

  const dedupedTools = [...new Set(tools)];
  const score = Math.min(1, dedupedTools.length * 0.25);
  return { score, tools: dedupedTools };
}

// ─── Multi-step detection ─────────────────────────────────────────────────────

const SEQUENTIAL_WORDS  = /\b(?:then|after(?:\s+that)?|next|finally|subsequently|afterwards|step\s+\d|first(?:ly)?|second(?:ly)?|third(?:ly)?|lastly|and\s+then)\b/i;
const NUMBERED_LIST_RE  = /^\s*\d+[\.)]\s+/m;
const MULTI_Q_RE        = /\?\s+(?:and|also|additionally|furthermore|moreover)/i;

function scoreMultiStep(text: string): number {
  let score = 0;
  if (SEQUENTIAL_WORDS.test(text))   score += 0.35;
  if (NUMBERED_LIST_RE.test(text))   score += 0.30;
  if (MULTI_Q_RE.test(text))         score += 0.25;
  // Multiple sentences each ending in "?" or "." — suggests compound request
  const sentences = text.split(/[.?!]+/).filter(s => s.trim().length > 10);
  if (sentences.length >= 3)         score += 0.15;
  return Math.min(1, score);
}

// ─── Complexity scoring ───────────────────────────────────────────────────────

const DOMAIN_WORDS = /\b(?:algorithm|machine\s+learning|neural\s+network|derivative|integral|quantum|cryptocurrency|blockchain|legal|regulation|compliance|medical|diagnosis|pharmacology|financial|investment|portfolio|architecture|infrastructure|kubernetes|docker|microservice)\b/i;

function scoreComplexity(
  text: string,
  wordCount: number,
  intent: Intent,
): number {
  let score = 0;
  // Word count contribution (tops out at 200 words → 0.3)
  score += Math.min(0.30, wordCount / 667);
  // Domain specificity
  if (DOMAIN_WORDS.test(text)) score += 0.25;
  // Intent-based boost
  if (intent === 'code' || intent === 'analysis') score += 0.20;
  // Deeply nested parentheses / brackets → complex
  const depth = (text.match(/[([{]/g) ?? []).length;
  if (depth >= 3) score += 0.15;
  return Math.min(1, score);
}

// ─── Context need scoring ─────────────────────────────────────────────────────

const PRONOUN_REFS  = /\b(?:it|that|this|these|those|they|he|she|him|her|them|the\s+(?:same|above|previous|latter|former))\b/i;
const BACK_REF_WORDS = /\b(?:as\s+(?:I|we)\s+(?:said|mentioned|discussed|noted)|earlier|before|from\s+above|see\s+above|per\s+(?:our|the)\s+discussion)\b/i;

function scoreContextNeed(text: string, isFollowUp: boolean): number {
  let score = isFollowUp ? 0.30 : 0;
  if (PRONOUN_REFS.test(text))  score += 0.20;
  if (BACK_REF_WORDS.test(text)) score += 0.25;
  return Math.min(1, score);
}

// ─── Ambiguity scoring ────────────────────────────────────────────────────────

const VAGUE_WORDS = /\b(?:something|somehow|anything|whatever|whenever|wherever|someone|anyone|everyone|stuff|things|etc|various|several|some(?:\s+kind)?\s+of|a\s+bit)\b/i;
const TOO_SHORT   = 15; // characters — single-word or very terse requests are often ambiguous

function scoreAmbiguity(text: string, wordCount: number, intent: Intent): number {
  let score = 0;
  if (text.trim().length < TOO_SHORT)  score += 0.40;
  if (wordCount < 4)                   score += 0.30;
  if (VAGUE_WORDS.test(text))          score += 0.20;
  // Greetings / small talk are often unambiguous
  if (intent === 'conversation')       score = Math.max(0, score - 0.30);
  return Math.min(1, score);
}

// ─── Main class ───────────────────────────────────────────────────────────────

export class AgentDecisionGate {
  /**
   * Evaluate a preprocessed message and decide how to route it.
   *
   * @param msg   - Output from MessagePreprocessor.process()
   * @returns     - AgentGateResult with decision, scores, and metadata
   */
  evaluate(msg: PreprocessedMessage): AgentGateResult {
    const start = Date.now();
    const { normalized, meta } = msg;

    // ── 1. Score dimensions ─────────────────────────────────────────────────
    const { score: toolScore, tools: likelyTools } = scoreToolRequirement(
      normalized,
      meta.hasUrls,
      meta.hasCode,
      meta.entities.some(e => e.type === 'file_path'),
    );

    const multiStepScore  = scoreMultiStep(normalized);
    const complexityScore = scoreComplexity(normalized, meta.wordCount, meta.intent);
    const contextScore    = scoreContextNeed(normalized, meta.isFollowUp);
    const ambiguityScore  = scoreAmbiguity(normalized, meta.wordCount, meta.intent);

    // ── 2. Composite score (weighted average) ───────────────────────────────
    //   Tool requirement and multi-step are the strongest signals.
    const weights = {
      toolRequirement : 0.35,
      multiStep       : 0.25,
      complexity      : 0.20,
      contextNeed     : 0.10,
      ambiguity       : 0.10,
    };

    const agentScore =
      toolScore      * weights.toolRequirement +
      multiStepScore * weights.multiStep       +
      complexityScore* weights.complexity      +
      contextScore   * weights.contextNeed     +
      ambiguityScore * weights.ambiguity;

    // ── 3. Routing decision ─────────────────────────────────────────────────
    const isMultiStep          = multiStepScore >= 0.35;
    const needsClarification   = ambiguityScore >= 0.60 && meta.wordCount < 6;
    const agentScoreRounded    = Math.round(agentScore * 1000) / 1000;

    let decision: RoutingDecision;
    let reason: string;

    if (needsClarification && agentScore < AGENT_THRESHOLD) {
      decision = 'clarify';
      reason   = `Request is too vague (ambiguity=${ambiguityScore.toFixed(2)}, wordCount=${meta.wordCount})`;
    } else if (agentScoreRounded >= AGENT_THRESHOLD) {
      decision = 'agent';
      reason   = `agentScore=${agentScoreRounded} ≥ threshold=${AGENT_THRESHOLD}; tools=[${likelyTools.join(',')}]`;
    } else {
      decision = 'fast_answer';
      reason   = `agentScore=${agentScoreRounded} < threshold=${AGENT_THRESHOLD}; fast path`;
    }

    const processingMs = Date.now() - start;

    Logger.debug('[AgentDecisionGate] routing decision', {
      decision, agentScore: agentScoreRounded, intent: meta.intent,
      tools: likelyTools, isMultiStep, processingMs,
    });

    return {
      decision,
      agentScore     : agentScoreRounded,
      dimensions     : {
        toolRequirement : Math.round(toolScore      * 1000) / 1000,
        multiStep       : Math.round(multiStepScore * 1000) / 1000,
        complexity      : Math.round(complexityScore* 1000) / 1000,
        contextNeed     : Math.round(contextScore   * 1000) / 1000,
        ambiguity       : Math.round(ambiguityScore * 1000) / 1000,
      },
      likelyTools,
      isMultiStep,
      needsClarification,
      reason,
      processingMs,
    };
  }

  /**
   * Override the computed decision (e.g. from A/B test or feature flag).
   * Returns a modified result with the forced decision and an updated reason.
   */
  forceDecision(
    result: AgentGateResult,
    forced: RoutingDecision,
    reason: string,
  ): AgentGateResult {
    return {
      ...result,
      decision: forced,
      reason  : `[FORCED] ${reason} (original: ${result.decision})`,
    };
  }
}

// ─── Singleton export ─────────────────────────────────────────────────────────

export const agentDecisionGate = new AgentDecisionGate();
