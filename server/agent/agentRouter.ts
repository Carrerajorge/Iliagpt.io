import { analyzeIntent } from "./intentAnalysis";
import { createRequestSpec, type RequestSpec, type AttachmentSpec, type SessionState, type IntentType } from "./requestSpec";

// Map from the shared NLU intent values (e.g. "CHAT_GENERAL") to the agent intent
// values (e.g. "chat"). When the chatAiRouter already ran routeIntent() we can
// skip the second LLM analyzeIntent() call and reuse the pre-computed result.
const SHARED_TO_AGENT_INTENT: Record<string, IntentType> = {
    "CHAT_GENERAL":           "chat",
    "NEED_CLARIFICATION":     "chat",
    "SUMMARIZE":              "document_analysis",
    "TRANSLATE":              "chat",
    "ANALYZE_DOCUMENT":       "document_analysis",
    "ANALYZE_DATA":           "data_analysis",
    "SEARCH_WEB":             "research",
    "SECURITY_AUDIT":         "research",
    "CREATE_PRESENTATION":    "presentation_creation",
    "CREATE_DOCUMENT":        "document_generation",
    "CREATE_SPREADSHEET":     "spreadsheet_creation",
    "EXECUTE_CODE":           "code_generation",
    "MEDIA_GENERATE":         "image_generation",
    "RENDER_VISUAL":          "chat",
    "MANAGE_EMAIL":           "multi_step_task",
    "MANAGE_CALENDAR":        "multi_step_task",
    "MANAGE_TASKS":           "multi_step_task",
    "SEND_MESSAGE":           "multi_step_task",
    "MANAGE_DATABASE":        "multi_step_task",
    "AUTOMATE_WORKFLOW":      "multi_step_task",
    "MANAGE_INFRASTRUCTURE":  "multi_step_task",
    "INTEGRATION_ACTION":     "multi_step_task",
};

const INTENT_HINT_BYPASS_THRESHOLD = 0.75;

export interface RouteRequestParams {
    rawMessage: string;
    attachments?: AttachmentSpec[];
    sessionState?: SessionState;
    conversationHistory?: Array<{ role: string; content: string }>;
    userId: string;
    chatId: string;
    messageId?: string;
    /** Pre-computed intent from routeIntent() — skips the second LLM classification when confidence is high enough. */
    intentHint?: { intent: string; confidence: number };
}

/**
 * Agent Router (Orquestador).
 * Analyzes incoming prompts using a lightweight LLM (Flash/Haiku) via analyzeIntent
 * and decides the fundamental routing (which specialized agent should handle this).
 */
export async function routeAgentRequest(params: RouteRequestParams): Promise<RequestSpec> {
    const { rawMessage, attachments, sessionState, conversationHistory, userId, chatId, messageId, intentHint } = params;

    // ── Intent Analysis: LLM escalation for ambiguous cases ──
    // Fast path via Regex, escalated to Flash LLM if confidence is low.
    // If an intentHint is provided (pre-computed by chatAiRouter) with sufficient
    // confidence, we skip the LLM call entirely to avoid duplicate classification.
    let analysisResult;
    const mappedHintIntent = intentHint ? SHARED_TO_AGENT_INTENT[intentHint.intent] : undefined;
    if (mappedHintIntent && intentHint && intentHint.confidence >= INTENT_HINT_BYPASS_THRESHOLD) {
        analysisResult = {
            intent: mappedHintIntent,
            confidence: intentHint.confidence,
            source: "hint" as const,
            latencyMs: 0,
        };
        console.log(
            `[AgentRouter] Intent hint bypass: ${intentHint.intent} -> ${mappedHintIntent} (${intentHint.confidence.toFixed(2)}) — skipping LLM analyzeIntent`
        );
    } else {
        try {
            analysisResult = await analyzeIntent({
                rawMessage,
                attachments,
                sessionState,
                conversationHistory,
                userId,
                chatId,
                generateBrief: false,
            });
            console.log(
                `[AgentRouter] Escalonamiento Completado: ${analysisResult.source} -> ${analysisResult.intent} (${analysisResult.confidence.toFixed(2)}) [${analysisResult.latencyMs.toFixed(0)}ms]`
            );
        } catch (err) {
            console.error(`[AgentRouter] Falló el clasificador de intención LLM: ${(err as Error).message}`);
        }
    }

    const requestSpec = createRequestSpec({
        chatId,
        messageId,
        userId,
        rawMessage,
        attachments,
        sessionState,
        intentOverride: analysisResult?.intent,
        confidenceOverride: analysisResult?.confidence,
    });

    // ── Local filesystem/computer analysis override ─────────────────────
    // Ensure prompts like "analiza qué carpetas hay en mi Mac" enter agentic mode
    // and can execute local file-inspection tools instead of returning instructions.
    const isLocalFsInspection =
        /\b(?:carpetas?|caprteas?|careptas?|carpteas?|folders?|directorios?|directories?|archivos?|files?)\b.*\b(?:mac|computadora|pc|laptop|sistema|escritorio|desktop|descargas|downloads|documentos|documents|home|disco)\b/i.test(rawMessage) ||
        /\b(?:analiza|explora|listar|list|revisa|cuenta|count|cu[aá]ntas?)\b.*\b(?:mi\s+(?:mac|computadora|pc)|desktop|escritorio|home)\b/i.test(rawMessage) ||
        /\b(?:cu[aá]ntas?|how\s+many|cantidad(?:\s+de)?|n[uú]mero(?:\s+de)?)\s+(?:carpetas?|caprteas?|careptas?|carpteas?|folders?|directorios?|directories?|archivos?|files?)\b/i.test(rawMessage);
    if (isLocalFsInspection) {
        console.log(`[AgentRouter] Local filesystem request detected -> forzando ruta multi_step_task`);
        (requestSpec as any).intent = "multi_step_task" as IntentType;
        (requestSpec as any).intentConfidence = Math.max(Number((requestSpec as any).intentConfidence || 0), 0.88);
        (requestSpec as any).primaryAgent = "orchestrator";
        (requestSpec as any).targetAgents = ["orchestrator", "data", "content"];
    }

    // ── Reservation follow-up detection override ──────────────────────────
    // Sometimes web automation requires follow-ups (e.g. asking for the user's name or phone).
    if (requestSpec.intent !== "web_automation" && conversationHistory && conversationHistory.length > 0) {
        const lastAssistantMsg = [...conversationHistory].reverse().find(m => m.role === "assistant")?.content || "";

        const isReservationFollowUp =
            /para completar la reserva/i.test(lastAssistantMsg) ||
            /datos detectados.*restaurante/is.test(lastAssistantMsg) ||
            /necesito estos datos/i.test(lastAssistantMsg);

        if (isReservationFollowUp) {
            const hasContactInfo =
                /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/.test(rawMessage) ||
                /\b\d{6,15}\b/.test(rawMessage) ||
                /\b(nombre|name|llamo|soy)\b/i.test(rawMessage) ||
                /\b(tel[eé]fono|phone|cel|movil|móvil|whatsapp)\b/i.test(rawMessage);

            if (hasContactInfo) {
                console.log(`[AgentRouter] Booking data detected -> forzando ruta web_automation`);
                (requestSpec as any).intent = "web_automation" as IntentType;
                (requestSpec as any).intentConfidence = 0.9;
                (requestSpec as any).primaryAgent = "browser";
                (requestSpec as any).targetAgents = ["browser", "research"];
            }
        }
    }

    return requestSpec;
}
