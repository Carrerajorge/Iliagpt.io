/**
 * ResponseChaining — Multi-step AI call pipeline for high-quality responses
 *
 * Chains AI calls through a structured pipeline:
 *   understand → gather → generate → verify → format
 *
 * Each step enriches a shared ChainPayload. Steps can short-circuit,
 * run in parallel where data-independent, and respect a token budget.
 * Integrates with SemanticRouter for route-aware optimizations.
 */

import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import pino from "pino";
import { getClaudeAgentBackbone } from "../agentic/ClaudeAgentBackbone.js";
import { getSemanticRouter, type RoutingResult } from "./SemanticRouter.js";

const logger = pino({ name: "ResponseChaining" });

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline Types
// ─────────────────────────────────────────────────────────────────────────────

export type ChainStep =
  | "understand"
  | "gather"
  | "generate"
  | "verify"
  | "format";

export interface UnderstandResult {
  intent: string;
  complexity: "trivial" | "simple" | "moderate" | "complex";
  requiresContext: boolean;
  requiresVerification: boolean;
  keyEntities: string[];
  questionType: "factual" | "analytical" | "creative" | "instructional" | "conversational";
  canShortCircuit: boolean;
  directAnswer?: string; // set if trivially answerable
}

export interface GatherResult {
  memoryContext: string[];
  searchResults: string[];
  ragChunks: string[];
  combinedContext: string;
  sourcesUsed: string[];
  gatherTimeMs: number;
}

export interface GenerateResult {
  rawResponse: string;
  confidence: number;
  tokensUsed: number;
  model: string;
  generationTimeMs: number;
}

export interface VerifyResult {
  isFactuallyConsistent: boolean;
  issues: string[];
  correctedResponse?: string;
  confidenceAdjustment: number;
  verificationTimeMs: number;
  skipped: boolean;
  skipReason?: string;
}

export interface FormatResult {
  formattedResponse: string;
  format: "markdown" | "plain" | "json" | "html" | "code";
  wordCount: number;
  estimatedReadTimeSeconds: number;
}

export interface ChainPayload {
  chainId: string;
  originalMessage: string;
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>;
  routingResult?: RoutingResult;
  understand?: UnderstandResult;
  gather?: GatherResult;
  generate?: GenerateResult;
  verify?: VerifyResult;
  format?: FormatResult;
  /** Token budget remaining at each step */
  tokenBudget: {
    total: number;
    used: number;
    remaining: number;
  };
  /** Steps completed in order */
  completedSteps: ChainStep[];
  /** Step timings */
  stepTimings: Partial<Record<ChainStep, number>>;
  startedAt: Date;
  completedAt?: Date;
  totalTokensUsed: number;
}

export interface ChainResponse {
  response: string;
  chainId: string;
  stepsExecuted: ChainStep[];
  wasShortCircuited: boolean;
  shortCircuitReason?: string;
  totalTokensUsed: number;
  totalTimeMs: number;
  routingResult?: RoutingResult;
  metadata: {
    complexity: string;
    questionType: string;
    contextsGathered: number;
    verificationApplied: boolean;
    format: string;
    confidence: number;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// External Provider Interfaces
// ─────────────────────────────────────────────────────────────────────────────

export interface MemoryProvider {
  recall(query: string, limit?: number): Promise<string[]>;
}

export interface RAGProvider {
  retrieve(query: string, limit?: number): Promise<Array<{ content: string; source: string }>>;
}

export interface SearchProvider {
  search(query: string, limit?: number): Promise<Array<{ title: string; snippet: string; url: string }>>;
}

export interface ChainOptions {
  /** Maximum total tokens across all chain steps */
  totalTokenBudget?: number;
  /** Steps to skip */
  skipSteps?: ChainStep[];
  /** Whether to use semantic routing */
  useRouting?: boolean;
  /** Force a specific format for the final response */
  forceFormat?: "markdown" | "plain" | "json" | "html" | "code";
  /** Custom system prompt to inject at generate step */
  systemPromptOverride?: string;
  /** Verification strictness: 'none' skips verify, 'light' spot-checks, 'strict' full fact-check */
  verificationMode?: "none" | "light" | "strict";
  /** Callback invoked after each step completes */
  onStepComplete?: (step: ChainStep, payload: ChainPayload) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Step Implementations
// ─────────────────────────────────────────────────────────────────────────────

async function stepUnderstand(
  payload: ChainPayload,
  backbone: ReturnType<typeof getClaudeAgentBackbone>
): Promise<UnderstandResult> {
  const historySnippet = payload.conversationHistory
    .slice(-4)
    .map((m) => `${m.role}: ${m.content.slice(0, 200)}`)
    .join("\n");

  const prompt = `Analyze this user message and return a JSON understanding object.

Message: "${payload.originalMessage}"
${historySnippet ? `\nRecent conversation:\n${historySnippet}` : ""}

Return ONLY valid JSON with these exact fields:
{
  "intent": "concise description of what user wants",
  "complexity": "trivial|simple|moderate|complex",
  "requiresContext": true/false,
  "requiresVerification": true/false,
  "keyEntities": ["entity1", "entity2"],
  "questionType": "factual|analytical|creative|instructional|conversational",
  "canShortCircuit": true/false,
  "directAnswer": "answer if trivial/conversational, otherwise null"
}

canShortCircuit=true when: greetings, simple factual questions with obvious answers,
direct continuation of conversation, or when no context or verification is needed.`;

  const response = await backbone.generateResponse({
    messages: [{ role: "user", content: prompt }],
    model: "claude-haiku-4-5",
    maxTokens: 512,
    systemPrompt: "You are an intent analysis module. Return valid JSON only, no markdown.",
  });

  try {
    const jsonMatch = response.content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found");
    const parsed = JSON.parse(jsonMatch[0]);

    return {
      intent: parsed.intent ?? "user query",
      complexity: parsed.complexity ?? "simple",
      requiresContext: parsed.requiresContext ?? false,
      requiresVerification: parsed.requiresVerification ?? false,
      keyEntities: Array.isArray(parsed.keyEntities) ? parsed.keyEntities : [],
      questionType: parsed.questionType ?? "conversational",
      canShortCircuit: parsed.canShortCircuit ?? false,
      directAnswer: parsed.directAnswer ?? undefined,
    };
  } catch {
    // Fallback parsing
    return {
      intent: payload.originalMessage.slice(0, 100),
      complexity: "simple",
      requiresContext: false,
      requiresVerification: false,
      keyEntities: [],
      questionType: "conversational",
      canShortCircuit: false,
    };
  }
}

async function stepGather(
  payload: ChainPayload,
  memory?: MemoryProvider,
  rag?: RAGProvider,
  search?: SearchProvider
): Promise<GatherResult> {
  const startMs = Date.now();
  const query = payload.originalMessage;
  const entities = payload.understand?.keyEntities ?? [];
  const enrichedQuery = entities.length > 0 ? `${query} (entities: ${entities.join(", ")})` : query;

  // Run all context gathering in parallel
  const [memoryItems, ragChunksRaw, searchResultsRaw] = await Promise.allSettled([
    memory?.recall(enrichedQuery, 5) ?? Promise.resolve([]),
    rag?.retrieve(enrichedQuery, 5) ?? Promise.resolve([]),
    payload.routingResult?.optimizations.useWebSearch
      ? search?.search(query, 5) ?? Promise.resolve([])
      : Promise.resolve([]),
  ]);

  const memoryContext = memoryItems.status === "fulfilled" ? memoryItems.value : [];
  const ragChunksData = ragChunksRaw.status === "fulfilled" ? ragChunksRaw.value : [];
  const searchData = searchResultsRaw.status === "fulfilled" ? searchResultsRaw.value : [];

  const ragChunks = ragChunksData.map((c) => c.content);
  const ragSources = ragChunksData.map((c) => c.source);

  const searchResults = searchData.map(
    (r) => `[${r.title}] ${r.snippet}`
  );
  const searchSources = searchData.map((r) => r.url);

  // Build combined context string
  const contextParts: string[] = [];
  if (memoryContext.length > 0) {
    contextParts.push(`Memory context:\n${memoryContext.join("\n")}`);
  }
  if (ragChunks.length > 0) {
    contextParts.push(`Retrieved knowledge:\n${ragChunks.join("\n---\n")}`);
  }
  if (searchResults.length > 0) {
    contextParts.push(`Search results:\n${searchResults.join("\n")}`);
  }

  return {
    memoryContext,
    searchResults,
    ragChunks,
    combinedContext: contextParts.join("\n\n"),
    sourcesUsed: [...ragSources, ...searchSources].filter(Boolean),
    gatherTimeMs: Date.now() - startMs,
  };
}

async function stepGenerate(
  payload: ChainPayload,
  backbone: ReturnType<typeof getClaudeAgentBackbone>,
  options: ChainOptions
): Promise<GenerateResult> {
  const startMs = Date.now();
  const optimizations = payload.routingResult?.optimizations;
  const understand = payload.understand;
  const gather = payload.gather;

  const model = options.systemPromptOverride
    ? (optimizations?.model ?? "claude-sonnet-4-6")
    : (optimizations?.model ?? "claude-sonnet-4-6");

  const maxTokens = Math.min(
    optimizations?.maxTokens ?? 4096,
    payload.tokenBudget.remaining
  );

  // Build system prompt
  const systemParts: string[] = [];
  if (optimizations?.systemPromptPrefix) {
    systemParts.push(optimizations.systemPromptPrefix);
  }
  if (options.systemPromptOverride) {
    systemParts.push(options.systemPromptOverride);
  }
  if (gather?.combinedContext) {
    systemParts.push(`\nAvailable context:\n${gather.combinedContext}`);
  }
  const systemPrompt = systemParts.join("\n").trim() || undefined;

  // Build message with full conversation history
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [
    ...payload.conversationHistory,
    { role: "user", content: payload.originalMessage },
  ];

  const response = await backbone.generateResponse({
    messages,
    model,
    maxTokens,
    systemPrompt,
    temperature: optimizations?.temperature ?? 0.7,
  });

  return {
    rawResponse: response.content,
    confidence: 0.8, // Base confidence, adjusted by verify step
    tokensUsed: response.usage?.outputTokens ?? 0,
    model,
    generationTimeMs: Date.now() - startMs,
  };
}

async function stepVerify(
  payload: ChainPayload,
  backbone: ReturnType<typeof getClaudeAgentBackbone>,
  mode: "none" | "light" | "strict"
): Promise<VerifyResult> {
  const startMs = Date.now();

  // Skip conditions
  if (mode === "none") {
    return { isFactuallyConsistent: true, issues: [], confidenceAdjustment: 0, verificationTimeMs: 0, skipped: true, skipReason: "verification disabled" };
  }

  const understand = payload.understand;
  if (!understand?.requiresVerification || understand.questionType === "creative" || understand.questionType === "conversational") {
    return { isFactuallyConsistent: true, issues: [], confidenceAdjustment: 0, verificationTimeMs: 0, skipped: true, skipReason: "not required for this query type" };
  }

  if (understand.complexity === "trivial" || understand.complexity === "simple") {
    return { isFactuallyConsistent: true, issues: [], confidenceAdjustment: 0, verificationTimeMs: 0, skipped: true, skipReason: "complexity too low to warrant verification" };
  }

  const rawResponse = payload.generate?.rawResponse ?? "";
  const context = payload.gather?.combinedContext ?? "";

  const verifyPrompt = mode === "strict"
    ? `Thoroughly fact-check this AI response for accuracy and internal consistency.

Response to verify:
${rawResponse.slice(0, 2000)}

${context ? `Available context:\n${context.slice(0, 1000)}` : ""}

Return JSON: { "isFactuallyConsistent": bool, "issues": ["issue1"], "correctedResponse": "corrected text or null", "confidenceAdjustment": -0.2 to 0.1 }`
    : `Quick spot-check this response for obvious errors or contradictions.

Response: ${rawResponse.slice(0, 1000)}

Return JSON: { "isFactuallyConsistent": bool, "issues": ["issue1"], "correctedResponse": null, "confidenceAdjustment": -0.1 to 0.05 }`;

  try {
    const response = await backbone.generateResponse({
      messages: [{ role: "user", content: verifyPrompt }],
      model: "claude-haiku-4-5",
      maxTokens: mode === "strict" ? 1024 : 256,
      systemPrompt: "You are a fact-checking module. Return valid JSON only.",
    });

    const jsonMatch = response.content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON in verify response");
    const parsed = JSON.parse(jsonMatch[0]);

    return {
      isFactuallyConsistent: parsed.isFactuallyConsistent ?? true,
      issues: Array.isArray(parsed.issues) ? parsed.issues : [],
      correctedResponse: parsed.correctedResponse ?? undefined,
      confidenceAdjustment: parsed.confidenceAdjustment ?? 0,
      verificationTimeMs: Date.now() - startMs,
      skipped: false,
    };
  } catch {
    return {
      isFactuallyConsistent: true,
      issues: [],
      confidenceAdjustment: 0,
      verificationTimeMs: Date.now() - startMs,
      skipped: true,
      skipReason: "verification parse error",
    };
  }
}

async function stepFormat(
  payload: ChainPayload,
  backbone: ReturnType<typeof getClaudeAgentBackbone>,
  forceFormat?: string
): Promise<FormatResult> {
  const content = payload.verify?.correctedResponse ?? payload.generate?.rawResponse ?? "";
  const questionType = payload.understand?.questionType ?? "conversational";
  const routeId = payload.routingResult?.primaryRoute;

  // Determine best format
  let format: FormatResult["format"] = "markdown";
  if (forceFormat) {
    format = forceFormat as FormatResult["format"];
  } else if (questionType === "conversational") {
    format = "plain";
  } else if (routeId === "code_help") {
    format = "markdown"; // Keeps code blocks
  } else if (routeId === "system_control") {
    // Try to detect if response is already JSON
    try {
      JSON.parse(content.trim());
      format = "json";
    } catch {
      format = "plain";
    }
  }

  // Apply formatting transforms
  let formattedResponse = content;

  if (format === "plain") {
    // Strip markdown markers but preserve code blocks
    formattedResponse = content
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/\*\*(.*?)\*\*/g, "$1")
      .replace(/\*(.*?)\*/g, "$1")
      .replace(/^[-*+]\s+/gm, "• ")
      .trim();
  } else if (format === "markdown") {
    // Ensure proper markdown — add newlines around code blocks if missing
    formattedResponse = content.replace(/```(\w+)?\n/g, "\n```$1\n").trim();
  }

  const wordCount = formattedResponse.split(/\s+/).filter(Boolean).length;
  const estimatedReadTimeSeconds = Math.ceil(wordCount / 4); // ~240 wpm / 60 = 4 words/sec

  return {
    formattedResponse,
    format,
    wordCount,
    estimatedReadTimeSeconds,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ResponseChaining Main Class
// ─────────────────────────────────────────────────────────────────────────────

export class ResponseChaining extends EventEmitter {
  private backbone: ReturnType<typeof getClaudeAgentBackbone>;
  private router = getSemanticRouter();
  private memoryProvider?: MemoryProvider;
  private ragProvider?: RAGProvider;
  private searchProvider?: SearchProvider;
  private activeChains = new Map<string, ChainPayload>();
  private chainHistory: ChainResponse[] = [];
  private maxHistorySize = 100;

  constructor() {
    super();
    this.backbone = getClaudeAgentBackbone();
  }

  // ─── Provider Registration ─────────────────────────────────────────────────

  setMemoryProvider(provider: MemoryProvider): void {
    this.memoryProvider = provider;
  }

  setRAGProvider(provider: RAGProvider): void {
    this.ragProvider = provider;
  }

  setSearchProvider(provider: SearchProvider): void {
    this.searchProvider = provider;
  }

  // ─── Main Chain Execution ──────────────────────────────────────────────────

  async chain(
    message: string,
    conversationHistory: Array<{ role: "user" | "assistant"; content: string }> = [],
    options: ChainOptions = {}
  ): Promise<ChainResponse> {
    const chainId = randomUUID();
    const {
      totalTokenBudget = 8192,
      skipSteps = [],
      useRouting = true,
      forceFormat,
      verificationMode = "light",
      onStepComplete,
    } = options;

    const payload: ChainPayload = {
      chainId,
      originalMessage: message,
      conversationHistory,
      tokenBudget: { total: totalTokenBudget, used: 0, remaining: totalTokenBudget },
      completedSteps: [],
      stepTimings: {},
      startedAt: new Date(),
      totalTokensUsed: 0,
    };

    this.activeChains.set(chainId, payload);
    this.emit("chain:started", { chainId, message });

    try {
      // ── Routing ────────────────────────────────────────────────────────────
      if (useRouting) {
        const contextMessages = conversationHistory.slice(-4).map((m) => m.content);
        payload.routingResult = await this.router.route(message, contextMessages);
        logger.debug({ chainId, route: payload.routingResult.primaryRoute }, "Route resolved");
      }

      // ── Step: understand ──────────────────────────────────────────────────
      let wasShortCircuited = false;
      let shortCircuitReason: string | undefined;

      if (!skipSteps.includes("understand")) {
        const stepStart = Date.now();
        payload.understand = await stepUnderstand(payload, this.backbone);
        payload.stepTimings.understand = Date.now() - stepStart;
        payload.completedSteps.push("understand");
        this.trackTokens(payload, 300); // Approximate understand step cost
        onStepComplete?.("understand", payload);
        this.emit("chain:step", { chainId, step: "understand", payload });

        // Short-circuit for trivial/conversational messages
        if (payload.understand.canShortCircuit && payload.understand.directAnswer) {
          wasShortCircuited = true;
          shortCircuitReason = "direct answer available (trivial query)";
          const response = this.buildShortCircuitResponse(payload, chainId, shortCircuitReason);
          this.finalize(payload, response);
          return response;
        }
      }

      // ── Step: gather ──────────────────────────────────────────────────────
      if (!skipSteps.includes("gather") && (payload.understand?.requiresContext ?? false)) {
        const stepStart = Date.now();

        // Check if any providers are available
        if (this.memoryProvider || this.ragProvider || this.searchProvider) {
          payload.gather = await stepGather(
            payload,
            this.memoryProvider,
            this.ragProvider,
            this.searchProvider
          );
          payload.stepTimings.gather = Date.now() - stepStart;
          payload.completedSteps.push("gather");
          this.trackTokens(payload, 200);
          onStepComplete?.("gather", payload);
          this.emit("chain:step", { chainId, step: "gather", payload });
        }
      }

      // ── Step: generate ────────────────────────────────────────────────────
      if (!skipSteps.includes("generate")) {
        if (payload.tokenBudget.remaining < 256) {
          wasShortCircuited = true;
          shortCircuitReason = "token budget exhausted before generate step";
          const response = this.buildShortCircuitResponse(payload, chainId, shortCircuitReason);
          this.finalize(payload, response);
          return response;
        }

        const stepStart = Date.now();
        payload.generate = await stepGenerate(payload, this.backbone, options);
        payload.stepTimings.generate = Date.now() - stepStart;
        payload.completedSteps.push("generate");
        this.trackTokens(payload, payload.generate.tokensUsed);
        onStepComplete?.("generate", payload);
        this.emit("chain:step", { chainId, step: "generate", payload });
      }

      // ── Step: verify ──────────────────────────────────────────────────────
      if (!skipSteps.includes("verify")) {
        const mode = verificationMode;
        const stepStart = Date.now();
        payload.verify = await stepVerify(payload, this.backbone, mode);
        payload.stepTimings.verify = Date.now() - stepStart;
        payload.completedSteps.push("verify");
        if (!payload.verify.skipped) this.trackTokens(payload, 400);
        onStepComplete?.("verify", payload);
        this.emit("chain:step", { chainId, step: "verify", payload });
      }

      // ── Step: format ──────────────────────────────────────────────────────
      if (!skipSteps.includes("format")) {
        const stepStart = Date.now();
        payload.format = await stepFormat(payload, this.backbone, forceFormat);
        payload.stepTimings.format = Date.now() - stepStart;
        payload.completedSteps.push("format");
        onStepComplete?.("format", payload);
        this.emit("chain:step", { chainId, step: "format", payload });
      }

      // ── Build Final Response ───────────────────────────────────────────────
      const finalContent = payload.format?.formattedResponse
        ?? payload.verify?.correctedResponse
        ?? payload.generate?.rawResponse
        ?? "I was unable to generate a response.";

      const confidence = Math.max(
        0,
        (payload.generate?.confidence ?? 0.7) + (payload.verify?.confidenceAdjustment ?? 0)
      );

      const response: ChainResponse = {
        response: finalContent,
        chainId,
        stepsExecuted: payload.completedSteps,
        wasShortCircuited,
        shortCircuitReason,
        totalTokensUsed: payload.totalTokensUsed,
        totalTimeMs: Date.now() - payload.startedAt.getTime(),
        routingResult: payload.routingResult,
        metadata: {
          complexity: payload.understand?.complexity ?? "unknown",
          questionType: payload.understand?.questionType ?? "unknown",
          contextsGathered:
            (payload.gather?.ragChunks.length ?? 0) +
            (payload.gather?.memoryContext.length ?? 0) +
            (payload.gather?.searchResults.length ?? 0),
          verificationApplied: !payload.verify?.skipped,
          format: payload.format?.format ?? "plain",
          confidence,
        },
      };

      this.finalize(payload, response);
      return response;
    } catch (err) {
      this.activeChains.delete(chainId);
      logger.error({ err, chainId }, "Chain execution failed");
      this.emit("chain:error", { chainId, err });
      throw err;
    }
  }

  // ─── Streaming Variant ─────────────────────────────────────────────────────

  /**
   * Executes understand+gather steps synchronously, then streams the generate step.
   * Skips verify and format for lower latency.
   */
  async *chainStream(
    message: string,
    conversationHistory: Array<{ role: "user" | "assistant"; content: string }> = [],
    options: Omit<ChainOptions, "onStepComplete"> = {}
  ): AsyncGenerator<{ type: "step" | "token" | "done"; step?: ChainStep; token?: string; finalResponse?: ChainResponse }> {
    const chainId = randomUUID();
    const { totalTokenBudget = 8192, useRouting = true } = options;

    const payload: ChainPayload = {
      chainId,
      originalMessage: message,
      conversationHistory,
      tokenBudget: { total: totalTokenBudget, used: 0, remaining: totalTokenBudget },
      completedSteps: [],
      stepTimings: {},
      startedAt: new Date(),
      totalTokensUsed: 0,
    };

    // Routing
    if (useRouting) {
      payload.routingResult = await this.router.route(message);
    }
    yield { type: "step", step: "understand" };

    // Understand
    payload.understand = await stepUnderstand(payload, this.backbone);
    payload.completedSteps.push("understand");
    this.trackTokens(payload, 300);

    // Short-circuit
    if (payload.understand.canShortCircuit && payload.understand.directAnswer) {
      yield { type: "token", token: payload.understand.directAnswer };
      yield {
        type: "done",
        finalResponse: this.buildShortCircuitResponse(payload, chainId, "direct answer"),
      };
      return;
    }

    // Gather if needed
    if (payload.understand.requiresContext && (this.memoryProvider || this.ragProvider)) {
      yield { type: "step", step: "gather" };
      payload.gather = await stepGather(payload, this.memoryProvider, this.ragProvider, this.searchProvider);
      payload.completedSteps.push("gather");
    }

    // Stream generate
    yield { type: "step", step: "generate" };

    const optimizations = payload.routingResult?.optimizations;
    const contextParts: string[] = [];
    if (optimizations?.systemPromptPrefix) contextParts.push(optimizations.systemPromptPrefix);
    if (payload.gather?.combinedContext) contextParts.push(`\nContext:\n${payload.gather.combinedContext}`);

    let fullResponse = "";
    if (this.backbone.streamResponse) {
      for await (const chunk of this.backbone.streamResponse({
        messages: [
          ...conversationHistory,
          { role: "user", content: message },
        ],
        model: optimizations?.model ?? "claude-sonnet-4-6",
        maxTokens: Math.min(optimizations?.maxTokens ?? 4096, payload.tokenBudget.remaining),
        systemPrompt: contextParts.join("\n").trim() || undefined,
        temperature: optimizations?.temperature ?? 0.7,
      })) {
        fullResponse += chunk;
        yield { type: "token", token: chunk };
      }
    } else {
      // Fallback if streaming not supported
      const result = await stepGenerate(payload, this.backbone, options);
      fullResponse = result.rawResponse;
      yield { type: "token", token: fullResponse };
    }

    payload.generate = {
      rawResponse: fullResponse,
      confidence: 0.8,
      tokensUsed: fullResponse.split(" ").length,
      model: optimizations?.model ?? "claude-sonnet-4-6",
      generationTimeMs: 0,
    };
    payload.completedSteps.push("generate");

    const finalResponse: ChainResponse = {
      response: fullResponse,
      chainId,
      stepsExecuted: payload.completedSteps,
      wasShortCircuited: false,
      totalTokensUsed: payload.totalTokensUsed,
      totalTimeMs: Date.now() - payload.startedAt.getTime(),
      routingResult: payload.routingResult,
      metadata: {
        complexity: payload.understand.complexity,
        questionType: payload.understand.questionType,
        contextsGathered:
          (payload.gather?.ragChunks.length ?? 0) +
          (payload.gather?.memoryContext.length ?? 0),
        verificationApplied: false,
        format: "markdown",
        confidence: 0.8,
      },
    };

    yield { type: "done", finalResponse };
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private trackTokens(payload: ChainPayload, tokensUsed: number): void {
    payload.tokenBudget.used += tokensUsed;
    payload.tokenBudget.remaining = Math.max(0, payload.tokenBudget.total - payload.tokenBudget.used);
    payload.totalTokensUsed += tokensUsed;
  }

  private buildShortCircuitResponse(
    payload: ChainPayload,
    chainId: string,
    reason: string
  ): ChainResponse {
    return {
      response: payload.understand?.directAnswer ?? "I understand your request.",
      chainId,
      stepsExecuted: payload.completedSteps,
      wasShortCircuited: true,
      shortCircuitReason: reason,
      totalTokensUsed: payload.totalTokensUsed,
      totalTimeMs: Date.now() - payload.startedAt.getTime(),
      routingResult: payload.routingResult,
      metadata: {
        complexity: payload.understand?.complexity ?? "trivial",
        questionType: payload.understand?.questionType ?? "conversational",
        contextsGathered: 0,
        verificationApplied: false,
        format: "plain",
        confidence: 0.95,
      },
    };
  }

  private finalize(payload: ChainPayload, response: ChainResponse): void {
    payload.completedAt = new Date();
    this.activeChains.delete(payload.chainId);
    this.chainHistory.unshift(response);
    if (this.chainHistory.length > this.maxHistorySize) {
      this.chainHistory.splice(this.maxHistorySize);
    }
    this.emit("chain:completed", response);
    logger.debug(
      {
        chainId: response.chainId,
        steps: response.stepsExecuted.length,
        tokens: response.totalTokensUsed,
        ms: response.totalTimeMs,
      },
      "Chain completed"
    );
  }

  // ─── Queries ───────────────────────────────────────────────────────────────

  getChainHistory(limit = 20): ChainResponse[] {
    return this.chainHistory.slice(0, limit);
  }

  getActiveChains(): ChainPayload[] {
    return [...this.activeChains.values()];
  }

  getChainStats(): {
    totalChains: number;
    avgSteps: number;
    avgTokens: number;
    avgTimeMs: number;
    shortCircuitRate: number;
    stepFrequency: Record<ChainStep, number>;
  } {
    const history = this.chainHistory;
    if (history.length === 0) {
      return {
        totalChains: 0,
        avgSteps: 0,
        avgTokens: 0,
        avgTimeMs: 0,
        shortCircuitRate: 0,
        stepFrequency: { understand: 0, gather: 0, generate: 0, verify: 0, format: 0 },
      };
    }

    const stepFreq: Record<ChainStep, number> = { understand: 0, gather: 0, generate: 0, verify: 0, format: 0 };
    let totalSteps = 0, totalTokens = 0, totalTime = 0, shortCircuits = 0;

    for (const c of history) {
      totalSteps += c.stepsExecuted.length;
      totalTokens += c.totalTokensUsed;
      totalTime += c.totalTimeMs;
      if (c.wasShortCircuited) shortCircuits++;
      for (const step of c.stepsExecuted) stepFreq[step]++;
    }

    return {
      totalChains: history.length,
      avgSteps: totalSteps / history.length,
      avgTokens: Math.round(totalTokens / history.length),
      avgTimeMs: Math.round(totalTime / history.length),
      shortCircuitRate: shortCircuits / history.length,
      stepFrequency: stepFreq,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton
// ─────────────────────────────────────────────────────────────────────────────

let _instance: ResponseChaining | null = null;

export function getResponseChaining(): ResponseChaining {
  if (!_instance) _instance = new ResponseChaining();
  return _instance;
}
