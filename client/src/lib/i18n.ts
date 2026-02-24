import { IntlMessageFormat } from "intl-messageformat";
import {
  DEFAULT_LANGUAGE,
  LANGUAGE_REGISTRY,
  SUPPORTED_LANGUAGES,
  getLanguageDefinition,
  getLanguageFallbackChain,
  isRtlLanguage,
  normalizeLanguageCode,
  type SupportedLanguage,
} from "@/locales/registry";

export type TranslationKeys = Record<string, string>;

export type TranslationPrimitive = string | number | boolean | null | undefined;
export type TranslationValues = Record<string, TranslationPrimitive | Date>;

export type TranslateOptions = {
  defaultValue?: string;
  values?: TranslationValues;
  count?: number;
  gender?: "male" | "female" | "other";
  logMissing?: boolean;
};

type LocaleBundle = {
  metadata?: {
    name?: string;
    nativeName?: string;
    rtl?: boolean;
  };
  messages?: Record<string, string>;
  literals?: Record<string, string>;
};

type NormalizedLocaleBundle = {
  metadata: {
    name: string;
    nativeName: string;
    rtl: boolean;
  };
  messages: Record<string, string>;
  literals: Record<string, string>;
};

type SetLanguageOptions = {
  persistStorage?: boolean;
  persistProfile?: boolean;
  emitEvent?: boolean;
};

const LANGUAGE_STORAGE_KEY = "app_language";
const LANGUAGE_COOKIE_KEY = "app_language";
const LANGUAGE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
const MISSING_KEYS_LOG_LIMIT = 1000;

const TRANSLATABLE_ATTRIBUTES = [
  "placeholder",
  "title",
  "aria-label",
  "aria-placeholder",
  "aria-description",
  "alt",
  "data-placeholder",
] as const;

const SKIP_TRANSLATION_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "CODE", "PRE", "TEXTAREA"]);
const localeLoaders = import.meta.glob<LocaleBundle>("../locales/*.json", { import: "default" });

const loadedBundles = new Map<SupportedLanguage, NormalizedLocaleBundle>();
const missingKeysLogged = new Set<string>();
const messageFormatCache = new Map<string, IntlMessageFormat>();
const originalTextNodeMap = new WeakMap<Text, string>();
const originalAttributeMap = new WeakMap<Element, Map<string, string>>();

let activeLanguage: SupportedLanguage = detectInitialLanguage();
let activeFallbackChain: SupportedLanguage[] = getLanguageFallbackChain(activeLanguage);
let domObserver: MutationObserver | null = null;
let mutationLock = false;
let isInitialized = false;
let bootstrapPromise: Promise<void> | null = null;
let languageChangeToken = 0;
let profileSyncPromise: Promise<void> | null = null;
let authSyncListener: ((event: Event) => void) | null = null;
let storageSyncListener: ((event: StorageEvent) => void) | null = null;

function detectLanguageFromNavigator(): SupportedLanguage {
  if (typeof navigator === "undefined") return DEFAULT_LANGUAGE;

  const candidates = [...(navigator.languages ?? []), navigator.language].filter(Boolean);

  for (const candidate of candidates) {
    const normalized = normalizeLanguageCode(candidate);
    if (normalized) return normalized;
  }

  return DEFAULT_LANGUAGE;
}

function getCookieLanguage(): SupportedLanguage | null {
  if (typeof document === "undefined") return null;

  const cookie = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${LANGUAGE_COOKIE_KEY}=`));

  if (!cookie) return null;

  const value = decodeURIComponent(cookie.split("=").slice(1).join("="));
  return normalizeLanguageCode(value);
}

function getStoredLanguage(): SupportedLanguage | null {
  if (typeof window === "undefined") return null;

  try {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    const normalized = normalizeLanguageCode(stored);
    if (normalized) return normalized;
  } catch {
    // Ignore localStorage failures.
  }

  return getCookieLanguage();
}

function detectInitialLanguage(): SupportedLanguage {
  const stored = getStoredLanguage();
  if (stored) return stored;
  return detectLanguageFromNavigator();
}

function setCookieLanguage(language: SupportedLanguage): void {
  if (typeof document === "undefined") return;
  document.cookie = `${LANGUAGE_COOKIE_KEY}=${encodeURIComponent(language)}; path=/; max-age=${LANGUAGE_COOKIE_MAX_AGE_SECONDS}; samesite=lax`;
}

function persistLanguageLocally(language: SupportedLanguage): void {
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    } catch {
      // Ignore localStorage failures.
    }
  }

  setCookieLanguage(language);
}

function createMissingKeyFallback(key: string): string {
  const shortKey = key.split(".").at(-1) ?? key;
  const humanized = shortKey.replace(/[_-]+/g, " ").trim();

  if (humanized && humanized !== key) {
    return humanized;
  }

  return activeLanguage === "es" ? "Texto no disponible" : "Translation unavailable";
}

function reportMissingKey(scope: "message" | "literal", key: string): void {
  if (missingKeysLogged.size >= MISSING_KEYS_LOG_LIMIT) return;

  const token = `${activeLanguage}:${scope}:${key}`;
  if (missingKeysLogged.has(token)) return;

  missingKeysLogged.add(token);
  const fallback = activeFallbackChain.join(" -> ");
  console.warn(`[i18n] Missing ${scope} key \"${key}\" for locale \"${activeLanguage}\". Fallback chain: ${fallback}`);

  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("i18n:missing-key", {
        detail: {
          language: activeLanguage,
          scope,
          key,
          fallbackChain: [...activeFallbackChain],
        },
      })
    );
  }
}

function normalizeBundle(language: SupportedLanguage, bundle: LocaleBundle | undefined): NormalizedLocaleBundle {
  const definition = getLanguageDefinition(language);

  return {
    metadata: {
      name: bundle?.metadata?.name || definition?.name || language,
      nativeName: bundle?.metadata?.nativeName || definition?.nativeName || definition?.name || language,
      rtl: Boolean(bundle?.metadata?.rtl ?? definition?.rtl),
    },
    messages: bundle?.messages ?? {},
    literals: bundle?.literals ?? {},
  };
}

async function loadLocaleBundle(language: SupportedLanguage): Promise<NormalizedLocaleBundle> {
  const cached = loadedBundles.get(language);
  if (cached) return cached;

  const loader = localeLoaders[`../locales/${language}.json`];
  if (!loader) {
    const emptyBundle = normalizeBundle(language, undefined);
    loadedBundles.set(language, emptyBundle);
    return emptyBundle;
  }

  try {
    const rawBundle = await loader();
    const normalizedBundle = normalizeBundle(language, rawBundle);
    loadedBundles.set(language, normalizedBundle);
    return normalizedBundle;
  } catch (error) {
    console.error(`[i18n] Failed to load locale bundle for \"${language}\"`, error);
    const emptyBundle = normalizeBundle(language, undefined);
    loadedBundles.set(language, emptyBundle);
    return emptyBundle;
  }
}

async function ensureFallbackBundles(language: SupportedLanguage): Promise<void> {
  const chain = getLanguageFallbackChain(language);
  activeFallbackChain = chain;
  await Promise.all(chain.map((locale) => loadLocaleBundle(locale)));
}

function resolveMessageTemplate(key: string, logMissing = true): string | null {
  for (const locale of activeFallbackChain) {
    const message = loadedBundles.get(locale)?.messages?.[key];
    if (typeof message === "string" && message.length > 0) {
      return message;
    }
  }

  if (logMissing) {
    reportMissingKey("message", key);
  }

  return null;
}

function resolveLiteralTemplate(literal: string, logMissing = true): string | null {
  for (const locale of activeFallbackChain) {
    const translated = loadedBundles.get(locale)?.literals?.[literal];
    if (typeof translated === "string" && translated.length > 0) {
      return translated;
    }
  }

  if (logMissing) {
    reportMissingKey("literal", literal);
  }

  return null;
}

function formatIcuMessage(template: string, values?: TranslationValues): string {
  if (!values || Object.keys(values).length === 0) {
    return template;
  }

  const cacheKey = `${activeLanguage}::${template}`;

  try {
    let formatter = messageFormatCache.get(cacheKey);
    if (!formatter) {
      formatter = new IntlMessageFormat(template, activeLanguage);
      messageFormatCache.set(cacheKey, formatter);
    }

    const output = formatter.format(values as Record<string, unknown>);
    if (Array.isArray(output)) {
      return output.join("");
    }

    return String(output);
  } catch (error) {
    console.error(`[i18n] ICU formatting failed for template \"${template}\"`, error);
    return template;
  }
}

function shouldTranslateLiteral(coreText: string): boolean {
  if (!coreText) return false;
  if (coreText.length > 120) return false;
  if (/^https?:\/\//i.test(coreText)) return false;
  if (/^[\d\s.,:/+-]+$/.test(coreText)) return false;
  if (!/[\p{L}]/u.test(coreText)) return false;
  return true;
}

function translateLiteralText(text: string, logMissing = true): string {
  const match = /^(\s*)(.*?)(\s*)$/su.exec(text);
  if (!match) return text;

  const [, leading, core, trailing] = match;
  if (!core || !shouldTranslateLiteral(core)) {
    return text;
  }

  const translated = resolveLiteralTemplate(core, logMissing);
  if (!translated) return text;

  return `${leading}${translated}${trailing}`;
}

function shouldSkipElement(element: Element | null): boolean {
  if (!element) return true;

  if (SKIP_TRANSLATION_TAGS.has(element.tagName)) {
    return true;
  }

  if (element.closest("[data-i18n-ignore], [data-i18n-skip], [data-i18n='ignore']")) {
    return true;
  }

  if (element.closest("code, pre, textarea, [contenteditable='true']")) {
    return true;
  }

  return false;
}

function getOriginalAttributes(element: Element): Map<string, string> {
  let map = originalAttributeMap.get(element);
  if (!map) {
    map = new Map<string, string>();
    originalAttributeMap.set(element, map);
  }
  return map;
}

function shouldTranslateInputValue(element: Element): element is HTMLInputElement {
  if (typeof HTMLInputElement === "undefined") return false;
  return element instanceof HTMLInputElement && ["button", "submit", "reset"].includes(element.type);
}

function translateElementAttributes(element: Element): void {
  if (shouldSkipElement(element)) return;

  const originalValues = getOriginalAttributes(element);

  for (const attr of TRANSLATABLE_ATTRIBUTES) {
    const current = element.getAttribute(attr);
    if (current == null || current.trim().length === 0) continue;

    const storedOriginal = originalValues.get(attr);
    if (!storedOriginal) {
      originalValues.set(attr, current);
    } else {
      const expected = translateLiteralText(storedOriginal, false);
      if (expected !== current) {
        originalValues.set(attr, current);
      }
    }

    const base = originalValues.get(attr) ?? current;
    const translated = translateLiteralText(base);
    if (translated !== current) {
      element.setAttribute(attr, translated);
    }
  }

  if (shouldTranslateInputValue(element)) {
    const key = "value";
    const current = element.value;
    if (!current || current.trim().length === 0) return;

    const storedOriginal = originalValues.get(key);
    if (!storedOriginal) {
      originalValues.set(key, current);
    } else {
      const expected = translateLiteralText(storedOriginal, false);
      if (expected !== current) {
        originalValues.set(key, current);
      }
    }

    const base = originalValues.get(key) ?? current;
    const translated = translateLiteralText(base);
    if (translated !== current) {
      element.value = translated;
    }
  }
}

function translateTextNode(textNode: Text): void {
  const parent = textNode.parentElement;
  if (!parent || shouldSkipElement(parent)) return;

  const currentText = textNode.textContent ?? "";
  if (currentText.trim().length === 0) return;

  const storedOriginal = originalTextNodeMap.get(textNode);

  if (!storedOriginal) {
    originalTextNodeMap.set(textNode, currentText);
  } else {
    const expected = translateLiteralText(storedOriginal, false);
    if (expected !== currentText) {
      originalTextNodeMap.set(textNode, currentText);
    }
  }

  const base = originalTextNodeMap.get(textNode) ?? currentText;
  const translated = translateLiteralText(base);

  if (translated !== currentText) {
    textNode.textContent = translated;
  }
}

function translateTree(root: Node): void {
  if (root.nodeType === Node.TEXT_NODE) {
    translateTextNode(root as Text);
    return;
  }

  const documentRef = typeof document !== "undefined" ? document : null;
  if (!documentRef) return;

  const walker = documentRef.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let current = walker.nextNode();
  while (current) {
    translateTextNode(current as Text);
    current = walker.nextNode();
  }

  if (root instanceof Element) {
    translateElementAttributes(root);

    const selector = [
      ...TRANSLATABLE_ATTRIBUTES.map((attr) => `[${attr}]`),
      "input[type='button']",
      "input[type='submit']",
      "input[type='reset']",
    ].join(",");

    root.querySelectorAll(selector).forEach((element) => translateElementAttributes(element));
  }
}

function withMutationLock(action: () => void): void {
  mutationLock = true;
  try {
    action();
  } finally {
    mutationLock = false;
  }
}

function translateDocument(): void {
  if (typeof document === "undefined" || !document.body) return;
  withMutationLock(() => {
    translateTree(document.body);
  });
}

function startDomObserver(): void {
  if (typeof document === "undefined" || typeof MutationObserver === "undefined") return;
  if (domObserver || !document.body) return;

  domObserver = new MutationObserver((mutations) => {
    if (mutationLock) return;

    withMutationLock(() => {
      for (const mutation of mutations) {
        if (mutation.type === "characterData") {
          const node = mutation.target;
          if (node.nodeType === Node.TEXT_NODE) {
            translateTextNode(node as Text);
          }
          continue;
        }

        if (mutation.type === "attributes") {
          if (mutation.target instanceof Element) {
            translateElementAttributes(mutation.target);
          }
          continue;
        }

        if (mutation.type === "childList") {
          mutation.addedNodes.forEach((node) => translateTree(node));
        }
      }
    });
  });

  domObserver.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: [...TRANSLATABLE_ATTRIBUTES, "value"],
  });
}

function applyDocumentDirection(language: SupportedLanguage): void {
  if (typeof document === "undefined") return;

  const rtl = isRtlLanguage(language);

  document.documentElement.lang = language;
  document.documentElement.dir = rtl ? "rtl" : "ltr";
  document.documentElement.dataset.locale = language;
  document.documentElement.dataset.rtl = String(rtl);

  if (document.body) {
    document.body.dir = rtl ? "rtl" : "ltr";
    document.body.dataset.locale = language;
    document.body.dataset.rtl = String(rtl);
  }
}

function dispatchLanguageChange(language: SupportedLanguage): void {
  if (typeof window === "undefined") return;

  window.dispatchEvent(new CustomEvent("languageChange", { detail: language }));
  window.dispatchEvent(new CustomEvent("i18n:language-change", { detail: { language } }));
}

async function persistLanguageToProfile(language: SupportedLanguage): Promise<void> {
  if (typeof window === "undefined") return;

  try {
    await fetch("/api/user/preferences", {
      method: "PATCH",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ language }),
    });
  } catch {
    // Best effort only.
  }
}

async function syncLanguageFromProfile(): Promise<void> {
  if (typeof window === "undefined") return;
  if (import.meta.env.MODE === "test") return;

  if (profileSyncPromise) {
    await profileSyncPromise;
    return;
  }

  profileSyncPromise = (async () => {
    try {
      const response = await fetch("/api/user/preferences", {
        method: "GET",
        credentials: "include",
      });

      if (!response.ok) return;

      const data = (await response.json()) as { language?: string };
      const profileLanguage = normalizeLanguageCode(data.language);

      if (profileLanguage && profileLanguage !== activeLanguage) {
        await setLanguageAsync(profileLanguage, {
          persistStorage: true,
          persistProfile: false,
          emitEvent: true,
        });
      }
    } catch {
      // Ignore profile sync failures.
    }
  })();

  try {
    await profileSyncPromise;
  } finally {
    profileSyncPromise = null;
  }
}

function attachAuthSyncListener(): void {
  if (typeof window === "undefined") return;
  if (authSyncListener) return;
  if (import.meta.env.MODE === "test") return;

  authSyncListener = () => {
    void syncLanguageFromProfile();
  };

  window.addEventListener("auth:changed", authSyncListener);
}

function attachStorageSyncListener(): void {
  if (typeof window === "undefined") return;
  if (storageSyncListener) return;
  if (import.meta.env.MODE === "test") return;

  storageSyncListener = (event) => {
    if (event.key !== LANGUAGE_STORAGE_KEY || !event.newValue) return;

    const nextLanguage = normalizeLanguageCode(event.newValue);
    if (!nextLanguage || nextLanguage === activeLanguage) return;

    void setLanguageAsync(nextLanguage, {
      persistStorage: false,
      persistProfile: false,
      emitEvent: true,
    });
  };

  window.addEventListener("storage", storageSyncListener);
}

function detachEventSyncListeners(): void {
  if (typeof window === "undefined") return;

  if (authSyncListener) {
    window.removeEventListener("auth:changed", authSyncListener);
    authSyncListener = null;
  }

  if (storageSyncListener) {
    window.removeEventListener("storage", storageSyncListener);
    storageSyncListener = null;
  }
}

async function applyLanguage(language: SupportedLanguage, options: SetLanguageOptions = {}): Promise<void> {
  const token = ++languageChangeToken;

  activeLanguage = language;
  activeFallbackChain = getLanguageFallbackChain(language);

  if (options.persistStorage !== false) {
    persistLanguageLocally(language);
  }

  applyDocumentDirection(language);
  await ensureFallbackBundles(language);

  if (token !== languageChangeToken) {
    return;
  }

  translateDocument();

  if (options.emitEvent !== false) {
    dispatchLanguageChange(language);
  }

  if (options.persistProfile !== false) {
    void persistLanguageToProfile(language);
  }
}

export async function initializeI18n(): Promise<void> {
  if (bootstrapPromise) {
    await bootstrapPromise;
    return;
  }

  bootstrapPromise = (async () => {
    attachAuthSyncListener();
    attachStorageSyncListener();

    applyDocumentDirection(activeLanguage);
    await ensureFallbackBundles(activeLanguage);

    if (typeof document !== "undefined") {
      const startTranslation = () => {
        translateDocument();
        startDomObserver();
      };

      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", startTranslation, { once: true });
      } else {
        startTranslation();
      }
    }

    isInitialized = true;
    void syncLanguageFromProfile();
  })();

  await bootstrapPromise;
}

export function getLanguage(): SupportedLanguage {
  return activeLanguage;
}

export async function setLanguageAsync(
  language: string,
  options: SetLanguageOptions = {}
): Promise<SupportedLanguage> {
  const normalized = normalizeLanguageCode(language) ?? DEFAULT_LANGUAGE;
  await initializeI18n();
  await applyLanguage(normalized, options);
  return normalized;
}

export function setLanguage(language: SupportedLanguage): void {
  void setLanguageAsync(language, {
    persistStorage: true,
    persistProfile: true,
    emitEvent: true,
  });
}

export function t(key: string, options: TranslateOptions = {}): string {
  const values: TranslationValues = { ...(options.values ?? {}) };

  if (typeof options.count === "number") {
    values.count = options.count;
  }

  if (options.gender) {
    values.gender = options.gender;
  }

  const template =
    resolveMessageTemplate(key, options.logMissing !== false) ??
    options.defaultValue ??
    createMissingKeyFallback(key);

  return formatIcuMessage(template, values);
}

export function translateLiteral(literal: string): string {
  return translateLiteralText(literal);
}

export function getLanguageName(code: SupportedLanguage): string {
  const definition = getLanguageDefinition(code);
  if (!definition) return code;
  return definition.nativeName === definition.name
    ? definition.name
    : `${definition.nativeName} (${definition.name})`;
}

export function getSupportedLanguages(): { code: SupportedLanguage; name: string; rtl: boolean }[] {
  return LANGUAGE_REGISTRY.map((language) => ({
    code: language.code,
    name:
      language.nativeName === language.name
        ? language.name
        : `${language.nativeName} (${language.name})`,
    rtl: Boolean(language.rtl),
  }));
}

export function isI18nReady(): boolean {
  return isInitialized;
}

export function __resetI18nForTests(language: SupportedLanguage = DEFAULT_LANGUAGE): void {
  if (import.meta.env.MODE !== "test") return;

  domObserver?.disconnect();
  domObserver = null;
  detachEventSyncListeners();
  mutationLock = false;
  isInitialized = false;
  bootstrapPromise = null;
  profileSyncPromise = null;
  languageChangeToken = 0;
  missingKeysLogged.clear();
  messageFormatCache.clear();
  loadedBundles.clear();

  activeLanguage = language;
  activeFallbackChain = getLanguageFallbackChain(language);
  applyDocumentDirection(language);
}

export function formatDate(
  value: Date | string | number,
  options: Intl.DateTimeFormatOptions = {}
): string {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat(activeLanguage, options).format(date);
}

export function formatNumber(
  value: number,
  options: Intl.NumberFormatOptions = {}
): string {
  return new Intl.NumberFormat(activeLanguage, options).format(value);
}

export function formatCurrency(
  value: number,
  currency: string,
  options: Intl.NumberFormatOptions = {}
): string {
  return new Intl.NumberFormat(activeLanguage, {
    style: "currency",
    currency,
    ...options,
  }).format(value);
}

export function formatUnit(
  value: number,
  unit: Intl.NumberFormatOptions["unit"],
  options: Intl.NumberFormatOptions = {}
): string {
  if (!unit) return formatNumber(value, options);

  return new Intl.NumberFormat(activeLanguage, {
    style: "unit",
    unit,
    ...options,
  }).format(value);
}

export function formatRelativeTime(
  value: number,
  unit: Intl.RelativeTimeFormatUnit,
  options: Intl.RelativeTimeFormatOptions = { numeric: "auto" }
): string {
  return new Intl.RelativeTimeFormat(activeLanguage, options).format(value, unit);
}

export function formatList(
  values: string[],
  options: Intl.ListFormatOptions = { style: "long", type: "conjunction" }
): string {
  return new Intl.ListFormat(activeLanguage, options).format(values);
}

export type { SupportedLanguage };
export { SUPPORTED_LANGUAGES };

if (typeof window !== "undefined") {
  void initializeI18n();
}
