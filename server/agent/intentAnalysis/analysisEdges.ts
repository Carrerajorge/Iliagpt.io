/**
 * Conditional Edge Functions for the Intent Analysis Graph
 *
 * These determine routing between nodes based on pipeline state.
 */

import type { AnalysisState } from "./analysisGraph";

const ESCALATION_THRESHOLD = 0.7;
const MAX_BRIEF_RETRIES = 2;

// Intents that trigger agentic mode and need a brief
const AGENTIC_INTENTS = new Set([
  "research",
  "document_generation",
  "presentation_creation",
  "spreadsheet_creation",
  "data_analysis",
  "code_generation",
  "web_automation",
  "multi_step_task",
]);

/**
 * After regex classification: should we escalate to LLM?
 */
export function shouldEscalate(state: AnalysisState): "classify_llm" | "check_brief_needed" {
  const confidence = state.regexResult?.confidence ?? 0;
  if (confidence < ESCALATION_THRESHOLD) {
    return "classify_llm";
  }
  return "check_brief_needed";
}

/**
 * After classification: do we need a brief?
 */
export function shouldBrief(state: AnalysisState): "generate_brief" | "__end__" {
  const intent = state.mergedIntent?.intent;
  if (intent && AGENTIC_INTENTS.has(intent)) {
    return "generate_brief";
  }
  return "__end__";
}

/**
 * After brief validation: is the brief good enough?
 */
export function isValidBrief(state: AnalysisState): "__end__" | "generate_brief" {
  if (state.validationResult?.isValid) {
    return "__end__";
  }
  // Retry if under limit
  if (state.retryCount < MAX_BRIEF_RETRIES) {
    return "generate_brief";
  }
  // Exceeded retries: proceed with best-effort
  return "__end__";
}
