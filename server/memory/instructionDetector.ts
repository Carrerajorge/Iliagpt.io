/**
 * InstructionDetector — Multi-stage instruction detection pipeline.
 *
 * Stage 1: Fast regex scan (< 1ms) → catches ~80% of explicit instructions
 * Stage 2: LLM classifier (optional) → normalizes ambiguous text into a clean
 *          directive, detects scope, expiration, topic, and conflicts.
 *
 * The detector never writes to the database — it only produces structured
 * detection results for the InstructionManager to persist.
 */

import { llmGateway } from "../lib/llmGateway";
import { createLogger } from "../utils/logger";

const log = createLogger("instruction-detector");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type InstructionScope = "global" | "conversation" | "gpt";

export interface DetectedInstruction {
  /** The original user message text. */
  rawText: string;
  /** Normalized directive — clean, imperative sentence. null until LLM runs. */
  normalized: string | null;
  /** 0–1 confidence that this is a genuine persistent instruction. */
  confidence: number;
  /** Which pattern family triggered the initial detection. */
  trigger: string;
  /** Scope: global (all chats), conversation, or gpt-specific. */
  scope: InstructionScope;
  /** Semantic topic cluster (e.g., "language", "tone", "format", "content"). */
  topic: string | null;
  /** If the instruction has a natural expiration (e.g., "for the next hour"). */
  expiresAt: Date | null;
  /** Whether this instruction negates/revokes a previous one. */
  isRevocation: boolean;
  /** Language of the instruction (ISO 639-1). */
  language: "es" | "en" | "other";
}

export interface DetectionResult {
  /** Were any instructions detected? */
  found: boolean;
  /** Detected instructions (may be empty). */
  instructions: DetectedInstruction[];
  /** Which detection stage produced the result. */
  stage: "pattern" | "llm" | "none";
  /** Processing time in ms. */
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Stage 1: Pattern-based fast scan
// ---------------------------------------------------------------------------

interface PatternRule {
  pattern: RegExp;
  confidence: number;
  label: string;
  topic: string;
  scope: InstructionScope;
}

const INSTRUCTION_PATTERNS: PatternRule[] = [
  // ── Spanish: temporal markers (highest confidence) ───────────────────
  { pattern: /\bde ahora en adelante\b/i,                  confidence: 0.95, label: "es:de_ahora_en_adelante", topic: "meta", scope: "global" },
  { pattern: /\ba partir de ahora\b/i,                     confidence: 0.95, label: "es:a_partir_de_ahora", topic: "meta", scope: "global" },
  { pattern: /\bpara siempre\b/i,                          confidence: 0.92, label: "es:para_siempre", topic: "meta", scope: "global" },
  { pattern: /\ben todas?\s+(las\s+)?(conversacion|respuesta|chat)/i, confidence: 0.90, label: "es:en_todas", topic: "meta", scope: "global" },

  // ── Spanish: absolute directives ─────────────────────────────────────
  { pattern: /\bsiempre\b.{5,}/i,                          confidence: 0.88, label: "es:siempre", topic: "behavior", scope: "global" },
  { pattern: /\bnunca\b.{5,}/i,                            confidence: 0.88, label: "es:nunca", topic: "behavior", scope: "global" },
  { pattern: /\bcada\s+vez\s+que\b/i,                      confidence: 0.85, label: "es:cada_vez", topic: "behavior", scope: "global" },

  // ── Spanish: desire/need directives ──────────────────────────────────
  { pattern: /\bquiero que\b.{5,}/i,                       confidence: 0.78, label: "es:quiero_que", topic: "behavior", scope: "global" },
  { pattern: /\bnecesito que\b.{5,}/i,                     confidence: 0.78, label: "es:necesito_que", topic: "behavior", scope: "global" },
  { pattern: /\bprefiero que\b.{5,}/i,                     confidence: 0.75, label: "es:prefiero_que", topic: "preference", scope: "global" },

  // ── Spanish: specific behavior modifiers ─────────────────────────────
  { pattern: /\bresponde(me)?\s+(siempre|solo|únicamente|en)\b/i, confidence: 0.90, label: "es:respondeme", topic: "format", scope: "global" },
  { pattern: /\bno\s+(uses|utilices|menciones|incluyas|pongas|agregues)\b/i, confidence: 0.83, label: "es:no_uses", topic: "content", scope: "global" },
  { pattern: /\btodas?\s+(las\s+)?respuestas?\b.{5,}/i,    confidence: 0.85, label: "es:todas_respuestas", topic: "format", scope: "global" },
  { pattern: /\brecuerda\s+que\b.{5,}/i,                   confidence: 0.72, label: "es:recuerda_que", topic: "context", scope: "global" },

  // ── Spanish: language ────────────────────────────────────────────────
  { pattern: /\b(responde|contesta|habla|escribe)\s*(me\s+)?(en|solo\s+en)\s+(español|inglés|francés|portugués|italiano|alemán)\b/i, confidence: 0.92, label: "es:idioma", topic: "language", scope: "global" },
  { pattern: /\ben\s+(español|inglés|francés|portugués)\s+(siempre|por favor|por defecto)\b/i, confidence: 0.88, label: "es:idioma_siempre", topic: "language", scope: "global" },

  // ── Spanish: tone and style ──────────────────────────────────────────
  { pattern: /\bsé\s+(breve|conciso|directo|detallado|formal|informal|técnico|simple)\b/i, confidence: 0.80, label: "es:se_breve", topic: "tone", scope: "global" },
  { pattern: /\bno\s+me\s+(hables|trates|respondas|expliques)\b/i, confidence: 0.83, label: "es:no_me_hables", topic: "tone", scope: "global" },
  { pattern: /\bháblame\s+(de\s+)?(tú|usted|formal|informal)\b/i, confidence: 0.85, label: "es:hablame_tu", topic: "tone", scope: "global" },
  { pattern: /\busa(r)?\s+(solo|únicamente|siempre)\b/i,   confidence: 0.82, label: "es:usar_solo", topic: "format", scope: "global" },
  { pattern: /\b(sin|no)\s+(emojis?|emoticones?|iconos?)\b/i, confidence: 0.88, label: "es:sin_emojis", topic: "format", scope: "global" },
  { pattern: /\b(con|usa)\s+(emojis?|emoticones?)\b/i,     confidence: 0.85, label: "es:con_emojis", topic: "format", scope: "global" },
  { pattern: /\b(sin|no)\s+(markdown|negrita|cursiva|formato)\b/i, confidence: 0.83, label: "es:sin_formato", topic: "format", scope: "global" },
  { pattern: /\bmi\s+(estilo|formato|preferencia|tono)\b/i, confidence: 0.72, label: "es:mi_estilo", topic: "preference", scope: "global" },

  // ── Spanish: revocations ─────────────────────────────────────────────
  { pattern: /\b(olvida|ignora|cancela|revoca|elimina)\s+(la\s+)?(instrucción|regla|orden)\b/i, confidence: 0.90, label: "es:revocation", topic: "meta", scope: "global" },
  { pattern: /\bya\s+no\s+(quiero|necesito)\s+que\b/i,     confidence: 0.85, label: "es:ya_no_quiero", topic: "meta", scope: "global" },
  { pattern: /\bdeja\s+de\b.{3,}/i,                        confidence: 0.75, label: "es:deja_de", topic: "meta", scope: "global" },

  // ── English: temporal markers ────────────────────────────────────────
  { pattern: /\bfrom now on\b/i,                           confidence: 0.95, label: "en:from_now_on", topic: "meta", scope: "global" },
  { pattern: /\bgoing forward\b/i,                         confidence: 0.90, label: "en:going_forward", topic: "meta", scope: "global" },
  { pattern: /\bfor all\s+(future\s+)?(responses?|messages?|conversations?)\b/i, confidence: 0.92, label: "en:for_all", topic: "meta", scope: "global" },
  { pattern: /\bin every\s+(response|reply|answer|message)\b/i, confidence: 0.88, label: "en:in_every", topic: "meta", scope: "global" },

  // ── English: absolute directives ─────────────────────────────────────
  { pattern: /\balways\b.{5,}/i,                           confidence: 0.88, label: "en:always", topic: "behavior", scope: "global" },
  { pattern: /\bnever\b.{5,}/i,                            confidence: 0.88, label: "en:never", topic: "behavior", scope: "global" },
  { pattern: /\bevery\s+(time|response|answer|reply)\b/i,  confidence: 0.85, label: "en:every_time", topic: "behavior", scope: "global" },

  // ── English: desire/need directives ──────────────────────────────────
  { pattern: /\bI\s+(want|need|prefer|'d like)\s+you\s+to\b/i, confidence: 0.78, label: "en:i_want_you_to", topic: "behavior", scope: "global" },
  { pattern: /\bwhen(ever)?\s+I\s+(ask|say|write|send|type)\b/i, confidence: 0.83, label: "en:when_i_ask", topic: "behavior", scope: "global" },
  { pattern: /\bplease\s+(always|never)\b/i,               confidence: 0.85, label: "en:please_always", topic: "behavior", scope: "global" },
  { pattern: /\bremember\s+(that|to)\b.{5,}/i,             confidence: 0.72, label: "en:remember", topic: "context", scope: "global" },

  // ── English: specific modifiers ──────────────────────────────────────
  { pattern: /\bdon'?t\s+(ever|use|include|mention|add)\b/i, confidence: 0.83, label: "en:dont_ever", topic: "content", scope: "global" },
  { pattern: /\brespond\s+(only\s+)?in\s+(english|spanish|french|portuguese)\b/i, confidence: 0.90, label: "en:respond_in", topic: "language", scope: "global" },
  { pattern: /\bkeep\s+(it|your\s+answers?|responses?)\s+(short|brief|concise|detailed|formal|informal)\b/i, confidence: 0.80, label: "en:keep_short", topic: "tone", scope: "global" },
  { pattern: /\buse\s+(only|always|formal|informal|simple|technical)\b/i, confidence: 0.78, label: "en:use_only", topic: "format", scope: "global" },
  { pattern: /\b(no|without)\s+(emojis?|emoticons?|icons?)\b/i, confidence: 0.88, label: "en:no_emojis", topic: "format", scope: "global" },
  { pattern: /\b(with|include)\s+(emojis?|emoticons?)\b/i, confidence: 0.85, label: "en:with_emojis", topic: "format", scope: "global" },

  // ── English: revocations ─────────────────────────────────────────────
  { pattern: /\b(forget|ignore|cancel|revoke|remove|delete)\s+(the\s+)?(instruction|rule|directive)\b/i, confidence: 0.90, label: "en:revocation", topic: "meta", scope: "global" },
  { pattern: /\bI\s+no\s+longer\s+(want|need)\b/i,         confidence: 0.85, label: "en:no_longer", topic: "meta", scope: "global" },
  { pattern: /\bstop\s+(doing|using|adding|including)\b/i,  confidence: 0.78, label: "en:stop_doing", topic: "meta", scope: "global" },
];

/**
 * Negative patterns — reduce confidence when the message is conversational
 * rather than directive (e.g., "Is it always sunny?" or "I always forget").
 */
const NEGATIVE_PATTERNS: Array<{ pattern: RegExp; penalty: number }> = [
  { pattern: /\?\s*$/,                                                      penalty: 0.55 },
  { pattern: /^(is|are|was|were|do|does|did|can|could|would|will|should|has|have)\b/i, penalty: 0.6 },
  { pattern: /^(es|está|fue|son|puede|podría|debería|tiene|hay)\b/i,       penalty: 0.6 },
  { pattern: /\b(cuándo|dónde|por qué|cómo|cuál|qué tan)\b/i,            penalty: 0.5 },
  { pattern: /\b(when|where|why|how|which)\b.*\?/i,                        penalty: 0.5 },
  { pattern: /\b(I think|creo que|me parece)\b/i,                          penalty: 0.3 },
  { pattern: /\b(maybe|quizás|tal vez|perhaps)\b/i,                        penalty: 0.25 },
];

/** Temporal expressions that indicate the instruction has an expiration. */
const EXPIRATION_PATTERNS: Array<{ pattern: RegExp; durationMs: number }> = [
  { pattern: /\b(por|for)\s+(la\s+)?(próxima|next)\s+hora\b/i,              durationMs: 3600_000 },
  { pattern: /\b(por|for)\s+(the\s+)?next\s+hour\b/i,                       durationMs: 3600_000 },
  { pattern: /\b(por|for)\s+(las\s+)?próximas?\s+(\d+)\s+horas?\b/i,        durationMs: 0 }, // dynamic
  { pattern: /\b(por|for)\s+(the\s+)?next\s+(\d+)\s+hours?\b/i,             durationMs: 0 }, // dynamic
  { pattern: /\b(por|for)\s+(esta|this)\s+(conversación|conversation|chat)\b/i, durationMs: -1 }, // conversation scope
  { pattern: /\b(solo|only)\s+(en\s+)?(este|this)\s+(chat|conversación|conversation)\b/i, durationMs: -1 },
  { pattern: /\bhasta\s+que\s+(te\s+)?diga\b/i,                             durationMs: 0 }, // until told otherwise → no expiry
  { pattern: /\buntil\s+I\s+(say|tell)\b/i,                                 durationMs: 0 },
];

const REVOCATION_LABELS = new Set([
  "es:revocation", "es:ya_no_quiero", "es:deja_de",
  "en:revocation", "en:no_longer", "en:stop_doing",
]);

// ---------------------------------------------------------------------------
// Stage 1: Pattern scan
// ---------------------------------------------------------------------------

function patternScan(message: string): DetectedInstruction[] {
  if (!message || message.length < 8) return [];
  const trimmed = message.trim();

  // Compute negative penalty
  let penalty = 0;
  for (const neg of NEGATIVE_PATTERNS) {
    if (neg.pattern.test(trimmed)) {
      penalty = Math.max(penalty, neg.penalty);
    }
  }

  const hits: DetectedInstruction[] = [];

  for (const rule of INSTRUCTION_PATTERNS) {
    if (!rule.pattern.test(trimmed)) continue;

    const adjusted = rule.confidence * (1 - penalty);
    if (adjusted < 0.45) continue;

    // Detect expiration
    let expiresAt: Date | null = null;
    let scope: InstructionScope = rule.scope;
    for (const exp of EXPIRATION_PATTERNS) {
      const m = trimmed.match(exp.pattern);
      if (!m) continue;
      if (exp.durationMs === -1) {
        scope = "conversation";
      } else if (exp.durationMs > 0) {
        expiresAt = new Date(Date.now() + exp.durationMs);
      } else if (m[3]) {
        // Dynamic: extract number from capture group
        const hours = parseInt(m[3], 10);
        if (hours > 0 && hours < 720) {
          expiresAt = new Date(Date.now() + hours * 3600_000);
        }
      }
      break;
    }

    // Detect language
    const hasSpanish = /[áéíóúñ¿¡]/.test(trimmed) || /\b(que|para|por|las?|los?|del?|en)\b/.test(trimmed);
    const language = hasSpanish ? "es" : "en";

    const isRevocation = REVOCATION_LABELS.has(rule.label);

    hits.push({
      rawText: trimmed,
      normalized: null, // Filled by Stage 2 (LLM)
      confidence: adjusted,
      trigger: rule.label,
      scope,
      topic: rule.topic,
      expiresAt,
      isRevocation,
      language: language as "es" | "en",
    });
  }

  // Keep top match per topic to avoid duplicates
  if (hits.length <= 1) return hits;

  const byTopic = new Map<string, DetectedInstruction>();
  for (const h of hits) {
    const key = h.topic ?? "unknown";
    const existing = byTopic.get(key);
    if (!existing || h.confidence > existing.confidence) {
      byTopic.set(key, h);
    }
  }
  return Array.from(byTopic.values());
}

// ---------------------------------------------------------------------------
// Stage 2: LLM normalization & classification
// ---------------------------------------------------------------------------

const LLM_CLASSIFICATION_PROMPT = `You are an instruction classifier for an AI assistant platform. Analyze the user message and extract any persistent behavioral instructions.

For each instruction found, return a JSON object with:
- "normalized": A clean, imperative sentence (e.g., "Always respond in English")
- "topic": One of: language, tone, format, content, behavior, preference, context, meta
- "scope": "global" (all chats), "conversation" (this chat only), or "gpt" (specific GPT)
- "confidence": 0.0-1.0 how certain this is a persistent instruction vs one-time request
- "isRevocation": true if the user is canceling/revoking a previous instruction

Return a JSON array. Return [] if no persistent instructions are found.
Only extract PERSISTENT directives — ignore one-time requests like "translate this" or "write me a poem".

Examples:
- "siempre respondeme en inglés" → [{"normalized":"Respond always in English","topic":"language","scope":"global","confidence":0.95,"isRevocation":false}]
- "no uses emojis" → [{"normalized":"Do not use emojis in responses","topic":"format","scope":"global","confidence":0.90,"isRevocation":false}]
- "olvida la instrucción de responder en inglés" → [{"normalized":"Revoke: respond in English","topic":"language","scope":"global","confidence":0.92,"isRevocation":true}]
- "traduce esto al francés" → [] (one-time request, not persistent)

Return ONLY the JSON array.`;

interface LLMClassifiedInstruction {
  normalized: string;
  topic: string;
  scope: InstructionScope;
  confidence: number;
  isRevocation: boolean;
}

async function llmClassify(
  message: string,
  patternResults: DetectedInstruction[],
): Promise<DetectedInstruction[]> {
  try {
    const response = await llmGateway.chat(
      [
        { role: "system", content: LLM_CLASSIFICATION_PROMPT },
        { role: "user", content: message },
      ],
      {
        temperature: 0.05,
        maxTokens: 800,
        requestId: `instr-classify-${Date.now()}`,
      },
    );

    const text = response.content.trim();
    // Extract JSON array from response
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return patternResults;

    const parsed: LLMClassifiedInstruction[] = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed) || parsed.length === 0) return patternResults;

    return parsed
      .filter((p) => p.confidence > 0.5)
      .map((p) => ({
        rawText: message.trim(),
        normalized: p.normalized,
        confidence: p.confidence,
        trigger: "llm",
        scope: p.scope || "global",
        topic: p.topic || null,
        expiresAt: null,
        isRevocation: p.isRevocation || false,
        language: (/[áéíóúñ¿¡]/.test(message) ? "es" : "en") as "es" | "en",
      }));
  } catch (err: any) {
    log.warn("LLM classification failed, using pattern results", { error: err.message });
    return patternResults;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Full detection pipeline.
 *
 * @param message     - The user's raw message text.
 * @param useLLM      - Whether to run Stage 2 (LLM) for normalization.
 *                      Defaults to true when pattern confidence < 0.85.
 */
export async function detectInstructions(
  message: string,
  useLLM: boolean = true,
): Promise<DetectionResult> {
  const start = Date.now();

  // Stage 1: fast pattern scan
  const patternHits = patternScan(message);

  if (patternHits.length === 0) {
    return { found: false, instructions: [], stage: "none", durationMs: Date.now() - start };
  }

  const highConfidence = patternHits.every((h) => h.confidence >= 0.85);

  // If all hits are high-confidence, skip LLM (save cost + latency)
  if (highConfidence || !useLLM) {
    // Auto-normalize from rawText for high-confidence pattern hits
    for (const hit of patternHits) {
      if (!hit.normalized) {
        hit.normalized = hit.rawText;
      }
    }
    return { found: true, instructions: patternHits, stage: "pattern", durationMs: Date.now() - start };
  }

  // Stage 2: LLM classification for ambiguous cases
  const llmResults = await llmClassify(message, patternHits);

  return {
    found: llmResults.length > 0,
    instructions: llmResults,
    stage: "llm",
    durationMs: Date.now() - start,
  };
}

/**
 * Synchronous quick check — pattern scan only, no LLM.
 * Use for fast gating before heavier operations.
 */
export function looksLikeInstruction(message: string): boolean {
  return patternScan(message).length > 0;
}
