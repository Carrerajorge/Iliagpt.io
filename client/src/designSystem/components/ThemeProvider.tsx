import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { darkTheme, lightTheme, themeToCSS, type ColorTheme } from "../tokens/colors";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ThemePreference = "light" | "dark" | "auto";

export interface ThemeContextValue {
  /** The user's stored preference */
  preference: ThemePreference;
  /** The resolved theme (never 'auto') */
  resolved: "light" | "dark";
  /** The active ColorTheme token object */
  theme: ColorTheme;
  /** Update the user's preference */
  setPreference: (pref: ThemePreference) => void;
  /** Toggle between light and dark (skips auto) */
  toggle: () => void;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const ThemeContext = createContext<ThemeContextValue | null>(null);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STORAGE_KEY = "iliagpt-theme-preference";

function readStoredPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY) as ThemePreference | null;
    if (stored === "light" || stored === "dark" || stored === "auto") {
      return stored;
    }
  } catch {
    // localStorage not available (SSR, private mode)
  }
  return "auto";
}

function writeStoredPreference(pref: ThemePreference): void {
  try {
    localStorage.setItem(STORAGE_KEY, pref);
  } catch {
    // ignore
  }
}

function getSystemPreference(): "light" | "dark" {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function resolveTheme(preference: ThemePreference): "light" | "dark" {
  if (preference === "auto") return getSystemPreference();
  return preference;
}

/**
 * Injects/updates all color tokens as CSS custom properties on <html>.
 * Also manages the Tailwind `dark` class for dark-mode variants.
 */
function applyThemeToDOM(resolved: "light" | "dark", theme: ColorTheme): void {
  if (typeof document === "undefined") return;

  const root = document.documentElement;

  // Apply CSS custom properties
  const css = themeToCSS(theme);
  const lines = css.split("\n");
  for (const line of lines) {
    const match = line.trim().match(/^(--[\w-]+):\s*(.+);$/);
    if (match) {
      root.style.setProperty(match[1], match[2]);
    }
  }

  // Tailwind dark class
  if (resolved === "dark") {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }

  // data attribute for non-Tailwind selectors
  root.setAttribute("data-theme", resolved);
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export interface ThemeProviderProps {
  children: React.ReactNode;
  /** Override the initial preference (useful for SSR hydration) */
  defaultPreference?: ThemePreference;
}

export function ThemeProvider({
  children,
  defaultPreference,
}: ThemeProviderProps) {
  const [preference, setPreferenceState] = useState<ThemePreference>(
    () => defaultPreference ?? readStoredPreference()
  );

  const [systemPref, setSystemPref] = useState<"light" | "dark">(
    getSystemPreference
  );

  // Listen for OS-level theme changes
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => {
      setSystemPref(e.matches ? "dark" : "light");
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const resolved = useMemo<"light" | "dark">(() => {
    if (preference === "auto") return systemPref;
    return preference;
  }, [preference, systemPref]);

  const theme = useMemo<ColorTheme>(
    () => (resolved === "dark" ? darkTheme : lightTheme),
    [resolved]
  );

  // Apply tokens + Tailwind class whenever resolved changes
  useEffect(() => {
    applyThemeToDOM(resolved, theme);
  }, [resolved, theme]);

  const setPreference = useCallback((pref: ThemePreference) => {
    setPreferenceState(pref);
    writeStoredPreference(pref);
  }, []);

  const toggle = useCallback(() => {
    setPreference(resolved === "dark" ? "light" : "dark");
  }, [resolved, setPreference]);

  const value = useMemo<ThemeContextValue>(
    () => ({ preference, resolved, theme, setPreference, toggle }),
    [preference, resolved, theme, setPreference, toggle]
  );

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Access the current theme context.
 * Must be used inside a <ThemeProvider>.
 */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within a <ThemeProvider>");
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// ThemeToggle component
// ---------------------------------------------------------------------------

export interface ThemeToggleProps {
  /** Cycle order: light → dark → auto → light */
  cycleOrder?: ThemePreference[];
  className?: string;
  showLabel?: boolean;
}

const PREFERENCE_ICONS: Record<ThemePreference, React.ReactNode> = {
  light: (
    <svg
      className="w-4 h-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m12.728 0l-.707-.707M6.343 6.343l-.707-.707M12 8a4 4 0 100 8 4 4 0 000-8z"
      />
    </svg>
  ),
  dark: (
    <svg
      className="w-4 h-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
      />
    </svg>
  ),
  auto: (
    <svg
      className="w-4 h-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17H3a2 2 0 01-2-2V5a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2h-2"
      />
    </svg>
  ),
};

const PREFERENCE_LABELS: Record<ThemePreference, string> = {
  light: "Light",
  dark: "Dark",
  auto: "Auto",
};

const PREFERENCE_NEXT: Record<ThemePreference, ThemePreference> = {
  light: "dark",
  dark: "auto",
  auto: "light",
};

export function ThemeToggle({
  className = "",
  showLabel = false,
}: ThemeToggleProps) {
  const { preference, setPreference } = useTheme();

  const handleClick = useCallback(() => {
    setPreference(PREFERENCE_NEXT[preference]);
  }, [preference, setPreference]);

  return (
    <button
      onClick={handleClick}
      aria-label={`Theme: ${PREFERENCE_LABELS[preference]}. Click to switch.`}
      title={`Current: ${PREFERENCE_LABELS[preference]}`}
      className={[
        "flex items-center gap-2 px-3 py-2 rounded-lg",
        "text-gray-400 hover:text-gray-200",
        "bg-gray-800/60 hover:bg-gray-700/60",
        "border border-gray-700/60 hover:border-gray-600",
        "transition-all duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900",
        className,
      ].join(" ")}
    >
      {PREFERENCE_ICONS[preference]}
      {showLabel && (
        <span className="text-sm font-medium">{PREFERENCE_LABELS[preference]}</span>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// ThemeSegmented — three-button segment control (alternative to toggle)
// ---------------------------------------------------------------------------

export function ThemeSegmented({ className = "" }: { className?: string }) {
  const { preference, setPreference } = useTheme();

  const options: ThemePreference[] = ["light", "dark", "auto"];

  return (
    <div
      role="group"
      aria-label="Theme preference"
      className={[
        "flex items-center p-1 rounded-xl bg-gray-800/60 border border-gray-700/60",
        className,
      ].join(" ")}
    >
      {options.map((option) => {
        const active = preference === option;
        return (
          <button
            key={option}
            onClick={() => setPreference(option)}
            aria-pressed={active}
            aria-label={`${PREFERENCE_LABELS[option]} theme`}
            className={[
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-150",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500",
              active
                ? "bg-gray-700 text-gray-100 shadow-sm"
                : "text-gray-500 hover:text-gray-300 hover:bg-gray-700/40",
            ].join(" ")}
          >
            <span className="w-4 h-4">{PREFERENCE_ICONS[option]}</span>
            {PREFERENCE_LABELS[option]}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Re-exports for convenience
// ---------------------------------------------------------------------------

export { darkTheme, lightTheme } from "../tokens/colors";
export type { ColorTheme } from "../tokens/colors";
export default ThemeProvider;
