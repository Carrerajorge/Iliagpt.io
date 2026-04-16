import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  PageBreak,
  TableOfContents,
  convertInchesToTwip,
  AlignmentType,
  ExternalHyperlink,
  Math as DocxMath,
  MathRun,
} from "docx";
import { DocSpec, DocBlock, TitleBlock, TocBlock, NumberedBlock } from "../../shared/documentSpecs";
import { tokenizeMarkdown, hasMarkdown, RichTextToken } from "./richText/markdownTokenizer";
import { createMathFromLatex } from "./richText/latexMath";

// ============================================
// SECURITY LIMITS
// ============================================

/** Maximum number of blocks to process */
const MAX_BLOCKS = 10_000;

/** Maximum text length per block */
const MAX_BLOCK_TEXT_LENGTH = 100_000;

/** Maximum items in a bullet/numbered list */
const MAX_LIST_ITEMS = 1_000;

/** Maximum table rows */
const MAX_TABLE_ROWS = 5_000;

/** Maximum table columns */
const MAX_TABLE_COLUMNS = 200;

/** Maximum LaTeX expression length */
const MAX_LATEX_LENGTH = 10_000;

/** Allowed URL protocols for hyperlinks */
const ALLOWED_URL_PROTOCOLS = ["http:", "https:", "mailto:"];

/**
 * Security: validate URL protocol to prevent javascript:, data:, file:// injection
 */
function isAllowedUrl(url: string): boolean {
  if (!url || typeof url !== "string") return false;
  const trimmed = url.trim().toLowerCase();
  return ALLOWED_URL_PROTOCOLS.some(proto => trimmed.startsWith(proto));
}

interface FontConfig {
  font: string;
  size: number;
}

type ParagraphChild = TextRun | ExternalHyperlink | DocxMath;

function getStylesetConfig(styleset: "modern" | "classic"): FontConfig {
  if (styleset === "classic") {
    return { font: "Times New Roman", size: 24 };
  }
  return { font: "Calibri", size: 22 };
}

const HEADING_LEVEL_MAP: Record<number, typeof HeadingLevel[keyof typeof HeadingLevel]> = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
  4: HeadingLevel.HEADING_4,
  5: HeadingLevel.HEADING_5,
  6: HeadingLevel.HEADING_6,
};

function tokenToTextRun(token: RichTextToken, fontConfig: FontConfig, extraBold?: boolean): TextRun {
  return new TextRun({
    text: token.text,
    font: token.code ? "Courier New" : fontConfig.font,
    size: fontConfig.size,
    bold: token.bold || extraBold,
    italics: token.italic,
    shading: token.code ? { fill: "F0F0F0", type: "clear", color: "auto" } : undefined,
  });
}

async function tokensToChildren(text: string, fontConfig: FontConfig, extraBold?: boolean): Promise<ParagraphChild[]> {
  if (!hasMarkdown(text)) {
    return [
      new TextRun({
        text,
        font: fontConfig.font,
        size: fontConfig.size,
        bold: extraBold,
      }),
    ];
  }

  const tokens = tokenizeMarkdown(text);
  const children: ParagraphChild[] = [];

  for (const token of tokens) {
    if (token.isMath) {
      const mathElement = await createMathFromLatex(token.text);
      if (mathElement) {
        children.push(mathElement);
      } else {
        children.push(new DocxMath({ children: [new MathRun(token.text)] }));
      }
    } else if (token.link) {
      // Security: validate URL protocol to prevent javascript:, data:, file:// injection
      if (isAllowedUrl(token.link)) {
        children.push(
          new ExternalHyperlink({
            children: [
              new TextRun({
                text: token.text,
                font: fontConfig.font,
                size: fontConfig.size,
                bold: token.bold || extraBold,
                italics: token.italic,
                style: "Hyperlink",
              }),
            ],
            link: token.link,
          })
        );
      } else {
        // Render as plain text if URL is unsafe
        children.push(tokenToTextRun(token, fontConfig, extraBold));
      }
    } else {
      children.push(tokenToTextRun(token, fontConfig, extraBold));
    }
  }

  return children;
}

function processTitleBlock(block: TitleBlock, fontConfig: FontConfig): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({
        text: block.text,
        font: fontConfig.font,
        size: 56,
        bold: true,
      }),
    ],
    style: "Title",
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 400 },
  });
}

async function processHeadingBlock(block: Extract<DocBlock, { type: "heading" }>, fontConfig: FontConfig): Promise<Paragraph> {
  return new Paragraph({
    children: await tokensToChildren(block.text, fontConfig) as any,
    heading: HEADING_LEVEL_MAP[block.level] || HeadingLevel.HEADING_1,
    spacing: { before: 240, after: 120 },
  });
}

async function processParagraphBlock(block: Extract<DocBlock, { type: "paragraph" }>, fontConfig: FontConfig): Promise<Paragraph> {
  const paragraphOptions: any = {
    children: await tokensToChildren(block.text, fontConfig),
    spacing: { after: 200, line: 276 },
  };

  if (block.style) {
    paragraphOptions.style = block.style;
  }

  return new Paragraph(paragraphOptions);
}

async function processBulletsBlock(block: Extract<DocBlock, { type: "bullets" }>, fontConfig: FontConfig): Promise<Paragraph[]> {
  const paragraphs: Paragraph[] = [];
  // Security: limit list items
  const items = block.items.slice(0, MAX_LIST_ITEMS);
  for (const item of items) {
    paragraphs.push(
      new Paragraph({
        children: await tokensToChildren(item, fontConfig) as any,
        bullet: { level: 0 },
        spacing: { after: 80 },
      })
    );
  }
  return paragraphs;
}

async function processNumberedBlock(block: NumberedBlock, fontConfig: FontConfig): Promise<Paragraph[]> {
  const paragraphs: Paragraph[] = [];
  // Security: limit list items
  const items = block.items.slice(0, MAX_LIST_ITEMS);
  for (const item of items) {
    paragraphs.push(
      new Paragraph({
        children: await tokensToChildren(item, fontConfig) as any,
        numbering: { reference: "default-numbering", level: 0 },
        spacing: { after: 80 },
      })
    );
  }
  return paragraphs;
}

function processTocBlock(block: TocBlock): TableOfContents {
  return new TableOfContents("Table of Contents", {
    hyperlink: true,
    headingStyleRange: `1-${block.max_level}`,
  });
}

async function processTableBlock(block: Extract<DocBlock, { type: "table" }>, fontConfig: FontConfig): Promise<Table> {
  const rows: TableRow[] = [];

  // Security: limit table dimensions
  const columns = block.columns.slice(0, MAX_TABLE_COLUMNS);
  const dataRows = (block.rows || []).slice(0, MAX_TABLE_ROWS);

  if (block.header !== false) {
    const headerCells: TableCell[] = [];
    for (const col of columns) {
      headerCells.push(
        new TableCell({
          children: [
            new Paragraph({
              children: await tokensToChildren(col, fontConfig, true) as any,
            }),
          ],
          shading: { fill: "E7E6E6", type: "clear", color: "auto" },
          borders: {
            top: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
            bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
            left: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
            right: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
          },
        })
      );
    }
    rows.push(new TableRow({ children: headerCells }));
  }

  for (const row of dataRows) {
    const dataCells: TableCell[] = [];
    for (const cell of row.slice(0, MAX_TABLE_COLUMNS)) {
      dataCells.push(
        new TableCell({
          children: [
            new Paragraph({
              children: await tokensToChildren(String(cell ?? ""), fontConfig) as any,
            }),
          ],
          borders: {
            top: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
            bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
            left: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
            right: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
          },
        })
      );
    }
    rows.push(new TableRow({ children: dataCells }));
  }

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows,
  });
}

function processPageBreakBlock(): Paragraph {
  return new Paragraph({
    children: [new PageBreak()],
  });
}

async function processBlock(block: DocBlock, fontConfig: FontConfig): Promise<(Paragraph | Table | TableOfContents)[]> {
  switch (block.type) {
    case "title":
      return [processTitleBlock(block, fontConfig)];
    case "heading":
      return [await processHeadingBlock(block, fontConfig)];
    case "paragraph":
      return [await processParagraphBlock(block, fontConfig)];
    case "bullets":
      return await processBulletsBlock(block, fontConfig);
    case "numbered":
      return await processNumberedBlock(block, fontConfig);
    case "table":
      return [await processTableBlock(block, fontConfig), new Paragraph({ spacing: { after: 200 } })];
    case "page_break":
      return [processPageBreakBlock()];
    case "toc":
      return [processTocBlock(block), new Paragraph({ spacing: { after: 400 } })];
    default:
      return [];
  }
}

export async function renderWordFromSpec(spec: DocSpec): Promise<Buffer> {
  const styleset = spec.styleset || "modern";
  const fontConfig = getStylesetConfig(styleset);
  const bodyElements: (Paragraph | Table | TableOfContents)[] = [];

  if (spec.add_toc) {
    bodyElements.push(
      new TableOfContents("Table of Contents", {
        hyperlink: true,
        headingStyleRange: "1-6",
      })
    );
    bodyElements.push(new Paragraph({ spacing: { after: 400 } }));
  }

  // Security: limit total number of blocks processed
  const blocks = spec.blocks.slice(0, MAX_BLOCKS);
  for (const block of blocks) {
    bodyElements.push(...await processBlock(block, fontConfig));
  }

  // Security: sanitize document metadata
  const safeTitle = (spec.title || "").replace(/[\x00-\x1F\x7F]/g, "").substring(0, 500);
  const safeAuthor = (spec.author || "").replace(/[\x00-\x1F\x7F]/g, "").substring(0, 200);

  const doc = new Document({
    title: safeTitle,
    creator: safeAuthor || undefined,
    numbering: {
      config: [
        {
          reference: "default-numbering",
          levels: [
            {
              level: 0,
              format: "decimal",
              text: "%1.",
              alignment: "start",
              style: {
                paragraph: {
                  indent: { left: 720, hanging: 360 },
                },
              },
            },
          ],
        },
      ],
    },
    styles: {
      paragraphStyles: [
        {
          id: "Normal",
          name: "Normal",
          basedOn: "Normal",
          next: "Normal",
          run: { font: fontConfig.font, size: fontConfig.size },
          paragraph: { spacing: { line: 276 } },
        },
        {
          id: "Title",
          name: "Title",
          basedOn: "Normal",
          next: "Normal",
          run: { font: fontConfig.font, size: 56, bold: true },
          paragraph: { spacing: { after: 400 }, alignment: AlignmentType.CENTER },
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertInchesToTwip(1),
              right: convertInchesToTwip(1),
              bottom: convertInchesToTwip(1),
              left: convertInchesToTwip(1),
            },
          },
        },
        children: bodyElements,
      },
    ],
  });

  return await Packer.toBuffer(doc);
}
