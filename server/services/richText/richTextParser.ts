import {
  RichTextDocument,
  RichTextBlock,
  TextRun,
  TextStyle,
  HeadingBlock,
  ParagraphBlock,
  BulletListBlock,
  OrderedListBlock,
  BlockquoteBlock,
  CodeBlock,
  TableBlock,
  ListItem,
  normalizeRuns,
} from "@shared/richTextTypes";

// ============================================
// SECURITY LIMITS
// ============================================

/** Maximum input length for markdown/HTML parsing (1MB) */
const MAX_INPUT_LENGTH = 1_000_000;

/** Maximum number of blocks per document */
const MAX_BLOCKS = 10_000;

/** Maximum list items per list */
const MAX_LIST_ITEMS = 5_000;

/** Maximum table rows */
const MAX_TABLE_ROWS = 5_000;

/** Maximum iterations for regex parsing loops (prevents infinite loops) */
const MAX_PARSE_ITERATIONS = 100_000;

/** Allowed URL protocols for links */
const ALLOWED_LINK_PROTOCOLS = ["http:", "https:", "mailto:"];

/** Validate URL protocol to prevent javascript:, data:, file:// injection */
function isAllowedUrl(url: string): boolean {
  if (!url || typeof url !== "string") return false;
  const trimmed = url.trim().toLowerCase();
  return ALLOWED_LINK_PROTOCOLS.some(proto => trimmed.startsWith(proto));
}

/** Validate CSS color values to prevent CSS injection */
function isValidCssColor(value: string): boolean {
  if (!value || typeof value !== "string") return false;
  const trimmed = value.trim();
  return /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]{1,30}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*[\d.]+\s*)?\))$/.test(trimmed);
}

/** Truncate input to security limit */
function safeInput(text: string): string {
  if (!text || typeof text !== "string") return "";
  return text.length > MAX_INPUT_LENGTH ? text.substring(0, MAX_INPUT_LENGTH) : text;
}

interface MarkdownNode {
  type: string;
  children?: MarkdownNode[];
  value?: string;
  depth?: number;
  ordered?: boolean;
  start?: number;
  lang?: string;
  url?: string;
  title?: string;
  alt?: string;
}

export function parseMarkdownToDocument(markdown: string): RichTextDocument {
  // Security: truncate input
  const safeMarkdown = safeInput(markdown);
  const blocks: RichTextBlock[] = [];
  const lines = safeMarkdown.split("\n");
  let i = 0;

  while (i < lines.length && blocks.length < MAX_BLOCKS) {
    const line = lines[i];

    if (line.trim() === "") {
      i++;
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length as 1 | 2 | 3 | 4 | 5 | 6;
      const content = headingMatch[2];
      blocks.push({
        type: "heading",
        level,
        runs: parseInlineMarkdown(content),
      });
      i++;
      continue;
    }

    if (line.startsWith("```")) {
      const langMatch = line.match(/^```(\w+)?/);
      const language = langMatch?.[1] || undefined;
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      blocks.push({
        type: "code-block",
        code: codeLines.join("\n"),
        language,
      });
      i++;
      continue;
    }

    if (line.match(/^[-*]\s+/)) {
      const items: ListItem[] = [];
      while (i < lines.length && lines[i].match(/^[-*]\s+/) && items.length < MAX_LIST_ITEMS) {
        const itemContent = lines[i].replace(/^[-*]\s+/, "");
        items.push({ runs: parseInlineMarkdown(itemContent) });
        i++;
      }
      // Skip remaining items if limit reached
      while (i < lines.length && lines[i].match(/^[-*]\s+/)) i++;
      blocks.push({ type: "bullet-list", items });
      continue;
    }

    if (line.match(/^\d+\.\s+/)) {
      const items: ListItem[] = [];
      const startMatch = line.match(/^(\d+)\./);
      const start = startMatch ? parseInt(startMatch[1], 10) : 1;
      while (i < lines.length && lines[i].match(/^\d+\.\s+/) && items.length < MAX_LIST_ITEMS) {
        const itemContent = lines[i].replace(/^\d+\.\s+/, "");
        items.push({ runs: parseInlineMarkdown(itemContent) });
        i++;
      }
      // Skip remaining items if limit reached
      while (i < lines.length && lines[i].match(/^\d+\.\s+/)) i++;
      blocks.push({ type: "ordered-list", items, start });
      continue;
    }

    if (line.startsWith("> ")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].startsWith("> ")) {
        quoteLines.push(lines[i].replace(/^>\s*/, ""));
        i++;
      }
      blocks.push({
        type: "blockquote",
        runs: parseInlineMarkdown(quoteLines.join(" ")),
      });
      continue;
    }

    if (line.match(/^[-*_]{3,}$/)) {
      blocks.push({ type: "horizontal-rule" });
      i++;
      continue;
    }

    if (line.includes("|") && lines[i + 1]?.match(/^\|?[\s:|-]+\|?$/)) {
      const tableBlock = parseMarkdownTable(lines, i);
      if (tableBlock) {
        blocks.push(tableBlock.block);
        i = tableBlock.endIndex;
        continue;
      }
    }

    const paragraphLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].match(/^#{1,6}\s+/) &&
      !lines[i].startsWith("```") &&
      !lines[i].match(/^[-*]\s+/) &&
      !lines[i].match(/^\d+\.\s+/) &&
      !lines[i].startsWith("> ") &&
      !lines[i].match(/^[-*_]{3,}$/)
    ) {
      paragraphLines.push(lines[i]);
      i++;
    }
    if (paragraphLines.length > 0) {
      blocks.push({
        type: "paragraph",
        runs: parseInlineMarkdown(paragraphLines.join(" ")),
      });
    }
  }

  return { blocks };
}

function parseMarkdownTable(
  lines: string[],
  startIndex: number
): { block: TableBlock; endIndex: number } | null {
  const headerLine = lines[startIndex];
  const separatorLine = lines[startIndex + 1];

  if (!separatorLine?.match(/^\|?[\s:|-]+\|?$/)) {
    return null;
  }

  const parseRow = (line: string) => {
    return line
      .split("|")
      .map((cell) => cell.trim())
      .filter((cell, i, arr) => !(i === 0 && cell === "") && !(i === arr.length - 1 && cell === ""));
  };

  const headerCells = parseRow(headerLine);
  const rows = [
    {
      cells: headerCells.map((cell) => ({
        runs: parseInlineMarkdown(cell),
        isHeader: true,
      })),
    },
  ];

  let i = startIndex + 2;
  while (i < lines.length && lines[i].includes("|") && rows.length < MAX_TABLE_ROWS) {
    const cells = parseRow(lines[i]);
    rows.push({
      cells: cells.map((cell) => ({
        runs: parseInlineMarkdown(cell),
      })),
    });
    i++;
  }
  // Skip remaining rows if limit reached
  while (i < lines.length && lines[i].includes("|")) i++;

  return {
    block: { type: "table", rows, hasHeader: true },
    endIndex: i,
  };
}

export function parseInlineMarkdown(text: string): TextRun[] {
  if (!text || typeof text !== "string") {
    return text ? [{ text: String(text) }] : [];
  }

  const runs: TextRun[] = [];
  let remaining = text;

  const patterns: Array<{
    regex: RegExp;
    handler: (match: RegExpExecArray) => { run: TextRun; consumed: number };
  }> = [
    {
      regex: /\$\$(.+?)\$\$/,
      handler: (m) => ({
        run: { text: m[1], style: { code: true } },
        consumed: m[0].length,
      }),
    },
    {
      regex: /\$(.+?)\$/,
      handler: (m) => ({
        run: { text: m[1], style: { code: true } },
        consumed: m[0].length,
      }),
    },
    {
      regex: /\*\*\*(.+?)\*\*\*/,
      handler: (m) => ({
        run: { text: m[1], style: { bold: true, italic: true } },
        consumed: m[0].length,
      }),
    },
    {
      regex: /___(.+?)___/,
      handler: (m) => ({
        run: { text: m[1], style: { bold: true, italic: true } },
        consumed: m[0].length,
      }),
    },
    {
      regex: /\*\*(.+?)\*\*/,
      handler: (m) => ({
        run: { text: m[1], style: { bold: true } },
        consumed: m[0].length,
      }),
    },
    {
      regex: /__(.+?)__/,
      handler: (m) => ({
        run: { text: m[1], style: { bold: true } },
        consumed: m[0].length,
      }),
    },
    {
      regex: /\*(.+?)\*/,
      handler: (m) => ({
        run: { text: m[1], style: { italic: true } },
        consumed: m[0].length,
      }),
    },
    {
      regex: /_(.+?)_/,
      handler: (m) => ({
        run: { text: m[1], style: { italic: true } },
        consumed: m[0].length,
      }),
    },
    {
      regex: /~~(.+?)~~/,
      handler: (m) => ({
        run: { text: m[1], style: { strikethrough: true } },
        consumed: m[0].length,
      }),
    },
    {
      regex: /<u>(.+?)<\/u>/i,
      handler: (m) => ({
        run: { text: m[1], style: { underline: true } },
        consumed: m[0].length,
      }),
    },
    {
      regex: /<mark>(.+?)<\/mark>/i,
      handler: (m) => ({
        run: { text: m[1], style: { backgroundColor: "#ffff00" } },
        consumed: m[0].length,
      }),
    },
    {
      regex: /<span\s+style=["']color:\s*([^"']+)["']>(.+?)<\/span>/i,
      handler: (m) => ({
        // Security: validate CSS color to prevent injection
        run: { text: m[2], style: { color: isValidCssColor(m[1]) ? m[1] : undefined } },
        consumed: m[0].length,
      }),
    },
    {
      regex: /`(.+?)`/,
      handler: (m) => ({
        run: { text: m[1], style: { code: true } },
        consumed: m[0].length,
      }),
    },
    {
      regex: /\[([^\]]+)\]\(([^)]+)\)/,
      handler: (m) => ({
        // Security: validate URL protocol for links
        run: isAllowedUrl(m[2])
          ? { text: m[1], style: { link: m[2], underline: true, color: "#0066cc" } }
          : { text: m[1] },
        consumed: m[0].length,
      }),
    },
    {
      regex: /<strong>(.+?)<\/strong>/i,
      handler: (m) => ({
        run: { text: m[1], style: { bold: true } },
        consumed: m[0].length,
      }),
    },
    {
      regex: /<b>(.+?)<\/b>/i,
      handler: (m) => ({
        run: { text: m[1], style: { bold: true } },
        consumed: m[0].length,
      }),
    },
    {
      regex: /<em>(.+?)<\/em>/i,
      handler: (m) => ({
        run: { text: m[1], style: { italic: true } },
        consumed: m[0].length,
      }),
    },
    {
      regex: /<i>(.+?)<\/i>/i,
      handler: (m) => ({
        run: { text: m[1], style: { italic: true } },
        consumed: m[0].length,
      }),
    },
  ];

  // Security: iteration safety limit
  let iterations = 0;
  while (remaining.length > 0 && iterations < MAX_PARSE_ITERATIONS) {
    iterations++;
    let earliestMatch: {
      index: number;
      pattern: (typeof patterns)[0];
      match: RegExpExecArray;
    } | null = null;

    for (const pattern of patterns) {
      pattern.regex.lastIndex = 0;
      const match = pattern.regex.exec(remaining);
      if (match && (earliestMatch === null || match.index < earliestMatch.index)) {
        earliestMatch = { index: match.index, pattern, match };
      }
    }

    if (earliestMatch === null) {
      if (remaining.length > 0) {
        runs.push({ text: remaining });
      }
      break;
    }

    if (earliestMatch.index > 0) {
      runs.push({ text: remaining.slice(0, earliestMatch.index) });
    }

    const { run } = earliestMatch.pattern.handler(earliestMatch.match);
    runs.push(run);
    remaining = remaining.slice(earliestMatch.index + earliestMatch.match[0].length);
  }

  return normalizeRuns(runs.filter((r) => r.text.length > 0));
}

export function parseHtmlToDocument(html: string): RichTextDocument {
  // Security: truncate input
  const safeHtml = safeInput(html);
  const blocks: RichTextBlock[] = [];

  const cleanHtml = safeHtml
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, "")
    .replace(/<object[^>]*>[\s\S]*?<\/object>/gi, "")
    .replace(/<embed[^>]*>/gi, "")
    .replace(/<form[^>]*>[\s\S]*?<\/form>/gi, "")
    .replace(/on\w+\s*=\s*["'][^"']*["']/gi, "");

  const blockRegex = /<(h[1-6]|p|ul|ol|blockquote|pre|table|hr)[^>]*>([\s\S]*?)<\/\1>|<hr\s*\/?>/gi;
  let match;

  while ((match = blockRegex.exec(cleanHtml)) !== null && blocks.length < MAX_BLOCKS) {
    const tagName = match[1]?.toLowerCase();
    const content = match[2] || "";

    if (tagName?.startsWith("h") && tagName.length === 2) {
      const level = parseInt(tagName[1], 10) as 1 | 2 | 3 | 4 | 5 | 6;
      blocks.push({
        type: "heading",
        level,
        runs: parseHtmlInline(content),
      });
    } else if (tagName === "p") {
      blocks.push({
        type: "paragraph",
        runs: parseHtmlInline(content),
      });
    } else if (tagName === "ul") {
      const items = parseHtmlListItems(content);
      blocks.push({ type: "bullet-list", items });
    } else if (tagName === "ol") {
      const items = parseHtmlListItems(content);
      blocks.push({ type: "ordered-list", items });
    } else if (tagName === "blockquote") {
      blocks.push({
        type: "blockquote",
        runs: parseHtmlInline(content),
      });
    } else if (tagName === "pre") {
      const codeMatch = content.match(/<code[^>]*(?:\s+class=["']language-(\w+)["'])?[^>]*>([\s\S]*?)<\/code>/i);
      blocks.push({
        type: "code-block",
        code: decodeHtmlEntities(codeMatch?.[2] || content),
        language: codeMatch?.[1],
      });
    } else if (tagName === "hr" || match[0].match(/<hr/i)) {
      blocks.push({ type: "horizontal-rule" });
    }
  }

  if (blocks.length === 0 && cleanHtml.trim()) {
    blocks.push({
      type: "paragraph",
      runs: parseHtmlInline(cleanHtml),
    });
  }

  return { blocks };
}

function parseHtmlListItems(html: string): ListItem[] {
  const items: ListItem[] = [];
  const liRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  let match;

  // Security: limit list items
  while ((match = liRegex.exec(html)) !== null && items.length < MAX_LIST_ITEMS) {
    items.push({ runs: parseHtmlInline(match[1]) });
  }

  return items;
}

function parseHtmlInline(html: string): TextRun[] {
  const runs: TextRun[] = [];

  const patterns: Array<{
    regex: RegExp;
    handler: (match: RegExpExecArray) => TextRun;
  }> = [
    {
      regex: /<strong[^>]*>([\s\S]*?)<\/strong>/i,
      handler: (m) => ({ text: stripTags(m[1]), style: { bold: true } }),
    },
    {
      regex: /<b[^>]*>([\s\S]*?)<\/b>/i,
      handler: (m) => ({ text: stripTags(m[1]), style: { bold: true } }),
    },
    {
      regex: /<em[^>]*>([\s\S]*?)<\/em>/i,
      handler: (m) => ({ text: stripTags(m[1]), style: { italic: true } }),
    },
    {
      regex: /<i[^>]*>([\s\S]*?)<\/i>/i,
      handler: (m) => ({ text: stripTags(m[1]), style: { italic: true } }),
    },
    {
      regex: /<u[^>]*>([\s\S]*?)<\/u>/i,
      handler: (m) => ({ text: stripTags(m[1]), style: { underline: true } }),
    },
    {
      regex: /<s[^>]*>([\s\S]*?)<\/s>/i,
      handler: (m) => ({ text: stripTags(m[1]), style: { strikethrough: true } }),
    },
    {
      regex: /<del[^>]*>([\s\S]*?)<\/del>/i,
      handler: (m) => ({ text: stripTags(m[1]), style: { strikethrough: true } }),
    },
    {
      regex: /<code[^>]*>([\s\S]*?)<\/code>/i,
      handler: (m) => ({ text: stripTags(m[1]), style: { code: true } }),
    },
    {
      regex: /<mark[^>]*>([\s\S]*?)<\/mark>/i,
      handler: (m) => ({ text: stripTags(m[1]), style: { backgroundColor: "#ffff00" } }),
    },
    {
      regex: /<a\s+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i,
      // Security: validate URL protocol for links
      handler: (m) => isAllowedUrl(m[1])
        ? ({ text: stripTags(m[2]), style: { link: m[1], underline: true, color: "#0066cc" } })
        : ({ text: stripTags(m[2]) }),
    },
    {
      regex: /<span[^>]*style=["'][^"']*color:\s*([^;"']+)[^"']*["'][^>]*>([\s\S]*?)<\/span>/i,
      // Security: validate CSS color value
      handler: (m) => ({ text: stripTags(m[2]), style: { color: isValidCssColor(m[1].trim()) ? m[1].trim() : undefined } }),
    },
  ];

  let remaining = html;

  // Security: iteration safety limit
  let iterations = 0;
  while (remaining.length > 0 && iterations < MAX_PARSE_ITERATIONS) {
    iterations++;
    let earliestMatch: {
      index: number;
      pattern: (typeof patterns)[0];
      match: RegExpExecArray;
    } | null = null;

    for (const pattern of patterns) {
      pattern.regex.lastIndex = 0;
      const match = pattern.regex.exec(remaining);
      if (match && (earliestMatch === null || match.index < earliestMatch.index)) {
        earliestMatch = { index: match.index, pattern, match };
      }
    }

    if (earliestMatch === null) {
      const text = stripTags(remaining);
      if (text.length > 0) {
        runs.push({ text: decodeHtmlEntities(text) });
      }
      break;
    }

    if (earliestMatch.index > 0) {
      const text = stripTags(remaining.slice(0, earliestMatch.index));
      if (text.length > 0) {
        runs.push({ text: decodeHtmlEntities(text) });
      }
    }

    const run = earliestMatch.pattern.handler(earliestMatch.match);
    run.text = decodeHtmlEntities(run.text);
    runs.push(run);
    remaining = remaining.slice(earliestMatch.index + earliestMatch.match[0].length);
  }

  return normalizeRuns(runs.filter((r) => r.text.length > 0));
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, "");
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

export function detectDocumentType(
  content: string
): "cv" | "letter" | "report" | "article" | "contract" | "generic" {
  const lowerContent = content.toLowerCase();

  const cvIndicators = [
    "experience",
    "education",
    "skills",
    "work history",
    "employment",
    "resume",
    "curriculum",
    "cv",
    "experiencia",
    "educación",
    "habilidades",
  ];
  const letterIndicators = [
    "dear",
    "sincerely",
    "regards",
    "yours truly",
    "to whom it may concern",
    "estimado",
    "atentamente",
    "cordialmente",
  ];
  const reportIndicators = [
    "executive summary",
    "introduction",
    "methodology",
    "findings",
    "conclusion",
    "recommendations",
    "analysis",
    "resumen ejecutivo",
    "introducción",
    "metodología",
  ];
  const contractIndicators = [
    "agreement",
    "parties",
    "terms and conditions",
    "whereas",
    "hereby",
    "obligations",
    "contrato",
    "partes",
    "términos y condiciones",
  ];
  const articleIndicators = ["abstract", "keywords", "references", "bibliography"];

  const countMatches = (indicators: string[]) =>
    indicators.filter((ind) => lowerContent.includes(ind)).length;

  const scores = {
    cv: countMatches(cvIndicators),
    letter: countMatches(letterIndicators),
    report: countMatches(reportIndicators),
    contract: countMatches(contractIndicators),
    article: countMatches(articleIndicators),
  };

  const maxScore = Math.max(...Object.values(scores));
  if (maxScore === 0) return "generic";

  const type = (Object.entries(scores).find(([, score]) => score === maxScore)?.[0] ||
    "generic") as keyof typeof scores;
  return type;
}
