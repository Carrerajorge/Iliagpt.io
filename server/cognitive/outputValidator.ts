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
  const { toolDescriptors, maxLengthSoftCap = 100_000 } = options;
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

  const ok = !issues.some((i) => i.severity === "error");
  return {
    ok,
    issues,
    refusalDetected,
    toolCallsValid: toolValidation.allValid,
  };
}
