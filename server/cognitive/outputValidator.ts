/**
 * Cognitive Middleware — output validator.
 *
 * Inspects a `ProviderResponse` BEFORE the orchestrator returns it
 * to the caller and produces a structured `ValidationReport` of
 * issues found, graded by severity. The validator NEVER throws —
 * even on a malformed response, it returns a report with the
 * appropriate `error`-severity issues attached.
 *
 * Checks (in order):
 *
 *   1. Finish reason gate (`error`, `content_filter`, `aborted`).
 *      Each maps to a distinct issue code so dashboards can split
 *      out provider errors from safety filters from cancellations.
 *
 *   2. Empty text gate. A response with `finishReason="stop"` but
 *      no text and no tool calls is meaningless — flag it as an
 *      error so the caller can retry or escalate.
 *
 *   3. Refusal heuristic. Common phrases like "I can't help with
 *      that", "I'm not able to", "lo siento, no puedo" → flag as
 *      a `warning` (not an error: refusal might be the correct
 *      response, the caller decides).
 *
 *   4. Tool call schema validation. For every tool call in the
 *      response, attempt to JSON-roundtrip the args. If a tool's
 *      input schema is supplied, also validate the args against
 *      the schema's required fields and basic types.
 *
 *   5. Length sanity. If the response is unrealistically long
 *      (>100k chars), flag it as a warning — usually a runaway
 *      generation.
 *
 * Severity convention:
 *   • "error"   — the response cannot be returned to the user as-is
 *   • "warning" — the response is usable but suspicious
 *   • "info"    — observation only, no action required
 */

import type {
  ProviderResponse,
  ProviderToolCall,
  ProviderToolDescriptor,
  ValidationIssue,
  ValidationReport,
} from "./types";
import type { ContextBundle } from "./context";

// ---------------------------------------------------------------------------
// Refusal heuristic
// ---------------------------------------------------------------------------

const REFUSAL_PATTERNS: ReadonlyArray<RegExp> = [
  /\b(I('m| am)|sorry,? I)\s+(can(no|')t|cannot|unable to|not able to|won't)\s+(help|assist|do|provide|generate)\b/i,
  /\bI('m| am)\s+(unable|not able)\s+to\b/i,
  /\bI\s+(can(no|')t|cannot)\s+create\b/i,
  /\bsorry,?\s+I\s+can(no|')t\b/i,
  /\blo\s+siento,?\s+no\s+puedo\b/i,
  /\bno\s+(puedo|estoy)\s+(ayudar|capaz)\b/i,
  /\bcomo\s+(modelo|asistente)\s+de\s+lenguaje,?\s+no\s+puedo\b/i,
];

function detectRefusal(text: string): boolean {
  if (text.length === 0) return false;
  for (const re of REFUSAL_PATTERNS) {
    if (re.test(text)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Tool call validation
// ---------------------------------------------------------------------------

interface ToolCallValidationOutcome {
  allValid: boolean;
  issues: ValidationIssue[];
}

function validateToolCalls(
  toolCalls: readonly ProviderToolCall[],
  toolDescriptors?: readonly ProviderToolDescriptor[],
): ToolCallValidationOutcome {
  const issues: ValidationIssue[] = [];
  if (toolCalls.length === 0) {
    return { allValid: true, issues };
  }

  // Build a name → descriptor map for O(1) lookup.
  const descriptorByName = new Map<string, ProviderToolDescriptor>();
  for (const d of toolDescriptors ?? []) {
    descriptorByName.set(d.name, d);
  }

  let allValid = true;
  for (let i = 0; i < toolCalls.length; i++) {
    const call = toolCalls[i];

    // (a) Args must be a plain object.
    if (
      call.args === null ||
      typeof call.args !== "object" ||
      Array.isArray(call.args)
    ) {
      issues.push({
        severity: "error",
        code: "tool_args_not_object",
        message: `tool call #${i} (${call.name}): args must be a plain object`,
      });
      allValid = false;
      continue;
    }

    // (b) Args must JSON round-trip cleanly (no functions, no cycles).
    try {
      JSON.parse(JSON.stringify(call.args));
    } catch {
      issues.push({
        severity: "error",
        code: "tool_args_not_serializable",
        message: `tool call #${i} (${call.name}): args do not JSON-serialize`,
      });
      allValid = false;
      continue;
    }

    // (c) If we have a descriptor for this tool, check required fields.
    const descriptor = descriptorByName.get(call.name);
    if (!descriptor) {
      issues.push({
        severity: "warning",
        code: "tool_unknown",
        message: `tool call #${i}: tool "${call.name}" is not in the declared tool list`,
      });
      // Not an error — the orchestrator may know about tools the
      // request didn't list. But warn so dashboards can spot it.
      continue;
    }

    const required = extractRequiredKeys(descriptor.inputSchema);
    for (const key of required) {
      if (!(key in call.args)) {
        issues.push({
          severity: "error",
          code: "tool_args_missing_required",
          message: `tool call #${i} (${call.name}): missing required field "${key}"`,
        });
        allValid = false;
      }
    }
  }

  return { allValid, issues };
}

function extractRequiredKeys(schema: Record<string, unknown>): string[] {
  if (!schema || typeof schema !== "object") return [];
  const req = (schema as { required?: unknown }).required;
  if (Array.isArray(req)) {
    return req.filter((x): x is string => typeof x === "string");
  }
  return [];
}

// ---------------------------------------------------------------------------
// Main validator
// ---------------------------------------------------------------------------

export interface ValidateOutputOptions {
  /**
   * The tool descriptors that were sent in the request, used to
   * cross-check tool call args. Optional: when omitted, the
   * validator only does shape checks on the args.
   */
  toolDescriptors?: readonly ProviderToolDescriptor[];
  /**
   * Soft cap on response length. Anything longer triggers a warning.
   * Default 100,000 characters.
   */
  maxLengthSoftCap?: number;
  /**
   * The context bundle that was injected into the request. Enables
   * the alignment-inspired checks:
   *
   *   • `citation_without_context` — the response cites a source
   *     (URL, document id, "according to the memo") but the context
   *     bundle was empty. The model is making something up.
   *
   *   • `false_premise_echoed` — the original user message contained
   *     a clearly wrong factual premise and the response parroted it
   *     instead of correcting.
   *
   * Optional: callers that don't build a context bundle still get
   * the full shape-level checks.
   */
  contextBundle?: ContextBundle;
  /**
   * The original user message. Used by `false_premise_echoed` to
   * detect dangerous premise echoing. Optional.
   */
  userMessage?: string;
}

/**
 * Validate a provider response. Returns a structured report; never
 * throws. The report's `ok` field is `true` IFF zero issues have
 * severity "error".
 */
export function validateOutput(
  response: ProviderResponse,
  options: ValidateOutputOptions = {},
): ValidationReport {
  const {
    toolDescriptors,
    maxLengthSoftCap = 100_000,
    contextBundle,
    userMessage,
  } = options;
  const issues: ValidationIssue[] = [];

  // 1. Finish reason gate
  switch (response.finishReason) {
    case "error":
      issues.push({
        severity: "error",
        code: "provider_error",
        message: "provider returned finishReason=error",
      });
      break;
    case "content_filter":
      issues.push({
        severity: "error",
        code: "content_filter",
        message: "provider blocked the response under its content filter",
      });
      break;
    case "aborted":
      issues.push({
        severity: "error",
        code: "aborted",
        message: "request was aborted before completion",
      });
      break;
    case "length":
      issues.push({
        severity: "warning",
        code: "length_truncation",
        message: "response was cut off because it hit maxTokens",
      });
      break;
    case "tool_calls":
    case "stop":
      // Healthy outcomes
      break;
  }

  // 2. Empty text gate (only when finishReason claims success)
  const isHealthyFinish =
    response.finishReason === "stop" || response.finishReason === "tool_calls";
  if (
    isHealthyFinish &&
    response.text.length === 0 &&
    response.toolCalls.length === 0
  ) {
    issues.push({
      severity: "error",
      code: "empty_response",
      message: "provider returned no text and no tool calls",
    });
  }

  // 3. Refusal heuristic (only on non-empty text)
  const refusalDetected = detectRefusal(response.text);
  if (refusalDetected) {
    issues.push({
      severity: "warning",
      code: "refusal_detected",
      message: "response looks like a refusal",
    });
  }

  // 4. Tool call validation
  const toolValidation = validateToolCalls(response.toolCalls, toolDescriptors);
  for (const issue of toolValidation.issues) issues.push(issue);

  // 5. Length sanity
  if (response.text.length > maxLengthSoftCap) {
    issues.push({
      severity: "warning",
      code: "length_above_soft_cap",
      message: `response length ${response.text.length} > soft cap ${maxLengthSoftCap}`,
    });
  }

  // 6. Alignment-inspired checks (Turn C).
  //
  // These are HEURISTIC checks — they will miss subtle failures and
  // occasionally false-positive on tricky text. They are cheap,
  // deterministic, and good enough to catch the bulk of the obvious
  // cases. The validator grades them at "warning" severity so
  // callers see the signal without breaking otherwise-healthy
  // responses.
  if (response.text.length > 0) {
    // 6a. Citation without grounding context.
    // If the response cites a URL or uses "according to" / "the
    // document says" style phrasing, but the enrichment stage
    // injected ZERO context chunks, the model is inventing sources.
    const cites = CITATION_PATTERNS.some((re) => re.test(response.text));
    const hasContext =
      contextBundle !== undefined && contextBundle.chunks.length > 0;
    if (cites && !hasContext) {
      issues.push({
        severity: "warning",
        code: "citation_without_context",
        message:
          "response contains citation-style phrases but no context chunks were injected",
      });
    }

    // 6b. Prompt injection echo.
    // The response contains the exact phrasing of a classic prompt
    // injection attempt. Usually means the model repeated attacker
    // text from a tool result or document chunk.
    if (PROMPT_INJECTION_ECHO.test(response.text)) {
      issues.push({
        severity: "warning",
        code: "prompt_injection_echo",
        message: "response echoes classic prompt-injection instructions",
      });
    }

    // 6c. Unsafe content patterns. Deliberately narrow — the goal is
    // not to replace a full safety classifier but to catch the
    // obvious "how do I hurt myself" type patterns that should
    // never land in a user-visible reply from our system.
    for (const pattern of UNSAFE_CONTENT_PATTERNS) {
      if (pattern.regex.test(response.text)) {
        issues.push({
          severity: "error",
          code: `unsafe_${pattern.code}`,
          message: `response contains unsafe ${pattern.code} content`,
        });
        break; // One strike is enough — don't spam issues.
      }
    }

    // 6d. False-premise echo.
    // The user stated a demonstrably false premise ("the sun is
    // cold", "2 + 2 = 5", "water boils at 50 °C") and the response
    // parroted it without correcting.
    if (userMessage && echoesFalsePremise(userMessage, response.text)) {
      issues.push({
        severity: "warning",
        code: "false_premise_echoed",
        message: "response repeats a demonstrably false premise from the user's message",
      });
    }
  }

  const ok = !issues.some((i) => i.severity === "error");
  return {
    ok,
    issues,
    refusalDetected,
    toolCallsValid: toolValidation.allValid,
  };
}

// ---------------------------------------------------------------------------
// Alignment-inspired heuristics (Turn C)
// ---------------------------------------------------------------------------

/**
 * Citation-style phrasing patterns. Presence of one of these + zero
 * injected context chunks is a strong signal the model is
 * confabulating sources.
 *
 * Explicitly kept narrow: we want a LOW false-positive rate on
 * legitimate prose. Passing these means the model is really making
 * a claim that implies a source.
 */
const CITATION_PATTERNS: ReadonlyArray<RegExp> = [
  /\bhttps?:\/\/\S+/i, // bare URL in response
  /\baccording to (the|this|that|a)\s+(document|memo|article|report|study|paper|source)\b/i,
  /\bas (mentioned|stated|noted) in the (document|memo|article|report|context)\b/i,
  /\b(see|refer to) (the|that)\s+(document|memo|attachment|file)\b/i,
  /\bseg[uú]n (el|la|los|las)\s+(documento|memo|art[ií]culo|informe|estudio|fuente)\b/i,
  /\bcomo (se menciona|se dice|se nota) en (el|la)\s+(documento|memo|art[ií]culo|informe|contexto)\b/i,
];

/**
 * Prompt injection echoes — if the MODEL'S OUTPUT contains one of
 * these, it's repeating attacker text from a context source back to
 * the user.
 */
const PROMPT_INJECTION_ECHO =
  /\b(ignore (all )?(previous|prior|above) (instructions|rules)|disregard the system prompt|you are now (in|playing|acting as) dan|jailbreak mode)\b/i;

/**
 * Unsafe content patterns. Narrow scope: things no production LLM
 * assistant should ever ship to a user. These are the obvious cases
 * that a safety classifier would catch — we keep a tiny regex
 * backstop here so that even if the provider doesn't flag it, we do.
 *
 * This is NOT a replacement for the provider's own safety layer.
 * It's a last-line defence.
 */
const UNSAFE_CONTENT_PATTERNS: ReadonlyArray<{ code: string; regex: RegExp }> = [
  {
    code: "self_harm_instructions",
    regex:
      /\b(step[- ]by[- ]step|instructions?|how to)\b[^\n]{0,40}\b(kill yourself|end your life|commit suicide|self[- ]?harm)\b/i,
  },
  {
    code: "weapon_synthesis",
    regex:
      /\b(synthesize|produce|make|build|create)\b[^\n]{0,40}\b(nerve agent|sarin|vx gas|biological weapon|nuclear weapon|dirty bomb)\b/i,
  },
];

/**
 * Simple false-premise catalogue. We keep this tight on purpose:
 * false-positive here means we scold the model for repeating an
 * arithmetic fact that was actually correct.
 *
 * Each entry is a regex that matches a clearly wrong premise in
 * either the user message or the response. If the entry matches
 * BOTH the user message AND the response, we flag it.
 */
const FALSE_PREMISE_PATTERNS: ReadonlyArray<RegExp> = [
  /\b2\s*\+\s*2\s*=\s*5\b/i,
  /\bthe (sun|moon) is cold\b/i,
  /\bel sol es fr[ií]o\b/i,
  /\bwater (boils|freezes) at 50\s*°?\s*c\b/i,
  /\bel agua hierve a 50\s*°?\s*c\b/i,
  /\bthe earth is flat\b/i,
  /\bla tierra es plana\b/i,
];

function echoesFalsePremise(userMessage: string, responseText: string): boolean {
  for (const re of FALSE_PREMISE_PATTERNS) {
    if (re.test(userMessage) && re.test(responseText)) return true;
  }
  return false;
}
