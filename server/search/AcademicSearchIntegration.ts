/**
 * AcademicSearchIntegration — unified interface over arXiv, PubMed, Semantic Scholar, and CrossRef.
 * Returns normalized paper objects with citation graph traversal and trend detection.
 */

import { createLogger } from "../utils/logger";
import { AppError } from "../utils/errors";

const logger = createLogger("AcademicSearchIntegration");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AcademicPaper {
  id: string;
  title: string;
  authors: string[];
  year: number | null;
  abstract: string;
  doi?: string;
  pdfUrl?: string;
  sourceUrl: string;
  citations: number;
  references?: string[];
  source: "arxiv" | "pubmed" | "semantic_scholar" | "crossref";
  keywords?: string[];
  venue?: string;
}

export interface AcademicSearchOptions {
  query: string;
  maxResults?: number;
  sources?: Array<"arxiv" | "pubmed" | "semantic_scholar" | "crossref">;
  yearFrom?: number;
  yearTo?: number;
  sortBy?: "relevance" | "citations" | "date";
}

export interface CitationGraph {
  paper: AcademicPaper;
  references: AcademicPaper[];
  citedBy: AcademicPaper[];
  depth: number;
}

export interface ResearchTrend {
  topic: string;
  paperCount: number;
  growthRate: number;
  topPapers: AcademicPaper[];
  peakYear: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

// ─── arXiv ────────────────────────────────────────────────────────────────────

async function searchArXiv(options: AcademicSearchOptions): Promise<AcademicPaper[]> {
  const max = options.maxResults ?? 10;
  const params = new URLSearchParams({
    search_query: `all:${options.query}`,
    start: "0",
    max_results: String(max),
    sortBy: options.sortBy === "date" ? "submittedDate" : "relevance",
    sortOrder: "descending",
  });

  const resp = await fetch(`https://export.arxiv.org/api/query?${params}`, {
    headers: { "User-Agent": "IliaGPT-Academic/1.0" },
    signal: AbortSignal.timeout(15_000),
  });

  if (!resp.ok) throw new AppError(`arXiv API error ${resp.status}`, 502, "ARXIV_ERROR");

  const xml = await resp.text();
  const papers: AcademicPaper[] = [];
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  let m: RegExpExecArray | null;

  while ((m = entryRegex.exec(xml)) !== null) {
    const entry = m[1];
    const rawId = (entry.match(/<id>([^<]+)<\/id>/) ?? [])[1]?.trim() ?? "";
    const title = stripTags((entry.match(/<title>([^<]+)<\/title>/) ?? [])[1] ?? "");
    const summary = stripTags((entry.match(/<summary>([\s\S]*?)<\/summary>/) ?? [])[1] ?? "");
    const published = (entry.match(/<published>([^<]+)<\/published>/) ?? [])[1] ?? "";
    const year = published ? new Date(published).getFullYear() : null;
    const authorMatches = [...entry.matchAll(/<author>\s*<name>([^<]+)<\/name>/g)];
    const authors = authorMatches.map((am) => am[1].trim());
    const doi = (entry.match(/<arxiv:doi[^>]*>([^<]+)<\/arxiv:doi>/) ?? [])[1]?.trim();

    if (!title) continue;
    papers.push({
      id: `arxiv:${rawId.split("/abs/")[1] ?? rawId}`,
      title,
      authors,
      year,
      abstract: summary.slice(0, 800),
      doi,
      pdfUrl: rawId.replace("abs", "pdf"),
      sourceUrl: rawId,
      citations: 0,
      source: "arxiv",
    });
  }

  return papers;
}

// ─── PubMed ───────────────────────────────────────────────────────────────────

async function searchPubMed(options: AcademicSearchOptions): Promise<AcademicPaper[]> {
  const max = options.maxResults ?? 10;
  const searchParams = new URLSearchParams({
    db: "pubmed",
    term: options.query,
    retmax: String(max),
    retmode: "json",
    sort: options.sortBy === "date" ? "date" : "relevance",
  });

  const searchResp = await fetch(
    `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?${searchParams}`,
    { signal: AbortSignal.timeout(10_000) }
  );
  if (!searchResp.ok) throw new AppError(`PubMed ESearch error ${searchResp.status}`, 502, "PUBMED_ERROR");

  const searchData = (await searchResp.json()) as { esearchresult?: { idlist?: string[] } };
  const ids = searchData.esearchresult?.idlist ?? [];
  if (ids.length === 0) return [];

  const summaryParams = new URLSearchParams({ db: "pubmed", id: ids.join(","), retmode: "json" });
  const summaryResp = await fetch(
    `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?${summaryParams}`,
    { signal: AbortSignal.timeout(12_000) }
  );
  if (!summaryResp.ok) throw new AppError(`PubMed ESummary error ${summaryResp.status}`, 502, "PUBMED_ERROR");

  const summaryData = (await summaryResp.json()) as {
    result?: Record<string, {
      uid: string;
      title: string;
      authors: Array<{ name: string }>;
      pubdate: string;
      doi?: string;
      fulljournalname?: string;
    }>;
  };

  const papers: AcademicPaper[] = [];
  for (const id of ids) {
    const item = summaryData.result?.[id];
    if (!item) continue;
    const year = item.pubdate ? parseInt(item.pubdate.split(" ")[0], 10) : null;
    papers.push({
      id: `pubmed:${item.uid}`,
      title: item.title,
      authors: (item.authors ?? []).map((a) => a.name),
      year: isNaN(year!) ? null : year,
      abstract: "",
      doi: item.doi,
      sourceUrl: `https://pubmed.ncbi.nlm.nih.gov/${item.uid}/`,
      citations: 0,
      venue: item.fulljournalname,
      source: "pubmed",
    });
  }

  return papers;
}

// ─── Semantic Scholar ─────────────────────────────────────────────────────────

async function searchSemanticScholar(options: AcademicSearchOptions): Promise<AcademicPaper[]> {
  const max = options.maxResults ?? 10;
  const params = new URLSearchParams({
    query: options.query,
    limit: String(max),
    fields: "paperId,title,authors,year,abstract,citationCount,openAccessPdf,externalIds,venue",
    ...(options.sortBy === "citations" ? { sort: "citationCount:desc" } : {}),
  });

  const resp = await fetch(`https://api.semanticscholar.org/graph/v1/paper/search?${params}`, {
    headers: { "User-Agent": "IliaGPT-Academic/1.0" },
    signal: AbortSignal.timeout(12_000),
  });

  if (!resp.ok) throw new AppError(`Semantic Scholar error ${resp.status}`, 502, "S2_ERROR");

  const data = (await resp.json()) as {
    data?: Array<{
      paperId: string;
      title: string;
      authors: Array<{ name: string }>;
      year: number | null;
      abstract: string | null;
      citationCount: number;
      openAccessPdf?: { url: string } | null;
      externalIds?: { DOI?: string };
      venue?: string;
    }>;
  };

  return (data.data ?? []).map((p) => ({
    id: `s2:${p.paperId}`,
    title: p.title,
    authors: (p.authors ?? []).map((a) => a.name),
    year: p.year,
    abstract: p.abstract?.slice(0, 800) ?? "",
    doi: p.externalIds?.DOI,
    pdfUrl: p.openAccessPdf?.url,
    sourceUrl: `https://www.semanticscholar.org/paper/${p.paperId}`,
    citations: p.citationCount ?? 0,
    venue: p.venue,
    source: "semantic_scholar" as const,
  }));
}

// ─── CrossRef ─────────────────────────────────────────────────────────────────

async function searchCrossRef(options: AcademicSearchOptions): Promise<AcademicPaper[]> {
  const max = options.maxResults ?? 10;
  const params = new URLSearchParams({
    query: options.query,
    rows: String(max),
    sort: options.sortBy === "citations" ? "is-referenced-by-count" : "relevance",
    select: "DOI,title,author,published,abstract,is-referenced-by-count,URL,container-title",
    mailto: "research@iliagpt.ai",
  });

  const resp = await fetch(`https://api.crossref.org/works?${params}`, {
    signal: AbortSignal.timeout(12_000),
  });

  if (!resp.ok) throw new AppError(`CrossRef error ${resp.status}`, 502, "CROSSREF_ERROR");

  const data = (await resp.json()) as {
    message?: {
      items?: Array<{
        DOI: string;
        title: string[];
        author?: Array<{ given?: string; family?: string }>;
        published?: { "date-parts": number[][] };
        abstract?: string;
        "is-referenced-by-count"?: number;
        URL?: string;
        "container-title"?: string[];
      }>;
    };
  };

  return (data.message?.items ?? []).map((item) => {
    const year = item.published?.["date-parts"]?.[0]?.[0] ?? null;
    const authors = (item.author ?? []).map((a) => `${a.given ?? ""} ${a.family ?? ""}`.trim());
    return {
      id: `crossref:${item.DOI}`,
      title: item.title?.[0] ?? "(No title)",
      authors,
      year,
      abstract: item.abstract ? stripTags(item.abstract).slice(0, 800) : "",
      doi: item.DOI,
      sourceUrl: item.URL ?? `https://doi.org/${item.DOI}`,
      citations: item["is-referenced-by-count"] ?? 0,
      venue: item["container-title"]?.[0],
      source: "crossref" as const,
    };
  });
}

// ─── Citation Graph ───────────────────────────────────────────────────────────

async function fetchCitationGraph(paperId: string, depth = 1): Promise<CitationGraph> {
  const s2Id = paperId.startsWith("s2:") ? paperId.slice(3) : paperId;
  const resp = await fetch(
    `https://api.semanticscholar.org/graph/v1/paper/${s2Id}?fields=title,authors,year,abstract,references,citations,citationCount`,
    { signal: AbortSignal.timeout(12_000) }
  );

  if (!resp.ok) throw new AppError(`S2 citation graph error ${resp.status}`, 502, "S2_ERROR");

  const data = (await resp.json()) as {
    paperId: string;
    title: string;
    authors: Array<{ name: string }>;
    year: number;
    abstract: string;
    citationCount: number;
    references: Array<{ paperId: string; title: string; year: number; authors: Array<{ name: string }> }>;
    citations: Array<{ paperId: string; title: string; year: number; authors: Array<{ name: string }> }>;
  };

  const toMinimal = (p: { paperId: string; title: string; year: number; authors: Array<{ name: string }> }): AcademicPaper => ({
    id: `s2:${p.paperId}`,
    title: p.title,
    authors: (p.authors ?? []).map((a) => a.name),
    year: p.year,
    abstract: "",
    sourceUrl: `https://www.semanticscholar.org/paper/${p.paperId}`,
    citations: 0,
    source: "semantic_scholar",
  });

  return {
    paper: {
      id: `s2:${data.paperId}`,
      title: data.title,
      authors: (data.authors ?? []).map((a) => a.name),
      year: data.year,
      abstract: data.abstract?.slice(0, 800) ?? "",
      sourceUrl: `https://www.semanticscholar.org/paper/${data.paperId}`,
      citations: data.citationCount,
      source: "semantic_scholar",
    },
    references: (data.references ?? []).slice(0, 20).map(toMinimal),
    citedBy: (data.citations ?? []).slice(0, 20).map(toMinimal),
    depth,
  };
}

// ─── Trend Detection ──────────────────────────────────────────────────────────

async function detectResearchTrends(topics: string[]): Promise<ResearchTrend[]> {
  const trends: ResearchTrend[] = [];

  await Promise.allSettled(
    topics.map(async (topic) => {
      try {
        const results = await searchSemanticScholar({ query: topic, maxResults: 50, sortBy: "citations" });

        const byYear = new Map<number, number>();
        for (const p of results) {
          if (p.year) byYear.set(p.year, (byYear.get(p.year) ?? 0) + 1);
        }

        const years = [...byYear.keys()].sort();
        if (years.length === 0) return;

        const peakYear = years.reduce((a, b) => (byYear.get(a)! >= byYear.get(b)! ? a : b), years[0]);
        const now = new Date().getFullYear();
        const prev = byYear.get(now - 1) ?? 1;
        const curr = byYear.get(now) ?? 0;
        const growthRate = prev > 0 ? (curr - prev) / prev : 0;

        trends.push({
          topic,
          paperCount: results.length,
          growthRate,
          topPapers: results.filter((p) => p.citations > 10).slice(0, 5),
          peakYear,
        });
      } catch (err) {
        logger.warn(`Trend detection failed for "${topic}": ${(err as Error).message}`);
      }
    })
  );

  return trends.sort((a, b) => b.growthRate - a.growthRate);
}

// ─── Unified Academic Search ──────────────────────────────────────────────────

export class AcademicSearchIntegration {
  async search(options: AcademicSearchOptions): Promise<AcademicPaper[]> {
    const sources = options.sources ?? ["semantic_scholar", "arxiv", "pubmed", "crossref"];
    const perSource = Math.ceil((options.maxResults ?? 10) / sources.length);
    const all: AcademicPaper[] = [];

    await Promise.allSettled(
      sources.map(async (src) => {
        try {
          let results: AcademicPaper[] = [];
          switch (src) {
            case "arxiv": results = await searchArXiv({ ...options, maxResults: perSource }); break;
            case "pubmed": results = await searchPubMed({ ...options, maxResults: perSource }); break;
            case "semantic_scholar": results = await searchSemanticScholar({ ...options, maxResults: perSource }); break;
            case "crossref": results = await searchCrossRef({ ...options, maxResults: perSource }); break;
          }
          all.push(...results);
          logger.debug(`Academic [${src}]: ${results.length} results`);
        } catch (err) {
          logger.warn(`Academic source ${src} failed: ${(err as Error).message}`);
        }
      })
    );

    // Deduplicate by DOI then title prefix
    const seen = new Set<string>();
    const deduped = all.filter((p) => {
      const key = p.doi ?? p.title.toLowerCase().slice(0, 50);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return deduped
      .sort((a, b) => (b.citations ?? 0) - (a.citations ?? 0))
      .slice(0, options.maxResults ?? 20);
  }

  async getCitationGraph(paperId: string, depth = 1): Promise<CitationGraph> {
    return fetchCitationGraph(paperId, depth);
  }

  async detectTrends(topics: string[]): Promise<ResearchTrend[]> {
    return detectResearchTrends(topics);
  }

  async resolveDoI(doi: string): Promise<AcademicPaper | null> {
    try {
      const resp = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, {
        signal: AbortSignal.timeout(8_000),
      });
      if (!resp.ok) return null;
      const data = (await resp.json()) as {
        message?: { title?: string[]; author?: Array<{ given?: string; family?: string }> };
      };
      if (!data.message) return null;

      return {
        id: `crossref:${doi}`,
        title: data.message.title?.[0] ?? doi,
        authors: (data.message.author ?? []).map((a) => `${a.given ?? ""} ${a.family ?? ""}`.trim()),
        year: null,
        abstract: "",
        doi,
        sourceUrl: `https://doi.org/${doi}`,
        citations: 0,
        source: "crossref",
      };
    } catch {
      return null;
    }
  }
}

export const academicSearch = new AcademicSearchIntegration();
