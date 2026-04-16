const MAX_FOLLOW_UP_SUGGESTIONS = 4;
const MIN_SUGGESTION_LENGTH = 8;
const MAX_SUGGESTION_LENGTH = 96;

const LIST_ITEM_PATTERN = /^\s*(?:[-*]|\d+\.)\s+(.+)$/m;
const CODE_BLOCK_PATTERN = /```|`[^`\n]+`|(?:^|\s)(?:function|const|let|class|import|export)\s/mi;
const DEBUG_PATTERN = /\b(error|bug|falla|fallo|problema|debug|depur|stack|trace|exception|fix)\b/i;
const RESEARCH_PATTERN = /\b(investig|research|fuente|referencia|compar|analiz|estudi|mercado)\b/i;
const PLANNING_PATTERN = /\b(plan|roadmap|arquitect|implement|fase|milestone|entrega|deploy)\b/i;
const WRITING_PATTERN = /\b(document|doc|word|presentacion|ppt|resumen|informe|proposal|memo)\b/i;
const CITATION_PATTERN = /\[\d+\]/;

export interface FollowUpSuggestionContext {
  assistantContent: string;
  userMessage?: string;
  hasWebSources?: boolean;
}

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncateSuggestion(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function stripMarkdown(value: string): string {
  return compactWhitespace(
    value
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/[*_~`>#]/g, "")
      .replace(/\s*[:;,.!?]+$/, ""),
  );
}

function normalizeSuggestion(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const cleaned = compactWhitespace(
    value
      .replace(/^[\s>*-]+/, "")
      .replace(/^\d+[.)]\s*/, "")
      .replace(/^["'`]+|["'`]+$/g, ""),
  );

  if (cleaned.length < MIN_SUGGESTION_LENGTH) return null;
  return truncateSuggestion(cleaned, MAX_SUGGESTION_LENGTH);
}

function extractFirstListItem(content: string): string | null {
  const match = content.match(LIST_ITEM_PATTERN);
  if (!match?.[1]) return null;
  const cleaned = stripMarkdown(match[1]);
  if (!cleaned) return null;
  return truncateSuggestion(cleaned.replace(/"/g, "'"), 48);
}

function inferIntent(seedText: string): "debug" | "research" | "planning" | "writing" | "generic" {
  if (DEBUG_PATTERN.test(seedText)) return "debug";
  if (RESEARCH_PATTERN.test(seedText)) return "research";
  if (PLANNING_PATTERN.test(seedText)) return "planning";
  if (WRITING_PATTERN.test(seedText)) return "writing";
  return "generic";
}

function getIntentSuggestions(intent: ReturnType<typeof inferIntent>): string[] {
  switch (intent) {
    case "debug":
      return [
        "Dime la causa raiz mas probable",
        "Propone el arreglo minimo",
        "Que pruebas harian falta",
        "Como evitamos regresiones",
      ];
    case "research":
      return [
        "Compara las opciones principales",
        "Resume riesgos y limites",
        "Dame una recomendacion accionable",
        "Que cambiaria si lo llevamos a produccion",
      ];
    case "planning":
      return [
        "Convierte esto en fases ejecutables",
        "Identifica dependencias y bloqueos",
        "Dame criterios de verificacion",
        "Cual seria el primer paso",
      ];
    case "writing":
      return [
        "Hazlo mas ejecutivo",
        "Convierte esto en un documento formal",
        "Extrae acciones concretas",
        "Que faltaria reforzar",
      ];
    default:
      return [
        "Dame un ejemplo aplicado",
        "Resume esto en pasos concretos",
        "Que riesgos o limites ves",
        "Cual seria el siguiente paso",
      ];
  }
}

export function normalizeFollowUpSuggestions(
  input: unknown,
  maxSuggestions: number = MAX_FOLLOW_UP_SUGGESTIONS,
): string[] {
  if (!Array.isArray(input)) return [];

  const seen = new Set<string>();
  const suggestions: string[] = [];

  for (const candidate of input) {
    const normalized = normalizeSuggestion(candidate);
    if (!normalized) continue;

    const dedupeKey = normalized.toLowerCase();
    if (seen.has(dedupeKey)) continue;

    seen.add(dedupeKey);
    suggestions.push(normalized);

    if (suggestions.length >= maxSuggestions) break;
  }

  return suggestions;
}

export function buildFollowUpSuggestions(context: FollowUpSuggestionContext): string[] {
  const assistantContent = compactWhitespace(context.assistantContent || "");
  const userMessage = compactWhitespace(context.userMessage || "");

  if (!assistantContent) return [];

  if (CODE_BLOCK_PATTERN.test(assistantContent)) {
    return normalizeFollowUpSuggestions([
      "Anade pruebas para este cambio",
      "Explica la parte mas critica del codigo",
      "Propone una version mas robusta",
      "Dime como validarlo paso a paso",
    ]);
  }

  if (context.hasWebSources || CITATION_PATTERN.test(assistantContent)) {
    return normalizeFollowUpSuggestions([
      "Compara las fuentes clave",
      "Resume riesgos y limites de esta informacion",
      "Dame una recomendacion accionable",
      "Verifica si hubo cambios recientes",
    ]);
  }

  const firstListItem = extractFirstListItem(assistantContent);
  if (firstListItem) {
    return normalizeFollowUpSuggestions([
      `Profundiza en "${firstListItem}"`,
      "Prioriza estos puntos",
      "Convierte esto en un plan de accion",
      "Que riesgos ves aqui",
    ]);
  }

  const intentSeed = userMessage || assistantContent;
  return normalizeFollowUpSuggestions(getIntentSuggestions(inferIntent(intentSeed)));
}
