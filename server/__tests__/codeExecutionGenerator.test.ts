import { describe, it, expect } from "vitest";

describe("code execution document generator", () => {
  it("executes PptxGenJS code and produces .pptx file", async () => {
    const { executeDocumentCode } = await import("../services/documentGenerators/codeExecutionGenerator");
    const code = `
const PptxGenJS = require("pptxgenjs");
const pptx = new PptxGenJS();
pptx.layout = "LAYOUT_WIDE";
const slide = pptx.addSlide();
slide.background = { fill: "1F4E79" };
slide.addText("Test Presentation", { x: 1, y: 2, w: 8, h: 1.5, fontSize: 36, color: "FFFFFF", bold: true, align: "center" });
const buffer = await pptx.write({ outputType: "nodebuffer" });
saveFile("test_presentation.pptx", buffer);
`;
    const result = await executeDocumentCode(code);
    expect(result.error).toBeUndefined();
    expect(result.files.length).toBe(1);
    expect(result.files[0].filename).toContain(".pptx");
    expect(result.files[0].buffer.length).toBeGreaterThan(5000);
    expect(result.files[0].downloadUrl).toContain("/download");
    expect(result.output).toContain("Saved");
  });

  it("executes ExcelJS code and produces .xlsx file", async () => {
    const { executeDocumentCode } = await import("../services/documentGenerators/codeExecutionGenerator");
    const code = `
const ExcelJS = require("exceljs");
const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet("Datos");
ws.columns = [
  { header: "Producto", key: "product", width: 20 },
  { header: "Ventas", key: "sales", width: 15 },
];
ws.addRow({ product: "Widget A", sales: 1500 });
ws.addRow({ product: "Widget B", sales: 2300 });
ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E79" } };
const buffer = await wb.xlsx.writeBuffer();
saveFile("datos_ventas.xlsx", Buffer.from(buffer));
`;
    const result = await executeDocumentCode(code);
    expect(result.error).toBeUndefined();
    expect(result.files.length).toBe(1);
    expect(result.files[0].filename).toContain(".xlsx");
    expect(result.files[0].buffer.length).toBeGreaterThan(1000);
  });

  it("executes docx code and produces .docx file", async () => {
    const { executeDocumentCode } = await import("../services/documentGenerators/codeExecutionGenerator");
    const code = `
const { Document, Packer, Paragraph, HeadingLevel } = require("docx");
const doc = new Document({
  sections: [{
    children: [
      new Paragraph({ text: "Test Document", heading: HeadingLevel.HEADING_1 }),
      new Paragraph({ text: "This is a professional document generated with code." }),
    ]
  }]
});
const buffer = await Packer.toBuffer(doc);
saveFile("documento_test.docx", buffer);
`;
    const result = await executeDocumentCode(code);
    expect(result.error).toBeUndefined();
    expect(result.files.length).toBe(1);
    expect(result.files[0].filename).toContain(".docx");
    expect(result.files[0].buffer.length).toBeGreaterThan(1000);
  });

  it("blocks unauthorized modules", async () => {
    const { executeDocumentCode } = await import("../services/documentGenerators/codeExecutionGenerator");
    const code = `const http = require("http"); console.log(http);`;
    const result = await executeDocumentCode(code);
    expect(result.error).toBeDefined();
  });

  it("handles code errors gracefully", async () => {
    const { executeDocumentCode } = await import("../services/documentGenerators/codeExecutionGenerator");
    const code = `throw new Error("intentional error");`;
    const result = await executeDocumentCode(code);
    expect(result.error).toContain("intentional error");
  });

  it("exports getDocumentCodePrompt", async () => {
    const { getDocumentCodePrompt } = await import("../services/documentGenerators/codeExecutionGenerator");
    const prompt = getDocumentCodePrompt("es");
    expect(prompt).toContain("pptxgenjs");
    expect(prompt).toContain("docx");
    expect(prompt).toContain("exceljs");
    expect(prompt).toContain("saveFile");
  });
});
