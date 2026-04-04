// ============================================================
// Design System – Spacing Tokens
// ============================================================

// ---------------------------------------------------------------------------
// Base unit: 4px
// ---------------------------------------------------------------------------

const BASE_PX = 4;

/** Convert px to rem (assumes 16px root). */
export function toRem(px: number): string {
  const val = px / 16;
  // Keep up to 4 sig figs, strip trailing zeros
  return `${parseFloat(val.toFixed(4))}rem`;
}

/** Convert px to Tailwind spacing unit (multiples of 4px = integer; others get [x] literal) */
export function pxToTailwindUnit(px: number): string {
  if (px === 0) return '0';
  const units = px / BASE_PX;
  return Number.isInteger(units) ? String(units) : `[${px}px]`;
}

// ---------------------------------------------------------------------------
// Numeric spacing scale (key = token name, value = px)
// ---------------------------------------------------------------------------

export const spacingPx = {
  0:  0,
  1:  4,
  2:  8,
  3:  12,
  4:  16,
  5:  20,
  6:  24,
  8:  32,
  10: 40,
  12: 48,
  16: 64,
  20: 80,
  24: 96,
} as const;

export type SpacingKey = keyof typeof spacingPx;

/** Rem values for every spacing token. */
export const spacingRem: Record<SpacingKey, string> = Object.fromEntries(
  (Object.entries(spacingPx) as [string, number][]).map(([k, v]) => [k, toRem(v)]),
) as Record<SpacingKey, string>;

// ---------------------------------------------------------------------------
// Semantic spacing tokens
// ---------------------------------------------------------------------------

export interface SemanticSpacing {
  xs:  string;  // 4px
  sm:  string;  // 8px
  md:  string;  // 16px
  lg:  string;  // 24px
  xl:  string;  // 32px
  '2xl': string; // 48px
  '3xl': string; // 64px
}

export const semanticSpacing: SemanticSpacing = {
  xs:   toRem(spacingPx[1]),   // 4px
  sm:   toRem(spacingPx[2]),   // 8px
  md:   toRem(spacingPx[4]),   // 16px
  lg:   toRem(spacingPx[6]),   // 24px
  xl:   toRem(spacingPx[8]),   // 32px
  '2xl': toRem(spacingPx[12]), // 48px
  '3xl': toRem(spacingPx[16]), // 64px
};

export type SemanticSpacingKey = keyof SemanticSpacing;

// ---------------------------------------------------------------------------
// Layout tokens
// ---------------------------------------------------------------------------

export interface LayoutTokens {
  containerMaxWidth: string; // 1280px
  contentMaxWidth:   string; // 768px
  sidebarWidth:      string; // 280px
  sidebarWidthCollapsed: string; // 64px
  headerHeight:      string; // 64px
  footerHeight:      string; // 56px
  panelMinWidth:     string; // 320px
  panelMaxWidth:     string; // 480px
}

export const layoutTokens: LayoutTokens = {
  containerMaxWidth:     toRem(1280),
  contentMaxWidth:       toRem(768),
  sidebarWidth:          toRem(280),
  sidebarWidthCollapsed: toRem(64),
  headerHeight:          toRem(64),
  footerHeight:          toRem(56),
  panelMinWidth:         toRem(320),
  panelMaxWidth:         toRem(480),
};

// ---------------------------------------------------------------------------
// Breakpoints
// ---------------------------------------------------------------------------

export const breakpoints = {
  sm:  640,
  md:  768,
  lg:  1024,
  xl:  1280,
  '2xl': 1536,
} as const;

export type BreakpointKey = keyof typeof breakpoints;

export const breakpointPx: Record<BreakpointKey, string> = Object.fromEntries(
  (Object.entries(breakpoints) as [BreakpointKey, number][]).map(([k, v]) => [k, `${v}px`]),
) as Record<BreakpointKey, string>;

export const breakpointRem: Record<BreakpointKey, string> = Object.fromEntries(
  (Object.entries(breakpoints) as [BreakpointKey, number][]).map(([k, v]) => [k, toRem(v)]),
) as Record<BreakpointKey, string>;

/** Media query string for a given breakpoint. */
export function mediaQuery(bp: BreakpointKey): string {
  return `@media (min-width: ${breakpointPx[bp]})`;
}

// ---------------------------------------------------------------------------
// Tailwind class helpers
// ---------------------------------------------------------------------------

type SpacingProp =
  | 'p' | 'px' | 'py' | 'pt' | 'pr' | 'pb' | 'pl'
  | 'm' | 'mx' | 'my' | 'mt' | 'mr' | 'mb' | 'ml'
  | 'gap' | 'gap-x' | 'gap-y' | 'space-x' | 'space-y'
  | 'w' | 'h' | 'min-w' | 'min-h' | 'max-w' | 'max-h';

/**
 * Returns a Tailwind utility class for a spacing key.
 * @example spacingToTailwind(4, 'p') // 'p-4'
 * @example spacingToTailwind(1, 'mt') // 'mt-1'
 */
export function spacingToTailwind(key: SpacingKey, prop: SpacingProp = 'p'): string {
  return `${prop}-${key}`;
}

/**
 * Returns a Tailwind utility class for a semantic spacing key.
 * Semantic values that don't map cleanly to Tailwind units get an
 * arbitrary-value class.
 */
export function semanticToTailwind(
  key: SemanticSpacingKey,
  prop: SpacingProp = 'p',
): string {
  const semanticToNumericKey: Record<SemanticSpacingKey, SpacingKey> = {
    xs:   1,
    sm:   2,
    md:   4,
    lg:   6,
    xl:   8,
    '2xl': 12,
    '3xl': 16,
  };
  const numKey = semanticToNumericKey[key];
  return `${prop}-${numKey}`;
}

// ---------------------------------------------------------------------------
// CSS custom-property generator
// ---------------------------------------------------------------------------

export function getSpacingCSSVars(): string {
  const lines: string[] = [];

  // Numeric scale
  for (const [k, v] of Object.entries(spacingPx)) {
    lines.push(`  --spacing-${k}: ${toRem(v as number)};`);
  }

  // Semantic
  for (const [k, v] of Object.entries(semanticSpacing)) {
    lines.push(`  --space-${k}: ${v};`);
  }

  // Layout
  for (const [k, v] of Object.entries(layoutTokens)) {
    const kebab = k.replace(/([A-Z])/g, (m) => `-${m.toLowerCase()}`);
    lines.push(`  --layout-${kebab}: ${v};`);
  }

  // Breakpoints
  for (const [k, v] of Object.entries(breakpointPx)) {
    lines.push(`  --bp-${k}: ${v};`);
  }

  return `:root {\n${lines.join('\n')}\n}`;
}

// ---------------------------------------------------------------------------
// Utility: clamp spacing
// ---------------------------------------------------------------------------

/**
 * Returns a CSS clamp() value for fluid spacing.
 * @param minPx  Minimum size at smallest viewport
 * @param maxPx  Maximum size at largest viewport
 * @param minVw  Viewport width where minimum kicks in (default 320)
 * @param maxVw  Viewport width where maximum kicks in (default 1280)
 */
export function fluidSpacing(
  minPx: number,
  maxPx: number,
  minVw = 320,
  maxVw = 1280,
): string {
  const slope = (maxPx - minPx) / (maxVw - minVw);
  const intercept = minPx - slope * minVw;
  const vw = (slope * 100).toFixed(4);
  const rem = (intercept / 16).toFixed(4);
  return `clamp(${toRem(minPx)}, ${vw}vw + ${rem}rem, ${toRem(maxPx)})`;
}
