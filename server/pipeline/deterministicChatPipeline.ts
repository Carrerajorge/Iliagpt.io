import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import { z } from "zod";
import {
  DialogueManager,
  getDialogueManager,
  DialogueAction,
  ErrorCode,
  DialogueState
} from "./dialogueManager";
import {
  StageWatchdog,
  createWatchdog,
  StageTimeoutError,
  type PipelineLatency,
  type StageName
} from "./stageTimeouts";
import {
  ClarificationPolicy,
  clarificationPolicy,
  type ClarificationContext,
  type ClarificationResult
} from "./clarificationPolicy";
import {
  TextPreprocessor,
  textPreprocessor,
  type PreprocessResult
} from "./textPreprocessor";
import {
  ChatResponseBuilder,
  createErrorResponse,
  createTimeoutResponse,
  createClarificationResponse,
  type ChatRequest,
  type ChatResponse,
  type LatencyBreakdown,
  type Source,
  type Entity
} from "./apiContract";
import { llmGateway } from "../lib/llmGateway";
import { promptAnalyzer, type AnalysisResult } from "../agent/orchestration/promptAnalyzer";
import { intentRouter, type RouteDecision } from "../agent/orchestration/intentRouter";
import { conversationMemoryManager } from "../services/conversationMemory";

export interface PipelineConfig {
  aggressiveTimeouts: boolean;
  enableClarification: boolean;
  enableLlmFallback: boolean;
  maxClarificationAttempts: number;
  confidenceThresholdOk: number;
  confidenceThresholdClarify: number;
  defaultModel: string;
  fallbackModel: string;
}

const DEFAULT_CONFIG: PipelineConfig = {
  aggressiveTimeouts: false,
  enableClarification: true,
  enableLlmFallback: true,
  maxClarificationAttempts: 3,
  confidenceThresholdOk: 0.70,
  confidenceThresholdClarify: 0.40,
  defaultModel: "gemini-3.1-pro",
  fallbackModel: "gemini-2.5-flash"
};

export interface PipelineContext {
  requestId: string;
  sessionId: string;
  userId?: string;
  chatId?: string;
  gptId?: string;
  model?: string;
  temperature?: number;
  conversationHistory: Array<{ role: string; content: string }>;
  attachments?: Array<{ id: string; name: string; mimeType: string }>;
  systemPrompt?: string;
}

interface IntermediateState {
  preprocessResult?: PreprocessResult;
  analysisResult?: AnalysisResult;
  routeDecision?: RouteDecision;
  retrievedSources?: Source[];
  generatedContent?: string;
  extractedEntities?: Entity[];
}

interface StructuredLog {
  timestamp: string;
  level: "info" | "warn" | "error" | "debug";
  message: string;
  requestId?: string;
  sessionId?: string;
  stage?: string;
  durationMs?: number;
  [key: string]: any;
}

export class DeterministicChatPipeline extends EventEmitter {
  private config: PipelineConfig;
  private preprocessor: TextPreprocessor;
  private clarificationPolicy: ClarificationPolicy;

  constructor(config?: Partial<PipelineConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.preprocessor = textPreprocessor;
    this.clarificationPolicy = new ClarificationPolicy(this.config.enableLlmFallback);
    this.setMaxListeners(100);
  }

  private log(level: StructuredLog["level"], message: string, data: Record<string, any> = {}): void {
    const log: StructuredLog = {
      timestamp: new Date().toISOString(),
      level,
      message,
      component: "DeterministicPipeline",
      ...data
    };
    console.log(JSON.stringify(log));
    this.emit("log", log);
  }

  async process(message: string, context: PipelineContext): Promise<ChatResponse> {
    const { requestId, sessionId } = context;
    const dialogueManager = getDialogueManager(sessionId);
    const watchdog = createWatchdog(requestId, undefined, this.config.aggressiveTimeouts);
    const state: IntermediateState = {};

    dialogueManager.startNewTurn(requestId);
    watchdog.startRequest();

    this.log("info", "pipeline_started", {
      requestId,
      sessionId,
      userId: context.userId,
      messageLength: message.length
    });

    try {
      const preprocessResult = await this.executePreprocess(message, watchdog, requestId, sessionId);
      state.preprocessResult = preprocessResult;

      if (preprocessResult.qualityFlags.includes("garbage_input")) {
        const latency = watchdog.finishRequest();
        dialogueManager.handleError("GARBAGE_INPUT");
        return this.buildGarbageInputResponse(requestId, sessionId, latency);
      }

      dialogueManager.transition("analyzing", "preprocess_complete");
      const analysisResult = await this.executeNlu(message, context, watchdog);
      state.analysisResult = analysisResult;

      const clarificationCheck = this.evaluateClarification(analysisResult, context, dialogueManager);
      if (clarificationCheck.shouldClarify && this.config.enableClarification) {
        const action = dialogueManager.handleConfidence(
          analysisResult.intentConfidence,
          analysisResult.intent
        );

        this.log("info", "clarification_triggered", {
          requestId,
          sessionId,
          intent: analysisResult.intent,
          confidence: analysisResult.intentConfidence,
          action,
          attempt: dialogueManager.getContext().clarificationAttempts
        });

        const latency = watchdog.finishRequest();
        return createClarificationResponse(
          requestId,
          sessionId,
          clarificationCheck.clarification!.question,
          analysisResult.intentConfidence,
          dialogueManager.getContext().clarificationAttempts,
          latency.total
        );
      }

      dialogueManager.resetClarificationAttempts();

      if (this.needsRetrieval(analysisResult)) {
        dialogueManager.transition("retrieving", "needs_retrieval");
        const sources = await this.executeRetrieval(analysisResult, context, watchdog);
        state.retrievedSources = sources;
      }

      dialogueManager.transition("generating", "ready_for_generation");
      const generatedContent = await this.executeGeneration(
        message,
        state,
        context,
        watchdog
      );
      state.generatedContent = generatedContent;

      const latency = watchdog.finishRequest();
      dialogueManager.handleSuccess();

      this.log("info", "pipeline_completed", {
        requestId,
        sessionId,
        intent: analysisResult.intent,
        confidence: analysisResult.intentConfidence,
        latency,
        sourcesCount: state.retrievedSources?.length || 0,
        responseLength: state.generatedContent?.length || 0
      });

      return this.buildSuccessResponse(requestId, sessionId, state, analysisResult, latency, context);

    } catch (error) {
      const latency = watchdog.finishRequest();

      if (error instanceof StageTimeoutError) {
        this.log("warn", "stage_timeout", {
          requestId,
          sessionId,
          stage: error.stage,
          timeoutMs: error.timeoutMs,
          elapsedMs: error.elapsedMs,
          totalLatencyMs: latency.total
        });
        dialogueManager.handleTimeout(error.stage);
        this.emit("timeout", { requestId, stage: error.stage, elapsed: error.elapsedMs });
        return createTimeoutResponse(requestId, sessionId, error.stage, latency.total);
      }

      const errorCode = this.classifyError(error as Error);
      this.log("error", "pipeline_error", {
        requestId,
        sessionId,
        errorCode,
        errorMessage: (error as Error).message,
        totalLatencyMs: latency.total,
        state: dialogueManager.getState()
      });
      dialogueManager.handleError(errorCode, (error as Error).message);

      this.emit("error", { requestId, error, errorCode });
      return this.buildFallbackResponse(requestId, sessionId, errorCode, state, latency);
    }
  }

  private async executePreprocess(
    message: string,
    watchdog: StageWatchdog,
    requestId: string,
    sessionId: string
  ): Promise<PreprocessResult> {
    const result = await watchdog.executeWithTimeout(
      "preprocess",
      async () => this.preprocessor.process(message),
      () => ({
        normalizedText: message,
        originalText: message,
        language: "auto",
        languageConfidence: 0.5,
        qualityFlags: ["ok" as const],
        qualityScore: 0.8,
        wordCount: message.split(/\s+/).length,
        charCount: message.length,
        containsCode: false,
        containsUrl: false,
        preprocessingTimeMs: 0
      })
    );

    if (!result.success) {
      throw result.error;
    }

    this.log("debug", "stage_preprocess_complete", {
      requestId,
      sessionId,
      stage: "preprocess",
      durationMs: result.durationMs,
      timedOut: result.timedOut,
      language: result.data?.language,
      qualityScore: result.data?.qualityScore,
      qualityFlags: result.data?.qualityFlags
    });

    this.emit("stage_complete", { stage: "preprocess", duration: result.durationMs, data: result.data });
    return result.data!;
  }

  private async executeNlu(
    message: string,
    context: PipelineContext,
    watchdog: StageWatchdog
  ): Promise<AnalysisResult> {
    const result = await watchdog.executeWithTimeout(
      "nlu",
      async () => {
        const analysis = await promptAnalyzer.analyze(message, {
          messages: context.conversationHistory.map(m => ({
            role: m.role as "user" | "assistant" | "system",
            content: m.content
          })),
          attachments: context.attachments?.map(a => ({
            id: a.id,
            name: a.name,
            mimeType: a.mimeType
          })) || [],
          sessionId: context.sessionId,
          userId: context.userId,
          chatId: context.chatId,
          runId: context.requestId
        });
        return analysis;
      }
    );

    if (!result.success) {
      throw result.error;
    }

    this.emit("stage_complete", { stage: "nlu", duration: result.durationMs, data: result.data });
    return result.data!;
  }

  private evaluateClarification(
    analysis: AnalysisResult,
    context: PipelineContext,
    dialogueManager: DialogueManager
  ): ClarificationResult {
    if (!this.config.enableClarification) {
      return { shouldClarify: false, confidence: analysis.intentConfidence };
    }

    if (dialogueManager.getContext().clarificationAttempts >= this.config.maxClarificationAttempts) {
      return { shouldClarify: false, confidence: analysis.intentConfidence };
    }

    const clarificationContext: ClarificationContext = {
      originalMessage: analysis.rawMessage,
      detectedIntents: [{ intent: analysis.intent, confidence: analysis.intentConfidence }],
      extractedEntities: Object.entries(analysis.extractedEntities || {}).map(([type, value]) => ({
        type,
        value: String(value),
        confidence: 0.8
      })),
      missingSlots: [],
      ambiguousTerms: [],
      conversationHistory: context.conversationHistory
    };

    return this.clarificationPolicy.evaluate(clarificationContext);
  }

  private needsRetrieval(analysis: AnalysisResult): boolean {
    const retrievalIntents = ["research", "document_analysis", "data_analysis", "multi_step_task"];
    return retrievalIntents.includes(analysis.intent) ||
      analysis.complexity === "complex" ||
      analysis.complexity === "expert";
  }

  private async executeRetrieval(
    analysis: AnalysisResult,
    context: PipelineContext,
    watchdog: StageWatchdog
  ): Promise<Source[]> {
    const result = await watchdog.executeWithTimeout<Source[]>(
      "retrieval",
      async () => {
        return [];
      },
      () => []
    );

    if (!result.success) {
      console.warn("[Pipeline] Retrieval failed, continuing without sources:", result.error);
      return [];
    }

    this.emit("stage_complete", { stage: "retrieval", duration: result.durationMs, data: result.data });
    return result.data || [];
  }

  private async executeGeneration(
    message: string,
    state: IntermediateState,
    context: PipelineContext,
    watchdog: StageWatchdog
  ): Promise<string> {
    const result = await watchdog.executeWithTimeout(
      "generation",
      async () => {
        const messages: Array<{ role: "user" | "assistant" | "system"; content: string }> = [];

        if (context.systemPrompt) {
          messages.push({ role: "system", content: context.systemPrompt });
        }

        // CONTEXT FIX: Use memory manager instead of hardcoded slice(-10)
        const optimizedHistory = await conversationMemoryManager.augmentWithHistory(
          context.chatId,
          context.conversationHistory.map(m => ({
            role: m.role as "user" | "assistant" | "system",
            content: m.content
          })),
          6000 // Reserve tokens for system prompt + current message + response
        );

        for (const msg of optimizedHistory) {
          messages.push({
            role: msg.role as "user" | "assistant" | "system",
            content: msg.content
          });
        }

        messages.push({ role: "user", content: message });

        const response = await llmGateway.chat(messages, {
          model: context.model || this.config.defaultModel,
          temperature: context.temperature ?? 0.7,
          timeout: watchdog.getRemainingBudget(),
          enableFallback: true
        });

        return response.content;
      },
      () => "Lo siento, hubo un problema al generar la respuesta. Por favor, intenta de nuevo."
    );

    if (!result.success) {
      throw result.error;
    }

    this.emit("stage_complete", { stage: "generation", duration: result.durationMs });
    return result.data!;
  }

  private buildSuccessResponse(
    requestId: string,
    sessionId: string,
    state: IntermediateState,
    analysis: AnalysisResult,
    latency: PipelineLatency,
    context: PipelineContext
  ): ChatResponse {
    return new ChatResponseBuilder(requestId, sessionId)
      .setState("success")
      .setMessage(state.generatedContent || "")
      .setIntent(analysis.intent, analysis.intentConfidence)
      .setAction("ANSWER")
      .setSources(state.retrievedSources || [])
      .setLatency(latency)
      .setModel(context.model || this.config.defaultModel)
      .setError("NONE")
      .build();
  }

  private buildGarbageInputResponse(
    requestId: string,
    sessionId: string,
    latency: PipelineLatency
  ): ChatResponse {
    return createErrorResponse(
      requestId,
      sessionId,
      "GARBAGE_INPUT",
      "No pude entender tu mensaje. Por favor, intenta escribirlo de otra manera.",
      latency.total
    );
  }

  private buildFallbackResponse(
    requestId: string,
    sessionId: string,
    errorCode: ErrorCode,
    state: IntermediateState,
    latency: PipelineLatency
  ): ChatResponse {
    const fallbackMessages: Record<ErrorCode, string> = {
      NONE: "",
      TIMEOUT_PREPROCESS: "La solicitud tomó demasiado tiempo. Intenta con un mensaje más corto.",
      TIMEOUT_NLU: "Tuve problemas analizando tu mensaje. Por favor, reformúlalo.",
      TIMEOUT_RETRIEVAL: "No pude buscar la información a tiempo. Intenta de nuevo.",
      TIMEOUT_GENERATION: "La respuesta tardó demasiado en generarse. Intenta con una pregunta más simple.",
      UPSTREAM_429: "El servicio está ocupado. Por favor, espera unos segundos e intenta de nuevo.",
      UPSTREAM_5XX: "Hay un problema temporal con el servicio. Intenta de nuevo en unos minutos.",
      EMPTY_RETRIEVAL: "No encontré información relevante. ¿Puedes dar más contexto?",
      LOW_CONFIDENCE: "No estoy seguro de entender. ¿Puedes ser más específico?",
      GARBAGE_INPUT: "No pude entender tu mensaje. Intenta escribirlo de otra forma.",
      CIRCUIT_OPEN: "El servicio está temporalmente no disponible. Intenta más tarde.",
      RATE_LIMITED: "Has enviado muchas solicitudes. Espera un momento antes de continuar."
    };

    return createErrorResponse(
      requestId,
      sessionId,
      errorCode,
      fallbackMessages[errorCode] || "Ocurrió un error. Por favor, intenta de nuevo.",
      latency.total
    );
  }

  private classifyError(error: Error): ErrorCode {
    const message = error.message.toLowerCase();

    if (message.includes("timeout")) return "TIMEOUT_GENERATION";
    if (message.includes("429") || message.includes("rate limit")) return "UPSTREAM_429";
    if (message.includes("500") || message.includes("502") || message.includes("503")) return "UPSTREAM_5XX";
    if (message.includes("circuit") && message.includes("open")) return "CIRCUIT_OPEN";

    return "UPSTREAM_5XX";
  }

  async *processStream(
    message: string,
    context: PipelineContext
  ): AsyncGenerator<{ type: string; content?: string; done?: boolean; error?: string }> {
    const { requestId, sessionId } = context;
    const dialogueManager = getDialogueManager(sessionId);
    const watchdog = createWatchdog(requestId, undefined, this.config.aggressiveTimeouts);

    dialogueManager.startNewTurn(requestId);
    watchdog.startRequest();

    try {
      yield { type: "status", content: "preprocessing" };
      const preprocessResult = await this.executePreprocess(message, watchdog, requestId, sessionId);

      if (preprocessResult.qualityFlags.includes("garbage_input")) {
        yield { type: "error", content: "No pude entender tu mensaje.", done: true };
        return;
      }

      yield { type: "status", content: "analyzing" };
      dialogueManager.transition("analyzing", "preprocess_complete");
      const analysisResult = await this.executeNlu(message, context, watchdog);

      const clarificationCheck = this.evaluateClarification(analysisResult, context, dialogueManager);
      if (clarificationCheck.shouldClarify && this.config.enableClarification) {
        yield {
          type: "clarification",
          content: clarificationCheck.clarification!.question,
          done: true
        };
        return;
      }

      yield { type: "status", content: "generating" };
      dialogueManager.transition("generating", "ready_for_generation");

      const messages: Array<{ role: "user" | "assistant" | "system"; content: string }> = [];
      if (context.systemPrompt) {
        messages.push({ role: "system", content: context.systemPrompt });
      }
      // CONTEXT FIX: Use memory manager for streaming too
      const optimizedHistory = await conversationMemoryManager.augmentWithHistory(
        context.chatId,
        context.conversationHistory.map(m => ({
          role: m.role as "user" | "assistant" | "system",
          content: m.content
        })),
        6000
      );
      for (const msg of optimizedHistory) {
        messages.push({
          role: msg.role as "user" | "assistant" | "system",
          content: msg.content
        });
      }
      messages.push({ role: "user", content: message });

      watchdog.startStage("generation");

      for await (const chunk of llmGateway.streamChat(messages, {
        model: context.model || this.config.defaultModel,
        temperature: context.temperature ?? 0.7,
        timeout: watchdog.getRemainingBudget()
      })) {
        if (watchdog.isAborted()) {
          yield { type: "error", content: "La solicitud fue cancelada por timeout.", done: true };
          return;
        }

        if (chunk.done) {
          yield { type: "done", done: true };
        } else {
          yield { type: "content", content: chunk.content };
        }
      }

      watchdog.endStage("generation");
      watchdog.finishRequest();
      dialogueManager.handleSuccess();

    } catch (error) {
      watchdog.finishRequest();
      const errorMessage = error instanceof Error ? error.message : "Error desconocido";
      yield { type: "error", content: errorMessage, done: true };
    }
  }
}

export const deterministicChatPipeline = new DeterministicChatPipeline();
