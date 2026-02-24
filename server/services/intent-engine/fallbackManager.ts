import { z } from "zod";
import CircuitBreaker from "opossum";
import { llmGateway } from "../../lib/llmGateway";
import {
  IntentTypeSchema,
  OutputFormatSchema,
  SlotsSchema,
  type IntentType,
  type OutputFormat,
  type Slots
} from "../../../shared/schemas/intent";

const LLMClassificationSchema = z.object({
  intent: IntentTypeSchema,
  output_format: OutputFormatSchema,
  slots: SlotsSchema,
  confidence: z.number().min(0).max(1),
  reasoning: z.string().optional()
});

type LLMClassification = z.infer<typeof LLMClassificationSchema>;

const LLM_CLASSIFIER_PROMPT = `You are a precise intent classifier for a multilingual chatbot. Analyze the user's message and return ONLY a valid JSON object with NO additional text, markdown, or explanation.

IMPORTANT: Your response must be ONLY the JSON object, nothing else.

Classify the intent into one of these categories:
- CREATE_PRESENTATION: User wants to create a PowerPoint/slides presentation
- CREATE_DOCUMENT: User wants to create a Word document, report, or essay
- CREATE_SPREADSHEET: User wants to create an Excel spreadsheet or table
- SUMMARIZE: User wants a summary of content
- TRANSLATE: User wants to translate text between languages
- SEARCH_WEB: User wants to search the internet for information
- ANALYZE_DOCUMENT: User wants analysis/review of a document
- CHAT_GENERAL: General conversation, greetings, or unclear intent
- NEED_CLARIFICATION: Ambiguous request that needs clarification

Determine the output format if applicable:
- pptx, docx, xlsx, pdf, txt, csv, html, or null

Extract these slots if mentioned:
- topic: Main subject/topic
- title: Specific title if given
- language: Language code (es, en, fr, de, pt, it, zh, ja)
- length: short, medium, or long
- audience: Target audience
- style: Writing/presentation style
- bullet_points: true if bulleted format requested
- include_images: true/false if images mentioned
- target_language: For translations, target language code
- num_slides: Number of slides if specified

Example output format:
{"intent":"CREATE_PRESENTATION","output_format":"pptx","slots":{"topic":"artificial intelligence","audience":"executives","include_images":true},"confidence":0.92,"reasoning":"User explicitly requested a PowerPoint presentation about AI for executives"}`;

interface FallbackResult {
  intent: IntentType;
  output_format: OutputFormat;
  slots: Slots;
  confidence: number;
  reasoning?: string;
  fallback_method: "llm" | "degraded_rule";
  error?: string;
  // AGENTIC IMPROVEMENT #6: Suggested actions when intent is unclear
  suggested_actions?: Array<{ label: string; action: string }>;
}

async function callLLMClassifier(
  normalizedText: string,
  originalText: string,
  timeout: number = 10000
): Promise<LLMClassification> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await llmGateway.chat({
      messages: [
        { role: "system", content: LLM_CLASSIFIER_PROMPT },
        { role: "user", content: `Classify this message:\n\n"${originalText}"` }
      ],
      temperature: 0.1,
      max_tokens: 500
    });

    clearTimeout(timeoutId);

    const content = response.choices[0]?.message?.content || "";

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("No JSON found in LLM response");
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const validated = LLMClassificationSchema.parse(parsed);

    return validated;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

const circuitBreakerOptions = {
  timeout: 15000,
  errorThresholdPercentage: 50,
  resetTimeout: 30000,
  volumeThreshold: 5
};

const llmCircuitBreaker = new CircuitBreaker(callLLMClassifier, circuitBreakerOptions);

llmCircuitBreaker.on("open", () => {
  console.warn("[IntentRouter] LLM circuit breaker OPEN - falling back to rules");
});

llmCircuitBreaker.on("halfOpen", () => {
  console.log("[IntentRouter] LLM circuit breaker half-open - testing recovery");
});

llmCircuitBreaker.on("close", () => {
  console.log("[IntentRouter] LLM circuit breaker CLOSED - LLM available");
});

function degradedRuleFallback(normalizedText: string): FallbackResult {
  const simplePatterns: Array<{ pattern: RegExp; intent: IntentType; format: OutputFormat }> = [
    { pattern: /\b(powerpoint|pptx?|presentaci|slides?|diaposit)/i, intent: "CREATE_PRESENTATION", format: "pptx" },
    { pattern: /\b(word|docx?|documento|document|informe|report|essay)/i, intent: "CREATE_DOCUMENT", format: "docx" },
    { pattern: /\b(excel|xlsx?|spreadsheet|tabla|planilla|tabelle)/i, intent: "CREATE_SPREADSHEET", format: "xlsx" },
    { pattern: /\b(resum|summar|sintesis|condensa)/i, intent: "SUMMARIZE", format: null },
    { pattern: /\b(traduc|translat|übersetzen)/i, intent: "TRANSLATE", format: null },
    { pattern: /\b(busca|search|recherch|such)/i, intent: "SEARCH_WEB", format: null },
    { pattern: /\b(anali[zs]|review|evalua)/i, intent: "ANALYZE_DOCUMENT", format: null }
  ];

  for (const { pattern, intent, format } of simplePatterns) {
    if (pattern.test(normalizedText)) {
      return {
        intent,
        output_format: format,
        slots: {},
        confidence: 0.60,
        fallback_method: "degraded_rule",
        reasoning: "Degraded fallback due to LLM unavailability"
      };
    }
  }

  // AGENTIC IMPROVEMENT #6: Return helpful suggestions when no pattern matches
  return {
    intent: "CHAT_GENERAL",
    output_format: null,
    slots: {},
    confidence: 0.50,
    fallback_method: "degraded_rule",
    reasoning: "No pattern matched in degraded mode",
    suggested_actions: [
      { label: "📝 Crear un resumen", action: "dame un resumen del documento" },
      { label: "📊 Analizar datos", action: "analiza los datos del documento" },
      { label: "🔍 Buscar información", action: "busca información sobre [tema]" },
      { label: "📄 Crear presentación", action: "crea una presentación sobre [tema]" },
      { label: "📋 Extraer puntos clave", action: "extrae los puntos clave del documento" }
    ]
  };
}

export async function llmFallback(
  normalizedText: string,
  originalText: string,
  maxRetries: number = 2,
  baseDelay: number = 1000
): Promise<FallbackResult> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const result = await llmCircuitBreaker.fire(normalizedText, originalText) as LLMClassification;

      return {
        intent: result.intent,
        output_format: result.output_format,
        slots: result.slots,
        confidence: result.confidence,
        reasoning: result.reasoning,
        fallback_method: "llm"
      };
    } catch (error) {
      lastError = error as Error;
      console.warn(`[IntentRouter] LLM fallback attempt ${attempt + 1} failed:`, error);

      if (attempt < maxRetries - 1) {
        const delay = baseDelay * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  console.error("[IntentRouter] All LLM attempts failed, using degraded fallback");

  const degraded = degradedRuleFallback(normalizedText);
  degraded.error = lastError?.message;

  return degraded;
}

export function getCircuitBreakerStats() {
  return {
    state: llmCircuitBreaker.opened ? "open" : llmCircuitBreaker.halfOpen ? "half-open" : "closed",
    stats: llmCircuitBreaker.stats
  };
}

export function resetCircuitBreaker(): void {
  llmCircuitBreaker.close();
}
