/**
 * LangGraph Node Implementations for the Intent Analysis Pipeline
 *
 * Each node is a pure function: (state) => Partial<AnalysisState>
 * Following the pattern in server/agent/langgraph/nodes.ts
 */

import { detectIntent, type IntentType, type AttachmentSpec } from "../requestSpec";
import { RequestUnderstandingAgent } from "../requestUnderstanding/requestUnderstandingAgent";
import { llmGateway } from "../../lib/llmGateway";
import { LlmIntentClassificationSchema, type LlmIntentClassification } from "./schemas";
import type { AnalysisState } from "./analysisGraph";
import { Logger } from "../../lib/logger";
import { analysisMetrics } from "./analysisMetrics";

const logger = new Logger("AnalysisNodes");
const briefAgent = new RequestUnderstandingAgent();

const ESCALATION_THRESHOLD = 0.7;
const LLM_TIMEOUT_MS = 5000;
const REGEX_WEIGHT = 0.3;
const LLM_WEIGHT = 0.7;

// ─── Node: classify_regex ────────────────────────────────────────────

export async function classifyRegex(state: AnalysisState): Promise<Partial<AnalysisState>> {
  const startTime = performance.now();
  const result = detectIntent(state.rawMessage, state.attachments);

  const durationMs = performance.now() - startTime;
  logger.debug("classifyRegex", { intent: result.intent, confidence: result.confidence });

  analysisMetrics.recordClassification("regex", result.intent);
  analysisMetrics.recordClassificationDuration("regex", durationMs);

  return {
    regexResult: result,
    mergedIntent: {
      intent: result.intent,
      confidence: result.confidence,
      source: "regex" as const,
    },
    currentPhase: "classified",
    metrics: {
      ...state.metrics,
      regexLatencyMs: durationMs,
    },
  };
}

// ─── Node: classify_llm ─────────────────────────────────────────────

const INTENT_CLASSIFICATION_PROMPT = `Eres un clasificador de intenciones de usuario de alta precisión para un asistente de IA.

Analiza el mensaje del usuario y clasifica su intención principal en UNA de estas categorías:
- "chat": Conversación casual, saludos, preguntas simples
- "research": Investigación profunda, búsqueda de información detallada
- "document_analysis": Análisis de documentos adjuntos
- "document_generation": Crear documentos Word, informes, cartas
- "data_analysis": Análisis de datos, estadísticas
- "code_generation": Crear código, programas, scripts
- "web_automation": Navegar web, hacer reservas, compras online
- "image_generation": Crear imágenes, fotos, ilustraciones
- "presentation_creation": Crear presentaciones PowerPoint
- "spreadsheet_creation": Crear hojas Excel
- "multi_step_task": Tareas complejas combinando investigación + generación
- "unknown": No determinable

Responde SOLO con JSON válido:
{"intent":"<tipo>","confidence":<0-1>,"reasoning":"<breve>","deliverableType":"<tipo>","complexityLevel":"<simple|moderate|complex>","requiresWebSearch":<bool>,"requiresDocumentGeneration":<bool>,"requiresBrowserAutomation":<bool>,"ambiguities":[]}`;

export async function classifyLlm(state: AnalysisState): Promise<Partial<AnalysisState>> {
  const startTime = performance.now();

  let contextStr = "";
  if (state.conversationHistory.length > 1) {
    const recentTurns = state.conversationHistory.slice(-6);
    contextStr = recentTurns
      .map((m) => `${m.role === "user" ? "Usuario" : "Asistente"}: ${m.content.slice(0, 200)}`)
      .join("\n");
    contextStr = `\n\nCONTEXTO RECIENTE:\n${contextStr}`;
  }

  try {
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("LLM timeout")), LLM_TIMEOUT_MS),
    );

    const llmPromise = llmGateway.chat(
      [
        { role: "system", content: INTENT_CLASSIFICATION_PROMPT },
        { role: "user", content: `MENSAJE: ${state.rawMessage}${contextStr}` },
      ],
      {
        requestId: `intent_${Date.now()}`,
        userId: state.userId,
        temperature: 0,
        maxTokens: 400,
        enableFallback: true,
      },
    );

    const response = await Promise.race([llmPromise, timeoutPromise]);
    let raw = (response.content || "").trim();
    raw = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");

    const llmResult = LlmIntentClassificationSchema.parse(JSON.parse(raw));

    // Merge with regex result
    const regexResult = state.regexResult!;
    let mergedIntent: IntentType;
    let mergedConfidence: number;

    if (regexResult.intent === llmResult.intent) {
      mergedIntent = llmResult.intent;
      mergedConfidence = Math.min(
        regexResult.confidence * REGEX_WEIGHT + llmResult.confidence * LLM_WEIGHT + 0.1,
        1.0,
      );
    } else {
      mergedIntent = llmResult.confidence > regexResult.confidence ? llmResult.intent : regexResult.intent;
      mergedConfidence = Math.max(regexResult.confidence, llmResult.confidence) * 0.9;
    }

    const durationMs = performance.now() - startTime;
    logger.info("classifyLlm merged", {
      regexIntent: regexResult.intent,
      llmIntent: llmResult.intent,
      mergedIntent,
      mergedConfidence: mergedConfidence.toFixed(2),
    });

    analysisMetrics.recordClassification("hybrid", mergedIntent);
    analysisMetrics.recordClassificationDuration("llm", durationMs);
    analysisMetrics.recordEscalation(`regex_confidence_${regexResult.confidence.toFixed(1)}`);

    return {
      llmResult,
      mergedIntent: {
        intent: mergedIntent,
        confidence: mergedConfidence,
        source: "hybrid" as const,
      },
      currentPhase: "classified",
      metrics: {
        ...state.metrics,
        llmLatencyMs: durationMs,
      },
    };
  } catch (err) {
    const durationMs = performance.now() - startTime;
    logger.warn("classifyLlm failed, keeping regex result", { error: (err as Error).message });
    analysisMetrics.recordClassificationDuration("llm", durationMs);
    analysisMetrics.recordEscalation("llm_failure");
    return {
      llmResult: null,
      error: (err as Error).message,
      currentPhase: "classified",
      metrics: {
        ...state.metrics,
        llmLatencyMs: durationMs,
      },
    };
  }
}

// ─── Node: generate_brief ────────────────────────────────────────────

export async function generateBrief(state: AnalysisState): Promise<Partial<AnalysisState>> {
  const startTime = performance.now();

  try {
    const brief = await briefAgent.buildBrief({
      text: state.rawMessage,
      attachments: state.attachments
        .filter((a) => a.extractedContent)
        .map((a) => ({
          type: a.mimeType.startsWith("image/") ? ("image" as const) : ("document" as const),
          name: a.name,
          extractedText: a.extractedContent || "",
        })),
      userId: state.userId,
      requestId: `brief_${Date.now()}`,
    });

    const durationMs = performance.now() - startTime;
    logger.info("generateBrief success", {
      subtasks: brief.subtasks.length,
      deliverableFormat: brief.deliverable.format,
      isBlocked: brief.blocker.is_blocked,
    });

    analysisMetrics.recordBriefGeneration("success");
    analysisMetrics.recordBriefDuration(durationMs);

    return {
      brief,
      currentPhase: "briefed",
      retryCount: state.retryCount, // preserve
      metrics: {
        ...state.metrics,
        briefLatencyMs: durationMs,
      },
    };
  } catch (err) {
    const durationMs = performance.now() - startTime;
    logger.warn("generateBrief failed", { error: (err as Error).message, retryCount: state.retryCount });
    analysisMetrics.recordBriefGeneration("failure");
    analysisMetrics.recordBriefDuration(durationMs);

    return {
      brief: null,
      error: (err as Error).message,
      currentPhase: "briefed",
      retryCount: state.retryCount + 1,
      metrics: {
        ...state.metrics,
        briefLatencyMs: durationMs,
      },
    };
  }
}

// ─── Node: validate_brief ────────────────────────────────────────────

export async function validateBrief(state: AnalysisState): Promise<Partial<AnalysisState>> {
  if (!state.brief) {
    return {
      validationResult: { isValid: false, issues: ["Brief is null"], score: 0 },
      currentPhase: "validated",
    };
  }

  const issues: string[] = [];
  let score = 1.0;

  // Check 1: Subtasks exist
  if (!state.brief.subtasks || state.brief.subtasks.length < 2) {
    issues.push("Less than 2 subtasks");
    score -= 0.3;
  }

  // Check 2: Deliverable has format
  if (!state.brief.deliverable?.format) {
    issues.push("Deliverable missing format");
    score -= 0.2;
  }

  // Check 3: Intent alignment
  if (state.mergedIntent && state.brief.intent) {
    const briefIntent = state.brief.intent.primary_intent?.toLowerCase();
    const classifiedIntent = state.mergedIntent.intent?.toLowerCase();
    if (briefIntent && classifiedIntent && !briefIntent.includes(classifiedIntent) && !classifiedIntent.includes(briefIntent)) {
      issues.push(`Intent mismatch: brief="${briefIntent}" vs classified="${classifiedIntent}"`);
      score -= 0.15;
    }
  }

  // Check 4: If blocked, must have a question
  if (state.brief.blocker?.is_blocked && !state.brief.blocker?.question) {
    issues.push("Blocked but no clarification question");
    score -= 0.2;
  }

  // Check 5: Success criteria for complex tasks
  if (state.mergedIntent?.confidence && state.mergedIntent.confidence < 0.6 && (!state.brief.success_criteria || state.brief.success_criteria.length === 0)) {
    issues.push("No success criteria for low-confidence task");
    score -= 0.1;
  }

  score = Math.max(score, 0);
  const isValid = score >= 0.6;

  logger.debug("validateBrief", { score: score.toFixed(2), isValid, issues });
  analysisMetrics.recordBriefValidation(isValid ? "passed" : "failed", score);

  return {
    validationResult: { isValid, issues, score },
    currentPhase: "validated",
  };
}
