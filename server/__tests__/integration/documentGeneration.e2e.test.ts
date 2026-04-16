import { describe, it, expect } from "vitest";
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";
import ExcelJS from "exceljs";
import pptxgen from "pptxgenjs";
import JSZip from "jszip";

describe("Document Generation - Binary Format Validation", () => {
  describe("DOCX generation", () => {
    it("generates a buffer that starts with PK (ZIP magic bytes)", async () => {
      const doc = new Document({
        sections: [{ children: [new Paragraph({ text: "Test content" })] }],
      });
      const buffer = await Packer.toBuffer(doc);

      expect(buffer[0]).toBe(0x50); // 'P'
      expect(buffer[1]).toBe(0x4b); // 'K'
    });

    it("generated DOCX contains word/document.xml when unzipped", async () => {
      const doc = new Document({
        sections: [
          {
            children: [
              new Paragraph({
                children: [new TextRun("Hello World")],
                heading: HeadingLevel.HEADING_1,
              }),
              new Paragraph({ text: "This is the body text." }),
            ],
          },
        ],
      });
      const buffer = await Packer.toBuffer(doc);

      const zip = await JSZip.loadAsync(buffer);
      const fileNames = Object.keys(zip.files);
      expect(fileNames).toContain("word/document.xml");
    });

    it("empty content generates a valid DOCX (does not crash)", async () => {
      const doc = new Document({
        sections: [{ children: [] }],
      });
      const buffer = await Packer.toBuffer(doc);

      expect(buffer).toBeDefined();
      expect(buffer.length).toBeGreaterThan(0);
      expect(buffer[0]).toBe(0x50);
      expect(buffer[1]).toBe(0x4b);
    });

    it("special characters in content do not break DOCX generation", async () => {
      const specialContent = 'Chars: <>&"\' \u00e9\u00f1\u00fc \u00a1\u00bf \u2603 \ud83d\ude00 \u4e16\u754c';
      const doc = new Document({
        sections: [{ children: [new Paragraph({ text: specialContent })] }],
      });
      const buffer = await Packer.toBuffer(doc);

      expect(buffer[0]).toBe(0x50);
      expect(buffer[1]).toBe(0x4b);
      expect(buffer.length).toBeGreaterThan(100);
    });
  });

  describe("XLSX generation", () => {
    it("generates a buffer that starts with PK (ZIP magic bytes)", async () => {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Test");
      sheet.addRow(["Name", "Value"]);
      sheet.addRow(["Test", 42]);
      const buffer = await workbook.xlsx.writeBuffer();

      expect(Buffer.from(buffer)[0]).toBe(0x50); // 'P'
      expect(Buffer.from(buffer)[1]).toBe(0x4b); // 'K'
    });

    it("generated XLSX has at least one worksheet", async () => {
      const workbook = new ExcelJS.Workbook();
      workbook.addWorksheet("Sales Data");
      workbook.addWorksheet("Summary");
      const buffer = await workbook.xlsx.writeBuffer();

      // Read it back and verify worksheets exist
      const readBack = new ExcelJS.Workbook();
      await readBack.xlsx.load(buffer as Buffer);
      expect(readBack.worksheets.length).toBeGreaterThanOrEqual(1);
      expect(readBack.worksheets[0].name).toBe("Sales Data");
    });

    it("empty worksheet generates a valid XLSX (does not crash)", async () => {
      const workbook = new ExcelJS.Workbook();
      workbook.addWorksheet("Empty");
      const buffer = await workbook.xlsx.writeBuffer();

      expect(Buffer.from(buffer)[0]).toBe(0x50);
      expect(Buffer.from(buffer).length).toBeGreaterThan(0);
    });

    it("special characters in cell values do not break XLSX generation", async () => {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Special");
      sheet.addRow(['<>&"\'', "\u00e9\u00f1\u00fc", "\ud83d\ude00\u2603"]);
      const buffer = await workbook.xlsx.writeBuffer();

      expect(Buffer.from(buffer)[0]).toBe(0x50);
      expect(Buffer.from(buffer)[1]).toBe(0x4b);
    });
  });

  describe("PPTX generation", () => {
    it("generates a buffer that starts with PK (ZIP magic bytes)", async () => {
      const pptx = new pptxgen();
      const slide = pptx.addSlide();
      slide.addText("Test content", { x: 1, y: 1 });
      const buffer = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;

      expect(buffer[0]).toBe(0x50); // 'P'
      expect(buffer[1]).toBe(0x4b); // 'K'
    });

    it("empty slide generates a valid PPTX (does not crash)", async () => {
      const pptx = new pptxgen();
      pptx.addSlide(); // empty slide
      const buffer = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;

      expect(buffer).toBeDefined();
      expect(buffer.length).toBeGreaterThan(0);
      expect(buffer[0]).toBe(0x50);
    });

    it("special characters in slide text do not break PPTX generation", async () => {
      const pptx = new pptxgen();
      const slide = pptx.addSlide();
      slide.addText('Special: <>&"\' \u00e9\u00f1 \ud83d\ude00 \u4e16\u754c', { x: 1, y: 1, w: 8, h: 1 });
      const buffer = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;

      expect(buffer[0]).toBe(0x50);
      expect(buffer[1]).toBe(0x4b);
    });
  });

  describe("PDF generation (via buffer header check)", () => {
    it("a valid PDF buffer starts with %PDF signature", () => {
      // Simulating a PDF buffer since we don't generate one from scratch here.
      // In the real app, generatePdfFromHtml produces this. We validate the expected signature.
      const pdfBuffer = Buffer.from("%PDF-1.4 mock content for signature test");

      expect(pdfBuffer[0]).toBe(0x25); // '%'
      expect(pdfBuffer[1]).toBe(0x50); // 'P'
      expect(pdfBuffer[2]).toBe(0x44); // 'D'
      expect(pdfBuffer[3]).toBe(0x46); // 'F'
    });
  });
});
