import { Intent, IntentCategory, IntentPattern, SessionContext } from "./types";

const INTENT_PATTERNS: IntentPattern[] = [
  {
    category: "query",
    patterns: [
      "^(qué|cuál|cómo|dónde|cuándo|por qué|quién)\\s",
      "^(what|which|how|where|when|why|who)\\s",
      "\\?$",
      "^(busca|encuentra|search|find|lookup)\\s",
    ],
    keywords: ["qué", "cuál", "cómo", "what", "how", "explain", "tell me", "describe"],
    weight: 1.0,
  },
  {
    category: "command",
    patterns: [
      "^(ejecuta|run|exec|haz|do|perform|execute)\\s",
      "^(crea|create|make|genera|generate)\\s",
      "^(elimina|delete|remove|borra)\\s",
      "^(actualiza|update|modifica|modify|edit)\\s",
      "^(envía|send|envia)\\s",
    ],
    keywords: ["ejecuta", "run", "create", "delete", "update", "send", "move", "copy"],
    weight: 1.2,
  },
  {
    category: "creation",
    patterns: [
      "(crea|create|genera|generate|escribe|write|diseña|design)\\s.*(archivo|file|documento|document|imagen|image|código|code)",
      "(hazme|make me|build|construye)\\s",
      "(cv|curriculum|resume|currículum)\\b",
      "(presentación|presentation|slides|diapositivas)\\b",
    ],
    keywords: ["crear", "generar", "escribir", "diseñar", "build", "make", "produce", "draft"],
    weight: 1.1,
  },
  {
    category: "analysis",
    patterns: [
      "(analiza|analyze|examina|examine|evalúa|evaluate)\\s",
      "(resume|summarize|sintetiza|resumir|resumen)\\s",
      "(compara|compare|contrasta|contrast)\\s",
      "(revisa|review|inspecciona|inspect)\\s",
      "(resume|resumen|summarize|resumir).*(pdf|documento|archivo|file|document)",
      "(analiza|analyze).*(pdf|documento|archivo|file|document)",
      "(dame|give me|hazme).*(resumen|summary).*(pdf|documento|archivo|file|document)",
      "(extrae|extract|lee|read).*(contenido|content|texto|text).*(pdf|documento|archivo|file|document)",
    ],
    keywords: ["analizar", "analyze", "examine", "evaluate", "summarize", "compare", "review", "resumen", "resumir", "resumé", "pdf", "documento", "document", "archivo", "file"],
    weight: 1.3,
  },
  {
    category: "code",
    patterns: [
      "(código|code|script|función|function|clase|class|programa|program)\\s",
      "(debug|debuggea|fix|arregla|refactor)\\s.*(código|code|error|bug)",
      "(python|javascript|typescript|java|c\\+\\+|rust|go|ruby)\\s",
      "(test|prueba|unittest|spec)\\s",
    ],
    keywords: ["código", "code", "debug", "function", "class", "script", "python", "javascript", "api"],
    weight: 1.0,
  },
  {
    category: "research",
    patterns: [
      "(investiga|research|busca información|find information)\\s",
      "(profundiza|deep dive|explora|explore)\\s",
      "(reporte|report|informe|study)\\s.*(sobre|about|on)",
      "(artículos|articles|papers|estudios)\\s",
    ],
    keywords: ["investigar", "research", "explore", "study", "report", "find out"],
    weight: 1.0,
  },
  {
    category: "automation",
    patterns: [
      "(automatiza|automate|programa|schedule|agenda)\\s",
      "(cada|every|diario|daily|semanal|weekly)\\s",
      "(workflow|flujo|pipeline|proceso automático)",
      "(cron|trigger|webhook)\\b",
    ],
    keywords: ["automatizar", "schedule", "recurring", "workflow", "cron", "trigger"],
    weight: 1.0,
  },
  {
    category: "conversation",
    patterns: [
      "^(hola|hi|hello|hey|buenos días|buenas)\\b",
      "^(gracias|thanks|thank you)\\b",
      "^(ok|okay|sí|si|yes|no|vale|bien)\\b",
    ],
    keywords: ["hola", "gracias", "ayuda", "help", "chat", "talk"],
    weight: 0.8,
  },
];

export class IntentClassifier {
  private patterns: IntentPattern[];
  private confidenceThreshold: number;
  private useLLMFallback: boolean;

  constructor(config: { confidenceThreshold?: number; useLLMFallback?: boolean } = {}) {
    this.patterns = INTENT_PATTERNS;
    this.confidenceThreshold = config.confidenceThreshold ?? 0.7;
    this.useLLMFallback = config.useLLMFallback ?? true;
  }

  async classify(prompt: string, context?: SessionContext): Promise<Intent[]> {
    const intents: Intent[] = [];
    const ruleIntents = this.classifyByRules(prompt);
    intents.push(...ruleIntents);

    const maxConfidence = Math.max(...intents.map((i) => i.confidence), 0);

    if (maxConfidence < this.confidenceThreshold && this.useLLMFallback) {
      const llmIntents = await this.classifyByLLM(prompt, context);
      intents.push(...llmIntents);
    }

    const merged = this.mergeIntents(intents);
    merged.sort((a, b) => b.confidence - a.confidence);

    return merged;
  }

  private classifyByRules(prompt: string): Intent[] {
    const intents: Intent[] = [];
    const promptLower = prompt.toLowerCase();

    for (const pattern of this.patterns) {
      let score = 0.0;
      const matchedKeywords: string[] = [];

      for (const regex of pattern.patterns) {
        try {
          if (new RegExp(regex, "iu").test(promptLower)) {
            score += 0.3 * pattern.weight;
          }
        } catch {
          continue;
        }
      }

      for (const keyword of pattern.keywords) {
        if (promptLower.includes(keyword.toLowerCase())) {
          score += 0.15 * pattern.weight;
          matchedKeywords.push(keyword);
        }
      }

      score = Math.min(score, 1.0);

      if (score > 0.1) {
        intents.push({
          category: pattern.category,
          confidence: score,
          keywords: matchedKeywords,
        });
      }
    }

    return intents;
  }

  private async classifyByLLM(prompt: string, context?: SessionContext): Promise<Intent[]> {
    try {
      const { geminiChat } = await import("../../lib/gemini");

      const systemPrompt = `Eres un clasificador de intenciones. Analiza el mensaje y clasifica su intención principal.

Categorías disponibles:
- query: Pregunta o búsqueda de información
- command: Acción directa a ejecutar
- conversation: Conversación general/saludos
- creation: Crear contenido, archivos, documentos
- analysis: Analizar datos o información
- automation: Automatizar tareas
- research: Investigación profunda
- code: Desarrollo de código
- clarification: El mensaje es ambiguo

Responde SOLO con JSON válido:
{"primary":{"category":"CATEGORY","confidence":0.0-1.0},"secondary":[{"category":"CATEGORY","confidence":0.0-1.0}]}`;

      const result = await geminiChat(
        [
          { role: "user", parts: [{ text: `${systemPrompt}\n\nMensaje: "${prompt}"` }] },
        ],
        { model: "gemini-2.0-flash", maxOutputTokens: 200, temperature: 0.1 }
      );

      const responseText = result.content?.trim() || "";
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);

      if (!jsonMatch) return [];

      const parsed = JSON.parse(jsonMatch[0]);
      const intents: Intent[] = [];

      if (parsed.primary) {
        intents.push({
          category: parsed.primary.category.toLowerCase() as IntentCategory,
          confidence: Math.max(0, Math.min(1, parsed.primary.confidence)),
          keywords: [],
        });
      }

      if (Array.isArray(parsed.secondary)) {
        for (const sec of parsed.secondary) {
          intents.push({
            category: sec.category.toLowerCase() as IntentCategory,
            confidence: Math.max(0, Math.min(1, sec.confidence)),
            keywords: [],
          });
        }
      }

      return intents;
    } catch (error) {
      console.warn("[IntentClassifier] LLM fallback failed:", error);
      return [];
    }
  }

  private mergeIntents(intents: Intent[]): Intent[] {
    const byCategory = new Map<IntentCategory, Intent>();

    for (const intent of intents) {
      const existing = byCategory.get(intent.category);
      if (!existing || intent.confidence > existing.confidence) {
        byCategory.set(intent.category, {
          ...intent,
          keywords: [...(existing?.keywords || []), ...intent.keywords],
        });
      } else if (existing) {
        existing.keywords = [...existing.keywords, ...intent.keywords];
      }
    }

    return Array.from(byCategory.values());
  }
}
