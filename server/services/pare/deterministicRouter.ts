import { RobustIntent, IntentResult } from "./robustIntentClassifier";
import { ContextSignals } from "./contextDetector";
import { ToolSelection, AGENT_REQUIRED_TOOLS, toolsIntersectAgentRequired } from "./toolSelector";

export type RouteType = "chat" | "agent";

export interface RobustRouteDecision {
  route: RouteType;
  intent: RobustIntent;
  confidence: number;
  tools: string[];
  reason: string;
  ruleApplied: string;
  needsClarification: boolean;
  clarificationOptions: string[] | null;
  assumptions: string[];
}

const IMPLICIT_FILE_PATTERNS = [
  /este\s+pdf/i,
  /el\s+pdf/i,
  /el\s+archivo/i,
  /el\s+documento/i,
  /este\s+archivo/i,
  /este\s+documento/i,
  /el\s+adjunto/i,
  /este\s+adjunto/i,
  /this\s+file/i,
  /the\s+file/i,
  /this\s+document/i,
  /the\s+document/i,
  /the\s+attachment/i,
  /this\s+attachment/i,
  /attached\s+file/i,
  /attached\s+document/i,
];

function detectImplicitFileReference(text: string): boolean {
  for (const pattern of IMPLICIT_FILE_PATTERNS) {
    if (pattern.test(text)) {
      return true;
    }
  }
  return false;
}

function generateAssumptions(
  intentResult: IntentResult,
  context: ContextSignals
): string[] {
  const assumptions: string[] = [];

  if (context.hasAttachments && intentResult.intent === "analysis") {
    assumptions.push("Se procesará el archivo adjunto para análisis");
  }

  if (!context.hasAttachments && intentResult.intent === "artifact") {
    assumptions.push("Se creará un documento nuevo desde cero");
  }

  if (context.language === "mixed") {
    assumptions.push("La respuesta será en el idioma predominante del mensaje");
  }

  if (intentResult.confidence < 0.75 && intentResult.confidence >= 0.5) {
    assumptions.push(`Intención inferida: ${intentResult.intent} (confianza moderada)`);
  }

  if (intentResult.subIntent) {
    assumptions.push(`Sub-intención detectada: ${intentResult.subIntent}`);
  }

  return assumptions;
}

function shouldAskClarification(
  intentResult: IntentResult,
  context: ContextSignals
): { needsClarification: boolean; options: string[] | null } {
  if (intentResult.confidence >= 0.75) {
    return { needsClarification: false, options: null };
  }

  if (intentResult.confidence >= 0.5 && context.hasAttachments) {
    return { needsClarification: false, options: null };
  }

  if (intentResult.confidence < 0.4 && intentResult.intent === "chat" && context.wordCount > 20) {
    return {
      needsClarification: true,
      options: [
        "Analizar contenido",
        "Crear documento",
        "Solo conversar"
      ]
    };
  }

  return { needsClarification: false, options: null };
}

export function deterministicRoute(
  intentResult: IntentResult,
  context: ContextSignals,
  toolSelection: ToolSelection,
  originalMessage: string = ""
): RobustRouteDecision {
  const { intent, confidence } = intentResult;
  const { tools, requiresAgent } = toolSelection;
  
  const assumptions = generateAssumptions(intentResult, context);
  const clarification = shouldAskClarification(intentResult, context);

  const hasImplicitFile = detectImplicitFileReference(originalMessage);
  if (hasImplicitFile && !context.hasAttachments) {
    return {
      route: "agent",
      intent,
      confidence: 0.95,
      tools: [...tools, "file_read"],
      reason: "Usuario menciona archivo implícito; requiere procesamiento",
      ruleApplied: "RULE_0_IMPLICIT_FILE",
      needsClarification: false,
      clarificationOptions: null,
      assumptions: [...assumptions, "Se esperará archivo o se solicitará al usuario"]
    };
  }

  if (context.hasAttachments && (intent === "analysis" || intent === "artifact")) {
    return {
      route: "agent",
      intent,
      confidence: 1.0,
      tools,
      reason: "Archivo adjunto requiere procesamiento (lectura/análisis) por agente.",
      ruleApplied: "RULE_1_ATTACHMENT_ANALYSIS",
      needsClarification: false,
      clarificationOptions: null,
      assumptions
    };
  }

  if (intent === "analysis" && toolsIntersectAgentRequired(tools)) {
    return {
      route: "agent",
      intent,
      confidence: 0.9,
      tools,
      reason: "Intención de análisis activa herramientas de procesamiento; se enruta a agente.",
      ruleApplied: "RULE_2_ANALYSIS_TOOLS",
      needsClarification: false,
      clarificationOptions: null,
      assumptions
    };
  }

  if (intent === "artifact") {
    return {
      route: "agent",
      intent,
      confidence: 0.9,
      tools,
      reason: "Creación de artefactos (Word/Excel/PPT) requiere planificación y validación en agente.",
      ruleApplied: "RULE_3_ARTIFACT",
      needsClarification: false,
      clarificationOptions: null,
      assumptions
    };
  }

  if (intent === "nav" && context.hasUrls) {
    return {
      route: "agent",
      intent,
      confidence: 0.85,
      tools,
      reason: "Navegación con URLs detectadas requiere agente para browsing.",
      ruleApplied: "RULE_4_NAV_URLS",
      needsClarification: false,
      clarificationOptions: null,
      assumptions
    };
  }

  if (intent === "code") {
    return {
      route: "agent",
      intent,
      confidence: 0.85,
      tools,
      reason: "Solicitud de código requiere ejecución/análisis por agente.",
      ruleApplied: "RULE_5_CODE",
      needsClarification: false,
      clarificationOptions: null,
      assumptions
    };
  }

  if (intent === "automation") {
    return {
      route: "agent",
      intent,
      confidence: 0.85,
      tools,
      reason: "Automatización requiere planificación por agente.",
      ruleApplied: "RULE_6_AUTOMATION",
      needsClarification: false,
      clarificationOptions: null,
      assumptions
    };
  }

  if (confidence < 0.75) {
    return {
      route: "agent",
      intent,
      confidence: 0.7,
      tools,
      reason: "Baja confianza; enrutando a agente por seguridad",
      ruleApplied: "RULE_7_LOW_CONFIDENCE_FALLBACK",
      needsClarification: clarification.needsClarification,
      clarificationOptions: clarification.options,
      assumptions
    };
  }

  if (context.hasAttachments) {
    return {
      route: "agent",
      intent,
      confidence: 0.8,
      tools: [...tools, "file_read"],
      reason: "Adjuntos presentes requieren procesamiento por agente.",
      ruleApplied: "RULE_8_HAS_ATTACHMENTS",
      needsClarification: false,
      clarificationOptions: null,
      assumptions
    };
  }

  if (requiresAgent) {
    return {
      route: "agent",
      intent,
      confidence: 0.8,
      tools,
      reason: "Herramientas seleccionadas requieren agente.",
      ruleApplied: "RULE_9_REQUIRES_AGENT_TOOLS",
      needsClarification: false,
      clarificationOptions: null,
      assumptions
    };
  }

  return {
    route: "chat",
    intent,
    confidence: intent === "chat" ? 0.85 : 0.75,
    tools,
    reason: "Solicitud conversacional sin adjuntos ni procesamiento intensivo.",
    ruleApplied: "RULE_DEFAULT_CHAT",
    needsClarification: false,
    clarificationOptions: null,
    assumptions
  };
}

export class DeterministicRouter {
  route(
    intentResult: IntentResult,
    context: ContextSignals,
    toolSelection: ToolSelection,
    originalMessage: string = ""
  ): RobustRouteDecision {
    const startTime = Date.now();
    const decision = deterministicRoute(intentResult, context, toolSelection, originalMessage);
    const duration = Date.now() - startTime;

    console.log(
      `[DeterministicRouter] Routed in ${duration}ms: ` +
      `route=${decision.route}, ` +
      `intent=${decision.intent}, ` +
      `confidence=${decision.confidence.toFixed(2)}, ` +
      `rule=${decision.ruleApplied}, ` +
      `assumptions=${decision.assumptions.length}`
    );

    return decision;
  }
}
