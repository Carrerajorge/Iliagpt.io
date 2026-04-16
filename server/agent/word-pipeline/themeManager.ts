import { z } from "zod";
import type { SupportedLocale } from "./contracts";
import {
  DocumentType,
  Typography,
  ColorPalette,
  Spacing,
  Margins,
  PageSetup,
  DEFAULT_TYPOGRAPHY,
  DEFAULT_COLOR_PALETTE,
  DEFAULT_SPACING,
  DEFAULT_MARGINS,
  CV_TYPOGRAPHY,
  LETTER_TYPOGRAPHY,
  DOCUMENT_TYPE_DEFAULTS
} from "./documentSpec";

export const ThemeIdSchema = z.enum([
  "default",
  "professional",
  "modern",
  "academic",
  "corporate",
  "minimal",
  "creative"
]);
export type ThemeId = z.infer<typeof ThemeIdSchema>;

export interface ThemeDefinition {
  id: ThemeId;
  name: string;
  description: string;
  typography: Typography;
  colorPalette: ColorPalette;
  spacing: Spacing;
  margins: Margins;
}

export interface StyleToken {
  name: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: "normal" | "bold" | "light";
  fontStyle: "normal" | "italic";
  color?: string;
  backgroundColor?: string;
  marginTop?: number;
  marginBottom?: number;
  lineHeight?: number;
  textAlign?: "left" | "center" | "right" | "justify";
}

export interface OOXMLStyle {
  styleId: string;
  name: string;
  basedOn?: string;
  type: "paragraph" | "character" | "table" | "numbering";
  rPr?: {
    rFonts?: { ascii: string; hAnsi: string; cs?: string };
    sz?: number;
    szCs?: number;
    b?: boolean;
    i?: boolean;
    color?: string;
    highlight?: string;
  };
  pPr?: {
    jc?: "left" | "center" | "right" | "both";
    spacing?: { before?: number; after?: number; line?: number };
    ind?: { left?: number; right?: number; firstLine?: number };
    outlineLvl?: number;
  };
}

const THEMES: Record<ThemeId, ThemeDefinition> = {
  default: {
    id: "default",
    name: "Default",
    description: "Clean, professional default theme",
    typography: DEFAULT_TYPOGRAPHY,
    colorPalette: DEFAULT_COLOR_PALETTE,
    spacing: DEFAULT_SPACING,
    margins: DEFAULT_MARGINS
  },
  professional: {
    id: "professional",
    name: "Professional",
    description: "Business-focused professional styling",
    typography: {
      ...DEFAULT_TYPOGRAPHY,
      heading1: { family: "Cambria", size: 26, weight: "bold", color: "#1F4E79" },
      heading2: { family: "Cambria", size: 18, weight: "bold", color: "#2E75B6" },
      body: { family: "Calibri", size: 11, weight: "normal" }
    },
    colorPalette: {
      ...DEFAULT_COLOR_PALETTE,
      primary: "#1F4E79",
      secondary: "#2E75B6",
      accent: "#5B9BD5"
    },
    spacing: DEFAULT_SPACING,
    margins: DEFAULT_MARGINS
  },
  modern: {
    id: "modern",
    name: "Modern",
    description: "Contemporary minimalist design",
    typography: {
      ...DEFAULT_TYPOGRAPHY,
      heading1: { family: "Segoe UI Light", size: 28, weight: "light" },
      heading2: { family: "Segoe UI", size: 16, weight: "normal" },
      body: { family: "Segoe UI", size: 10, weight: "normal" }
    },
    colorPalette: {
      ...DEFAULT_COLOR_PALETTE,
      primary: "#333333",
      secondary: "#666666",
      accent: "#0078D4",
      tableHeaderBg: "#F0F0F0"
    },
    spacing: { ...DEFAULT_SPACING, paragraphSpacing: 8, lineHeight: 1.4 },
    margins: DEFAULT_MARGINS
  },
  academic: {
    id: "academic",
    name: "Academic",
    description: "Traditional academic paper styling",
    typography: {
      ...DEFAULT_TYPOGRAPHY,
      heading1: { family: "Times New Roman", size: 14, weight: "bold" },
      heading2: { family: "Times New Roman", size: 12, weight: "bold" },
      body: { family: "Times New Roman", size: 12, weight: "normal" }
    },
    colorPalette: {
      ...DEFAULT_COLOR_PALETTE,
      primary: "#000000",
      secondary: "#333333",
      accent: "#000000"
    },
    spacing: { ...DEFAULT_SPACING, lineHeight: 2.0, paragraphSpacing: 0 },
    margins: { ...DEFAULT_MARGINS, left: 3.17, right: 3.17 }
  },
  corporate: {
    id: "corporate",
    name: "Corporate",
    description: "Enterprise business styling",
    typography: {
      ...DEFAULT_TYPOGRAPHY,
      heading1: { family: "Arial", size: 24, weight: "bold", color: "#003366" },
      heading2: { family: "Arial", size: 16, weight: "bold", color: "#003366" },
      body: { family: "Arial", size: 11, weight: "normal" }
    },
    colorPalette: {
      ...DEFAULT_COLOR_PALETTE,
      primary: "#003366",
      secondary: "#0066CC",
      accent: "#FF6600",
      tableHeaderBg: "#003366"
    },
    spacing: DEFAULT_SPACING,
    margins: DEFAULT_MARGINS
  },
  minimal: {
    id: "minimal",
    name: "Minimal",
    description: "Ultra-clean minimal design",
    typography: {
      ...DEFAULT_TYPOGRAPHY,
      heading1: { family: "Helvetica", size: 20, weight: "bold" },
      heading2: { family: "Helvetica", size: 14, weight: "bold" },
      body: { family: "Helvetica", size: 10, weight: "normal" }
    },
    colorPalette: {
      ...DEFAULT_COLOR_PALETTE,
      primary: "#000000",
      secondary: "#666666",
      accent: "#999999",
      tableHeaderBg: "#EEEEEE"
    },
    spacing: { ...DEFAULT_SPACING, paragraphSpacing: 6 },
    margins: { ...DEFAULT_MARGINS, left: 2.0, right: 2.0 }
  },
  creative: {
    id: "creative",
    name: "Creative",
    description: "Bold creative styling",
    typography: {
      ...DEFAULT_TYPOGRAPHY,
      heading1: { family: "Georgia", size: 28, weight: "bold", color: "#8B4513" },
      heading2: { family: "Georgia", size: 18, weight: "bold", color: "#A0522D" },
      body: { family: "Palatino Linotype", size: 11, weight: "normal" }
    },
    colorPalette: {
      ...DEFAULT_COLOR_PALETTE,
      primary: "#8B4513",
      secondary: "#A0522D",
      accent: "#CD853F",
      tableHeaderBg: "#8B4513"
    },
    spacing: DEFAULT_SPACING,
    margins: DEFAULT_MARGINS
  }
};

export class ThemeManager {
  private currentTheme: ThemeDefinition;
  private documentType: DocumentType;
  private locale: SupportedLocale;

  constructor(
    themeId: ThemeId = "default",
    documentType: DocumentType = "REPORT",
    locale: SupportedLocale = "en"
  ) {
    this.currentTheme = THEMES[themeId];
    this.documentType = documentType;
    this.locale = locale;
  }

  getTheme(): ThemeDefinition {
    return this.currentTheme;
  }

  setTheme(themeId: ThemeId): void {
    this.currentTheme = THEMES[themeId];
  }

  getTypography(): Typography {
    const docDefaults = DOCUMENT_TYPE_DEFAULTS[this.documentType];
    return {
      ...this.currentTheme.typography,
      ...docDefaults.typography
    };
  }

  getColorPalette(): ColorPalette {
    return this.currentTheme.colorPalette;
  }

  getSpacing(): Spacing {
    const docDefaults = DOCUMENT_TYPE_DEFAULTS[this.documentType];
    return {
      ...this.currentTheme.spacing,
      ...docDefaults.spacing
    };
  }

  getMargins(): Margins {
    const docDefaults = DOCUMENT_TYPE_DEFAULTS[this.documentType];
    const pageSetup = docDefaults.page_setup;
    return pageSetup.margins || this.currentTheme.margins;
  }

  getPageSetup(): PageSetup {
    const docDefaults = DOCUMENT_TYPE_DEFAULTS[this.documentType];
    return {
      size: docDefaults.page_setup.size || "A4",
      orientation: docDefaults.page_setup.orientation || "portrait",
      margins: this.getMargins(),
      columns: docDefaults.page_setup.columns || 1,
      columnSpacing: 1.27
    };
  }

  getStyleToken(tokenName: keyof Typography): StyleToken {
    const typography = this.getTypography();
    const font = typography[tokenName];
    const spacing = this.getSpacing();

    return {
      name: tokenName,
      fontFamily: font.family,
      fontSize: font.size,
      fontWeight: font.weight || "normal",
      fontStyle: font.style || "normal",
      color: font.color,
      marginTop: tokenName.startsWith("heading") ? spacing.beforeHeading : undefined,
      marginBottom: tokenName.startsWith("heading") ? spacing.afterHeading : spacing.paragraphSpacing,
      lineHeight: spacing.lineHeight
    };
  }

  toOOXMLStyle(tokenName: keyof Typography): OOXMLStyle {
    const token = this.getStyleToken(tokenName);
    const isHeading = tokenName.startsWith("heading");
    const headingLevel = isHeading ? parseInt(tokenName.replace("heading", "")) : undefined;

    const styleId = tokenName === "body" ? "Normal" : this.capitalizeFirst(tokenName);

    return {
      styleId,
      name: this.formatStyleName(tokenName),
      type: "paragraph",
      basedOn: tokenName === "body" ? undefined : "Normal",
      rPr: {
        rFonts: { ascii: token.fontFamily, hAnsi: token.fontFamily },
        sz: token.fontSize * 2,
        szCs: token.fontSize * 2,
        b: token.fontWeight === "bold",
        i: token.fontStyle === "italic",
        color: token.color?.replace("#", "")
      },
      pPr: {
        spacing: {
          before: token.marginTop ? token.marginTop * 20 : undefined,
          after: token.marginBottom ? token.marginBottom * 20 : undefined,
          line: token.lineHeight ? Math.round(token.lineHeight * 240) : undefined
        },
        outlineLvl: headingLevel ? headingLevel - 1 : undefined
      }
    };
  }

  getAllOOXMLStyles(): OOXMLStyle[] {
    const styleNames: (keyof Typography)[] = [
      "heading1", "heading2", "heading3", "heading4",
      "body", "caption", "quote", "code",
      "tableHeader", "tableBody", "footnote", "toc",
      "header", "footer"
    ];

    return styleNames.map(name => this.toOOXMLStyle(name));
  }

  getTableStyle(): {
    headerBg: string;
    altRowBg: string;
    borderColor: string;
    headerFont: StyleToken;
    bodyFont: StyleToken;
  } {
    const palette = this.getColorPalette();
    return {
      headerBg: palette.tableHeaderBg,
      altRowBg: palette.tableRowAltBg,
      borderColor: palette.border,
      headerFont: this.getStyleToken("tableHeader"),
      bodyFont: this.getStyleToken("tableBody")
    };
  }

  private capitalizeFirst(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  private formatStyleName(tokenName: string): string {
    return tokenName
      .replace(/([A-Z])/g, " $1")
      .replace(/^./, s => s.toUpperCase())
      .trim();
  }
}

export function getAvailableThemes(): { id: ThemeId; name: string; description: string }[] {
  return Object.values(THEMES).map(t => ({
    id: t.id,
    name: t.name,
    description: t.description
  }));
}

export function getThemeById(themeId: ThemeId): ThemeDefinition | undefined {
  return THEMES[themeId];
}

export function createThemeManager(
  themeId: ThemeId = "default",
  documentType: DocumentType = "REPORT",
  locale: SupportedLocale = "en"
): ThemeManager {
  return new ThemeManager(themeId, documentType, locale);
}
