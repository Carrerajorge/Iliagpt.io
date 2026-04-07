import { JSDOM } from "jsdom";
import { sanitizeHttpUrl, sanitizePlainText, sanitizeSearchQuery } from "../lib/textSanitizers";

export interface BaseSearchOptions {
  maxResults?: number;
  timeoutMs?: number;
  language?: string;
  openAccessOnly?: boolean;
}

export interface BaseSearchResult {
  title: string;
  authors: string;
  year: string;
  journal?: string;
  doi?: string;
  url: string;
  pdfUrl?: string;
  abstract?: string;
  openAccess?: boolean;
  documentType?: string;
  language?: string;
}

const BASE_SEARCH_URL = "https://www.base-search.net/Search/Results";
const BASE_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9,es;q=0.8",
  "Cache-Control": "no-cache",
};

function absolutizeBaseUrl(candidate: string | null | undefined): string {
  if (!candidate) return "";
  try {
    return new URL(candidate, BASE_SEARCH_URL).toString();
  } catch {
    return "";
  }
}

function extractDoi(text: string): string | undefined {
  const match = text.match(/\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+\b/i);
  return match?.[0];
}

function cleanText(value: string | null | undefined, maxLen = 4000): string {
  return sanitizePlainText(value || "", { maxLen }).replace(/\s+/g, " ").trim();
}

export async function searchBASEPublic(query: string, options: BaseSearchOptions = {}): Promise<BaseSearchResult[]> {
  const sanitizedQuery = sanitizeSearchQuery(query, 500);
  if (!sanitizedQuery) return [];

  const maxResults = Math.max(1, Math.min(50, options.maxResults || 10));
  const timeoutMs = Math.max(1000, Math.min(15000, options.timeoutMs || 8000));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const params = new URLSearchParams({
      lookfor: sanitizedQuery,
      type: "all",
      limit: String(maxResults),
      sort: "relevance",
      oaboost: options.openAccessOnly ? "1" : "0",
      lng: options.language || "en",
    });

    const response = await fetch(`${BASE_SEARCH_URL}?${params.toString()}`, {
      headers: BASE_HEADERS,
      signal: controller.signal,
    });

    if (!response.ok) return [];

    const html = await response.text();
    if (
      /Making sure you(?:&#39;|'|’)re not a bot!/i.test(html) ||
      /Protected by\s+<a[^>]*>\s*Anubis\s*<\/a>/i.test(html) ||
      /Anubis uses a Proof-of-Work scheme/i.test(html)
    ) {
      throw new Error("BASE search is currently blocked by an anti-bot challenge");
    }

    const dom = new JSDOM(html);
    const doc = dom.window.document;
    const cards = Array.from(
      doc.querySelectorAll(".result, .search-result, .record, .media.result-item, .list-group-item")
    ).slice(0, maxResults * 2);

    const results: BaseSearchResult[] = [];

    for (const card of cards) {
      const titleLink = card.querySelector("h2 a, h3 a, .title a, a.title, .result-title a");
      const title = cleanText(titleLink?.textContent, 500);
      if (!title) continue;

      const rawText = cleanText(card.textContent, 8000);
      const authorText = cleanText(
        card.querySelector(".authors, .author, .result-authors, [itemprop='author'], .summary-authors")?.textContent,
        1000,
      );
      const abstract = cleanText(
        card.querySelector(".summary, .description, .abstract, .result-body, .result-content")?.textContent,
        3000,
      );
      const year = rawText.match(/\b(19|20)\d{2}\b/)?.[0] || "";
      const articleUrl = sanitizeHttpUrl(absolutizeBaseUrl(titleLink?.getAttribute("href")));

      const pdfAnchor = card.querySelector(
        "a[href$='.pdf'], a[href*='.pdf?'], a[href*='/download/'], a[title*='PDF'], a[aria-label*='PDF']",
      );
      const pdfUrl = sanitizeHttpUrl(absolutizeBaseUrl(pdfAnchor?.getAttribute("href")));
      const doi = extractDoi(rawText);
      const openAccess =
        Boolean(pdfUrl) ||
        /\bopen access\b/i.test(rawText) ||
        /\bfree access\b/i.test(rawText) ||
        /\boa\b/i.test(cleanText(card.querySelector(".availability, .access")?.textContent, 200));

      const documentType = cleanText(card.querySelector(".format, .type, .document-type")?.textContent, 120) || undefined;
      const journal = cleanText(card.querySelector(".publication, .publisher, .journal, .source")?.textContent, 300) || undefined;

      if (options.openAccessOnly && !openAccess) continue;

      results.push({
        title,
        authors: authorText,
        year,
        journal,
        doi,
        url: articleUrl || pdfUrl,
        pdfUrl: pdfUrl || undefined,
        abstract: abstract || undefined,
        openAccess,
        documentType,
        language: options.language || undefined,
      });

      if (results.length >= maxResults) break;
    }

    return results;
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}
