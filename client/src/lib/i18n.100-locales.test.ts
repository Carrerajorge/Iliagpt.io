import { beforeEach, describe, expect, it } from "vitest";
import { __resetI18nForTests, initializeI18n, setLanguageAsync, t } from "@/lib/i18n";
import { SUPPORTED_LANGUAGES, isRtlLanguage } from "@/locales/registry";

describe("i18n 100 locales hardening", () => {
  beforeEach(async () => {
    __resetI18nForTests("es");
    await initializeI18n();
  });

  it("loads all locales and preserves fallback/dir invariants", async () => {
    for (const language of SUPPORTED_LANGUAGES) {
      const applied = await setLanguageAsync(language, {
        persistProfile: false,
        persistStorage: false,
        emitEvent: false,
      });

      expect(applied).toBe(language);

      const welcome = t("welcome");
      expect(welcome).toBeTruthy();
      expect(welcome).not.toBe("Translation unavailable");
      expect(welcome).not.toBe("Texto no disponible");

      const expectedDir = isRtlLanguage(language) ? "rtl" : "ltr";
      expect(document.documentElement.dir).toBe(expectedDir);
      expect(document.body.dir).toBe(expectedDir);
    }
  });
});
