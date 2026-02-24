export interface RichTextToken {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  link?: string;
  isMath?: boolean;
}

// ============================================
// SECURITY LIMITS
// ============================================

/** Maximum input length for tokenization (500KB) */
const MAX_TOKENIZE_INPUT = 500_000;

/** Maximum iterations for the tokenizer loop */
const MAX_TOKENIZE_ITERATIONS = 50_000;

/** Maximum LaTeX expression length */
const MAX_MATH_LENGTH = 10_000;

/** Allowed URL protocols for links */
const ALLOWED_LINK_PROTOCOLS = ["http:", "https:", "mailto:"];

/** Validate URL protocol */
function isAllowedUrl(url: string): boolean {
  if (!url || typeof url !== "string") return false;
  const trimmed = url.trim().toLowerCase();
  return ALLOWED_LINK_PROTOCOLS.some(proto => trimmed.startsWith(proto));
}

interface TokenPattern {
  regex: RegExp;
  handler: (match: RegExpExecArray) => RichTextToken;
}

const patterns: TokenPattern[] = [
  {
    regex: /\$\$(.+?)\$\$/,
    // Security: limit math expression length
    handler: (match) => ({ text: match[1].substring(0, MAX_MATH_LENGTH), isMath: true }),
  },
  {
    regex: /\$(.+?)\$/,
    handler: (match) => ({ text: match[1].substring(0, MAX_MATH_LENGTH), isMath: true }),
  },
  {
    regex: /\*\*\*(.+?)\*\*\*/,
    handler: (match) => ({ text: match[1], bold: true, italic: true }),
  },
  {
    regex: /\*\*(.+?)\*\*/,
    handler: (match) => ({ text: match[1], bold: true }),
  },
  {
    regex: /\*(.+?)\*/,
    handler: (match) => ({ text: match[1], italic: true }),
  },
  {
    regex: /__(.+?)__/,
    handler: (match) => ({ text: match[1], bold: true }),
  },
  {
    regex: /_(.+?)_/,
    handler: (match) => ({ text: match[1], italic: true }),
  },
  {
    regex: /`(.+?)`/,
    handler: (match) => ({ text: match[1], code: true }),
  },
  {
    regex: /\[([^\]]+)\]\(([^)]+)\)/,
    // Security: validate URL protocol for links
    handler: (match) => isAllowedUrl(match[2])
      ? ({ text: match[1], link: match[2] })
      : ({ text: match[1] }),
  },
];

export function tokenizeMarkdown(text: string): RichTextToken[] {
  if (!text || typeof text !== "string") {
    return text ? [{ text: String(text) }] : [];
  }

  // Security: truncate input
  const safeText = text.length > MAX_TOKENIZE_INPUT ? text.substring(0, MAX_TOKENIZE_INPUT) : text;

  const tokens: RichTextToken[] = [];
  let remaining = safeText;

  // Security: iteration safety limit
  let iterations = 0;
  while (remaining.length > 0 && iterations < MAX_TOKENIZE_ITERATIONS) {
    iterations++;
    let earliestMatch: { index: number; pattern: TokenPattern; match: RegExpExecArray } | null = null;

    for (const pattern of patterns) {
      pattern.regex.lastIndex = 0;
      const match = pattern.regex.exec(remaining);
      if (match && (earliestMatch === null || match.index < earliestMatch.index)) {
        earliestMatch = { index: match.index, pattern, match };
      }
    }

    if (earliestMatch === null) {
      if (remaining.length > 0) {
        tokens.push({ text: remaining });
      }
      break;
    }

    if (earliestMatch.index > 0) {
      tokens.push({ text: remaining.slice(0, earliestMatch.index) });
    }

    tokens.push(earliestMatch.pattern.handler(earliestMatch.match));
    remaining = remaining.slice(earliestMatch.index + earliestMatch.match[0].length);
  }

  // If iteration limit hit, push remaining text as-is
  if (remaining.length > 0 && iterations >= MAX_TOKENIZE_ITERATIONS) {
    tokens.push({ text: remaining });
  }

  return tokens.filter((t) => t.text.length > 0);
}

export function hasMarkdown(text: string): boolean {
  if (!text || typeof text !== "string") {
    return false;
  }
  return patterns.some((p) => {
    p.regex.lastIndex = 0;
    return p.regex.test(text);
  });
}
