import { FontFamily, FontRegistry, FontVariant, TextStyle, getFontVariantKey } from "@shared/richTextTypes";

export const defaultFontRegistry: FontRegistry = {
  families: {
    "Calibri": {
      name: "Calibri",
      variants: {
        regular: "Calibri",
        bold: "Calibri Bold",
        italic: "Calibri Italic",
        boldItalic: "Calibri Bold Italic",
      },
      fallback: ["Arial", "Helvetica", "sans-serif"],
    },
    "Arial": {
      name: "Arial",
      variants: {
        regular: "Arial",
        bold: "Arial Bold",
        italic: "Arial Italic",
        boldItalic: "Arial Bold Italic",
      },
      fallback: ["Helvetica", "sans-serif"],
    },
    "Times New Roman": {
      name: "Times New Roman",
      variants: {
        regular: "Times New Roman",
        bold: "Times New Roman Bold",
        italic: "Times New Roman Italic",
        boldItalic: "Times New Roman Bold Italic",
      },
      fallback: ["Times", "Georgia", "serif"],
    },
    "Georgia": {
      name: "Georgia",
      variants: {
        regular: "Georgia",
        bold: "Georgia Bold",
        italic: "Georgia Italic",
        boldItalic: "Georgia Bold Italic",
      },
      fallback: ["Times New Roman", "serif"],
    },
    "Helvetica": {
      name: "Helvetica",
      variants: {
        regular: "Helvetica",
        bold: "Helvetica Bold",
        italic: "Helvetica Oblique",
        boldItalic: "Helvetica Bold Oblique",
      },
      fallback: ["Arial", "sans-serif"],
    },
    "Inter": {
      name: "Inter",
      variants: {
        regular: "Inter",
        bold: "Inter Bold",
        italic: "Inter Italic",
        boldItalic: "Inter Bold Italic",
      },
      fallback: ["Helvetica", "Arial", "sans-serif"],
    },
    "Roboto": {
      name: "Roboto",
      variants: {
        regular: "Roboto",
        bold: "Roboto Bold",
        italic: "Roboto Italic",
        boldItalic: "Roboto Bold Italic",
      },
      fallback: ["Helvetica", "Arial", "sans-serif"],
    },
    "Open Sans": {
      name: "Open Sans",
      variants: {
        regular: "Open Sans",
        bold: "Open Sans Bold",
        italic: "Open Sans Italic",
        boldItalic: "Open Sans Bold Italic",
      },
      fallback: ["Helvetica", "Arial", "sans-serif"],
    },
    "Courier New": {
      name: "Courier New",
      variants: {
        regular: "Courier New",
        bold: "Courier New Bold",
        italic: "Courier New Italic",
        boldItalic: "Courier New Bold Italic",
      },
      fallback: ["Courier", "monospace"],
    },
    "Consolas": {
      name: "Consolas",
      variants: {
        regular: "Consolas",
        bold: "Consolas Bold",
        italic: "Consolas Italic",
        boldItalic: "Consolas Bold Italic",
      },
      fallback: ["Courier New", "monospace"],
    },
  },
  defaultFamily: "Calibri",
  monoFamily: "Courier New",
};

const missingVariantWarnings = new Set<string>();

export function resolveFontForStyle(
  style: TextStyle,
  registry: FontRegistry = defaultFontRegistry
): { fontName: string; usedFallback: boolean } {
  const requestedFamily = style.fontFamily || registry.defaultFamily;
  const isCode = style.code;

  const familyName = isCode ? registry.monoFamily : requestedFamily;
  const family = registry.families[familyName];

  if (!family) {
    const warningKey = `family:${familyName}`;
    if (!missingVariantWarnings.has(warningKey)) {
      missingVariantWarnings.add(warningKey);
      console.warn(`[FontRegistry] Font family "${familyName}" not found, using default`);
    }
    return { fontName: registry.defaultFamily, usedFallback: true };
  }

  const variantKey = getFontVariantKey(style);
  const variantFont = family.variants[variantKey];

  if (variantFont) {
    return { fontName: variantFont, usedFallback: false };
  }

  const warningKey = `variant:${familyName}:${variantKey}`;
  if (!missingVariantWarnings.has(warningKey)) {
    missingVariantWarnings.add(warningKey);
    console.warn(
      `[FontRegistry] Font variant "${variantKey}" not found for "${familyName}", using fallback`
    );
  }

  if (variantKey === "boldItalic") {
    if (family.variants.bold) return { fontName: family.variants.bold, usedFallback: true };
    if (family.variants.italic) return { fontName: family.variants.italic, usedFallback: true };
  } else if (variantKey === "bold" || variantKey === "italic") {
    if (family.variants.regular) return { fontName: family.variants.regular, usedFallback: true };
  }

  return {
    fontName: family.variants.regular || family.name,
    usedFallback: true,
  };
}

export function getFontFamilyWithFallback(
  fontName: string,
  registry: FontRegistry = defaultFontRegistry
): string {
  const family = registry.families[fontName];
  if (family) {
    return [fontName, ...family.fallback].join(", ");
  }
  return fontName;
}

export interface DocxFontOptions {
  font: string;
  bold?: boolean;
  italics?: boolean;
}

export function getDocxFontOptions(
  style: TextStyle,
  registry: FontRegistry = defaultFontRegistry
): DocxFontOptions {
  const baseFamily = style.code ? registry.monoFamily : (style.fontFamily || registry.defaultFamily);

  return {
    font: baseFamily,
    bold: style.bold || false,
    italics: style.italic || false,
  };
}

export function getCssFontStyle(
  style: TextStyle,
  registry: FontRegistry = defaultFontRegistry
): Record<string, string> {
  const cssStyle: Record<string, string> = {};

  const familyName = style.code
    ? registry.monoFamily
    : style.fontFamily || registry.defaultFamily;

  cssStyle.fontFamily = getFontFamilyWithFallback(familyName, registry);

  if (style.bold) cssStyle.fontWeight = "bold";
  if (style.italic) cssStyle.fontStyle = "italic";
  if (style.underline) cssStyle.textDecoration = "underline";
  if (style.strikethrough) {
    cssStyle.textDecoration = cssStyle.textDecoration
      ? `${cssStyle.textDecoration} line-through`
      : "line-through";
  }
  if (style.color) cssStyle.color = style.color;
  if (style.backgroundColor) cssStyle.backgroundColor = style.backgroundColor;
  if (style.fontSize) cssStyle.fontSize = `${style.fontSize}pt`;

  return cssStyle;
}

export function getCanvasFontString(
  style: TextStyle,
  baseFontSize: number = 12,
  registry: FontRegistry = defaultFontRegistry
): string {
  const fontSize = style.fontSize || baseFontSize;
  const familyName = style.code
    ? registry.monoFamily
    : style.fontFamily || registry.defaultFamily;

  const parts: string[] = [];

  if (style.italic) parts.push("italic");
  if (style.bold) parts.push("bold");

  parts.push(`${fontSize}px`);
  parts.push(`"${familyName}"`);

  return parts.join(" ");
}

export function registerFont(
  family: FontFamily,
  registry: FontRegistry = defaultFontRegistry
): void {
  registry.families[family.name] = family;
}

export function clearWarnings(): void {
  missingVariantWarnings.clear();
}
