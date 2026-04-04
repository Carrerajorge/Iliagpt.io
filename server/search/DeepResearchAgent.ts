/**
 * DeepResearchAgent — multi-step research workflow with configurable depth.
 * Searches → fetches pages → extracts facts → cross-references → synthesizes.
 * Streams progress events so the UI can show real-time research status.
 */

import { EventEmitter } from "events";
import { createLogger } from "../utils/logger";
import { AppError } from "../utils/errors";
import { multiSearchProvider, SearchResult } from "./MultiSearchProvider";

const logger = createLogger("DeepResearchAgent");

// ─── Types ────────────────────────────────────────────────────────────────────

export type ResearchDepth = "quick" | "medium" | "deep";

export interface ResearchOptions {
  query: string;
  depth?: ResearchDepth;
  maxSources?: number;
  /** Stream progress events on the emitter */
  onProgress?: (event: ResearchProgressEvent) => void;
}

export interface ResearchProgressEvent {
  stage: "searching" | "fetching" | "extracting" | "cross_referencing" | "synthesizing" | "done";
  message: string;
  progress: number; // 0–100
  data?: unknown;
}

export interface ExtractedFact {
  claim: string;
  source: string;
  url: string;
  confidence: "high" | "medium" | "low";
  corroborated: boolean;
  corroboratedBy?: string[];
}

export interface PageContent {
  url: string;
  title: string;
  content: string;
  wordCount: number;
  fetchedAt: string;
  facts: ExtractedFact[];
}

export interface ResearchReport {
  query: string;
  depth: ResearchDepth;
  sources: PageContent[];
  facts: ExtractedFact[];
  synthesis: string;
  citations: Array<{ index: number; url: string; title: string }>;
  searchResults: SearchResult[];
  totalTime: number;
  costUSD: number;
}

// Depth configuration
const DEPTH_CONFIG: Record<ResearchDepth, { pagesToRead: number; maxResults: number; crossRef: boolean }> = {
  quick: { pagesToRead: 0, maxResults: 10, crossRef: false },
  medium: { pagesToRead: 3, maxResults: 10, crossRef: false },
  deep: { pagesToRead: 10, maxResults: 15, crossRef: true },
};

// ─── Readability Extraction ───────────────────────────────────────────────────

interface ReadableContent {
  title: string;
  content: string;
  wordCount: number;
}

function extractReadableContent(html: string, url: string): ReadableContent {
  // Remove script, style, nav, footer, header, aside
  let cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<aside[\s\S]*?<\/aside>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

  // Extract title
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = titleMatch?.[1]?.trim() ?? new URL(url).hostname;

  // Limit content to first 8000 chars to stay within token budgets
  const content = cleaned.slice(0, 8_000);
  const wordCount = content.split(/\s+/).length;

  return { title, content, wordCount };
}

// ─── Fact Extractor ───────────────────────────────────────────────────────────

function extractFactsFromText(text: string, sourceUrl: string): ExtractedFact[] {
  // Heuristic: sentences with numbers, named entities, or "is/are/was" patterns
  const sentences = text.split(/(?<=[.!?])\s+/).filter((s) => s.length > 40 && s.length < 400);

  const factPatterns = [
    /\b\d+[\d,]*\.?\d*\s*(percent|%|million|billion|thousand|kg|km|m|°|years?|months?)/i,
    /\b(according to|research shows?|studies? show?|found that|reported that|evidence suggests?)\b/i,
    /\b(is|are|was|were|has been|have been)\s+(the|a|an|one of)\b/i,
    /\b(first|second|largest|smallest|highest|lowest|most|least)\b/i,
  ];

  const facts: ExtractedFact[] = [];

  for (const sentence of sentences) {
    const hasFactPattern = factPatterns.some((p) => p.test(sentence));
    if (!hasFactPattern) continue;

    facts.push({
      claim: sentence.trim(),
      source: new URL(sourceUrl).hostname,
      url: sourceUrl,
      confidence: "medium",
      corroborated: false,
    });

    if (facts.length >= 20) break;
  }

  return facts;
}

// ─── Cross Reference ──────────────────────────────────────────────────────────

function crossReferenceFacts(allFacts: ExtractedFact[]): ExtractedFact[] {
  // For each fact, find similar claims from different sources
  const updated = allFacts.map((fact) => ({ ...fact }));

  for (let i = 0; i < updated.length; i++) {
    const a = updated[i];
    const corroboratedBy: string[] = [];

    for (let j = 0; j < updated.length; j++) {
      if (i === j || a.url === updated[j].url) continue;

      const b = updated[j];
      const similarity = computeTextSimilarity(a.claim, b.claim);

      if (similarity > 0.4) {
        corroboratedBy.push(b.url);
      }
    }

    if (corroboratedBy.length > 0) {
      a.corroborated = true;
      a.corroboratedBy = corroboratedBy;
      a.confidence = corroboratedBy.length >= 2 ? "high" : "medium";
    }
  }

  return updated;
}

function computeTextSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\W+/).filter((w) => w.length > 4));
  const wordsB = new Set(b.toLowerCase().split(/\W+/).filter((w) => w.length > 4));

  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let intersection = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection++;
  }

  return intersection / Math.sqrt(wordsA.size * wordsB.size);
}

// ─── Synthesis Builder ────────────────────────────────────────────────────────

function buildSynthesis(
  query: string,
  facts: ExtractedFact[],
  sources: PageContent[],
  citations: Array<{ index: number; url: string; title: string }>
): string {
  const highConf = facts.filter((f) => f.confidence === "high" && f.corroborated);
  const medConf = facts.filter((f) => f.confidence === "medium");
  const citationMap = new Map(citations.map((c) => [c.url, c.index]));

  const lines: string[] = [
    `## Research Summary: ${query}\n`,
    `*Based on ${sources.length} sources and ${facts.length} extracted facts.*\n`,
  ];

  if (highConf.length > 0) {
    lines.push("### Corroborated Findings\n");
    for (const f of highConf.slice(0, 5)) {
      const idx = citationMap.get(f.url);
      const cite = idx != null ? ` [${idx}]` : "";
      lines.push(`- ${f.claim}${cite}`);
    }
    lines.push("");
  }

  if (medConf.length > 0) {
    lines.push("### Additional Information\n");
    for (const f of medConf.slice(0, 8)) {
      const idx = citationMap.get(f.url);
      const cite = idx != null ? ` [${idx}]` : "";
      lines.push(`- ${f.claim}${cite}`);
    }
    lines.push("");
  }

  lines.push("### Sources\n");
  for (const c of citations) {
    lines.push(`[${c.index}] [${c.title}](${c.url})`);
  }

  return lines.join("\n");
}

// ─── DeepResearchAgent ────────────────────────────────────────────────────────

export class DeepResearchAgent extends EventEmitter {
  private fetchTimeout: number;
  private userAgent: string;

  constructor(opts: { fetchTimeoutMs?: number } = {}) {
    super();
    this.fetchTimeout = opts.fetchTimeoutMs ?? 15_000;
    this.userAgent = "IliaGPT-Research/1.0 (Academic Research Assistant)";
  }

  async research(options: ResearchOptions): Promise<ResearchReport> {
    const { query, depth = "medium", maxSources, onProgress } = options;
    const cfg = DEPTH_CONFIG[depth];
    const startTime = Date.now();

    const progress = (stage: ResearchProgressEvent["stage"], message: string, pct: number, data?: unknown) => {
      const ev: ResearchProgressEvent = { stage, message, progress: pct, data };
      this.emit("progress", ev);
      onProgress?.(ev);
      logger.debug(`Research progress [${pct}%]: ${message}`);
    };

    // ── Step 1: Search ────────────────────────────────────────────────────────

    progress("searching", `Searching for: "${query}"`, 5);

    const searchResp = await multiSearchProvider.searchMultiProvider({
      query,
      maxResults: maxSources ?? cfg.maxResults,
      mergeResults: true,
      deduplicate: true,
    });

    progress("searching", `Found ${searchResp.results.length} results from ${searchResp.providers.join(", ")}`, 20, {
      count: searchResp.results.length,
    });

    if (depth === "quick") {
      progress("done", "Quick search complete", 100);
      return {
        query,
        depth,
        sources: [],
        facts: [],
        synthesis: this.buildQuickSummary(query, searchResp.results),
        citations: searchResp.results.slice(0, 5).map((r, i) => ({ index: i + 1, url: r.url, title: r.title })),
        searchResults: searchResp.results,
        totalTime: Date.now() - startTime,
        costUSD: searchResp.cost,
      };
    }

    // ── Step 2: Fetch pages ───────────────────────────────────────────────────

    const pagesToFetch = searchResp.results.slice(0, cfg.pagesToRead);
    progress("fetching", `Fetching ${pagesToFetch.length} pages...`, 25);

    const pages = await this.fetchPages(pagesToFetch, (url, i, total) => {
      const pct = 25 + Math.round((i / total) * 30);
      progress("fetching", `Reading: ${url}`, pct);
    });

    progress("fetching", `Successfully fetched ${pages.length} pages`, 55);

    // ── Step 3: Extract facts ─────────────────────────────────────────────────

    progress("extracting", "Extracting key facts from pages...", 60);

    const allFacts: ExtractedFact[] = [];
    for (const page of pages) {
      const facts = extractFactsFromText(page.content, page.url);
      page.facts = facts;
      allFacts.push(...facts);
    }

    progress("extracting", `Extracted ${allFacts.length} facts`, 70);

    // ── Step 4: Cross-reference ───────────────────────────────────────────────

    let finalFacts = allFacts;

    if (cfg.crossRef && allFacts.length > 0) {
      progress("cross_referencing", "Cross-referencing claims across sources...", 75);
      finalFacts = crossReferenceFacts(allFacts);
      const corroborated = finalFacts.filter((f) => f.corroborated).length;
      progress("cross_referencing", `Found ${corroborated} corroborated claims`, 85);
    }

    // ── Step 5: Synthesize ────────────────────────────────────────────────────

    progress("synthesizing", "Synthesizing research findings...", 88);

    const citations = pages.map((p, i) => ({ index: i + 1, url: p.url, title: p.title }));
    const synthesis = buildSynthesis(query, finalFacts, pages, citations);

    progress("done", "Research complete", 100);

    return {
      query,
      depth,
      sources: pages,
      facts: finalFacts,
      synthesis,
      citations,
      searchResults: searchResp.results,
      totalTime: Date.now() - startTime,
      costUSD: searchResp.cost,
    };
  }

  private async fetchPages(
    results: SearchResult[],
    onFetch: (url: string, index: number, total: number) => void
  ): Promise<PageContent[]> {
    const pages: PageContent[] = [];

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      onFetch(r.url, i, results.length);

      try {
        const page = await this.fetchPage(r.url);
        pages.push(page);
      } catch (err) {
        logger.warn(`Failed to fetch ${r.url}: ${(err as Error).message}`);
      }
    }

    return pages;
  }

  private async fetchPage(url: string): Promise<PageContent> {
    const resp = await fetch(url, {
      headers: {
        "User-Agent": this.userAgent,
        "Accept": "text/html,application/xhtml+xml,*/*",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(this.fetchTimeout),
      redirect: "follow",
    });

    if (!resp.ok) throw new AppError(`HTTP ${resp.status} for ${url}`, resp.status, "PAGE_FETCH_ERROR");

    const contentType = resp.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
      throw new AppError(`Non-HTML content at ${url}`, 400, "NON_HTML_CONTENT");
    }

    const html = await resp.text();
    const { title, content, wordCount } = extractReadableContent(html, url);

    return {
      url,
      title,
      content,
      wordCount,
      fetchedAt: new Date().toISOString(),
      facts: [],
    };
  }

  private buildQuickSummary(query: string, results: SearchResult[]): string {
    const lines = [`## Quick Research: ${query}\n`];
    for (let i = 0; i < Math.min(results.length, 8); i++) {
      const r = results[i];
      lines.push(`**[${i + 1}] [${r.title}](${r.url})**`);
      lines.push(r.snippet);
      lines.push("");
    }
    return lines.join("\n");
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const deepResearchAgent = new DeepResearchAgent();
