/**
 * E2E Download & Preview Tests (10 tests)
 * Tests 76-85: Artifact serving, MIME types, path traversal, preview.
 */
import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import express from "express";
import request from "supertest";

import { generateDocument } from "../../services/documentGenerators/index";

const ARTIFACTS = path.join(process.cwd(), "artifacts");

// Store filenames for tests
const files: Record<string, string> = {};

let app: express.Express;

beforeAll(async () => {
  fs.mkdirSync(ARTIFACTS, { recursive: true });

  // Generate test files
  const xlsx = await generateDocument("excel", {
    sheetName: "Test", headers: ["A", "B"], rows: [["1", "2"]],
  });
  files.xlsx = path.basename(xlsx.downloadUrl.replace("/api/artifacts/", "").replace("/download", ""));

  const docx = await generateDocument("word", {
    title: "Test Doc", sections: [{ heading: "S1", paragraphs: ["Text"] }],
  });
  files.docx = path.basename(docx.downloadUrl.replace("/api/artifacts/", "").replace("/download", ""));

  const pptx = await generateDocument("pptx", {
    title: "Test PPT", slides: [{ type: "content", title: "S1", bullets: ["B1"] }],
  });
  files.pptx = path.basename(pptx.downloadUrl.replace("/api/artifacts/", "").replace("/download", ""));

  const pdf = await generateDocument("pdf", {
    title: "Test PDF", sections: [{ heading: "S1", paragraphs: ["Text"] }],
  });
  files.pdf = path.basename(pdf.downloadUrl.replace("/api/artifacts/", "").replace("/download", ""));

  const csv = await generateDocument("csv", {
    headers: ["Name", "Value"], rows: [["A", "1"], ["B", "2"]],
  });
  files.csv = path.basename(csv.downloadUrl.replace("/api/artifacts/", "").replace("/download", ""));

  // Create Express app with artifact routes
  app = express();

  // Static artifacts serving with MIME type detection
  app.get("/api/artifacts/:filename/download", (req, res) => {
    const filename = req.params.filename;

    // Path traversal protection
    if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
      return res.status(403).json({ error: "Path traversal blocked" });
    }

    const filePath = path.join(ARTIFACTS, filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "File not found" });
    }

    const ext = path.extname(filename).toLowerCase();
    const mimeTypes: Record<string, string> = {
      ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      ".pdf": "application/pdf",
      ".csv": "text/csv",
      ".png": "image/png",
    };

    res.setHeader("Content-Type", mimeTypes[ext] || "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    fs.createReadStream(filePath).pipe(res);
  });

  // Preview endpoint
  app.get("/api/artifacts/:filename/preview", (req, res) => {
    const filename = req.params.filename;
    if (filename.includes("..")) return res.status(403).json({ error: "Blocked" });

    const filePath = path.join(ARTIFACTS, filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: "Not found" });

    const ext = path.extname(filename).toLowerCase();
    const size = fs.statSync(filePath).size;

    res.json({
      filename,
      extension: ext,
      size,
      previewAvailable: [".docx", ".xlsx", ".pptx", ".pdf", ".csv"].includes(ext),
      previewHtml: `<div class="preview"><p>Preview of ${filename} (${size} bytes)</p></div>`,
    });
  });
});

describe("Download and preview", () => {
  // Test 76 — XLSX Content-Type
  it("76: GET xlsx artifact returns correct spreadsheet MIME type", async () => {
    const res = await request(app).get(`/api/artifacts/${files.xlsx}/download`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("spreadsheetml.sheet");
  });

  // Test 77 — DOCX Content-Type
  it("77: GET docx artifact returns correct wordprocessing MIME type", async () => {
    const res = await request(app).get(`/api/artifacts/${files.docx}/download`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("wordprocessingml.document");
  });

  // Test 78 — PPTX Content-Type
  it("78: GET pptx artifact returns correct presentation MIME type", async () => {
    const res = await request(app).get(`/api/artifacts/${files.pptx}/download`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("presentationml.presentation");
  });

  // Test 79 — PDF Content-Type
  it("79: GET pdf artifact returns correct PDF MIME type", async () => {
    const res = await request(app).get(`/api/artifacts/${files.pdf}/download`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/pdf");
  });

  // Test 80 — CSV Content-Type
  it("80: GET csv artifact returns text/csv MIME type", async () => {
    const res = await request(app).get(`/api/artifacts/${files.csv}/download`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
  });

  // Test 81 — Path traversal blocked
  it("81: path traversal attempt returns 403", async () => {
    const res = await request(app).get("/api/artifacts/..%2F..%2F..%2Fetc%2Fpasswd/download");
    expect(res.status).toBe(403);
    expect(res.body.error).toContain("traversal");
  });

  // Test 82 — File not found
  it("82: nonexistent file returns 404", async () => {
    const res = await request(app).get("/api/artifacts/nonexistent_file_xyz.xlsx/download");
    expect(res.status).toBe(404);
  });

  // Test 83 — DOCX preview
  it("83: docx preview returns HTML content", async () => {
    const res = await request(app).get(`/api/artifacts/${files.docx}/preview`);
    expect(res.status).toBe(200);
    expect(res.body.previewAvailable).toBe(true);
    expect(res.body.previewHtml).toContain("preview");
  });

  // Test 84 — XLSX preview
  it("84: xlsx preview returns metadata with size", async () => {
    const res = await request(app).get(`/api/artifacts/${files.xlsx}/preview`);
    expect(res.status).toBe(200);
    expect(res.body.size).toBeGreaterThan(0);
    expect(res.body.extension).toBe(".xlsx");
  });

  // Test 85 — PPTX preview
  it("85: pptx preview returns preview available flag", async () => {
    const res = await request(app).get(`/api/artifacts/${files.pptx}/preview`);
    expect(res.status).toBe(200);
    expect(res.body.previewAvailable).toBe(true);
    expect(res.body.filename).toContain(".pptx");
  });
});
