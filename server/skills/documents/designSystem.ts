import type { DesignPalette, DesignTokens, DocumentFormat } from "./types";

// ---------------------------------------------------------------------------
// 10 Curated Color Palettes
// ---------------------------------------------------------------------------

export const PALETTES: Record<string, DesignPalette> = {
  "atlas-corporate": {
    id: "atlas-corporate",
    name: "Atlas Corporate",
    primary: "#1e3a5f",
    secondary: "#2d4a7c",
    accent: "#3b82f6",
    background: "#f8fafc",
    text: "#0f172a",
    muted: "#94a3b8",
    border: "#e2e8f0",
    surface: "#ffffff",
  },
  "meridian-executive": {
    id: "meridian-executive",
    name: "Meridian Executive",
    primary: "#1a1a2e",
    secondary: "#16213e",
    accent: "#e94560",
    background: "#f5f5f7",
    text: "#1a1a2e",
    muted: "#9ca3af",
    border: "#d1d5db",
    surface: "#ffffff",
  },
  "ledger-finance": {
    id: "ledger-finance",
    name: "Ledger Finance",
    primary: "#14532d",
    secondary: "#166534",
    accent: "#22c55e",
    background: "#f0fdf4",
    text: "#052e16",
    muted: "#86efac",
    border: "#bbf7d0",
    surface: "#ffffff",
  },
  "academy-serif": {
    id: "academy-serif",
    name: "Academy Serif",
    primary: "#78350f",
    secondary: "#92400e",
    accent: "#d97706",
    background: "#fffbeb",
    text: "#451a03",
    muted: "#d6a06c",
    border: "#fde68a",
    surface: "#fefce8",
  },
  "venture-startup": {
    id: "venture-startup",
    name: "Venture Startup",
    primary: "#7c3aed",
    secondary: "#6d28d9",
    accent: "#06b6d4",
    background: "#faf5ff",
    text: "#2e1065",
    muted: "#c4b5fd",
    border: "#e9d5ff",
    surface: "#ffffff",
  },
  "care-clinical": {
    id: "care-clinical",
    name: "Care Clinical",
    primary: "#0369a1",
    secondary: "#0284c7",
    accent: "#0ea5e9",
    background: "#f0f9ff",
    text: "#082f49",
    muted: "#7dd3fc",
    border: "#bae6fd",
    surface: "#ffffff",
  },
  "counsel-legal": {
    id: "counsel-legal",
    name: "Counsel Legal",
    primary: "#1e293b",
    secondary: "#334155",
    accent: "#64748b",
    background: "#f8fafc",
    text: "#0f172a",
    muted: "#94a3b8",
    border: "#cbd5e1",
    surface: "#ffffff",
  },
  "editorial-light": {
    id: "editorial-light",
    name: "Editorial Light",
    primary: "#18181b",
    secondary: "#27272a",
    accent: "#a855f7",
    background: "#fafafa",
    text: "#09090b",
    muted: "#a1a1aa",
    border: "#e4e4e7",
    surface: "#ffffff",
  },
  "blueprint-tech": {
    id: "blueprint-tech",
    name: "Blueprint Tech",
    primary: "#0c4a6e",
    secondary: "#075985",
    accent: "#38bdf8",
    background: "#f0f9ff",
    text: "#082f49",
    muted: "#7dd3fc",
    border: "#bae6fd",
    surface: "#e0f2fe",
  },
  "graphite-dark": {
    id: "graphite-dark",
    name: "Graphite Dark",
    primary: "#111827",
    secondary: "#1f2937",
    accent: "#f59e0b",
    background: "#f9fafb",
    text: "#111827",
    muted: "#9ca3af",
    border: "#e5e7eb",
    surface: "#ffffff",
  },
};

// ---------------------------------------------------------------------------
// Typography
// ---------------------------------------------------------------------------

export const TYPOGRAPHY = {
  titleSize: [36, 44] as [number, number],
  subtitleSize: [20, 28] as [number, number],
  bodySize: [14, 16] as [number, number],
  captionSize: [9, 11] as [number, number],
  titleFont: "Calibri",
  bodyFont: "Calibri",
};

// ---------------------------------------------------------------------------
// Anti-Patterns (from Claude's PPTX skill — things to avoid)
// ---------------------------------------------------------------------------

export const ANTI_PATTERNS: string[] = [
  "Never use more than 3 fonts in a single document",
  "Avoid pure black (#000000) on pure white (#ffffff) — use off-black on off-white",
  "Do not place text smaller than 8pt — unreadable in print and on screen",
  "Never stretch or distort images to fit; crop or use object-fit instead",
  "Avoid centering large blocks of body text — left-align paragraphs for readability",
  "Do not exceed 5 colors per slide or page; stay within the palette",
  "Never auto-play animations or transitions in business documents",
  "Avoid low-contrast text on busy background images without an overlay",
  "Do not mix metric and imperial units within the same document",
  "Never leave orphan headings at page bottom without at least two body-text lines",
];

// ---------------------------------------------------------------------------
// Excel Color Coding Convention
// ---------------------------------------------------------------------------

export const EXCEL_COLOR_CODING = {
  inputs: "#2563eb",   // blue — user-editable input cells
  formulas: "#1e293b", // black — computed formula cells
  links: "#16a34a",    // green — cells linked from other sheets
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_PALETTE = "atlas-corporate";

const FORMAT_PALETTE_DEFAULTS: Record<string, string> = {
  pptx: "meridian-executive",
  docx: "atlas-corporate",
  xlsx: "graphite-dark",
  pdf: "counsel-legal",
};

export function getPalette(id?: string): DesignPalette {
  if (!id) return PALETTES[DEFAULT_PALETTE];
  return PALETTES[id] ?? PALETTES[DEFAULT_PALETTE];
}

export function getPaletteForFormat(format: DocumentFormat): DesignPalette {
  const paletteId = FORMAT_PALETTE_DEFAULTS[format] ?? DEFAULT_PALETTE;
  return PALETTES[paletteId];
}

export function getDesignTokens(): DesignTokens {
  return {
    palettes: PALETTES,
    typography: TYPOGRAPHY,
    excelColorCoding: EXCEL_COLOR_CODING,
    antiPatterns: ANTI_PATTERNS,
  };
}
