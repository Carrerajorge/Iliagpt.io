export * from "./richTextParser";
export * from "./fontRegistry";
export * from "./universalRenderer";
export * from "./markdownTokenizer";
export * from "./latexMath";

import {
  parseInlineMarkdown,
  parseMarkdownToDocument,
  parseHtmlToDocument,
  detectDocumentType,
} from "./richTextParser";
import {
  defaultFontRegistry,
  resolveFontForStyle,
  getDocxFontOptions,
  getCssFontStyle,
  getCanvasFontString,
} from "./fontRegistry";
import {
  renderRunToDocx,
  renderRunsToDocx,
  renderBlockToDocx,
  renderDocumentToDocx,
  renderDocumentToDocxBuffer,
  renderRunToHtml,
  renderRunsToHtml,
  renderBlockToHtml,
  renderDocumentToHtml,
  RenderOptions,
} from "./universalRenderer";
import { TextRun, TextStyle, RichTextDocument, RichTextBlock } from "@shared/richTextTypes";
import {
  TextRun as DocxTextRun,
  ExternalHyperlink,
  ShadingType,
} from "docx";

export interface FontConfig {
  font: string;
  size: number;
}

export interface ParseRenderOptions {
  extraBold?: boolean;
  defaultColor?: string;
}

export function parseAndRenderToDocx(
  text: string,
  fontConfig: FontConfig,
  options?: ParseRenderOptions | boolean
): (DocxTextRun | ExternalHyperlink)[] {
  const runs = parseInlineMarkdown(text);
  
  const opts: ParseRenderOptions = typeof options === 'boolean' 
    ? { extraBold: options } 
    : (options || {});

  return runs.map((run) => {
    const style: TextStyle = {
      ...run.style,
      bold: run.style?.bold || opts.extraBold,
      fontFamily: fontConfig.font,
      fontSize: fontConfig.size / 2,
      color: run.style?.color || opts.defaultColor,
    };

    const fontOptions = getDocxFontOptions(style, defaultFontRegistry);

    const textRunOptions: ConstructorParameters<typeof DocxTextRun>[0] = {
      text: run.text,
      font: style.code ? defaultFontRegistry.monoFamily : fontConfig.font,
      size: fontConfig.size,
      bold: fontOptions.bold,
      italics: fontOptions.italics,
      underline: style.underline ? {} : undefined,
      strike: style.strikethrough,
      color: style.color?.replace("#", ""),
      shading: style.code
        ? { fill: "F0F0F0", type: ShadingType.CLEAR, color: "auto" }
        : style.backgroundColor
          ? { fill: style.backgroundColor.replace("#", ""), type: ShadingType.CLEAR, color: "auto" }
          : undefined,
    };

    if (style.link) {
      return new ExternalHyperlink({
        children: [
          new DocxTextRun({
            ...textRunOptions,
            color: (style.color || "0066CC").replace("#", ""),
            underline: {},
          }),
        ],
        link: style.link,
      });
    }

    return new DocxTextRun(textRunOptions);
  });
}

export function parseAndRenderToHtml(text: string): string {
  const runs = parseInlineMarkdown(text);
  return renderRunsToHtml(runs);
}

export function hasRichTextMarkers(text: string): boolean {
  if (!text || typeof text !== "string") return false;

  const patterns = [
    /\*\*.+?\*\*/,
    /\*.+?\*/,
    /__.+?__/,
    /_.+?_/,
    /~~.+?~~/,
    /`.+?`/,
    /\[.+?\]\(.+?\)/,
    /<(strong|em|b|i|u|del|code|mark|span|a)[^>]*>/i,
  ];

  return patterns.some((p) => p.test(text));
}

export const RichText = {
  parse: {
    markdown: parseMarkdownToDocument,
    html: parseHtmlToDocument,
    inline: parseInlineMarkdown,
  },

  detect: {
    documentType: detectDocumentType,
    hasRichText: hasRichTextMarkers,
  },

  font: {
    registry: defaultFontRegistry,
    resolve: resolveFontForStyle,
    getDocxOptions: getDocxFontOptions,
    getCssStyle: getCssFontStyle,
    getCanvasFont: getCanvasFontString,
  },

  render: {
    toDocx: {
      run: renderRunToDocx,
      runs: renderRunsToDocx,
      block: renderBlockToDocx,
      document: renderDocumentToDocx,
      buffer: renderDocumentToDocxBuffer,
    },
    toHtml: {
      run: renderRunToHtml,
      runs: renderRunsToHtml,
      block: renderBlockToHtml,
      document: renderDocumentToHtml,
    },
  },

  helpers: {
    parseAndRenderToDocx,
    parseAndRenderToHtml,
  },
};

export default RichText;
