/**
 * Advanced Context Window Manager
 *
 * Strategy-based context management that replaces simple oldest-first dropping.
 *
 * Strategies:
 * - sliding_window: Keep system + latest N messages that fit budget
 * - importance_weighted: Score messages by recency/role/content, drop lowest first
 * - must_keep_spans: Preserve messages containing code/URLs/data, drop filler first
 *
 * The latest user message is NEVER dropped (integrity guarantee from Phase 1).
 */

import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { detectMustKeepSpans, mustKeepBoostScore, type MustKeepAnalysis } from "./mustKeepDetector";
import { tokenCounter } from "./tokenCounter";

// ── Types ──────────────────────────────────────────────────

export type ContextStrategy =
  | "sliding_window"
  | "importance_weighted"
  | "must_keep_spans"
  | "auto";

export interface ContextManageOptions {
  strategy?: ContextStrategy;
  model?: string;
  maxTokens: number;
}

export interface MessageImportance {
  index: number;
  role: string;
  tokenCount: number;
  importanceScore: number;
  mustKeepSpans: number;
  kept: boolean;
}

export interface ContextResult {
  messages: ChatCompletionMessageParam[];
  metadata: {
    strategy: ContextStrategy;
    originalMessageCount: number;
    keptMessageCount: number;
    droppedMessageCount: number;
    originalTokens: number;
    finalTokens: number;
    truncationApplied: boolean;
    importanceScores: MessageImportance[];
    mustKeepPreserved: number;
  };
}

// ── Helpers ────────────────────────────────────────────────

function toText(msg: ChatCompletionMessageParam): string {
  return typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
}

function estimateTokens(text: string): number {
  return tokenCounter.countFast(text);
}

// ── Importance Scoring ─────────────────────────────────────

const ROLE_WEIGHTS: Record<string, number> = {
  system: 10,
  user: 8,
  assistant: 4,
  tool: 3,
  function: 3,
};

const REFERENCE_PATTERNS = [
  /\b(?:as I said|as mentioned|I told you|you said|earlier|previously|above|before)\b/i,
  /\b(?:como dije|como mencioné|mencionaste|dijiste|antes|anteriormente|arriba)\b/i,
];

function scoreMessage(
  msg: ChatCompletionMessageParam,
  index: number,
  totalMessages: number,
): number {
  const text = toText(msg);
  const role = msg.role || "user";

  // 1. Recency weight: more recent = higher score
  // Using inverse position from end (last message = 1.0, first = ~0)
  const recencyWeight = (index + 1) / totalMessages;

  // 2. Role weight
  const roleWeight = (ROLE_WEIGHTS[role] || 4) / 10; // Normalize to 0-1

  // 3. Reference weight: messages that reference other messages
  let referenceWeight = 0;
  for (const pattern of REFERENCE_PATTERNS) {
    if (pattern.test(text)) {
      referenceWeight = 0.3;
      break;
    }
  }

  // 4. Content length weight (longer messages typically have more value)
  const lengthWeight = Math.min(text.length / 2000, 0.5); // Cap at 0.5

  // 5. Must-keep boost
  const mustKeepWeight = mustKeepBoostScore(text) / 25; // Normalize to 0-1

  // Weighted sum
  return (
    recencyWeight * 4.0 +
    roleWeight * 3.0 +
    referenceWeight * 2.0 +
    lengthWeight * 1.0 +
    mustKeepWeight * 3.0
  );
}

// ── Strategy Implementations ───────────────────────────────

function slidingWindow(
  messages: ChatCompletionMessageParam[],
  maxTokens: number,
): ContextResult {
  const systemMessages = messages.filter(m => m.role === "system");
  const nonSystem = messages.filter(m => m.role !== "system");

  let budget = maxTokens;
  const kept: ChatCompletionMessageParam[] = [];
  const importanceScores: MessageImportance[] = [];

  // Always include system messages first
  for (const sys of systemMessages) {
    const tokens = estimateTokens(toText(sys));
    if (tokens <= budget) {
      kept.push(sys);
      budget -= tokens;
    }
  }

  // Must keep the latest user message
  const lastUserIdx = findLastUserIndex(nonSystem);
  let lastUserTokens = 0;
  if (lastUserIdx >= 0) {
    lastUserTokens = estimateTokens(toText(nonSystem[lastUserIdx]));
    budget -= lastUserTokens;
  }

  // Fill backwards from the end (most recent first), skipping the last user (already reserved)
  const keptNonSystemIndices = new Set<number>();
  if (lastUserIdx >= 0) keptNonSystemIndices.add(lastUserIdx);

  for (let i = nonSystem.length - 1; i >= 0; i--) {
    if (i === lastUserIdx) continue;
    const tokens = estimateTokens(toText(nonSystem[i]));
    if (tokens <= budget) {
      keptNonSystemIndices.add(i);
      budget -= tokens;
    } else {
      break; // Stop at the first message that doesn't fit (sliding window = contiguous)
    }
  }

  // Build output in original order
  for (let i = 0; i < nonSystem.length; i++) {
    const tokens = estimateTokens(toText(nonSystem[i]));
    const isKept = keptNonSystemIndices.has(i);
    if (isKept) kept.push(nonSystem[i]);
    importanceScores.push({
      index: i,
      role: nonSystem[i].role,
      tokenCount: tokens,
      importanceScore: isKept ? 1 : 0,
      mustKeepSpans: 0,
      kept: isKept,
    });
  }

  const originalTokens = messages.reduce((s, m) => s + estimateTokens(toText(m)), 0);
  const finalTokens = kept.reduce((s, m) => s + estimateTokens(toText(m)), 0);

  return {
    messages: kept,
    metadata: {
      strategy: "sliding_window",
      originalMessageCount: messages.length,
      keptMessageCount: kept.length,
      droppedMessageCount: messages.length - kept.length,
      originalTokens,
      finalTokens,
      truncationApplied: kept.length < messages.length,
      importanceScores,
      mustKeepPreserved: 0,
    },
  };
}

function importanceWeighted(
  messages: ChatCompletionMessageParam[],
  maxTokens: number,
): ContextResult {
  const systemMessages = messages.filter(m => m.role === "system");
  const nonSystem = messages.filter(m => m.role !== "system");

  let budget = maxTokens;
  const kept: ChatCompletionMessageParam[] = [];

  // Always include system messages
  for (const sys of systemMessages) {
    const tokens = estimateTokens(toText(sys));
    if (tokens <= budget) {
      kept.push(sys);
      budget -= tokens;
    }
  }

  // Score all non-system messages
  const scored = nonSystem.map((msg, i) => ({
    msg,
    index: i,
    score: scoreMessage(msg, i, nonSystem.length),
    tokens: estimateTokens(toText(msg)),
    mustKeepSpans: detectMustKeepSpans(toText(msg)).totalSpans,
  }));

  // Force-include the latest user message
  const lastUserIdx = findLastUserIndex(nonSystem);
  const mustKeepIndices = new Set<number>();
  if (lastUserIdx >= 0) {
    mustKeepIndices.add(lastUserIdx);
    budget -= scored[lastUserIdx].tokens;
  }

  // Sort remaining by score descending
  const remaining = scored
    .filter((_, i) => !mustKeepIndices.has(i))
    .sort((a, b) => b.score - a.score);

  // Greedily pick highest-scored messages that fit
  for (const item of remaining) {
    if (item.tokens <= budget) {
      mustKeepIndices.add(item.index);
      budget -= item.tokens;
    }
  }

  // Build output in original order
  const importanceScores: MessageImportance[] = [];
  let mustKeepPreserved = 0;

  for (let i = 0; i < nonSystem.length; i++) {
    const isKept = mustKeepIndices.has(i);
    if (isKept) {
      kept.push(nonSystem[i]);
      if (scored[i].mustKeepSpans > 0) mustKeepPreserved++;
    }
    importanceScores.push({
      index: i,
      role: nonSystem[i].role,
      tokenCount: scored[i].tokens,
      importanceScore: scored[i].score,
      mustKeepSpans: scored[i].mustKeepSpans,
      kept: isKept,
    });
  }

  const originalTokens = messages.reduce((s, m) => s + estimateTokens(toText(m)), 0);
  const finalTokens = kept.reduce((s, m) => s + estimateTokens(toText(m)), 0);

  return {
    messages: kept,
    metadata: {
      strategy: "importance_weighted",
      originalMessageCount: messages.length,
      keptMessageCount: kept.length,
      droppedMessageCount: messages.length - kept.length,
      originalTokens,
      finalTokens,
      truncationApplied: kept.length < messages.length,
      importanceScores,
      mustKeepPreserved,
    },
  };
}

function mustKeepSpansStrategy(
  messages: ChatCompletionMessageParam[],
  maxTokens: number,
): ContextResult {
  // Like importance_weighted but with even heavier must-keep weighting
  const systemMessages = messages.filter(m => m.role === "system");
  const nonSystem = messages.filter(m => m.role !== "system");

  let budget = maxTokens;
  const kept: ChatCompletionMessageParam[] = [];

  for (const sys of systemMessages) {
    const tokens = estimateTokens(toText(sys));
    if (tokens <= budget) {
      kept.push(sys);
      budget -= tokens;
    }
  }

  // Analyze must-keep spans for every message
  const analyzed = nonSystem.map((msg, i) => {
    const text = toText(msg);
    const analysis = detectMustKeepSpans(text);
    return {
      msg,
      index: i,
      tokens: estimateTokens(text),
      analysis,
      score: analysis.priorityScore + (i / nonSystem.length) * 10, // recency bonus
    };
  });

  // Force latest user
  const lastUserIdx = findLastUserIndex(nonSystem);
  const keptIndices = new Set<number>();
  if (lastUserIdx >= 0) {
    keptIndices.add(lastUserIdx);
    budget -= analyzed[lastUserIdx].tokens;
  }

  // Sort: must-keep-heavy messages first, then by recency
  const remaining = analyzed
    .filter((_, i) => !keptIndices.has(i))
    .sort((a, b) => b.score - a.score);

  for (const item of remaining) {
    if (item.tokens <= budget) {
      keptIndices.add(item.index);
      budget -= item.tokens;
    }
  }

  // Build output in original order
  const importanceScores: MessageImportance[] = [];
  let mustKeepPreserved = 0;

  for (let i = 0; i < nonSystem.length; i++) {
    const isKept = keptIndices.has(i);
    if (isKept) {
      kept.push(nonSystem[i]);
      if (analyzed[i].analysis.totalSpans > 0) mustKeepPreserved++;
    }
    importanceScores.push({
      index: i,
      role: nonSystem[i].role,
      tokenCount: analyzed[i].tokens,
      importanceScore: analyzed[i].score,
      mustKeepSpans: analyzed[i].analysis.totalSpans,
      kept: isKept,
    });
  }

  const originalTokens = messages.reduce((s, m) => s + estimateTokens(toText(m)), 0);
  const finalTokens = kept.reduce((s, m) => s + estimateTokens(toText(m)), 0);

  return {
    messages: kept,
    metadata: {
      strategy: "must_keep_spans",
      originalMessageCount: messages.length,
      keptMessageCount: kept.length,
      droppedMessageCount: messages.length - kept.length,
      originalTokens,
      finalTokens,
      truncationApplied: kept.length < messages.length,
      importanceScores,
      mustKeepPreserved,
    },
  };
}

// ── Utility ────────────────────────────────────────────────

function findLastUserIndex(messages: ChatCompletionMessageParam[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") return i;
  }
  return messages.length - 1; // fallback to last message
}

function selectAutoStrategy(messages: ChatCompletionMessageParam[]): ContextStrategy {
  const nonSystem = messages.filter(m => m.role !== "system");
  // Long conversations benefit from importance scoring
  if (nonSystem.length > 20) return "importance_weighted";
  // Check if any message has significant must-keep content
  let mustKeepMessages = 0;
  for (const msg of nonSystem) {
    const analysis = detectMustKeepSpans(toText(msg));
    if (analysis.totalSpans >= 3) mustKeepMessages++;
  }
  if (mustKeepMessages > 3) return "must_keep_spans";
  return "sliding_window";
}

// ── Public API ─────────────────────────────────────────────

/**
 * Manage a context window given messages and a token budget.
 *
 * If messages fit within budget, returns them unchanged.
 * Otherwise applies the chosen strategy to select which messages to keep.
 */
export function manageContext(
  messages: ChatCompletionMessageParam[],
  options: ContextManageOptions,
): ContextResult {
  const { maxTokens, model } = options;
  let strategy = options.strategy || "auto";

  // Quick check: do we even need to truncate?
  const totalTokens = messages.reduce((s, m) => s + estimateTokens(toText(m)), 0);
  if (totalTokens <= maxTokens) {
    return {
      messages,
      metadata: {
        strategy: strategy === "auto" ? "sliding_window" : strategy,
        originalMessageCount: messages.length,
        keptMessageCount: messages.length,
        droppedMessageCount: 0,
        originalTokens: totalTokens,
        finalTokens: totalTokens,
        truncationApplied: false,
        importanceScores: messages.map((m, i) => ({
          index: i,
          role: m.role,
          tokenCount: estimateTokens(toText(m)),
          importanceScore: 1,
          mustKeepSpans: 0,
          kept: true,
        })),
        mustKeepPreserved: 0,
      },
    };
  }

  // Resolve auto strategy
  if (strategy === "auto") {
    strategy = selectAutoStrategy(messages);
  }

  switch (strategy) {
    case "importance_weighted":
      return importanceWeighted(messages, maxTokens);
    case "must_keep_spans":
      return mustKeepSpansStrategy(messages, maxTokens);
    case "sliding_window":
    default:
      return slidingWindow(messages, maxTokens);
  }
}

export { detectMustKeepSpans } from "./mustKeepDetector";
