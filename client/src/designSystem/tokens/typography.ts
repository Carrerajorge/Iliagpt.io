// ============================================================
// Design System – Typography Tokens
// ============================================================

// ---------------------------------------------------------------------------
// Font size scale (px values, always rendered as rem in CSS)
// ---------------------------------------------------------------------------

export type FontSizeKey =
  | 'xs' | 'sm' | 'base' | 'lg' | 'xl'
  | '2xl' | '3xl' | '4xl' | '5xl' | '6xl';

export const fontSizePx: Record<FontSizeKey, number> = {
  xs:   12,
  sm:   14,
  base: 16,
  lg:   18,
  xl:   20,
  '2xl': 24,
  '3xl': 30,
  '4xl': 36,
  '5xl': 48,
  '6xl': 60,
};

/** Convert px value to rem string based on 16px root. */
export function pxToRem(px: number): string {
  return `${(px / 16).toFixed(4).replace(/\.?0+$/, '')}rem`;
}

// ---------------------------------------------------------------------------
// TypeScale definition
// ---------------------------------------------------------------------------

export interface TypeScale {
  fontSize: string;       // rem
  lineHeight: string;     // unitless or rem
  letterSpacing: string;  // em
  fontWeight: number;
  fontFamily?: 'sans' | 'mono' | 'display';
}

// ---------------------------------------------------------------------------
// Predefined type scales
// ---------------------------------------------------------------------------

export const typeScales: Record<string, TypeScale> = {
  display: {
    fontSize:      pxToRem(60),
    lineHeight:    '1.1',
    letterSpacing: '-0.02em',
    fontWeight:    800,
    fontFamily:    'display',
  },

  h1: {
    fontSize:      pxToRem(48),
    lineHeight:    '1.15',
    letterSpacing: '-0.015em',
    fontWeight:    700,
    fontFamily:    'display',
  },

  h2: {
    fontSize:      pxToRem(36),
    lineHeight:    '1.2',
    letterSpacing: '-0.01em',
    fontWeight:    700,
    fontFamily:    'display',
  },

  h3: {
    fontSize:      pxToRem(30),
    lineHeight:    '1.25',
    letterSpacing: '-0.005em',
    fontWeight:    600,
    fontFamily:    'sans',
  },

  h4: {
    fontSize:      pxToRem(24),
    lineHeight:    '1.3',
    letterSpacing: '0em',
    fontWeight:    600,
    fontFamily:    'sans',
  },

  h5: {
    fontSize:      pxToRem(20),
    lineHeight:    '1.35',
    letterSpacing: '0em',
    fontWeight:    600,
    fontFamily:    'sans',
  },

  h6: {
    fontSize:      pxToRem(18),
    lineHeight:    '1.4',
    letterSpacing: '0em',
    fontWeight:    600,
    fontFamily:    'sans',
  },

  bodyLarge: {
    fontSize:      pxToRem(18),
    lineHeight:    '1.6',
    letterSpacing: '0.005em',
    fontWeight:    400,
    fontFamily:    'sans',
  },

  body: {
    fontSize:      pxToRem(16),
    lineHeight:    '1.6',
    letterSpacing: '0.005em',
    fontWeight:    400,
    fontFamily:    'sans',
  },

  bodySmall: {
    fontSize:      pxToRem(14),
    lineHeight:    '1.5',
    letterSpacing: '0.01em',
    fontWeight:    400,
    fontFamily:    'sans',
  },

  caption: {
    fontSize:      pxToRem(12),
    lineHeight:    '1.4',
    letterSpacing: '0.02em',
    fontWeight:    400,
    fontFamily:    'sans',
  },

  code: {
    fontSize:      pxToRem(14),
    lineHeight:    '1.5',
    letterSpacing: '0em',
    fontWeight:    400,
    fontFamily:    'mono',
  },

  codeBlock: {
    fontSize:      pxToRem(13),
    lineHeight:    '1.65',
    letterSpacing: '0em',
    fontWeight:    400,
    fontFamily:    'mono',
  },
};

export type TypeScaleName = keyof typeof typeScales;

// ---------------------------------------------------------------------------
// Font families
// ---------------------------------------------------------------------------

export interface FontFamily {
  sans:    string[];
  mono:    string[];
  display: string[];
}

export const fontFamilies: FontFamily = {
  sans: [
    'Inter',
    'ui-sans-serif',
    'system-ui',
    '-apple-system',
    'BlinkMacSystemFont',
    '"Segoe UI"',
    'Roboto',
    '"Helvetica Neue"',
    'Arial',
    '"Noto Sans"',
    'sans-serif',
    '"Apple Color Emoji"',
    '"Segoe UI Emoji"',
    '"Segoe UI Symbol"',
    '"Noto Color Emoji"',
  ],
  mono: [
    '"JetBrains Mono"',
    '"Fira Code"',
    '"Cascadia Code"',
    'ui-monospace',
    'SFMono-Regular',
    'Menlo',
    'Monaco',
    'Consolas',
    '"Liberation Mono"',
    '"Courier New"',
    'monospace',
  ],
  display: [
    '"Cal Sans"',
    'Inter',
    'ui-sans-serif',
    'system-ui',
    '-apple-system',
    'sans-serif',
  ],
};

export function fontFamilyString(family: keyof FontFamily): string {
  return fontFamilies[family].join(', ');
}

// ---------------------------------------------------------------------------
// TypographyToken class
// ---------------------------------------------------------------------------

export class TypographyToken {
  readonly name: string;
  readonly scale: TypeScale;

  constructor(name: string, scale: TypeScale) {
    this.name  = name;
    this.scale = scale;
  }

  /** Returns a Tailwind-compatible class string for this scale. */
  toCSSClass(): string {
    return tailwindClasses[this.name] ?? '';
  }

  /** Returns a React CSSProperties object for inline styling. */
  toCSSProperties(): React.CSSProperties {
    const { fontSize, lineHeight, letterSpacing, fontWeight, fontFamily } = this.scale;
    return {
      fontSize,
      lineHeight,
      letterSpacing,
      fontWeight,
      ...(fontFamily
        ? { fontFamily: fontFamilyString(fontFamily) }
        : {}),
    };
  }
}

// Avoid a full React import – only the type is needed here.
declare namespace React {
  interface CSSProperties {
    [key: string]: string | number | undefined;
  }
}

// ---------------------------------------------------------------------------
// Instantiated tokens
// ---------------------------------------------------------------------------

export const typographyTokens: Record<TypeScaleName, TypographyToken> = Object.fromEntries(
  Object.entries(typeScales).map(([name, scale]) => [name, new TypographyToken(name, scale)]),
) as Record<TypeScaleName, TypographyToken>;

// ---------------------------------------------------------------------------
// Tailwind class map
// ---------------------------------------------------------------------------

export const tailwindClasses: Record<string, string> = {
  display:   'text-6xl font-extrabold tracking-tighter leading-none font-display',
  h1:        'text-5xl font-bold tracking-tight leading-tight font-display',
  h2:        'text-4xl font-bold tracking-tight leading-snug font-display',
  h3:        'text-3xl font-semibold tracking-tight leading-snug',
  h4:        'text-2xl font-semibold leading-snug',
  h5:        'text-xl font-semibold leading-snug',
  h6:        'text-lg font-semibold leading-normal',
  bodyLarge: 'text-lg font-normal leading-relaxed tracking-wide',
  body:      'text-base font-normal leading-relaxed tracking-wide',
  bodySmall: 'text-sm font-normal leading-normal tracking-wide',
  caption:   'text-xs font-normal leading-tight tracking-wider',
  code:      'text-sm font-normal font-mono',
  codeBlock: 'text-[13px] font-normal font-mono leading-relaxed',
};

// ---------------------------------------------------------------------------
// CSS custom-property generator for font settings
// ---------------------------------------------------------------------------

export function getTypographyCSSVars(): string {
  const lines: string[] = [
    `  --font-sans: ${fontFamilyString('sans')};`,
    `  --font-mono: ${fontFamilyString('mono')};`,
    `  --font-display: ${fontFamilyString('display')};`,
  ];

  for (const [name, scale] of Object.entries(typeScales)) {
    lines.push(
      `  --type-${name}-size: ${scale.fontSize};`,
      `  --type-${name}-lh: ${scale.lineHeight};`,
      `  --type-${name}-ls: ${scale.letterSpacing};`,
      `  --type-${name}-weight: ${scale.fontWeight};`,
    );
  }

  return `:root {\n${lines.join('\n')}\n}`;
}
