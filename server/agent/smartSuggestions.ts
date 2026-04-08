/**
 * Smart follow-up suggestions based on AI response content and conversation context.
 * Replaces generic suggestions with contextual ones derived from response type,
 * artifact presence, detected topics, and locale.
 */
export interface SuggestionContext {
  aiResponse: string;
  userMessage: string;
  intent: string;
  hasArtifact: boolean;
  artifactType?: "word" | "excel" | "ppt" | "pdf";
  conversationLength: number;
  locale: string; // "es" | "en"
}

export type ResponseType = "code" | "data" | "informational" | "artifact" | "greeting" | "general";

const CODE_RE = /```[\s\S]{4,}```|`[^`\n]{8,}`|\b(?:function|const|let|var|class|import|export|def|return)\s/im;
const DATA_RE = /\b\d[\d,.]+%|\$\s?\d|€\s?\d|\d+\s*(?:USD|EUR|COP|MXN)|\b\d{2,}(?:\.\d+)?\b.*\b\d{2,}(?:\.\d+)?\b/m;
const GREETING_RE = /^(?:hola|hi|hello|hey|buenos?\s+d[ií]as?|buenas?\s+(?:tardes?|noches?)|saludos|what'?s up)[!.,]?\s*$/i;
const SOURCE_RE = /\[\d+\]|(?:fuente|source|referencia|reference|seg[uú]n|according to)\b/i;
const STOP = new Set([
  "el","la","los","las","un","una","de","del","en","y","o","a","al","es","son",
  "que","por","para","con","se","su","lo","como","the","an","is","are","of","in",
  "and","or","to","for","it","on","at","by","this","that","with","be","was","has","have",
]);

/** Extract main topic: first 3 significant words from text. */
export function extractMainTopic(text: string): string {
  const sobreMatch = text.match(/\b(?:sobre|about)\s+(.+?)(?:[.,;:!?]|$)/i);
  const source = sobreMatch ? sobreMatch[1] : text;
  const words = source
    .replace(/```[\s\S]*?```/g, "").replace(/[*_~`>#\[\](){}]/g, "")
    .replace(/https?:\/\/\S+/g, "").split(/\s+/)
    .map((w) => w.replace(/^[^a-zA-Z\u00C0-\u024F]+|[^a-zA-Z\u00C0-\u024F]+$/g, ""))
    .filter((w) => w.length > 2 && !STOP.has(w.toLowerCase()));
  return words.slice(0, 3).join(" ") || "este tema";
}

export function detectResponseType(text: string): ResponseType {
  const t = text.trim();
  if (GREETING_RE.test(t) || t.length < 60) return "greeting";
  if (CODE_RE.test(t)) return "code";
  if (DATA_RE.test(t)) return "data";
  return "informational";
}

// -- Suggestion pools per locale ------------------------------------------

type Pool = {
  artifact: (type?: string) => string[];
  code: string[]; data: string[]; greeting: string[]; sources: string[];
  info: (topic: string) => string[];
};

const ES: Pool = {
  artifact(type?: string) {
    const s: string[] = [];
    if (type !== "word") s.push("Convierte esto a documento Word");
    if (type !== "excel") s.push("Exporta esto a Excel");
    if (type !== "ppt") s.push("Convierte esto a presentacion PowerPoint");
    if (type !== "pdf") s.push("Genera un PDF con este contenido");
    s.push("Agrega mas secciones al documento", "Crea una version en ingles");
    return s;
  },
  code: ["Ejecuta este codigo", "Explica este codigo paso a paso", "Agrega manejo de errores", "Crea tests unitarios para esto"],
  data: ["Crea un grafico con estos datos", "Exporta esto a Excel", "Analiza las tendencias", "Compara con el periodo anterior"],
  info: (topic) => [`Profundiza en ${topic}`, "Dame ejemplos practicos", "Cuales son las limitaciones", "Resume en 3 puntos clave"],
  greeting: ["Que puedes hacer", "Crea un documento", "Busca informacion sobre...", "Ayudame con codigo"],
  sources: ["Busca mas fuentes sobre esto", "Que tan confiable es esta informacion", "Compara con otras perspectivas", "Verifica si hubo cambios recientes"],
};

const EN: Pool = {
  artifact(type?: string) {
    const s: string[] = [];
    if (type !== "word") s.push("Convert this to a Word document");
    if (type !== "excel") s.push("Export this to Excel");
    if (type !== "ppt") s.push("Turn this into a PowerPoint presentation");
    if (type !== "pdf") s.push("Generate a PDF with this content");
    s.push("Add more sections to the document", "Create a Spanish version");
    return s;
  },
  code: ["Run this code", "Explain this code step by step", "Add error handling", "Create unit tests for this"],
  data: ["Create a chart with this data", "Export this to Excel", "Analyze the trends", "Compare with the previous period"],
  info: (topic) => [`Go deeper into ${topic}`, "Give me practical examples", "What are the limitations", "Summarize in 3 key points"],
  greeting: ["What can you do", "Create a document", "Search for information about...", "Help me with code"],
  sources: ["Find more sources on this", "How reliable is this information", "Compare with other perspectives", "Check if there were recent changes"],
};

const POOLS: Record<string, Pool> = { es: ES, en: EN };

// -- Main entry point -----------------------------------------------------

export function generateSmartSuggestions(ctx: SuggestionContext): string[] {
  const pool = POOLS[ctx.locale] ?? ES;
  const n = 4;

  // 1. Artifact generated — highest priority
  if (ctx.hasArtifact) return pool.artifact(ctx.artifactType).slice(0, n);

  const rtype = detectResponseType(ctx.aiResponse);

  // 2. Greeting / very short response
  if (rtype === "greeting") return pool.greeting.slice(0, n);
  // 3. Sources / references detected
  if (SOURCE_RE.test(ctx.aiResponse)) return pool.sources.slice(0, n);
  // 4. Code
  if (rtype === "code") return pool.code.slice(0, n);
  // 5. Data / numbers
  if (rtype === "data") return pool.data.slice(0, n);
  // 6. Informational (default)
  return pool.info(extractMainTopic(ctx.aiResponse)).slice(0, n);
}
