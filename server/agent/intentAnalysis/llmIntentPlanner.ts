/**
 * LLM-Augmented Intent Analysis
 *
 * When regex-based detectIntent() returns low confidence (<0.7),
 * this module escalates to an LLM planner for structured classification.
 * For agentic-mode requests, it also generates a RequestBrief.
 *
 * Fast path (regex confidence >= 0.7): ~0ms LLM overhead
 * LLM path (confidence < 0.7):        ~1-3s (Gemini Flash)
 */

import { detectIntent, type IntentType, type AttachmentSpec, type SessionState } from "../requestSpec";
import { RequestUnderstandingAgent } from "../requestUnderstanding/requestUnderstandingAgent";
import { llmGateway } from "../../lib/llmGateway";
import { LlmIntentClassificationSchema, type IntentAnalysisResult, type LlmIntentClassification } from "./schemas";
import { Logger } from "../../lib/logger";
import { getAnalysisGraph } from "./analysisGraph";
import { analysisMetrics } from "./analysisMetrics";
import { traceAnalysisPipeline } from "./analysisTracer";

const logger = new Logger("IntentAnalysis");

// ─── Constants ───────────────────────────────────────────────────────

const ESCALATION_THRESHOLD = 0.7;
const LLM_TIMEOUT_MS = 5000;
const REGEX_WEIGHT = 0.3;
const LLM_WEIGHT = 0.7;

// Intents that trigger agentic mode and should get a brief
const AGENTIC_INTENTS: Set<IntentType> = new Set([
  "research",
  "document_generation",
  "presentation_creation",
  "spreadsheet_creation",
  "data_analysis",
  "code_generation",
  "web_automation",
  "multi_step_task",
]);

// ─── LLM Planner System Prompt ──────────────────────────────────────

const INTENT_CLASSIFICATION_SYSTEM_PROMPT = `Eres un clasificador de intenciones de usuario de alta precisión para un asistente de IA.

Analiza el mensaje del usuario y clasifica su intención principal en UNA de las siguientes categorías:

INTENCIONES DISPONIBLES:
- "chat": Conversación casual, saludos, preguntas simples, opiniones
- "research": Investigación profunda, búsqueda de información detallada, artículos académicos
- "document_analysis": Análisis de documentos adjuntos (PDF, Word, Excel)
- "document_generation": Crear documentos Word, informes, cartas, ensayos
- "data_analysis": Análisis de datos, estadísticas, procesamiento numérico
- "code_generation": Crear código, programas, scripts, funciones
- "web_automation": Navegar web, hacer reservas, compras online, automatizar browser
- "image_generation": Crear imágenes, fotos, ilustraciones, arte
- "presentation_creation": Crear presentaciones PowerPoint, slides, diapositivas
- "spreadsheet_creation": Crear hojas Excel, tablas, bases de datos
- "multi_step_task": Tareas complejas que combinan investigación + generación
- "unknown": No se puede determinar la intención

Responde ÚNICAMENTE con un JSON válido siguiendo este esquema exacto:
{
  "intent": "<una de las intenciones listadas>",
  "confidence": <número entre 0.0 y 1.0>,
  "reasoning": "<explicación breve en español, max 200 chars>",
  "deliverableType": "<text_response|pptx|docx|xlsx|pdf|image|chart|code|app|research_report|data_export|multiple>",
  "complexityLevel": "<simple|moderate|complex>",
  "requiresWebSearch": <true|false>,
  "requiresDocumentGeneration": <true|false>,
  "requiresBrowserAutomation": <true|false>,
  "ambiguities": [<lista de ambigüedades detectadas, si las hay>],
  "riskLevel": "<low|medium|high|critical>",
  "extractedEntities": { "<clave>": "<valor>" }
}

REGLAS:
- Sé conservador con la confianza: solo usa >0.9 cuando la intención es inequívoca
- Si hay señales mixtas, elige la intención PRIMARIA más probable
- "web_automation" requiere interacción real con un navegador (reservas, compras, navegación)
- "research" es para búsqueda de información, NO para navegar sitios
- Las reservas de restaurantes/hoteles/vuelos son SIEMPRE "web_automation"
- Preguntas simples tipo "¿qué es X?" son "chat", no "research"
- "riskLevel": usa "low" por defecto. "medium" si implica datos externos públicos. "high" si implica compras, correos o datos privados. "critical" para transferencias, borrado o permisos.
- "extractedEntities": extrae nombres, fechas, emails, URLs, lugares, requerimientos técnicos, etc.`;

// ─── Core Analysis Function ─────────────────────────────────────────

export interface AnalyzeIntentParams {
  rawMessage: string;
  attachments?: AttachmentSpec[];
  sessionState?: SessionState;
  conversationHistory?: Array<{ role: string; content: string }>;
  userId: string;
  chatId: string;
  /**
   * When true, the pipeline will also generate a RequestBrief for agentic intents.
   * Default: false (classification only) to avoid duplicating the brief generation
   * already performed in the main agent executor.
   */
  generateBrief?: boolean;
}

export async function analyzeIntent(params: AnalyzeIntentParams): Promise<IntentAnalysisResult> {
  const pipelineStart = performance.now();
  const wantBrief = params.generateBrief === true;

  const result = await traceAnalysisPipeline("analyzeIntent", async () => {
    // Default: classification-only (no brief) to avoid double LLM calls.
    if (!wantBrief) {
      return analyzeIntentDirect(params, { generateBrief: false });
    }

    // Brief mode: try the LangGraph-based pipeline first; fall back to direct flow on error.
    try {
      return await analyzeIntentViaGraph(params);
    } catch (err) {
      logger.warn("Graph pipeline failed, falling back to direct flow", { error: (err as Error).message });
      return analyzeIntentDirect(params, { generateBrief: true });
    }
  });

  analysisMetrics.recordPipelineDuration(performance.now() - pipelineStart);
  return result;
}

/** Graph-based analysis: uses LangGraph state machine with conditional routing */
async function analyzeIntentViaGraph(params: AnalyzeIntentParams): Promise<IntentAnalysisResult> {
  const startTime = performance.now();
  const graph = getAnalysisGraph();

  const result = await graph.invoke({
    rawMessage: params.rawMessage,
    attachments: params.attachments || [],
    conversationHistory: params.conversationHistory || [],
    userId: params.userId,
    chatId: params.chatId,
  });

  const latencyMs = performance.now() - startTime;
  const merged = result.mergedIntent;

  return {
    intent: merged?.intent ?? "chat",
    confidence: merged?.confidence ?? 0.5,
    source: merged?.source ?? "regex",
    brief: result.brief ?? null,
    escalationReason: result.llmResult ? `LLM escalation(regex < 0.7)` : undefined,
    llmClassification: result.llmResult ?? null,
    latencyMs,
  };
}

/** Direct flow (fallback): sequential regex → LLM → brief without LangGraph */
async function analyzeIntentDirect(
  params: AnalyzeIntentParams,
  options: { generateBrief: boolean },
): Promise<IntentAnalysisResult> {
  const startTime = performance.now();
  const { rawMessage, attachments = [], conversationHistory, userId } = params;
  const wantBrief = options.generateBrief;

  // ── Step 1: Regex fast-path ─────────────────────────────────────
  const regexResult = detectIntent(rawMessage, attachments);

  logger.debug("Regex classification", {
    intent: regexResult.intent,
    confidence: regexResult.confidence,
    messageLength: rawMessage.length,
  });

  // Heuristic: avoid LLM escalation for trivial chat to reduce latency/cost.
  // (Regex < 0.7 is common for greetings/acknowledgements.)
  if (regexResult.intent === "chat" && regexResult.confidence < ESCALATION_THRESHOLD) {
    const normalized = rawMessage.trim().toLowerCase();
    const hasTaskSignals =
      rawMessage.length > 120 ||
      /[\n\r]/.test(rawMessage) ||
      // Task verbs / deliverable hints
      /\b(crea|create|genera|generate|escribe|write|redacta|draft|hazme|make me|prepara|prepare|analiza|analyze|investiga|research|busca|search|navega|navigate|abre|open|reserva|reservation|compra|buy)\b/i.test(rawMessage) ||
      /\b(documento|report|informe|excel|spreadsheet|ppt|powerpoint|presentación|presentation|imagen|image|código|code|cv|curr[ií]culum|curriculum|correo|email)\b/i.test(rawMessage) ||
      // URL/domain patterns
      /\b(?:www\.)?[a-z0-9-]+\.(?:com|org|net|io|pe)\b/i.test(rawMessage);

    const isTrivialChat =
      normalized.length <= 40 &&
      /^(hola|hey|ok|vale|listo|perfecto|gracias|muchas gracias|buenos dias|buenas tardes|buenas noches|como estas|¿?como estas\\??)$/.test(
        normalized.replace(/[!?.¿¡]+/g, "").replace(/\s+/g, " "),
      );

    if (!hasTaskSignals || isTrivialChat) {
      const latencyMs = performance.now() - startTime;
      return {
        intent: regexResult.intent,
        confidence: regexResult.confidence,
        source: "regex",
        brief: null,
        llmClassification: null,
        latencyMs,
      };
    }
  }

  // Fast path: high-confidence regex result — skip LLM entirely
  if (regexResult.confidence >= ESCALATION_THRESHOLD) {
    const latencyMs = performance.now() - startTime;

    // Even for high-confidence results, generate brief if agentic
    let brief = null;
    if (wantBrief && AGENTIC_INTENTS.has(regexResult.intent)) {
      brief = await generateBriefSafe(rawMessage, attachments, userId);
    }

    return {
      intent: regexResult.intent,
      confidence: regexResult.confidence,
      source: "regex",
      brief: wantBrief ? brief : null,
      llmClassification: null,
      latencyMs,
    };
  }

  // ── Step 2: LLM escalation ─────────────────────────────────────
  logger.info("Escalating to LLM planner", {
    reason: `regex confidence ${regexResult.confidence} <${ESCALATION_THRESHOLD}`,
    regexIntent: regexResult.intent,
  });

  let llmResult: LlmIntentClassification | null = null;
  let escalationReason = `regex confidence ${regexResult.confidence.toFixed(2)} <${ESCALATION_THRESHOLD}`;

  try {
    llmResult = await classifyWithLlm(rawMessage, conversationHistory, userId);
  } catch (err) {
    logger.warn("LLM planner failed, falling back to regex", { error: (err as Error).message });
    escalationReason += ` (LLM fallback: ${(err as Error).message})`;
  }

  // ── Step 3: Merge signals ──────────────────────────────────────
  let finalIntent: IntentType;
  let finalConfidence: number;
  let source: "regex" | "llm" | "hybrid";

  if (llmResult) {
    // Weighted merge
    if (regexResult.intent === llmResult.intent) {
      // Agreement: boost confidence
      finalIntent = llmResult.intent;
      finalConfidence = Math.min(
        regexResult.confidence * REGEX_WEIGHT + llmResult.confidence * LLM_WEIGHT + 0.1,
        1.0,
      );
      source = "hybrid";
    } else {
      // Disagreement: trust LLM (it has more context)
      finalIntent = llmResult.confidence > regexResult.confidence ? llmResult.intent : regexResult.intent;
      finalConfidence = Math.max(regexResult.confidence, llmResult.confidence) * 0.9; // Penalize disagreement
      source = "hybrid";
    }
  } else {
    // LLM failed — use regex as-is
    finalIntent = regexResult.intent;
    finalConfidence = regexResult.confidence;
    source = "regex";
  }

  logger.info("Intent analysis complete", {
    source,
    finalIntent,
    finalConfidence: finalConfidence.toFixed(2),
    regexIntent: regexResult.intent,
    llmIntent: llmResult?.intent ?? "N/A",
  });

  // ── Step 4: Generate brief if agentic ──────────────────────────
  let brief = null;
  if (wantBrief && AGENTIC_INTENTS.has(finalIntent)) {
    brief = await generateBriefSafe(rawMessage, attachments, userId);
  }

  const latencyMs = performance.now() - startTime;

  return {
    intent: finalIntent,
    confidence: finalConfidence,
    source,
    brief: wantBrief ? brief : null,
    escalationReason,
    llmClassification: llmResult,
    latencyMs,
  };
}

// ─── LLM Classification ─────────────────────────────────────────────

async function classifyWithLlm(
  rawMessage: string,
  conversationHistory?: Array<{ role: string; content: string }>,
  userId?: string,
): Promise<LlmIntentClassification> {
  // Build context from recent conversation history (last 3 turns)
  let contextStr = "";
  if (conversationHistory && conversationHistory.length > 1) {
    const recentTurns = conversationHistory.slice(-6); // last 3 exchanges
    contextStr = recentTurns
      .map((m) => `${m.role === "user" ? "Usuario" : "Asistente"}: ${m.content.slice(0, 200)} `)
      .join("\n");
    contextStr = `\n\nCONTEXTO RECIENTE DE LA CONVERSACIÓN: \n${contextStr} `;
  }

  const userPrompt = `MENSAJE DEL USUARIO: \n${rawMessage}${contextStr} `;

  const messages = [
    { role: "system" as const, content: INTENT_CLASSIFICATION_SYSTEM_PROMPT },
    { role: "user" as const, content: userPrompt },
  ];

  // Use a timeout race to prevent blocking the pipeline
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`LLM planner timeout(${LLM_TIMEOUT_MS}ms)`)), LLM_TIMEOUT_MS),
  );

  const llmPromise = llmGateway.chat(messages, {
    requestId: `intent_${Date.now()} `,
    userId,
    temperature: 0,
    maxTokens: 400,
    enableFallback: true,
  });

  const response = await Promise.race([llmPromise, timeoutPromise]);

  // Parse and validate the LLM response
  let raw = (response.content || "").trim();

  // Strip markdown code blocks if present
  raw = raw.replace(/^```(?: json) ?\s * /i, "").replace(/\s * ```$/i, "");

  const parsed = JSON.parse(raw);
  return LlmIntentClassificationSchema.parse(parsed);
}

// ─── Brief Generation (safe wrapper) ─────────────────────────────────

const briefAgent = new RequestUnderstandingAgent();

async function generateBriefSafe(
  rawMessage: string,
  attachments: AttachmentSpec[],
  userId: string,
): Promise<any | null> {
  try {
    const brief = await briefAgent.buildBrief({
      text: rawMessage,
      attachments: attachments
        .filter((a) => a.extractedContent)
        .map((a) => ({
          type: a.mimeType.startsWith("image/") ? ("image" as const) : ("document" as const),
          name: a.name,
          extractedText: a.extractedContent || "",
        })),
      userId,
      requestId: `brief_${Date.now()} `,
    });
    return brief;
  } catch (err) {
    logger.warn("Brief generation failed", { error: (err as Error).message });
    return null;
  }
}
