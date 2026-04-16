import { complexityAnalyzer } from "./complexityAnalyzer";

export interface RouterDecision {
  route: "chat" | "agent";
  confidence: number;
  reasons: string[];
  tool_needs: string[];
  plan_hint: string[];
}

export interface RouterConfig {
  confidenceThreshold: number;
  enableDynamicEscalation: boolean;
}

const DEFAULT_CONFIG: RouterConfig = {
  confidenceThreshold: parseFloat(process.env.ROUTER_CONFIDENCE_THRESHOLD || "0.65"),
  enableDynamicEscalation: process.env.ENABLE_DYNAMIC_ESCALATION !== "false",
};

const HEURISTIC_PATTERNS: Array<{ pattern: RegExp; toolNeed: string; confidence: number }> = [
  { pattern: /\b(busca|buscar|search|find|investigar|investigate|research)\b.*\b(web|internet|online)\b/iu, toolNeed: "web_search", confidence: 0.9 },
  { pattern: /https?:\/\/[^\s]+/i, toolNeed: "open_url", confidence: 0.85 },
  { pattern: /\b(navega|navigate|browse|visita|visit|abre|open)\b.*\b(p[aá]gina|page|sitio|site|url|web)\b/iu, toolNeed: "open_url", confidence: 0.85 },
  { pattern: /\b(descarga|download|extrae|extract|obt[eé]n|get)\b.*\b(archivo|file|documento|document|datos|data)\b/iu, toolNeed: "extract_text", confidence: 0.8 },
  { pattern: /\b(verifica|verify|comprueba|check|confirma|confirm)\b.*\b(hechos|facts|fuentes|sources)\b/iu, toolNeed: "web_search", confidence: 0.85 },
  { pattern: /\b(precio|price|cotizaci[oó]n|quote|costo|cost)\b.*\b(actual|current|hoy|today|ahora|now)\b/iu, toolNeed: "web_search", confidence: 0.9 },
  { pattern: /\b(crea|create|genera|generate|haz|make)\b.*\b(documento|document|word|excel|pdf|csv|archivo|file|presentaci[oó]n|presentation|ppt)\b/iu, toolNeed: "generate_file", confidence: 0.85 },
  { pattern: /\b(ejecuta|execute|run|corre)\b.*\b(c[oó]digo|code|script|programa|program|python|javascript|shell)\b/iu, toolNeed: "execute_code", confidence: 0.8 },
  { pattern: /\b(analiza|analyze|procesa|process)\b.*\b(archivo|file|documento|document|excel|spreadsheet)\b/iu, toolNeed: "analyze_file", confidence: 0.8 },
  { pattern: /\b(automatiza|automate|automatizar|automation)\b/iu, toolNeed: "automation", confidence: 0.85 },
  { pattern: /\b(paso\s+\d+|step\s+\d+|\d+\.\s+\w+)\b/iu, toolNeed: "multi_step", confidence: 0.75 },
  { pattern: /\b(primero|first)\b.*\b(luego|then|despu[eé]s|after)\b/iu, toolNeed: "multi_step", confidence: 0.7 },
  // NOTE: Avoid matching Spanish "Resume este texto..." (summarize) as English noun "resume" (CV).
  { pattern: /\b(cv|curriculum|curr[ií]culum)\b|\bresume\b(?!\s+(este|esto|texto)\b)/iu, toolNeed: "generate_file", confidence: 0.9 },
  { pattern: /\b(landing page|p[aá]gina de aterrizaje)\b/iu, toolNeed: "webdev", confidence: 0.85 },
  { pattern: /\b(scrape|scrapear|scrapea|scraping|extraer datos|extract data)\b/iu, toolNeed: "web_scrape", confidence: 0.9 },
  { pattern: /\b(usa el agente|use agent|modo agente|agent mode)\b/iu, toolNeed: "explicit_agent", confidence: 1.0 },
  { pattern: /\b(from|de|en)\s+(wikipedia|the web|la web|internet)\b/iu, toolNeed: "web_search", confidence: 0.85 },
  { pattern: /\b(get|obtener|find|buscar)\s+information\s+from\b/iu, toolNeed: "web_search", confidence: 0.8 },
  { pattern: /\binformaci[oó]n\s+sobre\b.*\b(web|internet)\b/iu, toolNeed: "web_search", confidence: 0.85 },
];

const TRIVIAL_PATTERNS = [
  /^hola[,\s!?.,]*(buenos d[ií]as?|buenas tardes|buenas noches)[\s!?.,]*$/iu,
  /^(hola|hi|hello|hey|buenos d[ií]as?|buenas tardes|buenas noches)[\s!?.,]*$/iu,
  /^(gracias|thanks|thank you|thx|ty|muchas gracias)[\s!?.,]*$/iu,
  /^(ok|okay|s[ií]|si|yes|no|nope|vale|bien|bueno|sure|got it)[\s!?.,]*$/iu,
  /^(adi[oó]s|bye|goodbye|chao|hasta luego|see you)[\s!?.,]*$/iu,
];

const SIMPLE_CHAT_PATTERNS = [
  /^(qué|que|what|cuál|cual|which|cómo|como|how|por qué|why|dónde|donde|where|cuándo|cuando|when)\s+\w+/i,
  /^(explica|explain|define|describe|describe)\s+\w+/i,
  /^(resume|summarize|resumen)\s+/i,
];

export class Router {
  private config: RouterConfig;

  constructor(config: Partial<RouterConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    console.log(`[Router] Initialized with threshold=${this.config.confidenceThreshold}, dynamicEscalation=${this.config.enableDynamicEscalation}`);
  }

  async decide(userText: string, hasAttachments: boolean = false): Promise<RouterDecision> {
    const startTime = Date.now();
    const trimmed = userText.trim();

    if (this.isTrivial(trimmed)) {
      console.log(`[Router] Trivial message detected → chat (${Date.now() - startTime}ms)`);
      return this.createDecision("chat", 1.0, ["Mensaje trivial/saludo"], [], []);
    }

    const heuristicResult = this.checkHeuristics(trimmed);
    
    if (heuristicResult.match) {
      console.log(`[Router] Heuristic match: ${heuristicResult.toolNeeds.join(", ")} → agent (confidence=${heuristicResult.confidence}) (${Date.now() - startTime}ms)`);
      
      if (heuristicResult.confidence >= this.config.confidenceThreshold) {
        return this.createDecision(
          "agent",
          heuristicResult.confidence,
          heuristicResult.reasons,
          heuristicResult.toolNeeds,
          this.generatePlanHint(heuristicResult.toolNeeds, trimmed)
        );
      }
    }

    const complexityResult = complexityAnalyzer.analyze(trimmed, hasAttachments);
    
    if (complexityResult.agent_required && complexityResult.agent_reason) {
      console.log(`[Router] ComplexityAnalyzer → agent: ${complexityResult.agent_reason} (${Date.now() - startTime}ms)`);
      return this.createDecision(
        "agent",
        0.8,
        [complexityResult.agent_reason],
        this.inferToolNeeds(complexityResult.agent_reason),
        []
      );
    }

    if (this.isSimpleChat(trimmed) && !hasAttachments) {
      console.log(`[Router] Simple chat pattern detected → chat (${Date.now() - startTime}ms)`);
      return this.createDecision("chat", 0.85, ["Consulta simple de información"], [], []);
    }

    try {
      const llmDecision = await this.llmRouter(trimmed, hasAttachments);
      console.log(`[Router] LLM decision: ${llmDecision.route} (confidence=${llmDecision.confidence}) (${Date.now() - startTime}ms)`);
      
      if (llmDecision.route === "agent" && llmDecision.confidence >= this.config.confidenceThreshold) {
        return llmDecision;
      }
      
      return this.createDecision("chat", llmDecision.confidence, llmDecision.reasons, [], []);
    } catch (error) {
      console.warn(`[Router] LLM router failed, defaulting to complexity result:`, error);
      
      if (complexityResult.score >= 6 || complexityResult.category === "complex" || complexityResult.category === "architectural") {
        return this.createDecision(
          "agent",
          0.7,
          ["Tarea compleja detectada por análisis de complejidad"],
          [],
          []
        );
      }
      
      return this.createDecision("chat", 0.6, ["Fallback a chat por fallo del router LLM"], [], []);
    }
  }

  checkDynamicEscalation(chatResponse: string): { shouldEscalate: boolean; reason?: string } {
    if (!this.config.enableDynamicEscalation) {
      return { shouldEscalate: false };
    }

    const escalationPatterns = [
      { pattern: /\b(necesito|need to)\s+(buscar|search|verificar|verify|comprobar|check)\b/i, reason: "Necesita búsqueda web" },
      { pattern: /\b(no tengo acceso|I don't have access|cannot access)\b/i, reason: "Sin acceso a recursos externos" },
      { pattern: /\b(información actualizada|current information|real-time|tiempo real)\b/i, reason: "Requiere datos en tiempo real" },
      { pattern: /\b(no puedo ejecutar|cannot execute|can't run)\b/i, reason: "Requiere ejecución de código" },
      { pattern: /\b(consultaría|would check|should verify)\b/i, reason: "Sugiere verificación externa" },
    ];

    for (const { pattern, reason } of escalationPatterns) {
      if (pattern.test(chatResponse)) {
        console.log(`[Router] Dynamic escalation triggered: ${reason}`);
        return { shouldEscalate: true, reason };
      }
    }

    return { shouldEscalate: false };
  }

  private isTrivial(text: string): boolean {
    return TRIVIAL_PATTERNS.some(p => p.test(text));
  }

  private isSimpleChat(text: string): boolean {
    const wordCount = text.split(/\s+/).length;
    if (wordCount > 30) return false;
    return SIMPLE_CHAT_PATTERNS.some(p => p.test(text));
  }

  private checkHeuristics(text: string): { match: boolean; confidence: number; toolNeeds: string[]; reasons: string[] } {
    const toolNeeds: string[] = [];
    const reasons: string[] = [];
    let maxConfidence = 0;

    for (const { pattern, toolNeed, confidence } of HEURISTIC_PATTERNS) {
      if (pattern.test(text)) {
        if (!toolNeeds.includes(toolNeed)) {
          toolNeeds.push(toolNeed);
        }
        reasons.push(`Patrón detectado: ${toolNeed}`);
        maxConfidence = Math.max(maxConfidence, confidence);
      }
    }

    return {
      match: toolNeeds.length > 0,
      confidence: maxConfidence,
      toolNeeds,
      reasons,
    };
  }

  private async llmRouter(userText: string, hasAttachments: boolean): Promise<RouterDecision> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.warn("[Router] GEMINI_API_KEY not configured, skipping LLM router");
      throw new Error("LLM router unavailable - no API key");
    }

    const { geminiChat } = await import("../lib/gemini");

    const prompt = `Eres un router de IA. Analiza el mensaje del usuario y decide si requiere:
- "chat": respuesta simple de conocimiento general, explicaciones, definiciones, consejos
- "agent": requiere herramientas externas (búsqueda web, navegación, código, archivos, datos en tiempo real)

Mensaje: "${userText}"
${hasAttachments ? "Nota: El mensaje incluye archivos adjuntos." : ""}

Responde SOLO con JSON válido (sin markdown ni código):
{"route":"chat","confidence":0.8,"reasons":["razón1"],"tool_needs":[],"plan_hint":[]}`;

    try {
      const result = await geminiChat(
        [{ role: "user", parts: [{ text: prompt }] }],
        { model: "gemini-2.0-flash", maxOutputTokens: 200, temperature: 0.1 }
      );

      const responseText = result.content?.trim() || "";
      
      const jsonMatch = responseText.match(/\{[\s\S]*?\}/);
      if (!jsonMatch) {
        console.warn("[Router] No valid JSON in LLM response:", responseText.slice(0, 100));
        throw new Error("No valid JSON in LLM response");
      }

      const parsed = JSON.parse(jsonMatch[0]);
      
      return {
        route: parsed.route === "agent" ? "agent" : "chat",
        confidence: Math.max(0, Math.min(1, parseFloat(parsed.confidence) || 0.5)),
        reasons: Array.isArray(parsed.reasons) ? parsed.reasons : [],
        tool_needs: Array.isArray(parsed.tool_needs) ? parsed.tool_needs : [],
        plan_hint: Array.isArray(parsed.plan_hint) ? parsed.plan_hint : [],
      };
    } catch (error: any) {
      console.error("[Router] LLM router error:", error.message);
      throw error;
    }
  }

  private createDecision(
    route: "chat" | "agent",
    confidence: number,
    reasons: string[],
    toolNeeds: string[],
    planHint: string[]
  ): RouterDecision {
    return { route, confidence, reasons, tool_needs: toolNeeds, plan_hint: planHint };
  }

  private inferToolNeeds(reason: string): string[] {
    const toolMap: Record<string, string[]> = {
      "búsqueda web": ["web_search"],
      "navegación": ["open_url"],
      "web": ["web_search", "open_url"],
      "archivo": ["extract_text", "analyze_file"],
      "documento": ["generate_file"],
      "código": ["execute_code"],
      "automatización": ["automation"],
    };

    const needs: string[] = [];
    const lowerReason = reason.toLowerCase();
    
    for (const [keyword, tools] of Object.entries(toolMap)) {
      if (lowerReason.includes(keyword)) {
        needs.push(...tools.filter(t => !needs.includes(t)));
      }
    }

    return needs.length > 0 ? needs : ["general"];
  }

  private generatePlanHint(toolNeeds: string[], userText: string): string[] {
    const hints: string[] = [];

    if (toolNeeds.includes("web_search")) {
      hints.push("Buscar información relevante en la web");
    }
    if (toolNeeds.includes("open_url")) {
      const urlMatch = userText.match(/https?:\/\/[^\s]+/);
      if (urlMatch) {
        hints.push(`Navegar a ${urlMatch[0]}`);
      } else {
        hints.push("Navegar a la URL especificada");
      }
    }
    if (toolNeeds.includes("extract_text")) {
      hints.push("Extraer contenido del recurso");
    }
    if (toolNeeds.includes("generate_file")) {
      hints.push("Generar documento solicitado");
    }
    if (toolNeeds.includes("execute_code")) {
      hints.push("Ejecutar código necesario");
    }
    
    if (hints.length === 0) {
      hints.push("Analizar solicitud", "Ejecutar acciones necesarias", "Generar respuesta final");
    } else {
      hints.push("Generar respuesta final");
    }

    return hints;
  }
}

export const router = new Router();

export async function decideRoute(userText: string, hasAttachments: boolean = false): Promise<RouterDecision> {
  return router.decide(userText, hasAttachments);
}

export function checkDynamicEscalation(chatResponse: string): { shouldEscalate: boolean; reason?: string } {
  return router.checkDynamicEscalation(chatResponse);
}
