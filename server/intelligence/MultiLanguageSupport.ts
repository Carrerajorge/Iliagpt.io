/**
 * MultiLanguageSupport — 50+ language detection, auto-respond in user's language,
 * cross-lingual search, cultural context (date/number formats), technical term translation.
 */

import Anthropic from "@anthropic-ai/sdk";
import { createLogger } from "../utils/logger";

const logger = createLogger("MultiLanguageSupport");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LanguageProfile {
  code: string;               // ISO 639-1 (e.g. "es", "fr", "zh")
  name: string;               // English name
  nativeName: string;         // Name in that language
  rtl: boolean;               // Right-to-left
  dateFormat: string;         // e.g. "DD/MM/YYYY"
  numberFormat: { decimal: string; thousands: string };
  formality: "formal" | "informal" | "both";
}

export interface DetectionResult {
  language: string;           // ISO 639-1 code
  confidence: number;         // 0.0-1.0
  languageName: string;
  isRtl: boolean;
  profile: LanguageProfile;
}

export interface TranslationResult {
  originalText: string;
  translatedText: string;
  fromLanguage: string;
  toLanguage: string;
  confidence: number;
}

export interface CulturalContext {
  language: string;
  dateFormat: string;
  numberExample: string;
  culturalNotes: string[];
}

// ─── Language Registry ────────────────────────────────────────────────────────

export const LANGUAGE_PROFILES: Record<string, LanguageProfile> = {
  en: { code: "en", name: "English", nativeName: "English", rtl: false, dateFormat: "MM/DD/YYYY", numberFormat: { decimal: ".", thousands: "," }, formality: "both" },
  es: { code: "es", name: "Spanish", nativeName: "Español", rtl: false, dateFormat: "DD/MM/YYYY", numberFormat: { decimal: ",", thousands: "." }, formality: "both" },
  fr: { code: "fr", name: "French", nativeName: "Français", rtl: false, dateFormat: "DD/MM/YYYY", numberFormat: { decimal: ",", thousands: " " }, formality: "formal" },
  de: { code: "de", name: "German", nativeName: "Deutsch", rtl: false, dateFormat: "DD.MM.YYYY", numberFormat: { decimal: ",", thousands: "." }, formality: "formal" },
  pt: { code: "pt", name: "Portuguese", nativeName: "Português", rtl: false, dateFormat: "DD/MM/YYYY", numberFormat: { decimal: ",", thousands: "." }, formality: "both" },
  it: { code: "it", name: "Italian", nativeName: "Italiano", rtl: false, dateFormat: "DD/MM/YYYY", numberFormat: { decimal: ",", thousands: "." }, formality: "both" },
  nl: { code: "nl", name: "Dutch", nativeName: "Nederlands", rtl: false, dateFormat: "DD-MM-YYYY", numberFormat: { decimal: ",", thousands: "." }, formality: "both" },
  ru: { code: "ru", name: "Russian", nativeName: "Русский", rtl: false, dateFormat: "DD.MM.YYYY", numberFormat: { decimal: ",", thousands: " " }, formality: "formal" },
  zh: { code: "zh", name: "Chinese", nativeName: "中文", rtl: false, dateFormat: "YYYY/MM/DD", numberFormat: { decimal: ".", thousands: "," }, formality: "formal" },
  ja: { code: "ja", name: "Japanese", nativeName: "日本語", rtl: false, dateFormat: "YYYY/MM/DD", numberFormat: { decimal: ".", thousands: "," }, formality: "formal" },
  ko: { code: "ko", name: "Korean", nativeName: "한국어", rtl: false, dateFormat: "YYYY.MM.DD", numberFormat: { decimal: ".", thousands: "," }, formality: "formal" },
  ar: { code: "ar", name: "Arabic", nativeName: "العربية", rtl: true, dateFormat: "DD/MM/YYYY", numberFormat: { decimal: ".", thousands: "," }, formality: "formal" },
  he: { code: "he", name: "Hebrew", nativeName: "עברית", rtl: true, dateFormat: "DD/MM/YYYY", numberFormat: { decimal: ".", thousands: "," }, formality: "both" },
  fa: { code: "fa", name: "Persian", nativeName: "فارسی", rtl: true, dateFormat: "YYYY/MM/DD", numberFormat: { decimal: ".", thousands: "," }, formality: "formal" },
  tr: { code: "tr", name: "Turkish", nativeName: "Türkçe", rtl: false, dateFormat: "DD.MM.YYYY", numberFormat: { decimal: ",", thousands: "." }, formality: "both" },
  pl: { code: "pl", name: "Polish", nativeName: "Polski", rtl: false, dateFormat: "DD.MM.YYYY", numberFormat: { decimal: ",", thousands: " " }, formality: "formal" },
  sv: { code: "sv", name: "Swedish", nativeName: "Svenska", rtl: false, dateFormat: "YYYY-MM-DD", numberFormat: { decimal: ",", thousands: " " }, formality: "both" },
  no: { code: "no", name: "Norwegian", nativeName: "Norsk", rtl: false, dateFormat: "DD.MM.YYYY", numberFormat: { decimal: ",", thousands: " " }, formality: "both" },
  da: { code: "da", name: "Danish", nativeName: "Dansk", rtl: false, dateFormat: "DD.MM.YYYY", numberFormat: { decimal: ",", thousands: "." }, formality: "both" },
  fi: { code: "fi", name: "Finnish", nativeName: "Suomi", rtl: false, dateFormat: "DD.MM.YYYY", numberFormat: { decimal: ",", thousands: " " }, formality: "formal" },
  cs: { code: "cs", name: "Czech", nativeName: "Čeština", rtl: false, dateFormat: "DD.MM.YYYY", numberFormat: { decimal: ",", thousands: " " }, formality: "formal" },
  hu: { code: "hu", name: "Hungarian", nativeName: "Magyar", rtl: false, dateFormat: "YYYY.MM.DD", numberFormat: { decimal: ",", thousands: " " }, formality: "formal" },
  ro: { code: "ro", name: "Romanian", nativeName: "Română", rtl: false, dateFormat: "DD.MM.YYYY", numberFormat: { decimal: ",", thousands: "." }, formality: "both" },
  uk: { code: "uk", name: "Ukrainian", nativeName: "Українська", rtl: false, dateFormat: "DD.MM.YYYY", numberFormat: { decimal: ",", thousands: " " }, formality: "formal" },
  vi: { code: "vi", name: "Vietnamese", nativeName: "Tiếng Việt", rtl: false, dateFormat: "DD/MM/YYYY", numberFormat: { decimal: ",", thousands: "." }, formality: "both" },
  th: { code: "th", name: "Thai", nativeName: "ภาษาไทย", rtl: false, dateFormat: "DD/MM/YYYY", numberFormat: { decimal: ".", thousands: "," }, formality: "formal" },
  id: { code: "id", name: "Indonesian", nativeName: "Bahasa Indonesia", rtl: false, dateFormat: "DD/MM/YYYY", numberFormat: { decimal: ",", thousands: "." }, formality: "both" },
  ms: { code: "ms", name: "Malay", nativeName: "Bahasa Melayu", rtl: false, dateFormat: "DD/MM/YYYY", numberFormat: { decimal: ".", thousands: "," }, formality: "both" },
  hi: { code: "hi", name: "Hindi", nativeName: "हिन्दी", rtl: false, dateFormat: "DD/MM/YYYY", numberFormat: { decimal: ".", thousands: "," }, formality: "formal" },
  bn: { code: "bn", name: "Bengali", nativeName: "বাংলা", rtl: false, dateFormat: "DD/MM/YYYY", numberFormat: { decimal: ".", thousands: "," }, formality: "formal" },
  ur: { code: "ur", name: "Urdu", nativeName: "اردو", rtl: true, dateFormat: "DD/MM/YYYY", numberFormat: { decimal: ".", thousands: "," }, formality: "formal" },
  el: { code: "el", name: "Greek", nativeName: "Ελληνικά", rtl: false, dateFormat: "DD/MM/YYYY", numberFormat: { decimal: ",", thousands: "." }, formality: "both" },
  bg: { code: "bg", name: "Bulgarian", nativeName: "Български", rtl: false, dateFormat: "DD.MM.YYYY", numberFormat: { decimal: ",", thousands: " " }, formality: "formal" },
  hr: { code: "hr", name: "Croatian", nativeName: "Hrvatski", rtl: false, dateFormat: "DD.MM.YYYY", numberFormat: { decimal: ",", thousands: "." }, formality: "formal" },
  sk: { code: "sk", name: "Slovak", nativeName: "Slovenčina", rtl: false, dateFormat: "DD.MM.YYYY", numberFormat: { decimal: ",", thousands: " " }, formality: "formal" },
  sl: { code: "sl", name: "Slovenian", nativeName: "Slovenščina", rtl: false, dateFormat: "DD.MM.YYYY", numberFormat: { decimal: ",", thousands: "." }, formality: "formal" },
  ca: { code: "ca", name: "Catalan", nativeName: "Català", rtl: false, dateFormat: "DD/MM/YYYY", numberFormat: { decimal: ",", thousands: "." }, formality: "both" },
  lt: { code: "lt", name: "Lithuanian", nativeName: "Lietuvių", rtl: false, dateFormat: "YYYY-MM-DD", numberFormat: { decimal: ",", thousands: " " }, formality: "formal" },
  lv: { code: "lv", name: "Latvian", nativeName: "Latviešu", rtl: false, dateFormat: "DD.MM.YYYY", numberFormat: { decimal: ",", thousands: " " }, formality: "formal" },
  et: { code: "et", name: "Estonian", nativeName: "Eesti", rtl: false, dateFormat: "DD.MM.YYYY", numberFormat: { decimal: ",", thousands: " " }, formality: "formal" },
  af: { code: "af", name: "Afrikaans", nativeName: "Afrikaans", rtl: false, dateFormat: "YYYY/MM/DD", numberFormat: { decimal: ",", thousands: " " }, formality: "both" },
  sw: { code: "sw", name: "Swahili", nativeName: "Kiswahili", rtl: false, dateFormat: "DD/MM/YYYY", numberFormat: { decimal: ".", thousands: "," }, formality: "both" },
  tl: { code: "tl", name: "Filipino", nativeName: "Filipino", rtl: false, dateFormat: "MM/DD/YYYY", numberFormat: { decimal: ".", thousands: "," }, formality: "both" },
  is: { code: "is", name: "Icelandic", nativeName: "Íslenska", rtl: false, dateFormat: "DD.MM.YYYY", numberFormat: { decimal: ",", thousands: "." }, formality: "both" },
};

// ─── Heuristic Detection ──────────────────────────────────────────────────────

// Script-based character set detection (fast, no API)
const SCRIPT_PATTERNS: Array<[string, RegExp]> = [
  ["zh", /[\u4e00-\u9fff\u3400-\u4dbf]/],
  ["ja", /[\u3040-\u309f\u30a0-\u30ff]/],
  ["ko", /[\uac00-\ud7af\u1100-\u11ff]/],
  ["ar", /[\u0600-\u06ff]/],
  ["he", /[\u0590-\u05ff]/],
  ["ru", /[\u0400-\u04ff]/],
  ["uk", /[\u0400-\u04ff\u0491\u0490]/],
  ["el", /[\u0370-\u03ff]/],
  ["th", /[\u0e00-\u0e7f]/],
  ["hi", /[\u0900-\u097f]/],
  ["bn", /[\u0980-\u09ff]/],
  ["fa", /[\u0600-\u06ff\u0750-\u077f]/],
];

// Common word patterns per language
const WORD_PATTERNS: Array<[string, RegExp]> = [
  ["es", /\b(que|de|el|la|en|y|los|las|por|para|con|una|tiene|puede|sobre|como)\b/gi],
  ["fr", /\b(que|de|le|la|les|et|en|un|une|des|sur|avec|pour|dans|est)\b/gi],
  ["pt", /\b(que|de|o|a|os|as|em|do|da|para|com|uma|por|como|mas|se)\b/gi],
  ["de", /\b(der|die|das|und|in|zu|mit|von|für|ist|nicht|auch|auf|er|sie|es)\b/gi],
  ["it", /\b(che|di|il|la|le|e|in|un|una|del|della|per|con|non|si|è)\b/gi],
  ["nl", /\b(de|het|een|in|van|te|en|met|zijn|dat|op|voor|aan|er|niet)\b/gi],
  ["sv", /\b(och|i|att|en|det|av|på|är|som|för|den|med|inte|till|har)\b/gi],
  ["no", /\b(og|i|å|en|et|av|på|er|som|for|den|med|ikke|til|har|vi)\b/gi],
  ["da", /\b(og|i|at|en|et|af|på|er|som|for|den|med|ikke|til|har|vi)\b/gi],
  ["pl", /\b(i|w|z|na|że|się|do|nie|to|jest|jak|co|po|ale|już)\b/gi],
  ["tr", /\b(ve|bir|bu|da|için|ile|ne|var|ya|daha|çok|çok|gibi|ama|ben)\b/gi],
  ["id", /\b(yang|dan|di|dengan|untuk|tidak|ini|itu|dari|ke|ada|saya|juga|sudah|bisa)\b/gi],
];

function detectHeuristic(text: string): { code: string; confidence: number } | null {
  // Script detection (high confidence for non-Latin scripts)
  for (const [code, pattern] of SCRIPT_PATTERNS) {
    const matches = text.match(pattern);
    if (matches && matches.length > 2) {
      return { code, confidence: 0.95 };
    }
  }

  // Word frequency detection for Latin scripts
  let best = { code: "en", count: 0 };
  for (const [code, pattern] of WORD_PATTERNS) {
    const count = (text.match(pattern) ?? []).length;
    if (count > best.count) best = { code, count };
  }

  if (best.count >= 3) {
    const confidence = Math.min(0.5 + best.count * 0.05, 0.9);
    return { code: best.code, confidence };
  }

  return null;
}

// ─── LLM Detection ────────────────────────────────────────────────────────────

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function detectWithLLM(text: string): Promise<{ code: string; confidence: number } | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 50,
      messages: [
        {
          role: "user",
          content: `What language is this text? Reply with ISO 639-1 code and confidence 0-1.
Text: "${text.slice(0, 200)}"
JSON: {"code": "xx", "confidence": 0.0}`,
        },
      ],
    });

    const raw = response.content[0]?.type === "text" ? response.content[0].text : "{}";
    const match = raw.match(/\{[^}]+\}/);
    const parsed = JSON.parse(match?.[0] ?? "{}") as { code?: string; confidence?: number };
    if (parsed.code && parsed.confidence) return { code: parsed.code, confidence: parsed.confidence };
    return null;
  } catch {
    return null;
  }
}

// ─── MultiLanguageSupport ─────────────────────────────────────────────────────

export class MultiLanguageSupport {
  private detectionCache = new Map<string, DetectionResult>();

  async detectLanguage(text: string): Promise<DetectionResult> {
    const cacheKey = text.slice(0, 100);
    if (this.detectionCache.has(cacheKey)) return this.detectionCache.get(cacheKey)!;

    // 1. Heuristic (fast)
    let result = detectHeuristic(text);

    // 2. LLM fallback if uncertain
    if (!result || result.confidence < 0.7) {
      const llmResult = await detectWithLLM(text);
      if (llmResult && llmResult.confidence > (result?.confidence ?? 0)) {
        result = llmResult;
      }
    }

    const code = result?.code ?? "en";
    const confidence = result?.confidence ?? 0.5;
    const profile = LANGUAGE_PROFILES[code] ?? LANGUAGE_PROFILES["en"]!;

    const detection: DetectionResult = {
      language: code,
      confidence,
      languageName: profile.name,
      isRtl: profile.rtl,
      profile,
    };

    this.detectionCache.set(cacheKey, detection);
    if (this.detectionCache.size > 1000) {
      const firstKey = this.detectionCache.keys().next().value!;
      this.detectionCache.delete(firstKey);
    }

    return detection;
  }

  /**
   * Build a system prompt instruction to respond in the detected language.
   */
  buildLanguageInstruction(languageCode: string): string {
    const profile = LANGUAGE_PROFILES[languageCode];
    if (!profile || languageCode === "en") return "";

    const parts = [
      `\n\nIMPORTANT: The user is communicating in ${profile.name} (${profile.nativeName}).`,
      `Respond entirely in ${profile.name}.`,
    ];

    if (profile.rtl) {
      parts.push("Note: This is a right-to-left language.");
    }

    if (profile.formality === "formal") {
      parts.push(`Use formal ${profile.name} register.`);
    }

    return parts.join(" ");
  }

  async translate(text: string, targetLanguage: string, sourceLanguage?: string): Promise<TranslationResult> {
    if (!process.env.ANTHROPIC_API_KEY) {
      return { originalText: text, translatedText: text, fromLanguage: sourceLanguage ?? "unknown", toLanguage: targetLanguage, confidence: 0 };
    }

    const sourceName = sourceLanguage ? (LANGUAGE_PROFILES[sourceLanguage]?.name ?? sourceLanguage) : "auto-detected";
    const targetName = LANGUAGE_PROFILES[targetLanguage]?.name ?? targetLanguage;

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: Math.ceil(text.length * 1.5) + 100,
      messages: [
        {
          role: "user",
          content: `Translate from ${sourceName} to ${targetName}. Return ONLY the translation, no explanation.

Text: ${text}`,
        },
      ],
    });

    const translated = response.content[0]?.type === "text" ? response.content[0].text.trim() : text;

    return {
      originalText: text,
      translatedText: translated,
      fromLanguage: sourceLanguage ?? "auto",
      toLanguage: targetLanguage,
      confidence: 0.9,
    };
  }

  /**
   * Translate a search query to English for cross-lingual search.
   */
  async translateQueryToEnglish(query: string, sourceLanguage: string): Promise<string> {
    if (sourceLanguage === "en") return query;
    const result = await this.translate(query, "en", sourceLanguage);
    logger.info(`Query translated ${sourceLanguage}→en: "${query}" → "${result.translatedText}"`);
    return result.translatedText;
  }

  getCulturalContext(languageCode: string): CulturalContext {
    const profile = LANGUAGE_PROFILES[languageCode] ?? LANGUAGE_PROFILES["en"]!;
    const num = profile.numberFormat;

    const culturalNotes: string[] = [];
    if (profile.rtl) culturalNotes.push("Right-to-left text direction");
    if (num.decimal === ",") culturalNotes.push(`Decimal separator: comma (e.g. 3${num.decimal}14)`);
    if (profile.code === "zh" || profile.code === "ja") culturalNotes.push("Dates typically written year-first");

    return {
      language: languageCode,
      dateFormat: profile.dateFormat,
      numberExample: `1${num.thousands}234${num.decimal}56`,
      culturalNotes,
    };
  }

  formatDate(date: Date, languageCode: string): string {
    const profile = LANGUAGE_PROFILES[languageCode] ?? LANGUAGE_PROFILES["en"]!;
    const d = String(date.getDate()).padStart(2, "0");
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const y = String(date.getFullYear());

    return profile.dateFormat
      .replace("DD", d)
      .replace("MM", m)
      .replace("YYYY", y);
  }

  formatNumber(num: number, languageCode: string): string {
    const profile = LANGUAGE_PROFILES[languageCode] ?? LANGUAGE_PROFILES["en"]!;
    const { decimal, thousands } = profile.numberFormat;

    const [intPart, decPart] = num.toFixed(2).split(".");
    const formattedInt = (intPart ?? "0").replace(/\B(?=(\d{3})+(?!\d))/g, thousands);
    return `${formattedInt}${decimal}${decPart}`;
  }

  listLanguages(): LanguageProfile[] {
    return Object.values(LANGUAGE_PROFILES);
  }

  getProfile(code: string): LanguageProfile | null {
    return LANGUAGE_PROFILES[code] ?? null;
  }
}

export const multiLanguageSupport = new MultiLanguageSupport();
