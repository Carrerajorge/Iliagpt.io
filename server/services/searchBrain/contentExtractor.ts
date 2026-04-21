/**
 * contentExtractor — deep content extraction for SearchBrain results.
 *
 * Given a paper card (with PDF URL, HTML URL, or neither), return the
 * most-informative body the caller can feed back into the LLM:
 *   1. If a PDF URL is present and reachable → extract full text via pdf-parse.
 *   2. Else if the landing URL is HTML → run Mozilla Readability over
 *      the DOM (jsdom) to strip chrome + ads.
 *   3. Else → fall back to the abstract, if any.
 *
 * This file is resilient by design. A malformed PDF, a 403 from a
 * paywalled journal, a timeout, an HTML page with no main content —
 * all of these produce a `fallback` result containing whatever abstract
 * was already in the record, rather than failing the whole pipeline.
 *
 * The fetch layer is injectable so tests can run without network and
 * without pulling in pdf-parse / jsdom at import time (both are heavy).
 */

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_CHARS = 50_000;
const MAX_BYTES = 25 * 1024 * 1024; // 25 MB safety cap on response size
const USER_AGENT = "IliaGPT-SearchBrain/1.0 (+https://iliagpt.io; responsible academic extraction)";

export type ExtractionType = "pdf" | "html" | "fallback" | "empty";

export interface ExtractionResult {
  type: ExtractionType;
  content: string;
  charCount: number;
  sourceUrl: string;
  truncated: boolean;
  /** Reason when type=fallback or empty (for debugging). */
  reason?: string;
}

export interface ExtractionInput {
  pdfUrl?: string;
  htmlUrl?: string;
  abstract?: string;
  maxChars?: number;
  timeoutMs?: number;
  /** Override fetch for tests. */
  fetcher?: Fetcher;
  /** Override pdf-parse for tests — lazy-loaded in production. */
  pdfParser?: PdfParser;
  /** Override Readability pipeline for tests — lazy-loaded in production. */
  htmlExtractor?: HtmlExtractor;
}

export type Fetcher = (
  url: string,
  init: { timeoutMs: number; acceptHeader: string }
) => Promise<{ ok: boolean; status: number; buffer: Buffer; contentType: string } | null>;

export type PdfParser = (buf: Buffer) => Promise<{ text: string }>;
export type HtmlExtractor = (html: string, url: string) => Promise<string>;

// ─── Defaults (lazy-loaded) ───────────────────────────────────────────────

const defaultFetcher: Fetcher = async (url, init) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: init.acceptHeader,
      },
      signal: controller.signal,
      redirect: "follow",
    });
    const contentType = res.headers.get("content-type") || "";
    const contentLength = Number(res.headers.get("content-length") || 0);
    if (contentLength > MAX_BYTES) return null;
    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (buffer.byteLength > MAX_BYTES) return null;
    return { ok: res.ok, status: res.status, buffer, contentType };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

const defaultPdfParser: PdfParser = async (buffer) => {
  const mod = await import("pdf-parse");
  const pdfParse = (mod as unknown as { default?: PdfParser }).default ?? (mod as unknown as PdfParser);
  return pdfParse(buffer);
};

const defaultHtmlExtractor: HtmlExtractor = async (html, url) => {
  const [{ JSDOM }, { Readability }] = await Promise.all([
    import("jsdom"),
    import("@mozilla/readability"),
  ]);
  const dom = new JSDOM(html, { url });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();
  if (!article) return "";
  const chunks = [article.title, article.textContent].filter(Boolean);
  return chunks.join("\n\n").trim();
};

// ─── Public API ───────────────────────────────────────────────────────────

function truncate(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: text.slice(0, maxChars), truncated: true };
}

function fallback(input: ExtractionInput, reason: string): ExtractionResult {
  const abstract = typeof input.abstract === "string" ? input.abstract.trim() : "";
  if (abstract) {
    const { text, truncated } = truncate(abstract, input.maxChars ?? DEFAULT_MAX_CHARS);
    return {
      type: "fallback",
      content: text,
      charCount: text.length,
      sourceUrl: input.htmlUrl ?? input.pdfUrl ?? "",
      truncated,
      reason,
    };
  }
  return {
    type: "empty",
    content: "",
    charCount: 0,
    sourceUrl: input.htmlUrl ?? input.pdfUrl ?? "",
    truncated: false,
    reason,
  };
}

export async function extractContent(input: ExtractionInput): Promise<ExtractionResult> {
  const maxChars = input.maxChars ?? DEFAULT_MAX_CHARS;
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetcher = input.fetcher ?? defaultFetcher;

  // Path 1 — PDF.
  if (input.pdfUrl) {
    const res = await fetcher(input.pdfUrl, {
      timeoutMs,
      acceptHeader: "application/pdf,*/*",
    });
    if (res && res.ok && isPdf(res.contentType, res.buffer)) {
      try {
        const parser = input.pdfParser ?? defaultPdfParser;
        const { text } = await parser(res.buffer);
        const cleaned = (text ?? "").replace(/\u0000/g, "").trim();
        if (cleaned.length > 0) {
          const { text: t, truncated } = truncate(cleaned, maxChars);
          return {
            type: "pdf",
            content: t,
            charCount: t.length,
            sourceUrl: input.pdfUrl,
            truncated,
          };
        }
      } catch {
        // PDF parse failed — fall through to HTML or fallback.
      }
    }
  }

  // Path 2 — HTML.
  if (input.htmlUrl) {
    const res = await fetcher(input.htmlUrl, {
      timeoutMs,
      acceptHeader: "text/html,application/xhtml+xml",
    });
    if (res && res.ok && isHtml(res.contentType)) {
      try {
        const extractor = input.htmlExtractor ?? defaultHtmlExtractor;
        const extracted = await extractor(res.buffer.toString("utf8"), input.htmlUrl);
        const cleaned = extracted.replace(/\s+/g, " ").trim();
        if (cleaned.length > 0) {
          const { text: t, truncated } = truncate(cleaned, maxChars);
          return {
            type: "html",
            content: t,
            charCount: t.length,
            sourceUrl: input.htmlUrl,
            truncated,
          };
        }
      } catch {
        // Readability bailed — fall through.
      }
    }
  }

  // Path 3 — fall back to the abstract or empty.
  return fallback(input, "no extractable content");
}

// ─── helpers ──────────────────────────────────────────────────────────────

function isPdf(contentType: string, buffer: Buffer): boolean {
  if (/application\/pdf/i.test(contentType)) return true;
  // Magic number check: "%PDF-"
  if (buffer.byteLength >= 5 && buffer.slice(0, 5).toString("ascii") === "%PDF-") return true;
  return false;
}

function isHtml(contentType: string): boolean {
  return /text\/html|application\/xhtml\+xml/i.test(contentType);
}

export const CONTENT_EXTRACTOR_INTERNAL = {
  truncate,
  fallback,
  isPdf,
  isHtml,
  USER_AGENT,
  MAX_BYTES,
};
