/**
 * Lightweight, non-regex-based sanitizers for untrusted text.
 *
 * Why: Regex-based HTML stripping like `/<[^>]*>/g` can be vulnerable to
 * performance attacks (ReDoS) and is flagged by CodeQL.
 *
 * These helpers are intended for:
 * - user-provided search queries
 * - third-party API fields (titles/snippets) that might contain HTML
 *
 * NOTE: This is not a full HTML sanitizer. It produces plain text.
 */

export function removeAsciiControlChars(input: string): string {
  // Keep: \t (0x09), \n (0x0A), \r (0x0D)
  return input.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

function isAsciiLetterCode(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isLikelyHtmlTagStart(nextChar: string | undefined): boolean {
  if (!nextChar) return false;
  const code = nextChar.charCodeAt(0);
  return isAsciiLetterCode(code) || nextChar === "/" || nextChar === "!" || nextChar === "?";
}

export function stripLikelyHtmlTags(input: string): string {
  // Linear scan, treating "<tag ...>" patterns as tags.
  // Keeps literals like "2 < 3" (next char is not a tag-start char).
  const out: string[] = [];
  let inTag = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (!inTag && ch === "<") {
      if (isLikelyHtmlTagStart(input[i + 1])) {
        inTag = true;
        continue;
      }
      out.push(ch);
      continue;
    }

    if (inTag) {
      if (ch === ">") inTag = false;
      continue;
    }

    out.push(ch);
  }

  return out.join("");
}

const COMMON_ENTITY_MAP: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": "\"",
  "&#39;": "'",
  "&#x27;": "'",
  "&nbsp;": " ",
};

const COMMON_ENTITY_RE = /&(?:amp|lt|gt|quot|nbsp);|&#39;|&#x27;/gi;

export function decodeCommonHtmlEntities(input: string): string {
  return input.replace(COMMON_ENTITY_RE, (m) => COMMON_ENTITY_MAP[m.toLowerCase()] ?? m);
}

export function collapseWhitespace(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

export function sanitizePlainText(
  raw: unknown,
  opts?: { maxLen?: number; collapseWs?: boolean }
): string {
  if (typeof raw !== "string") return "";
  let s = raw;

  s = removeAsciiControlChars(s);
  // Unicode normalization can throw for some extremely broken inputs.
  try {
    s = s.normalize("NFC");
  } catch {
    // Keep original if normalization fails.
  }

  // Remove tags and decode a small set of entities without regex-heavy patterns.
  s = stripLikelyHtmlTags(s);
  s = decodeCommonHtmlEntities(s);
  s = stripLikelyHtmlTags(s);

  s = (opts?.collapseWs ?? true) ? collapseWhitespace(s) : s.trim();

  const maxLen = opts?.maxLen;
  if (typeof maxLen === "number" && maxLen > 0 && s.length > maxLen) {
    s = s.slice(0, maxLen);
  }

  return s;
}

export function sanitizeSearchQuery(raw: unknown, maxLen: number = 500): string {
  return sanitizePlainText(raw, { maxLen, collapseWs: true });
}

export function sanitizeHttpUrl(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const trimmed = raw.trim();
  if (!trimmed) return "";

  // Allow protocol-relative URLs (common in scraped data).
  if (trimmed.startsWith("//")) return `https:${trimmed}`;

  try {
    const u = new URL(trimmed);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    return u.toString();
  } catch {
    return "";
  }
}

