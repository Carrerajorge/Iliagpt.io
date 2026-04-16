export type RobustIntent = "chat" | "analysis" | "nav" | "artifact" | "code" | "automation";

export type SubIntent = 
  | "summarize"
  | "extract_table"
  | "compare"
  | "rewrite"
  | "translate"
  | "critique_format"
  | "create_report"
  | "fill_template"
  | "debug"
  | "refactor"
  | "search_web"
  | "find_file";

export interface IntentResult {
  intent: RobustIntent;
  subIntent: SubIntent | null;
  confidence: number;
  matchedKeywords: string[];
  reason: string;
}

const INTENT_KEYWORDS: Record<RobustIntent, string[]> = {
  analysis: [
    "resume", "resumen", "analiza", "análisis", "analisis", "extrae", "extraer",
    "sintetiza", "sintetizar", "conclusiones", "insights", "hallazgos",
    "comparar", "compara", "evalúa", "evalua", "evaluar",
    "summarize", "summary", "analyze", "analysis", "extract", "extraction",
    "synthesize", "findings", "compare", "evaluate", "evaluation",
    "interpreta", "interpret", "diagnóstico", "diagnostico", "diagnosis"
  ],
  nav: [
    "encuentra", "buscar", "búscame", "buscame", "localiza", "dónde está",
    "donde esta", "link", "enlace", "enlaces",
    "search", "find", "browse", "locate", "where is", "look for", "lookup",
    "navega", "navigate", "url", "página", "pagina", "page", "sitio", "site"
  ],
  artifact: [
    "excel", "xlsx", "xls", "word", "docx", "doc", "ppt", "pptx", "powerpoint",
    "reporte", "informe", "documento", "crear archivo", "generar archivo",
    "report", "document", "create file", "generate file", "spreadsheet",
    "hoja de cálculo", "hoja de calculo", "presentación", "presentacion",
    "presentation", "slides", "diapositivas", "pdf", "csv"
  ],
  code: [
    "código", "codigo", "programar", "programa", "script", "función", "funcion",
    "function", "debug", "debuggear", "error", "fix", "arregla", "arreglar",
    "refactor", "refactorizar", "compile", "compilar", "ejecuta", "ejecutar",
    "code", "program", "develop", "development", "bug", "issue",
    "python", "javascript", "typescript", "java", "sql", "html", "css",
    "api", "endpoint", "clase", "class", "método", "metodo", "method"
  ],
  automation: [
    "automatizar", "automatiza", "schedule", "programar tarea", "cron",
    "workflow", "flujo", "repetir", "cada día", "cada dia", "diario",
    "daily", "weekly", "semanal", "mensual", "monthly", "automate",
    "trigger", "webhook", "recurring", "recurrente", "batch", "pipeline"
  ],
  chat: [
    "hola", "hello", "hi", "hey", "gracias", "thanks", "ok", "sí", "si",
    "no", "vale", "bien", "qué tal", "que tal", "cómo estás", "como estas",
    "buenos días", "buenos dias", "buenas tardes", "buenas noches",
    "good morning", "good afternoon", "good evening", "please", "por favor"
  ]
};

const SUB_INTENT_KEYWORDS: Record<SubIntent, string[]> = {
  summarize: [
    "resumen", "resumir", "resume", "sintetiza", "sintetizar",
    "summarize", "summary", "síntesis", "sintesis", "condensar", "condensed"
  ],
  extract_table: [
    "extrae tabla", "extraer datos", "extraer tabla", "sacar tabla",
    "extract table", "parse", "parsear", "datos tabulares", "tabular data",
    "convertir a tabla", "tabla de datos"
  ],
  compare: [
    "compara", "comparar", "diferencias", "diferencia", "versus", "vs",
    "compare", "comparison", "diff", "contrastar", "contrast"
  ],
  rewrite: [
    "reescribe", "reescribir", "mejora el texto", "mejorar texto",
    "rewrite", "rephrase", "reformular", "refraseár", "parafrasear",
    "paraphrase", "reformulate"
  ],
  translate: [
    "traduce", "traducir", "traducción", "traduccion",
    "translate", "translation", "al español", "al inglés", "to english", "to spanish"
  ],
  critique_format: [
    "critica", "criticar", "revisar formato", "review format",
    "critique", "evaluar formato", "format review", "check format"
  ],
  create_report: [
    "informe", "reporte", "crear informe", "generar reporte",
    "report", "create report", "generate report", "elaborar informe"
  ],
  fill_template: [
    "llenar plantilla", "rellenar plantilla", "completar plantilla",
    "fill template", "complete template", "usar plantilla", "template"
  ],
  debug: [
    "debug", "debuggear", "depurar", "encontrar error", "find bug",
    "arreglar bug", "fix bug", "diagnosticar", "diagnose"
  ],
  refactor: [
    "refactor", "refactorizar", "mejorar código", "improve code",
    "limpiar código", "clean code", "optimizar", "optimize"
  ],
  search_web: [
    "busca en internet", "buscar en web", "search web", "search online",
    "busca online", "google", "investigar", "research"
  ],
  find_file: [
    "busca archivo", "encuentra archivo", "localiza archivo",
    "find file", "locate file", "buscar documento", "find document"
  ]
};

const INTENT_PRIORITY: RobustIntent[] = [
  "artifact",
  "analysis",
  "code",
  "automation",
  "nav",
  "chat"
];

export function classifyIntent(text: string): IntentResult {
  const normalizedText = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const originalLower = text.toLowerCase();
  
  const scores: Record<RobustIntent, { count: number; keywords: string[] }> = {
    analysis: { count: 0, keywords: [] },
    nav: { count: 0, keywords: [] },
    artifact: { count: 0, keywords: [] },
    code: { count: 0, keywords: [] },
    automation: { count: 0, keywords: [] },
    chat: { count: 0, keywords: [] }
  };

  for (const [intent, keywords] of Object.entries(INTENT_KEYWORDS) as [RobustIntent, string[]][]) {
    for (const keyword of keywords) {
      const normalizedKeyword = keyword.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      if (normalizedText.includes(normalizedKeyword) || originalLower.includes(keyword.toLowerCase())) {
        scores[intent].count++;
        if (!scores[intent].keywords.includes(keyword)) {
          scores[intent].keywords.push(keyword);
        }
      }
    }
  }

  let maxScore = 0;
  let winningIntent: RobustIntent = "chat";
  const matchedKeywords: string[] = [];

  for (const intent of INTENT_PRIORITY) {
    const score = scores[intent].count;
    if (score > maxScore) {
      maxScore = score;
      winningIntent = intent;
    }
  }

  if (maxScore > 0) {
    matchedKeywords.push(...scores[winningIntent].keywords);
  }

  const subIntent = detectSubIntent(normalizedText, originalLower);

  const confidence = calculateConfidence(maxScore, normalizedText.length);
  const reason = maxScore > 0
    ? `Matched ${maxScore} keyword(s): ${matchedKeywords.slice(0, 3).join(", ")}${subIntent ? ` [sub: ${subIntent}]` : ""}`
    : "No keywords matched, defaulting to chat";

  return {
    intent: winningIntent,
    subIntent,
    confidence,
    matchedKeywords,
    reason
  };
}

function detectSubIntent(normalizedText: string, originalLower: string): SubIntent | null {
  let bestSubIntent: SubIntent | null = null;
  let bestScore = 0;

  for (const [subIntent, keywords] of Object.entries(SUB_INTENT_KEYWORDS) as [SubIntent, string[]][]) {
    let score = 0;
    for (const keyword of keywords) {
      const normalizedKeyword = keyword.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      if (normalizedText.includes(normalizedKeyword) || originalLower.includes(keyword.toLowerCase())) {
        score++;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestSubIntent = subIntent;
    }
  }

  return bestScore > 0 ? bestSubIntent : null;
}

function calculateConfidence(matchCount: number, textLength: number): number {
  if (matchCount === 0) return 0.3;
  if (matchCount === 1) return 0.6;
  if (matchCount === 2) return 0.75;
  if (matchCount >= 3) return 0.9;
  return Math.min(0.95, 0.5 + (matchCount * 0.15));
}

export class RobustIntentClassifier {
  classify(text: string): IntentResult {
    const startTime = Date.now();
    const result = classifyIntent(text);
    const duration = Date.now() - startTime;
    
    console.log(
      `[RobustIntentClassifier] Classified in ${duration}ms: ` +
      `intent=${result.intent}, subIntent=${result.subIntent || "none"}, ` +
      `confidence=${result.confidence.toFixed(2)}, ` +
      `keywords=[${result.matchedKeywords.slice(0, 3).join(", ")}]`
    );
    
    return result;
  }
}
