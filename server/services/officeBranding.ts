export interface OfficeBrandTheme {
  id: string;
  label: string;
  wordTheme: string;
  excelTheme: string;
  pptTheme: "corporate" | "modern" | "gradient" | "academic" | "minimal";
  colors: {
    primary: string;
    secondary: string;
    accent: string;
    surface: string;
    text: string;
    muted: string;
  };
  fonts: {
    heading: string;
    body: string;
  };
}

export interface OfficeBrandingResolved {
  theme: OfficeBrandTheme;
  brandName?: string;
  logoText?: string;
  logoUrl?: string;
  customColors?: Partial<OfficeBrandTheme["colors"]>;
}

export interface OfficeBrandingVisualSpec {
  id: string;
  label: string;
  brandName?: string;
  logoText?: string;
  logoUrl?: string;
  wordTheme: string;
  excelTheme: string;
  pptTheme: OfficeBrandTheme["pptTheme"];
  colors: OfficeBrandTheme["colors"];
  fonts: OfficeBrandTheme["fonts"];
}

export const OFFICE_BRAND_THEMES: Record<string, OfficeBrandTheme> = {
  executive: {
    id: "executive",
    label: "Executive Premium",
    wordTheme: "corporate",
    excelTheme: "professional",
    pptTheme: "corporate",
    colors: { primary: "1A365D", secondary: "2C5282", accent: "3182CE", surface: "F8FAFC", text: "1A202C", muted: "718096" },
    fonts: { heading: "Aptos Display", body: "Aptos" },
  },
  corporate: {
    id: "corporate",
    label: "Corporate Boardroom",
    wordTheme: "corporate",
    excelTheme: "professional",
    pptTheme: "corporate",
    colors: { primary: "0F4C81", secondary: "1D3557", accent: "F4A261", surface: "F8FAFC", text: "1F2937", muted: "6B7280" },
    fonts: { heading: "Aptos Display", body: "Calibri" },
  },
  academic: {
    id: "academic",
    label: "Academic Research",
    wordTheme: "academic",
    excelTheme: "modern",
    pptTheme: "academic",
    colors: { primary: "2D3748", secondary: "4A5568", accent: "805AD5", surface: "FFFFFF", text: "1A202C", muted: "718096" },
    fonts: { heading: "Times New Roman", body: "Times New Roman" },
  },
  modern: {
    id: "modern",
    label: "Modern Clean",
    wordTheme: "modern",
    excelTheme: "modern",
    pptTheme: "modern",
    colors: { primary: "111827", secondary: "374151", accent: "14B8A6", surface: "FFFFFF", text: "111827", muted: "6B7280" },
    fonts: { heading: "Inter", body: "Inter" },
  },
  luxury: {
    id: "luxury",
    label: "Luxury Signature",
    wordTheme: "elegant",
    excelTheme: "vibrant",
    pptTheme: "gradient",
    colors: { primary: "2C1A4D", secondary: "4C2882", accent: "D4AF37", surface: "FFFDF7", text: "231F20", muted: "8C7A5B" },
    fonts: { heading: "Georgia", body: "Georgia" },
  },
  minimal: {
    id: "minimal",
    label: "Minimal Neutral",
    wordTheme: "minimal",
    excelTheme: "minimal",
    pptTheme: "minimal",
    colors: { primary: "111111", secondary: "444444", accent: "888888", surface: "FFFFFF", text: "111111", muted: "777777" },
    fonts: { heading: "Helvetica", body: "Helvetica" },
  },
};

function normalizeKey(value?: string | null): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9#,:()\-._/ ]+/g, " ")
    .trim();
}

function extractNamedValue(input: string, keys: string[]): string | undefined {
  for (const key of keys) {
    const match = input.match(new RegExp(`${key}(?:\\s*[:=-]|\\s+)([^,;\\n]{2,120})`, "i"));
    if (match?.[1]) return match[1].trim();
  }
  return undefined;
}

function extractHex(input: string, keys: string[]): string | undefined {
  for (const key of keys) {
    const match = input.match(new RegExp(`${key}(?:\\s*[:=-]|\\s+)(#?[0-9a-fA-F]{6})`, "i"));
    if (match?.[1]) return match[1].replace(/^#/, "").toUpperCase();
  }
  return undefined;
}

export function resolveOfficeBrandTheme(input?: {
  template?: string;
  theme?: string;
  brand?: string;
}): OfficeBrandingResolved {
  const candidates = [input?.template, input?.theme, input?.brand]
    .map(normalizeKey)
    .filter(Boolean);

  let theme = OFFICE_BRAND_THEMES.executive;
  for (const candidate of candidates) {
    if (candidate.includes("luxury") || candidate.includes("premium") || candidate.includes("gold")) { theme = OFFICE_BRAND_THEMES.luxury; break; }
    if (candidate.includes("academic") || candidate.includes("research") || candidate.includes("tesis")) { theme = OFFICE_BRAND_THEMES.academic; break; }
    if (candidate.includes("modern") || candidate.includes("clean")) { theme = OFFICE_BRAND_THEMES.modern; break; }
    if (candidate.includes("minimal")) { theme = OFFICE_BRAND_THEMES.minimal; break; }
    if (candidate.includes("corporate") || candidate.includes("board") || candidate.includes("empresa")) { theme = OFFICE_BRAND_THEMES.corporate; break; }
    if (candidate.includes("executive") || candidate.includes("director") || candidate.includes("ejecut")) { theme = OFFICE_BRAND_THEMES.executive; break; }
  }

  const raw = [input?.brand, input?.theme, input?.template].filter(Boolean).join(" | ");
  const brandName = extractNamedValue(raw, ["brand", "marca", "empresa", "company"]);
  const logoText = extractNamedValue(raw, ["logo", "logoText", "logotipo"]);
  const logoUrl = extractNamedValue(raw, ["logoUrl", "logo_url", "logo url"]);
  const customColors = {
    primary: extractHex(raw, ["primary", "primario", "color principal"]),
    secondary: extractHex(raw, ["secondary", "secundario"]),
    accent: extractHex(raw, ["accent", "acento"]),
  };

  return {
    theme,
    brandName,
    logoText: logoText || brandName,
    logoUrl,
    customColors: Object.fromEntries(Object.entries(customColors).filter(([, value]) => Boolean(value))),
  };
}

export function buildOfficeBrandingVisualSpec(resolved: OfficeBrandingResolved): OfficeBrandingVisualSpec {
  return {
    id: resolved.theme.id,
    label: resolved.theme.label,
    brandName: resolved.brandName,
    logoText: resolved.logoText || resolved.brandName,
    logoUrl: resolved.logoUrl,
    wordTheme: resolved.theme.wordTheme,
    excelTheme: resolved.theme.excelTheme,
    pptTheme: resolved.theme.pptTheme,
    colors: {
      ...resolved.theme.colors,
      ...(resolved.customColors || {}),
    },
    fonts: resolved.theme.fonts,
  };
}
