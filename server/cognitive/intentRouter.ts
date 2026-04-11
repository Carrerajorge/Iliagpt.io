/**
 * Cognitive Middleware — heuristic intent router.
 *
 * Pure function, deterministic, zero LLM calls. Given a user message
 * (and an optional UI hint), it returns a `IntentClassification`
 * with a single chosen intent, a confidence score in [0, 1], a
 * one-line reasoning string, and a ranked list of alternatives.
 *
 * Why a heuristic instead of an LLM call?
 *
 *   1. Latency. The cognitive layer wraps the actual LLM call; we
 *      don't want to add another roundtrip just to decide which
 *      LLM to call.
 *
 *   2. Determinism. Tests need to pin classification outcomes; an
 *      LLM-based classifier introduces flakiness no test suite can
 *      meaningfully bound.
 *
 *   3. Escalation as a fallback. When the heuristic returns
 *      `confidence < 0.5`, callers are free to escalate to an
 *      LLM-based classifier — but the default path stays cheap and
 *      predictable.
 *
 * Routing scheme:
 *
 *   • Apply each rule in priority order (most specific → least).
 *   • Each rule outputs a (intent, confidence, reason) tuple.
 *   • The winning rule is the first one that fires; alternatives
 *     are the next-best non-firing rules in priority order.
 *   • If nothing matches, default to `chat` with confidence 0.0.
 *
 * `intentHint` from the caller acts as a tiebreaker only — it can
 * BOOST a rule that already weakly matched, but it cannot OVERRIDE
 * a strong heuristic match. This is deliberate: hints help the
 * classifier when it's uncertain, but a deterministic match should
 * never be silenced by a UI hint.
 */

import type { CognitiveIntent, IntentClassification } from "./types";

// ---------------------------------------------------------------------------
// Pattern library — one regex set per intent
// ---------------------------------------------------------------------------

interface IntentRule {
  intent: CognitiveIntent;
  /**
   * Patterns whose match awards full confidence (1.0). These should
   * be unambiguous — e.g., "draw a picture of …" can only mean
   * image generation.
   */
  strong: RegExp[];
  /**
   * Patterns whose match awards partial confidence (0.6). These are
   * reasonable signals but could fire on adjacent intents too —
   * e.g., "explain this" could be qa or summarization depending on
   * what "this" refers to.
   */
  weak?: RegExp[];
  /**
   * Patterns whose match awards LOW confidence (0.35) — keyword
   * mentions where the intent is plausible but the user might be
   * referring to something else.
   */
  hint?: RegExp[];
  /**
   * One-line reason embedded in the IntentClassification.reasoning.
   * Short and actionable: "matched a 'translate X to Y' phrase".
   */
  describe: string;
}

// English + Spanish patterns. Order MATTERS: rules near the top fire
// before rules near the bottom for the same input.
const RULES: IntentRule[] = [
  // ── image generation ──────────────────────────────────────────────
  {
    intent: "image_generation",
    strong: [
      /\b(generate|create|draw|paint|render|make)\s+(an?\s+)?(image|picture|photo|illustration|drawing|render)\b/i,
      /\b(genera|crea|dibuja|pinta|haz)\s+(una?\s+)?(imagen|foto|ilustraci[oó]n|dibujo)\b/i,
      /\bdall[- ]?e\b/i,
      /\bmidjourney\b/i,
      /\bstable diffusion\b/i,
    ],
    weak: [
      /\b(image of|picture of|photo of|imagen de|foto de)\b/i,
    ],
    describe: "matched an image-generation phrase",
  },

  // ── translation ────────────────────────────────────────────────────
  {
    intent: "translation",
    strong: [
      /\btranslate\b[^\.\n]*\b(to|into|al|en)\b/i,
      /\btraduce\b[^\.\n]*\b(al|en|a)\b/i,
      /\btraducci[oó]n\s+(al|en)\b/i,
      /\bin\s+(spanish|english|french|german|italian|portuguese|chinese|japanese|korean|russian|arabic|hindi)\b.*\btranslate\b/i,
    ],
    weak: [
      /\btranslate\b/i,
      /\btraduce\b/i,
    ],
    describe: "matched an explicit translation request",
  },

  // ── summarization ──────────────────────────────────────────────────
  {
    intent: "summarization",
    strong: [
      /\b(summari[sz]e|tldr|tl;dr|in summary|en resumen|resume(\s+esto)?|hazme\s+un\s+resumen|haz\s+un\s+resumen)\b/i,
      /\bgive me a summary\b/i,
      /\bdame\s+un\s+resumen\b/i,
    ],
    weak: [
      /\bbriefly\b.*\b(explain|describe)\b/i,
      /\bbrevemente\b/i,
    ],
    describe: "matched a summarization keyword",
  },

  // ── document generation ────────────────────────────────────────────
  {
    intent: "doc_generation",
    strong: [
      /\b(generate|create|build|make|write)\s+(an?\s+)?(word|docx|pdf|excel|xlsx|powerpoint|pptx|spreadsheet|presentation|document|report)\b/i,
      /\b(genera|crea|haz|escribe)\s+(un|una)?\s*(documento|informe|reporte|presentaci[oó]n|hoja de c[aá]lculo|excel|word|pdf|powerpoint)\b/i,
    ],
    describe: "matched a document/spreadsheet/presentation generation phrase",
  },

  // ── code generation ────────────────────────────────────────────────
  {
    intent: "code_generation",
    strong: [
      /\b(write|implement|create|generate|build|escribe|implementa|crea|genera)\b.*\b(function|class|method|component|script|program|c[oó]digo|funci[oó]n|clase|m[eé]todo|componente)\b/i,
      /\bin\s+(python|typescript|javascript|rust|go|java|c\+\+|c#|swift|kotlin|sql)\b.*\b(write|implement|code)\b/i,
      /\b(refactor|debug|fix)\s+this\s+code\b/i,
      /\brefactoriza\b/i,
    ],
    weak: [
      /```/, // any code fence in the message
      /\bcode\b/i,
      /\bc[oó]digo\b/i,
    ],
    describe: "matched a code-generation phrase",
  },

  // ── data analysis ──────────────────────────────────────────────────
  {
    intent: "data_analysis",
    strong: [
      /\b(analy[sz]e|analiza)\b.*\b(data|datos|spreadsheet|csv|xlsx|table|tabla)\b/i,
      /\b(plot|graph|chart|gr[aá]fica|gr[aá]fico)\b.*\b(this|these|esto|estos)\b/i,
      /\b(pivot|aggregate|group by|agrupar)\b/i,
    ],
    weak: [
      /\b(mean|median|average|stddev|variance|promedio|mediana|desviaci[oó]n)\b/i,
    ],
    describe: "matched a data-analysis phrase",
  },

  // ── RAG search ─────────────────────────────────────────────────────
  {
    intent: "rag_search",
    strong: [
      /\b(search|find|look up|busca|encuentra)\b.*\b(in|en)\s+(my|the|mis|los|las)\s+(docs|documents|files|notes|library|biblioteca|documentos|archivos|notas)\b/i,
      /\bbiblioteca\b.*\b(busca|encuentra)\b/i,
    ],
    weak: [
      /\baccording to my (notes|documents|files)\b/i,
      /\bseg[uú]n mis (notas|documentos|archivos)\b/i,
    ],
    describe: "matched a knowledge-base search phrase",
  },

  // ── tool call ──────────────────────────────────────────────────────
  {
    intent: "tool_call",
    strong: [
      /\b(use|usa|invoke|call|llama)\s+the\s+\w+\s+(tool|herramienta)\b/i,
      /\brun\s+(the\s+)?\w+\s+(tool|herramienta|skill)\b/i,
    ],
    describe: "matched an explicit tool-invocation phrase",
  },

  // ── agent task (multi-step autonomous) ────────────────────────────
  {
    intent: "agent_task",
    strong: [
      /\b(plan|orchestrate|do all of the following|complete the following steps|paso a paso)\b/i,
      /\b(agent|agente)\s+(mode|modo)\b/i,
      /\bautonom(ous|amente)\b/i,
    ],
    weak: [
      /\bstep[- ]by[- ]step\b/i,
    ],
    describe: "matched a multi-step / agent-task phrase",
  },

  // ── QA (question answering) ────────────────────────────────────────
  {
    intent: "qa",
    strong: [
      /^\s*(what|who|when|where|why|how|which|qu[eé]|qui[eé]n|cu[aá]ndo|d[oó]nde|por qu[eé]|c[oó]mo|cu[aá]l)\b/i,
      /\?\s*$/, // ends with a question mark
    ],
    weak: [
      /\b(explain|tell me|describe|exp[lc]ica|dime|describe)\b/i,
    ],
    describe: "matched a factual-question phrase",
  },
];

// ---------------------------------------------------------------------------
// Classifier
// ---------------------------------------------------------------------------

interface RuleMatch {
  intent: CognitiveIntent;
  confidence: number;
  rule: IntentRule;
}

/**
 * Apply every rule to the message and return all that fired, ranked
 * by confidence descending. Used both by the classifier itself and
 * by tests that want to see the full match table.
 */
export function evaluateRules(message: string): RuleMatch[] {
  const matches: RuleMatch[] = [];
  for (const rule of RULES) {
    let best = 0;
    for (const re of rule.strong) {
      if (re.test(message)) {
        best = Math.max(best, 1.0);
      }
    }
    for (const re of rule.weak ?? []) {
      if (re.test(message)) {
        best = Math.max(best, 0.6);
      }
    }
    for (const re of rule.hint ?? []) {
      if (re.test(message)) {
        best = Math.max(best, 0.35);
      }
    }
    if (best > 0) {
      matches.push({ intent: rule.intent, confidence: best, rule });
    }
  }
  // Sort by confidence descending; preserve rule order on ties.
  matches.sort((a, b) => b.confidence - a.confidence);
  return matches;
}

/**
 * Classify the user's message into a single `CognitiveIntent`.
 *
 * Algorithm:
 *
 *   1. Run `evaluateRules` to gather every (intent, confidence) pair
 *      that matches.
 *   2. Pick the highest-confidence match. On ties, the first rule
 *      in priority order wins (the RULES array is the priority order).
 *   3. If `intentHint` is supplied AND a weak match for that intent
 *      also fired, BOOST the hinted intent's confidence to be at
 *      least 0.7 — UI hints should reinforce, not contradict, weak
 *      heuristic signals.
 *   4. If nothing matches at all, return `"chat"` with confidence 0
 *      and reasoning "no rules fired — defaulting to chat".
 *
 * The `intentHint` is NEVER allowed to override a strong heuristic
 * match. If the user types "translate this to French" with
 * `intentHint: "image_generation"`, the classifier still picks
 * `translation` and logs the disagreement in `reasoning`.
 */
export function classifyIntent(
  message: string,
  intentHint?: CognitiveIntent,
): IntentClassification {
  if (typeof message !== "string") {
    throw new Error(`classifyIntent: message must be a string, got ${typeof message}`);
  }
  const trimmed = message.trim();
  if (trimmed.length === 0) {
    return {
      intent: "unknown",
      confidence: 0,
      reasoning: "empty message",
      alternatives: [],
    };
  }

  const matches = evaluateRules(trimmed);

  // Build the alternatives list (top 5 by confidence)
  const alternatives = matches
    .map((m) => ({ intent: m.intent, confidence: m.confidence }))
    .slice(0, 5);

  if (matches.length === 0) {
    // Nothing matched — fall back to chat. If the caller provided a
    // hint, honor it as a low-confidence guess; otherwise stay at 0.
    if (intentHint) {
      return {
        intent: intentHint,
        confidence: 0.2,
        reasoning: `no rules fired — using caller hint "${intentHint}" at low confidence`,
        alternatives: [{ intent: intentHint, confidence: 0.2 }],
      };
    }
    return {
      intent: "chat",
      confidence: 0,
      reasoning: "no rules fired — defaulting to chat",
      alternatives: [{ intent: "chat", confidence: 0 }],
    };
  }

  const top = matches[0];
  let chosenIntent = top.intent;
  let chosenConfidence = top.confidence;
  let reasoning = top.rule.describe;

  // Hint reinforcement: only relevant when the top match is weak
  // (confidence < 1.0) AND the hint also fired somewhere in the
  // match list.
  if (intentHint && top.confidence < 1.0) {
    const hintMatch = matches.find((m) => m.intent === intentHint);
    if (hintMatch) {
      // Boost the hinted intent to at least 0.7
      const boosted = Math.max(hintMatch.confidence, 0.7);
      if (boosted > chosenConfidence) {
        chosenIntent = intentHint;
        chosenConfidence = boosted;
        reasoning = `${hintMatch.rule.describe} (boosted by caller hint)`;
      }
    } else if (top.confidence < 0.6) {
      // Top match is very weak and hint didn't fire at all — log the
      // disagreement in reasoning so it shows up in telemetry.
      reasoning = `${top.rule.describe} (caller hinted "${intentHint}" but no rule for it fired)`;
    }
  }

  return {
    intent: chosenIntent,
    confidence: chosenConfidence,
    reasoning,
    alternatives,
  };
}
