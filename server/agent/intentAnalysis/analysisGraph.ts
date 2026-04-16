/**
 * LangGraph State Machine for Intent Analysis Pipeline
 *
 * Graph topology:
 *   START → classify_regex → [shouldEscalate]
 *     → (high confidence) → [shouldBrief]
 *     → (low confidence)  → classify_llm → [shouldBrief]
 *   [shouldBrief]
 *     → (agentic) → generate_brief → validate_brief → [isValidBrief]
 *     → (simple)  → END
 *   [isValidBrief]
 *     → (valid)       → END
 *     → (invalid, <2) → generate_brief (retry)
 *     → (invalid, >=2) → END (best-effort)
 *
 * No checkpointing — analysis completes in <5s, no need for persistence.
 */

import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import type { IntentType, AttachmentSpec } from "../requestSpec";
import type { RequestBrief } from "../requestUnderstanding/briefSchema";
import type { LlmIntentClassification } from "./schemas";

import { classifyRegex, classifyLlm, generateBrief, validateBrief } from "./analysisNodes";
import { shouldEscalate, shouldBrief, isValidBrief } from "./analysisEdges";
import { traceAnalysisNode } from "./analysisTracer";

// ─── State Shape ─────────────────────────────────────────────────────

export interface AnalysisMetrics {
  regexLatencyMs?: number;
  llmLatencyMs?: number;
  briefLatencyMs?: number;
  totalLatencyMs?: number;
}

export interface MergedIntent {
  intent: IntentType;
  confidence: number;
  source: "regex" | "llm" | "hybrid";
}

export interface ValidationResult {
  isValid: boolean;
  issues: string[];
  score: number;
}

export interface AnalysisState {
  // Input
  rawMessage: string;
  attachments: AttachmentSpec[];
  conversationHistory: Array<{ role: string; content: string }>;
  userId: string;
  chatId: string;

  // Pipeline state
  regexResult: { intent: IntentType; confidence: number } | null;
  llmResult: LlmIntentClassification | null;
  mergedIntent: MergedIntent | null;
  brief: RequestBrief | null;
  validationResult: ValidationResult | null;

  // Control
  currentPhase: string;
  error: string | undefined;
  retryCount: number;
  metrics: AnalysisMetrics;
}

// ─── LangGraph Annotation ────────────────────────────────────────────

export const AnalysisStateAnnotation = Annotation.Root({
  rawMessage: Annotation<string>({ reducer: (_, n) => n, default: () => "" }),
  attachments: Annotation<AttachmentSpec[]>({ reducer: (_, n) => n, default: () => [] }),
  conversationHistory: Annotation<Array<{ role: string; content: string }>>({
    reducer: (_, n) => n,
    default: () => [],
  }),
  userId: Annotation<string>({ reducer: (_, n) => n, default: () => "" }),
  chatId: Annotation<string>({ reducer: (_, n) => n, default: () => "" }),

  regexResult: Annotation<{ intent: IntentType; confidence: number } | null>({
    reducer: (_, n) => n,
    default: () => null,
  }),
  llmResult: Annotation<LlmIntentClassification | null>({
    reducer: (_, n) => n,
    default: () => null,
  }),
  mergedIntent: Annotation<MergedIntent | null>({
    reducer: (_, n) => n,
    default: () => null,
  }),
  brief: Annotation<RequestBrief | null>({
    reducer: (_, n) => n,
    default: () => null,
  }),
  validationResult: Annotation<ValidationResult | null>({
    reducer: (_, n) => n,
    default: () => null,
  }),

  currentPhase: Annotation<string>({ reducer: (_, n) => n, default: () => "start" }),
  error: Annotation<string | undefined>({ reducer: (_, n) => n, default: () => undefined }),
  retryCount: Annotation<number>({ reducer: (_, n) => n, default: () => 0 }),
  metrics: Annotation<AnalysisMetrics>({
    reducer: (prev, next) => ({ ...prev, ...next }),
    default: () => ({}),
  }),
});

// ─── Build Graph ─────────────────────────────────────────────────────

function createAnalysisGraph() {
  const graph = new StateGraph(AnalysisStateAnnotation)
    // Nodes
    .addNode("classify_regex", classifyRegex)
    .addNode("classify_llm", classifyLlm)
    .addNode("generate_brief", generateBrief)
    .addNode("validate_brief", validateBrief)

    // Edges
    .addEdge(START, "classify_regex")
    .addConditionalEdges("classify_regex", shouldEscalate, {
      classify_llm: "classify_llm",
      check_brief_needed: "check_brief_needed", // virtual — routed by shouldBrief
    })

    // After LLM classification → check if brief needed
    .addConditionalEdges("classify_llm", shouldBrief, {
      generate_brief: "generate_brief",
      __end__: END,
    })

    // After brief generation → validate
    .addEdge("generate_brief", "validate_brief")

    // After validation → done or retry
    .addConditionalEdges("validate_brief", isValidBrief, {
      __end__: END,
      generate_brief: "generate_brief",
    });

  // "check_brief_needed" is a virtual node that routes based on intent.
  // We implement it as a conditional edge from classify_regex's alternate path.
  // LangGraph doesn't support virtual nodes, so we redirect the edge target.

  return graph;
}

// The graph needs the "check_brief_needed" node for the conditional edge from classify_regex.
// We add it as a passthrough node that routes based on shouldBrief.
function createAnalysisGraphV2() {
  // Wrap nodes with OTel tracing (no-op if OTel not configured)
  const tracedClassifyRegex = traceAnalysisNode("classify_regex", classifyRegex);
  const tracedClassifyLlm = traceAnalysisNode("classify_llm", classifyLlm);
  const tracedGenerateBrief = traceAnalysisNode("generate_brief", generateBrief);
  const tracedValidateBrief = traceAnalysisNode("validate_brief", validateBrief);

  const graph = new StateGraph(AnalysisStateAnnotation)
    // Nodes (wrapped with OTel spans)
    .addNode("classify_regex", tracedClassifyRegex)
    .addNode("classify_llm", tracedClassifyLlm)
    .addNode("route_brief", async (state: AnalysisState) => state) // passthrough routing node
    .addNode("generate_brief", tracedGenerateBrief)
    .addNode("validate_brief", tracedValidateBrief)

    // START → classify_regex
    .addEdge(START, "classify_regex")

    // classify_regex → escalate or route_brief
    .addConditionalEdges("classify_regex", shouldEscalate, {
      classify_llm: "classify_llm",
      check_brief_needed: "route_brief",
    })

    // classify_llm → route_brief
    .addEdge("classify_llm", "route_brief")

    // route_brief → generate_brief or END
    .addConditionalEdges("route_brief", shouldBrief, {
      generate_brief: "generate_brief",
      __end__: END,
    })

    // generate_brief → validate_brief
    .addEdge("generate_brief", "validate_brief")

    // validate_brief → END or retry generate_brief
    .addConditionalEdges("validate_brief", isValidBrief, {
      __end__: END,
      generate_brief: "generate_brief",
    });

  return graph;
}

// ─── Compiled Graph (singleton) ──────────────────────────────────────

let compiledGraph: ReturnType<ReturnType<typeof createAnalysisGraphV2>["compile"]> | null = null;

export function getAnalysisGraph() {
  if (!compiledGraph) {
    compiledGraph = createAnalysisGraphV2().compile();
  }
  return compiledGraph;
}
