import { createContext, useContext, useEffect, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";

export type PlatformThemeMode = "dark" | "light" | "auto";

export type PlatformSettings = {
  app_name: string;
  app_description: string;
  support_email: string;
  timezone_default: string;
  date_format: "YYYY-MM-DD" | "DD/MM/YYYY" | "MM/DD/YYYY";
  maintenance_mode: boolean;

  primary_color: string;
  secondary_color: string;
  theme_mode: PlatformThemeMode;

  allow_registration: boolean;
  require_email_verification: boolean;

  default_model: string;
  max_tokens_per_request: number;
  enable_streaming: boolean;

  email_notifications_enabled: boolean;
};

type PublicSettingsResponse = {
  settings: Partial<PlatformSettings>;
  meta?: { fetchedAt?: string; updatedAt?: string | null };
};

const FALLBACK_SETTINGS: PlatformSettings = {
  app_name: "ILIAGPT",
  app_description: "AI Platform",
  support_email: "",
  timezone_default: "UTC",
  date_format: "YYYY-MM-DD",
  maintenance_mode: false,

  primary_color: "#6366f1",
  secondary_color: "#8b5cf6",
  theme_mode: "auto",

  allow_registration: true,
  require_email_verification: false,

  default_model: "grok-4-1-fast-non-reasoning",
  max_tokens_per_request: 4096,
  enable_streaming: true,

  email_notifications_enabled: true,
};

type PlatformSettingsContextValue = {
  settings: PlatformSettings;
  isLoading: boolean;
  error: string | null;
};

const PlatformSettingsContext = createContext<PlatformSettingsContextValue | null>(null);

export function usePlatformSettings() {
  const ctx = useContext(PlatformSettingsContext);
  if (!ctx) {
    throw new Error("usePlatformSettings must be used within PlatformSettingsProvider");
  }
  return ctx;
}

function hexToHslParts(hex: string): string | null {
  const raw = (hex || "").trim().replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) return null;

  const r = parseInt(raw.slice(0, 2), 16) / 255;
  const g = parseInt(raw.slice(2, 4), 16) / 255;
  const b = parseInt(raw.slice(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }

  const l = (max + min) / 2;
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));

  const hh = Math.round(h);
  const ss = Math.round(s * 100);
  const ll = Math.round(l * 100);
  return `${hh} ${ss}% ${ll}%`;
}

function applyBrandingCss(settings: PlatformSettings) {
  const fallbackPrimary = hexToHslParts(FALLBACK_SETTINGS.primary_color) || "239 84% 67%";
  const fallbackSecondary = hexToHslParts(FALLBACK_SETTINGS.secondary_color) || "271 81% 66%";

  const primary = hexToHslParts(settings.primary_color) || fallbackPrimary;
  const secondary = hexToHslParts(settings.secondary_color) || fallbackSecondary;

  const css = `
:root{
  --primary: ${primary};
  --ring: ${primary};
  --secondary: ${secondary};
}
`.trim();

  const id = "platform-branding";
  let el = document.getElementById(id) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = id;
    document.head.appendChild(el);
  }
  el.textContent = css;
}

export function PlatformSettingsProvider({ children }: { children: ReactNode }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["/api/settings/public"],
    queryFn: async () => {
      const res = await fetch("/api/settings/public", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load public settings: ${res.status}`);
      return (await res.json()) as PublicSettingsResponse;
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
    refetchOnWindowFocus: true,
    retry: 1,
  });

  const settings: PlatformSettings = { ...FALLBACK_SETTINGS, ...(data?.settings || {}) };

  useEffect(() => {
    // App name in browser chrome.
    document.title = settings.app_name || FALLBACK_SETTINGS.app_name;
  }, [settings.app_name]);

  useEffect(() => {
    // Branding variables used by shadcn/ui theme.
    applyBrandingCss(settings);
    
    // REMOVED: Do not force theme mode from platform settings. 
    // Let user preferences (SettingsContext) handle light/dark mode.
    // document.documentElement.dataset.platformThemeMode = settings.theme_mode;
  }, [settings.primary_color, settings.secondary_color, settings.theme_mode]);

  return (
    <PlatformSettingsContext.Provider
      value={{
        settings,
        isLoading,
        error: error ? String(error) : null,
      }}
    >
      {children}
    </PlatformSettingsContext.Provider>
  );
}
