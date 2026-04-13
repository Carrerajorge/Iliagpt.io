import { describe, it, expect, beforeAll } from "vitest";
import JSZip from "jszip";
import ExcelJS from "exceljs";
import { Document, Packer, Paragraph, Table, TableCell, TableRow, HeadingLevel } from "docx";
import PDFDocument from "pdfkit";

import { buildSeedXlsxFromObjective } from "../lib/office/engine/xlsxCreateFromSpec";
import { ProfessionalFileGenerator } from "../services/skillHandlers/professionalFileGenerator";
import { generateProfessionalPptx } from "../services/documentGenerators/professionalPptxGenerator";

const generator = new ProfessionalFileGenerator();

async function zipEntries(buffer: Buffer): Promise<string[]> {
  const zip = await JSZip.loadAsync(buffer);
  return Object.keys(zip.files);
}

async function zipText(buffer: Buffer, fileName: string): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const file = zip.file(fileName);
  if (!file) throw new Error(`Missing ZIP entry: ${fileName}`);
  return file.async("string");
}

function buildPdfBuffer(): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48, compress: false });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(18).text("Reporte financiero trimestral", { underline: true });
    doc.moveDown();
    doc.fontSize(12).text("Encabezado ejecutivo");
    doc.text("Q1 Revenue | Q1 Costs | Q1 Margin");
    doc.text("120000 | 80000 | 40000");
    doc.text("Q2 Revenue | Q2 Costs | Q2 Margin");
    doc.text("140000 | 91000 | 49000");
    doc.addPage();
    doc.text("Footer y resumen");
    doc.text("Page 2");
    doc.end();
  });
}

function decodePdfHexText(buffer: Buffer): string {
  const raw = buffer.toString("latin1");
  return [...raw.matchAll(/<([0-9A-Fa-f]+)>/g)]
    .map((match) => {
      try {
        return Buffer.from(match[1], "hex").toString("latin1");
      } catch {
        return "";
      }
    })
    .join(" ");
}

describe("professional document generation e2e", () => {
  let excelBuffer: Buffer;
  let wordBuffer: Buffer;
  let pptBuffer: Buffer;
  let pdfBuffer: Buffer;
  let csvBuffer: Buffer;

  beforeAll(async () => {
    excelBuffer = (await buildSeedXlsxFromObjective("Crea un Excel con datos de ventas mensuales, incluye fórmulas SUM y formato condicional con chart")).buffer;
    const wordResult = await generator.generateWord({
      title: "Documento Profesional IA",
      style: "formal",
      sections: [
        { heading: "Resumen Ejecutivo", content: "Contenido principal del reporte.", level: 1 },
        { heading: "Hallazgos", content: "Detalle técnico y conclusiones.", level: 2 },
        { heading: "Recomendaciones", content: "Siguientes pasos sugeridos.", level: 3 },
        { heading: "Apéndice", content: "Información adicional.", level: 1 },
      ],
    });
    wordBuffer = "buffer" in wordResult ? wordResult.buffer : wordResult;
    const pptResult = await generateProfessionalPptx({
      title: "Cambio Climático",
      subtitle: "Presentación ejecutiva",
      theme: "corporate-blue",
      slides: [
        { type: "title", title: "Cambio Climático", subtitle: "Resumen" },
        { type: "content", title: "Resumen ejecutivo", bullets: ["Contexto", "Impacto", "Respuesta"] },
        { type: "content", title: "Indicadores", bullets: ["Temperatura", "Emisiones", "Riesgo"] },
        { type: "content", title: "Plan", bullets: ["Mitigar", "Adaptar", "Medir"] },
        { type: "table", title: "Tabla", tableData: { headers: ["Métrica", "Valor"], rows: [["CO2", "420ppm"], ["ΔT", "+1.2C"]] } },
        { type: "two-column", title: "Riesgos y oportunidades", leftBullets: ["Riesgo 1", "Riesgo 2"], rightBullets: ["Oportunidad 1", "Oportunidad 2"] },
        { type: "content", title: "Roadmap", bullets: ["2026", "2027", "2028"] },
        { type: "closing", title: "Cierre", subtitle: "Acción inmediata" },
      ],
    });
    pptBuffer = pptResult.buffer;
    pdfBuffer = await buildPdfBuffer();
    const csvResult = await generator.generateCSV({
      title: "productos",
      headers: ["SKU", "Producto", "Precio"],
      rows: Array.from({ length: 50 }, (_, index) => [`SKU-${index + 1}`, `Producto ${index + 1}`, (index + 1) * 10]),
    });
    csvBuffer = csvResult.buffer;
  });

  it("generates a valid XLSX buffer with PK magic bytes", () => {
    expect(excelBuffer.subarray(0, 2).toString("utf8")).toBe("PK");
  });

  it("generated XLSX contains worksheet xml", async () => {
    const entries = await zipEntries(excelBuffer);
    expect(entries).toContain("xl/worksheets/sheet1.xml");
  });

  it("generated XLSX contains multiple worksheets", async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(excelBuffer);
    expect(workbook.worksheets.length).toBeGreaterThan(1);
  });

  it("generated XLSX contains conditional formatting", async () => {
    const entries = await zipEntries(excelBuffer);
    const worksheetXml = await Promise.all(
      entries.filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name)).map((name) => zipText(excelBuffer, name)),
    );
    expect(worksheetXml.some((xml) => xml.includes("conditionalFormatting"))).toBe(true);
  });

  it("generated XLSX contains chart parts", async () => {
    const entries = await zipEntries(excelBuffer);
    expect(entries.some((name) => name.startsWith("xl/charts/"))).toBe(true);
  });

  it("generates a valid DOCX buffer with PK magic bytes", () => {
    expect(wordBuffer.subarray(0, 2).toString("utf8")).toBe("PK");
  });

  it("generated DOCX contains word/document.xml", async () => {
    const entries = await zipEntries(wordBuffer);
    expect(entries).toContain("word/document.xml");
  });

  it("generated DOCX contains heading styles", async () => {
    const xml = await zipText(wordBuffer, "word/document.xml");
    expect(xml.includes("w:pStyle") || xml.includes("Heading1")).toBe(true);
  });

  it("generated DOCX contains header xml", async () => {
    const entries = await zipEntries(wordBuffer);
    expect(entries.some((name) => name.startsWith("word/header"))).toBe(true);
  });

  it("generated DOCX contains footer xml", async () => {
    const entries = await zipEntries(wordBuffer);
    expect(entries.some((name) => name.startsWith("word/footer"))).toBe(true);
  });

  it("docx library can produce table markup for professional table documents", async () => {
    const doc = new Document({
      sections: [{
        children: [
          new Paragraph({ text: "Tabla", heading: HeadingLevel.HEADING_1 }),
          new Table({
            rows: [
              new TableRow({ children: [new TableCell({ children: [new Paragraph("A")] }), new TableCell({ children: [new Paragraph("B")] })] }),
              new TableRow({ children: [new TableCell({ children: [new Paragraph("1")] }), new TableCell({ children: [new Paragraph("2")] })] }),
            ],
          }),
        ],
      }],
    });
    const buffer = await Packer.toBuffer(doc);
    const xml = await zipText(buffer, "word/document.xml");
    expect(xml).toContain("w:tbl");
  });

  it("generates a valid PPTX buffer with PK magic bytes", () => {
    expect(pptBuffer.subarray(0, 2).toString("utf8")).toBe("PK");
  });

  it("generated PPTX contains first slide xml", async () => {
    const entries = await zipEntries(pptBuffer);
    expect(entries).toContain("ppt/slides/slide1.xml");
  });

  it("generated PPTX contains 8 slides", async () => {
    const entries = await zipEntries(pptBuffer);
    const slideEntries = entries.filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
    expect(slideEntries).toHaveLength(8);
  });

  it("generated PPTX contains titles and bullets in slide xml", async () => {
    const xml = await zipText(pptBuffer, "ppt/slides/slide2.xml");
    expect(xml).toContain("Resumen ejecutivo");
    expect(xml).toContain("Contexto");
  });

  it("generated PPTX contains theme and slideLayouts", async () => {
    const entries = await zipEntries(pptBuffer);
    expect(entries).toContain("ppt/theme/theme1.xml");
    expect(entries.some((name) => name.startsWith("ppt/slideLayouts/"))).toBe(true);
  });

  it("generates a valid PDF buffer with %PDF magic bytes", () => {
    expect(pdfBuffer.subarray(0, 4).toString("utf8")).toBe("%PDF");
  });

  it("generated PDF has multiple pages", async () => {
    const text = pdfBuffer.toString("latin1");
    const pageMatches = text.match(/\/Type\s*\/Page\b/g) || [];
    expect(pageMatches.length).toBeGreaterThan(1);
  });

  it("generated PDF contains table-like financial content", async () => {
    const decoded = decodePdfHexText(pdfBuffer);
    const normalized = decoded.replace(/\s+/g, "");
    expect(normalized).toContain("Q1Revenue");
    expect(normalized).toContain("120000");
  });

  it("generated CSV is plain text with commas and headers", () => {
    const text = csvBuffer.toString("utf8");
    expect(text).toContain("SKU,Producto,Precio");
    expect(text).toContain("Producto 50");
  });
});
