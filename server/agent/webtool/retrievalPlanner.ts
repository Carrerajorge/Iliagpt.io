import { z } from "zod";
import { createHash } from "crypto";

export const QueryPlanSchema = z.object({
  originalPrompt: z.string(),
  queries: z.array(z.object({
    query: z.string(),
    type: z.enum(["primary", "keyword", "entity", "recency", "academic"]),
    priority: z.number().min(1).max(10),
    filters: z.object({
      recency: z.enum(["any", "day", "week", "month", "year"]).optional(),
      domain: z.string().optional(),
      language: z.string().optional(),
    }).optional(),
  })),
  entities: z.array(z.string()),
  keywords: z.array(z.string()),
  intent: z.enum(["factual", "comparison", "how_to", "definition", "news", "research"]),
  queryHash: z.string(),
  timestamp: z.number(),
});

export type QueryPlan = z.infer<typeof QueryPlanSchema>;
export type PlannedQuery = QueryPlan["queries"][number];

const STOP_WORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "must", "shall", "can", "need", "dare",
  "ought", "used", "to", "of", "in", "for", "on", "with", "at", "by",
  "from", "as", "into", "through", "during", "before", "after", "above",
  "below", "between", "under", "again", "further", "then", "once",
  "here", "there", "when", "where", "why", "how", "all", "each", "few",
  "more", "most", "other", "some", "such", "no", "nor", "not", "only",
  "own", "same", "so", "than", "too", "very", "just", "also", "now",
  "que", "qué", "como", "cómo", "para", "por", "con", "sin", "sobre",
  "entre", "hasta", "desde", "durante", "según", "hacia", "mediante",
  "cuál", "cuáles", "cual", "cuales", "donde", "dónde", "cuando", "cuándo",
  "quien", "quién", "quienes", "quiénes", "esto", "esta", "este", "estos",
  "estas", "eso", "esa", "ese", "esos", "esas", "aquel", "aquella",
  "aquellos", "aquellas", "uno", "una", "unos", "unas", "el", "la", "los",
  "las", "del", "al", "y", "o", "pero", "porque", "pues", "aunque", "si",
  "son", "ser", "está", "están", "era", "eran", "fue", "fueron",
]);

const RECENCY_PATTERNS = [
  { pattern: /\b(today|hoy|ahora|now|latest|recent|breaking|new)\b/i, recency: "day" as const },
  { pattern: /\b(this week|esta semana|weekly|semanal)\b/i, recency: "week" as const },
  { pattern: /\b(this month|este mes|monthly|mensual)\b/i, recency: "month" as const },
  { pattern: /\b(this year|este año|2024|2025|2026|yearly|anual)\b/i, recency: "year" as const },
];

const INTENT_PATTERNS: { pattern: RegExp; intent: QueryPlan["intent"] }[] = [
  { pattern: /\b(compare|comparison|vs|versus|difference|mejor|peor|comparar|diferencia)\b/i, intent: "comparison" },
  { pattern: /\b(how to|cómo|como hacer|tutorial|guide|step by step|paso a paso)\b/i, intent: "how_to" },
  { pattern: /\b(what is|what are|qué es|que es|define|definition|significa|meaning)\b/i, intent: "definition" },
  { pattern: /\b(news|noticias|breaking|latest|update|actualización)\b/i, intent: "news" },
  { pattern: /\b(research|study|paper|journal|científico|academic|investigación)\b/i, intent: "research" },
];

export class RetrievalPlanner {
  private entityPatterns: RegExp[] = [
    /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g,
    /\b(?:Dr\.|Mr\.|Mrs\.|Ms\.|Prof\.)\s+[A-Z][a-z]+\b/g,
    /\b[A-Z][a-z]{2,}\b/g,
    /\b[A-Z]{2,}\b/g,
    /\b\d{4}\b/g,
    /"([^"]+)"/g,
    /'([^']+)'/g,
  ];

  plan(prompt: string, maxQueries: number = 6): QueryPlan {
    const normalizedPrompt = prompt.trim();
    const entities = this.extractEntities(normalizedPrompt);
    const keywords = this.extractKeywords(normalizedPrompt);
    const intent = this.detectIntent(normalizedPrompt);
    const recency = this.detectRecency(normalizedPrompt);
    
    const queries: PlannedQuery[] = [];
    
    queries.push({
      query: this.optimizeQuery(normalizedPrompt),
      type: "primary",
      priority: 10,
      filters: { recency },
    });
    
    if (keywords.length >= 3) {
      const keywordQuery = keywords.slice(0, 5).join(" ");
      if (keywordQuery !== queries[0].query) {
        queries.push({
          query: keywordQuery,
          type: "keyword",
          priority: 8,
          filters: { recency },
        });
      }
    }
    
    for (const entity of entities.slice(0, 2)) {
      const entityQuery = `${entity} ${keywords.slice(0, 2).join(" ")}`.trim();
      if (!queries.some(q => q.query === entityQuery)) {
        queries.push({
          query: entityQuery,
          type: "entity",
          priority: 7,
          filters: { recency },
        });
      }
    }
    
    if (intent === "news" || recency === "day" || recency === "week") {
      const recencyQuery = `${keywords.slice(0, 3).join(" ")} latest news`;
      if (!queries.some(q => q.query === recencyQuery)) {
        queries.push({
          query: recencyQuery,
          type: "recency",
          priority: 9,
          filters: { recency: recency || "week" },
        });
      }
    }
    
    if (intent === "research" || intent === "factual") {
      const academicQuery = `${keywords.slice(0, 4).join(" ")} research study`;
      if (!queries.some(q => q.query === academicQuery)) {
        queries.push({
          query: academicQuery,
          type: "academic",
          priority: 6,
        });
      }
    }
    
    const finalQueries = queries
      .sort((a, b) => b.priority - a.priority)
      .slice(0, Math.min(maxQueries, 6));
    
    const queryHash = this.generateQueryHash(normalizedPrompt);
    
    return {
      originalPrompt: normalizedPrompt,
      queries: finalQueries,
      entities,
      keywords,
      intent,
      queryHash,
      timestamp: Date.now(),
    };
  }

  private extractEntities(text: string): string[] {
    const entities = new Set<string>();
    
    for (const pattern of this.entityPatterns) {
      const matches = text.match(pattern);
      if (matches) {
        for (const match of matches) {
          const cleaned = match.replace(/["']/g, "").trim();
          if (cleaned.length >= 2 && cleaned.length <= 50) {
            entities.add(cleaned);
          }
        }
      }
    }
    
    return Array.from(entities).slice(0, 10);
  }

  private extractKeywords(text: string): string[] {
    const words = text
      .toLowerCase()
      .replace(/[^\w\sáéíóúüñ]/g, " ")
      .split(/\s+/)
      .filter(word => word.length >= 3 && !STOP_WORDS.has(word));
    
    const frequency = new Map<string, number>();
    for (const word of words) {
      frequency.set(word, (frequency.get(word) || 0) + 1);
    }
    
    return Array.from(frequency.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([word]) => word)
      .slice(0, 10);
  }

  private detectIntent(text: string): QueryPlan["intent"] {
    for (const { pattern, intent } of INTENT_PATTERNS) {
      if (pattern.test(text)) {
        return intent;
      }
    }
    return "factual";
  }

  private detectRecency(text: string): "any" | "day" | "week" | "month" | "year" | undefined {
    for (const { pattern, recency } of RECENCY_PATTERNS) {
      if (pattern.test(text)) {
        return recency;
      }
    }
    return undefined;
  }

  private optimizeQuery(query: string): string {
    let optimized = query
      .replace(/[?!.,;:'"()[\]{}]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    
    if (optimized.length > 150) {
      const words = optimized.split(" ");
      const important = words.filter(w => !STOP_WORDS.has(w.toLowerCase()));
      optimized = important.slice(0, 15).join(" ");
    }
    
    return optimized;
  }

  private generateQueryHash(prompt: string): string {
    const normalized = prompt.toLowerCase().replace(/\s+/g, " ").trim();
    return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
  }
}

export const retrievalPlanner = new RetrievalPlanner();
