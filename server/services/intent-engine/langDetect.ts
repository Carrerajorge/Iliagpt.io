import { franc } from "franc";
import type { SupportedLocale } from "../../../shared/schemas/intent";

const FRANC_TO_LOCALE: Record<string, SupportedLocale> = {
  spa: "es",
  eng: "en",
  por: "pt",
  fra: "fr",
  deu: "de",
  ita: "it",
  arb: "ar",
  ara: "ar",
  hin: "hi",
  jpn: "ja",
  kor: "ko",
  cmn: "zh",
  zho: "zh",
  rus: "ru",
  tur: "tr",
  ind: "id"
};

const RTL_LOCALES: SupportedLocale[] = ["ar"];

const LOCALE_MARKERS: Record<SupportedLocale, string[]> = {
  es: [
    "crear", "generar", "hacer", "por favor", "sobre", "para", "con",
    "presentacion", "documento", "tabla", "hoja", "resumen", "traducir",
    "buscar", "analizar", "¿", "¡", "el", "la", "los", "las", "un", "una"
  ],
  en: [
    "create", "generate", "make", "please", "about", "for", "with",
    "presentation", "document", "table", "spreadsheet", "summary", "translate",
    "search", "analyze", "the", "a", "an", "is", "are", "was", "were"
  ],
  pt: [
    "criar", "gerar", "fazer", "por favor", "sobre", "para", "com",
    "apresentacao", "documento", "tabela", "planilha", "resumo", "traduzir",
    "buscar", "analisar", "o", "a", "os", "as", "um", "uma", "é", "são"
  ],
  fr: [
    "créer", "générer", "faire", "s'il vous plaît", "sur", "pour", "avec",
    "présentation", "document", "tableau", "feuille", "résumé", "traduire",
    "chercher", "analyser", "le", "la", "les", "un", "une", "est", "sont"
  ],
  de: [
    "erstellen", "generieren", "machen", "bitte", "über", "für", "mit",
    "präsentation", "dokument", "tabelle", "blatt", "zusammenfassung", "übersetzen",
    "suchen", "analysieren", "der", "die", "das", "ein", "eine", "ist", "sind"
  ],
  it: [
    "creare", "generare", "fare", "per favore", "su", "per", "con",
    "presentazione", "documento", "tabella", "foglio", "riassunto", "tradurre",
    "cercare", "analizzare", "il", "la", "i", "le", "un", "una", "è", "sono"
  ],
  ar: [
    "إنشاء", "توليد", "اصنع", "من فضلك", "عن", "ل", "مع",
    "عرض تقديمي", "مستند", "جدول", "ورقة", "ملخص", "ترجم", "ترجمة",
    "بحث", "ابحث", "تحليل", "حلل", "و", "في", "على", "هذا", "هذه"
  ],
  hi: [
    "बनाएं", "उत्पन्न", "करें", "कृपया", "के बारे में", "के लिए", "साथ",
    "प्रस्तुति", "दस्तावेज़", "स्प्रेडशीट", "सारांश", "अनुवाद", "खोज",
    "विश्लेषण", "और", "है", "यह", "मैं", "को", "का", "की", "में"
  ],
  ja: [
    "作成", "生成", "作って", "ください", "について", "ために", "と",
    "プレゼン", "プレゼンテーション", "スライド", "ドキュメント", "スプレッドシート",
    "要約", "翻訳", "検索", "分析", "の", "を", "が", "は", "に", "で"
  ],
  ko: [
    "만들기", "생성", "만들어", "주세요", "에 대해", "위해", "와",
    "프레젠테이션", "슬라이드", "문서", "스프레드시트", "요약", "번역",
    "검색", "분석", "의", "을", "를", "이", "가", "은", "는", "에서"
  ],
  zh: [
    "创建", "生成", "制作", "请", "关于", "为了", "和",
    "演示", "幻灯片", "文档", "电子表格", "摘要", "翻译",
    "搜索", "分析", "的", "了", "是", "在", "我", "你", "他"
  ],
  ru: [
    "создать", "генерировать", "сделать", "пожалуйста", "о", "для", "с",
    "презентация", "документ", "таблица", "резюме", "перевод", "переводить",
    "поиск", "искать", "анализ", "и", "в", "на", "что", "это", "как"
  ],
  tr: [
    "oluştur", "üret", "yap", "lütfen", "hakkında", "için", "ile",
    "sunum", "belge", "tablo", "özet", "çeviri", "çevir",
    "arama", "ara", "analiz", "ve", "bu", "bir", "de", "da", "ne"
  ],
  id: [
    "buat", "hasilkan", "membuat", "tolong", "tentang", "untuk", "dengan",
    "presentasi", "dokumen", "spreadsheet", "ringkasan", "terjemahan", "terjemahkan",
    "pencarian", "cari", "analisis", "dan", "ini", "itu", "di", "yang", "adalah"
  ]
};

const CJK_RANGES = [
  [0x4E00, 0x9FFF],
  [0x3400, 0x4DBF],
  [0x20000, 0x2A6DF],
  [0x2A700, 0x2B73F],
  [0x2B740, 0x2B81F],
  [0x2B820, 0x2CEAF],
  [0xF900, 0xFAFF],
  [0x2F800, 0x2FA1F],
  [0x3040, 0x309F],
  [0x30A0, 0x30FF],
  [0xAC00, 0xD7AF],
  [0x1100, 0x11FF]
];

const ARABIC_RANGE = [0x0600, 0x06FF];
const ARABIC_SUPPLEMENT_RANGE = [0x0750, 0x077F];
const ARABIC_EXTENDED_A_RANGE = [0x08A0, 0x08FF];

const CYRILLIC_RANGE = [0x0400, 0x04FF];
const CYRILLIC_SUPPLEMENT_RANGE = [0x0500, 0x052F];

const DEVANAGARI_RANGE = [0x0900, 0x097F];

export interface LanguageDetectionResult {
  locale: SupportedLocale;
  confidence: number;
  method: "franc" | "markers" | "default" | "script";
  all_scores: Record<SupportedLocale, number>;
  is_rtl: boolean;
}

function isInRange(code: number, ranges: number[][]): boolean {
  return ranges.some(([start, end]) => code >= start && code <= end);
}

function containsScript(text: string, start: number, end: number): boolean {
  for (const char of text) {
    const code = char.codePointAt(0) || 0;
    if (code >= start && code <= end) {
      return true;
    }
  }
  return false;
}

function detectByScript(text: string): SupportedLocale | null {
  let cjkCount = 0;
  let arabicCount = 0;
  let cyrillicCount = 0;
  let devanagariCount = 0;
  let totalChars = 0;
  
  for (const char of text) {
    const code = char.codePointAt(0) || 0;
    totalChars++;
    
    if (isInRange(code, CJK_RANGES)) {
      cjkCount++;
      if (code >= 0x3040 && code <= 0x30FF) {
        return "ja";
      }
      if (code >= 0xAC00 && code <= 0xD7AF || code >= 0x1100 && code <= 0x11FF) {
        return "ko";
      }
    }
    
    if ((code >= ARABIC_RANGE[0] && code <= ARABIC_RANGE[1]) ||
        (code >= ARABIC_SUPPLEMENT_RANGE[0] && code <= ARABIC_SUPPLEMENT_RANGE[1]) ||
        (code >= ARABIC_EXTENDED_A_RANGE[0] && code <= ARABIC_EXTENDED_A_RANGE[1])) {
      arabicCount++;
    }
    
    if ((code >= CYRILLIC_RANGE[0] && code <= CYRILLIC_RANGE[1]) ||
        (code >= CYRILLIC_SUPPLEMENT_RANGE[0] && code <= CYRILLIC_SUPPLEMENT_RANGE[1])) {
      cyrillicCount++;
    }
    
    if (code >= DEVANAGARI_RANGE[0] && code <= DEVANAGARI_RANGE[1]) {
      devanagariCount++;
    }
  }
  
  if (totalChars === 0) return null;
  
  const cjkRatio = cjkCount / totalChars;
  const arabicRatio = arabicCount / totalChars;
  const cyrillicRatio = cyrillicCount / totalChars;
  const devanagariRatio = devanagariCount / totalChars;
  
  if (cjkRatio > 0.3) {
    return "zh";
  }
  if (arabicRatio > 0.3) {
    return "ar";
  }
  if (cyrillicRatio > 0.3) {
    return "ru";
  }
  if (devanagariRatio > 0.3) {
    return "hi";
  }
  
  return null;
}

function countMarkerMatches(text: string, locale: SupportedLocale): number {
  const lowerText = text.toLowerCase();
  const markers = LOCALE_MARKERS[locale];
  let count = 0;
  
  for (const marker of markers) {
    if (lowerText.includes(marker.toLowerCase())) {
      count++;
    }
  }
  
  return count;
}

function getDefaultScores(): Record<SupportedLocale, number> {
  return {
    es: 0, en: 0, pt: 0, fr: 0, de: 0, it: 0,
    ar: 0, hi: 0, ja: 0, ko: 0, zh: 0, ru: 0, tr: 0, id: 0
  };
}

function detectByMarkers(text: string): LanguageDetectionResult {
  const scores = getDefaultScores();
  
  for (const locale of Object.keys(scores) as SupportedLocale[]) {
    scores[locale] = countMarkerMatches(text, locale);
  }
  
  const totalMatches = Object.values(scores).reduce((a, b) => a + b, 0);
  
  if (totalMatches === 0) {
    return {
      locale: "es",
      confidence: 0.5,
      method: "default",
      all_scores: scores,
      is_rtl: false
    };
  }
  
  let bestLocale: SupportedLocale = "es";
  let bestScore = 0;
  
  for (const [locale, score] of Object.entries(scores) as [SupportedLocale, number][]) {
    if (score > bestScore) {
      bestScore = score;
      bestLocale = locale;
    }
  }
  
  const confidence = Math.min(0.95, 0.5 + (bestScore / totalMatches) * 0.45);
  
  return {
    locale: bestLocale,
    confidence,
    method: "markers",
    all_scores: scores,
    is_rtl: RTL_LOCALES.includes(bestLocale)
  };
}

function detectByFranc(text: string): LanguageDetectionResult {
  // Guard against type confusion via parameter tampering (CodeQL: type-confusion)
  if (typeof text !== "string") {
    return { locale: "es", confidence: 0.5, method: "default", all_scores: getDefaultScores(), is_rtl: false };
  }
  const defaultScores = getDefaultScores();

  if (text.length < 10) {
    return {
      locale: "es",
      confidence: 0.5,
      method: "default",
      all_scores: defaultScores,
      is_rtl: false
    };
  }
  
  try {
    const detected = franc(text);
    
    if (detected === "und") {
      return detectByMarkers(text);
    }
    
    const locale = FRANC_TO_LOCALE[detected];
    
    if (locale) {
      return {
        locale,
        confidence: 0.85,
        method: "franc",
        all_scores: { ...defaultScores, [locale]: 1 },
        is_rtl: RTL_LOCALES.includes(locale)
      };
    }
    
    return detectByMarkers(text);
  } catch {
    return detectByMarkers(text);
  }
}

export function detectLanguage(text: string): LanguageDetectionResult {
  // Guard against type confusion via parameter tampering (CodeQL: type-confusion)
  if (typeof text !== "string") {
    return { locale: "es", confidence: 0.5, method: "default", all_scores: getDefaultScores(), is_rtl: false };
  }
  const scriptLocale = detectByScript(text);
  if (scriptLocale) {
    const defaultScores = getDefaultScores();
    return {
      locale: scriptLocale,
      confidence: 0.90,
      method: "script",
      all_scores: { ...defaultScores, [scriptLocale]: 1 },
      is_rtl: RTL_LOCALES.includes(scriptLocale)
    };
  }
  
  if (text.length < 20) {
    return detectByMarkers(text);
  }
  
  const francResult = detectByFranc(text);
  
  if (francResult.confidence >= 0.7) {
    return francResult;
  }
  
  const markerResult = detectByMarkers(text);
  
  if (markerResult.confidence > francResult.confidence) {
    return markerResult;
  }
  
  return francResult;
}

export function isCodeSwitching(text: string): boolean {
  const scores = getDefaultScores();
  
  for (const locale of Object.keys(scores) as SupportedLocale[]) {
    scores[locale] = countMarkerMatches(text, locale);
  }
  
  const nonZeroLocales = Object.values(scores).filter(s => s > 0).length;
  
  return nonZeroLocales >= 2;
}

export function isRTL(locale: SupportedLocale): boolean {
  return RTL_LOCALES.includes(locale);
}

export function getTextDirection(locale: SupportedLocale): "ltr" | "rtl" {
  return RTL_LOCALES.includes(locale) ? "rtl" : "ltr";
}
