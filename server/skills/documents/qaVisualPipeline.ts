import { execFileSync } from "child_process";
import type { DocumentQaReport, QaStatus, DocumentFormat } from "./types";

const MAX_SIZE = 50 * 1024 * 1024;
const MIN_SIZES: Record<DocumentFormat, number> = { pptx: 5120, docx: 2048, xlsx: 2048, pdf: 1024 };
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const PDF_MAGIC = Buffer.from("%PDF-", "ascii");

/** Stage 1 — Structural validation (always runs) */
function validateStructure(buf: Buffer, fmt: DocumentFormat): string[] {
  const f: string[] = [];
  if (buf.length === 0) f.push("Buffer is empty");
  if (buf.length > MAX_SIZE) f.push(`Buffer exceeds 50 MB (${(buf.length / 1024 / 1024).toFixed(1)} MB)`);
  if (fmt === "pdf") {
    if (buf.subarray(0, 5).compare(PDF_MAGIC) !== 0) f.push("Missing %PDF- header");
  } else {
    if (buf.subarray(0, 4).compare(ZIP_MAGIC) !== 0) f.push(`Invalid ZIP structure for ${fmt.toUpperCase()}`);
  }
  const min = MIN_SIZES[fmt];
  if (buf.length > 0 && buf.length < min)
    f.push(`File suspiciously small for ${fmt.toUpperCase()} (${buf.length} bytes, expected >= ${min})`);
  return f;
}

/** Stage 2 — Content extraction via JSZip (PPTX/DOCX/XLSX) */
async function extractContent(buf: Buffer, fmt: DocumentFormat): Promise<string[]> {
  if (fmt === "pdf") return [];
  const f: string[] = [];
  let loadAsync: (d: Buffer) => Promise<any>;
  try {
    const JSZip = (await import("jszip")).default;
    loadAsync = (d) => JSZip.loadAsync(d);
  } catch {
    return ["JSZip not available — content extraction skipped"];
  }
  try {
    const zip = await loadAsync(buf);
    if (fmt === "pptx") {
      const ct = await zip.file("[Content_Types].xml")?.async("string");
      if (!ct) return [...f, "Missing [Content_Types].xml — corrupt PPTX"];
      const slides = ct.match(/PartName="\/ppt\/slides\/slide\d+\.xml"/g);
      const n = slides?.length ?? 0;
      if (n === 0) f.push("empty_presentation: 0 slides detected");
      if (n < 2) f.push(`Only ${n} slide(s) — consider adding more content`);
      if (n > 30) f.push(`High slide count (${n}) — consider splitting`);
    }
    if (fmt === "docx") {
      const xml = await zip.file("word/document.xml")?.async("string");
      if (!xml) { f.push("Missing word/document.xml — corrupt DOCX"); }
      else {
        if (!xml.match(/<w:p[ >]/g)?.length) f.push("No paragraphs found in document");
        if (xml.replace(/<[^>]+>/g, "").trim().length < 10) f.push("Document appears to have very little text content");
      }
    }
    if (fmt === "xlsx") {
      const xml = await zip.file("xl/worksheets/sheet1.xml")?.async("string");
      if (!xml) f.push("Missing xl/worksheets/sheet1.xml — corrupt or empty XLSX");
      else if (!xml.match(/<row[ >]/g)?.length) f.push("Sheet1 contains no data rows");
    }
  } catch (err) {
    f.push(`ZIP extraction failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  return f;
}

/** Stage 3 — Heuristic checks */
function runHeuristics(buf: Buffer, fmt: DocumentFormat, contentFindings: string[]): string[] {
  const f: string[] = [];
  if (contentFindings.some(c => /empty|no data|0 slides/.test(c)))
    f.push("Content appears empty — generation may have failed silently");
  if (fmt !== "pdf" && buf.length > 0 && buf.length < MIN_SIZES[fmt] * 2)
    f.push("File is near minimum size — content may be incomplete");
  return f;
}

/** Stage 4 — Thumbnail probe (optional, LibreOffice) */
function hasSoffice(): boolean {
  try { execFileSync("which", ["soffice"], { timeout: 3000, stdio: "pipe" }); return true; }
  catch { return false; }
}

function computeSeverity(findings: string[]): DocumentQaReport["severity"] {
  if (findings.length === 0) return "none";
  if (findings.some(f => /corrupt|empty_presentation|Missing|Invalid ZIP|Missing %PDF/.test(f))) return "high";
  if (findings.some(f => /suspiciously small|very little|incomplete|empty/.test(f))) return "medium";
  return "low";
}

export async function runVisualQA(
  buffer: Buffer,
  format: DocumentFormat,
  options?: { blocking?: boolean },
): Promise<DocumentQaReport> {
  const start = Date.now();
  const all: string[] = [];

  all.push(...validateStructure(buffer, format));
  const content = await extractContent(buffer, format);
  all.push(...content);
  all.push(...runHeuristics(buffer, format, content));
  if (!hasSoffice()) all.push("soffice not found — thumbnail generation skipped");

  const severity = computeSeverity(all);
  let status: QaStatus = "passed";
  if (severity === "high" && options?.blocking) status = "failed";
  else if (all.length > 0 && severity !== "none") status = "warning";

  return { status, severity, findings: all, metrics: { validationMs: Date.now() - start, repairLoops: 0 } };
}
