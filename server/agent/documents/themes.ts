/**
 * Design System Themes — Predefined theme presets for document generation.
 *
 * Each theme is a complete set of DesignTokens covering fonts, colors,
 * spacing, layout, borders, and shadows.  The `resolveTheme()` helper
 * accepts a theme name string OR a partial token override and always
 * returns a fully-resolved DesignTokens object.
 */

import { DesignTokensSchema, type DesignTokens } from "./documentEngine";

/* ================================================================== */
/*  PREDEFINED THEMES                                                  */
/* ================================================================== */

export const THEMES: Record<string, DesignTokens> = {
  /** Google-inspired clean design (default) */
  default: DesignTokensSchema.parse({ name: "default", version: "1.0.0" }),

  /** Corporate dark-blue & orange palette */
  corporate: DesignTokensSchema.parse({
    name: "corporate",
    version: "1.0.0",
    font: { heading: "Calibri", body: "Calibri Light" },
    color: {
      primary: "#1a365d",
      secondary: "#2b6cb0",
      accent: "#ed8936",
      success: "#38a169",
      warning: "#ecc94b",
      headerBg: "#1a365d",
      headerFg: "#ffffff",
      textPrimary: "#2d3748",
      textSecondary: "#718096",
      border: "#cbd5e0",
      surface: "#edf2f7",
      zebraOdd: "#f7fafc",
    },
  }),

  /** Academic / formal — Times New Roman, neutral tones */
  academic: DesignTokensSchema.parse({
    name: "academic",
    version: "1.0.0",
    font: {
      heading: "Times New Roman",
      body: "Times New Roman",
      sizeBody: 12,
      sizeH1: 24,
      sizeH2: 20,
      sizeH3: 16,
      lineHeight: 2.0,
    },
    color: {
      primary: "#1a1a2e",
      secondary: "#16213e",
      accent: "#0f3460",
      headerBg: "#1a1a2e",
      headerFg: "#ffffff",
      textPrimary: "#1a1a1a",
      textSecondary: "#4a4a4a",
    },
    layout: { slideHeight: 7.5 }, // 4:3 for academic presentations
  }),

  /** Modern violet & pink gradient feel */
  modern: DesignTokensSchema.parse({
    name: "modern",
    version: "1.0.0",
    font: { heading: "Segoe UI", body: "Segoe UI" },
    color: {
      primary: "#6C63FF",
      secondary: "#3F3D56",
      accent: "#FF6584",
      headerBg: "#6C63FF",
      headerFg: "#ffffff",
      textPrimary: "#2d2d2d",
      textSecondary: "#6b6b6b",
      surface: "#f5f3ff",
      zebraOdd: "#faf5ff",
    },
  }),

  /** Minimalist black & white */
  minimal: DesignTokensSchema.parse({
    name: "minimal",
    version: "1.0.0",
    font: { heading: "Arial", body: "Arial" },
    color: {
      primary: "#000000",
      secondary: "#333333",
      accent: "#666666",
      headerBg: "#000000",
      headerFg: "#ffffff",
      textPrimary: "#1a1a1a",
      textSecondary: "#666666",
      border: "#e0e0e0",
      surface: "#fafafa",
    },
  }),

  /** Nature green tones */
  nature: DesignTokensSchema.parse({
    name: "nature",
    version: "1.0.0",
    font: { heading: "Georgia", body: "Calibri" },
    color: {
      primary: "#2d6a4f",
      secondary: "#40916c",
      accent: "#95d5b2",
      headerBg: "#2d6a4f",
      headerFg: "#ffffff",
      textPrimary: "#1b4332",
      textSecondary: "#52796f",
      surface: "#d8f3dc",
      zebraOdd: "#edf6f0",
    },
  }),
};

/* ================================================================== */
/*  RESOLVER                                                           */
/* ================================================================== */

/** Whitelist of valid theme names — prevents prototype pollution via __proto__ / constructor */
const ALLOWED_THEMES = new Set(Object.keys(THEMES));

/**
 * Resolve a theme from a name string, partial token override, or undefined.
 *
 * @param nameOrTokens - Theme name ("corporate"), partial tokens, or undefined
 * @returns Fully resolved DesignTokens
 */
/** Dangerous keys that indicate prototype pollution attempts */
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export function resolveTheme(
  nameOrTokens: string | Partial<DesignTokens> | undefined
): DesignTokens {
  if (!nameOrTokens) return THEMES.default;
  if (typeof nameOrTokens === "string") {
    if (!ALLOWED_THEMES.has(nameOrTokens)) {
      console.warn(`[Theme] Unknown theme "${nameOrTokens}", using default`);
      return THEMES.default;
    }
    return THEMES[nameOrTokens];
  }
  // Recursive check for prototype pollution attempts (not just top-level)
  if (typeof nameOrTokens === "object" && nameOrTokens !== null) {
    if (hasDangerousKeys(nameOrTokens)) {
      return THEMES.default;
    }
  }
  // Partial tokens override — parse through Zod to strip unknown keys
  try {
    return DesignTokensSchema.parse(nameOrTokens);
  } catch (err) {
    console.warn(`[Theme] Failed to parse theme tokens: ${err instanceof Error ? err.message : String(err)}, using default`);
    return THEMES.default;
  }
}

/** Recursively check for dangerous keys (__proto__, constructor, prototype) at all nesting levels */
function hasDangerousKeys(obj: unknown, depth: number = 0): boolean {
  if (depth > 5 || obj === null || typeof obj !== "object") return false;
  for (const key of Object.keys(obj as Record<string, unknown>)) {
    if (DANGEROUS_KEYS.has(key)) {
      console.warn(`[Theme] Rejecting theme with dangerous key: ${key}`);
      return true;
    }
    if (hasDangerousKeys((obj as Record<string, unknown>)[key], depth + 1)) return true;
  }
  return false;
}
