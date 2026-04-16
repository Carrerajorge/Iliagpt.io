# IliaGPT Word Document Generation Skill

## Overview

Generate professional `.docx` files using the `docx` npm library (docx-js). All code runs in the IliaGPT sandbox VM with `require("docx")` available. Call `saveFile(filename, buffer)` to emit the file.

## Decision Tree

| Task | Approach |
|------|----------|
| Create new document | `docx` library (this guide) |
| Edit existing .docx | Unpack OOXML ZIP, modify XML, repack |
| Read/extract content | Parse with `mammoth` or unzip + read XML |

For **new documents**, always use the `docx` library. Never manipulate raw XML for new files.

---

## Setup & Imports

```javascript
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  Table, TableRow, TableCell, WidthType, AlignmentType,
  Header, Footer, PageNumber, BorderStyle, ShadingType,
  ImageRun, PageBreak, LevelFormat, NumberFormat,
  convertMillimetersToTwip, ExternalHyperlink, TableOfContents,
  Bookmark, InternalHyperlink, FootnoteReferenceRun,
  TabStopType, TabStopPosition,
} = require("docx");
const fs = require("fs");
```

---

## Design Rules

All IliaGPT documents follow these defaults unless the user specifies otherwise:

| Property | Value |
|----------|-------|
| Body font | Calibri 11pt (size: 22 half-points) |
| Heading 1 | Calibri 16pt bold, color `#2E5090` |
| Heading 2 | Calibri 14pt bold, color `#2E5090` |
| Line spacing | 1.5 (line: 360 twips) |
| Page margins | Top/Bottom 2.5cm, Left 3cm, Right 2.5cm |
| Header | Document title, right-aligned, italic, gray |
| Footer | Centered page number |
| Brand blue | `#1F4E79` (tables, cover) |
| Heading blue | `#2E5090` |
| Alternate row gray | `#F2F2F2` |

### Margin Helper

```javascript
const MARGINS = {
  top: convertMillimetersToTwip(25),
  bottom: convertMillimetersToTwip(25),
  left: convertMillimetersToTwip(30),
  right: convertMillimetersToTwip(25),
};
```

---

## Core API Quick Reference

### Document Structure

```javascript
const doc = new Document({
  numbering: { config: [/* bullet/ordered configs */] },
  sections: [{
    properties: {
      page: {
        margin: MARGINS,
        pageNumbers: { start: 1, formatType: NumberFormat.DECIMAL },
      },
    },
    headers: { default: new Header({ children: [/* paragraphs */] }) },
    footers: { default: new Footer({ children: [/* paragraphs */] }) },
    children: [/* Paragraph, Table, etc. */],
  }],
});
```

### Paragraph & TextRun

```javascript
// Body text
new Paragraph({
  spacing: { after: 120, line: 360 },
  children: [new TextRun({ text: "Body text", size: 22, font: "Calibri" })],
})

// Heading
new Paragraph({
  heading: HeadingLevel.HEADING_2,
  spacing: { before: 360, after: 120 },
  children: [new TextRun({ text: "Section Title", bold: true, size: 32, color: "2E5090", font: "Calibri" })],
})
```

### Lists (NEVER use unicode bullets)

```javascript
// Define in Document numbering config:
numbering: {
  config: [
    {
      reference: "bullet-list",
      levels: [{
        level: 0, format: LevelFormat.BULLET, text: "\u2022",
        alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: convertMillimetersToTwip(10), hanging: convertMillimetersToTwip(5) } } },
      }],
    },
    {
      reference: "ordered-list",
      levels: [{
        level: 0, format: LevelFormat.DECIMAL, text: "%1.",
        alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: convertMillimetersToTwip(10), hanging: convertMillimetersToTwip(5) } } },
      }],
    },
  ],
}

// Use in paragraphs:
new Paragraph({
  numbering: { reference: "bullet-list", level: 0 },
  children: [new TextRun({ text: "Bullet item", size: 22, font: "Calibri" })],
})
```

---

## Table Styling

IliaGPT tables use blue headers with white text, alternating gray rows, and thin borders.

```javascript
const BLUE = "1F4E79";
const ALT_GRAY = "F2F2F2";

function thinBorder(color = "CCCCCC") {
  const side = { style: BorderStyle.SINGLE, size: 1, color };
  return { top: side, bottom: side, left: side, right: side };
}

// Header row
new TableRow({
  tableHeader: true,
  children: headers.map(h =>
    new TableCell({
      shading: { type: ShadingType.CLEAR, fill: BLUE },
      borders: thinBorder(BLUE),
      children: [new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: h, bold: true, size: 20, color: "FFFFFF", font: "Calibri" })],
      })],
    })
  ),
})

// Data rows (with alternating shading)
rows.map((row, idx) =>
  new TableRow({
    children: row.map(cell =>
      new TableCell({
        shading: idx % 2 === 1 ? { type: ShadingType.CLEAR, fill: ALT_GRAY } : undefined,
        borders: thinBorder(),
        children: [new Paragraph({
          children: [new TextRun({ text: String(cell), size: 20, font: "Calibri" })],
        })],
      })
    ),
  })
)

// Full table
new Table({
  width: { size: 100, type: WidthType.PERCENTAGE },
  rows: [headerRow, ...dataRows],
})
```

> **CRITICAL**: Always use `ShadingType.CLEAR`, never `SOLID` (causes black backgrounds).

---

## Headers & Footers with Page Numbers

```javascript
headers: {
  default: new Header({
    children: [new Paragraph({
      alignment: AlignmentType.RIGHT,
      children: [new TextRun({ text: title, italics: true, size: 18, color: "999999", font: "Calibri" })],
    })],
  }),
},
footers: {
  default: new Footer({
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ children: [PageNumber.CURRENT], size: 18, color: "999999" })],
    })],
  }),
},
```

---

## Saving the File

Always end generated code with `saveFile()`:

```javascript
const buffer = await Packer.toBuffer(doc);
saveFile("report_title.docx", buffer);
```

The `saveFile(filename, buffer)` function is provided by the IliaGPT sandbox. It registers the file for download and returns it to the user.

---

## Complete Templates

### Template 1: Simple Report

```javascript
const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell,
  Header, Footer, PageNumber, BorderStyle, ShadingType, WidthType, AlignmentType,
  PageBreak, LevelFormat, NumberFormat, convertMillimetersToTwip } = require("docx");

const BLUE = "1F4E79";
const HEADING_BLUE = "2E5090";
const ALT_GRAY = "F2F2F2";
const title = "Quarterly Sales Report";

function thinBorder(c = "CCCCCC") {
  const s = { style: BorderStyle.SINGLE, size: 1, color: c };
  return { top: s, bottom: s, left: s, right: s };
}

const coverPage = [
  new Paragraph({ spacing: { before: 4000 } }),
  new Paragraph({ alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: title, bold: true, size: 56, color: BLUE, font: "Calibri" })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 400 },
    children: [new TextRun({ text: new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
      size: 22, color: "888888", font: "Calibri", italics: true })] }),
  new Paragraph({ children: [new PageBreak()] }),
];

const body = [
  new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 360, after: 120 },
    children: [new TextRun({ text: "Executive Summary", bold: true, size: 32, color: HEADING_BLUE, font: "Calibri" })] }),
  new Paragraph({ spacing: { after: 120, line: 360 },
    children: [new TextRun({ text: "This quarter showed strong growth across all product lines...", size: 22, font: "Calibri" })] }),
];

const doc = new Document({
  numbering: { config: [
    { reference: "bullet-list", levels: [{ level: 0, format: LevelFormat.BULLET, text: "\u2022",
      alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: convertMillimetersToTwip(10), hanging: convertMillimetersToTwip(5) } } } }] },
  ]},
  sections: [{
    properties: {
      page: { margin: { top: convertMillimetersToTwip(25), bottom: convertMillimetersToTwip(25),
        left: convertMillimetersToTwip(30), right: convertMillimetersToTwip(25) },
        pageNumbers: { start: 1, formatType: NumberFormat.DECIMAL } },
    },
    headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT,
      children: [new TextRun({ text: title, italics: true, size: 18, color: "999999", font: "Calibri" })] })] }) },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER,
      children: [new TextRun({ children: [PageNumber.CURRENT], size: 18, color: "999999" })] })] }) },
    children: [...coverPage, ...body],
  }],
});

const buffer = await Packer.toBuffer(doc);
saveFile("quarterly_sales_report.docx", buffer);
```

### Template 2: Academic Paper

```javascript
const { Document, Packer, Paragraph, TextRun, HeadingLevel, Header, Footer, PageNumber,
  AlignmentType, NumberFormat, convertMillimetersToTwip, LevelFormat } = require("docx");

const doc = new Document({
  styles: {
    default: { document: { run: { font: "Times New Roman", size: 24 } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 28, bold: true, font: "Times New Roman" },
        paragraph: { spacing: { before: 360, after: 240 }, alignment: AlignmentType.CENTER } },
    ],
  },
  numbering: { config: [
    { reference: "refs", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "[%1]",
      alignment: AlignmentType.LEFT,
      style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
  ]},
  sections: [{
    properties: {
      page: {
        margin: { top: convertMillimetersToTwip(25), bottom: convertMillimetersToTwip(25),
          left: convertMillimetersToTwip(30), right: convertMillimetersToTwip(25) },
        pageNumbers: { start: 1, formatType: NumberFormat.DECIMAL },
      },
    },
    headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT,
      children: [new TextRun({ text: "Running Head: RESEARCH TITLE", size: 20, font: "Times New Roman", italics: true })] })] }) },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER,
      children: [new TextRun({ children: [PageNumber.CURRENT], size: 20 })] })] }) },
    children: [
      new Paragraph({ spacing: { before: 2000 }, alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: "Research Paper Title", bold: true, size: 32, font: "Times New Roman" })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 400 },
        children: [new TextRun({ text: "Author Name\nUniversity Name", size: 24, font: "Times New Roman" })] }),
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Abstract")] }),
      new Paragraph({ spacing: { after: 120, line: 480 },
        children: [new TextRun({ text: "Abstract content here...", size: 24, font: "Times New Roman" })] }),
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Introduction")] }),
      new Paragraph({ spacing: { after: 120, line: 480 },
        children: [new TextRun({ text: "Introduction content...", size: 24, font: "Times New Roman" })] }),
    ],
  }],
});

const buffer = await Packer.toBuffer(doc);
saveFile("research_paper.docx", buffer);
```

### Template 3: Business Letter

```javascript
const { Document, Packer, Paragraph, TextRun, AlignmentType, convertMillimetersToTwip } = require("docx");

const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

const doc = new Document({
  sections: [{
    properties: {
      page: { margin: { top: convertMillimetersToTwip(25), bottom: convertMillimetersToTwip(25),
        left: convertMillimetersToTwip(30), right: convertMillimetersToTwip(25) } },
    },
    children: [
      new Paragraph({ spacing: { after: 200 },
        children: [new TextRun({ text: "Company Name, Inc.", bold: true, size: 28, color: "1F4E79", font: "Calibri" })] }),
      new Paragraph({ spacing: { after: 100 },
        children: [new TextRun({ text: "123 Business Ave, Suite 100\nCity, State ZIP", size: 20, font: "Calibri", color: "666666" })] }),
      new Paragraph({ spacing: { before: 400, after: 400 },
        children: [new TextRun({ text: today, size: 22, font: "Calibri" })] }),
      new Paragraph({ children: [new TextRun({ text: "Dear Recipient,", size: 22, font: "Calibri" })] }),
      new Paragraph({ spacing: { before: 200, after: 200, line: 360 },
        children: [new TextRun({ text: "Letter body paragraph here...", size: 22, font: "Calibri" })] }),
      new Paragraph({ spacing: { before: 400 },
        children: [new TextRun({ text: "Sincerely,", size: 22, font: "Calibri" })] }),
      new Paragraph({ spacing: { before: 600 },
        children: [new TextRun({ text: "Your Name\nTitle", bold: true, size: 22, font: "Calibri" })] }),
    ],
  }],
});

const buffer = await Packer.toBuffer(doc);
saveFile("business_letter.docx", buffer);
```

---

## Critical Rules

1. **Never use `\n` inside TextRun** for line breaks -- use separate `Paragraph` elements.
2. **Never use unicode bullets** (`\u2022` in TextRun text) -- use `LevelFormat.BULLET` with numbering config.
3. **PageBreak must be inside a Paragraph** -- `new Paragraph({ children: [new PageBreak()] })`.
4. **Always use `ShadingType.CLEAR`** -- never `SOLID` (renders black backgrounds).
5. **ImageRun requires `type`** -- always specify `"png"`, `"jpg"`, etc.
6. **Table of Contents** requires `HeadingLevel` only -- no custom styles.
7. **Include `outlineLevel`** in custom heading styles -- required for TOC (0 for H1, 1 for H2).
8. **Font sizes are in half-points** -- 22 = 11pt, 24 = 12pt, 32 = 16pt.
9. **Always call `saveFile()`** at the end of generated code.
10. **Professional colors**: Brand blue `#1F4E79`, heading blue `#2E5090`, accent `#E8532E`.
