import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getLanguage,
  getSupportedLanguages,
  initializeI18n,
  isI18nReady,
  setLanguage as setLanguageInternal,
  t,
  type SupportedLanguage,
  type TranslateOptions,
} from "@/lib/i18n";

export function useLanguage() {
  const [language, setLanguageState] = useState<SupportedLanguage>(() => getLanguage());
  const [ready, setReady] = useState<boolean>(() => isI18nReady());

  useEffect(() => {
    let mounted = true;

    const handleLanguageChange = (event: Event) => {
      const customEvent = event as CustomEvent<SupportedLanguage>;
      setLanguageState(customEvent.detail);
      setReady(true);
    };

    window.addEventListener("languageChange", handleLanguageChange as EventListener);

    if (!ready) {
      void initializeI18n().then(() => {
        if (!mounted) return;
        setLanguageState(getLanguage());
        setReady(true);
      });
    }

    return () => {
      mounted = false;
      window.removeEventListener("languageChange", handleLanguageChange as EventListener);
    };
  }, [ready]);

  const setLanguage = useCallback((lang: SupportedLanguage) => {
    setLanguageInternal(lang);
  }, []);

  const translate = useCallback((key: string, options?: TranslateOptions): string => {
    return t(key, options);
  }, []);

  const supportedLanguages = useMemo(() => getSupportedLanguages(), []);

  return {
    language,
    setLanguage,
    t: translate,
    ready,
    supportedLanguages,
  };
}
