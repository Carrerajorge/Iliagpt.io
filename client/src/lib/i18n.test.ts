import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetI18nForTests,
  formatDate,
  getLanguage,
  getSupportedLanguages,
  initializeI18n,
  setLanguageAsync,
  t,
  translateLiteral,
} from "@/lib/i18n";

function clearLanguageCookie() {
  document.cookie = "app_language=; Max-Age=0; path=/";
}

function resetLanguageStorage() {
  const storage = (globalThis as { localStorage?: { removeItem?: (key: string) => void; clear?: () => void } }).localStorage;
  if (!storage) return;

  storage.removeItem?.("app_language");
  storage.clear?.();
}

describe("i18n core", () => {
  beforeEach(async () => {
    clearLanguageCookie();
    resetLanguageStorage();
    __resetI18nForTests("es");
    await initializeI18n();
  });

  it("exposes 100 supported locales", () => {
    const locales = getSupportedLanguages();
    expect(locales).toHaveLength(100);
  });

  it("persists language and updates RTL direction", async () => {
    await setLanguageAsync("ar", { persistProfile: false });

    expect(getLanguage()).toBe("ar");
    expect(document.cookie).toContain("app_language=ar");
    expect(document.documentElement.dir).toBe("rtl");
  });

  it("uses fallback chain locale -> en -> es", async () => {
    await setLanguageAsync("fr", { persistProfile: false });

    expect(t("welcome")).toBe("How can I help you today?");
    expect(t("planDescriptions.pro")).toBe("Maximize your productivity");
  });

  it("supports ICU plural and gender interpolation", async () => {
    await setLanguageAsync("es", { persistProfile: false });

    expect(t("notifications.count", { count: 0 })).toContain("No tienes notificaciones");
    expect(t("notifications.count", { count: 1 })).toContain("1 notificación");
    expect(t("greeting.user", { values: { name: "Alex" }, gender: "female" })).toContain("Bienvenida Alex");
  });

  it("translates literal UI strings from locale bundles", async () => {
    await setLanguageAsync("en", { persistProfile: false });

    expect(translateLiteral("Notificaciones")).toBe("Notifications");
    expect(translateLiteral("Guardar")).toBe("Save");
  });

  it("formats dates using active locale", async () => {
    const date = new Date("2026-02-16T10:00:00.000Z");

    await setLanguageAsync("en", { persistProfile: false });
    const enFormatted = formatDate(date, { month: "long", day: "numeric" });

    await setLanguageAsync("es", { persistProfile: false });
    const esFormatted = formatDate(date, { month: "long", day: "numeric" });

    expect(enFormatted).not.toBe(esFormatted);
  });
});
