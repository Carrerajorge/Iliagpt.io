import { EventEmitter } from "events";
import { ScientificArticle, SearchProgressEvent, ScientificSearchResult, generateAPA7Citation } from "@shared/scientificArticleSchema";
import { createHash } from "crypto";
import { type AcademicResult, searchAllSources } from "./unifiedAcademicSearch";

interface SearchOptions {
  maxResults?: number;
  sources?: string[];
  yearFrom?: number;
  yearTo?: number;
  languages?: string[];
  openAccessOnly?: boolean;
  publicationTypes?: string[];
}

interface SearchContext {
  articles: ScientificArticle[];
  sourceStats: Map<string, { count: number; status: "success" | "error" | "timeout" }>;
  emitter: EventEmitter;
}

const DEFAULT_SCIENTIFIC_SOURCES = [
  "openalex",
  "semantic",
  "crossref",
  "pubmed",
  "arxiv",
  "core",
  "doaj",
  "base",
  "scielo",
] as const;

type ScientificSearchSource = (typeof DEFAULT_SCIENTIFIC_SOURCES)[number];

function normalizeSources(rawSources?: string[]): ScientificSearchSource[] {
  if (!Array.isArray(rawSources) || rawSources.length === 0 || rawSources.includes("all")) {
    return [...DEFAULT_SCIENTIFIC_SOURCES];
  }

  const allowed = new Set<string>(DEFAULT_SCIENTIFIC_SOURCES);
  const normalized = rawSources
    .map((source) => String(source || "").trim().toLowerCase())
    .filter((source): source is ScientificSearchSource => allowed.has(source));

  return normalized.length > 0 ? normalized : [...DEFAULT_SCIENTIFIC_SOURCES];
}

function normalizePublicationType(rawType?: string): ScientificArticle["publicationType"] {
  const value = String(rawType || "").toLowerCase();
  if (!value) return "journal_article";
  if (value.includes("systematic")) return "systematic_review";
  if (value.includes("meta")) return "meta_analysis";
  if (value.includes("random")) return "randomized_controlled_trial";
  if (value.includes("clinical")) return "clinical_trial";
  if (value.includes("review")) return "review";
  if (value.includes("conference")) return "conference_paper";
  if (value.includes("thesis")) return "thesis";
  if (value.includes("preprint")) return "preprint";
  if (value.includes("case report")) return "case_report";
  if (value.includes("case series")) return "case_series";
  if (value.includes("editorial")) return "editorial";
  if (value.includes("letter")) return "letter";
  if (value.includes("comment")) return "comment";
  return "journal_article";
}

function mapAuthors(rawAuthors: string): ScientificArticle["authors"] {
  const parts = String(rawAuthors || "")
    .split(/(?:,|;|\band\b)/i)
    .map((author) => author.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    return [];
  }

  return parts.map((fullName) => {
    const nameParts = fullName.split(/\s+/).filter(Boolean);
    const lastName = nameParts.length > 0 ? nameParts[nameParts.length - 1]! : fullName;
    const firstName = nameParts.length > 1 ? nameParts.slice(0, -1).join(" ") : undefined;
    return {
      firstName,
      lastName,
      fullName,
    };
  });
}

function mapAcademicResult(result: AcademicResult, index: number): ScientificArticle {
  const year = Number.parseInt(result.year || "", 10);
  const safeSource = String(result.source || "manual").toLowerCase();
  const source = ([
    "pubmed",
    "scielo",
    "semantic_scholar",
    "semantic",
    "crossref",
    "openalex",
    "core",
    "arxiv",
    "doaj",
    "base",
    "scopus",
    "scholar",
    "duckduckgo",
    "wos",
    "manual",
  ] as const).includes(safeSource as ScientificArticle["source"])
    ? (safeSource as ScientificArticle["source"])
    : "manual";
  const stableIdSource = result.doi || result.url || `${result.title}:${safeSource}:${index}`;
  const id = createHash("sha1").update(stableIdSource).digest("hex");

  return {
    id,
    source,
    title: result.title,
    authors: mapAuthors(result.authors),
    abstract: result.abstract,
    journal: result.journal ? { title: result.journal } : undefined,
    publicationType: normalizePublicationType(result.documentType),
    year: Number.isFinite(year) ? year : undefined,
    doi: result.doi,
    url: result.url,
    pdfUrl: result.pdfUrl,
    keywords: result.keywords,
    language: result.language,
    citationCount: typeof result.citations === "number" ? result.citations : undefined,
    isOpenAccess: Boolean(result.openAccess || result.pdfUrl),
  };
}

export function createScientificSearchOrchestrator() {
  async function search(
    query: string,
    options: SearchOptions = {},
    onProgress?: (event: SearchProgressEvent) => void
  ): Promise<ScientificSearchResult> {
    const startTime = Date.now();
    const maxResults = options.maxResults || 50;
    const sources = normalizeSources(options.sources);
    
    const ctx: SearchContext = {
      articles: [],
      sourceStats: new Map(),
      emitter: new EventEmitter(),
    };

    if (onProgress) {
      ctx.emitter.on("progress", onProgress);
    }

    emitProgress(ctx, {
      type: "searching",
      source: "Orquestador",
      articlesFound: 0,
      totalArticles: 0,
      message: "🔬 Iniciando búsqueda científica multi-fuente...",
      timestamp: Date.now(),
    });

    const unifiedResult = await searchAllSources(query, {
      maxResults,
      sources,
      yearFrom: options.yearFrom,
      yearTo: options.yearTo,
      language: options.languages?.[0],
      openAccessOnly: options.openAccessOnly,
    });

    ctx.articles = unifiedResult.results.map(mapAcademicResult);

    const uniqueArticles = deduplicateArticles(ctx.articles);
    
    let filteredArticles = applyFilters(uniqueArticles, options);
    
    filteredArticles = sortByRelevance(filteredArticles);
    
    filteredArticles = filteredArticles.slice(0, maxResults);

    const countsBySource = new Map<string, number>();
    for (const article of filteredArticles) {
      countsBySource.set(article.source, (countsBySource.get(article.source) || 0) + 1);
    }

    for (const source of sources) {
      const count = countsBySource.get(source) || 0;
      ctx.sourceStats.set(source, {
        count,
        status: "success",
      });
      emitProgress(ctx, {
        type: count > 0 ? "found" : "filtering",
        source,
        articlesFound: count,
        totalArticles: filteredArticles.length,
        message: count > 0
          ? `📄 ${source}: ${count} artículos`
          : `📄 ${source}: sin resultados visibles`,
        timestamp: Date.now(),
      });
    }

    const searchDuration = Date.now() - startTime;

    emitProgress(ctx, {
      type: "complete",
      source: "Orquestador",
      articlesFound: filteredArticles.length,
      totalArticles: filteredArticles.length,
      message: `✅ Búsqueda completada: ${filteredArticles.length} artículos científicos encontrados`,
      timestamp: Date.now(),
    });

    ctx.emitter.removeAllListeners();

    return {
      query,
      totalResults: filteredArticles.length,
      articles: filteredArticles,
      sources: Array.from(ctx.sourceStats.entries()).map(([name, stats]) => ({
        name,
        count: stats.count,
        status: stats.status,
      })),
      searchDuration,
      filters: {
        yearFrom: options.yearFrom,
        yearTo: options.yearTo,
        languages: options.languages,
        openAccessOnly: options.openAccessOnly,
        publicationTypes: options.publicationTypes,
      },
    };
  }

  function deduplicateArticles(articles: ScientificArticle[]): ScientificArticle[] {
    const seen = new Map<string, ScientificArticle>();
    
    for (const article of articles) {
      const key = article.doi || 
                  article.pmid || 
                  article.title.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 100);
      
      if (!seen.has(key)) {
        seen.set(key, article);
      } else {
        const existing = seen.get(key)!;
        if (hasMoreData(article, existing)) {
          seen.set(key, mergeArticles(existing, article));
        }
      }
    }
    
    return Array.from(seen.values());
  }

  function hasMoreData(a: ScientificArticle, b: ScientificArticle): boolean {
    const scoreA = (a.abstract ? 1 : 0) + (a.doi ? 1 : 0) + (a.citationCount ? 1 : 0);
    const scoreB = (b.abstract ? 1 : 0) + (b.doi ? 1 : 0) + (b.citationCount ? 1 : 0);
    return scoreA > scoreB;
  }

  function mergeArticles(existing: ScientificArticle, newArticle: ScientificArticle): ScientificArticle {
    return {
      ...existing,
      abstract: existing.abstract || newArticle.abstract,
      doi: existing.doi || newArticle.doi,
      pmid: existing.pmid || newArticle.pmid,
      citationCount: existing.citationCount || newArticle.citationCount,
      keywords: existing.keywords || newArticle.keywords,
      pdfUrl: existing.pdfUrl || newArticle.pdfUrl,
    };
  }

  function applyFilters(articles: ScientificArticle[], options: SearchOptions): ScientificArticle[] {
    return articles.filter(article => {
      if (options.yearFrom && article.year && article.year < options.yearFrom) {
        return false;
      }
      if (options.yearTo && article.year && article.year > options.yearTo) {
        return false;
      }
      if (options.openAccessOnly && !article.isOpenAccess) {
        return false;
      }
      if (options.languages && options.languages.length > 0) {
        const articleLang = article.language?.toLowerCase();
        if (articleLang && !options.languages.some(l => articleLang.startsWith(l.toLowerCase()))) {
          return false;
        }
      }
      if (options.publicationTypes && options.publicationTypes.length > 0) {
        if (article.publicationType && !options.publicationTypes.includes(article.publicationType)) {
          return false;
        }
      }
      return true;
    });
  }

  function sortByRelevance(articles: ScientificArticle[]): ScientificArticle[] {
    return articles.sort((a, b) => {
      const scoreA = calculateRelevanceScore(a);
      const scoreB = calculateRelevanceScore(b);
      return scoreB - scoreA;
    });
  }

  function calculateRelevanceScore(article: ScientificArticle): number {
    let score = 0;
    
    const currentYear = new Date().getFullYear();
    if (article.year) {
      const age = currentYear - article.year;
      score += Math.max(0, 10 - age);
    }
    
    if (article.citationCount) {
      score += Math.min(article.citationCount, 100) / 10;
    }
    
    if (article.abstract) score += 2;
    if (article.doi) score += 1;
    if (article.isOpenAccess) score += 1;
    
    const typeScores: Record<string, number> = {
      meta_analysis: 5,
      systematic_review: 4,
      randomized_controlled_trial: 3,
      clinical_trial: 2,
      review: 2,
    };
    score += typeScores[article.publicationType || ""] || 0;
    
    return score;
  }

  function emitProgress(ctx: SearchContext, event: SearchProgressEvent): void {
    ctx.emitter.emit("progress", event);
  }

  function generateBibliography(articles: ScientificArticle[]): string {
    const citations = articles
      .map((article, index) => `${index + 1}. ${generateAPA7Citation(article)}`)
      .join("\n\n");
    
    return `## Referencias (APA 7ma Edición)\n\n${citations}`;
  }

  return {
    search,
    generateBibliography,
  };
}

export const scientificSearchOrchestrator = createScientificSearchOrchestrator();
