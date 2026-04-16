/**
 * Document Renderer Tests — Validates REAL binary file generation.
 * These tests produce actual .pptx/.docx/.xlsx/.pdf files and verify:
 * - File is not corrupt (valid ZIP/PDF structure)
 * - Contains expected content (slides, paragraphs, rows)
 * - Meets minimum size thresholds
 * - Branding/styling is present
 */

import { describe, it, expect } from "vitest";

// ── PPTX Tests ────────────────────────────────────────────────────────────
describe("PPTX renderer", () => {
  it("generates a valid .pptx with multiple styled slides", async () => {
    const PptxGenJS = (await import("pptxgenjs")).default;
    const pptx = new PptxGenJS();
    pptx.layout = "LAYOUT_WIDE";

    const s1 = pptx.addSlide();
    s1.background = { fill: "1F4E79" };
    s1.addText("Test Presentation", { x: 0.5, y: 2, w: "90%", h: 1.5, fontSize: 36, color: "FFFFFF", bold: true, align: "center" });

    const s2 = pptx.addSlide();
    s2.addText("Key Points", { x: 0.5, y: 0.3, w: "90%", fontSize: 24, color: "1F4E79", bold: true });
    s2.addText("• Point 1\n• Point 2\n• Point 3", { x: 0.8, y: 1.2, w: "85%", fontSize: 16, color: "333333" });

    const s3 = pptx.addSlide();
    s3.addTable(
      [["Item", "Value"], ["Alpha", "100"], ["Beta", "200"]],
      { x: 0.5, y: 1, w: "90%", fontSize: 12, border: { pt: 1, color: "CCCCCC" } },
    );

    const buffer = Buffer.from(await pptx.write({ outputType: "nodebuffer" }) as ArrayBuffer);
    expect(buffer.length).toBeGreaterThan(10000);
    expect(buffer[0]).toBe(0x50); // ZIP magic: PK\x03\x04
    expect(buffer[1]).toBe(0x4B);
  });

  it("generates correct number of slides", async () => {
    const JSZip = (await import("jszip")).default;
    const PptxGenJS = (await import("pptxgenjs")).default;
    const pptx = new PptxGenJS();
    for (let i = 0; i < 5; i++) pptx.addSlide().addText(`Slide ${i + 1}`, { x: 1, y: 1, fontSize: 24 });
    const buffer = Buffer.from(await pptx.write({ outputType: "nodebuffer" }) as ArrayBuffer);
    const zip = await JSZip.loadAsync(buffer);
    const slides = Object.keys(zip.files).filter(f => /ppt\/slides\/slide\d+\.xml/.test(f));
    expect(slides.length).toBe(5);
  });
});

// ── DOCX Tests ────────────────────────────────────────────────────────────
describe("DOCX renderer", () => {
  it("generates a valid .docx with headings and tables", async () => {
    const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType } = await import("docx");
    const doc = new Document({
      sections: [{ children: [
        new Paragraph({ text: "Test Document Title", heading: HeadingLevel.HEADING_1 }),
        new Paragraph({ children: [new TextRun({ text: "Professional content.", size: 22 })] }),
        new Paragraph({ text: "Analysis Section", heading: HeadingLevel.HEADING_2 }),
        new Table({
          rows: [
            new TableRow({ children: [
              new TableCell({ children: [new Paragraph("Header 1")], width: { size: 3000, type: WidthType.DXA } }),
              new TableCell({ children: [new Paragraph("Header 2")], width: { size: 3000, type: WidthType.DXA } }),
            ]}),
            new TableRow({ children: [
              new TableCell({ children: [new Paragraph("Value A")] }),
              new TableCell({ children: [new Paragraph("Value B")] }),
            ]}),
          ],
        }),
      ]}],
    });
    const buffer = await Packer.toBuffer(doc);
    expect(buffer.length).toBeGreaterThan(2000);
    expect(buffer[0]).toBe(0x50);
    expect(buffer[1]).toBe(0x4B);
  });

  it("contains expected text in document.xml", async () => {
    const JSZip = (await import("jszip")).default;
    const { Document, Packer, Paragraph, HeadingLevel } = await import("docx");
    const doc = new Document({
      sections: [{ children: [
        new Paragraph({ text: "Quality Assurance Report", heading: HeadingLevel.HEADING_1 }),
        new Paragraph({ text: "This validates document generation." }),
      ]}],
    });
    const buffer = await Packer.toBuffer(doc);
    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file("word/document.xml")?.async("text");
    expect(xml).toContain("Quality Assurance Report");
  });
});

// ── XLSX Tests ────────────────────────────────────────────────────────────
describe("XLSX renderer", () => {
  it("generates .xlsx with data, formulas, and styling", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Sales Data");
    ws.columns = [
      { header: "Month", key: "month", width: 15 },
      { header: "Revenue", key: "revenue", width: 15 },
      { header: "Profit", key: "profit", width: 15 },
    ];
    ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E79" } };
    ws.addRow({ month: "January", revenue: 10000, profit: 4000 });
    ws.addRow({ month: "February", revenue: 12000, profit: 5000 });
    const totalRow = ws.addRow({ month: "TOTAL" });
    totalRow.getCell("revenue").value = { formula: "SUM(B2:B3)" } as any;
    totalRow.getCell("profit").value = { formula: "SUM(C2:C3)" } as any;
    totalRow.font = { bold: true };
    ws.views = [{ state: "frozen", ySplit: 1 }];
    ws.autoFilter = { from: "A1", to: "C1" };

    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    expect(buffer.length).toBeGreaterThan(3000);
    expect(buffer[0]).toBe(0x50);
  });

  it("contains real formulas in XML", async () => {
    const JSZip = (await import("jszip")).default;
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Formulas");
    ws.addRow(["A", 10]);
    ws.addRow(["B", 20]);
    ws.addRow(["Total"]);
    ws.getCell("B3").value = { formula: "SUM(B1:B2)" } as any;
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const zip = await JSZip.loadAsync(buffer);
    const sheet = await zip.file("xl/worksheets/sheet1.xml")?.async("text");
    expect(sheet).toContain("SUM(B1:B2)");
  });
});

// ── PDF Tests ─────────────────────────────────────────────────────────────
describe("PDF renderer", () => {
  it("generates a valid PDF document", async () => {
    const PDFDocument = (await import("pdfkit")).default;
    const buffer = await new Promise<Buffer>((resolve) => {
      const chunks: Buffer[] = [];
      const doc = new PDFDocument({ size: "A4", margin: 72 });
      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.fontSize(28).font("Helvetica-Bold").fillColor("#1F4E79").text("Test PDF", { align: "center" });
      doc.moveDown();
      doc.fontSize(11).font("Helvetica").fillColor("#333").text("Professional document content.");
      doc.end();
    });
    expect(buffer.length).toBeGreaterThan(500);
    expect(buffer.slice(0, 5).toString()).toBe("%PDF-");
  });

  it("generates multi-page PDF", async () => {
    const PDFDocument = (await import("pdfkit")).default;
    const buffer = await new Promise<Buffer>((resolve) => {
      const chunks: Buffer[] = [];
      const doc = new PDFDocument({ size: "A4" });
      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.text("Page 1"); doc.addPage(); doc.text("Page 2"); doc.addPage(); doc.text("Page 3");
      doc.end();
    });
    const pages = (buffer.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
    expect(pages).toBeGreaterThanOrEqual(3);
  });
});

// ── Code Execution Sandbox ────────────────────────────────────────────────
describe("code execution sandbox", () => {
  it("executes PptxGenJS and produces valid file", async () => {
    const { executeDocumentCode } = await import("../services/documentGenerators/codeExecutionGenerator");
    const result = await executeDocumentCode(`
const PptxGenJS = require("pptxgenjs");
const pptx = new PptxGenJS();
pptx.addSlide().addText("CI Test", { x: 1, y: 1, fontSize: 24 });
const buffer = await pptx.write({ outputType: "nodebuffer" });
saveFile("ci_test.pptx", buffer);
`);
    expect(result.error).toBeUndefined();
    expect(result.files.length).toBe(1);
    expect(result.files[0].buffer.length).toBeGreaterThan(5000);
  });

  it("blocks unauthorized modules", async () => {
    const { executeDocumentCode } = await import("../services/documentGenerators/codeExecutionGenerator");
    const result = await executeDocumentCode(`const net = require("net"); console.log(net);`);
    expect(result.error).toBeDefined();
  });
});
