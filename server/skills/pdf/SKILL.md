# IliaGPT PDF Document Generation Skill

## Overview

Generate professional `.pdf` files using the `pdfkit` library (PDFKit). All code runs in the IliaGPT sandbox VM with `require("pdfkit")` available. Call `saveFile(filename, buffer)` to emit the file.

## Decision Tree

| Task | Approach |
|------|----------|
| Create new PDF | `pdfkit` library (this guide) |
| Edit existing PDF | Use `pdf-lib` to load and modify |
| Extract text from PDF | Use `pdf-parse` or `pdfjs-dist` |

For **new documents**, always use PDFKit. Never manipulate raw PDF streams for new files.

---

## Setup & Boilerplate

```javascript
const PDFDocument = require("pdfkit");

const doc = new PDFDocument({
  size: "A4",           // 595.28 x 841.89 pt
  margins: { top: 72, bottom: 72, left: 72, right: 72 },
  info: {
    Title: "Document Title",
    Author: "IliaGPT",
    Creator: "IliaGPT PDF Skill",
  },
  bufferPages: true,    // Required for adding page numbers after content
});

const chunks = [];
doc.on("data", (chunk) => chunks.push(chunk));
doc.on("end", () => {
  const buffer = Buffer.concat(chunks);
  saveFile("document.pdf", buffer);
});

// ... add content ...

doc.end();
```

**Always end every script by calling `doc.end()` and `saveFile()` inside the `"end"` event.**

---

## Page Dimensions

| Size | Width (pt) | Height (pt) |
|------|-----------|-------------|
| A4 | 595.28 | 841.89 |
| Letter | 612 | 792 |
| Legal | 612 | 1008 |

Default: A4 with 72pt (1 inch) margins on all sides. Usable width: **451.28pt**.

---

## Design Rules

All IliaGPT PDFs follow these defaults unless the user specifies otherwise:

| Property | Value |
|----------|-------|
| Body font | Helvetica 11pt |
| Heading 1 | Helvetica-Bold 18pt, color `#1F4E79` |
| Heading 2 | Helvetica-Bold 14pt, color `#2E5090` |
| Body color | `#333333` |
| Line height | 1.5 (lineGap: 6) |
| Page margins | 72pt all sides |
| Header line | 0.5pt gray at y=55 |
| Footer | Page number centered at bottom |
| Brand blue | `#1F4E79` |
| Heading blue | `#2E5090` |
| Accent | `#E8532E` |
| Table header bg | `#1F4E79` with white text |
| Alt row gray | `#F2F2F2` |

---

## PDFKit API Reference

### Text

```javascript
// Basic text
doc.fontSize(11).fillColor("#333333").text("Body paragraph text.", {
  width: 451.28,
  lineGap: 6,
  align: "justify",
});

// Bold text
doc.font("Helvetica-Bold").fontSize(18).fillColor("#1F4E79")
   .text("Section Heading");
doc.font("Helvetica").fontSize(11).fillColor("#333333"); // Reset

// Italic
doc.font("Helvetica-Oblique").text("Italic text");

// Positioned text
doc.text("Specific position", 72, 200, { width: 451.28 });

// Text options
doc.text("Content", {
  width: 451.28,
  align: "left",       // "left" | "center" | "right" | "justify"
  lineGap: 6,          // Extra space between lines
  paragraphGap: 12,    // Extra space after paragraph
  indent: 20,          // First-line indent
  continued: true,     // Continue on same line (for inline formatting)
});
```

### Available Fonts (built-in, no embedding needed)

- `Helvetica`, `Helvetica-Bold`, `Helvetica-Oblique`, `Helvetica-BoldOblique`
- `Times-Roman`, `Times-Bold`, `Times-Italic`, `Times-BoldItalic`
- `Courier`, `Courier-Bold`, `Courier-Oblique`, `Courier-BoldOblique`

### Shapes & Lines

```javascript
// Horizontal rule
doc.moveTo(72, doc.y).lineTo(523.28, doc.y)
   .strokeColor("#CCCCCC").lineWidth(0.5).stroke();

// Filled rectangle
doc.rect(72, 100, 451.28, 40).fill("#1F4E79");

// Rectangle with stroke
doc.rect(72, 100, 451.28, 40)
   .fillAndStroke("#F2F2F2", "#CCCCCC");

// Circle
doc.circle(300, 400, 50).fill("#2E5090");

// Rounded rectangle
doc.roundedRect(72, 100, 200, 80, 8).fill("#F8F9FA");
```

### Images

```javascript
// From file path
doc.image("chart.png", 72, doc.y, { width: 451.28 });

// From buffer
doc.image(imageBuffer, 72, doc.y, { width: 300, height: 200 });

// Fit within bounds (preserves aspect ratio)
doc.image("photo.jpg", 72, doc.y, { fit: [451.28, 300], align: "center" });
```

### Lists

```javascript
// Bullet list
const bullets = ["First point", "Second point", "Third point"];
bullets.forEach((item) => {
  doc.fontSize(11).fillColor("#333333")
     .text(`\u2022  ${item}`, 90, doc.y, {
       width: 433.28,
       lineGap: 4,
     });
  doc.moveDown(0.3);
});

// Numbered list
const items = ["Step one", "Step two", "Step three"];
items.forEach((item, i) => {
  doc.fontSize(11).fillColor("#333333")
     .text(`${i + 1}.  ${item}`, 90, doc.y, {
       width: 433.28,
       lineGap: 4,
     });
  doc.moveDown(0.3);
});
```

### Page Breaks & Navigation

```javascript
doc.addPage();                    // New page with same options
doc.addPage({ size: "Letter" }); // New page with different size
doc.moveDown(2);                  // Move cursor down 2 lines
doc.y;                            // Current Y position
doc.x;                            // Current X position
doc.page.width;                   // Current page width
doc.page.height;                  // Current page height
```

### Page Numbers (add after all content)

```javascript
// Add page numbers to all pages (requires bufferPages: true)
const range = doc.bufferedPageRange();
for (let i = range.start; i < range.start + range.count; i++) {
  doc.switchToPage(i);
  doc.fontSize(9).fillColor("#999999")
     .text(`${i + 1}`, 0, doc.page.height - 50, {
       width: doc.page.width,
       align: "center",
     });
}
```

---

## Tables (Manual Drawing)

PDFKit has no built-in table API. Draw tables manually:

```javascript
function drawTable(doc, startX, startY, headers, rows, colWidths) {
  const rowHeight = 25;
  const totalWidth = colWidths.reduce((a, b) => a + b, 0);
  let y = startY;

  // Header row background
  doc.rect(startX, y, totalWidth, rowHeight).fill("#1F4E79");

  // Header text
  let x = startX;
  headers.forEach((header, i) => {
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#FFFFFF")
       .text(header, x + 5, y + 7, { width: colWidths[i] - 10, align: "left" });
    x += colWidths[i];
  });
  y += rowHeight;

  // Data rows
  rows.forEach((row, ri) => {
    // Alternating row background
    if (ri % 2 === 1) {
      doc.rect(startX, y, totalWidth, rowHeight).fill("#F2F2F2");
    }

    // Row borders
    doc.rect(startX, y, totalWidth, rowHeight)
       .strokeColor("#CCCCCC").lineWidth(0.5).stroke();

    // Cell text
    x = startX;
    row.forEach((cell, ci) => {
      doc.font("Helvetica").fontSize(10).fillColor("#333333")
         .text(String(cell), x + 5, y + 7, { width: colWidths[ci] - 10, align: "left" });
      x += colWidths[ci];
    });
    y += rowHeight;
  });

  // Return final Y position for content below the table
  return y + 10;
}

// Usage:
const headers = ["Name", "Role", "Department"];
const rows = [
  ["Alice", "Engineer", "Product"],
  ["Bob", "Designer", "UX"],
  ["Carol", "Manager", "Operations"],
];
const nextY = drawTable(doc, 72, doc.y, headers, rows, [180, 140, 131.28]);
```

---

## Code Templates

### Cover Page

```javascript
// Dark cover page
doc.rect(0, 0, 595.28, 841.89).fill("#1F4E79");

// Title
doc.font("Helvetica-Bold").fontSize(36).fillColor("#FFFFFF")
   .text("Document Title", 72, 300, { width: 451.28, align: "center" });

// Horizontal rule
doc.moveTo(197, 360).lineTo(398, 360)
   .strokeColor("#FFFFFF").lineWidth(1).stroke();

// Author & date
doc.font("Helvetica").fontSize(14).fillColor("#CADCFC")
   .text("Prepared by IliaGPT", 72, 380, { width: 451.28, align: "center" });
doc.fontSize(12).fillColor("#CADCFC")
   .text(new Date().toLocaleDateString("en-US", {
     year: "numeric", month: "long", day: "numeric",
   }), 72, 410, { width: 451.28, align: "center" });

doc.addPage();
```

### Section Heading

```javascript
function addHeading(doc, text, level = 1) {
  const config = level === 1
    ? { size: 18, color: "#1F4E79", font: "Helvetica-Bold", spaceBefore: 20, spaceAfter: 10 }
    : { size: 14, color: "#2E5090", font: "Helvetica-Bold", spaceBefore: 16, spaceAfter: 8 };

  doc.moveDown(config.spaceBefore / 11);
  doc.font(config.font).fontSize(config.size).fillColor(config.color)
     .text(text, { width: 451.28 });
  doc.moveDown(config.spaceAfter / 11);

  // Underline for H1
  if (level === 1) {
    doc.moveTo(72, doc.y - 4).lineTo(523.28, doc.y - 4)
       .strokeColor("#CCCCCC").lineWidth(0.5).stroke();
    doc.moveDown(0.5);
  }

  // Reset to body style
  doc.font("Helvetica").fontSize(11).fillColor("#333333");
}
```

### Complete Professional Report

```javascript
const PDFDocument = require("pdfkit");

const BLUE = "#1F4E79";
const HEADING_BLUE = "#2E5090";
const BODY_COLOR = "#333333";
const PAGE_WIDTH = 595.28;
const MARGIN = 72;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

const doc = new PDFDocument({
  size: "A4",
  margins: { top: 72, bottom: 72, left: 72, right: 72 },
  info: { Title: "Professional Report", Author: "IliaGPT" },
  bufferPages: true,
});

const chunks = [];
doc.on("data", (chunk) => chunks.push(chunk));
doc.on("end", () => {
  const buffer = Buffer.concat(chunks);
  saveFile("professional_report.pdf", buffer);
});

// --- Cover page ---
doc.rect(0, 0, PAGE_WIDTH, 841.89).fill(BLUE);
doc.font("Helvetica-Bold").fontSize(36).fillColor("#FFFFFF")
   .text("Professional Report", MARGIN, 300, { width: CONTENT_WIDTH, align: "center" });
doc.moveTo(197, 355).lineTo(398, 355).strokeColor("#FFFFFF").lineWidth(1).stroke();
doc.font("Helvetica").fontSize(14).fillColor("#CADCFC")
   .text("Prepared by IliaGPT", MARGIN, 375, { width: CONTENT_WIDTH, align: "center" });
doc.fontSize(12)
   .text(new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
     MARGIN, 400, { width: CONTENT_WIDTH, align: "center" });

// --- Content pages ---
doc.addPage();
doc.font("Helvetica-Bold").fontSize(18).fillColor(BLUE).text("Executive Summary");
doc.moveTo(MARGIN, doc.y + 4).lineTo(MARGIN + CONTENT_WIDTH, doc.y + 4)
   .strokeColor("#CCCCCC").lineWidth(0.5).stroke();
doc.moveDown(0.8);
doc.font("Helvetica").fontSize(11).fillColor(BODY_COLOR)
   .text("This report provides a comprehensive analysis of key findings and recommendations.", {
     width: CONTENT_WIDTH, lineGap: 6, align: "justify",
   });
doc.moveDown(1.5);

doc.font("Helvetica-Bold").fontSize(14).fillColor(HEADING_BLUE).text("Key Metrics");
doc.moveDown(0.5);

// Table
const headers = ["Metric", "Q1", "Q2", "Q3"];
const rows = [
  ["Revenue", "$1.2M", "$1.5M", "$1.8M"],
  ["Users", "12,400", "15,800", "19,200"],
  ["NPS Score", "72", "76", "81"],
];
const colWidths = [160, 97, 97, 97.28];

let tableY = doc.y;
const rowH = 25;
const totalW = colWidths.reduce((a, b) => a + b, 0);

// Header
doc.rect(MARGIN, tableY, totalW, rowH).fill(BLUE);
let cx = MARGIN;
headers.forEach((h, i) => {
  doc.font("Helvetica-Bold").fontSize(10).fillColor("#FFFFFF")
     .text(h, cx + 5, tableY + 7, { width: colWidths[i] - 10 });
  cx += colWidths[i];
});
tableY += rowH;

// Rows
rows.forEach((row, ri) => {
  if (ri % 2 === 1) doc.rect(MARGIN, tableY, totalW, rowH).fill("#F2F2F2");
  doc.rect(MARGIN, tableY, totalW, rowH).strokeColor("#CCCCCC").lineWidth(0.5).stroke();
  cx = MARGIN;
  row.forEach((cell, ci) => {
    doc.font("Helvetica").fontSize(10).fillColor(BODY_COLOR)
       .text(cell, cx + 5, tableY + 7, { width: colWidths[ci] - 10 });
    cx += colWidths[ci];
  });
  tableY += rowH;
});

// --- Page numbers ---
const range = doc.bufferedPageRange();
for (let i = range.start; i < range.start + range.count; i++) {
  doc.switchToPage(i);
  if (i > 0) { // Skip cover page
    doc.fontSize(9).fillColor("#999999")
       .text(`${i}`, 0, 841.89 - 50, { width: PAGE_WIDTH, align: "center" });
  }
}

doc.end();
```

---

## Critical Rules

1. **Always use `bufferPages: true`** when you need page numbers -- it is required for `switchToPage()`.
2. **Always call `doc.end()`** -- the PDF is not valid until `end()` is called.
3. **Save via the `"end"` event** -- buffer chunks in `"data"` event, concatenate in `"end"`, then call `saveFile()`.
4. **Reset font after headings** -- PDFKit is stateful; call `doc.font("Helvetica").fontSize(11).fillColor("#333333")` after each heading.
5. **No `#` in fillColor for shapes** -- `doc.rect(...).fill("#1F4E79")` works for `.fill()` but **not** for color objects. Use consistent `"#RRGGBB"` strings with PDFKit's `.fill()` and `.fillColor()`.
6. **Check page overflow** -- if `doc.y > 750`, call `doc.addPage()` before adding more content.
7. **Built-in fonts only** unless you embed a `.ttf` file. Do not reference system fonts.
8. **Tables are manual** -- use the `drawTable()` helper above. No built-in table API.
9. **File name** must be descriptive and use snake_case (e.g., `quarterly_report_2026.pdf`).
10. **Always call `saveFile()`** at the end of generated code inside the `"end"` event handler.
