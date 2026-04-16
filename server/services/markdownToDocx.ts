import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, BorderStyle, AlignmentType, convertInchesToTwip, IRunOptions, Math as DocxMath, MathRun, Header, Footer, PageNumber } from "docx";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import type { Root, Content, Text, Strong, Emphasis, InlineCode, Paragraph as MdParagraph, Heading, List, ListItem, Table as MdTable, TableRow as MdTableRow, TableCell as MdTableCell, Blockquote, Code, ThematicBreak, Link } from "mdast";

interface MathNode {
  type: "math" | "inlineMath";
  value: string;
}

// ============================================
// SECURITY LIMITS
// ============================================

/** Maximum number of AST nodes to process (prevents DoS from deeply nested markdown) */
const MAX_AST_NODES = 50_000;

/** Maximum list nesting depth */
const MAX_LIST_DEPTH = 10;

/** Maximum code block line count */
const MAX_CODE_BLOCK_LINES = 10_000;

/** Maximum table rows per table */
const MAX_TABLE_ROWS = 1_000;

/** Maximum table columns per table */
const MAX_TABLE_COLS = 100;

/** Maximum generated DOCX elements */
const MAX_DOCX_ELEMENTS = 100_000;

/** Track processing metrics for safety */
let _nodeCount = 0;

function convertLatexToMath(latex: string): DocxMath {
  return new DocxMath({
    children: [new MathRun(latex)]
  });
}

function normalizeMarkdown(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseMarkdownToAst(markdown: string): Root {
  let normalizedMd = normalizeMarkdown(markdown);
  normalizedMd = normalizedMd.replace(/\\\[/g, '$$').replace(/\\\]/g, '$$');
  normalizedMd = normalizedMd.replace(/\\\(/g, '$').replace(/\\\)/g, '$');

  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath);

  return processor.parse(normalizedMd) as Root;
}

interface TextRunOptions extends Partial<IRunOptions> {
  text: string;
}

interface MathRunMarker {
  type: "mathRun";
  latex: string;
}

type ParagraphChild = TextRunOptions | MathRunMarker;

function isMathRunMarker(item: ParagraphChild): item is MathRunMarker {
  return (item as MathRunMarker).type === "mathRun";
}

function extractParagraphChildren(node: Content, inherited: Partial<IRunOptions> = {}): ParagraphChild[] {
  const children: ParagraphChild[] = [];

  switch (node.type) {
    case "text":
      children.push({ text: (node as Text).value, ...inherited });
      break;

    case "strong":
      for (const child of (node as Strong).children) {
        children.push(...extractParagraphChildren(child, { ...inherited, bold: true }));
      }
      break;

    case "emphasis":
      for (const child of (node as Emphasis).children) {
        children.push(...extractParagraphChildren(child, { ...inherited, italics: true }));
      }
      break;

    case "inlineCode":
      children.push({
        text: (node as InlineCode).value,
        ...inherited,
        font: "Consolas",
        shading: { fill: "E8E8E8", type: "clear", color: "auto" }
      });
      break;

    case "inlineMath":
      children.push({ type: "mathRun", latex: (node as unknown as MathNode).value });
      break;

    case "link":
      const linkNode = node as Link;
      for (const child of linkNode.children) {
        children.push(...extractParagraphChildren(child, { ...inherited, color: "0563C1", underline: { type: "single" } }));
      }
      break;

    case "break":
      children.push({ text: "", break: 1, ...inherited });
      break;

    default:
      if ('children' in node && Array.isArray((node as any).children)) {
        for (const child of (node as any).children) {
          children.push(...extractParagraphChildren(child as Content, inherited));
        }
      } else if ('value' in node) {
        children.push({ text: String((node as any).value), ...inherited });
      }
  }

  return children;
}

function extractTextRuns(node: Content, inherited: Partial<IRunOptions> = {}): TextRunOptions[] {
  const children = extractParagraphChildren(node, inherited);
  return children.filter((c): c is TextRunOptions => !isMathRunMarker(c));
}

function createTextRuns(runOptions: TextRunOptions[]): TextRun[] {
  return runOptions.map(opt => new TextRun(opt as IRunOptions));
}

async function createParagraphChildren(children: ParagraphChild[]): Promise<(TextRun | DocxMath)[]> {
  const result: (TextRun | DocxMath)[] = [];

  for (const child of children) {
    if (isMathRunMarker(child)) {
      try {
        const mathElement = convertLatexToMath(child.latex);
        result.push(mathElement);
      } catch (error) {
        console.error('[markdownToDocx] Math conversion error:', error);
        result.push(new TextRun({ text: child.latex, italics: true }));
      }
    } else {
      result.push(new TextRun(child as IRunOptions));
    }
  }

  return result;
}

async function processTableNode(tableNode: MdTable): Promise<Table> {
  const rows: TableRow[] = [];
  let maxCols = 0;

  // Security: limit table dimensions to prevent resource exhaustion
  const tableRows = tableNode.children as MdTableRow[];
  if (tableRows.length > MAX_TABLE_ROWS) {
    console.warn(`[markdownToDocx] Table has ${tableRows.length} rows, truncating to ${MAX_TABLE_ROWS}`);
    tableRows.length = MAX_TABLE_ROWS;
  }

  for (const row of tableRows) {
    maxCols = Math.max(maxCols, row.children.length);
  }
  if (maxCols > MAX_TABLE_COLS) {
    console.warn(`[markdownToDocx] Table has ${maxCols} columns, truncating to ${MAX_TABLE_COLS}`);
    maxCols = MAX_TABLE_COLS;
  }

  for (let rowIndex = 0; rowIndex < tableNode.children.length; rowIndex++) {
    const mdRow = tableNode.children[rowIndex] as MdTableRow;
    const cells: TableCell[] = [];

    for (let i = 0; i < maxCols; i++) {
      const cellNode = mdRow.children[i] as MdTableCell | undefined;
      const paraChildren: ParagraphChild[] = [];

      if (cellNode) {
        for (const child of cellNode.children) {
          paraChildren.push(...extractParagraphChildren(child as Content));
        }
      }

      // Header row: dark blue background with white bold text
      // Alternating data rows: white / light gray
      const isHeaderRow = rowIndex === 0;
      const isAlternateRow = rowIndex > 0 && rowIndex % 2 === 0;

      const cellChildren = paraChildren.length > 0
        ? await createParagraphChildren(
            isHeaderRow
              ? paraChildren.map(c => isMathRunMarker(c) ? c : { ...c, bold: true, color: "FFFFFF" })
              : paraChildren
          )
        : [new TextRun({ text: "", ...(isHeaderRow ? { bold: true, color: "FFFFFF" } : {}) })];

      cells.push(new TableCell({
        children: [new Paragraph({
          children: cellChildren,
          alignment: AlignmentType.LEFT,
        })],
        shading: isHeaderRow
          ? { fill: "1F4E79", type: "clear" as any, color: "auto" }
          : isAlternateRow
            ? { fill: "F7FAFC", type: "clear" as any, color: "auto" }
            : undefined,
        borders: {
          top: { style: BorderStyle.SINGLE, size: 1, color: "B0BEC5" },
          bottom: { style: BorderStyle.SINGLE, size: 1, color: "B0BEC5" },
          left: { style: BorderStyle.SINGLE, size: 1, color: "B0BEC5" },
          right: { style: BorderStyle.SINGLE, size: 1, color: "B0BEC5" },
        },
      }));
    }

    rows.push(new TableRow({ children: cells }));
  }

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows,
  });
}

async function processListNode(listNode: List, level: number = 0): Promise<Paragraph[]> {
  // Security: prevent excessive nesting depth (DoS via deeply nested lists)
  if (level > MAX_LIST_DEPTH) {
    console.warn(`[markdownToDocx] List nesting depth ${level} exceeds max ${MAX_LIST_DEPTH}, skipping`);
    return [];
  }

  const paragraphs: Paragraph[] = [];
  const isOrdered = listNode.ordered;

  for (const item of listNode.children as ListItem[]) {
    for (const child of item.children) {
      if (child.type === "paragraph") {
        const paraChildren: ParagraphChild[] = [];
        for (const inlineChild of (child as MdParagraph).children) {
          paraChildren.push(...extractParagraphChildren(inlineChild as Content));
        }

        const para = new Paragraph({
          children: await createParagraphChildren(paraChildren),
          ...(isOrdered
            ? { numbering: { reference: "numbered-list", level } }
            : { bullet: { level } }
          ),
          spacing: { after: 80, line: 276 },
          indent: { left: convertInchesToTwip(0.25 + level * 0.25) },
        });
        paragraphs.push(para);
      } else if (child.type === "list") {
        paragraphs.push(...await processListNode(child as List, level + 1));
      }
    }
  }

  return paragraphs;
}

async function processBlockquote(node: Blockquote): Promise<Paragraph[]> {
  const paragraphs: Paragraph[] = [];

  for (const child of node.children) {
    if (child.type === "paragraph") {
      const paraChildren: ParagraphChild[] = [];
      for (const inlineChild of (child as MdParagraph).children) {
        paraChildren.push(...extractParagraphChildren(inlineChild as Content));
      }

      paragraphs.push(new Paragraph({
        children: await createParagraphChildren(paraChildren),
        indent: { left: convertInchesToTwip(0.5) },
        border: {
          left: { style: BorderStyle.SINGLE, size: 24, color: "CCCCCC" },
        },
        spacing: { after: 100 },
      }));
    }
  }

  return paragraphs;
}

async function astToDocxElements(ast: Root): Promise<(Paragraph | Table)[]> {
  const elements: (Paragraph | Table)[] = [];

  // Security: limit total AST nodes to prevent DoS
  if (ast.children.length > MAX_AST_NODES) {
    console.warn(`[markdownToDocx] AST has ${ast.children.length} nodes, truncating to ${MAX_AST_NODES}`);
    ast.children.length = MAX_AST_NODES;
  }

  for (const node of ast.children) {
    // Security: limit total generated elements
    if (elements.length >= MAX_DOCX_ELEMENTS) {
      console.warn(`[markdownToDocx] Element limit reached (${MAX_DOCX_ELEMENTS}), stopping`);
      break;
    }
    switch (node.type) {
      case "heading": {
        const headingNode = node as Heading;
        const paraChildren: ParagraphChild[] = [];
        // Apply heading color to all inline children
        const headingColorMap: Record<number, string> = {
          1: "1F4E79", // Dark blue for H1
          2: "2B7A78", // Teal for H2
          3: "4472C4", // Accent blue for H3
          4: "4472C4",
          5: "4472C4",
          6: "4472C4",
        };
        const headingColor = headingColorMap[headingNode.depth] || "1F4E79";
        for (const child of headingNode.children) {
          paraChildren.push(...extractParagraphChildren(child as Content, { color: headingColor }));
        }

        const headingLevelMap: Record<number, typeof HeadingLevel[keyof typeof HeadingLevel]> = {
          1: HeadingLevel.HEADING_1,
          2: HeadingLevel.HEADING_2,
          3: HeadingLevel.HEADING_3,
          4: HeadingLevel.HEADING_4,
          5: HeadingLevel.HEADING_5,
          6: HeadingLevel.HEADING_6,
        };

        elements.push(new Paragraph({
          children: await createParagraphChildren(paraChildren),
          heading: headingLevelMap[headingNode.depth] || HeadingLevel.HEADING_1,
          spacing: { before: headingNode.depth === 1 ? 400 : 300, after: 200 },
          ...(headingNode.depth === 1 ? {
            border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: "1F4E79" } },
          } : {}),
        }));
        break;
      }

      case "paragraph": {
        const paraNode = node as MdParagraph;
        const paraChildren: ParagraphChild[] = [];
        for (const child of paraNode.children) {
          paraChildren.push(...extractParagraphChildren(child as Content));
        }

        if (paraChildren.length > 0) {
          elements.push(new Paragraph({
            children: await createParagraphChildren(paraChildren),
            spacing: { after: 200, line: 276 },
          }));
        }
        break;
      }

      case "math": {
        const mathNode = node as unknown as MathNode;
        try {
          const mathElement = convertLatexToMath(mathNode.value);
          elements.push(new Paragraph({
            children: [mathElement],
            spacing: { before: 200, after: 200 },
            alignment: AlignmentType.CENTER,
          }));
        } catch (error) {
          console.error('[markdownToDocx] Block math conversion error:', error);
          elements.push(new Paragraph({
            children: [new TextRun({ text: mathNode.value, italics: true })],
            spacing: { after: 200 },
            alignment: AlignmentType.CENTER,
          }));
        }
        break;
      }

      case "list": {
        elements.push(...await processListNode(node as List));
        break;
      }

      case "table": {
        elements.push(await processTableNode(node as MdTable));
        elements.push(new Paragraph({ spacing: { after: 200 } }));
        break;
      }

      case "blockquote": {
        elements.push(...await processBlockquote(node as Blockquote));
        break;
      }

      case "code": {
        const codeNode = node as Code;
        let codeLines = codeNode.value.split("\n");

        // Security: limit code block lines to prevent memory exhaustion
        if (codeLines.length > MAX_CODE_BLOCK_LINES) {
          console.warn(`[markdownToDocx] Code block has ${codeLines.length} lines, truncating to ${MAX_CODE_BLOCK_LINES}`);
          codeLines = codeLines.slice(0, MAX_CODE_BLOCK_LINES);
          codeLines.push(`... (truncated, ${codeNode.value.split("\n").length - MAX_CODE_BLOCK_LINES} more lines)`);
        }

        for (const line of codeLines) {
          elements.push(new Paragraph({
            children: [new TextRun({
              text: line || " ",
              font: "Consolas",
              size: 20,
            })],
            shading: { fill: "F5F5F5", type: "clear", color: "auto" },
            spacing: { after: 0 },
            indent: { left: convertInchesToTwip(0.25) },
          }));
        }
        elements.push(new Paragraph({ spacing: { after: 200 } }));
        break;
      }

      case "thematicBreak": {
        elements.push(new Paragraph({
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "CCCCCC" } },
          spacing: { before: 200, after: 200 },
        }));
        break;
      }

      default:
        break;
    }
  }

  return elements;
}

/** Maximum markdown content size for Word generation (5MB) */
const MAX_MARKDOWN_CONTENT_SIZE = 5 * 1024 * 1024;

export async function generateWordFromMarkdown(title: string, content: string): Promise<Buffer> {
  // Security: enforce content size limit
  if (content.length > MAX_MARKDOWN_CONTENT_SIZE) {
    throw new Error(`Markdown content exceeds maximum size of ${MAX_MARKDOWN_CONTENT_SIZE / (1024 * 1024)}MB`);
  }

  const ast = parseMarkdownToAst(content);
  console.log('[markdownToDocx] parsed AST options:', ast.children.length, 'nodes');

  if (ast.children.length > 0) {
    console.log('[markdownToDocx] First node type:', ast.children[0].type);
  }

  const bodyElements = await astToDocxElements(ast);
  console.log('[markdownToDocx] Generated bodyElements:', bodyElements.length);

  const titleParagraph = new Paragraph({
    children: [new TextRun({ text: title, bold: true, size: 48, color: "1F4E79", font: "Calibri" })],
    heading: HeadingLevel.TITLE,
    spacing: { after: 200 },
    alignment: AlignmentType.CENTER,
  });

  // Decorative line under title
  const titleUnderline = new Paragraph({
    border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: "2B7A78" } },
    spacing: { after: 400 },
  });

  const doc = new Document({
    numbering: {
      config: [{
        reference: "numbered-list",
        levels: [
          {
            level: 0,
            format: "decimal",
            text: "%1.",
            alignment: AlignmentType.START,
            style: { paragraph: { indent: { left: convertInchesToTwip(0.5), hanging: convertInchesToTwip(0.25) } } },
          },
          {
            level: 1,
            format: "lowerLetter",
            text: "%2.",
            alignment: AlignmentType.START,
            style: { paragraph: { indent: { left: convertInchesToTwip(1), hanging: convertInchesToTwip(0.25) } } },
          },
          {
            level: 2,
            format: "lowerRoman",
            text: "%3.",
            alignment: AlignmentType.START,
            style: { paragraph: { indent: { left: convertInchesToTwip(1.5), hanging: convertInchesToTwip(0.25) } } },
          },
        ],
      }],
    },
    styles: {
      paragraphStyles: [
        {
          id: "Normal",
          name: "Normal",
          basedOn: "Normal",
          next: "Normal",
          run: { font: "Calibri", size: 24 },
          paragraph: { spacing: { line: 276 } },
        },
        {
          id: "Heading1",
          name: "Heading 1",
          basedOn: "Normal",
          next: "Normal",
          run: { font: "Calibri", size: 36, bold: true, color: "1F4E79" },
          paragraph: { spacing: { before: 400, after: 200 } },
        },
        {
          id: "Heading2",
          name: "Heading 2",
          basedOn: "Normal",
          next: "Normal",
          run: { font: "Calibri", size: 30, bold: true, color: "2B7A78" },
          paragraph: { spacing: { before: 300, after: 200 } },
        },
        {
          id: "Heading3",
          name: "Heading 3",
          basedOn: "Normal",
          next: "Normal",
          run: { font: "Calibri", size: 26, bold: true, color: "4472C4" },
          paragraph: { spacing: { before: 300, after: 200 } },
        },
      ],
    },
    sections: [{
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
      headers: {
        default: new Header({
          children: [
            new Paragraph({
              children: [
                new TextRun({ text: title, font: "Calibri", size: 18, color: "718096", italics: true }),
              ],
              alignment: AlignmentType.RIGHT,
              border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: "D6DCE4" } },
              spacing: { after: 100 },
            }),
          ],
        }),
      },
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              children: [
                new TextRun({ text: "Page ", font: "Calibri", size: 18, color: "718096" }),
                new TextRun({ children: [PageNumber.CURRENT], font: "Calibri", size: 18, color: "718096" }),
                new TextRun({ text: " of ", font: "Calibri", size: 18, color: "718096" }),
                new TextRun({ children: [PageNumber.TOTAL_PAGES], font: "Calibri", size: 18, color: "718096" }),
              ],
              alignment: AlignmentType.CENTER,
              border: { top: { style: BorderStyle.SINGLE, size: 4, color: "D6DCE4" } },
              spacing: { before: 100 },
            }),
          ],
        }),
      },
      children: [titleParagraph, titleUnderline, ...bodyElements],
    }],
  });

  return await Packer.toBuffer(doc);
}

export { normalizeMarkdown, parseMarkdownToAst };
