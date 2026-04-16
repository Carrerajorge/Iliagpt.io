import {
  RichTextDocument,
  RichTextBlock,
  TextRun,
  TextStyle,
  HeadingBlock,
  ParagraphBlock,
  BulletListBlock,
  OrderedListBlock,
  BlockquoteBlock,
  CodeBlock,
  TableBlock,
  ListItem,
} from "@shared/richTextTypes";
import {
  defaultFontRegistry,
  FontRegistry,
  getDocxFontOptions,
  getCssFontStyle,
} from "./fontRegistry";
import {
  Document,
  Packer,
  Paragraph,
  TextRun as DocxTextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  AlignmentType,
  ExternalHyperlink,
  convertInchesToTwip,
  IParagraphOptions,
  ITableCellOptions,
  PageBreak,
  TabStopPosition,
  TabStopType,
  ShadingType,
  ImageRun,
} from "docx";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

export interface RenderOptions {
  fontRegistry?: FontRegistry;
  defaultFontSize?: number;
  defaultFontFamily?: string;
  lineHeight?: number;
  headingSizes?: Record<number, number>;
  colors?: {
    primary?: string;
    secondary?: string;
    text?: string;
    lightText?: string;
    link?: string;
  };
}

const DEFAULT_OPTIONS: Required<RenderOptions> = {
  fontRegistry: defaultFontRegistry,
  defaultFontSize: 11,
  defaultFontFamily: "Calibri",
  lineHeight: 276,
  headingSizes: {
    1: 28,
    2: 24,
    3: 20,
    4: 16,
    5: 14,
    6: 12,
  },
  colors: {
    primary: "#1f2937",
    secondary: "#4b5563",
    text: "#1f2937",
    lightText: "#6b7280",
    link: "#0066cc",
  },
};

type DocxParagraphChild = DocxTextRun | ExternalHyperlink;

export function renderRunToDocx(
  run: TextRun,
  options: RenderOptions = {}
): DocxParagraphChild {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const style = run.style || {};

  const fontOptions = getDocxFontOptions(style, opts.fontRegistry);
  const fontSize = (style.fontSize || opts.defaultFontSize) * 2;

  const textRunOptions: ConstructorParameters<typeof DocxTextRun>[0] = {
    text: run.text,
    font: style.fontFamily || fontOptions.font,
    size: fontSize,
    bold: fontOptions.bold,
    italics: fontOptions.italics,
    underline: style.underline ? {} : undefined,
    strike: style.strikethrough,
    color: style.color?.replace("#", ""),
    shading: style.backgroundColor
      ? { fill: style.backgroundColor.replace("#", ""), type: ShadingType.CLEAR, color: "auto" }
      : undefined,
    superScript: style.superscript,
    subScript: style.subscript,
  };

  if (style.code) {
    textRunOptions.font = opts.fontRegistry?.monoFamily || "Courier New";
    textRunOptions.shading = { fill: "F0F0F0", type: ShadingType.CLEAR, color: "auto" };
  }

  if (style.link) {
    return new ExternalHyperlink({
      children: [
        new DocxTextRun({
          ...textRunOptions,
          color: (style.color || opts.colors?.link || "#0066cc").replace("#", ""),
          underline: {},
        }),
      ],
      link: style.link,
    });
  }

  return new DocxTextRun(textRunOptions);
}

export function renderRunsToDocx(
  runs: TextRun[],
  options: RenderOptions = {}
): DocxParagraphChild[] {
  return runs.map((run) => renderRunToDocx(run, options));
}

export function renderBlockToDocx(
  block: RichTextBlock,
  options: RenderOptions = {}
): (Paragraph | Table)[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  switch (block.type) {
    case "heading":
      return [renderHeadingToDocx(block, opts)];

    case "paragraph":
      return [renderParagraphToDocx(block, opts)];

    case "bullet-list":
      return renderBulletListToDocx(block, opts);

    case "ordered-list":
      return renderOrderedListToDocx(block, opts);

    case "blockquote":
      return [renderBlockquoteToDocx(block, opts)];

    case "code-block":
      return [renderCodeBlockToDocx(block, opts)];

    case "horizontal-rule":
      return [
        new Paragraph({
          border: {
            bottom: { style: BorderStyle.SINGLE, size: 6, color: "CCCCCC" },
          },
          spacing: { after: 200 },
        }),
      ];

    case "table":
      return [renderTableToDocx(block, opts)];

    case "image":
      return renderImageToDocx(block, opts);

    default:
      return [];
  }
}

function renderHeadingToDocx(
  block: HeadingBlock,
  opts: Required<RenderOptions>
): Paragraph {
  const headingLevelMap: Record<number, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
    1: HeadingLevel.HEADING_1,
    2: HeadingLevel.HEADING_2,
    3: HeadingLevel.HEADING_3,
    4: HeadingLevel.HEADING_4,
    5: HeadingLevel.HEADING_5,
    6: HeadingLevel.HEADING_6,
  };

  const fontSize = opts.headingSizes[block.level] || 16;
  const headingRuns = block.runs.map((run) => {
    const enhancedRun: TextRun = {
      ...run,
      style: {
        ...run.style,
        bold: true,
        fontSize: run.style?.fontSize || fontSize,
      },
    };
    return renderRunToDocx(enhancedRun, opts);
  });

  return new Paragraph({
    heading: headingLevelMap[block.level],
    children: headingRuns,
    alignment: getDocxAlignment(block.alignment),
    spacing: { before: 240, after: 120 },
  });
}

function renderParagraphToDocx(
  block: ParagraphBlock,
  opts: Required<RenderOptions>
): Paragraph {
  return new Paragraph({
    children: renderRunsToDocx(block.runs, opts),
    alignment: getDocxAlignment(block.alignment),
    indent: block.indent
      ? { left: convertInchesToTwip(block.indent * 0.5) }
      : undefined,
    spacing: { after: 200, line: opts.lineHeight },
  });
}

function renderBulletListToDocx(
  block: BulletListBlock,
  opts: Required<RenderOptions>
): Paragraph[] {
  return renderListItemsToDocx(block.items, false, 0, opts);
}

function renderOrderedListToDocx(
  block: OrderedListBlock,
  opts: Required<RenderOptions>
): Paragraph[] {
  return renderListItemsToDocx(block.items, true, 0, opts, block.start ?? 1);
}

function renderListItemsToDocx(
  items: ListItem[],
  ordered: boolean,
  level: number,
  opts: Required<RenderOptions>,
  start: number = 1
): Paragraph[] {
  const paragraphs: Paragraph[] = [];

  items.forEach((item, index) => {
    const bullet = ordered ? `${start + index}.` : "•";
    const indent = convertInchesToTwip(0.25 + level * 0.25);

    const bulletRun = new DocxTextRun({
      text: bullet + " ",
      font: opts.defaultFontFamily,
      size: opts.defaultFontSize * 2,
    });

    paragraphs.push(
      new Paragraph({
        children: [bulletRun, ...renderRunsToDocx(item.runs, opts)],
        indent: { left: indent, hanging: convertInchesToTwip(0.25) },
        spacing: { after: 80, line: opts.lineHeight },
      })
    );

    if (item.children && item.children.length > 0) {
      paragraphs.push(
        ...renderListItemsToDocx(item.children, ordered, level + 1, opts)
      );
    }
  });

  return paragraphs;
}

function renderBlockquoteToDocx(
  block: BlockquoteBlock,
  opts: Required<RenderOptions>
): Paragraph {
  const quotedRuns = block.runs.map((run) => ({
    ...run,
    style: {
      ...run.style,
      italic: true,
      color: run.style?.color || opts.colors.lightText,
    },
  }));

  return new Paragraph({
    children: renderRunsToDocx(quotedRuns, opts),
    indent: { left: convertInchesToTwip(0.5) },
    border: {
      left: { style: BorderStyle.SINGLE, size: 12, color: "CCCCCC" },
    },
    spacing: { before: 120, after: 120, line: opts.lineHeight },
  });
}

function renderCodeBlockToDocx(
  block: CodeBlock,
  opts: Required<RenderOptions>
): Paragraph {
  return new Paragraph({
    children: [
      new DocxTextRun({
        text: block.code,
        font: opts.fontRegistry.monoFamily,
        size: opts.defaultFontSize * 2 - 2,
      }),
    ],
    shading: { fill: "F5F5F5", type: ShadingType.CLEAR, color: "auto" },
    spacing: { before: 120, after: 120 },
  });
}

function renderTableToDocx(
  block: TableBlock,
  opts: Required<RenderOptions>
): Table {
  const rows = block.rows.map((row) => {
    const cells = row.cells.map((cell) => {
      const cellOptions: ITableCellOptions = {
        children: [
          new Paragraph({
            children: renderRunsToDocx(cell.runs, opts),
          }),
        ],
        columnSpan: cell.colSpan,
        rowSpan: cell.rowSpan,
        shading: cell.isHeader
          ? { fill: "F0F0F0", type: ShadingType.CLEAR, color: "auto" }
          : undefined,
      };
      return new TableCell(cellOptions);
    });
    return new TableRow({ children: cells });
  });

  return new Table({
    rows,
    width: { size: 100, type: WidthType.PERCENTAGE },
  });
}

function resolveImageData(src: string): Buffer | null {
  if (src.startsWith("data:")) {
    const match = src.match(/^data:(.+?);base64,(.*)$/);
    if (!match) return null;
    return Buffer.from(match[2], "base64");
  }

  if (src.startsWith("http://") || src.startsWith("https://")) {
    return null;
  }

  const filePath = src.startsWith("file://") ? fileURLToPath(src) : path.resolve(src);
  if (!fs.existsSync(filePath)) return null;

  return fs.readFileSync(filePath);
}

function renderImageToDocx(
  block: Extract<RichTextBlock, { type: "image" }>,
  opts: Required<RenderOptions>
): Paragraph[] {
  const data = resolveImageData(block.src);
  if (!data) return [];

  const dimensions = getImageDimensions(data);
  const { width, height } = getScaledImageDimensions(
    block.width,
    block.height,
    dimensions
  );
  const imageRun = new ImageRun({
    data,
    transformation: {
      width,
      height,
    },
  });

  const paragraphs: Paragraph[] = [
    new Paragraph({
      children: [imageRun],
      alignment: AlignmentType.CENTER,
    }),
  ];

  const caption = block.title || block.alt;
  if (caption) {
    paragraphs.push(
      new Paragraph({
        children: [
          new DocxTextRun({
            text: caption,
            italics: true,
            size: opts.defaultFontSize * 2 - 1,
            color: opts.colors.lightText?.replace("#", ""),
          }),
        ],
        alignment: AlignmentType.CENTER,
        spacing: { after: 120 },
      })
    );
  }

  return paragraphs;
}

function getImageDimensions(
  data: Buffer
): { width: number; height: number } | null {
  if (data.length < 24) return null;

  if (data.slice(1, 4).toString("ascii") === "PNG") {
    return {
      width: data.readUInt32BE(16),
      height: data.readUInt32BE(20),
    };
  }

  if (data[0] === 0xff && data[1] === 0xd8) {
    let offset = 2;
    while (offset < data.length) {
      if (data[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = data[offset + 1];
      if (marker === 0xc0 || marker === 0xc2) {
        const height = data.readUInt16BE(offset + 5);
        const width = data.readUInt16BE(offset + 7);
        return { width, height };
      }
      const segmentLength = data.readUInt16BE(offset + 2);
      if (segmentLength <= 0) break;
      offset += 2 + segmentLength;
    }
  }

  return null;
}

function getScaledImageDimensions(
  width: number | undefined,
  height: number | undefined,
  dimensions: { width: number; height: number } | null
): { width: number; height: number } {
  const fallbackWidth = 400;
  const fallbackHeight = 300;
  const maxWidth = 600;

  if (width && height) {
    const clampedWidth = Math.min(width, maxWidth);
    const scale = clampedWidth / width;
    return { width: clampedWidth, height: Math.round(height * scale) };
  }

  if (dimensions) {
    if (width) {
      const clampedWidth = Math.min(width, maxWidth);
      return {
        width: clampedWidth,
        height: Math.round((clampedWidth * dimensions.height) / dimensions.width),
      };
    }

    if (height) {
      const derivedWidth = Math.round((height * dimensions.width) / dimensions.height);
      const clampedWidth = Math.min(derivedWidth, maxWidth);
      const scale = clampedWidth / derivedWidth;
      return { width: clampedWidth, height: Math.round(height * scale) };
    }

    const clampedWidth = Math.min(dimensions.width, maxWidth);
    const scale = clampedWidth / dimensions.width;
    return { width: clampedWidth, height: Math.round(dimensions.height * scale) };
  }

  return { width: fallbackWidth, height: fallbackHeight };
}

function getDocxAlignment(
  alignment?: "left" | "center" | "right" | "justify"
): AlignmentType | undefined {
  if (!alignment) return undefined;
  const map: Record<string, AlignmentType> = {
    left: AlignmentType.LEFT,
    center: AlignmentType.CENTER,
    right: AlignmentType.RIGHT,
    justify: AlignmentType.JUSTIFIED,
  };
  return map[alignment];
}

export function renderDocumentToDocx(
  doc: RichTextDocument,
  options: RenderOptions = {}
): (Paragraph | Table)[] {
  const elements: (Paragraph | Table)[] = [];

  for (const block of doc.blocks) {
    elements.push(...renderBlockToDocx(block, options));
  }

  return elements;
}

export async function renderDocumentToDocxBuffer(
  doc: RichTextDocument,
  options: RenderOptions = {}
): Promise<Buffer> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const bodyElements = renderDocumentToDocx(doc, opts);

  const document = new Document({
    styles: {
      paragraphStyles: [
        {
          id: "Normal",
          name: "Normal",
          basedOn: "Normal",
          next: "Normal",
          run: {
            font: opts.defaultFontFamily,
            size: opts.defaultFontSize * 2,
          },
          paragraph: {
            spacing: { line: opts.lineHeight },
          },
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertInchesToTwip(0.75),
              right: convertInchesToTwip(0.75),
              bottom: convertInchesToTwip(0.75),
              left: convertInchesToTwip(0.75),
            },
          },
        },
        children: bodyElements,
      },
    ],
  });

  return await Packer.toBuffer(document);
}

export function renderRunToHtml(run: TextRun, options: RenderOptions = {}): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const style = run.style || {};
  const cssStyles = getCssFontStyle(style, opts.fontRegistry);

  let html = escapeHtml(run.text);

  if (style.bold) html = `<strong>${html}</strong>`;
  if (style.italic) html = `<em>${html}</em>`;
  if (style.underline) html = `<u>${html}</u>`;
  if (style.strikethrough) html = `<del>${html}</del>`;
  if (style.code) html = `<code>${html}</code>`;
  if (style.superscript) html = `<sup>${html}</sup>`;
  if (style.subscript) html = `<sub>${html}</sub>`;

  if (style.link) {
    html = `<a href="${escapeHtml(style.link)}" style="color: ${opts.colors.link}; text-decoration: underline;">${html}</a>`;
  }

  const inlineStyles: string[] = [];
  if (style.color) inlineStyles.push(`color: ${style.color}`);
  if (style.backgroundColor) inlineStyles.push(`background-color: ${style.backgroundColor}`);
  if (style.fontSize) inlineStyles.push(`font-size: ${style.fontSize}pt`);
  if (style.fontFamily) inlineStyles.push(`font-family: ${style.fontFamily}`);

  if (inlineStyles.length > 0) {
    html = `<span style="${inlineStyles.join("; ")}">${html}</span>`;
  }

  return html;
}

export function renderRunsToHtml(runs: TextRun[], options: RenderOptions = {}): string {
  return runs.map((run) => renderRunToHtml(run, options)).join("");
}

export function renderBlockToHtml(block: RichTextBlock, options: RenderOptions = {}): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  switch (block.type) {
    case "heading":
      return `<h${block.level}>${renderRunsToHtml(block.runs, opts)}</h${block.level}>`;

    case "paragraph":
      const pStyle = block.alignment ? ` style="text-align: ${block.alignment}"` : "";
      return `<p${pStyle}>${renderRunsToHtml(block.runs, opts)}</p>`;

    case "bullet-list":
      return renderListToHtml(block.items, false, opts);

    case "ordered-list":
      return renderListToHtml(block.items, true, opts, block.start);

    case "blockquote":
      return `<blockquote>${renderRunsToHtml(block.runs, opts)}</blockquote>`;

    case "code-block":
      const langClass = block.language ? ` class="language-${block.language}"` : "";
      return `<pre><code${langClass}>${escapeHtml(block.code)}</code></pre>`;

    case "horizontal-rule":
      return "<hr>";

    case "table":
      const tableRows = block.rows
        .map((row) => {
          const cells = row.cells
            .map((cell) => {
              const tag = cell.isHeader ? "th" : "td";
              const attrs: string[] = [];
              if (cell.colSpan && cell.colSpan > 1) attrs.push(`colspan="${cell.colSpan}"`);
              if (cell.rowSpan && cell.rowSpan > 1) attrs.push(`rowspan="${cell.rowSpan}"`);
              const attrStr = attrs.length > 0 ? " " + attrs.join(" ") : "";
              return `<${tag}${attrStr}>${renderRunsToHtml(cell.runs, opts)}</${tag}>`;
            })
            .join("");
          return `<tr>${cells}</tr>`;
        })
        .join("");
      return `<table>${tableRows}</table>`;

    case "image":
      const altAttr = block.alt ? ` alt="${escapeHtml(block.alt)}"` : "";
      const titleAttr = block.title ? ` title="${escapeHtml(block.title)}"` : "";
      const sizeAttrs = [
        block.width ? ` width="${block.width}"` : "",
        block.height ? ` height="${block.height}"` : "",
      ].join("");
      return `<img src="${escapeHtml(block.src)}"${altAttr}${titleAttr}${sizeAttrs}>`;

    default:
      return "";
  }
}

export function renderDocumentToHtml(
  doc: RichTextDocument,
  options: RenderOptions = {}
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  const css = `
    body {
      font-family: ${opts.defaultFontFamily}, sans-serif;
      font-size: ${opts.defaultFontSize}pt;
      line-height: 1.6;
      color: ${opts.colors.text};
      max-width: 800px;
      margin: 0 auto;
      padding: 20px;
    }
    h1, h2, h3, h4, h5, h6 {
      font-weight: bold;
      margin-top: 1.5em;
      margin-bottom: 0.5em;
    }
    h1 { font-size: ${opts.headingSizes[1]}pt; }
    h2 { font-size: ${opts.headingSizes[2]}pt; }
    h3 { font-size: ${opts.headingSizes[3]}pt; }
    h4 { font-size: ${opts.headingSizes[4]}pt; }
    h5 { font-size: ${opts.headingSizes[5]}pt; }
    h6 { font-size: ${opts.headingSizes[6]}pt; }
    p { margin: 0.5em 0; }
    ul, ol { padding-left: 1.5em; }
    li { margin: 0.25em 0; }
    blockquote {
      border-left: 4px solid #ddd;
      margin: 1em 0;
      padding-left: 1em;
      color: ${opts.colors.lightText};
      font-style: italic;
    }
    pre {
      background-color: #f5f5f5;
      padding: 12px;
      border-radius: 4px;
      overflow-x: auto;
    }
    code {
      font-family: ${opts.fontRegistry.monoFamily}, monospace;
      background-color: #f5f5f5;
      padding: 2px 4px;
      border-radius: 3px;
    }
    pre code {
      background: none;
      padding: 0;
    }
    table {
      border-collapse: collapse;
      width: 100%;
      margin: 1em 0;
    }
    th, td {
      border: 1px solid #ddd;
      padding: 8px;
      text-align: left;
    }
    th {
      background-color: #f0f0f0;
      font-weight: bold;
    }
    hr {
      border: none;
      border-top: 1px solid #ddd;
      margin: 1.5em 0;
    }
    a {
      color: ${opts.colors.link};
      text-decoration: underline;
    }
    img {
      max-width: 100%;
      height: auto;
    }
    strong, b { font-weight: bold; }
    em, i { font-style: italic; }
    u { text-decoration: underline; }
    del, s { text-decoration: line-through; }
  `;

  const body = doc.blocks.map((block) => renderBlockToHtml(block, opts)).join("\n");

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>${css}</style>
</head>
<body>
${body}
</body>
</html>`;
}

function renderListToHtml(
  items: ListItem[],
  ordered: boolean,
  opts: Required<RenderOptions>,
  start?: number
): string {
  const tag = ordered ? "ol" : "ul";
  const startAttr = ordered && start && start !== 1 ? ` start="${start}"` : "";
  const listItems = items
    .map((item) => {
      const content = renderRunsToHtml(item.runs, opts);
      const children =
        item.children && item.children.length > 0
          ? renderListToHtml(item.children, ordered, opts)
          : "";
      return `<li>${content}${children}</li>`;
    })
    .join("");
  return `<${tag}${startAttr}>${listItems}</${tag}>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
