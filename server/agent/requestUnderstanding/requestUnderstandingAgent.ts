import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { and, desc, eq } from "drizzle-orm";

import { agentMemoryStore } from "@shared/schema";
import { db } from "../../db";
import { llmGateway } from "../../lib/llmGateway";
import { Logger } from "../../lib/logger";
import { withSpan } from "../../lib/tracing";
import { semanticMemoryStore } from "../../memory/SemanticMemoryStore";
import { guardrails } from "../guardrails";
import { policyEngine } from "../policyEngine";
import {
  RequestBriefSchema,
  type RequestBrief,
} from "./briefSchema";

type KnownUserPlan = "free" | "pro" | "admin";

type PlannerTraceStage = {
  stage: string;
  duration_ms: number;
  status: "ok" | "warning" | "error";
};

type PlannerExecutionState = {
  plannerModel: string;
  plannerMode: "function_calling" | "json" | "heuristic";
  stages: PlannerTraceStage[];
  memoryContext: {
    vectorMemories: string[];
    kvMemories: Array<{ key: string; value: string; type: string }>;
    userPreferences: string[];
    priorDecisions: string[];
  };
  ragContext: string[];
};

export type RequestUnderstandingInput = {
  text: string;
  attachments?: Array<{ type: "document" | "image"; name?: string; extractedText: string }>;
  conversationHistory?: Array<{ role: "user" | "assistant"; content: string }>;
  availableTools?: string[];
  userPlan?: KnownUserPlan;
  userId?: string;
  chatId?: string;
  requestId?: string;
};

const DEFAULT_PLANNER_MODEL = process.env.REQUEST_UNDERSTANDING_PLANNER_MODEL || "gpt-4.1-mini";
const DEFAULT_JSON_FALLBACK_MODEL = process.env.REQUEST_UNDERSTANDING_JSON_MODEL || "grok-4-fast-reasoning";
const MAX_MEMORY_MATCHES = 8;
const MAX_KV_MATCHES = 24;
const MAX_RAG_SNIPPETS = 8;
const isTestEnv = process.env.NODE_ENV === "test" || !!process.env.VITEST_WORKER_ID || !!process.env.VITEST_POOL_ID;

const plannerClient = !isTestEnv && process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

function normalizeText(input: string): string {
  return String(input || "").replace(/\s+/g, " ").trim();
}

function defaultTools(): string[] {
  return [
    "web_search",
    "fetch_url",
    "browse_and_act",
    "list_files",
    "read_file",
    "memory_search",
    "openclaw_rag_search",
    "openclaw_spawn_subagent",
    "openclaw_subagent_status",
    "openclaw_subagent_list",
    "openclaw_subagent_cancel",
    "openclaw_clawi_status",
    "openclaw_clawi_exec",
    "create_document",
    "create_spreadsheet",
    "create_presentation",
    "analyze_data",
    "generate_chart",
  ];
}

function buildPlannerSystemPrompt(): string {
  return `You are an Intent & Requirement Planner.
You MUST produce a structured brief with:
- objective
- scope
- assumptions
- required_inputs
- expected_output
- validations
- definition_of_done
- tool_routing
- risks and success criteria

Constraints:
- be faithful to user intent and context
- avoid inventing unavailable inputs
- explicitly list blockers if critical information is missing
- optimize for safe execution (privacy, policy, security)
- keep language aligned with the user language`;
}

function buildPlannerUserPrompt(input: RequestUnderstandingInput, state: PlannerExecutionState): string {
  const attachments = input.attachments?.length
    ? input.attachments
      .map((a, i) => `ATTACHMENT[${i + 1}] ${a.type} ${a.name ?? ""}: ${normalizeText(a.extractedText).slice(0, 1200)}`)
      .join("\n")
    : "(none)";

  const conversation = input.conversationHistory?.length
    ? input.conversationHistory
      .slice(-5)
      .map((m, i) => `HISTORY[${i + 1}] ${m.role}: ${normalizeText(m.content).slice(0, 600)}`)
      .join("\n")
    : "(none)";

  const memoryHints = state.memoryContext.vectorMemories.length
    ? state.memoryContext.vectorMemories.map((m, i) => `VECTOR_MEMORY[${i + 1}]: ${m}`).join("\n")
    : "(none)";

  const kvHints = state.memoryContext.kvMemories.length
    ? state.memoryContext.kvMemories
      .map((m, i) => `KV_MEMORY[${i + 1}] ${m.type}/${m.key}: ${m.value}`)
      .join("\n")
    : "(none)";

  const ragHints = state.ragContext.length
    ? state.ragContext.map((m, i) => `RAG_SNIPPET[${i + 1}]: ${m}`).join("\n")
    : "(none)";

  const tools = (input.availableTools?.length ? input.availableTools : defaultTools())
    .map((t) => `- ${t}`)
    .join("\n");

  return `USER_REQUEST:
${input.text}

CONVERSATION_CONTEXT:
${conversation}

ATTACHMENTS:
${attachments}

VECTOR_MEMORY_CONTEXT:
${memoryHints}

KEY_VALUE_MEMORY_CONTEXT:
${kvHints}

RAG_CONTEXT:
${ragHints}

AVAILABLE_TOOLS:
${tools}

Create a complete brief and route tools prudently.
If required inputs are missing, mark blocker.is_blocked=true and ask one clarification question.`;
}

function buildJsonFallbackPrompt(input: RequestUnderstandingInput, state: PlannerExecutionState): ChatCompletionMessageParam[] {
  const system = `You are a Request-Understanding Agent.
Return ONLY a valid JSON object following this schema (no markdown):
{
  "intent": { "primary_intent": "string", "confidence": 0.0-1.0 },
  "objective": "string",
  "scope": { "in_scope": ["string"], "out_of_scope": ["string"] },
  "subtasks": [{ "title": "string", "description": "string", "priority": "high|medium|low" }],
  "deliverable": { "description": "string", "format": "string" },
  "audience": { "audience": "string", "tone": "string", "language": "string" },
  "restrictions": [{ "constraint": "string", "hard": true }],
  "data_provided": [{ "key": "string", "value": "any", "source": "provided|extracted|assumed" }],
  "assumptions": ["string"],
  "required_inputs": [{ "input": "string", "required": true, "reason": "string", "source": "user|memory|rag|assumption" }],
  "expected_output": { "description": "string", "format": "string", "structure": ["string"] },
  "validations": [{ "check": "string", "type": "policy|privacy|security|quality|consistency", "required": true }],
  "success_criteria": ["string"],
  "definition_of_done": ["string"],
  "risks": [{ "risk": "string", "severity": "low|medium|high|critical" }],
  "ambiguities": ["string"],
  "tool_routing": { "suggested_tools": ["string"], "blocked_tools": ["string"], "rationale": "string" },
  "guardrails": { "policy_ok": true, "privacy_ok": true, "security_ok": true, "pii_detected": false, "flags": ["string"] },
  "self_check": { "passed": true, "score": 0.0-1.0, "issues": ["string"] },
  "trace": { "planner_model": "string", "planner_mode": "function_calling|json|heuristic", "total_duration_ms": 0, "stages": [] },
  "blocker": { "is_blocked": false, "question": "" }
}
Rules:
- subtasks must be 2 to 5
- if blocked, ask exactly one question
- produce a strong definition_of_done list`;

  const user = buildPlannerUserPrompt(input, state);
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

function dedupeStrings(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const normalized = normalizeText(item);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

function buildHeuristicBrief(text: string): RequestBrief {
  const intentText = text.length > 120 ? text.substring(0, 120) + "..." : text;
  return RequestBriefSchema.parse({
    intent: { primary_intent: intentText, confidence: 0.5 },
    objective: `Resolver: ${intentText}`,
    scope: { in_scope: [intentText], out_of_scope: [] },
    subtasks: [
      { title: "Analizar solicitud", description: "Entender intención y contexto del usuario", priority: "high" },
      { title: "Ejecutar tarea", description: "Producir resultado alineado a la solicitud", priority: "high" },
    ],
    deliverable: { description: "Respuesta completa al usuario", format: "markdown" },
    audience: { audience: "general", tone: "direct", language: "es" },
    restrictions: [],
    data_provided: [],
    assumptions: [],
    required_inputs: [],
    expected_output: { description: "Respuesta accionable", format: "markdown", structure: [] },
    validations: [{ check: "Respuesta relevante a la solicitud", type: "quality", required: true }],
    success_criteria: ["Solicitud resuelta correctamente"],
    definition_of_done: ["Respuesta entregada al usuario"],
    risks: [],
    ambiguities: [],
    tool_routing: { suggested_tools: ["web_search", "fetch_url"], blocked_tools: [], rationale: "Herramientas básicas de búsqueda" },
    guardrails: { policy_ok: true, privacy_ok: true, security_ok: true, pii_detected: false, flags: [] },
    self_check: { passed: true, score: 0.6, issues: [] },
    trace: { planner_model: "heuristic", planner_mode: "heuristic", total_duration_ms: 0, stages: [] },
    blocker: { is_blocked: false },
  });
}

function coercePlannerBrief(raw: unknown): RequestBrief {
  const safeRaw: any = (raw && typeof raw === "object") ? { ...raw as any } : {};

  if (!safeRaw.intent || typeof safeRaw.intent !== "object") {
    safeRaw.intent = { primary_intent: safeRaw.objective || "Resolver solicitud del usuario", confidence: 0.5 };
  }
  if (!safeRaw.subtasks || !Array.isArray(safeRaw.subtasks) || safeRaw.subtasks.length < 2) {
    safeRaw.subtasks = [
      { title: "Analizar solicitud", description: "Entender intención y contexto", priority: "high" },
      { title: "Ejecutar tarea", description: "Producir resultado alineado", priority: "high" },
    ];
  }
  if (!safeRaw.deliverable || typeof safeRaw.deliverable !== "object") {
    safeRaw.deliverable = { description: "Respuesta completa", format: "markdown" };
  }
  if (!safeRaw.audience || typeof safeRaw.audience !== "object") {
    safeRaw.audience = { audience: "general", tone: "direct", language: "es" };
  }
  if (!safeRaw.expected_output || typeof safeRaw.expected_output !== "object") {
    safeRaw.expected_output = { description: "Respuesta accionable", format: "markdown", structure: [] };
  }

  const parsed = RequestBriefSchema.parse(safeRaw);

  parsed.objective = normalizeText(parsed.objective || parsed.intent.primary_intent || "Resolver solicitud");

  if (parsed.subtasks.length < 2) {
    parsed.subtasks = [
      { title: "Entender requerimiento", description: "Analizar intención y restricciones", priority: "high" },
      { title: "Ejecutar entrega", description: "Producir resultado alineado al brief", priority: "high" },
    ];
  }
  if (parsed.subtasks.length > 5) {
    parsed.subtasks = parsed.subtasks.slice(0, 5);
  }

  parsed.assumptions = dedupeStrings(parsed.assumptions);
  parsed.success_criteria = dedupeStrings(parsed.success_criteria);
  parsed.definition_of_done = dedupeStrings(
    parsed.definition_of_done.length > 0
      ? parsed.definition_of_done
      : parsed.success_criteria.map((criterion) => `Cumplido: ${criterion}`)
  );
  parsed.ambiguities = dedupeStrings(parsed.ambiguities);

  if (!parsed.expected_output.description) {
    parsed.expected_output.description = parsed.deliverable.description;
  }
  if (!parsed.expected_output.format) {
    parsed.expected_output.format = parsed.deliverable.format;
  }

  parsed.tool_routing.suggested_tools = dedupeStrings(parsed.tool_routing.suggested_tools);
  parsed.tool_routing.blocked_tools = dedupeStrings(parsed.tool_routing.blocked_tools);

  if (parsed.blocker?.is_blocked) {
    parsed.blocker.question = normalizeText(parsed.blocker.question || "");
    if (!parsed.blocker.question) {
      parsed.blocker.question = "¿Qué información falta para poder completar el encargo con seguridad?";
    }
  }

  return parsed;
}

async function fetchVectorMemoryContext(input: RequestUnderstandingInput): Promise<string[]> {
  if (!input.userId) return [];
  try {
    await semanticMemoryStore.initialize();
    const results = await semanticMemoryStore.search(input.userId, input.text, {
      limit: MAX_MEMORY_MATCHES,
      minScore: 0.28,
      hybridSearch: true,
    });
    return results.map((result) => normalizeText(result.chunk.content)).filter(Boolean);
  } catch (err: any) {
    Logger.warn(`[RequestUnderstanding] vector memory retrieval failed: ${err?.message || err}`);
    return [];
  }
}

async function fetchKeyValueMemoryContext(
  input: RequestUnderstandingInput
): Promise<Array<{ key: string; value: string; type: string }>> {
  if (!input.userId && !input.chatId) return [];
  try {
    const conditions = [];
    if (input.userId) conditions.push(eq(agentMemoryStore.userId, input.userId));
    if (input.chatId) conditions.push(eq(agentMemoryStore.chatId, input.chatId));

    let query = db
      .select()
      .from(agentMemoryStore)
      .orderBy(desc(agentMemoryStore.updatedAt))
      .limit(MAX_KV_MATCHES);

    if (conditions.length === 1) {
      query = query.where(conditions[0]) as typeof query;
    } else if (conditions.length > 1) {
      query = query.where(and(...conditions)) as typeof query;
    }

    const rows = await query;
    return rows.map((row) => ({
      key: row.memoryKey,
      value: normalizeText(
        typeof row.memoryValue === "string"
          ? row.memoryValue
          : JSON.stringify(row.memoryValue ?? {})
      ),
      type: String(row.memoryType || "context"),
    })).filter((row) => row.value.length > 0);
  } catch (err: any) {
    Logger.warn(`[RequestUnderstanding] kv memory retrieval failed: ${err?.message || err}`);
    return [];
  }
}

function extractPreferenceAndDecisionContext(
  kvMemories: Array<{ key: string; value: string; type: string }>
): { userPreferences: string[]; priorDecisions: string[] } {
  const preferences: string[] = [];
  const decisions: string[] = [];

  for (const memory of kvMemories) {
    const key = memory.key.toLowerCase();
    const type = memory.type.toLowerCase();
    if (type.includes("preference") || key.includes("prefer") || key.includes("style") || key.includes("tone")) {
      preferences.push(`${memory.key}: ${memory.value}`);
    }
    if (type.includes("decision") || key.includes("decision") || key.includes("approved") || key.includes("constraint")) {
      decisions.push(`${memory.key}: ${memory.value}`);
    }
  }

  return {
    userPreferences: dedupeStrings(preferences),
    priorDecisions: dedupeStrings(decisions),
  };
}

function buildRagContext(
  input: RequestUnderstandingInput,
  vectorMemories: string[],
  kvMemories: Array<{ key: string; value: string; type: string }>
): string[] {
  const snippets: string[] = [];
  snippets.push(...vectorMemories.slice(0, Math.ceil(MAX_RAG_SNIPPETS / 2)));
  snippets.push(
    ...kvMemories
      .filter((item) => item.type === "context" || item.type === "fact" || item.type === "preference")
      .slice(0, Math.ceil(MAX_RAG_SNIPPETS / 2))
      .map((item) => `${item.key}: ${item.value}`)
  );
  if (input.attachments?.length) {
    snippets.push(
      ...input.attachments
        .map((item) => normalizeText(item.extractedText).slice(0, 500))
        .filter(Boolean)
    );
  }
  return dedupeStrings(snippets).slice(0, MAX_RAG_SNIPPETS);
}

async function callPlannerWithFunctionCalling(
  input: RequestUnderstandingInput,
  state: PlannerExecutionState,
  requestId: string,
): Promise<RequestBrief | null> {
  if (!plannerClient) return null;

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: buildPlannerSystemPrompt() },
    { role: "user", content: buildPlannerUserPrompt(input, state) },
  ];

  const response = await plannerClient.chat.completions.create({
    model: DEFAULT_PLANNER_MODEL,
    temperature: 0,
    max_tokens: 2000,
    messages,
    tools: [
      {
        type: "function",
        function: {
          name: "submit_request_brief",
          description: "Submit the fully structured request brief and tool routing plan.",
          parameters: {
            type: "object",
            properties: {
              brief: {
                type: "object",
                description: "The complete planning brief.",
              },
            },
            required: ["brief"],
            additionalProperties: false,
          },
        },
      },
    ],
    tool_choice: {
      type: "function",
      function: { name: "submit_request_brief" },
    },
    user: input.userId || requestId,
  });

  const toolCall = response.choices[0]?.message?.tool_calls?.[0];
  if (!toolCall || toolCall.type !== "function") return null;

  let args: any = {};
  try {
    args = JSON.parse(toolCall.function.arguments || "{}");
  } catch {
    return null;
  }

  const rawBrief = args.brief ?? args;
  return coercePlannerBrief(rawBrief);
}

async function callPlannerWithJsonFallback(
  input: RequestUnderstandingInput,
  state: PlannerExecutionState,
  requestId: string,
): Promise<RequestBrief> {
  const messages = buildJsonFallbackPrompt(input, state);
  const maxRetries = 2;
  let lastErr: any;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await llmGateway.chat(messages, {
        requestId,
        userId: input.userId,
        model: DEFAULT_JSON_FALLBACK_MODEL,
        provider: "auto",
        temperature: 0,
        maxTokens: 1800,
        enableFallback: true,
      });

      let raw = normalizeText(result.content || "");
      if (raw.startsWith("```")) {
        raw = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
      }
      const parsed = JSON.parse(raw);
      return coercePlannerBrief(parsed);
    } catch (err: any) {
      lastErr = err;
      Logger.warn(`[RequestUnderstanding] json planner parse failed attempt=${attempt + 1}: ${err?.message || err}`);
      messages.push({ role: "assistant", content: "{\"error\":\"invalid_output\"}" });
      messages.push({
        role: "user",
        content: `The previous output was invalid. Return ONLY valid JSON. Error: ${err?.message || err}`,
      });
    }
  }

  Logger.warn(`[RequestUnderstanding] All planner attempts failed, using heuristic brief. Last error: ${lastErr?.message || lastErr}`);
  return buildHeuristicBrief(input.text);
}

function hardSecurityFlagsFromText(text: string): string[] {
  const normalized = text.toLowerCase();
  const flags: string[] = [];
  if (/\b(ignore previous|system prompt|bypass|jailbreak|override)\b/i.test(normalized)) {
    flags.push("possible_prompt_injection");
  }
  if (/\b(delete database|drop table|exfiltrate|token|password dump)\b/i.test(normalized)) {
    flags.push("possible_destructive_or_exfiltration_intent");
  }
  return flags;
}

function applyToolPolicyChecks(
  brief: RequestBrief,
  input: RequestUnderstandingInput
): { blockedTools: string[]; flags: string[] } {
  const blockedTools: string[] = [];
  const flags: string[] = [];
  const userPlan: KnownUserPlan = input.userPlan || "free";
  const userId = input.userId || "anonymous";

  for (const toolName of brief.tool_routing.suggested_tools) {
    const check = policyEngine.checkAccess({
      toolName,
      userPlan,
      userId,
      isConfirmed: false,
    });
    if (!check.allowed && !check.requiresConfirmation) {
      blockedTools.push(toolName);
      flags.push(`policy_block:${toolName}:${check.reason}`);
    }
  }

  return {
    blockedTools: dedupeStrings(blockedTools),
    flags: dedupeStrings(flags),
  };
}

function runSelfCheck(brief: RequestBrief): { passed: boolean; score: number; issues: string[] } {
  const issues: string[] = [];
  if (!normalizeText(brief.objective)) issues.push("missing_objective");
  if (brief.scope.in_scope.length === 0) issues.push("missing_scope_in_scope");
  if (brief.required_inputs.filter((input) => input.required).length === 0) issues.push("missing_required_inputs");
  if (brief.validations.length === 0) issues.push("missing_validations");
  if (brief.definition_of_done.length === 0) issues.push("missing_definition_of_done");
  if (brief.success_criteria.length === 0) issues.push("missing_success_criteria");
  if (brief.tool_routing.suggested_tools.length === 0) issues.push("missing_tool_routing");
  if (brief.subtasks.length < 2) issues.push("insufficient_subtasks");

  const penalty = Math.min(0.8, issues.length * 0.1);
  const score = Math.max(0.1, Number((0.95 - penalty).toFixed(2)));
  const passed = score >= 0.6 && issues.length <= 4;
  return { passed, score, issues };
}

async function upsertAgentMemory(
  input: RequestUnderstandingInput,
  key: string,
  value: unknown,
  type: string
): Promise<void> {
  if (!input.userId && !input.chatId) return;
  try {
    const conditions = [eq(agentMemoryStore.memoryKey, key)];
    if (input.userId) conditions.push(eq(agentMemoryStore.userId, input.userId));
    if (input.chatId) conditions.push(eq(agentMemoryStore.chatId, input.chatId));

    const whereClause = conditions.length > 1 ? and(...conditions) : conditions[0];

    const existing = await db
      .select()
      .from(agentMemoryStore)
      .where(whereClause)
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(agentMemoryStore)
        .set({
          memoryValue: value as any,
          memoryType: type,
          updatedAt: new Date(),
        })
        .where(eq(agentMemoryStore.id, existing[0].id));
      return;
    }

    await db.insert(agentMemoryStore).values({
      chatId: input.chatId || null,
      userId: input.userId || null,
      memoryKey: key,
      memoryValue: value as any,
      memoryType: type,
    });
  } catch (err: any) {
    Logger.warn(`[RequestUnderstanding] kv memory upsert failed (${key}): ${err?.message || err}`);
  }
}

async function persistPlanningMemory(input: RequestUnderstandingInput, brief: RequestBrief): Promise<void> {
  if (!input.userId && !input.chatId) return;

  await Promise.allSettled([
    upsertAgentMemory(input, "planner:last_intent", {
      intent: brief.intent.primary_intent,
      confidence: brief.intent.confidence,
    }, "context"),
    upsertAgentMemory(input, "planner:last_objective", brief.objective, "context"),
    upsertAgentMemory(input, "planner:last_definition_of_done", brief.definition_of_done, "decision"),
    upsertAgentMemory(input, "planner:last_tool_route", brief.tool_routing, "decision"),
  ]);

  if (input.userId) {
    try {
      await semanticMemoryStore.initialize();
      await semanticMemoryStore.remember(
        input.userId,
        `Intento actual: ${brief.intent.primary_intent}. Objetivo: ${brief.objective}. DoD: ${brief.definition_of_done.join("; ")}`,
        "note",
        { source: "request_planner", confidence: 0.82, tags: ["brief", "intent"] }
      );
    } catch (err: any) {
      Logger.warn(`[RequestUnderstanding] vector memory persist failed: ${err?.message || err}`);
    }
  }
}

export class RequestUnderstandingAgent {
  private async runPlannerGraph(input: RequestUnderstandingInput): Promise<{ brief: RequestBrief; state: PlannerExecutionState }> {
    const state: PlannerExecutionState = {
      plannerModel: DEFAULT_JSON_FALLBACK_MODEL,
      plannerMode: "heuristic",
      stages: [],
      memoryContext: {
        vectorMemories: [],
        kvMemories: [],
        userPreferences: [],
        priorDecisions: [],
      },
      ragContext: [],
    };

    const requestId = input.requestId ?? `ru_${Date.now()}`;

    const runStage = async (
      stageName: string,
      fn: () => Promise<void>
    ): Promise<void> => {
      const startedAt = Date.now();
      try {
        await fn();
        state.stages.push({
          stage: stageName,
          duration_ms: Date.now() - startedAt,
          status: "ok",
        });
      } catch (err: any) {
        state.stages.push({
          stage: stageName,
          duration_ms: Date.now() - startedAt,
          status: "error",
        });
        throw err;
      }
    };

    await runStage("memory", async () => {
      const [vectorMemories, kvMemories] = await Promise.all([
        fetchVectorMemoryContext(input),
        fetchKeyValueMemoryContext(input),
      ]);
      state.memoryContext.vectorMemories = vectorMemories;
      state.memoryContext.kvMemories = kvMemories;
      const structured = extractPreferenceAndDecisionContext(kvMemories);
      state.memoryContext.userPreferences = structured.userPreferences;
      state.memoryContext.priorDecisions = structured.priorDecisions;
    });

    await runStage("rag", async () => {
      state.ragContext = buildRagContext(input, state.memoryContext.vectorMemories, state.memoryContext.kvMemories);
    });

    let brief: RequestBrief | null = null;
    await runStage("planner", async () => {
      const functionCallingBrief = await callPlannerWithFunctionCalling(input, state, requestId);
      if (functionCallingBrief) {
        state.plannerModel = DEFAULT_PLANNER_MODEL;
        state.plannerMode = "function_calling";
        brief = functionCallingBrief;
        return;
      }

      const jsonFallbackBrief = await callPlannerWithJsonFallback(input, state, requestId);
      state.plannerModel = DEFAULT_JSON_FALLBACK_MODEL;
      state.plannerMode = "json";
      brief = jsonFallbackBrief;
    });

    if (!brief) {
      throw new Error("Planner failed to produce a brief");
    }

    await runStage("guardrails", async () => {
      const piiMatches = guardrails.detectPII(input.text);
      const securityFlags = hardSecurityFlagsFromText(input.text);
      const { blockedTools, flags: policyFlags } = applyToolPolicyChecks(brief!, input);
      const allFlags = dedupeStrings([...securityFlags, ...policyFlags]);

      brief!.tool_routing.blocked_tools = dedupeStrings([
        ...brief!.tool_routing.blocked_tools,
        ...blockedTools,
      ]);

      brief!.guardrails = {
        policy_ok: blockedTools.length === 0,
        privacy_ok: piiMatches.length === 0,
        security_ok: securityFlags.length === 0,
        pii_detected: piiMatches.length > 0,
        flags: allFlags,
      };

      if (piiMatches.length > 0 && !brief!.restrictions.some((restriction) => restriction.constraint.toLowerCase().includes("pii"))) {
        brief!.restrictions.push({
          constraint: "Se detectaron datos sensibles (PII). Evitar exposición en respuesta o acciones.",
          hard: true,
        });
      }

      if (blockedTools.length > 0 && !brief!.blocker.is_blocked) {
        brief!.blocker.is_blocked = true;
        brief!.blocker.question = "Para continuar necesito confirmar alternativas seguras porque algunas herramientas están bloqueadas por política. ¿Deseas continuar sin esas herramientas?";
      }
    });

    await runStage("critic", async () => {
      const selfCheck = runSelfCheck(brief!);
      brief!.self_check = selfCheck;

      const hasCriticalIssue = selfCheck.issues.includes("missing_objective") && selfCheck.score < 0.3;
      if (hasCriticalIssue && !brief!.blocker.is_blocked) {
        brief!.blocker.is_blocked = true;
        brief!.blocker.question =
          "Faltan datos para cumplir la definición de terminado con calidad. ¿Puedes confirmar alcance, entradas requeridas y criterios de éxito?";
      }
    });

    brief.trace = {
      planner_model: state.plannerModel,
      planner_mode: state.plannerMode,
      total_duration_ms: state.stages.reduce((sum, stage) => sum + stage.duration_ms, 0),
      stages: state.stages,
    };

    // Keep route aligned with available tools and detect obvious blockers.
    const availableTools = input.availableTools?.length ? input.availableTools : defaultTools();
    const allowedToolSet = new Set(availableTools);
    const unknownTools = brief.tool_routing.suggested_tools.filter((toolName) => !allowedToolSet.has(toolName));
    if (unknownTools.length > 0) {
      brief.tool_routing.blocked_tools = dedupeStrings([...brief.tool_routing.blocked_tools, ...unknownTools]);
      brief.tool_routing.suggested_tools = brief.tool_routing.suggested_tools.filter((toolName) => allowedToolSet.has(toolName));
      if (!brief.blocker.is_blocked) {
        brief.ambiguities.push(`Planner sugirió herramientas no disponibles: ${unknownTools.join(", ")}`);
      }
    }

    if (brief.blocker.is_blocked) {
      brief.blocker.question = normalizeText(brief.blocker.question || "");
      if (!brief.blocker.question) {
        brief.blocker.question = "¿Qué información falta para poder completar el encargo?";
      }
    }

    return { brief, state };
  }

  async buildBrief(input: RequestUnderstandingInput): Promise<RequestBrief> {
    return withSpan("request_understanding.graph", async (span) => {
      const startedAt = Date.now();
      const normalizedInput: RequestUnderstandingInput = {
        ...input,
        text: normalizeText(input.text),
      };

      if (!normalizedInput.text) {
        throw new Error("Request text is required for request understanding");
      }

      const { brief, state } = await this.runPlannerGraph(normalizedInput);
      await persistPlanningMemory(normalizedInput, brief);

      span.setAttribute("ru.intent", brief.intent.primary_intent);
      span.setAttribute("ru.intent_confidence", brief.intent.confidence);
      span.setAttribute("ru.blocked", brief.blocker.is_blocked);
      span.setAttribute("ru.planner_mode", state.plannerMode);
      span.setAttribute("ru.stage_count", state.stages.length);
      span.setAttribute("ru.total_duration_ms", Date.now() - startedAt);

      return brief;
    });
  }
}

export const requestUnderstandingAgent = new RequestUnderstandingAgent();
