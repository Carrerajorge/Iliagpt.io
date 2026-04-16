/**
 * Agentic Reasoning Engine
 *
 * Enables multi-step task execution with thinking transparency.
 * Each step is captured, typed, and emitted so the frontend can
 * render a real-time "thinking timeline".
 */

export interface ReasoningStep {
  id: string;
  type: "think" | "plan" | "execute" | "verify" | "respond";
  title: string;
  content: string;
  toolName?: string;
  toolInput?: any;
  toolOutput?: any;
  confidence?: number; // 0-1
  durationMs?: number;
  status: "pending" | "running" | "completed" | "failed";
}

export interface PlannedStep {
  description: string;
  toolName?: string;
  dependsOn?: string[]; // IDs of prior steps
  estimatedMs: number;
}

export interface ReasoningPlan {
  id: string;
  goal: string;
  steps: PlannedStep[];
  estimatedDurationMs: number;
  estimatedTokens: number;
  complexity: "simple" | "moderate" | "complex";
}

export interface ReasoningSummary {
  totalSteps: number;
  totalDurationMs: number;
  toolsUsed: string[];
  avgConfidence: number;
}

/** Estimated latency per tool (ms). */
const TOOL_LATENCY: Record<string, number> = {
  web_search: 3000, create_document: 5000, execute_code: 2000,
  analyze_data: 4000, generate_image: 10000, browse_web: 4000,
  read_file: 500, write_file: 500, send_email: 2000,
};
const DEFAULT_LATENCY = 2000;
const TOKEN_EST: Record<string, number> = { simple: 500, moderate: 2000, complex: 6000 };

/** Keywords that hint at specific tools. */
const TOOL_KW: Record<string, string[]> = {
  web_search: ["search", "look up", "find online", "google", "buscar", "investigar"],
  create_document: ["document", "word", "docx", "write a report", "crear documento", "informe"],
  execute_code: ["run code", "execute", "python", "script", "calculate", "calcular"],
  analyze_data: ["analyze", "data", "csv", "spreadsheet", "excel", "chart", "analizar", "datos"],
  generate_image: ["image", "picture", "draw", "illustration", "generate image", "imagen"],
  browse_web: ["open website", "browse", "navigate to", "visit url", "navegar"],
};

const COMPLEX_KW = [
  "research report", "comprehensive", "in-depth", "detailed analysis",
  "step by step", "multiple sources", "compare and contrast", "investigación",
];
const MODERATE_KW = [
  "create", "generate", "summarize", "translate", "write", "document",
  "crear", "generar", "resumir",
];

let _idSeq = 0;
function uid(prefix: string): string {
  return `${prefix}-${Date.now()}-${++_idSeq}`;
}

/**
 * Classify user message complexity based on keyword heuristics and length.
 */
export function classifyComplexity(
  message: string,
  intent: string,
): "simple" | "moderate" | "complex" {
  const lower = `${message} ${intent}`.toLowerCase();
  const words = message.trim().split(/\s+/).length;
  if (COMPLEX_KW.some((k) => lower.includes(k)) || words > 80) return "complex";
  if (MODERATE_KW.some((k) => lower.includes(k)) || words > 25) return "moderate";
  return "simple";
}

/**
 * Infer the tool steps required for a given intent and complexity.
 */
export function estimateSteps(intent: string, complexity: string): PlannedStep[] {
  const lower = intent.toLowerCase();
  const steps: PlannedStep[] = [{ description: "Analyze request and determine approach", estimatedMs: 500 }];
  let idx = 1;

  for (const [tool, keywords] of Object.entries(TOOL_KW)) {
    if (keywords.some((kw) => lower.includes(kw))) {
      steps.push({
        description: `Execute ${tool.replace(/_/g, " ")}`,
        toolName: tool,
        dependsOn: idx > 1 ? [`step-${idx - 1}`] : undefined,
        estimatedMs: TOOL_LATENCY[tool] ?? DEFAULT_LATENCY,
      });
      idx++;
    }
  }

  if (complexity === "complex" && steps.length < 4) {
    steps.push({ description: "Synthesize findings across sources", estimatedMs: 1500 });
    steps.push({ description: "Verify accuracy and completeness", estimatedMs: 1000 });
  }

  steps.push({ description: "Compose final response", estimatedMs: 800 });
  return steps;
}

/**
 * Render a reasoning plan into a human-readable string.
 * Supports locale-awareness for Spanish (`es`); defaults to English.
 */
export function formatPlanForUser(plan: ReasoningPlan, locale: string): string {
  const es = locale.startsWith("es");
  const header = `Plan: ${plan.goal} (${plan.complexity})`;
  const lines = plan.steps.map((s, i) => {
    const tool = s.toolName ? ` [${s.toolName}]` : "";
    const t = s.estimatedMs >= 1000 ? `~${(s.estimatedMs / 1000).toFixed(1)}s` : `~${s.estimatedMs}ms`;
    return `  ${i + 1}. ${s.description}${tool} ${t}`;
  });
  const dur = (plan.estimatedDurationMs / 1000).toFixed(1);
  const footer = es
    ? `Duración estimada: ~${dur}s · Tokens: ~${plan.estimatedTokens} · Complejidad: ${plan.complexity}`
    : `Estimated duration: ~${dur}s · Tokens: ~${plan.estimatedTokens} · Complexity: ${plan.complexity}`;
  return [header, ...lines, "", footer].join("\n");
}

// ─── Engine ─────────────────────────────────────────────────────────────

export class AgenticReasoningEngine {
  private steps: ReasoningStep[] = [];
  private onStep?: (step: ReasoningStep) => void;

  constructor(opts?: { onStep?: (step: ReasoningStep) => void }) {
    this.onStep = opts?.onStep;
  }

  /**
   * Analyze request complexity and create an execution plan.
   * Deterministic (no LLM call) so it runs synchronously at turn start.
   */
  planExecution(userMessage: string, intent: string, availableTools: string[]): ReasoningPlan {
    const complexity = classifyComplexity(userMessage, intent);
    const planned = estimateSteps(intent, complexity);

    const filtered = planned.map((s) =>
      s.toolName && !availableTools.includes(s.toolName) ? { ...s, toolName: undefined } : s,
    );
    const estimatedDurationMs = filtered.reduce((sum, s) => sum + s.estimatedMs, 0);

    const plan: ReasoningPlan = {
      id: uid("plan"),
      goal: userMessage.length > 120 ? `${userMessage.slice(0, 117)}...` : userMessage,
      steps: filtered,
      estimatedDurationMs,
      estimatedTokens: TOKEN_EST[complexity] ?? TOKEN_EST.moderate,
      complexity,
    };

    this.emitStep({
      id: uid("rs"), type: "plan", title: "Execution plan created",
      content: `Complexity: ${complexity} · ${filtered.length} steps · ~${(estimatedDurationMs / 1000).toFixed(1)}s`,
      status: "completed", durationMs: 0,
    });
    return plan;
  }

  /** Record a thinking step (internal reasoning, not tool use). */
  think(title: string, content: string): ReasoningStep {
    return this.emitStep({ id: uid("rs"), type: "think", title, content, status: "completed" });
  }

  /** Record a tool execution step. */
  execute(toolName: string, input: any, output: any, durationMs: number): ReasoningStep {
    return this.emitStep({
      id: uid("rs"), type: "execute", title: `Tool: ${toolName}`,
      content: typeof output === "string" ? output : JSON.stringify(output).slice(0, 500),
      toolName, toolInput: input, toolOutput: output, durationMs, status: "completed",
    });
  }

  /** Record a verification step with a confidence score. */
  verify(title: string, content: string, confidence: number): ReasoningStep {
    return this.emitStep({
      id: uid("rs"), type: "verify", title, content,
      confidence: Math.max(0, Math.min(1, confidence)), status: "completed",
    });
  }

  /** Get all recorded steps for timeline visualization. */
  getSteps(): ReasoningStep[] {
    return this.steps.slice();
  }

  /** Aggregate execution summary. */
  getSummary(): ReasoningSummary {
    const toolsUsed = Array.from(new Set(
      this.steps.filter((s) => s.type === "execute" && s.toolName).map((s) => s.toolName!),
    ));
    const totalDurationMs = this.steps.reduce((sum, s) => sum + (s.durationMs ?? 0), 0);
    const confs = this.steps.filter((s) => s.confidence !== undefined).map((s) => s.confidence!);
    const avgConfidence = confs.length > 0
      ? Math.round((confs.reduce((a, b) => a + b, 0) / confs.length) * 100) / 100
      : 0;
    return { totalSteps: this.steps.length, totalDurationMs, toolsUsed, avgConfidence };
  }

  private emitStep(step: ReasoningStep): ReasoningStep {
    this.steps.push(step);
    this.onStep?.(step);
    return step;
  }
}
