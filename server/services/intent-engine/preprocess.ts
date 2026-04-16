import emojiRegex from "emoji-regex";
import type { SupportedLocale } from "../../../shared/schemas/intent";

const URL_PATTERN = /https?:\/\/[^\s]+|www\.[^\s]+/gi;
const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi;
const MENTION_PATTERN = /@[\w]+/g;
const HASHTAG_PATTERN = /#[\w]+/g;
const REPEATED_CHARS_PATTERN = /(.)\1{3,}/g;
const WHITESPACE_PATTERN = /\s+/g;

const ARABIC_TASHKEEL_PATTERN = /[\u064B-\u065F\u0670]/g;

const CYRILLIC_TO_LATIN: Record<string, string> = {
  "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "yo",
  "ж": "zh", "з": "z", "и": "i", "й": "y", "к": "k", "л": "l", "м": "m",
  "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u",
  "ф": "f", "х": "kh", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "shch",
  "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu", "я": "ya"
};

const SPANISH_REGIONAL_SYNONYMS: Record<string, string[]> = {
  "diapositivas": ["láminas", "transparencias", "slides"],
  "presentación": ["exposición", "ponencia", "charla"],
  "documento": ["archivo", "fichero"],
  "hoja de cálculo": ["planilla", "excel", "tabla"],
  "buscar": ["investigar", "indagar", "explorar"],
  "resumen": ["síntesis", "compendio", "extracto"],
  "traducir": ["pasar a", "convertir"]
};

const TYPO_CORRECTIONS: Record<SupportedLocale, Record<string, string>> = {
  es: {
    "pawer point": "powerpoint",
    "pawerpoint": "powerpoint",
    "power pont": "powerpoint",
    "powerpint": "powerpoint",
    "powrpoint": "powerpoint",
    "powepoint": "powerpoint",
    "poewr point": "powerpoint",
    "slaind": "slides",
    "slaid": "slides",
    "slaide": "slides",
    "slidez": "slides",
    "precentacion": "presentacion",
    "presentasion": "presentacion",
    "presentaciom": "presentacion",
    "presetacion": "presentacion",
    "presentacin": "presentacion",
    "diapositvas": "diapositivas",
    "diapositivs": "diapositivas",
    "diapisitivas": "diapositivas",
    "documeto": "documento",
    "docuemnto": "documento",
    "documentp": "documento",
    "documnt": "documento",
    "exel": "excel",
    "excell": "excel",
    "exce": "excel",
    "hoja de calulo": "hoja de calculo",
    "hoja d calculo": "hoja de calculo",
    "resum": "resumen",
    "resumn": "resumen",
    "traduccin": "traduccion",
    "busacr": "buscar",
    "bsucar": "buscar",
    "analisar": "analizar"
  },
  en: {
    "powerpiont": "powerpoint",
    "powrpoint": "powerpoint",
    "presenation": "presentation",
    "presntation": "presentation",
    "presentaiton": "presentation",
    "slidez": "slides",
    "spreadshet": "spreadsheet",
    "spreadhseet": "spreadsheet",
    "spredsheet": "spreadsheet",
    "documnet": "document",
    "docuemnt": "document",
    "summay": "summary",
    "sumary": "summary",
    "transalte": "translate",
    "tranlate": "translate",
    "translte": "translate",
    "serach": "search",
    "seach": "search"
  },
  pt: {
    "apresentacao": "apresentação",
    "apresentasao": "apresentação",
    "documeto": "documento",
    "planilah": "planilha",
    "planiha": "planilha",
    "resumao": "resumo",
    "traduzao": "tradução"
  },
  fr: {
    "presentacion": "présentation",
    "presentasion": "présentation",
    "documant": "document",
    "tabluer": "tableur",
    "resumé": "résumé",
    "tradcution": "traduction"
  },
  de: {
    "prasentation": "präsentation",
    "praesentation": "präsentation",
    "dokumentt": "dokument",
    "tabele": "tabelle",
    "zusammenfasug": "zusammenfassung",
    "ubersetzen": "übersetzen"
  },
  it: {
    "presentazoine": "presentazione",
    "documeto": "documento",
    "fogilo": "foglio",
    "riasunto": "riassunto",
    "traduzoine": "traduzione"
  },
  ar: {
    "عرض تقديمى": "عرض تقديمي",
    "مسطند": "مستند",
    "مستندد": "مستند",
    "جدوال": "جدول",
    "جدولل": "جدول",
    "ترجمه": "ترجمة",
    "ترجمم": "ترجم",
    "بحثث": "بحث",
    "ملخصص": "ملخص",
    "تحليال": "تحليل",
    "إنشاأ": "إنشاء",
    "انشا": "إنشاء",
    "توليدد": "توليد",
    "من فضلكك": "من فضلك"
  },
  hi: {
    "प्रस्तुती": "प्रस्तुति",
    "परस्तुति": "प्रस्तुति",
    "दस्तावेज": "दस्तावेज़",
    "दस्तवेज़": "दस्तावेज़",
    "सप्रेडशीट": "स्प्रेडशीट",
    "स्प्रेडशिट": "स्प्रेडशीट",
    "सारंश": "सारांश",
    "सारांस": "सारांश",
    "अनुवाध": "अनुवाद",
    "खोजें": "खोज",
    "खौज": "खोज",
    "विश्लेषन": "विश्लेषण",
    "बनाये": "बनाएं",
    "बनायें": "बनाएं",
    "कर्पया": "कृपया"
  },
  ja: {
    "プレゼンテーショn": "プレゼンテーション",
    "ぷれぜん": "プレゼン",
    "スラィド": "スライド",
    "ドキュメンと": "ドキュメント",
    "スプレッドシート": "スプレッドシート",
    "ようやく": "要約",
    "やくす": "訳す",
    "ほんやく": "翻訳",
    "けんさく": "検索",
    "ぶんせき": "分析",
    "さくせい": "作成",
    "つくって": "作って",
    "作成してくっださい": "作成してください"
  },
  ko: {
    "프레젠테이선": "프레젠테이션",
    "슬라이드ㅡ": "슬라이드",
    "문서ㅁ": "문서",
    "스프레드시트ㅡ": "스프레드시트",
    "요약ㅇ": "요약",
    "번역ㅂ": "번역",
    "검섹": "검색",
    "검색ㄱ": "검색",
    "분석ㅂ": "분석",
    "만들기ㅁ": "만들기",
    "생섬": "생성",
    "만들어쥬세요": "만들어주세요",
    "주쇄요": "주세요"
  },
  zh: {
    "演试": "演示",
    "演視": "演示",
    "幻灯变": "幻灯片",
    "环灯片": "幻灯片",
    "文档档": "文档",
    "闻档": "文档",
    "电子表哥": "电子表格",
    "電子表格": "电子表格",
    "摘药": "摘要",
    "摘要要": "摘要",
    "凡译": "翻译",
    "翻译译": "翻译",
    "搜索索": "搜索",
    "分析吸": "分析",
    "创键": "创建",
    "生成成": "生成"
  },
  ru: {
    "презинтация": "презентация",
    "призентация": "презентация",
    "докумэнт": "документ",
    "документ": "документ",
    "таблитса": "таблица",
    "таблица": "таблица",
    "пиревод": "перевод",
    "перивод": "перевод",
    "поиск": "поиск",
    "паиск": "поиск",
    "ризюме": "резюме",
    "разюме": "резюме",
    "создат": "создать",
    "саздать": "создать",
    "генирировать": "генерировать",
    "пажалуйста": "пожалуйста"
  },
  tr: {
    "sunm": "sunum",
    "sunuum": "sunum",
    "blege": "belge",
    "belgge": "belge",
    "taplo": "tablo",
    "taablo": "tablo",
    "ceviri": "çeviri",
    "çevri": "çeviri",
    "aram": "arama",
    "aramaa": "arama",
    "özeet": "özet",
    "oezet": "özet",
    "olustur": "oluştur",
    "olştur": "oluştur",
    "lutfen": "lütfen",
    "luetfen": "lütfen"
  },
  id: {
    "presentasi": "presentasi",
    "presentasii": "presentasi",
    "doukmen": "dokumen",
    "dokumenn": "dokumen",
    "spredsheet": "spreadsheet",
    "speadsheet": "spreadsheet",
    "tejemahan": "terjemahan",
    "terjemahann": "terjemahan",
    "pencariaan": "pencarian",
    "pncarian": "pencarian",
    "ringkasn": "ringkasan",
    "ringkasann": "ringkasan",
    "buatkan": "buat",
    "buatt": "buat",
    "hasillkan": "hasilkan",
    "tolongg": "tolong"
  }
};

const GLOBAL_TYPO_CORRECTIONS: Record<string, string> = {
  ...TYPO_CORRECTIONS.es,
  ...TYPO_CORRECTIONS.en
};

export interface PreprocessResult {
  normalized: string;
  original: string;
  removed_urls: string[];
  removed_emails: string[];
  removed_emojis: string[];
  typos_corrected: string[];
  locale_used: SupportedLocale;
  tokens?: string[];
  is_cjk?: boolean;
}

export function normalizeUnicode(text: string): string {
  return text.normalize("NFKC");
}

export function removeEmojis(text: string): { text: string; removed: string[] } {
  const regex = emojiRegex();
  const removed: string[] = [];
  const cleaned = text.replace(regex, (match) => {
    removed.push(match);
    return " ";
  });
  return { text: cleaned, removed };
}

export function removeUrls(text: string): { text: string; removed: string[] } {
  const removed: string[] = [];
  const cleaned = text.replace(URL_PATTERN, (match) => {
    removed.push(match);
    return " ";
  });
  return { text: cleaned, removed };
}

export function removeEmails(text: string): { text: string; removed: string[] } {
  const removed: string[] = [];
  const cleaned = text.replace(EMAIL_PATTERN, (match) => {
    removed.push(match);
    return " ";
  });
  return { text: cleaned, removed };
}

export function removeMentionsAndHashtags(text: string): string {
  return text
    .replace(MENTION_PATTERN, " ")
    .replace(HASHTAG_PATTERN, " ");
}

export function collapseRepeatedChars(text: string): string {
  return text.replace(REPEATED_CHARS_PATTERN, "$1$1");
}

export function removeDiacritics(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function removeArabicTashkeel(text: string): string {
  return text.replace(ARABIC_TASHKEEL_PATTERN, "");
}

export function transliterateCyrillic(text: string): string {
  let result = "";
  for (const char of text.toLowerCase()) {
    result += CYRILLIC_TO_LATIN[char] || char;
  }
  return result;
}

export function collapseWhitespace(text: string): string {
  return text.replace(WHITESPACE_PATTERN, " ").trim();
}

function isCJKChar(code: number): boolean {
  return (
    (code >= 0x4E00 && code <= 0x9FFF) ||
    (code >= 0x3400 && code <= 0x4DBF) ||
    (code >= 0x20000 && code <= 0x2A6DF) ||
    (code >= 0x3040 && code <= 0x309F) ||
    (code >= 0x30A0 && code <= 0x30FF) ||
    (code >= 0xAC00 && code <= 0xD7AF) ||
    (code >= 0x1100 && code <= 0x11FF)
  );
}

export function tokenizeCJK(text: string): string[] {
  const tokens: string[] = [];
  let currentToken = "";
  let lastWasCJK = false;
  
  for (const char of text) {
    const code = char.codePointAt(0) || 0;
    const isCJK = isCJKChar(code);
    
    if (isCJK) {
      if (currentToken && !lastWasCJK) {
        tokens.push(currentToken.trim());
        currentToken = "";
      }
      tokens.push(char);
      lastWasCJK = true;
    } else if (/\s/.test(char)) {
      if (currentToken) {
        tokens.push(currentToken.trim());
        currentToken = "";
      }
      lastWasCJK = false;
    } else {
      if (lastWasCJK) {
        currentToken = char;
      } else {
        currentToken += char;
      }
      lastWasCJK = false;
    }
  }
  
  if (currentToken) {
    tokens.push(currentToken.trim());
  }
  
  return tokens.filter(t => t.length > 0);
}

export function containsCJK(text: string): boolean {
  for (const char of text) {
    const code = char.codePointAt(0) || 0;
    if (isCJKChar(code)) {
      return true;
    }
  }
  return false;
}

export function applySpanishSynonyms(text: string): string {
  let result = text.toLowerCase();
  for (const [canonical, synonyms] of Object.entries(SPANISH_REGIONAL_SYNONYMS)) {
    for (const synonym of synonyms) {
      const regex = new RegExp(`\\b${synonym}\\b`, "gi");
      result = result.replace(regex, canonical);
    }
  }
  return result;
}

export function applyTypoCorrections(
  text: string,
  locale: SupportedLocale
): { text: string; corrected: string[] } {
  const corrected: string[] = [];
  let result = text;
  
  const localeTyPos = TYPO_CORRECTIONS[locale] || {};
  const allTypos = { ...GLOBAL_TYPO_CORRECTIONS, ...localeTyPos };
  
  for (const [typo, correction] of Object.entries(allTypos)) {
    const regex = new RegExp(typo.replace(/\s+/g, "\\s*"), "gi");
    if (regex.test(result)) {
      result = result.replace(regex, correction);
      corrected.push(`${typo} -> ${correction}`);
    }
  }
  
  return { text: result, corrected };
}

export function preprocess(
  text: string,
  locale: SupportedLocale = "es"
): PreprocessResult {
  const original = text;
  
  let normalized = normalizeUnicode(text);
  
  const urlResult = removeUrls(normalized);
  normalized = urlResult.text;
  
  const emailResult = removeEmails(normalized);
  normalized = emailResult.text;
  
  const emojiResult = removeEmojis(normalized);
  normalized = emojiResult.text;
  
  normalized = removeMentionsAndHashtags(normalized);
  
  normalized = normalized.toLowerCase();
  
  if (locale === "ar") {
    normalized = removeArabicTashkeel(normalized);
  }
  
  if (locale === "es") {
    normalized = applySpanishSynonyms(normalized);
  }
  
  const isCJK = containsCJK(normalized);
  let tokens: string[] | undefined;
  
  if (isCJK && (locale === "zh" || locale === "ja" || locale === "ko")) {
    tokens = tokenizeCJK(normalized);
  }
  
  const isNonLatinLocale = ["ar", "hi", "ja", "ko", "zh", "ru"].includes(locale);
  
  if (!isNonLatinLocale) {
    normalized = removeDiacritics(normalized);
  }
  
  normalized = collapseRepeatedChars(normalized);
  
  if (!isCJK && !isNonLatinLocale) {
    normalized = normalized.replace(/[^\w\s]/g, " ");
  }
  
  const typoResult = applyTypoCorrections(normalized, locale);
  normalized = typoResult.text;
  
  normalized = collapseWhitespace(normalized);
  
  return {
    normalized,
    original,
    removed_urls: urlResult.removed,
    removed_emails: emailResult.removed,
    removed_emojis: emojiResult.removed,
    typos_corrected: typoResult.corrected,
    locale_used: locale,
    tokens,
    is_cjk: isCJK
  };
}

export function getTypoCorrectionCount(): number {
  return Object.values(TYPO_CORRECTIONS).reduce(
    (acc, dict) => acc + Object.keys(dict).length,
    0
  );
}
