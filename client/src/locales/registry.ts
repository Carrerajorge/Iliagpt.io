export type LanguageDefinition = {
  code: string;
  name: string;
  nativeName: string;
  rtl?: boolean;
};

export const LANGUAGE_REGISTRY = [
  { code: "af", name: "Afrikaans", nativeName: "Afrikaans" },
  { code: "am", name: "Amharic", nativeName: "አማርኛ" },
  { code: "ar", name: "Arabic", nativeName: "العربية", rtl: true },
  { code: "as", name: "Assamese", nativeName: "অসমীয়া" },
  { code: "az", name: "Azerbaijani", nativeName: "Azərbaycanca" },
  { code: "be", name: "Belarusian", nativeName: "Беларуская" },
  { code: "bg", name: "Bulgarian", nativeName: "Български" },
  { code: "bn", name: "Bengali", nativeName: "বাংলা" },
  { code: "bs", name: "Bosnian", nativeName: "Bosanski" },
  { code: "ca", name: "Catalan", nativeName: "Català" },
  { code: "cs", name: "Czech", nativeName: "Čeština" },
  { code: "cy", name: "Welsh", nativeName: "Cymraeg" },
  { code: "da", name: "Danish", nativeName: "Dansk" },
  { code: "de", name: "German", nativeName: "Deutsch" },
  { code: "el", name: "Greek", nativeName: "Ελληνικά" },
  { code: "en", name: "English", nativeName: "English" },
  { code: "eo", name: "Esperanto", nativeName: "Esperanto" },
  { code: "es", name: "Spanish", nativeName: "Español" },
  { code: "et", name: "Estonian", nativeName: "Eesti" },
  { code: "eu", name: "Basque", nativeName: "Euskara" },
  { code: "fa", name: "Persian", nativeName: "فارسی", rtl: true },
  { code: "fi", name: "Finnish", nativeName: "Suomi" },
  { code: "fil", name: "Filipino", nativeName: "Filipino" },
  { code: "fr", name: "French", nativeName: "Français" },
  { code: "fy", name: "Frisian", nativeName: "Frysk" },
  { code: "ga", name: "Irish", nativeName: "Gaeilge" },
  { code: "gl", name: "Galician", nativeName: "Galego" },
  { code: "gu", name: "Gujarati", nativeName: "ગુજરાતી" },
  { code: "ha", name: "Hausa", nativeName: "Hausa" },
  { code: "he", name: "Hebrew", nativeName: "עברית", rtl: true },
  { code: "hi", name: "Hindi", nativeName: "हिन्दी" },
  { code: "hr", name: "Croatian", nativeName: "Hrvatski" },
  { code: "ht", name: "Haitian Creole", nativeName: "Kreyòl Ayisyen" },
  { code: "hu", name: "Hungarian", nativeName: "Magyar" },
  { code: "hy", name: "Armenian", nativeName: "Հայերեն" },
  { code: "id", name: "Indonesian", nativeName: "Bahasa Indonesia" },
  { code: "ig", name: "Igbo", nativeName: "Igbo" },
  { code: "is", name: "Icelandic", nativeName: "Íslenska" },
  { code: "it", name: "Italian", nativeName: "Italiano" },
  { code: "ja", name: "Japanese", nativeName: "日本語" },
  { code: "jv", name: "Javanese", nativeName: "Basa Jawa" },
  { code: "ka", name: "Georgian", nativeName: "ქართული" },
  { code: "kk", name: "Kazakh", nativeName: "Қазақша" },
  { code: "km", name: "Khmer", nativeName: "ខ្មែរ" },
  { code: "kn", name: "Kannada", nativeName: "ಕನ್ನಡ" },
  { code: "ko", name: "Korean", nativeName: "한국어" },
  { code: "ku", name: "Kurdish", nativeName: "Kurdî", rtl: true },
  { code: "ky", name: "Kyrgyz", nativeName: "Кыргызча" },
  { code: "la", name: "Latin", nativeName: "Latina" },
  { code: "lb", name: "Luxembourgish", nativeName: "Lëtzebuergesch" },
  { code: "lo", name: "Lao", nativeName: "ລາວ" },
  { code: "lt", name: "Lithuanian", nativeName: "Lietuvių" },
  { code: "lv", name: "Latvian", nativeName: "Latviešu" },
  { code: "mg", name: "Malagasy", nativeName: "Malagasy" },
  { code: "mi", name: "Māori", nativeName: "Māori" },
  { code: "mk", name: "Macedonian", nativeName: "Македонски" },
  { code: "ml", name: "Malayalam", nativeName: "മലയാളം" },
  { code: "mn", name: "Mongolian", nativeName: "Монгол" },
  { code: "mr", name: "Marathi", nativeName: "मराठी" },
  { code: "ms", name: "Malay", nativeName: "Bahasa Melayu" },
  { code: "mt", name: "Maltese", nativeName: "Malti" },
  { code: "my", name: "Myanmar", nativeName: "မြန်မာ" },
  { code: "ne", name: "Nepali", nativeName: "नेपाली" },
  { code: "nl", name: "Dutch", nativeName: "Nederlands" },
  { code: "no", name: "Norwegian", nativeName: "Norsk" },
  { code: "or", name: "Odia", nativeName: "ଓଡ଼ିଆ" },
  { code: "pa", name: "Punjabi", nativeName: "ਪੰਜਾਬੀ" },
  { code: "pl", name: "Polish", nativeName: "Polski" },
  { code: "ps", name: "Pashto", nativeName: "پښتو", rtl: true },
  { code: "pt", name: "Portuguese", nativeName: "Português" },
  { code: "ro", name: "Romanian", nativeName: "Română" },
  { code: "ru", name: "Russian", nativeName: "Русский" },
  { code: "sd", name: "Sindhi", nativeName: "سنڌي", rtl: true },
  { code: "si", name: "Sinhala", nativeName: "සිංහල" },
  { code: "sk", name: "Slovak", nativeName: "Slovenčina" },
  { code: "sl", name: "Slovenian", nativeName: "Slovenščina" },
  { code: "sm", name: "Samoan", nativeName: "Gagana Samoa" },
  { code: "sn", name: "Shona", nativeName: "ChiShona" },
  { code: "so", name: "Somali", nativeName: "Soomaali" },
  { code: "sq", name: "Albanian", nativeName: "Shqip" },
  { code: "sr", name: "Serbian", nativeName: "Српски" },
  { code: "st", name: "Sesotho", nativeName: "Sesotho" },
  { code: "su", name: "Sundanese", nativeName: "Basa Sunda" },
  { code: "sv", name: "Swedish", nativeName: "Svenska" },
  { code: "sw", name: "Swahili", nativeName: "Kiswahili" },
  { code: "ta", name: "Tamil", nativeName: "தமிழ்" },
  { code: "te", name: "Telugu", nativeName: "తెలుగు" },
  { code: "tg", name: "Tajik", nativeName: "Тоҷикӣ" },
  { code: "th", name: "Thai", nativeName: "ไทย" },
  { code: "tk", name: "Turkmen", nativeName: "Türkmen" },
  { code: "tr", name: "Turkish", nativeName: "Türkçe" },
  { code: "uk", name: "Ukrainian", nativeName: "Українська" },
  { code: "ur", name: "Urdu", nativeName: "اردو", rtl: true },
  { code: "uz", name: "Uzbek", nativeName: "Oʻzbek" },
  { code: "vi", name: "Vietnamese", nativeName: "Tiếng Việt" },
  { code: "xh", name: "Xhosa", nativeName: "isiXhosa" },
  { code: "yi", name: "Yiddish", nativeName: "ייִדיש", rtl: true },
  { code: "yo", name: "Yoruba", nativeName: "Yorùbá" },
  { code: "zh", name: "Chinese", nativeName: "中文" },
  { code: "zu", name: "Zulu", nativeName: "isiZulu" },
] as const satisfies readonly LanguageDefinition[];

export type SupportedLanguage = (typeof LANGUAGE_REGISTRY)[number]["code"];

export const SUPPORTED_LANGUAGES = LANGUAGE_REGISTRY.map((language) => language.code) as SupportedLanguage[];

const SUPPORTED_LANGUAGE_SET = new Set<string>(SUPPORTED_LANGUAGES);
const RTL_LANGUAGE_SET = new Set<SupportedLanguage>(
  LANGUAGE_REGISTRY.filter((language) => Boolean(language.rtl)).map((language) => language.code as SupportedLanguage)
);

export const DEFAULT_LANGUAGE: SupportedLanguage = "es";
export const PRIMARY_FALLBACK_LANGUAGE: SupportedLanguage = "en";

export function normalizeLanguageCode(input: string | null | undefined): SupportedLanguage | null {
  if (!input) return null;
  const normalized = input.trim().toLowerCase().replace(/_/g, "-");
  if (!normalized) return null;

  if (SUPPORTED_LANGUAGE_SET.has(normalized)) {
    return normalized as SupportedLanguage;
  }

  const base = normalized.split("-")[0] ?? "";
  if (SUPPORTED_LANGUAGE_SET.has(base)) {
    return base as SupportedLanguage;
  }

  return null;
}

export function isRtlLanguage(input: string): boolean {
  const normalized = normalizeLanguageCode(input);
  if (!normalized) return false;
  return RTL_LANGUAGE_SET.has(normalized);
}

export function getLanguageDefinition(code: string): (typeof LANGUAGE_REGISTRY)[number] | null {
  const normalized = normalizeLanguageCode(code);
  if (!normalized) return null;
  return LANGUAGE_REGISTRY.find((language) => language.code === normalized) ?? null;
}

export function getLanguageFallbackChain(language: SupportedLanguage): SupportedLanguage[] {
  const chain: SupportedLanguage[] = [language];

  if (language !== PRIMARY_FALLBACK_LANGUAGE) {
    chain.push(PRIMARY_FALLBACK_LANGUAGE);
  }

  if (language !== DEFAULT_LANGUAGE) {
    chain.push(DEFAULT_LANGUAGE);
  }

  return chain;
}
