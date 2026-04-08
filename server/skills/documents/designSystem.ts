import type { DesignPalette, TypographyRules } from "./types";

// ---------------------------------------------------------------------------
// 10 Curated Color Palettes
// ---------------------------------------------------------------------------

export const PALETTES: Record<string, DesignPalette> = {
  "midnight-executive": {
    name: "Midnight Executive",
    primary: "#1a1a2e",
    secondary: "#16213e",
    accent: "#e94560",
    background: "#0f3460",
    text: "#ffffff",
    muted: "#a0aec0",
    border: "#2d3748",
    surface: "#1a202c",
  },
  "forest-moss": {
    name: "Forest & Moss",
    primary: "#2d6a4f",
    secondary: "#40916c",
    accent: "#52b788",
    background: "#d8f3dc",
    text: "#1b4332",
    muted: "#74c69d",
    border: "#b7e4c7",
    surface: "#f0fdf4",
  },
  "slate-professional": {
    name: "Slate Professional",
    primary: "#334155",
    secondary: "#475569",
    accent: "#3b82f6",
    background: "#f8fafc",
    text: "#0f172a",
    muted: "#94a3b8",
    border: "#e2e8f0",
    surface: "#ffffff",
  },
  "warm-terracotta": {
    name: "Warm Terracotta",
    primary: "#9c4221",
    secondary: "#c2410c",
    accent: "#ea580c",
    background: "#fffbeb",
    text: "#431407",
    muted: "#d6a06c",
    border: "#fed7aa",
    surface: "#fff7ed",
  },
  "ocean-breeze": {
    name: "Ocean Breeze",
    primary: "#0c4a6e",
    secondary: "#0369a1",
    accent: "#06b6d4",
    background: "#f0f9ff",
    text: "#082f49",
    muted: "#7dd3fc",
    border: "#bae6fd",
    surface: "#e0f2fe",
  },
  "royal-purple": {
    name: "Royal Purple",
    primary: "#581c87",
    secondary: "#7c3aed",
    accent: "#a78bfa",
    background: "#faf5ff",
    text: "#3b0764",
    muted: "#c4b5fd",
    border: "#e9d5ff",
    surface: "#f5f3ff",
  },
  "coral-sunset": {
    name: "Coral Sunset",
    primary: "#be123c",
    secondary: "#e11d48",
    accent: "#fb7185",
    background: "#fff1f2",
    text: "#4c0519",
    muted: "#fda4af",
    border: "#fecdd3",
    surface: "#ffe4e6",
  },
  "nordic-frost": {
    name: "Nordic Frost",
    primary: "#1e3a5f",
    secondary: "#3b6998",
    accent: "#88c0d0",
    background: "#eceff4",
    text: "#2e3440",
    muted: "#81a1c1",
    border: "#d8dee9",
    surface: "#e5e9f0",
  },
  "emerald-gold": {
    name: "Emerald & Gold",
    primary: "#065f46",
    secondary: "#047857",
    accent: "#d97706",
    background: "#f0fdf4",
    text: "#064e3b",
    muted: "#6ee7b7",
    border: "#a7f3d0",
    surface: "#ecfdf5",
  },
  "charcoal-amber": {
    name: "Charcoal & Amber",
    primary: "#292524",
    secondary: "#44403c",
    accent: "#f59e0b",
    background: "#fafaf9",
    text: "#1c1917",
    muted: "#a8a29e",
    border: "#e7e5e4",
    surface: "#f5f5f4",
  },
};

// ---------------------------------------------------------------------------
// Typography
// ---------------------------------------------------------------------------

export const TYPOGRAPHY: TypographyRules = {
  titleSize: [28, 44],
  subtitleSize: [18, 28],
  bodySize: [10, 14],
  captionSize: [8, 10],
  titleFont: "Calibri",
  bodyFont: "Calibri",
};

// ---------------------------------------------------------------------------
// Anti-Patterns (things to avoid in generated documents)
// ---------------------------------------------------------------------------

export const ANTI_PATTERNS: string[] = [
  "Never use more than 3 fonts in a single document",
  "Avoid pure black (#000000) on pure white (#ffffff) — use off-black on off-white for readability",
  "Do not place text smaller than 8pt — it becomes unreadable in print and on screen",
  "Never stretch or distort images to fit a container; crop or use object-fit instead",
  "Avoid centering large blocks of body text — left-align paragraphs for readability",
  "Do not use more than 5 colors per slide or page; stick to the palette",
  "Never auto-play animations or transitions in business documents",
  "Avoid low-contrast text on busy background images without an overlay",
  "Do not mix metric units (cm, mm) with imperial (in) within the same document",
  "Never leave orphan headings at the bottom of a page without at least two lines of body text",
];

// ---------------------------------------------------------------------------
// Excel Color Coding Convention
// ---------------------------------------------------------------------------

export const EXCEL_COLOR_CODING = {
  inputs: "#2563eb", // blue — user-editable input cells
  formulas: "#1e293b", // dark slate — computed formula cells
  links: "#16a34a", // green — cells linked from other sheets
};

// Helpers

const DEFAULT_PALETTE = "slate-professional";

export function getPalette(name?: string): DesignPalette {
  if (!name) return PALETTES[DEFAULT_PALETTE];
  return PALETTES[name] ?? PALETTES[DEFAULT_PALETTE];
}

const FORMAT_PALETTE_DEFAULTS: Record<string, string> = {
  pptx: "midnight-executive",
  docx: "slate-professional",
  xlsx: "charcoal-amber",
  pdf: "nordic-frost",
};

export function getPaletteForFormat(format: string): DesignPalette {
  const paletteName = FORMAT_PALETTE_DEFAULTS[format] ?? DEFAULT_PALETTE;
  return PALETTES[paletteName];
}
