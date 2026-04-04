/**
 * Design System Typography Tokens
 *
 * Type scale follows a modular ratio of ~1.25 (Major Third).
 * All sizes expressed in rem units (base: 16px).
 */

// ---------------------------------------------------------------------------
// Font family stacks
// ---------------------------------------------------------------------------

export const fontFamilies = {
  /**
   * Primary sans-serif stack — optimized for UI readability.
   * Falls back through system UI fonts for performance.
   */
  sans: [
    "Inter",
    "ui-sans-serif",
    "system-ui",
    "-apple-system",
    "BlinkMacSystemFont",
    '"Segoe UI"',
    "Roboto",
    '"Helvetica Neue"',
    "Arial",
    '"Noto Sans"',
    "sans-serif",
    '"Apple Color Emoji"',
    '"Segoe UI Emoji"',
    '"Segoe UI Symbol"',
    '"Noto Color Emoji"',
  ].join(", "),

  /**
   * Monospace stack — for code, terminals, and data display.
   * Prioritizes fonts with good ligature and glyph support.
   */
  mono: [
    '"JetBrains Mono"',
    '"Fira Code"',
    '"Cascadia Code"',
    '"Source Code Pro"',
    "ui-monospace",
    "SFMono-Regular",
    "Menlo",
    "Monaco",
    "Consolas",
    '"Liberation Mono"',
    '"Courier New"',
    "monospace",
  ].join(", "),

  /**
   * Display / heading stack — for large, prominent text.
   * Uses variable font features when available.
   */
  display: [
    '"Cal Sans"',
    '"Plus Jakarta Sans"',
    "Inter",
    "ui-sans-serif",
    "system-ui",
    "sans-serif",
  ].join(", "),
} as const;

export type FontFamily = keyof typeof fontFamilies;

// ---------------------------------------------------------------------------
// Font weight map
// ---------------------------------------------------------------------------

export const fontWeights = {
  thin: "100",
  extralight: "200",
  light: "300",
  normal: "400",
  medium: "500",
  semibold: "600",
  bold: "700",
  extrabold: "800",
  black: "900",
} as const;

export type FontWeight = keyof typeof fontWeights;

// ---------------------------------------------------------------------------
// Type scale
// ---------------------------------------------------------------------------

export interface TypeScaleEntry {
  /** Font size in rem */
  fontSize: string;
  /** Unitless line height ratio */
  lineHeight: string;
  /** Letter spacing (em or px) */
  letterSpacing: string;
}

/**
 * Modular type scale (Major Third ≈ 1.25).
 * Base: 1rem = 16px
 */
export const typeScale = {
  /** 11px — smallest labels, legal text */
  "2xs": {
    fontSize: "0.6875rem",
    lineHeight: "1rem",
    letterSpacing: "0.02em",
  },
  /** 12px — captions, badges, tiny UI */
  xs: {
    fontSize: "0.75rem",
    lineHeight: "1rem",
    letterSpacing: "0.02em",
  },
  /** 13px — secondary UI labels */
  sm: {
    fontSize: "0.8125rem",
    lineHeight: "1.25rem",
    letterSpacing: "0.01em",
  },
  /** 14px — default body/UI text */
  base: {
    fontSize: "0.875rem",
    lineHeight: "1.5rem",
    letterSpacing: "0em",
  },
  /** 16px — comfortable reading body text */
  md: {
    fontSize: "1rem",
    lineHeight: "1.625rem",
    letterSpacing: "0em",
  },
  /** 18px — large body, small headings */
  lg: {
    fontSize: "1.125rem",
    lineHeight: "1.75rem",
    letterSpacing: "-0.01em",
  },
  /** 20px — sub-headings */
  xl: {
    fontSize: "1.25rem",
    lineHeight: "1.875rem",
    letterSpacing: "-0.01em",
  },
  /** 24px — h4-level headings */
  "2xl": {
    fontSize: "1.5rem",
    lineHeight: "2rem",
    letterSpacing: "-0.02em",
  },
  /** 30px — h3-level headings */
  "3xl": {
    fontSize: "1.875rem",
    lineHeight: "2.375rem",
    letterSpacing: "-0.02em",
  },
  /** 36px — h2-level headings */
  "4xl": {
    fontSize: "2.25rem",
    lineHeight: "2.75rem",
    letterSpacing: "-0.03em",
  },
  /** 48px — h1-level headings */
  "5xl": {
    fontSize: "3rem",
    lineHeight: "3.5rem",
    letterSpacing: "-0.04em",
  },
  /** 60px — display / hero headings */
  "6xl": {
    fontSize: "3.75rem",
    lineHeight: "4.25rem",
    letterSpacing: "-0.04em",
  },
  /** 72px — massive display text */
  "7xl": {
    fontSize: "4.5rem",
    lineHeight: "5rem",
    letterSpacing: "-0.05em",
  },
} as const;

export type TypeScaleKey = keyof typeof typeScale;

// ---------------------------------------------------------------------------
// Composite text styles
// ---------------------------------------------------------------------------

export interface TextStyle extends TypeScaleEntry {
  fontFamily: string;
  fontWeight: string;
}

/** Heading styles (h1 – h6) */
export const headingStyles: Record<"h1" | "h2" | "h3" | "h4" | "h5" | "h6", TextStyle> = {
  h1: {
    ...typeScale["5xl"],
    fontFamily: fontFamilies.display,
    fontWeight: fontWeights.bold,
    letterSpacing: "-0.04em",
  },
  h2: {
    ...typeScale["4xl"],
    fontFamily: fontFamilies.display,
    fontWeight: fontWeights.bold,
    letterSpacing: "-0.03em",
  },
  h3: {
    ...typeScale["3xl"],
    fontFamily: fontFamilies.display,
    fontWeight: fontWeights.semibold,
    letterSpacing: "-0.02em",
  },
  h4: {
    ...typeScale["2xl"],
    fontFamily: fontFamilies.display,
    fontWeight: fontWeights.semibold,
    letterSpacing: "-0.02em",
  },
  h5: {
    ...typeScale["xl"],
    fontFamily: fontFamilies.display,
    fontWeight: fontWeights.semibold,
    letterSpacing: "-0.01em",
  },
  h6: {
    ...typeScale["lg"],
    fontFamily: fontFamilies.display,
    fontWeight: fontWeights.semibold,
    letterSpacing: "-0.01em",
  },
};

/** Body text styles */
export const bodyStyles = {
  /** Comfortable reading body text — articles, long-form content */
  bodyLarge: {
    ...typeScale["md"],
    fontFamily: fontFamilies.sans,
    fontWeight: fontWeights.normal,
  },
  /** Default body text — general UI content */
  body: {
    ...typeScale["base"],
    fontFamily: fontFamilies.sans,
    fontWeight: fontWeights.normal,
  },
  /** Small body — secondary content, metadata */
  bodySmall: {
    ...typeScale["sm"],
    fontFamily: fontFamilies.sans,
    fontWeight: fontWeights.normal,
  },
} as const;

/** UI text styles — labels, buttons, navigation */
export const uiStyles = {
  /** Button / CTA labels */
  buttonLg: {
    ...typeScale["md"],
    fontFamily: fontFamilies.sans,
    fontWeight: fontWeights.semibold,
    letterSpacing: "0em",
  },
  button: {
    ...typeScale["base"],
    fontFamily: fontFamilies.sans,
    fontWeight: fontWeights.semibold,
    letterSpacing: "0em",
  },
  buttonSm: {
    ...typeScale["sm"],
    fontFamily: fontFamilies.sans,
    fontWeight: fontWeights.semibold,
    letterSpacing: "0.01em",
  },

  /** Form labels */
  label: {
    ...typeScale["sm"],
    fontFamily: fontFamilies.sans,
    fontWeight: fontWeights.medium,
    letterSpacing: "0.01em",
  },

  /** Input placeholder text */
  placeholder: {
    ...typeScale["base"],
    fontFamily: fontFamilies.sans,
    fontWeight: fontWeights.normal,
  },

  /** Navigation links */
  navItem: {
    ...typeScale["sm"],
    fontFamily: fontFamilies.sans,
    fontWeight: fontWeights.medium,
    letterSpacing: "0.01em",
  },

  /** Badges, tags, pills */
  badge: {
    ...typeScale["xs"],
    fontFamily: fontFamilies.sans,
    fontWeight: fontWeights.semibold,
    letterSpacing: "0.03em",
  },

  /** Caption / helper text */
  caption: {
    ...typeScale["xs"],
    fontFamily: fontFamilies.sans,
    fontWeight: fontWeights.normal,
    letterSpacing: "0.01em",
  },

  /** Overline — small uppercase category label */
  overline: {
    ...typeScale["xs"],
    fontFamily: fontFamilies.sans,
    fontWeight: fontWeights.semibold,
    letterSpacing: "0.08em",
  },

  /** Tooltip text */
  tooltip: {
    ...typeScale["xs"],
    fontFamily: fontFamilies.sans,
    fontWeight: fontWeights.medium,
    letterSpacing: "0em",
  },

  /** Tab labels */
  tab: {
    ...typeScale["sm"],
    fontFamily: fontFamilies.sans,
    fontWeight: fontWeights.medium,
    letterSpacing: "0.01em",
  },
} as const;

/** Code / monospace styles */
export const codeStyles = {
  /** Inline code — within prose */
  inline: {
    ...typeScale["sm"],
    fontFamily: fontFamilies.mono,
    fontWeight: fontWeights.normal,
    letterSpacing: "0em",
  },

  /** Code block — syntax highlighted regions */
  block: {
    ...typeScale["sm"],
    fontFamily: fontFamilies.mono,
    fontWeight: fontWeights.normal,
    letterSpacing: "0em",
    lineHeight: "1.75rem",  // Slightly more generous for readability in blocks
  },

  /** Code block with line numbers */
  blockWithLines: {
    ...typeScale["sm"],
    fontFamily: fontFamilies.mono,
    fontWeight: fontWeights.normal,
    letterSpacing: "0em",
    lineHeight: "1.75rem",
  },

  /** Terminal / shell output */
  terminal: {
    ...typeScale["sm"],
    fontFamily: fontFamilies.mono,
    fontWeight: fontWeights.normal,
    letterSpacing: "0em",
  },

  /** Code comment */
  comment: {
    ...typeScale["sm"],
    fontFamily: fontFamilies.mono,
    fontWeight: fontWeights.normal,
    letterSpacing: "0em",
  },

  /** Keyboard shortcut label — kbd element */
  kbd: {
    ...typeScale["xs"],
    fontFamily: fontFamilies.mono,
    fontWeight: fontWeights.medium,
    letterSpacing: "0em",
  },
} as const;

// ---------------------------------------------------------------------------
// CSS custom property generation
// ---------------------------------------------------------------------------

/** Generates a flat CSS custom property block from the design tokens */
export function generateTypographyCSS(): string {
  const entries: string[] = [];

  // Font families
  for (const [key, value] of Object.entries(fontFamilies)) {
    entries.push(`  --font-family-${key}: ${value};`);
  }

  // Font weights
  for (const [key, value] of Object.entries(fontWeights)) {
    entries.push(`  --font-weight-${key}: ${value};`);
  }

  // Type scale
  for (const [key, scale] of Object.entries(typeScale)) {
    const cssKey = key.replace(/\//g, "-");
    entries.push(`  --text-${cssKey}-size: ${scale.fontSize};`);
    entries.push(`  --text-${cssKey}-line-height: ${scale.lineHeight};`);
    entries.push(`  --text-${cssKey}-letter-spacing: ${scale.letterSpacing};`);
  }

  return entries.join("\n");
}

export type HeadingLevel = "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
export type BodyStyle = keyof typeof bodyStyles;
export type UIStyle = keyof typeof uiStyles;
export type CodeStyle = keyof typeof codeStyles;

export default {
  fontFamilies,
  fontWeights,
  typeScale,
  headingStyles,
  bodyStyles,
  uiStyles,
  codeStyles,
  generateTypographyCSS,
};
