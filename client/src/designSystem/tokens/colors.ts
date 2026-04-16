// ============================================================
// Design System – Color Tokens
// ============================================================

export type ColorShade = 50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 950;

export type ColorScale = Record<ColorShade, string>;

// ---------------------------------------------------------------------------
// Raw palettes
// ---------------------------------------------------------------------------

export const primary: ColorScale = {
  50:  '#eef2ff',
  100: '#e0e7ff',
  200: '#c7d2fe',
  300: '#a5b4fc',
  400: '#818cf8',
  500: '#6366f1',
  600: '#4f46e5',
  700: '#4338ca',
  800: '#3730a3',
  900: '#312e81',
  950: '#1e1b4b',
};

export const secondary: ColorScale = {
  50:  '#f8fafc',
  100: '#f1f5f9',
  200: '#e2e8f0',
  300: '#cbd5e1',
  400: '#94a3b8',
  500: '#64748b',
  600: '#475569',
  700: '#334155',
  800: '#1e293b',
  900: '#0f172a',
  950: '#020617',
};

export const accent: ColorScale = {
  50:  '#f5f3ff',
  100: '#ede9fe',
  200: '#ddd6fe',
  300: '#c4b5fd',
  400: '#a78bfa',
  500: '#8b5cf6',
  600: '#7c3aed',
  700: '#6d28d9',
  800: '#5b21b6',
  900: '#4c1d95',
  950: '#2e1065',
};

export const success: ColorScale = {
  50:  '#ecfdf5',
  100: '#d1fae5',
  200: '#a7f3d0',
  300: '#6ee7b7',
  400: '#34d399',
  500: '#10b981',
  600: '#059669',
  700: '#047857',
  800: '#065f46',
  900: '#064e3b',
  950: '#022c22',
};

export const warning: ColorScale = {
  50:  '#fffbeb',
  100: '#fef3c7',
  200: '#fde68a',
  300: '#fcd34d',
  400: '#fbbf24',
  500: '#f59e0b',
  600: '#d97706',
  700: '#b45309',
  800: '#92400e',
  900: '#78350f',
  950: '#451a03',
};

export const error: ColorScale = {
  50:  '#fef2f2',
  100: '#fee2e2',
  200: '#fecaca',
  300: '#fca5a5',
  400: '#f87171',
  500: '#ef4444',
  600: '#dc2626',
  700: '#b91c1c',
  800: '#991b1b',
  900: '#7f1d1d',
  950: '#450a0a',
};

export const info: ColorScale = {
  50:  '#f0f9ff',
  100: '#e0f2fe',
  200: '#bae6fd',
  300: '#7dd3fc',
  400: '#38bdf8',
  500: '#0ea5e9',
  600: '#0284c7',
  700: '#0369a1',
  800: '#075985',
  900: '#0c4a6e',
  950: '#082f49',
};

// ---------------------------------------------------------------------------
// Semantic color interface
// ---------------------------------------------------------------------------

export interface SemanticColors {
  // Background
  bgBase: string;
  bgSubtle: string;
  bgMuted: string;
  bgOverlay: string;

  // Surface
  surfaceDefault: string;
  surfaceRaised: string;
  surfaceOverlay: string;
  surfaceSunken: string;

  // Border
  borderDefault: string;
  borderStrong: string;
  borderFocus: string;

  // Text
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  textDisabled: string;
  textInverse: string;
  textOnColor: string;

  // Brand
  brandDefault: string;
  brandHover: string;
  brandActive: string;
  brandSubtle: string;
  brandOnBrand: string;

  // Accent
  accentDefault: string;
  accentHover: string;
  accentSubtle: string;

  // Semantic states
  successDefault: string;
  successSubtle: string;
  successText: string;

  warningDefault: string;
  warningSubtle: string;
  warningText: string;

  errorDefault: string;
  errorSubtle: string;
  errorText: string;

  infoDefault: string;
  infoSubtle: string;
  infoText: string;
}

// ---------------------------------------------------------------------------
// Light theme
// ---------------------------------------------------------------------------

export const lightTheme: SemanticColors = {
  bgBase:     '#ffffff',
  bgSubtle:   secondary[50],
  bgMuted:    secondary[100],
  bgOverlay:  'rgba(0, 0, 0, 0.4)',

  surfaceDefault: '#ffffff',
  surfaceRaised:  secondary[50],
  surfaceOverlay: '#ffffff',
  surfaceSunken:  secondary[100],

  borderDefault: secondary[200],
  borderStrong:  secondary[400],
  borderFocus:   primary[500],

  textPrimary:   secondary[900],
  textSecondary: secondary[700],
  textMuted:     secondary[500],
  textDisabled:  secondary[400],
  textInverse:   '#ffffff',
  textOnColor:   '#ffffff',

  brandDefault: primary[600],
  brandHover:   primary[700],
  brandActive:  primary[800],
  brandSubtle:  primary[50],
  brandOnBrand: '#ffffff',

  accentDefault: accent[600],
  accentHover:   accent[700],
  accentSubtle:  accent[50],

  successDefault: success[600],
  successSubtle:  success[50],
  successText:    success[700],

  warningDefault: warning[500],
  warningSubtle:  warning[50],
  warningText:    warning[700],

  errorDefault: error[600],
  errorSubtle:  error[50],
  errorText:    error[700],

  infoDefault: info[600],
  infoSubtle:  info[50],
  infoText:    info[700],
};

// ---------------------------------------------------------------------------
// Dark theme
// ---------------------------------------------------------------------------

export const darkTheme: SemanticColors = {
  bgBase:     secondary[950],
  bgSubtle:   secondary[900],
  bgMuted:    secondary[800],
  bgOverlay:  'rgba(0, 0, 0, 0.6)',

  surfaceDefault: secondary[900],
  surfaceRaised:  secondary[800],
  surfaceOverlay: secondary[800],
  surfaceSunken:  secondary[950],

  borderDefault: secondary[700],
  borderStrong:  secondary[500],
  borderFocus:   primary[400],

  textPrimary:   secondary[50],
  textSecondary: secondary[300],
  textMuted:     secondary[400],
  textDisabled:  secondary[600],
  textInverse:   secondary[950],
  textOnColor:   '#ffffff',

  brandDefault: primary[400],
  brandHover:   primary[300],
  brandActive:  primary[200],
  brandSubtle:  primary[950],
  brandOnBrand: '#ffffff',

  accentDefault: accent[400],
  accentHover:   accent[300],
  accentSubtle:  accent[950],

  successDefault: success[400],
  successSubtle:  success[950],
  successText:    success[300],

  warningDefault: warning[400],
  warningSubtle:  warning[950],
  warningText:    warning[300],

  errorDefault: error[400],
  errorSubtle:  error[950],
  errorText:    error[300],

  infoDefault: info[400],
  infoSubtle:  info[950],
  infoText:    info[300],
};

// ---------------------------------------------------------------------------
// CSS variable generator
// ---------------------------------------------------------------------------

/** Converts a SemanticColors object into a CSS custom property block string. */
export function getCSSVars(theme: SemanticColors): string {
  const lines: string[] = [];

  const toKebab = (key: string) =>
    key.replace(/([A-Z])/g, (m) => `-${m.toLowerCase()}`);

  for (const [key, value] of Object.entries(theme)) {
    lines.push(`  --color-${toKebab(key)}: ${value};`);
  }

  return `:root {\n${lines.join('\n')}\n}`;
}

// ---------------------------------------------------------------------------
// WCAG contrast checker
// ---------------------------------------------------------------------------

/** Parses a 3- or 6-digit hex color string to [r, g, b] in 0-255. */
function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const full = clean.length === 3
    ? clean.split('').map((c) => c + c).join('')
    : clean;
  const num = parseInt(full, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

/** Relative luminance per WCAG 2.1. */
function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contrast ratio between two hex colors. */
export function contrastRatio(fg: string, bg: string): number {
  const L1 = relativeLuminance(fg);
  const L2 = relativeLuminance(bg);
  const lighter = Math.max(L1, L2);
  const darker  = Math.min(L1, L2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Returns true when the fg/bg combination passes WCAG AA:
 * – 4.5:1 for normal text
 * – 3:1 for large text (18pt+ or 14pt+ bold)
 */
export function meetsAA(
  fg: string,
  bg: string,
  largeText = false,
): boolean {
  const ratio = contrastRatio(fg, bg);
  return largeText ? ratio >= 3 : ratio >= 4.5;
}

/** Returns true when the pair passes WCAG AAA (7:1 / 4.5:1). */
export function meetsAAA(
  fg: string,
  bg: string,
  largeText = false,
): boolean {
  const ratio = contrastRatio(fg, bg);
  return largeText ? ratio >= 4.5 : ratio >= 7;
}

// ---------------------------------------------------------------------------
// Re-export palettes as a map for convenience
// ---------------------------------------------------------------------------

export const palettes = {
  primary,
  secondary,
  accent,
  success,
  warning,
  error,
  info,
} as const;

export type PaletteName = keyof typeof palettes;
