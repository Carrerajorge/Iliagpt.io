export interface SuperAgentDetectionResult {
  use: boolean;
  reason?: string;
  suggestedSources?: number;
}

const RESEARCH_PATTERNS_ES = [
  /dame\s+(\d+)\s+fuentes?/i,
  /busca\s+(\d+)\s+fuentes?/i,
  /con\s+(\d+)\s+fuentes?/i,
  /recopila\s+(\d+)\s+fuentes?/i,
  /encuentra\s+(\d+)\s+fuentes?/i,
  /quiero\s+(\d+)\s+fuentes?/i,
  /necesito\s+(\d+)\s+fuentes?/i,
  /investiga\s+(?:sobre|acerca\s+de)?\s*(.+?)\s+(?:con|usando|de)\s+(\d+)\s+fuentes?/i,
];

const RESEARCH_PATTERNS_EN = [
  /give\s+me\s+(\d+)\s+sources?/i,
  /find\s+(\d+)\s+sources?/i,
  /with\s+(\d+)\s+sources?/i,
  /get\s+(\d+)\s+sources?/i,
  /collect\s+(\d+)\s+sources?/i,
  /gather\s+(\d+)\s+sources?/i,
  /research\s+(?:about|on)?\s*(.+?)\s+(?:with|using)\s+(\d+)\s+sources?/i,
  /i\s+(?:want|need)\s+(\d+)\s+sources?/i,
];

const RESEARCH_KEYWORDS_ES = [
  "investiga",
  "investigar",
  "investigación",
  "busca información",
  "buscar información",
  "recopila información",
  "recopilar información",
  "dame un informe",
  "haz un informe",
  "genera un reporte",
  "análisis profundo",
  "analiza en profundidad",
  "fuentes web",
  "fuentes de internet",
  "fuentes académicas",
  "referencias web",
  "multiple fuentes",
  "muchas fuentes",
  "varias fuentes",
  "super agente",
  "superagente",
  "modo investigación",
  "artículos científicos",
  "articulos cientificos",
  "papers científicos",
  "papers cientificos",
  "artículos académicos",
  "articulos academicos",
  "literatura científica",
  "revisión sistemática",
  "revision sistematica",
  "scopus",
  "web of science",
  "wos",
];

const RESEARCH_KEYWORDS_EN = [
  "research",
  "investigate",
  "investigation",
  "find information",
  "search for information",
  "collect information",
  "gather information",
  "give me a report",
  "create a report",
  "generate a report",
  "deep analysis",
  "in-depth analysis",
  "web sources",
  "internet sources",
  "academic sources",
  "web references",
  "multiple sources",
  "many sources",
  "several sources",
  "super agent",
  "superagent",
  "research mode",
];

const SOURCE_COUNT_PATTERN = /(\d+)\s*(?:fuentes?|sources?)/i;

// Patterns that indicate browser automation — these should NOT go through SuperAgent
const WEB_AUTOMATION_PATTERNS = [
  /\b(navega|navigate|abre|open|visita|visit)\b.*\b(a|to|hacia)\b/i,
  /\b(navega|navigate|abre|open|visita|visit|ve a|ir a|entra|ingresa|accede|go to)\b.*\b(\.com|\.pe|\.org|\.net|\.io|www\.)\b/i,
  /\b(navega|navigate|abre|open|visita|visit|ve a|ir a|entra|ingresa|accede|go to)\b.*\b(google|youtube|amazon|facebook|twitter|instagram|linkedin|wikipedia|mercadolibre|mesa247)\b/i,
  /\b(reserva|book|booking)\b.*\b(restaurante|restaurant|hotel|vuelo|flight|mesa|table)\b/i,
  /\b(usa|use|controla|control)\b.*\b(navegador|browser|chromium|chrome)\b/i,
  /\b(busca|search|encuentra|find)\b.*\b(en|on|in)\b.*\b(\.com|\.pe|\.org|google|youtube|amazon)\b/i,
];

export function shouldUseSuperAgent(prompt: string): SuperAgentDetectionResult {
  return { use: false };

  if (!prompt || typeof prompt !== "string") {
    return { use: false };
  }

  const normalizedPrompt = prompt.toLowerCase().trim();

  // Skip SuperAgent for web automation commands — these go through browser agent
  for (const pattern of WEB_AUTOMATION_PATTERNS) {
    if (pattern.test(prompt)) {
      return { use: false };
    }
  }

  for (const pattern of [...RESEARCH_PATTERNS_ES, ...RESEARCH_PATTERNS_EN]) {
    const match = prompt.match(pattern);
    if (match) {
      const numberMatch = match.find(m => /^\d+$/.test(m));
      const suggestedSources = numberMatch ? parseInt(numberMatch, 10) : undefined;
      
      if (suggestedSources && suggestedSources >= 5) {
        return {
          use: true,
          reason: `Detected request for ${suggestedSources} sources`,
          suggestedSources,
        };
      }
    }
  }

  const sourceMatch = prompt.match(SOURCE_COUNT_PATTERN);
  if (sourceMatch) {
    const count = parseInt(sourceMatch[1], 10);
    if (count >= 10) {
      return {
        use: true,
        reason: `Detected request for ${count} sources`,
        suggestedSources: count,
      };
    }
  }

  for (const keyword of RESEARCH_KEYWORDS_ES) {
    if (normalizedPrompt.includes(keyword.toLowerCase())) {
      const sourceMatch = prompt.match(SOURCE_COUNT_PATTERN);
      const suggestedSources = sourceMatch ? parseInt(sourceMatch[1], 10) : undefined;
      
      return {
        use: true,
        reason: `Research keyword detected: "${keyword}"`,
        suggestedSources: suggestedSources && suggestedSources >= 5 ? suggestedSources : undefined,
      };
    }
  }

  for (const keyword of RESEARCH_KEYWORDS_EN) {
    if (normalizedPrompt.includes(keyword.toLowerCase())) {
      const sourceMatch = prompt.match(SOURCE_COUNT_PATTERN);
      const suggestedSources = sourceMatch ? parseInt(sourceMatch[1], 10) : undefined;
      
      return {
        use: true,
        reason: `Research keyword detected: "${keyword}"`,
        suggestedSources: suggestedSources && suggestedSources >= 5 ? suggestedSources : undefined,
      };
    }
  }

  return { use: false };
}

export function extractSourcesCount(prompt: string): number | null {
  const match = prompt.match(SOURCE_COUNT_PATTERN);
  if (match) {
    const count = parseInt(match[1], 10);
    return count >= 1 ? count : null;
  }
  return null;
}
