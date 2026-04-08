import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  Table, TableRow, TableCell, WidthType, AlignmentType,
  Header, Footer, PageNumber, BorderStyle, ShadingType,
  convertMillimetersToTwip, PageBreak, NumberFormat,
  LevelFormat,
} from "docx";

export interface WordContent {
  title: string;
  author?: string;
  sections: Array<{
    heading: string;
    paragraphs?: string[];
    table?: { headers: string[]; rows: string[][] };
    list?: { items: string[]; ordered?: boolean };
  }>;
}

const BLUE = "1F4E79";
const HEADING_BLUE = "2E5090";
const ALT_GRAY = "F2F2F2";

function thinBorder(color = "CCCCCC") {
  const side = { style: BorderStyle.SINGLE, size: 1, color };
  return { top: side, bottom: side, left: side, right: side };
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9_\- ]/g, "").trim().replace(/\s+/g, "_").slice(0, 80);
}

export async function generateWord(content: WordContent): Promise<{ buffer: Buffer; filename: string; mimeType: string }> {
  const { title, author, sections } = content;
  const dateStr = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  const coverPage: Paragraph[] = [
    new Paragraph({ spacing: { before: 4000 } }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: title, bold: true, size: 56, color: BLUE, font: "Calibri" })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 400 },
      children: [new TextRun({ text: author || "", size: 24, color: "555555", font: "Calibri" })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 200 },
      children: [new TextRun({ text: dateStr, size: 22, color: "888888", font: "Calibri", italics: true })],
    }),
    new Paragraph({ children: [new PageBreak()] }),
  ];

  const bodyParagraphs: (Paragraph | Table)[] = [];

  for (const section of sections) {
    bodyParagraphs.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 360, after: 120 },
        children: [new TextRun({ text: section.heading, bold: true, size: 32, color: HEADING_BLUE, font: "Calibri" })],
      }),
    );

    if (section.paragraphs) {
      for (const text of section.paragraphs) {
        bodyParagraphs.push(
          new Paragraph({
            spacing: { after: 120, line: 360 },
            children: [new TextRun({ text, size: 22, font: "Calibri" })],
          }),
        );
      }
    }

    if (section.table && section.table.headers.length > 0) {
      const { headers, rows } = section.table;
      const headerRow = new TableRow({
        tableHeader: true,
        children: headers.map(
          (h) =>
            new TableCell({
              shading: { type: ShadingType.CLEAR, fill: BLUE },
              borders: thinBorder(BLUE),
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: h, bold: true, size: 20, color: "FFFFFF", font: "Calibri" })] })],
            }),
        ),
      });

      const dataRows = (rows || []).map(
        (row, idx) =>
          new TableRow({
            children: row.map(
              (cell) =>
                new TableCell({
                  shading: idx % 2 === 1 ? { type: ShadingType.CLEAR, fill: ALT_GRAY } : undefined,
                  borders: thinBorder(),
                  children: [new Paragraph({ children: [new TextRun({ text: cell ?? "", size: 20, font: "Calibri" })] })],
                }),
            ),
          }),
      );

      bodyParagraphs.push(
        new Paragraph({ spacing: { before: 120 } }),
        new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [headerRow, ...dataRows] }),
        new Paragraph({ spacing: { after: 120 } }),
      );
    }

    if (section.list && section.list.items.length > 0) {
      const ordered = section.list.ordered ?? false;
      for (const item of section.list.items) {
        bodyParagraphs.push(
          new Paragraph({
            numbering: { reference: ordered ? "ordered-list" : "bullet-list", level: 0 },
            spacing: { after: 60, line: 360 },
            children: [new TextRun({ text: item, size: 22, font: "Calibri" })],
          }),
        );
      }
    }
  }

  const doc = new Document({
    numbering: {
      config: [
        {
          reference: "bullet-list",
          levels: [{ level: 0, format: LevelFormat.BULLET, text: "\u2022", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: convertMillimetersToTwip(10), hanging: convertMillimetersToTwip(5) } } } }],
        },
        {
          reference: "ordered-list",
          levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: convertMillimetersToTwip(10), hanging: convertMillimetersToTwip(5) } } } }],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertMillimetersToTwip(25),
              bottom: convertMillimetersToTwip(25),
              left: convertMillimetersToTwip(30),
              right: convertMillimetersToTwip(25),
            },
            pageNumbers: { start: 1, formatType: NumberFormat.DECIMAL },
          },
        },
        headers: {
          default: new Header({
            children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: title, italics: true, size: 18, color: "999999", font: "Calibri" })] })],
          }),
        },
        footers: {
          default: new Footer({
            children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT], size: 18, color: "999999" })] })],
          }),
        },
        children: [...coverPage, ...bodyParagraphs],
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  const filename = `${sanitizeFilename(title) || "document"}.docx`;
  return { buffer: Buffer.from(buffer), filename, mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
}
