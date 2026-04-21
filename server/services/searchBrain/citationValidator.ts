/**
 * citationValidator — post-response URL / DOI validator for SearchBrain
 * chat responses.
 *
 * Why: even with a hard prompt, LLMs will occasionally fabricate a
 * plausible-looking DOI or URL that doesn't resolve. Academic users
 * trust that every link they click opens a real paper — a single dead
 * citation breaks that trust for the whole feature.
 *
 * The validator:
 *   1. Extracts every http(s):// URL and every 10.xxxx/yyy DOI
 *      appearing in the assistant response.
 *   2. Builds an allow-set from the retrieved webSources (url,
 *      canonicalUrl, metadata.doi, metadata.pdfUrl).
 *   3. For each extracted reference:
 *        - if it matches (strict or by-DOI) an allowed source → keep.
 *        - otherwise → flag + optionally rewrite to "[cita no verificada]".
 *
 * The function returns both the rewritten text AND a structured report
 * so callers can log metrics / surface a subtle UI warning without
 * silently hiding the issue.
 */

export interface CitationValidationInput {
  text: string;
  /** Whitelisted references the LLM was actually given. */
  allowedUrls: Array<string | undefined>;
  allowedDois?: Array<string | undefined>;
  /** If false, the text is returned unchanged and only `report` populated. */
  rewrite?: boolean;
}

export interface CitationValidationReport {
  extractedUrls: string[];
  extractedDois: string[];
  invalidUrls: string[];
  invalidDois: string[];
  /** All citations were legitimate — no rewrites needed. */
  clean: boolean;
}

export interface CitationValidationResult {
  text: string;
  report: CitationValidationReport;
}

const URL_RE = /\bhttps?:\/\/[^\s<>"'`)]+/gi;
// DOI pattern — broad enough to catch bare and prefixed ("doi:") forms.
const DOI_RE = /\b10\.\d{4,9}\/[^\s<>"'`)]+/gi;

export function validateCitations(input: CitationValidationInput): CitationValidationResult {
  const { text } = input;
  const rewrite = input.rewrite !== false;

  const allowedUrlSet = normaliseUrlSet(input.allowedUrls);
  const allowedDoiSet = new Set(
    (input.allowedDois ?? [])
      .map((d) => (d ? normaliseDoi(d) : null))
      .filter((d): d is string => Boolean(d))
  );

  const extractedUrls = Array.from(new Set((text.match(URL_RE) ?? []).map(trimTrailingPunct)));
  const extractedDois = Array.from(new Set((text.match(DOI_RE) ?? []).map(trimTrailingPunct)));

  const invalidUrls: string[] = [];
  const invalidDois: string[] = [];

  for (const u of extractedUrls) if (!isAllowedUrl(u, allowedUrlSet, allowedDoiSet)) invalidUrls.push(u);
  for (const d of extractedDois) if (!allowedDoiSet.has(normaliseDoi(d))) invalidDois.push(d);

  let rewritten = text;
  if (rewrite && (invalidUrls.length > 0 || invalidDois.length > 0)) {
    rewritten = stripInvalid(rewritten, invalidUrls, invalidDois);
  }

  return {
    text: rewritten,
    report: {
      extractedUrls,
      extractedDois,
      invalidUrls,
      invalidDois,
      clean: invalidUrls.length === 0 && invalidDois.length === 0,
    },
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function normaliseUrlSet(urls: Array<string | undefined>): Set<string> {
  const out = new Set<string>();
  for (const u of urls) {
    if (!u) continue;
    out.add(normaliseUrl(u));
  }
  return out;
}

export function normaliseUrl(u: string): string {
  try {
    const parsed = new URL(u);
    parsed.hash = "";
    parsed.hostname = parsed.hostname.toLowerCase();
    let s = parsed.toString();
    if (s.endsWith("/")) s = s.slice(0, -1);
    return s;
  } catch {
    return u.trim().toLowerCase();
  }
}

export function normaliseDoi(d: string): string {
  return d.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "").replace(/^doi:/i, "").toLowerCase().replace(/[.,;)\]]+$/, "");
}

function trimTrailingPunct(s: string): string {
  // Strip trailing punctuation that commonly sticks to a URL parsed
  // out of a sentence ("...see [3].").
  return s.replace(/[.,;:!?)\]}"']+$/, "");
}

function isAllowedUrl(url: string, allowedUrls: Set<string>, allowedDois: Set<string>): boolean {
  const norm = normaliseUrl(url);
  if (allowedUrls.has(norm)) return true;
  // Also accept any URL that contains a whitelisted DOI (covers doi.org
  // links users re-wrapped through redirectors, etc).
  for (const doi of allowedDois) {
    if (norm.includes(doi)) return true;
  }
  return false;
}

function stripInvalid(text: string, invalidUrls: string[], invalidDois: string[]): string {
  let out = text;
  const markers = [...invalidUrls, ...invalidDois].sort((a, b) => b.length - a.length);
  for (const marker of markers) {
    // Replace the marker wherever it appears, preserving surrounding
    // punctuation. Using split/join avoids issues with regex-special
    // chars inside URLs.
    out = out.split(marker).join("[cita no verificada]");
  }
  return out;
}

export const CITATION_VALIDATOR_INTERNAL = {
  normaliseUrl,
  normaliseDoi,
  trimTrailingPunct,
  isAllowedUrl,
  stripInvalid,
};
