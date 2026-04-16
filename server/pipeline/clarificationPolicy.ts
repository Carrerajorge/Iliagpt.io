import { z } from "zod";
import { llmGateway } from "../lib/llmGateway";

export const ClarificationTypeSchema = z.enum([
  "intent_ambiguous",
  "entity_missing",
  "entity_ambiguous",
  "context_unclear",
  "multiple_options",
  "confirmation_needed"
]);
export type ClarificationType = z.infer<typeof ClarificationTypeSchema>;

export const ClarificationRequestSchema = z.object({
  type: ClarificationTypeSchema,
  question: z.string(),
  options: z.array(z.string()).optional(),
  context: z.string().optional(),
  priority: z.enum(["low", "medium", "high"]).default("medium"),
  maxAttempts: z.number().default(3)
});
export type ClarificationRequest = z.infer<typeof ClarificationRequestSchema>;

export interface ClarificationContext {
  originalMessage: string;
  detectedIntents: Array<{ intent: string; confidence: number }>;
  extractedEntities: Array<{ type: string; value: string; confidence: number }>;
  missingSlots: string[];
  ambiguousTerms: string[];
  conversationHistory: Array<{ role: string; content: string }>;
}

export interface ClarificationResult {
  shouldClarify: boolean;
  clarification?: ClarificationRequest;
  fallbackMessage?: string;
  confidence: number;
}

const CLARIFICATION_TEMPLATES: Record<ClarificationType, string[]> = {
  intent_ambiguous: [
    "\u00bfQuieres que {option_a} o que {option_b}?",
    "\u00bfTe refieres a {option_a} o a {option_b}?",
    "No estoy seguro si quieres {option_a} o {option_b}. \u00bfCu\u00e1l prefieres?"
  ],
  entity_missing: [
    "\u00bfPuedes indicarme {entity_type}?",
    "Necesito saber {entity_type} para continuar.",
    "\u00bfCu\u00e1l es {entity_type}?"
  ],
  entity_ambiguous: [
    "\u00bfA cu\u00e1l {entity_type} te refieres: {options}?",
    "Encontr\u00e9 varios {entity_type}. \u00bfCu\u00e1l es el correcto: {options}?",
    "Hay m\u00faltiples {entity_type} posibles: {options}. \u00bfCu\u00e1l?",
  ],
  context_unclear: [
    "\u00bfPuedes dar m\u00e1s detalles sobre lo que necesitas?",
    "No tengo suficiente contexto. \u00bfPuedes explicarlo de otra manera?",
    "\u00bfPodr\u00edas ser m\u00e1s espec\u00edfico sobre lo que buscas?"
  ],
  multiple_options: [
    "Puedo ayudarte con varias cosas. \u00bfQu\u00e9 prefieres: {options}?",
    "Tengo varias opciones: {options}. \u00bfCu\u00e1l te interesa?",
    "Hay diferentes formas de ayudarte: {options}. \u00bfCu\u00e1l eliges?"
  ],
  confirmation_needed: [
    "\u00bfConfirmas que quieres {action}?",
    "Voy a {action}. \u00bfEs correcto?",
    "Antes de {action}, \u00bfpuedes confirmar?"
  ]
};

const CONFIDENCE_THRESHOLDS = {
  HIGH: 0.85,
  OK: 0.70,
  CLARIFY: 0.40,
  REJECT: 0.20
};

export class ClarificationPolicy {
  private llmFallbackEnabled: boolean;

  constructor(enableLlmFallback: boolean = true) {
    this.llmFallbackEnabled = enableLlmFallback;
  }

  evaluate(context: ClarificationContext): ClarificationResult {
    const { detectedIntents, extractedEntities, missingSlots, ambiguousTerms } = context;

    if (detectedIntents.length === 0) {
      return this.createContextUnclearClarification(context);
    }

    const topIntent = detectedIntents[0];

    if (topIntent.confidence >= CONFIDENCE_THRESHOLDS.HIGH) {
      return { shouldClarify: false, confidence: topIntent.confidence };
    }

    if (topIntent.confidence >= CONFIDENCE_THRESHOLDS.OK) {
      if (missingSlots.length > 0) {
        return this.createMissingEntityClarification(missingSlots[0], context);
      }
      return { shouldClarify: false, confidence: topIntent.confidence };
    }

    if (topIntent.confidence >= CONFIDENCE_THRESHOLDS.CLARIFY) {
      if (detectedIntents.length >= 2) {
        const secondIntent = detectedIntents[1];
        const scoreDiff = topIntent.confidence - secondIntent.confidence;
        if (scoreDiff < 0.15) {
          return this.createIntentAmbiguousClarification(
            topIntent.intent,
            secondIntent.intent,
            context
          );
        }
      }

      if (ambiguousTerms.length > 0) {
        return this.createAmbiguousEntityClarification(ambiguousTerms, context);
      }

      if (missingSlots.length > 0) {
        return this.createMissingEntityClarification(missingSlots[0], context);
      }

      return this.createContextUnclearClarification(context);
    }

    return {
      shouldClarify: true,
      clarification: {
        type: "context_unclear",
        question: "No entend\u00ed tu mensaje. \u00bfPuedes reformularlo de otra manera?",
        priority: "high"
      },
      fallbackMessage: "Lo siento, no pude entender tu solicitud. Por favor, intenta expresarla de forma diferente.",
      confidence: topIntent.confidence
    };
  }

  private createIntentAmbiguousClarification(
    intentA: string,
    intentB: string,
    context: ClarificationContext
  ): ClarificationResult {
    const templates = CLARIFICATION_TEMPLATES.intent_ambiguous;
    const template = templates[Math.floor(Math.random() * templates.length)];
    
    const optionA = this.intentToHumanReadable(intentA);
    const optionB = this.intentToHumanReadable(intentB);
    
    const question = template
      .replace("{option_a}", optionA)
      .replace("{option_b}", optionB);

    return {
      shouldClarify: true,
      clarification: {
        type: "intent_ambiguous",
        question,
        options: [optionA, optionB],
        priority: "medium"
      },
      confidence: context.detectedIntents[0]?.confidence || 0
    };
  }

  private createMissingEntityClarification(
    slot: string,
    context: ClarificationContext
  ): ClarificationResult {
    const templates = CLARIFICATION_TEMPLATES.entity_missing;
    const template = templates[Math.floor(Math.random() * templates.length)];
    
    const entityType = this.slotToHumanReadable(slot);
    const question = template.replace("{entity_type}", entityType);

    return {
      shouldClarify: true,
      clarification: {
        type: "entity_missing",
        question,
        context: `Necesito: ${entityType}`,
        priority: "medium"
      },
      confidence: context.detectedIntents[0]?.confidence || 0
    };
  }

  private createAmbiguousEntityClarification(
    ambiguousTerms: string[],
    context: ClarificationContext
  ): ClarificationResult {
    const templates = CLARIFICATION_TEMPLATES.entity_ambiguous;
    const template = templates[Math.floor(Math.random() * templates.length)];
    
    const options = ambiguousTerms.slice(0, 4).join(", ");
    const question = template
      .replace("{entity_type}", "opci\u00f3n")
      .replace("{options}", options);

    return {
      shouldClarify: true,
      clarification: {
        type: "entity_ambiguous",
        question,
        options: ambiguousTerms.slice(0, 4),
        priority: "medium"
      },
      confidence: context.detectedIntents[0]?.confidence || 0
    };
  }

  private createContextUnclearClarification(context: ClarificationContext): ClarificationResult {
    const templates = CLARIFICATION_TEMPLATES.context_unclear;
    const question = templates[Math.floor(Math.random() * templates.length)];

    return {
      shouldClarify: true,
      clarification: {
        type: "context_unclear",
        question,
        priority: "high"
      },
      fallbackMessage: "Podr\u00edas intentar ser m\u00e1s espec\u00edfico sobre lo que necesitas.",
      confidence: context.detectedIntents[0]?.confidence || 0
    };
  }

  private intentToHumanReadable(intent: string): string {
    const mapping: Record<string, string> = {
      chat: "conversar",
      research: "investigar informaci\u00f3n",
      document_analysis: "analizar un documento",
      document_generation: "crear un documento",
      data_analysis: "analizar datos",
      code_generation: "generar c\u00f3digo",
      web_automation: "automatizar navegaci\u00f3n web",
      image_generation: "generar una imagen",
      presentation_creation: "crear una presentaci\u00f3n",
      spreadsheet_creation: "crear una hoja de c\u00e1lculo",
      multi_step_task: "realizar una tarea compleja",
      unknown: "algo diferente"
    };
    return mapping[intent] || intent;
  }

  private slotToHumanReadable(slot: string): string {
    const mapping: Record<string, string> = {
      topic: "el tema",
      date: "la fecha",
      quantity: "la cantidad",
      format: "el formato",
      language: "el idioma",
      recipient: "el destinatario",
      filename: "el nombre del archivo",
      url: "la URL",
      search_query: "qu\u00e9 buscar",
      document_type: "el tipo de documento"
    };
    return mapping[slot] || slot;
  }

  async generateDynamicClarification(context: ClarificationContext): Promise<ClarificationResult> {
    if (!this.llmFallbackEnabled) {
      return this.evaluate(context);
    }

    try {
      const prompt = this.buildClarificationPrompt(context);
      const response = await llmGateway.chat([
        { role: "system", content: "Eres un asistente que genera preguntas de aclaraci\u00f3n concisas y \u00fatiles. Responde SOLO con la pregunta, sin explicaciones." },
        { role: "user", content: prompt }
      ], {
        temperature: 0.3,
        maxTokens: 100,
        timeout: 2000
      });

      const question = response.content.trim();
      if (question && question.length > 5 && question.length < 200) {
        return {
          shouldClarify: true,
          clarification: {
            type: "context_unclear",
            question,
            priority: "medium"
          },
          confidence: context.detectedIntents[0]?.confidence || 0
        };
      }
    } catch (error) {
      console.warn("[ClarificationPolicy] LLM fallback failed, using template:", error);
    }

    return this.evaluate(context);
  }

  private buildClarificationPrompt(context: ClarificationContext): string {
    const recentHistory = context.conversationHistory.slice(-3);
    const historyText = recentHistory
      .map(m => `${m.role}: ${m.content}`)
      .join("\n");

    return `Mensaje del usuario: "${context.originalMessage}"

Historial reciente:
${historyText || "(sin historial)"}

Intenciones detectadas: ${context.detectedIntents.map(i => `${i.intent}(${i.confidence.toFixed(2)})`).join(", ") || "ninguna"}
Entidades extra\u00eddas: ${context.extractedEntities.map(e => `${e.type}:${e.value}`).join(", ") || "ninguna"}
Informaci\u00f3n faltante: ${context.missingSlots.join(", ") || "ninguna"}

Genera UNA pregunta corta y clara para aclarar qu\u00e9 necesita el usuario:`;
  }
}

export const clarificationPolicy = new ClarificationPolicy(true);
