import { z } from "zod";

export interface ResearchDecision {
  shouldResearch: boolean;
  reason: string;
  minSources: number;
  searchQueries: string[];
  researchType: "signals" | "deep" | "both" | "none";
}

const RESEARCH_TRIGGERS = [
  /\b(fuentes?|sources?|referencias?|references?)\b/i,
  /\b(cifras?|números?|estadísticas?|datos?|data|figures?|numbers?|statistics?)\b/i,
  /\b(últimos?|recientes?|actuales?|latest|recent|current)\b/i,
  /\b(comparar|comparación|versus|vs\.?|compare|comparison)\b/i,
  /\b(verificar|validar|confirmar|comprobar|verify|validate|confirm)\b/i,
  /\b(mercados?|markets?|precios?|prices?|cotización|quote)\b/i,
  /\b(leyes?|laws?|regulación|regulations?|normativa|legal)\b/i,
  /\b(investigar?|research|buscar?|search|encontrar|find)\b/i,
  /\b(cuánto|cuántos|cuántas|how much|how many)\b/i,
  /\b(qué es|what is|quién es|who is|dónde|where)\b/i,
  /\b(historia|history|origen|origin|evolución|evolution)\b/i,
  /\b(noticias?|news|actualidad|current events)\b/i,
  /\b(análisis|analysis|estudio|study|informe|report)\b/i,
  /\b(\d+\s*(fuentes?|sources?|referencias?))\b/i,
  /\b(mínimo|mínimas?|at least|minimum)\s*\d+/i,
  /\b(artículos?|articulos?|papers?)\s*(científicos?|cientificos?|académicos?|academicos?)?\b/i,
  /\b(scopus|web of science|wos|pubmed|scholar)\b/i,
  /\b(revisión sistemática|revision sistematica|systematic review)\b/i,
  /\b(literatura científica|scientific literature)\b/i,
  /\b(\d+)\s*(artículos?|articulos?|papers?)\b/i,
];

const EXTERNAL_DATA_TRIGGERS = [
  /\b(excel|xlsx|spreadsheet|hoja de cálculo)\b/i,
  /\b(word|docx|documento|document)\b/i,
  /\b(con datos|with data|incluir datos|include data)\b/i,
  /\b(tabla|table|gráfico|chart|graph)\b/i,
];

const NO_RESEARCH_PATTERNS = [
  /^(hola|hello|hi|hey|buenos días|buenas tardes)\s*[.!?]?$/i,
  /^(gracias|thanks|thank you)\s*[.!?]?$/i,
  /^(ok|okay|bien|entendido|understood)\s*[.!?]?$/i,
  /\b(formatea|format|estiliza|style|mejora el texto|improve text)\b/i,
  /\b(solo|only|únicamente)\s*(formato|format|estilo|style)\b/i,
];

const SOURCE_COUNT_PATTERN = /(\d+)\s*(fuentes?|sources?|referencias?|references?|artículos?|articulos?|papers?)/i;
const MIN_PATTERN = /mínimo\s*(\d+)|at least\s*(\d+)|minimum\s*(\d+)/i;

export function extractSourceRequirement(prompt: string): number {
  const sourceMatch = prompt.match(SOURCE_COUNT_PATTERN);
  if (sourceMatch) {
    return parseInt(sourceMatch[1], 10);
  }
  
  const minMatch = prompt.match(MIN_PATTERN);
  if (minMatch) {
    const num = minMatch[1] || minMatch[2] || minMatch[3];
    return parseInt(num, 10);
  }
  
  return 0;
}

export function extractSearchQueries(prompt: string): string[] {
  const queries: string[] = [];
  
  const quotedMatches = prompt.match(/"([^"]+)"|'([^']+)'/g);
  if (quotedMatches) {
    quotedMatches.forEach(match => {
      queries.push(match.replace(/['"]/g, ''));
    });
  }
  
  const aboutPattern = /(?:sobre|about|acerca de|regarding)\s+([^,.!?]+)/gi;
  let match;
  while ((match = aboutPattern.exec(prompt)) !== null) {
    let extracted = match[1]
      .replace(/\s*(con|with)\s*\d+\s*(fuentes?|sources?|referencias?|artículos?|articulos?|papers?).*$/i, '')
      .replace(/\s+(y|and)\s+(crea|genera|create|generate|coloca|pon).*$/i, '')
      .replace(/\s+(del|from)\s+\d{4}\s+(al|to|hasta)\s+\d{4}.*$/i, '')
      .replace(/\s+ordenado\s+por.*$/i, '')
      .trim();
    
    const yearMatch = prompt.match(/(?:del|from)\s+(\d{4})\s+(?:al|to|hasta)\s+(\d{4})/i);
    if (yearMatch) {
      extracted = `${extracted} ${yearMatch[1]}-${yearMatch[2]}`;
    }
    
    if (extracted.length > 3) {
      queries.push(extracted);
    }
  }
  
  if (queries.length === 0) {
    const topicPatterns = [
      /(?:investiga|research|busca|search|encuentra|find)\s+(?:el|la|los|las|the)?\s*([^,.!?]+?)(?:\s+(?:y|and)\s+(?:crea|genera|create|generate)|$)/i,
      /(?:dame|give me)\s+(?:información|information|datos|data)\s+(?:sobre|about|de|del)\s+([^,.!?]+)/i,
    ];
    
    for (const pattern of topicPatterns) {
      const topicMatch = prompt.match(pattern);
      if (topicMatch && topicMatch[1]) {
        const topic = topicMatch[1]
          .replace(/\s*\d+\s*(fuentes?|sources?|referencias?).*$/i, '')
          .replace(/\s*(con|with)\s*\d+.*$/i, '')
          .trim();
        if (topic.length > 3) {
          queries.push(topic);
          break;
        }
      }
    }
  }
  
  if (queries.length === 0) {
    const stopWords = new Set([
      "dame", "give", "quiero", "want", "necesito", "need", "crea", "create",
      "genera", "generate", "busca", "search", "investiga", "research",
      "información", "information", "me", "un", "una", "el", "la", "los", "las",
      "de", "del", "y", "and", "fuentes", "sources", "referencias", "mínimo",
      "minimum", "favor", "por", "con", "with", "excel", "word", "documento"
    ]);
    
    let cleaned = prompt
      .replace(/^(dame|give me|quiero|want|necesito|need|crea|create|genera|generate|busca|search|investiga|research)\s+/i, '')
      .replace(/\s+(información|information)\s+(sobre|about|de|del)\s+/gi, ' ')
      .replace(/\s*\d+\s*(fuentes?|sources?|referencias?).*$/i, '')
      .replace(/\s*(con|with)\s*\d+.*$/i, '')
      .replace(/\s+(y|and)\s+(crea|genera|create|generate).*$/i, '')
      .trim();
    
    const words = cleaned.split(/\s+/).filter(word => {
      const lowerWord = word.toLowerCase().replace(/[.,!?:;]/g, "");
      return lowerWord.length > 2 && !stopWords.has(lowerWord);
    });
    
    if (words.length >= 1) {
      queries.push(words.join(" "));
    }
  }
  
  return queries.filter(q => q.length > 2).slice(0, 5);
}

export function shouldResearch(prompt: string): ResearchDecision {
  const promptLower = prompt.toLowerCase().trim();
  
  for (const pattern of NO_RESEARCH_PATTERNS) {
    if (pattern.test(promptLower)) {
      return {
        shouldResearch: false,
        reason: "Prompt is conversational or format-only",
        minSources: 0,
        searchQueries: [],
        researchType: "none",
      };
    }
  }
  
  const explicitSourceCount = extractSourceRequirement(prompt);
  
  let shouldDoResearch = false;
  let reason = "";
  let researchType: ResearchDecision["researchType"] = "none";
  
  for (const pattern of RESEARCH_TRIGGERS) {
    if (pattern.test(prompt)) {
      shouldDoResearch = true;
      reason = `Detected research trigger: ${pattern.source.substring(0, 30)}...`;
      researchType = explicitSourceCount >= 50 ? "both" : "signals";
      break;
    }
  }
  
  if (!shouldDoResearch) {
    for (const pattern of EXTERNAL_DATA_TRIGGERS) {
      if (pattern.test(prompt)) {
        const hasDataRequest = /\b(datos|data|información|information|cifras|figures)\b/i.test(prompt);
        if (hasDataRequest) {
          shouldDoResearch = true;
          reason = "Document creation requires external data";
          researchType = "signals";
        }
        break;
      }
    }
  }
  
  if (prompt.includes("?") && !shouldDoResearch) {
    const questionWords = /\b(qué|quién|cuándo|dónde|cómo|por qué|cuánto|what|who|when|where|how|why)\b/i;
    if (questionWords.test(prompt)) {
      shouldDoResearch = true;
      reason = "Question requires factual answer";
      researchType = "signals";
    }
  }
  
  if (prompt.length > 100 && !shouldDoResearch) {
    const complexityScore = (prompt.match(/\b(y|and|además|also|también|plus|con|with)\b/gi) || []).length;
    if (complexityScore >= 3) {
      shouldDoResearch = true;
      reason = "Complex prompt likely needs context";
      researchType = "signals";
    }
  }
  
  const minSources = explicitSourceCount || (shouldDoResearch ? 10 : 0);
  
  if (minSources >= 50) {
    researchType = "both";
  }
  
  const searchQueries = shouldDoResearch ? extractSearchQueries(prompt) : [];
  
  return {
    shouldResearch: shouldDoResearch,
    reason: reason || "No research triggers detected",
    minSources,
    searchQueries,
    researchType,
  };
}

export const ResearchDecisionSchema = z.object({
  shouldResearch: z.boolean(),
  reason: z.string(),
  minSources: z.number(),
  searchQueries: z.array(z.string()),
  researchType: z.enum(["signals", "deep", "both", "none"]),
});
