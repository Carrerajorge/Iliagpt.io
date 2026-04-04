/**
 * MessagePreprocessor — Batch 1 Pipeline Stage
 *
 * Enriches raw user messages before any LLM call:
 *  - Unicode NFC normalization
 *  - Multi-language detection (ES/EN/FR/DE/PT/ZH/JA/KO)
 *  - Session-scoped deduplication
 *  - Profanity filter with configurable severity levels
 *  - Intent classification (question/command/creative/code/analysis/conversational)
 *  - Entity extraction (mentions, URLs, code blocks, file paths, dates)
 *  - Metadata enrichment
 */

import { z } from "zod";
import { createLogger } from "../utils/logger";

const log = createLogger("MessagePreprocessor");

// ─── Enums & Schemas ──────────────────────────────────────────────────────────

export const IntentSchema = z.enum([
  "question",
  "command",
  "creative",
  "code",
  "analysis",
  "conversational",
  "unknown",
]);
export type Intent = z.infer<typeof IntentSchema>;

export const SupportedLanguageSchema = z.enum([
  "es", "en", "fr", "de", "pt", "zh", "ja", "ko", "unknown",
]);
export type SupportedLanguage = z.infer<typeof SupportedLanguageSchema>;

export const ProfanitySeveritySchema = z.enum(["none", "mild", "moderate", "severe"]);
export type ProfanitySeverity = z.infer<typeof ProfanitySeveritySchema>;

export interface ExtractedEntities {
  mentions: string[];          // @user-style references
  urls: string[];
  codeBlocks: string[];        // fenced or inline backtick code
  filePaths: string[];
  dates: string[];
  emails: string[];
  hashtags: string[];
}

export interface PreprocessorConfig {
  maxDedupWindowMs: number;    // rolling window for duplicate detection
  maxDedupHistory: number;     // max messages kept per session
  profanityEnabled: boolean;
  profanityBlockThreshold: ProfanitySeverity; // severity at or above which message is blocked
}

export interface EnrichedMessage {
  originalText: string;
  normalizedText: string;
  language: SupportedLanguage;
  languageConfidence: number;
  intent: Intent;
  intentConfidence: number;
  entities: ExtractedEntities;
  profanitySeverity: ProfanitySeverity;
  isBlocked: boolean;
  blockReason?: string;
  isDuplicate: boolean;
  wordCount: number;
  charCount: number;
  hasCode: boolean;
  hasUrls: boolean;
  processingMs: number;
  metadata: Record<string, unknown>;
}

// ─── Language Detection ───────────────────────────────────────────────────────

interface LangPattern {
  lang: SupportedLanguage;
  patterns: RegExp[];
  uniqueChars?: RegExp; // script-specific characters (high weight)
}

const LANG_PATTERNS: LangPattern[] = [
  {
    lang: "zh",
    patterns: [/[\u4E00-\u9FFF]/],
    uniqueChars: /[\u4E00-\u9FFF]{2,}/,
  },
  {
    lang: "ja",
    patterns: [/[\u3040-\u30FF]/],
    uniqueChars: /[\u3040-\u30FF]{2,}/,
  },
  {
    lang: "ko",
    patterns: [/[\uAC00-\uD7AF]/],
    uniqueChars: /[\uAC00-\uD7AF]{2,}/,
  },
  {
    lang: "es",
    patterns: [
      /[áéíóúñü¿¡]/i,
      /\b(qu[eé]|c[oó]mo|d[oó]nde|cu[aá]ndo|por\s+qu[eé]|para\s+qu[eé])\b/i,
      /\b(est[aá]|tiene|puede|quiero|necesito|busco|hola|gracias)\b/i,
    ],
  },
  {
    lang: "en",
    patterns: [
      /\b(what|where|when|why|how|which|who)\b/i,
      /\b(is|are|was|were|have|has|can|could|would|should)\b/i,
      /\b(I'm|you're|we're|they're|it's|don't|doesn't|won't|can't)\b/i,
    ],
  },
  {
    lang: "fr",
    patterns: [
      /[àâçéèêëîïôùûüÿœæ]/i,
      /\b(qu[eo]i|comment|o[uù]|quand|pourquoi|quel)\b/i,
      /\b(est|sont|avoir|être|faire|pouvoir|je suis|tu es)\b/i,
    ],
  },
  {
    lang: "de",
    patterns: [
      /[äöüÄÖÜß]/,
      /\b(was|wie|wo|wann|warum|wer|welche)\b/i,
      /\b(ist|sind|haben|sein|können|ich|du|wir|sie)\b/i,
    ],
  },
  {
    lang: "pt",
    patterns: [
      /[ãõâêîôûáéíóúàèìòùç]/i,
      /\b(o que|como|onde|quando|por que|para que)\b/i,
      /\b(está|são|ter|ser|pode|quero|preciso|obrigado)\b/i,
    ],
  },
];

function detectLanguage(text: string): { language: SupportedLanguage; confidence: number } {
  const scores: Partial<Record<SupportedLanguage, number>> = {};

  for (const lp of LANG_PATTERNS) {
    let score = 0;
    for (const pat of lp.patterns) {
      const matches = text.match(pat);
      if (matches) score += matches.length;
    }
    if (lp.uniqueChars && lp.uniqueChars.test(text)) {
      score += 5; // Strong signal for CJK scripts
    }
    if (score > 0) scores[lp.lang] = score;
  }

  const entries = Object.entries(scores) as [SupportedLanguage, number][];
  if (entries.length === 0) return { language: "unknown", confidence: 0.4 };

  entries.sort((a, b) => b[1] - a[1]);
  const [topLang, topScore] = entries[0];
  const totalScore = entries.reduce((s, [, v]) => s + v, 0);
  const confidence = Math.min(0.97, 0.45 + (topScore / Math.max(totalScore, 1)) * 0.55);

  return { language: topLang, confidence };
}

// ─── Intent Classification ────────────────────────────────────────────────────

interface IntentRule {
  intent: Intent;
  patterns: RegExp[];
  weight: number;
}

const INTENT_RULES: IntentRule[] = [
  {
    intent: "code",
    patterns: [
      /```[\s\S]{2,}```/,
      /\b(function|class|import|export|const|let|var|return|async|await)\b/,
      /\b(bug|error|exception|fix|refactor|implement|debug|compile|test)\b/i,
      /\.(ts|js|py|go|rs|java|cpp|cs|rb|php)\b/i,
    ],
    weight: 1.5,
  },
  {
    intent: "question",
    patterns: [
      /\?$/m,
      /^(what|where|when|why|how|who|which|can you|could you|do you|is there|are there)/im,
      /\b(explain|tell me|describe|define|what is|what are)\b/i,
    ],
    weight: 1.0,
  },
  {
    intent: "command",
    patterns: [
      /^(create|make|build|generate|write|add|remove|delete|update|change|convert|translate)/im,
      /^(send|schedule|set|configure|enable|disable|install|run|execute)/im,
    ],
    weight: 1.2,
  },
  {
    intent: "analysis",
    patterns: [
      /\b(analyze|analyse|compare|evaluate|assess|review|summarize|summarise)\b/i,
      /\b(pros|cons|advantages|disadvantages|trade-?offs?|difference)\b/i,
      /\b(data|metrics|statistics|numbers|trends|insights)\b/i,
    ],
    weight: 1.1,
  },
  {
    intent: "creative",
    patterns: [
      /\b(write|compose|create|draft|imagine|invent|story|poem|song|essay|blog)\b/i,
      /\b(creative|fiction|fantasy|narrative|character|plot)\b/i,
    ],
    weight: 1.0,
  },
  {
    intent: "conversational",
    patterns: [
      /^(hi|hello|hey|hola|bonjour|hallo|salve|ciao|sup|yo)\b/i,
      /\b(thanks|thank you|gracias|merci|danke|obrigado)\b/i,
      /\b(how are you|how's it going|what's up|nice to meet)\b/i,
    ],
    weight: 0.9,
  },
];

function classifyIntent(text: string): { intent: Intent; confidence: number } {
  const scores: Partial<Record<Intent, number>> = {};

  for (const rule of INTENT_RULES) {
    let matches = 0;
    for (const pat of rule.patterns) {
      if (pat.test(text)) matches++;
    }
    if (matches > 0) {
      scores[rule.intent] = (scores[rule.intent] ?? 0) + matches * rule.weight;
    }
  }

  const entries = Object.entries(scores) as [Intent, number][];
  if (entries.length === 0) return { intent: "unknown", confidence: 0.4 };

  entries.sort((a, b) => b[1] - a[1]);
  const [topIntent, topScore] = entries[0];
  const totalScore = entries.reduce((s, [, v]) => s + v, 0);
  const confidence = Math.min(0.95, 0.4 + (topScore / Math.max(totalScore, 1)) * 0.6);

  return { intent: topIntent, confidence };
}

// ─── Entity Extraction ────────────────────────────────────────────────────────

const URL_RE = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi;
const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
const MENTION_RE = /@[\w.-]+/g;
const HASHTAG_RE = /#[\w]+/g;
const CODE_BLOCK_RE = /```[\s\S]*?```|`[^`\n]+`/g;
const FILE_PATH_RE = /(?:^|\s)(\.{0,2}\/[\w./-]+\.\w{1,10}|\/[\w./-]+\.\w{1,10}|[\w-]+\/[\w./-]+\.\w{1,10})/gm;
const DATE_RE = /\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}|\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{4})\b/gi;

function extractEntities(text: string): ExtractedEntities {
  const dedupe = (arr: string[]) => [...new Set(arr)];

  const codeBlocks = dedupe((text.match(CODE_BLOCK_RE) ?? []).map(s => s.trim()));
  const strippedText = text.replace(CODE_BLOCK_RE, " ").replace(URL_RE, " ");

  return {
    mentions: dedupe(text.match(MENTION_RE) ?? []),
    urls: dedupe(text.match(URL_RE) ?? []),
    codeBlocks,
    filePaths: dedupe((strippedText.match(FILE_PATH_RE) ?? []).map(s => s.trim())),
    dates: dedupe(strippedText.match(DATE_RE) ?? []),
    emails: dedupe(text.match(EMAIL_RE) ?? []),
    hashtags: dedupe(text.match(HASHTAG_RE) ?? []),
  };
}

// ─── Profanity Filter ─────────────────────────────────────────────────────────

// Minimal word lists — extend via environment or config in production
const PROFANITY: Record<ProfanitySeverity, RegExp[]> = {
  none: [],
  mild: [/\b(damn|crap|hell|ass)\b/i],
  moderate: [/\b(shit|bastard|bitch)\b/i],
  severe: [/\b(f+u+c+k+|c+u+n+t+|n+i+g+g+|k+i+k+e+)\b/i],
};

const SEVERITY_ORDER: ProfanitySeverity[] = ["none", "mild", "moderate", "severe"];

function scoreProfanity(text: string): ProfanitySeverity {
  for (let i = SEVERITY_ORDER.length - 1; i >= 0; i--) {
    const sev = SEVERITY_ORDER[i];
    for (const re of PROFANITY[sev]) {
      if (re.test(text)) return sev;
    }
  }
  return "none";
}

// ─── Session Deduplication ────────────────────────────────────────────────────

interface DedupEntry {
  hash: string;
  ts: number;
}

const sessionDedupMap = new Map<string, DedupEntry[]>();

function simpleHash(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = (Math.imul(31, h) + text.charCodeAt(i)) >>> 0;
  }
  return h.toString(16);
}

function isDuplicate(
  sessionId: string,
  normalizedText: string,
  windowMs: number,
  maxHistory: number,
): boolean {
  const hash = simpleHash(normalizedText.toLowerCase());
  const now = Date.now();
  const history = sessionDedupMap.get(sessionId) ?? [];

  // Evict stale entries
  const fresh = history.filter(e => now - e.ts < windowMs).slice(-maxHistory);
  const dup = fresh.some(e => e.hash === hash);

  fresh.push({ hash, ts: now });
  sessionDedupMap.set(sessionId, fresh.slice(-maxHistory));

  return dup;
}

// ─── MessagePreprocessor Class ────────────────────────────────────────────────

const DEFAULT_CONFIG: PreprocessorConfig = {
  maxDedupWindowMs: 60_000,
  maxDedupHistory: 50,
  profanityEnabled: true,
  profanityBlockThreshold: "severe",
};

export class MessagePreprocessor {
  private config: PreprocessorConfig;

  constructor(config: Partial<PreprocessorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  process(rawText: string, sessionId: string = "default"): EnrichedMessage {
    const t0 = Date.now();

    // 1. Normalize
    const normalizedText = this.normalize(rawText);

    // 2. Language detection
    const { language, confidence: langConf } = detectLanguage(normalizedText);

    // 3. Intent classification
    const { intent, confidence: intentConf } = classifyIntent(normalizedText);

    // 4. Entity extraction
    const entities = extractEntities(rawText); // run on raw to preserve URLs etc.

    // 5. Profanity
    const profanitySeverity = this.config.profanityEnabled
      ? scoreProfanity(normalizedText)
      : "none";

    const isBlocked = this.isAboveProfanityThreshold(profanitySeverity);

    // 6. Deduplication
    const isDup = isDuplicate(
      sessionId,
      normalizedText,
      this.config.maxDedupWindowMs,
      this.config.maxDedupHistory,
    );

    const result: EnrichedMessage = {
      originalText: rawText,
      normalizedText,
      language,
      languageConfidence: langConf,
      intent,
      intentConfidence: intentConf,
      entities,
      profanitySeverity,
      isBlocked,
      blockReason: isBlocked ? `profanity:${profanitySeverity}` : undefined,
      isDuplicate: isDup,
      wordCount: normalizedText.split(/\s+/).filter(Boolean).length,
      charCount: normalizedText.length,
      hasCode: entities.codeBlocks.length > 0,
      hasUrls: entities.urls.length > 0,
      processingMs: Date.now() - t0,
      metadata: {
        sessionId,
        entityCount:
          entities.mentions.length +
          entities.urls.length +
          entities.codeBlocks.length +
          entities.filePaths.length +
          entities.dates.length,
        processedAt: new Date().toISOString(),
      },
    };

    log.debug("message_preprocessed", {
      sessionId,
      language,
      intent,
      isDuplicate: isDup,
      isBlocked,
      processingMs: result.processingMs,
    });

    return result;
  }

  private normalize(text: string): string {
    return text
      .normalize("NFC")
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .replace(/\s{3,}/g, "  ")
      .trim();
  }

  private isAboveProfanityThreshold(severity: ProfanitySeverity): boolean {
    const threshold = SEVERITY_ORDER.indexOf(this.config.profanityBlockThreshold);
    const actual = SEVERITY_ORDER.indexOf(severity);
    return actual >= threshold && threshold > 0;
  }

  /** Evict all dedup state for a session (e.g. on logout) */
  clearSession(sessionId: string): void {
    sessionDedupMap.delete(sessionId);
  }
}

export const messagePreprocessor = new MessagePreprocessor();
