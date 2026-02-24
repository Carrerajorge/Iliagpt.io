/**
 * Prompt Pre-Processor Pipeline
 *
 * Runs fast, deterministic transformations on user input before
 * it reaches the LLM or PromptUnderstanding module.
 *
 * Pipeline stages (total < 2ms for typical prompts):
 * 1. NFC Unicode normalization
 * 2. Language/script detection
 * 3. Structure type analysis
 * 4. Deduplication detection
 * 5. Whitespace normalization (logged, never silent)
 */

import * as crypto from "crypto";

// ── Types ──────────────────────────────────────────────────

export type ScriptType = "latin" | "cjk" | "arabic" | "cyrillic" | "devanagari" | "emoji" | "other";
export type StructureType = "freeform" | "structured" | "code_heavy" | "data_heavy" | "mixed";
export type LanguageHint = "en" | "es" | "zh" | "ar" | "ru" | "hi" | "ja" | "ko" | "fr" | "de" | "pt" | "unknown";

export interface LanguageDetection {
  primaryLanguage: LanguageHint;
  isMultiLingual: boolean;
  scripts: ScriptType[];
  scriptDistribution: Record<ScriptType, number>;
}

export interface StructureAnalysis {
  type: StructureType;
  hasCodeBlocks: boolean;
  hasUrls: boolean;
  hasJson: boolean;
  hasMarkdown: boolean;
  hasTables: boolean;
  codeBlockCount: number;
  urlCount: number;
}

export interface WhitespaceNormalization {
  applied: boolean;
  crlfConverted: number;
  excessNewlinesCollapsed: number;
  trailingWhitespaceRemoved: number;
  originalLen: number;
  normalizedLen: number;
}

export interface PreProcessResult {
  text: string;
  originalText: string;
  nfcApplied: boolean;
  language: LanguageDetection;
  structure: StructureAnalysis;
  isDuplicate: boolean;
  duplicateHash: string;
  whitespace: WhitespaceNormalization;
  processingTimeMs: number;
}

// ── Script Detection Regexes ───────────────────────────────

const SCRIPT_PATTERNS: Array<[ScriptType, RegExp]> = [
  ["cjk", /[\u4e00-\u9fff\u3400-\u4dbf\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/g],
  ["arabic", /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff\ufb50-\ufdff\ufe70-\ufeff]/g],
  ["cyrillic", /[\u0400-\u04ff\u0500-\u052f\u2de0-\u2dff\ua640-\ua69f]/g],
  ["devanagari", /[\u0900-\u097f\ua8e0-\ua8ff]/g],
  ["emoji", /[\u{1f300}-\u{1f9ff}\u{2600}-\u{26ff}\u{2700}-\u{27bf}]/gu],
  ["latin", /[a-zA-Z\u00c0-\u024f\u1e00-\u1eff]/g],
];

// Language hint patterns (simple keyword/char frequency heuristic)
const LANG_HINTS: Array<[LanguageHint, RegExp]> = [
  ["zh", /[\u4e00-\u9fff]{3,}/],
  ["ja", /[\u3040-\u309f\u30a0-\u30ff]{2,}/],
  ["ko", /[\uac00-\ud7af]{2,}/],
  ["ar", /[\u0600-\u06ff]{3,}/],
  ["ru", /[\u0400-\u04ff]{3,}/],
  ["hi", /[\u0900-\u097f]{3,}/],
  ["es", /\b(el|la|los|las|de|en|que|por|con|para|como|pero|más|también|porque|cuando|donde|entre|sobre|según)\b/i],
  ["fr", /\b(le|la|les|de|des|du|un|une|et|est|que|pour|dans|avec|sur|pas|plus|son|mais|aussi)\b/i],
  ["de", /\b(der|die|das|den|dem|des|ein|eine|und|ist|von|zu|mit|auf|für|nicht|sich|auch|als|noch)\b/i],
  ["pt", /\b(o|a|os|as|de|do|da|em|no|na|que|para|com|por|como|mas|mais|também|quando|onde)\b/i],
  ["en", /\b(the|is|are|was|were|have|has|had|been|being|will|would|could|should|can|may|might|must|shall)\b/i],
];

// Structure detection patterns
const CODE_BLOCK_RE = /```[\s\S]*?```/g;
const URL_RE = /https?:\/\/[^\s<>"')\]]+/g;
const JSON_BLOCK_RE = /\{[\s\S]*?"[\w]+"[\s\S]*?:[\s\S]*?\}/g;
const MARKDOWN_RE = /^#{1,6}\s|^\*\s|^-\s|^\d+\.\s|\*\*.*?\*\*|__.*?__/m;
const TABLE_RE = /\|.*?\|.*?\|/;

// ── Pre-Processor Class ────────────────────────────────────

export class PromptPreProcessor {
  private recentHashes: string[] = [];
  private maxRecentHashes = 5;

  /**
   * Run the full pre-processing pipeline on the input text.
   */
  process(text: string, conversationHashes?: string[]): PreProcessResult {
    const start = performance.now();
    const originalText = text;

    // 1. NFC Normalization
    const nfcText = text.normalize("NFC");
    const nfcApplied = nfcText !== text;
    text = nfcText;

    // 2. Language/Script Detection
    const language = this.detectLanguage(text);

    // 3. Structure Analysis
    const structure = this.analyzeStructure(text);

    // 4. Deduplication
    const duplicateHash = crypto.createHash("md5").update(text).digest("hex");
    const hashPool = conversationHashes || this.recentHashes;
    const isDuplicate = hashPool.includes(duplicateHash);

    // Update recent hashes
    this.recentHashes.push(duplicateHash);
    if (this.recentHashes.length > this.maxRecentHashes) {
      this.recentHashes.shift();
    }

    // 5. Whitespace Normalization
    const wsResult = this.normalizeWhitespace(text);
    text = wsResult.text;

    return {
      text,
      originalText,
      nfcApplied,
      language,
      structure,
      isDuplicate,
      duplicateHash,
      whitespace: wsResult.metadata,
      processingTimeMs: performance.now() - start,
    };
  }

  private detectLanguage(text: string): LanguageDetection {
    const distribution: Record<ScriptType, number> = {
      latin: 0, cjk: 0, arabic: 0, cyrillic: 0, devanagari: 0, emoji: 0, other: 0,
    };

    let totalChars = 0;
    for (const [script, pattern] of SCRIPT_PATTERNS) {
      const matches = text.match(pattern);
      if (matches) {
        distribution[script] = matches.length;
        totalChars += matches.length;
      }
    }

    const scripts: ScriptType[] = [];
    for (const [script, count] of Object.entries(distribution) as [ScriptType, number][]) {
      if (count > 0) scripts.push(script);
    }

    // Determine primary language from keyword hints
    let primaryLanguage: LanguageHint = "unknown";
    let bestScore = 0;
    for (const [lang, pattern] of LANG_HINTS) {
      const matches = text.match(new RegExp(pattern.source, "gi"));
      const score = matches ? matches.length : 0;
      if (score > bestScore) {
        bestScore = score;
        primaryLanguage = lang;
      }
    }

    const isMultiLingual = scripts.filter(s => s !== "emoji" && s !== "other").length > 1;

    return { primaryLanguage, isMultiLingual, scripts, scriptDistribution: distribution };
  }

  private analyzeStructure(text: string): StructureAnalysis {
    const codeBlocks = text.match(CODE_BLOCK_RE);
    const urls = text.match(URL_RE);
    const hasJson = JSON_BLOCK_RE.test(text);
    const hasMarkdown = MARKDOWN_RE.test(text);
    const hasTables = TABLE_RE.test(text);

    const codeBlockCount = codeBlocks?.length || 0;
    const urlCount = urls?.length || 0;

    // Determine structure type
    let type: StructureType = "freeform";
    const codeCharRatio = codeBlocks
      ? codeBlocks.reduce((sum, b) => sum + b.length, 0) / text.length
      : 0;

    if (codeCharRatio > 0.5) {
      type = "code_heavy";
    } else if (hasJson && text.length > 200) {
      type = "data_heavy";
    } else if (hasMarkdown || hasTables) {
      type = codeBlockCount > 0 ? "mixed" : "structured";
    } else if (codeBlockCount > 0) {
      type = "mixed";
    }

    return {
      type,
      hasCodeBlocks: codeBlockCount > 0,
      hasUrls: urlCount > 0,
      hasJson,
      hasMarkdown,
      hasTables,
      codeBlockCount,
      urlCount,
    };
  }

  private normalizeWhitespace(text: string): { text: string; metadata: WhitespaceNormalization } {
    const originalLen = text.length;
    let crlfConverted = 0;
    let excessNewlinesCollapsed = 0;
    let trailingWhitespaceRemoved = 0;

    // Convert \r\n → \n
    const crlfResult = text.replace(/\r\n/g, () => { crlfConverted++; return "\n"; });
    // Convert standalone \r → \n
    const crResult = crlfResult.replace(/\r/g, () => { crlfConverted++; return "\n"; });

    // Collapse 3+ consecutive newlines → 2
    const collapsedResult = crResult.replace(/\n{3,}/g, (match) => {
      excessNewlinesCollapsed += match.length - 2;
      return "\n\n";
    });

    // Trim trailing whitespace per line
    const trimmedResult = collapsedResult.replace(/[ \t]+$/gm, (match) => {
      trailingWhitespaceRemoved += match.length;
      return "";
    });

    const applied = crlfConverted > 0 || excessNewlinesCollapsed > 0 || trailingWhitespaceRemoved > 0;

    return {
      text: trimmedResult,
      metadata: {
        applied,
        crlfConverted,
        excessNewlinesCollapsed,
        trailingWhitespaceRemoved,
        originalLen,
        normalizedLen: trimmedResult.length,
      },
    };
  }

  /** Reset dedup tracking (e.g., new conversation). */
  reset(): void {
    this.recentHashes = [];
  }
}

export const promptPreProcessor = new PromptPreProcessor();
