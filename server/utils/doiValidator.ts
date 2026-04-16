/**
 * DOI Format Validation & Normalization Utility
 *
 * DOI syntax: 10.PREFIX/SUFFIX
 *   - Prefix: registrant code (4-9 digits after "10.")
 *   - Suffix: any printable characters assigned by the registrant
 *
 * References:
 *   - https://www.doi.org/doi_handbook/2_Numbering.html
 *   - RFC 3986 (URI encoding)
 */

/** Strict DOI regex: 10.NNNN[N...]/non-whitespace */
const DOI_REGEX = /^10\.\d{4,9}\/\S+$/;

/** Loose DOI regex for extracting DOIs from free text */
const DOI_EXTRACT_REGEX = /\b(10\.\d{4,9}\/[^\s,;}\])"']+)/g;

/**
 * Validate whether a string is a syntactically valid DOI.
 * Does NOT check existence (use CrossRef/DataCite for that).
 */
export function isValidDOI(doi: string | undefined | null): boolean {
  if (!doi || typeof doi !== "string") return false;
  const normalized = normalizeDOI(doi);
  return DOI_REGEX.test(normalized);
}

/**
 * Normalize a DOI string:
 * - Strip leading/trailing whitespace
 * - Remove common prefixes (https://doi.org/, doi:, DOI:, dx.doi.org/)
 * - Remove trailing punctuation that's not part of the DOI
 * - Trim enclosing angle brackets or parentheses
 */
export function normalizeDOI(raw: string | undefined | null): string {
  if (!raw || typeof raw !== "string") return "";

  let doi = raw.trim();

  // Remove enclosing angle brackets: <10.1234/foo> -> 10.1234/foo
  doi = doi.replace(/^<(.+)>$/, "$1");

  // Remove common URL prefixes
  doi = doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "");

  // Remove "doi:" or "DOI:" prefix
  doi = doi.replace(/^doi:\s*/i, "");

  // Remove trailing punctuation that is unlikely to be part of a DOI
  doi = doi.replace(/[.),:;\]}>'"]+$/, "");

  // Collapse any remaining whitespace
  doi = doi.replace(/\s+/g, "").trim();

  return doi;
}

/**
 * Build the canonical DOI URL (using https://doi.org/ resolver).
 * Returns empty string if DOI is invalid.
 */
export function doiToUrl(doi: string | undefined | null): string {
  const normalized = normalizeDOI(doi);
  if (!isValidDOI(normalized)) return "";
  return `https://doi.org/${normalized}`;
}

/**
 * Build a display-friendly DOI link with 🔗 emoji.
 * Returns empty string if DOI is invalid.
 */
export function doiToLink(doi: string | undefined | null): string {
  const url = doiToUrl(doi);
  if (!url) return "";
  return `🔗 ${url}`;
}

/**
 * Extract all DOIs found in a block of text.
 * Useful for parsing DOIs from abstracts, reference lists, etc.
 */
export function extractDOIs(text: string): string[] {
  if (!text || typeof text !== "string") return [];
  const matches = text.match(DOI_EXTRACT_REGEX) || [];
  // Normalize and deduplicate
  const seen = new Set<string>();
  const results: string[] = [];
  for (const m of matches) {
    const normalized = normalizeDOI(m);
    if (isValidDOI(normalized) && !seen.has(normalized.toLowerCase())) {
      seen.add(normalized.toLowerCase());
      results.push(normalized);
    }
  }
  return results;
}
