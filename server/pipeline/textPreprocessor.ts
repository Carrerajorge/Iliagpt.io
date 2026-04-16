import { z } from "zod";

export const QualityFlagSchema = z.enum([
  "ok",
  "too_short",
  "too_long",
  "garbage_input",
  "only_symbols",
  "high_entropy",
  "repeated_chars",
  "spam_like",
  "contains_code",
  "contains_url"
]);
export type QualityFlag = z.infer<typeof QualityFlagSchema>;

export const PreprocessResultSchema = z.object({
  normalizedText: z.string(),
  originalText: z.string(),
  language: z.string(),
  languageConfidence: z.number().min(0).max(1),
  qualityFlags: z.array(QualityFlagSchema),
  qualityScore: z.number().min(0).max(1),
  wordCount: z.number(),
  charCount: z.number(),
  containsCode: z.boolean(),
  containsUrl: z.boolean(),
  preprocessingTimeMs: z.number()
});
export type PreprocessResult = z.infer<typeof PreprocessResultSchema>;

const NOISE_PATTERNS = {
  repeatedChars: /(.)\1{4,}/g,
  excessiveWhitespace: /\s{3,}/g,
  controlChars: /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g,
  unicodeControlChars: /[\u200B-\u200D\uFEFF]/g
};

const URL_PATTERN = /https?:\/\/[^\s]+|www\.[^\s]+/gi;
const CODE_PATTERN = /```[\s\S]*?```|`[^`]+`|function\s*\(|const\s+\w+\s*=|import\s+\{|export\s+(default\s+)?/;
const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

const LANGUAGE_INDICATORS: Record<string, RegExp[]> = {
  es: [
    /\b(qu[eé]|c[oó]mo|d[oó]nde|cu[aá]ndo|por\s+qu[eé]|para\s+qu[eé])\b/i,
    /\b(el|la|los|las|un|una|unos|unas)\s+\w+/i,
    /\b(est[aá]|son|ser[aá]|tiene|puede|quiero|necesito|busco)\b/i,
    /[áéíóúñü¿¡]/i
  ],
  en: [
    /\b(what|where|when|why|how|which|who)\b/i,
    /\b(the|a|an)\s+\w+/i,
    /\b(is|are|was|were|have|has|can|could|would|should)\b/i,
    /\b(I'm|you're|we're|they're|it's|don't|doesn't|won't|can't)\b/i
  ]
};

export class TextPreprocessor {
  private spellCheckEnabled: boolean;

  constructor(enableSpellCheck: boolean = false) {
    this.spellCheckEnabled = enableSpellCheck;
  }

  process(text: string): PreprocessResult {
    const startTime = Date.now();
    const original = text;

    let normalized = this.normalize(text);
    const qualityFlags: QualityFlag[] = [];
    
    const wordCount = this.countWords(normalized);
    const charCount = normalized.length;

    if (charCount < 2) {
      qualityFlags.push("too_short");
    }
    if (charCount > 10000) {
      qualityFlags.push("too_long");
    }

    const containsUrl = URL_PATTERN.test(normalized);
    if (containsUrl) {
      qualityFlags.push("contains_url");
    }

    const containsCode = CODE_PATTERN.test(normalized);
    if (containsCode) {
      qualityFlags.push("contains_code");
    }

    if (this.isOnlySymbols(normalized)) {
      qualityFlags.push("only_symbols");
    }

    if (this.hasHighEntropy(normalized)) {
      qualityFlags.push("high_entropy");
    }

    if (NOISE_PATTERNS.repeatedChars.test(normalized)) {
      qualityFlags.push("repeated_chars");
      normalized = this.collapseRepeatedChars(normalized);
    }

    if (this.isGarbageInput(normalized, qualityFlags)) {
      qualityFlags.push("garbage_input");
    }

    const { language, confidence } = this.detectLanguage(normalized);

    const qualityScore = this.calculateQualityScore(normalized, qualityFlags);

    if (qualityFlags.length === 0) {
      qualityFlags.push("ok");
    }

    return {
      normalizedText: normalized.trim(),
      originalText: original,
      language,
      languageConfidence: confidence,
      qualityFlags,
      qualityScore,
      wordCount,
      charCount: normalized.trim().length,
      containsCode,
      containsUrl,
      preprocessingTimeMs: Date.now() - startTime
    };
  }

  private normalize(text: string): string {
    let result = text
      .normalize("NFKC")
      .replace(NOISE_PATTERNS.controlChars, "")
      .replace(NOISE_PATTERNS.unicodeControlChars, "")
      .replace(NOISE_PATTERNS.excessiveWhitespace, " ");

    return result;
  }

  private countWords(text: string): number {
    return text.split(/\s+/).filter(word => word.length > 0).length;
  }

  private isOnlySymbols(text: string): boolean {
    const withoutSymbols = text.replace(/[^\p{L}\p{N}\s]/gu, "").trim();
    return withoutSymbols.length === 0 && text.trim().length > 0;
  }

  private hasHighEntropy(text: string): boolean {
    if (text.length < 10) return false;
    
    const charFreq = new Map<string, number>();
    for (const char of text.toLowerCase()) {
      charFreq.set(char, (charFreq.get(char) || 0) + 1);
    }

    const uniqueRatio = charFreq.size / text.length;
    return uniqueRatio > 0.9 && text.length > 20;
  }

  private collapseRepeatedChars(text: string): string {
    return text.replace(/(.)\1{3,}/g, "$1$1");
  }

  private isGarbageInput(text: string, flags: QualityFlag[]): boolean {
    if (flags.includes("only_symbols")) return true;
    if (flags.includes("high_entropy") && text.length > 50) return true;
    
    const alphanumericRatio = (text.match(/[\p{L}\p{N}]/gu) || []).length / Math.max(text.length, 1);
    return alphanumericRatio < 0.3 && text.length > 10;
  }

  private detectLanguage(text: string): { language: string; confidence: number } {
    const cleanText = text.replace(URL_PATTERN, "").replace(EMAIL_PATTERN, "");
    
    let esScore = 0;
    let enScore = 0;

    for (const pattern of LANGUAGE_INDICATORS.es) {
      if (pattern.test(cleanText)) esScore++;
    }
    for (const pattern of LANGUAGE_INDICATORS.en) {
      if (pattern.test(cleanText)) enScore++;
    }

    if (/[áéíóúñü¿¡]/.test(cleanText)) {
      esScore += 2;
    }

    const totalIndicators = esScore + enScore;
    if (totalIndicators === 0) {
      return { language: "unknown", confidence: 0.5 };
    }

    if (esScore > enScore) {
      return { 
        language: "es", 
        confidence: Math.min(0.95, 0.5 + (esScore / (totalIndicators * 2)))
      };
    } else if (enScore > esScore) {
      return { 
        language: "en", 
        confidence: Math.min(0.95, 0.5 + (enScore / (totalIndicators * 2)))
      };
    }

    return { language: "auto", confidence: 0.5 };
  }

  private calculateQualityScore(text: string, flags: QualityFlag[]): number {
    let score = 1.0;

    const penaltyMap: Record<QualityFlag, number> = {
      ok: 0,
      too_short: 0.2,
      too_long: 0.1,
      garbage_input: 0.8,
      only_symbols: 0.7,
      high_entropy: 0.4,
      repeated_chars: 0.15,
      spam_like: 0.5,
      contains_code: 0,
      contains_url: 0.05
    };

    for (const flag of flags) {
      score -= penaltyMap[flag] || 0;
    }

    return Math.max(0, Math.min(1, score));
  }

  extractUrls(text: string): string[] {
    return text.match(URL_PATTERN) || [];
  }

  extractEmails(text: string): string[] {
    return text.match(EMAIL_PATTERN) || [];
  }

  removeUrls(text: string): string {
    return text.replace(URL_PATTERN, "[URL]").trim();
  }

  truncate(text: string, maxLength: number, suffix: string = "..."): string {
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength - suffix.length) + suffix;
  }
}

export const textPreprocessor = new TextPreprocessor();
