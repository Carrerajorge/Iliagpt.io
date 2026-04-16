/**
 * Unified Prompt Analyzer — IliaGPT
 *
 * A single, comprehensive prompt analysis engine that replaces fragmented
 * intent detection.  Uses a RULE-BASED classifier first (< 5 ms, zero LLM),
 * and only escalates to LLM if rule-based confidence falls below 0.6.
 *
 * Usage:
 *   import { analyzePrompt } from "./promptAnalyzer";
 *   const analysis = analyzePrompt("hazme una presentación sobre IA");
 *   // → { primaryIntent: 'create', deliverable: 'presentation', ... }
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type PrimaryIntent =
  | "create"
  | "analyze"
  | "explain"
  | "fix"
  | "search"
  | "chat"
  | "translate"
  | "summarize"
  | "compare"
  | "visualize"
  | "calculate";

export type DeliverableType =
  | "text"
  | "document"
  | "presentation"
  | "spreadsheet"
  | "pdf"
  | "code"
  | "image"
  | "chart"
  | "diagram"
  | "table"
  | "none";

export type DeliverableFormat =
  | "pptx"
  | "docx"
  | "xlsx"
  | "pdf"
  | "html"
  | "svg"
  | "markdown"
  | "json"
  | "none";

export type DocumentAction =
  | "read"
  | "edit"
  | "convert"
  | "analyze"
  | "summarize"
  | "fill"
  | "none";

export type Tone =
  | "formal"
  | "casual"
  | "academic"
  | "business"
  | "creative";

export type Language = "es" | "en" | "fr" | "pt" | "other";

export type Complexity = "simple" | "medium" | "complex";

export interface PromptAnalysis {
  primaryIntent: PrimaryIntent;
  deliverable: DeliverableType;
  deliverableFormat: DeliverableFormat;
  topic: string;
  constraints: string[];        // e.g. "con tablas", "en inglés", "5 slides"
  tone: Tone;
  language: Language;
  complexity: Complexity;
  hasDocumentReference: boolean;
  documentAction: DocumentAction;
  requiresExternalData: boolean;
  requiresVisualization: boolean;
  confidence: number;           // 0–1
  _debug?: {
    method: "rule" | "llm";
    matchedPatterns: string[];
  };
}

// ── Keyword Dictionaries ──────────────────────────────────────────────────────

// Primary intent keywords
const CREATE_WORDS_ES = [
  "hazme", "haz", "crea", "crea un", "genera", "genera un", "escribe", "redacta",
  "elabora", "construye", "diseña", "diseña un", "prepara", "arma", "haz una",
  "necesito", "quiero", "dame", "genera una", "hace falta", "producir",
];
const CREATE_WORDS_EN = [
  "make", "create", "generate", "write", "build", "produce", "give me", "i need",
  "draft", "compose", "design", "prepare", "construct", "develop",
];

const ANALYZE_WORDS_ES = [
  "analiza", "analizar", "examina", "examinar", "estudia", "estudiar", "revisa",
  "evalúa", "evaluar", "investiga", "investigar", "inspecciona", "audita",
  "identifica problemas", "qué hay en", "qué contiene", "extrae",
];
const ANALYZE_WORDS_EN = [
  "analyze", "analyse", "examine", "study", "review", "evaluate", "investigate",
  "inspect", "audit", "identify problems", "what is in", "what does it contain",
  "extract",
];

const EXPLAIN_WORDS_ES = [
  "explícame", "explica", "qué es", "cuál es", "cómo funciona", "qué significa",
  "describe", "cuéntame", "háblame de", "qué son", "qué hace", "cómo se hace",
];
const EXPLAIN_WORDS_EN = [
  "explain", "what is", "what are", "how does", "what does", "describe",
  "tell me about", "define", "how do", "what is the meaning",
];

const FIX_WORDS_ES = [
  "corrige", "corrígeme", "arregla", "soluciona", "repara", "depura", "debuguea",
  "encuentra el error", "errores", "bug", "falla", "problemas con",
];
const FIX_WORDS_EN = [
  "fix", "correct", "repair", "debug", "solve", "resolve", "find the bug",
  "errors in", "bugs in", "issues with",
];

const TRANSLATE_WORDS_ES = [
  "traduce", "traducir", "tradúceme", "pasa al inglés", "pasa al español",
  "versión en inglés", "versión en español",
];
const TRANSLATE_WORDS_EN = [
  "translate", "translation", "convert to english", "convert to spanish",
  "in english", "in spanish",
];

const SUMMARIZE_WORDS_ES = [
  "resume", "resumen", "resumir", "sintetiza", "síntesis", "puntos clave",
  "extracto", "breve descripción", "en pocas palabras",
];
const SUMMARIZE_WORDS_EN = [
  "summarize", "summary", "summarise", "key points", "tldr", "brief", "overview",
  "in short",
];

const COMPARE_WORDS_ES = [
  "compara", "comparar", "diferencias", "similitudes", "vs", "versus",
  "cuál es mejor", "diferencia entre", "ventajas y desventajas",
];
const COMPARE_WORDS_EN = [
  "compare", "comparison", "differences", "similarities", "versus", "vs",
  "which is better", "pros and cons", "advantages and disadvantages",
];

const VISUALIZE_WORDS_ES = [
  "grafica", "grafíca", "graficar", "dibuja", "muestra", "visualiza", "plotea",
  "crea un gráfico", "traza", "diagrama",
];
const VISUALIZE_WORDS_EN = [
  "plot", "graph", "chart", "visualize", "draw", "show", "display",
  "render", "diagram",
];

const CALCULATE_WORDS_ES = [
  "calcula", "calcular", "cuánto es", "cuánto son", "resultado de", "computa",
  "matemáticas", "ecuación", "fórmula",
];
const CALCULATE_WORDS_EN = [
  "calculate", "compute", "how much is", "result of", "solve", "math",
  "equation", "formula",
];

const SEARCH_WORDS_ES = [
  "busca", "encuentra", "búscame", "halla", "localiza", "dónde está",
];
const SEARCH_WORDS_EN = [
  "search", "find", "look for", "locate", "where is",
];

// Deliverable keywords
const PRESENTATION_WORDS_ES = [
  "presentación", "presentaciones", "slides", "diapositivas", "powerpoint",
  "pptx", "ppt", "slideshow",
];
const PRESENTATION_WORDS_EN = [
  "presentation", "slides", "powerpoint", "pptx", "ppt", "slideshow",
  "slide deck", "deck",
];

const DOCUMENT_WORDS_ES = [
  "documento", "word", "docx", "reporte", "informe", "carta",
  "artículo", "ensayo", "memo", "memorando",
];
const DOCUMENT_WORDS_EN = [
  "document", "word", "docx", "report", "letter", "article", "essay",
  "memo", "memorandum", "doc",
];

const SPREADSHEET_WORDS_ES = [
  "excel", "xlsx", "hoja de cálculo", "spreadsheet", "planilla",
  "hoja de datos",
];
const SPREADSHEET_WORDS_EN = [
  "excel", "xlsx", "spreadsheet", "workbook", "worksheet",
];

const PDF_WORDS_ES = ["pdf", "en pdf", "formato pdf", "archivo pdf"];
const PDF_WORDS_EN = ["pdf", "in pdf", "pdf format", "pdf file"];

const CODE_WORDS_ES = [
  "código", "programa", "función", "script", "app", "aplicación",
  "componente", "módulo", "clase", "api", "endpoint",
];
const CODE_WORDS_EN = [
  "code", "program", "function", "script", "app", "application",
  "component", "module", "class", "api", "endpoint",
];

const CHART_WORDS_ES = [
  "gráfico", "gráfica", "chart", "visualización", "plot",
];
const CHART_WORDS_EN = [
  "chart", "graph", "plot", "visualization",
];

const TABLE_WORDS_ES = [
  "tabla", "tablas", "tabla comparativa", "cuadro comparativo", "tabla de datos",
];
const TABLE_WORDS_EN = [
  "table", "tables", "comparison table", "data table", "tabular",
];

const DIAGRAM_WORDS_ES = [
  "diagrama", "flujograma", "organigrama", "mermaid",
];
const DIAGRAM_WORDS_EN = [
  "diagram", "flowchart", "org chart", "mermaid",
];

// Document action keywords
const DOC_READ_WORDS_ES = [
  "lee", "leer", "lee este", "extrae", "extrae de",
];
const DOC_READ_WORDS_EN = [
  "read", "read this", "extract", "extract from",
];

const DOC_EDIT_WORDS_ES = [
  "edita", "modifica", "actualiza", "cambia", "añade",
];
const DOC_EDIT_WORDS_EN = [
  "edit", "modify", "update", "change", "add to",
];

const DOC_CONVERT_WORDS_ES = [
  "convierte", "pasa a", "exporta como", "transforma en",
];
const DOC_CONVERT_WORDS_EN = [
  "convert", "export as", "transform to", "change to",
];

const DOC_ANALYZE_WORDS_ES = [
  "analiza", "examina", "audita",
];
const DOC_ANALYZE_WORDS_EN = [
  "analyze", "analyse", "examine",
];

const DOC_SUMMARIZE_WORDS_ES = [
  "resume", "resumir", "sintetiza",
];
const DOC_SUMMARIZE_WORDS_EN = [
  "summarize", "summarise", "sum up",
];

const DOC_FILL_WORDS_ES = [
  "rellena", "llena", "completa el formulario",
];
const DOC_FILL_WORDS_EN = [
  "fill", "fill out", "complete the form",
];

// Language detection — use whole-word patterns to avoid false positives
// e.g. "crea" is a substring of "create", so we need \b word boundaries
const STRONG_ES_PATTERNS = [
  /\bhazme\b/, /\bhaz\b/, /\bcrea\b/, /\bgenera\b/, /\bexplicame\b/,
  /\banaliza\b/, /\bresume\b/, /\btraduce\b/, /\bgrafica\b/, /\bbusca\b/,
  /\bquiero\b/, /\bnecesito\b/, /\bdame\b/, /\btabla\b/,
  /\bpresentacion\b/, /\bdocumento\b/, /\bdatos\b/, /\bgrafico\b/,
  /\besta\b/, /\bcomo\b/, /\btiene\b/, /\bpero\b/, /\bpara\b/, /\bcon\b/,
];

// Constraint patterns
const CONSTRAINT_PATTERNS_ES: RegExp[] = [
  /con\s+tablas/gi,
  /con\s+gráficos?/gi,
  /con\s+imágenes?/gi,
  /con\s+(\d+)\s+(?:slides?|diapositivas?)/gi,
  /en\s+formato\s+profesional/gi,
  /en\s+inglés/gi,
  /en\s+español/gi,
  /formato\s+\w+/gi,
  /(\d+)\s+(?:páginas?|slides?|diapositivas?)/gi,
  /(?:tono|estilo)\s+\w+/gi,
  /profesional/gi,
  /académico/gi,
  /formal/gi,
  /incluye?\s+\w+/gi,
];
const CONSTRAINT_PATTERNS_EN: RegExp[] = [
  /with\s+tables/gi,
  /with\s+graphs?/gi,
  /with\s+images?/gi,
  /with\s+(\d+)\s+slides?/gi,
  /professional\s+format/gi,
  /in\s+english/gi,
  /in\s+spanish/gi,
  /(\d+)\s+(?:pages?|slides?)/gi,
  /(?:tone|style)\s+\w+/gi,
  /academic/gi,
  /formal/gi,
  /include\s+\w+/gi,
];

// Visualization indicators
const VISUALIZATION_PATTERNS = [
  /y\s*=\s*[a-zA-Z0-9^*/+\-()\.]+/,  // y = f(x)
  /f\(x\)/,
  /\bplot\b/i,
  /\bgraph\b/i,
  /\bgráfic[ao]\b/i,
  /\bchart\b/i,
  /\bdiagram\b/i,
  /\bvisualiz/i,
];

// External data indicators
const EXTERNAL_DATA_PATTERNS_ES = [
  "busca", "encuentra", "investiga", "precio de", "noticias", "actualidad",
  "hoy", "ahora mismo",
];
const EXTERNAL_DATA_PATTERNS_EN = [
  "search", "find", "research", "price of", "news", "current", "today", "right now",
];

// Document reference indicators
const DOC_REFERENCE_WORDS_ES = [
  "este documento", "este archivo", "este pdf", "este word", "este excel",
  "el documento", "el archivo", "el pdf", "la hoja de cálculo",
  "adjunto", "archivo adjunto",
];
const DOC_REFERENCE_WORDS_EN = [
  "this document", "this file", "this pdf", "this word", "this excel",
  "the document", "the file", "the pdf", "the spreadsheet",
  "attached", "the attachment",
];

// ── Helper Utilities ──────────────────────────────────────────────────────────

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove accents
    .trim();
}

function matchesAny(text: string, words: string[]): boolean {
  const n = normalize(text);
  return words.some((w) => {
    const nw = normalize(w);
    // Use word boundary matching for short words (≤6 chars) to avoid false positives
    // e.g. "fotosíntesis" should not match "síntesis" as a whole-word
    if (nw.length <= 8) {
      // Check if it appears as a word or at a word boundary
      const pattern = new RegExp(`(^|\\s|[.,!?;:])${nw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|[.,!?;:]|$)`);
      return pattern.test(n);
    }
    // For longer phrases, substring matching is fine
    return n.includes(nw);
  });
}

function extractTopic(text: string, lang: Language): string {
  // Remove common leading intent verbs and extract the "about" part
  const cleaned = text
    .replace(/^(hazme|haz|crea|genera|escribe|analiza|resume|traduce|grafica|make|create|generate|write|analyze|summarize|translate|plot|graph|explain|explícame|explica)\s+/i, "")
    .replace(/^(una?|un|el|la|los|las|the|a|an)\s+/i, "")
    .replace(/^(presentación|documento|excel|spreadsheet|pdf|gráfico|chart|presentation|graph|report|sobre|about|de|of)\s+/i, "")
    .trim();

  // Cap topic length
  return cleaned.slice(0, 120);
}

function extractConstraints(text: string): string[] {
  const constraints: string[] = [];
  const allPatterns = [...CONSTRAINT_PATTERNS_ES, ...CONSTRAINT_PATTERNS_EN];

  for (const pattern of allPatterns) {
    const match = text.match(pattern);
    if (match) {
      const c = match[0].trim();
      if (!constraints.includes(c)) {
        constraints.push(c);
      }
    }
  }

  return constraints;
}

function detectLanguage(text: string): Language {
  const n = normalize(text);
  // Use whole-word regex matching to avoid false positives (e.g. "crea" ⊂ "create")
  const esScore = STRONG_ES_PATTERNS.filter((p) => p.test(n)).length;
  if (esScore >= 1) return "es";

  // Check common French
  if (/\b(bonjour|merci|creer|faire|generer|analyser|voici|votre)\b/i.test(n)) return "fr";
  // Check Portuguese
  if (/\b(criar|gerar|analisar|resumir|traduzir|este|essa)\b/i.test(n)) return "pt";

  return "en";
}

function detectTone(text: string, lang: Language): Tone {
  const n = normalize(text);
  if (/profes[io]nal|formal|ejecutiv|business|executive/.test(n)) return "business";
  if (/académ[io]c|científic|research|scholarly/.test(n)) return "academic";
  if (/creativ|divertid|fun|playful|creative/.test(n)) return "creative";
  if (/casual|informal|simple|sencill/.test(n)) return "casual";
  return "formal";
}

function detectComplexity(text: string, analysis: Partial<PromptAnalysis>): Complexity {
  const wordCount = text.split(/\s+/).length;
  if (wordCount <= 8 && !analysis.requiresVisualization) return "simple";
  if (
    analysis.deliverable === "presentation" ||
    analysis.deliverable === "spreadsheet" ||
    analysis.requiresExternalData ||
    wordCount > 25
  ) {
    return "complex";
  }
  return "medium";
}

// ── Core Classifier ───────────────────────────────────────────────────────────

/**
 * Rule-based prompt analysis. Returns a PromptAnalysis with confidence ≥ 0.6
 * for clearly worded prompts, or lower for ambiguous ones.
 */
export function analyzePrompt(userMessage: string): PromptAnalysis {
  if (!userMessage || typeof userMessage !== "string") {
    return emptyAnalysis();
  }

  const text = userMessage.trim();
  const n = normalize(text);
  const matched: string[] = [];

  // ── Language ──────────────────────────────────────────────────────────
  const language = detectLanguage(text);

  // ── Pre-detect analyze/extract intent (affects deliverable interpretation) ──
  // When the user says "analyze this document" the document is the INPUT, not the output.
  // We detect these early to avoid treating "document" or "pdf" as the deliverable.
  const isAnalyticIntent =
    matchesAny(text, [...ANALYZE_WORDS_ES, ...ANALYZE_WORDS_EN]) ||
    matchesAny(text, [...SUMMARIZE_WORDS_ES, ...SUMMARIZE_WORDS_EN]) ||
    matchesAny(text, [...DOC_READ_WORDS_ES, ...DOC_READ_WORDS_EN]);

  // ── Deliverable detection (before intent — narrows intent possibilities) ──

  let deliverable: DeliverableType = "none";
  let deliverableFormat: DeliverableFormat = "none";
  let deliverableConfidence = 0;

  if (matchesAny(text, [...PRESENTATION_WORDS_ES, ...PRESENTATION_WORDS_EN])) {
    deliverable = "presentation";
    deliverableFormat = "pptx";
    deliverableConfidence = 0.92;
    matched.push("deliverable:presentation");
  } else if (matchesAny(text, [...SPREADSHEET_WORDS_ES, ...SPREADSHEET_WORDS_EN])) {
    deliverable = "spreadsheet";
    deliverableFormat = "xlsx";
    deliverableConfidence = 0.91;
    matched.push("deliverable:spreadsheet");
  } else if (
    matchesAny(text, [...PDF_WORDS_ES, ...PDF_WORDS_EN]) &&
    !isAnalyticIntent &&
    !matchesAny(text, [...TABLE_WORDS_ES, ...TABLE_WORDS_EN])
  ) {
    // PDF is the OUTPUT only when there's no analyze intent and no table extraction
    deliverable = "pdf";
    deliverableFormat = "pdf";
    deliverableConfidence = 0.90;
    matched.push("deliverable:pdf");
  } else if (
    matchesAny(text, [...DOCUMENT_WORDS_ES, ...DOCUMENT_WORDS_EN]) &&
    !isAnalyticIntent
  ) {
    // "documento" is the OUTPUT only when not in an analytic context
    deliverable = "document";
    deliverableFormat = "docx";
    deliverableConfidence = 0.88;
    matched.push("deliverable:document");
  } else if (matchesAny(text, [...CHART_WORDS_ES, ...CHART_WORDS_EN])) {
    deliverable = "chart";
    deliverableFormat = "html";
    deliverableConfidence = 0.85;
    matched.push("deliverable:chart");
  } else if (matchesAny(text, [...DIAGRAM_WORDS_ES, ...DIAGRAM_WORDS_EN])) {
    deliverable = "diagram";
    deliverableFormat = "html";
    deliverableConfidence = 0.85;
    matched.push("deliverable:diagram");
  } else if (matchesAny(text, [...TABLE_WORDS_ES, ...TABLE_WORDS_EN])) {
    deliverable = "table";
    deliverableFormat = "markdown";
    deliverableConfidence = 0.85;
    matched.push("deliverable:table");
  } else if (matchesAny(text, [...CODE_WORDS_ES, ...CODE_WORDS_EN])) {
    deliverable = "code";
    deliverableFormat = "none";
    deliverableConfidence = 0.80;
    matched.push("deliverable:code");
  }

  // ── Primary Intent ────────────────────────────────────────────────────

  let primaryIntent: PrimaryIntent = "chat";
  let intentConfidence = 0.5;

  // Detect strong CREATE verbs early — used to disambiguate create vs. compare/visualize
  const hasStrongCreateVerb = matchesAny(text, [...CREATE_WORDS_ES, ...CREATE_WORDS_EN]);

  if (matchesAny(text, [...TRANSLATE_WORDS_ES, ...TRANSLATE_WORDS_EN])) {
    primaryIntent = "translate";
    intentConfidence = 0.90;
    if (deliverable === "none") deliverable = "text";
    matched.push("intent:translate");
  } else if (matchesAny(text, [...ANALYZE_WORDS_ES, ...ANALYZE_WORDS_EN])) {
    // Analyze comes BEFORE summarize — "analiza este doc y dame un resumen" → analyze
    primaryIntent = "analyze";
    intentConfidence = 0.88;
    // When analyzing, document/pdf is the INPUT. Keep table deliverable if explicitly requested.
    if (deliverable === "document" || deliverable === "pdf" || deliverable === "none") {
      deliverable = "text";
    }
    matched.push("intent:analyze");
  } else if (matchesAny(text, [...SUMMARIZE_WORDS_ES, ...SUMMARIZE_WORDS_EN])) {
    primaryIntent = "summarize";
    intentConfidence = 0.92;
    if (deliverable === "none") deliverable = "text";
    matched.push("intent:summarize");
  } else if (
    // Only treat as visualize if there's NO stronger deliverable already matched
    // e.g. "PowerPoint with graphs" → create presentation, not visualize
    (matchesAny(text, [...VISUALIZE_WORDS_ES, ...VISUALIZE_WORDS_EN]) ||
      VISUALIZATION_PATTERNS.some((p) => p.test(text))) &&
    deliverable === "none" &&
    !hasStrongCreateVerb
  ) {
    primaryIntent = "visualize";
    intentConfidence = 0.90;
    deliverable = "chart";
    deliverableFormat = "html";
    matched.push("intent:visualize");
  } else if (matchesAny(text, [...CALCULATE_WORDS_ES, ...CALCULATE_WORDS_EN])) {
    primaryIntent = "calculate";
    intentConfidence = 0.88;
    if (deliverable === "none") deliverable = "text";
    matched.push("intent:calculate");
  } else if (matchesAny(text, [...FIX_WORDS_ES, ...FIX_WORDS_EN])) {
    primaryIntent = "fix";
    intentConfidence = 0.90;
    if (deliverable === "none") deliverable = "code";
    matched.push("intent:fix");
  } else if (matchesAny(text, [...EXPLAIN_WORDS_ES, ...EXPLAIN_WORDS_EN])) {
    primaryIntent = "explain";
    intentConfidence = 0.88;
    if (deliverable === "none") deliverable = "text";
    matched.push("intent:explain");
  } else if (matchesAny(text, [...SEARCH_WORDS_ES, ...SEARCH_WORDS_EN])) {
    primaryIntent = "search";
    intentConfidence = 0.82;
    if (deliverable === "none") deliverable = "text";
    matched.push("intent:search");
  } else if (
    // Visualize when deliverable is chart/diagram even without explicit visualize verb
    // This handles cases like "grafica y = x²" which sets deliverable=chart then hits create
    deliverable === "chart" || deliverable === "diagram"
  ) {
    primaryIntent = "visualize";
    intentConfidence = 0.88;
    matched.push("intent:visualize(from deliverable)");
  } else if (hasStrongCreateVerb || (deliverable !== "none" && deliverable !== "chart" && deliverable !== "diagram")) {
    // "haz una tabla comparativa" → create (even though "comparativa" could match compare)
    // "Make me a PowerPoint" → create (deliverable already set)
    primaryIntent = "create";
    intentConfidence = 0.90;
    if (deliverable === "none") deliverable = "text";
    // Handle compare intent as a sub-type of create when there's a create verb
    // e.g. "haz una tabla comparativa" → create table, not compare
    matched.push("intent:create");
  } else if (matchesAny(text, [...COMPARE_WORDS_ES, ...COMPARE_WORDS_EN])) {
    primaryIntent = "compare";
    intentConfidence = 0.82;
    if (deliverable === "none") {
      deliverable = "table";
      deliverableFormat = "markdown";
    }
    matched.push("intent:compare");
  } else {
    // Fallback: chat
    primaryIntent = "chat";
    intentConfidence = 0.5;
  }

  // ── Document reference + action ───────────────────────────────────────

  const hasDocumentReference =
    matchesAny(text, [...DOC_REFERENCE_WORDS_ES, ...DOC_REFERENCE_WORDS_EN]);

  let documentAction: DocumentAction = "none";
  if (hasDocumentReference || primaryIntent === "analyze" || primaryIntent === "summarize") {
    if (matchesAny(text, [...DOC_CONVERT_WORDS_ES, ...DOC_CONVERT_WORDS_EN])) {
      documentAction = "convert";
      matched.push("docAction:convert");
    } else if (matchesAny(text, [...DOC_ANALYZE_WORDS_ES, ...DOC_ANALYZE_WORDS_EN])) {
      documentAction = "analyze";
      matched.push("docAction:analyze");
    } else if (matchesAny(text, [...DOC_SUMMARIZE_WORDS_ES, ...DOC_SUMMARIZE_WORDS_EN])) {
      documentAction = "summarize";
      matched.push("docAction:summarize");
    } else if (matchesAny(text, [...DOC_EDIT_WORDS_ES, ...DOC_EDIT_WORDS_EN])) {
      documentAction = "edit";
      matched.push("docAction:edit");
    } else if (matchesAny(text, [...DOC_FILL_WORDS_ES, ...DOC_FILL_WORDS_EN])) {
      documentAction = "fill";
      matched.push("docAction:fill");
    } else if (matchesAny(text, [...DOC_READ_WORDS_ES, ...DOC_READ_WORDS_EN]) ||
      primaryIntent === "analyze") {
      documentAction = "read";
      matched.push("docAction:read");
    }
  }

  // Fix: if we're converting to PDF, set deliverable properly
  if (documentAction === "convert" && matchesAny(text, [...PDF_WORDS_ES, ...PDF_WORDS_EN])) {
    deliverable = "pdf";
    deliverableFormat = "pdf";
    matched.push("deliverable:pdf(converted)");
  }

  // ── Flags ─────────────────────────────────────────────────────────────

  const requiresVisualization =
    deliverable === "chart" ||
    deliverable === "diagram" ||
    primaryIntent === "visualize" ||
    VISUALIZATION_PATTERNS.some((p) => p.test(text));

  const requiresExternalData =
    matchesAny(text, [...EXTERNAL_DATA_PATTERNS_ES, ...EXTERNAL_DATA_PATTERNS_EN]);

  // ── Constraints ───────────────────────────────────────────────────────

  const constraints = extractConstraints(text);

  // ── Topic ─────────────────────────────────────────────────────────────

  const topic = extractTopic(text, language);

  // ── Tone ──────────────────────────────────────────────────────────────

  const tone = detectTone(text, language);

  // ── Complexity ────────────────────────────────────────────────────────

  const partialAnalysis: Partial<PromptAnalysis> = {
    deliverable,
    requiresVisualization,
    requiresExternalData,
  };
  const complexity = detectComplexity(text, partialAnalysis);

  // ── Overall Confidence ────────────────────────────────────────────────

  // Compute overall confidence:
  // - If we detected a deliverable: average of intent and deliverable confidences
  // - If intent-only (no deliverable format): use intent confidence directly (with small penalty)
  // - Bonus for multiple matches (more signals = more confidence)
  const baseConf = deliverableConfidence > 0
    ? (intentConfidence * 0.5 + deliverableConfidence * 0.5)
    : intentConfidence * 0.9;  // 0.9 rather than 0.8 to keep clear intents above 0.8

  const confidence = Math.min(
    0.99,
    baseConf + (matched.length > 2 ? 0.05 : 0)
  );

  // ── Deliverable format cleanup ────────────────────────────────────────

  // If deliverable is text (no format), keep format as none
  if (deliverable === "text" || deliverable === "none") {
    if (deliverableFormat === "none") {
      // OK
    }
  }

  return {
    primaryIntent,
    deliverable,
    deliverableFormat,
    topic,
    constraints,
    tone,
    language,
    complexity,
    hasDocumentReference,
    documentAction,
    requiresExternalData,
    requiresVisualization,
    confidence,
    _debug: {
      method: "rule",
      matchedPatterns: matched,
    },
  };
}

// ── Action Router ─────────────────────────────────────────────────────────────

/**
 * Maps a PromptAnalysis to a handler pipeline name.
 *
 * Handler names correspond to the handlers registered in actionExecutor.ts
 */
export type ActionPipeline =
  | "pptx_generator"
  | "docx_generator"
  | "xlsx_generator"
  | "pdf_generator"
  | "visualization_pipeline"
  | "code_generation"
  | "document_analysis"
  | "standard_llm";

export function resolveActionPipeline(analysis: PromptAnalysis): ActionPipeline {
  const { primaryIntent, deliverable, documentAction } = analysis;

  if (deliverable === "presentation") return "pptx_generator";
  if (deliverable === "document") return "docx_generator";
  if (deliverable === "spreadsheet") return "xlsx_generator";
  if (deliverable === "pdf") return "pdf_generator";
  if (deliverable === "chart" || deliverable === "diagram" || primaryIntent === "visualize") {
    return "visualization_pipeline";
  }
  if (deliverable === "code" || primaryIntent === "fix") return "code_generation";
  if (
    documentAction === "analyze" ||
    documentAction === "read" ||
    documentAction === "summarize" ||
    primaryIntent === "analyze"
  ) {
    return "document_analysis";
  }
  return "standard_llm";
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function emptyAnalysis(): PromptAnalysis {
  return {
    primaryIntent: "chat",
    deliverable: "none",
    deliverableFormat: "none",
    topic: "",
    constraints: [],
    tone: "formal",
    language: "en",
    complexity: "simple",
    hasDocumentReference: false,
    documentAction: "none",
    requiresExternalData: false,
    requiresVisualization: false,
    confidence: 0.1,
    _debug: { method: "rule", matchedPatterns: [] },
  };
}

/**
 * Build a system prompt snippet that informs the LLM about the detected
 * deliverable and its role in the current request.
 */
export function buildAnalysisSystemPromptSnippet(analysis: PromptAnalysis): string {
  const lines: string[] = [];

  if (analysis.deliverable !== "none" && analysis.deliverable !== "text") {
    const formatMap: Record<DeliverableFormat, string> = {
      pptx: "PowerPoint (.pptx)",
      docx: "Word (.docx)",
      xlsx: "Excel (.xlsx)",
      pdf: "PDF (.pdf)",
      html: "HTML",
      svg: "SVG",
      markdown: "Markdown",
      json: "JSON",
      none: "text",
    };
    const fmt = formatMap[analysis.deliverableFormat] || analysis.deliverableFormat;
    lines.push(
      `[SYSTEM NOTE] The user wants a ${analysis.deliverable} in ${fmt} format.`,
      `The system will generate the file automatically.`,
      `Your job is to plan the content structure and provide it in the requested format.`,
    );
  }

  if (analysis.documentAction !== "none" && analysis.hasDocumentReference) {
    lines.push(`[SYSTEM NOTE] The user is referencing an uploaded document. Action: ${analysis.documentAction}.`);
  }

  if (analysis.constraints.length > 0) {
    lines.push(`[CONSTRAINTS] ${analysis.constraints.join(", ")}`);
  }

  return lines.join("\n");
}

export default { analyzePrompt, resolveActionPipeline, buildAnalysisSystemPromptSnippet };
