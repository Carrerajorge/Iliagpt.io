import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import * as fs from "fs";
import * as path from "path";
import PDFDocument from "pdfkit";

import { createRegistryRouter } from "../routes/registryRouter";
import { buildSeedXlsxFromObjective } from "../lib/office/engine/xlsxCreateFromSpec";
import { ProfessionalFileGenerator } from "../services/skillHandlers/professionalFileGenerator";
import { generateProfessionalPptx } from "../services/documentGenerators/professionalPptxGenerator";

const ARTIFACTS_DIR = path.join(process.cwd(), "artifacts");
const generator = new ProfessionalFileGenerator();

function pdfBuffer(): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ compress: false });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.text("PDF preview test");
    doc.end();
  });
}

describe("artifact download endpoints", () => {
  const files: Record<string, string> = {};
  const createdPaths: string[] = [];
  const app = express();
  app.use("/api", createRegistryRouter());

  async function getBinary(url: string): Promise<Buffer> {
    const res = await request(app)
      .get(url)
      .buffer(true)
      .parse((incoming, callback) => {
        const chunks: Buffer[] = [];
        incoming.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        incoming.on("end", () => callback(null, Buffer.concat(chunks)));
        incoming.on("error", callback);
      });
    expect(res.status).toBe(200);
    return res.body as Buffer;
  }

  beforeAll(async () => {
    fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });

    const excel = await buildSeedXlsxFromObjective("Crea un Excel con ventas mensuales, fórmulas SUM y formato condicional");
    files.xlsx = `test-${Date.now()}.xlsx`;
    const excelPath = path.join(ARTIFACTS_DIR, files.xlsx);
    fs.writeFileSync(excelPath, excel.buffer);
    createdPaths.push(excelPath);

    const word = await generator.generateWord({
      title: "Test Word",
      style: "formal",
      sections: [
        { heading: "Resumen Ejecutivo", content: "Contenido de ejemplo.", level: 1 },
        { heading: "Detalle", content: "Más contenido.", level: 2 },
        { heading: "Cierre", content: "Conclusión.", level: 3 },
        { heading: "Apéndice", content: "Anexo.", level: 1 },
      ],
    });
    files.docx = `test-${Date.now()}.docx`;
    const wordPath = path.join(ARTIFACTS_DIR, files.docx);
    fs.writeFileSync(wordPath, "buffer" in word ? word.buffer : word);
    createdPaths.push(wordPath);

    const ppt = await generateProfessionalPptx({
      title: "Test PPT",
      subtitle: "Slides",
      theme: "corporate-blue",
      slides: [
        { type: "title", title: "Test PPT", subtitle: "Slides" },
        { type: "content", title: "Resumen", bullets: ["A", "B", "C"] },
        { type: "closing", title: "Fin", subtitle: "Gracias" },
      ],
    });
    files.pptx = `test-${Date.now()}.pptx`;
    const pptPath = path.join(ARTIFACTS_DIR, files.pptx);
    fs.writeFileSync(pptPath, ppt.buffer);
    createdPaths.push(pptPath);

    files.pdf = `test-${Date.now()}.pdf`;
    const pdfPath = path.join(ARTIFACTS_DIR, files.pdf);
    fs.writeFileSync(pdfPath, await pdfBuffer());
    createdPaths.push(pdfPath);
  });

  afterAll(() => {
    for (const filePath of createdPaths) {
      try { fs.unlinkSync(filePath); } catch {}
    }
  });

  it("GET /api/artifacts/:file serves XLSX with spreadsheet content type", async () => {
    const res = await request(app).get(`/api/artifacts/${files.xlsx}`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("spreadsheetml.sheet");
  });

  it("GET /api/artifacts/:file serves DOCX with attachment disposition", async () => {
    const res = await request(app).get(`/api/artifacts/${files.docx}`);
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toContain("attachment");
    expect(res.headers["content-disposition"]).toContain(files.docx);
  });

  it("GET /api/artifacts/:file serves PPTX binary", async () => {
    const body = await getBinary(`/api/artifacts/${files.pptx}`);
    expect(body.subarray(0, 2).toString("utf8")).toBe("PK");
  });

  it("GET missing artifact returns 404", async () => {
    const res = await request(app).get("/api/artifacts/inexistente.xlsx");
    expect(res.status).toBe(404);
  });

  it("path traversal on artifact download returns 403", async () => {
    const res = await request(app).get("/api/artifacts/..%2F..%2F..%2Fetc%2Fpasswd");
    expect(res.status).toBe(403);
  });

  it("XLSX preview returns HTML with table markup", async () => {
    const res = await request(app).get(`/api/artifacts/${files.xlsx}/preview`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.text).toContain("iframe");
    expect(res.text).toContain("TabView");
  });

  it("DOCX preview returns HTML with content", async () => {
    const res = await request(app).get(`/api/artifacts/${files.docx}/preview`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.text).toContain("Resumen Ejecutivo");
  });

  it("PPTX preview returns HTML with slide labels", async () => {
    const res = await request(app).get(`/api/artifacts/${files.pptx}/preview`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.text).toContain('class="slide"');
  });

  it("PDF preview returns inline PDF", async () => {
    const res = await request(app).get(`/api/artifacts/${files.pdf}/preview`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/pdf");
  });

  it("XLSX content-length header matches file size", async () => {
    const stats = fs.statSync(path.join(ARTIFACTS_DIR, files.xlsx));
    const res = await request(app).get(`/api/artifacts/${files.xlsx}`);
    expect(Number(res.headers["content-length"])).toBe(stats.size);
  });

  it("DOCX content-length header matches file size", async () => {
    const stats = fs.statSync(path.join(ARTIFACTS_DIR, files.docx));
    const res = await request(app).get(`/api/artifacts/${files.docx}`);
    expect(Number(res.headers["content-length"])).toBe(stats.size);
  });

  it("PPTX preview contains HTML shell", async () => {
    const res = await request(app).get(`/api/artifacts/${files.pptx}/preview`);
    expect(res.text).toContain("ilia-quicklook-preview");
  });

  it("direct JSON artifact path still serves application/json", async () => {
    const jsonName = `test-${Date.now()}.json`;
    const jsonPath = path.join(ARTIFACTS_DIR, jsonName);
    fs.writeFileSync(jsonPath, JSON.stringify({ ok: true }));
    createdPaths.push(jsonPath);
    const res = await request(app).get(`/api/artifacts/${jsonName}`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/json");
  });

  it("download endpoint serves PDF with attachment disposition", async () => {
    const res = await request(app).get(`/api/artifacts/${files.pdf}/download`);
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toContain("attachment");
  });

  it("download endpoint serves CSV with csv content type", async () => {
    const csvResult = await generator.generateCSV({ title: "csv", headers: ["A", "B"], rows: [[1, 2]] });
    const csvName = `test-${Date.now()}.csv`;
    const csvPath = path.join(ARTIFACTS_DIR, csvName);
    fs.writeFileSync(csvPath, csvResult.buffer);
    createdPaths.push(csvPath);
    const res = await request(app).get(`/api/artifacts/${csvName}`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
  });
});
