import { llmGateway } from "./llmGateway";

export type IntentType =
  | "greeting"
  | "simple_question"
  | "factual"
  | "search_required"
  | "document_generation"
  | "code_generation"
  | "agent_task"
  | "complex_research"
  | "image_generation"
  | "data_analysis";

export type ComplexityLevel = "trivial" | "simple" | "moderate" | "complex" | "expert";

export type RecommendedLane = "fast" | "deep";

interface ClassificationResult {
  intent: IntentType;
  complexity: ComplexityLevel;
  confidence: number;
  suggestedModel: "flash" | "pro" | "agent";
  requiresTools: string[];
  estimatedTokens: number;
  canUseFastPath: boolean;
  /** Recommended latency lane derived from the classification. */
  recommendedLane: RecommendedLane;
}

/** Map complexity/model to the recommended latency lane. */
function deriveRecommendedLane(
  complexity: ComplexityLevel,
  suggestedModel: "flash" | "pro" | "agent",
): RecommendedLane {
  if (suggestedModel === "agent") return "deep";
  if (complexity === "complex" || complexity === "expert") return "deep";
  return "fast";
}

const GREETING_PATTERNS = [
  /^(hola|hi|hello|hey|buenos?\s*d[ií]as?|buenas?\s*(tardes?|noches?)|saludos?|qu[ée]\s*tal)/i,
  /^(c[óo]mo\s*est[áa]s?|how\s*are\s*you|what'?s?\s*up)/i,
  /^(gracias?|thanks?|thank\s*you|thx)/i,
  /^(adi[óo]s|bye|chao|hasta\s*(luego|pronto|ma[ñn]ana))/i,
];

const SIMPLE_QUESTION_PATTERNS = [
  /^(qu[ée]\s*(es|son|significa)|what\s*(is|are|does))\s*.{3,50}\??$/i,
  /^(qui[ée]n\s*(es|fue|era)|who\s*(is|was))\s*.{3,30}\??$/i,
  /^(cu[áa]ndo\s*(es|fue|ser[áa])|when\s*(is|was|will))\s*.{3,40}\??$/i,
  /^(d[óo]nde\s*(est[áa]|queda)|where\s*(is|are))\s*.{3,40}\??$/i,
  /^(cu[áa]nto\s*(es|cuesta|vale)|how\s*much)\s*.{3,30}\??$/i,
];

const DOCUMENT_PATTERNS = [
  /(crear?|genera?r?|hacer?|escribir?)\s*(un|una|el|la)?\s*(documento|word|excel|pdf|informe|reporte|cv|curr[ií]culum)/i,
  /(make|create|generate|write)\s*(a|an|the)?\s*(document|report|spreadsheet|presentation)/i,
];

const CODE_PATTERNS = [
  /(escrib[ea]|crea|genera|haz)\s*(un|una|el|la)?\s*(c[óo]digo|funci[óo]n|script|programa|app|aplicaci[óo]n)/i,
  /(write|create|build|make)\s*(a|an|the)?\s*(code|function|script|program|app|api)/i,
  /```|\bfunction\b|\bclass\b|\bdef\b|\bconst\b|\blet\b|\bvar\b/i,
];

const SEARCH_PATTERNS = [
  /(busca|encuentra|investiga|search|find|look\s*up|research)/i,
  /(art[ií]culos?|papers?|estudios?|publicaciones?)\s*(cient[ií]ficos?|acad[ée]micos?)/i,
  /(noticias?|news|[úu]ltimas?\s*novedades?)/i,
  /\b(2024|2025|2026|actualidad|recent|latest|current)\b/i,
];

const COMPLEX_PATTERNS = [
  /(analiza|compara|eval[úu]a|sintetiza|analyze|compare|evaluate|synthesize)/i,
  /(plan|estrategia|strategy|roadmap|architecture)/i,
  /(multi.?step|varios?\s*pasos?|multiple\s*steps?)/i,
  /(investiga.*y.*genera|research.*and.*create|busca.*y.*crea)/i,
];

const IMAGE_PATTERNS = [
  /(genera|crea|dibuja|dise[ñn]a)\s*(una?)?\s*(imagen|foto|ilustraci[óo]n|gr[áa]fico)/i,
  /(generate|create|draw|design)\s*(an?)?\s*(image|picture|illustration|graphic)/i,
];

export function classifyPromptFast(prompt: string): ClassificationResult {
  const normalizedPrompt = prompt.trim().toLowerCase();
  const wordCount = prompt.split(/\s+/).length;
  
  for (const pattern of GREETING_PATTERNS) {
    if (pattern.test(normalizedPrompt)) {
      return {
        intent: "greeting",
        complexity: "trivial",
        confidence: 0.95,
        suggestedModel: "flash",
        requiresTools: [],
        estimatedTokens: 50,
        canUseFastPath: true,
        recommendedLane: "fast" as RecommendedLane,
      };
    }
  }

  for (const pattern of SIMPLE_QUESTION_PATTERNS) {
    if (pattern.test(normalizedPrompt) && wordCount < 15) {
      return {
        intent: "simple_question",
        complexity: "simple",
        confidence: 0.85,
        suggestedModel: "flash",
        requiresTools: [],
        estimatedTokens: 200,
        canUseFastPath: true,
        recommendedLane: "fast" as RecommendedLane,
      };
    }
  }

  for (const pattern of IMAGE_PATTERNS) {
    if (pattern.test(normalizedPrompt)) {
      return {
        intent: "image_generation",
        complexity: "moderate",
        confidence: 0.9,
        suggestedModel: "flash",
        requiresTools: ["image_generation"],
        estimatedTokens: 100,
        canUseFastPath: false,
        recommendedLane: "fast" as RecommendedLane,
      };
    }
  }

  for (const pattern of CODE_PATTERNS) {
    if (pattern.test(normalizedPrompt)) {
      const codeComplexity: ComplexityLevel = wordCount > 50 ? "complex" : "moderate";
      const codeSuggestedModel: "flash" | "pro" = wordCount > 100 ? "pro" : "flash";
      return {
        intent: "code_generation",
        complexity: codeComplexity,
        confidence: 0.85,
        suggestedModel: codeSuggestedModel,
        requiresTools: ["code_execution"],
        estimatedTokens: Math.max(500, wordCount * 20),
        canUseFastPath: false,
        recommendedLane: deriveRecommendedLane(codeComplexity, codeSuggestedModel),
      };
    }
  }

  for (const pattern of DOCUMENT_PATTERNS) {
    if (pattern.test(normalizedPrompt)) {
      return {
        intent: "document_generation",
        complexity: "moderate",
        confidence: 0.9,
        suggestedModel: "pro",
        requiresTools: ["document_generation"],
        estimatedTokens: 1000,
        canUseFastPath: false,
        recommendedLane: "deep" as RecommendedLane,
      };
    }
  }

  for (const pattern of SEARCH_PATTERNS) {
    if (pattern.test(normalizedPrompt)) {
      const isComplex = COMPLEX_PATTERNS.some(p => p.test(normalizedPrompt));
      const searchModel: "flash" | "pro" | "agent" = isComplex ? "agent" : "pro";
      const searchComplexity: ComplexityLevel = isComplex ? "complex" : "moderate";
      return {
        intent: isComplex ? "complex_research" : "search_required",
        complexity: searchComplexity,
        confidence: 0.8,
        suggestedModel: searchModel,
        requiresTools: ["web_search", "scientific_search"],
        estimatedTokens: isComplex ? 2000 : 800,
        canUseFastPath: false,
        recommendedLane: deriveRecommendedLane(searchComplexity, searchModel),
      };
    }
  }

  for (const pattern of COMPLEX_PATTERNS) {
    if (pattern.test(normalizedPrompt)) {
      return {
        intent: "agent_task",
        complexity: "complex",
        confidence: 0.75,
        suggestedModel: "agent",
        requiresTools: ["planning", "web_search", "document_generation"],
        estimatedTokens: 3000,
        canUseFastPath: false,
        recommendedLane: "deep" as RecommendedLane,
      };
    }
  }

  if (wordCount <= 5) {
    return {
      intent: "simple_question",
      complexity: "simple",
      confidence: 0.7,
      suggestedModel: "flash",
      requiresTools: [],
      estimatedTokens: 150,
      canUseFastPath: true,
      recommendedLane: "fast" as RecommendedLane,
    };
  }

  if (wordCount <= 20) {
    return {
      intent: "factual",
      complexity: "simple",
      confidence: 0.65,
      suggestedModel: "flash",
      requiresTools: [],
      estimatedTokens: 300,
      canUseFastPath: true,
      recommendedLane: "fast" as RecommendedLane,
    };
  }

  return {
    intent: "factual",
    complexity: "moderate",
    confidence: 0.5,
    suggestedModel: "pro",
    requiresTools: [],
    estimatedTokens: wordCount * 10,
    canUseFastPath: false,
    recommendedLane: deriveRecommendedLane("moderate", "pro"),
  };
}

const FAST_PATH_RESPONSES: Record<string, string[]> = {
  "hola": ["¡Hola! ¿En qué puedo ayudarte hoy?", "¡Hola! ¿Qué necesitas?", "¡Hola! Estoy listo para ayudarte."],
  "hi": ["Hi! How can I help you?", "Hello! What can I do for you?"],
  "hello": ["Hello! How can I assist you today?", "Hi there! What do you need?"],
  "gracias": ["¡De nada! ¿Hay algo más en lo que pueda ayudarte?", "¡Con gusto! ¿Necesitas algo más?"],
  "thanks": ["You're welcome! Anything else I can help with?", "Happy to help!"],
  "adios": ["¡Hasta luego! Que tengas un excelente día.", "¡Adiós! Vuelve cuando necesites."],
  "bye": ["Goodbye! Have a great day!", "See you later!"],
};

export function getFastPathResponse(prompt: string): string | null {
  const normalized = prompt.trim().toLowerCase().replace(/[!?.,]+$/, "");
  
  for (const [key, responses] of Object.entries(FAST_PATH_RESPONSES)) {
    if (normalized === key || normalized.startsWith(key + " ") || normalized.endsWith(" " + key)) {
      return responses[Math.floor(Math.random() * responses.length)];
    }
  }
  
  return null;
}

export async function routePrompt(
  prompt: string,
  userId?: string,
  chatId?: string
): Promise<{
  classification: ClassificationResult;
  fastPathResponse: string | null;
  shouldStream: boolean;
  modelToUse: string;
  recommendedLane: RecommendedLane;
}> {
  const classification = classifyPromptFast(prompt);
  const fastPathResponse = classification.canUseFastPath ? getFastPathResponse(prompt) : null;

  const modelMap = {
    flash: "gemini-2.0-flash",
    pro: "gemini-2.5-pro",
    agent: "gemini-2.5-pro",
  };

  return {
    classification,
    fastPathResponse,
    shouldStream: !fastPathResponse && classification.complexity !== "trivial",
    modelToUse: modelMap[classification.suggestedModel],
    recommendedLane: classification.recommendedLane,
  };
}

export function getToolsForIntent(intent: IntentType): string[] {
  const toolMap: Record<IntentType, string[]> = {
    greeting: [],
    simple_question: [],
    factual: [],
    search_required: ["web_search"],
    document_generation: ["document_generator", "excel_generator", "word_generator"],
    code_generation: ["code_executor", "file_manager"],
    agent_task: ["planner", "web_search", "document_generator", "code_executor"],
    complex_research: ["web_search", "scientific_search", "document_generator"],
    image_generation: ["image_generator"],
    data_analysis: ["data_analyzer", "chart_generator", "excel_generator"],
  };

  return toolMap[intent] || [];
}

export default {
  classifyPromptFast,
  getFastPathResponse,
  routePrompt,
  getToolsForIntent,
};
