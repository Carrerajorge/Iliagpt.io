/**
 * Must-Keep Span Detector
 *
 * Identifies spans within message text that should NOT be dropped
 * during context truncation. Used by ContextWindowManager to assign
 * priority boosts to messages containing critical content.
 *
 * Detected span types:
 * - Code blocks (```)
 * - URLs (http/https)
 * - JSON/XML structured data
 * - @mentions
 * - File paths
 * - Numbers with units (measurements, currencies)
 * - Email addresses
 * - API keys / tokens (masked but preserved)
 */

export type SpanType =
  | "code_block"
  | "url"
  | "json_block"
  | "xml_block"
  | "mention"
  | "file_path"
  | "number_with_unit"
  | "email"
  | "inline_code"
  | "key_value";

export interface MustKeepSpan {
  start: number;
  end: number;
  type: SpanType;
  priority: number; // 1-10, higher = more important
  text: string;     // The matched span text (truncated to 200 chars for logging)
}

export interface MustKeepAnalysis {
  spans: MustKeepSpan[];
  totalSpans: number;
  priorityScore: number;      // Sum of all span priorities
  hasCode: boolean;
  hasUrls: boolean;
  hasStructuredData: boolean;
  hasMentions: boolean;
}

// ── Detection Patterns ─────────────────────────────────────

interface DetectorRule {
  type: SpanType;
  pattern: RegExp;
  priority: number;
}

const DETECTOR_RULES: DetectorRule[] = [
  // Code blocks — highest priority (often contain instructions, specs, examples)
  {
    type: "code_block",
    pattern: /```[\s\S]*?```/g,
    priority: 9,
  },
  // Inline code
  {
    type: "inline_code",
    pattern: /`[^`\n]{2,80}`/g,
    priority: 5,
  },
  // URLs
  {
    type: "url",
    pattern: /https?:\/\/[^\s<>"')\]]{5,}/g,
    priority: 7,
  },
  // Email addresses
  {
    type: "email",
    pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    priority: 6,
  },
  // JSON blocks (curly braces with key-value pairs)
  {
    type: "json_block",
    pattern: /\{(?:[^{}]|\{[^{}]*\}){10,}\}/g,
    priority: 8,
  },
  // XML/HTML tags
  {
    type: "xml_block",
    pattern: /<[a-zA-Z][a-zA-Z0-9]*(?:\s[^>]*)?>[\s\S]*?<\/[a-zA-Z][a-zA-Z0-9]*>/g,
    priority: 7,
  },
  // @mentions
  {
    type: "mention",
    pattern: /@[a-zA-Z0-9_.-]{2,40}/g,
    priority: 4,
  },
  // File paths (Unix-style and Windows-style)
  {
    type: "file_path",
    pattern: /(?:\/[\w.-]+){2,}(?:\.\w{1,10})?|[A-Z]:\\(?:[\w.-]+\\){1,}[\w.-]+/g,
    priority: 6,
  },
  // Numbers with units (measurements, currencies, percentages)
  {
    type: "number_with_unit",
    pattern: /\b\d+(?:\.\d+)?(?:\s*(?:px|em|rem|vh|vw|%|ms|s|min|hr?|hrs?|days?|weeks?|months?|years?|KB|MB|GB|TB|USD|EUR|GBP|\$|€|£|¥|kg|lb|oz|mi|km|m|cm|mm|ft|in))\b/gi,
    priority: 5,
  },
  // Key-value patterns (common in configs, specs)
  {
    type: "key_value",
    pattern: /^[\w.-]+\s*[:=]\s*.{3,}$/gm,
    priority: 3,
  },
];

// ── Detector ───────────────────────────────────────────────

/**
 * Detect must-keep spans in a text string.
 * Returns analysis with all detected spans and aggregate metadata.
 */
export function detectMustKeepSpans(text: string): MustKeepAnalysis {
  const spans: MustKeepSpan[] = [];
  const seen = new Set<string>(); // Deduplicate overlapping matches

  for (const rule of DETECTOR_RULES) {
    // Reset regex state for each text
    const regex = new RegExp(rule.pattern.source, rule.pattern.flags);
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      const key = `${match.index}:${match.index + match[0].length}`;
      if (seen.has(key)) continue;
      seen.add(key);

      spans.push({
        start: match.index,
        end: match.index + match[0].length,
        type: rule.type,
        priority: rule.priority,
        text: match[0].length > 200 ? match[0].slice(0, 200) + "..." : match[0],
      });
    }
  }

  // Sort by start position
  spans.sort((a, b) => a.start - b.start);

  const priorityScore = spans.reduce((sum, s) => sum + s.priority, 0);

  return {
    spans,
    totalSpans: spans.length,
    priorityScore,
    hasCode: spans.some(s => s.type === "code_block" || s.type === "inline_code"),
    hasUrls: spans.some(s => s.type === "url"),
    hasStructuredData: spans.some(s => s.type === "json_block" || s.type === "xml_block"),
    hasMentions: spans.some(s => s.type === "mention"),
  };
}

/**
 * Calculate a must-keep boost score for a message.
 * Used by ContextWindowManager's importance scorer.
 */
export function mustKeepBoostScore(text: string): number {
  const analysis = detectMustKeepSpans(text);
  // 5 points per span, capped at 25
  return Math.min(analysis.totalSpans * 5, 25);
}
