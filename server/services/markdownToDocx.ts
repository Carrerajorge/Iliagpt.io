import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, BorderStyle, AlignmentType, convertInchesToTwip, IRunOptions, Math as DocxMath, MathRun } from "docx";
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

      cells.push(new TableCell({
        children: [new Paragraph({
          children: paraChildren.length > 0 ? await createParagraphChildren(paraChildren) : [new TextRun({ text: "" })],
          alignment: AlignmentType.LEFT,
        })],
        shading: rowIndex === 0 ? { fill: "E7E6E6", type: "clear", color: "auto" } : undefined,
        borders: {
          top: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
          bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
          left: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
          right: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
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
          spacing: { after: 80 },
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
        for (const child of headingNode.children) {
          paraChildren.push(...extractParagraphChildren(child as Content));
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
    children: [new TextRun({ text: title, bold: true, size: 48 })],
    heading: HeadingLevel.TITLE,
    spacing: { after: 400 },
    alignment: AlignmentType.CENTER,
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
      children: [titleParagraph, ...bodyElements],
    }],
  });

  return await Packer.toBuffer(doc);
}

export { normalizeMarkdown, parseMarkdownToAst };
