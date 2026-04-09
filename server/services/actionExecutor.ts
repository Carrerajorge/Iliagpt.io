/**
 * Action Executor — IliaGPT
 *
 * Routes a PromptAnalysis to the correct document/content generation pipeline
 * and streams progress events back to the caller.
 *
 * The key principle: the system must DO what the user asks, not just describe it.
 * When the analysis identifies a deliverable, this module generates the real file.
 *
 * Usage:
 *   import { executeAction, type ActionResult } from "./actionExecutor";
 *   const result = await executeAction({ analysis, userMessage, userId, chatId, onProgress });
 */

import * as path from "path";
import * as fs from "fs";
import type { PromptAnalysis } from "./promptAnalyzer";
import { resolveActionPipeline } from "./promptAnalyzer";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ActionContext {
  analysis: PromptAnalysis;
  userMessage: string;
  userId?: string;
  chatId?: string;
  /** Async progress callback — called with user-visible status updates */
  onProgress?: (message: string) => void | Promise<void>;
  /** Optional LLM-generated content structure (e.g., slide outline from LLM) */
  llmContent?: string;
}

export interface ActionResult {
  /** Whether a file was generated */
  hasFile: boolean;
  /** Buffer of the generated file */
  buffer?: Buffer;
  /** Filename for download */
  filename?: string;
  /** MIME type */
  mimeType?: string;
  /** Preview HTML (for in-chat display) */
  previewHtml?: string;
  /** Text response to send to user (when no file) */
  textResponse?: string;
  /** Pipeline that handled this action */
  pipeline: string;
  /** Whether execution succeeded */
  success: boolean;
  error?: string;
}

const ARTIFACTS_DIR = path.join(process.cwd(), "artifacts");

function ensureArtifactsDir(): void {
  if (!fs.existsSync(ARTIFACTS_DIR)) {
    fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
  }
}

function sanitizeFilename(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9_\-\s]/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 60);
}

async function notify(onProgress: ActionContext["onProgress"], msg: string): Promise<void> {
  if (typeof onProgress === "function") {
    try {
      await onProgress(msg);
    } catch {
      // ignore progress callback errors
    }
  }
}

// ── Content Parsers ────────────────────────────────────────────────────────────

/**
 * Parse LLM-generated markdown/text into structured slide data.
 * Looks for slide-number markers or ## headings.
 */
function parseSlidesFromLLMContent(content: string, topic: string): Array<{
  type: "title" | "content" | "table" | "two-column";
  title: string;
  bullets?: string[];
  text?: string;
  tableData?: { headers: string[]; rows: string[][] };
}> {
  const slides: ReturnType<typeof parseSlidesFromLLMContent> = [];

  if (!content || content.trim().length === 0) {
    // Generate a minimal default slide structure
    slides.push({ type: "title", title: topic });
    slides.push({ type: "content", title: "Overview", bullets: ["Key point 1", "Key point 2", "Key point 3"] });
    slides.push({ type: "content", title: "Details", bullets: ["Detail A", "Detail B", "Detail C"] });
    slides.push({ type: "content", title: "Conclusions", bullets: ["Takeaway 1", "Takeaway 2"] });
    return slides;
  }

  // Split by slide markers
  const slideMarkers = /(?:^|\n)(?:#{1,3}\s+|Slide\s+\d+[:.]?\s+|SLIDE\s+\d+[:.]?\s*)/gm;
  const parts = content.split(slideMarkers).filter((p) => p.trim().length > 0);

  if (parts.length <= 1) {
    // Fallback: split by double newlines or paragraphs
    const paragraphs = content.split(/\n{2,}/).filter((p) => p.trim().length > 0);
    slides.push({ type: "title", title: topic });
    for (const para of paragraphs.slice(0, 8)) {
      const lines = para.split("\n").map((l) => l.replace(/^[-*]\s*/, "").trim()).filter(Boolean);
      const heading = lines[0];
      const bullets = lines.slice(1).filter((l) => l.length > 0);
      slides.push({
        type: "content",
        title: heading.slice(0, 80),
        bullets: bullets.length > 0 ? bullets.slice(0, 6) : [para.slice(0, 100)],
      });
    }
    return slides.slice(0, 12);
  }

  // Title slide
  slides.push({ type: "title", title: topic });

  for (const part of parts.slice(0, 11)) {
    const lines = part.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) continue;

    const title = lines[0].replace(/^#+\s*/, "").slice(0, 80);
    const bodyLines = lines.slice(1);
    const bullets = bodyLines
      .map((l) => l.replace(/^[-*•]\s*/, "").trim())
      .filter((l) => l.length > 0)
      .slice(0, 6);

    slides.push({
      type: "content",
      title,
      bullets: bullets.length > 0 ? bullets : [bodyLines.join(" ").slice(0, 150)],
    });
  }

  return slides.length > 1 ? slides : [
    { type: "title", title: topic },
    { type: "content", title: "Overview", bullets: ["Generated content"] },
  ];
}

/**
 * Parse LLM content into Word document sections.
 */
function parseSectionsFromLLMContent(content: string, topic: string): Array<{
  heading: string;
  paragraphs?: string[];
  table?: { headers: string[]; rows: string[][] };
  list?: { items: string[]; ordered?: boolean };
}> {
  if (!content || content.trim().length === 0) {
    return [
      { heading: "Introduction", paragraphs: [`This document covers: ${topic}.`] },
      { heading: "Main Content", paragraphs: ["Content will be provided here."] },
      { heading: "Conclusions", paragraphs: ["Summary and next steps."] },
    ];
  }

  const sections: ReturnType<typeof parseSectionsFromLLMContent> = [];
  const parts = content.split(/\n#{1,3}\s+/);

  for (const part of parts) {
    if (!part.trim()) continue;
    const lines = part.split("\n");
    const heading = lines[0].trim().slice(0, 100);
    const body = lines.slice(1).join("\n").trim();

    // Check for bullet lists
    const bullets = body
      .split("\n")
      .filter((l) => /^[-*•]\s/.test(l))
      .map((l) => l.replace(/^[-*•]\s+/, "").trim())
      .filter(Boolean);

    if (bullets.length >= 3) {
      sections.push({ heading, list: { items: bullets } });
    } else {
      const paragraphs = body
        .split(/\n{2,}/)
        .map((p) => p.replace(/\n/g, " ").trim())
        .filter((p) => p.length > 0);
      sections.push({ heading, paragraphs: paragraphs.length > 0 ? paragraphs : [body] });
    }
  }

  return sections.length > 0 ? sections : [
    { heading: topic, paragraphs: [content.slice(0, 1000)] },
  ];
}

/**
 * Parse LLM content into Excel sheet data.
 */
function parseSheetDataFromLLMContent(
  content: string,
  topic: string
): Array<{ sheetName: string; headers: string[]; rows: string[][] }> {
  if (!content || content.trim().length === 0) {
    return [{
      sheetName: topic.slice(0, 30),
      headers: ["Column A", "Column B", "Column C"],
      rows: [["Row 1A", "Row 1B", "Row 1C"], ["Row 2A", "Row 2B", "Row 2C"]],
    }];
  }

  // Detect markdown tables
  const tablePattern = /\|(.+)\|\n\|[-|: ]+\|\n((?:\|.+\|\n?)+)/gm;
  const tables: ReturnType<typeof parseSheetDataFromLLMContent> = [];
  let match;
  let tableIdx = 0;

  while ((match = tablePattern.exec(content)) !== null) {
    tableIdx++;
    const headerLine = match[1];
    const rowsText = match[2];

    const headers = headerLine.split("|").map((h) => h.trim()).filter(Boolean);
    const rows = rowsText
      .split("\n")
      .filter((l) => l.includes("|"))
      .map((l) => l.split("|").map((c) => c.trim()).filter(Boolean));

    tables.push({
      sheetName: `Sheet${tableIdx}`,
      headers,
      rows,
    });
  }

  if (tables.length > 0) return tables;

  // Fallback: CSV-like parsing
  const lines = content.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length >= 2) {
    const delimiter = lines[0].includes(",") ? "," : lines[0].includes("\t") ? "\t" : ",";
    const headers = lines[0].split(delimiter).map((h) => h.trim());
    const rows = lines.slice(1).map((l) => l.split(delimiter).map((c) => c.trim()));
    return [{ sheetName: topic.slice(0, 30), headers, rows }];
  }

  return [{
    sheetName: topic.slice(0, 30) || "Data",
    headers: ["Item", "Value", "Notes"],
    rows: [["Item 1", "Value 1", ""], ["Item 2", "Value 2", ""]],
  }];
}

// ── Generators ────────────────────────────────────────────────────────────────

async function generatePptxFile(ctx: ActionContext): Promise<ActionResult> {
  const { analysis, userMessage, llmContent } = ctx;
  const topic = analysis.topic || userMessage.slice(0, 80);

  await notify(ctx.onProgress, "📊 Generando presentación PowerPoint...");

  try {
    const pptxMod = await import("./documentGenerators/pptxGenerator");
    const generatePptx = pptxMod.generatePptx;
    const slides = parseSlidesFromLLMContent(llmContent || "", topic);

    const content = {
      title: topic,
      subtitle: `Generated by IliaGPT`,
      author: "IliaGPT",
      slides,
    };

    const result = await generatePptx(content);
    ensureArtifactsDir();

    const filename = `${sanitizeFilename(topic)}_${Date.now()}.pptx`;
    const filePath = path.join(ARTIFACTS_DIR, filename);
    await fs.promises.writeFile(filePath, result.buffer);

    await notify(ctx.onProgress, `✅ Presentación generada: ${filename} (${slides.length} slides)`);

    return {
      hasFile: true,
      buffer: result.buffer,
      filename: result.filename || filename,
      mimeType: result.mimeType || "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      pipeline: "pptx_generator",
      success: true,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await notify(ctx.onProgress, `❌ Error generando PPTX: ${msg}`);
    return { hasFile: false, pipeline: "pptx_generator", success: false, error: msg };
  }
}

async function generateDocxFile(ctx: ActionContext): Promise<ActionResult> {
  const { analysis, userMessage, llmContent } = ctx;
  const topic = analysis.topic || userMessage.slice(0, 80);

  await notify(ctx.onProgress, "📄 Generando documento Word...");

  try {
    const wordMod = await import("./documentGenerators/wordGenerator");
    const generateWord = wordMod.generateWord;
    const sections = parseSectionsFromLLMContent(llmContent || "", topic);

    const content = {
      title: topic,
      author: "IliaGPT",
      sections,
    };

    const result = await generateWord(content);
    ensureArtifactsDir();

    const filename = `${sanitizeFilename(topic)}_${Date.now()}.docx`;
    const filePath = path.join(ARTIFACTS_DIR, filename);
    await fs.promises.writeFile(filePath, result.buffer);

    await notify(ctx.onProgress, `✅ Documento generado: ${filename}`);

    return {
      hasFile: true,
      buffer: result.buffer,
      filename: result.filename || filename,
      mimeType: result.mimeType || "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      pipeline: "docx_generator",
      success: true,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await notify(ctx.onProgress, `❌ Error generando DOCX: ${msg}`);
    return { hasFile: false, pipeline: "docx_generator", success: false, error: msg };
  }
}

async function generateXlsxFile(ctx: ActionContext): Promise<ActionResult> {
  const { analysis, userMessage, llmContent } = ctx;
  const topic = analysis.topic || userMessage.slice(0, 80);

  await notify(ctx.onProgress, "📊 Generando hoja de cálculo Excel...");

  try {
    const excelMod = await import("./documentGenerators/excelGenerator");
    const generateExcel = excelMod.generateExcel;
    const sheets = parseSheetDataFromLLMContent(llmContent || "", topic);

    const content = {
      title: topic,
      sheets: sheets.map((s) => ({
        name: s.sheetName,
        headers: s.headers,
        rows: s.rows,
      })),
    };

    const result = await generateExcel(content);
    ensureArtifactsDir();

    const filename = `${sanitizeFilename(topic)}_${Date.now()}.xlsx`;
    const filePath = path.join(ARTIFACTS_DIR, filename);
    await fs.promises.writeFile(filePath, result.buffer);

    await notify(ctx.onProgress, `✅ Excel generado: ${filename}`);

    return {
      hasFile: true,
      buffer: result.buffer,
      filename: result.filename || filename,
      mimeType: result.mimeType || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      pipeline: "xlsx_generator",
      success: true,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await notify(ctx.onProgress, `❌ Error generando XLSX: ${msg}`);
    return { hasFile: false, pipeline: "xlsx_generator", success: false, error: msg };
  }
}

async function generatePdfFile(ctx: ActionContext): Promise<ActionResult> {
  const { analysis, userMessage, llmContent } = ctx;
  const topic = analysis.topic || userMessage.slice(0, 80);

  await notify(ctx.onProgress, "📑 Generando PDF...");

  try {
    const pdfMod = await import("./documentGenerators/pdfGenerator");
    const generatePdf = pdfMod.generatePdf;
    const sections = parseSectionsFromLLMContent(llmContent || "", topic);

    const content = {
      title: topic,
      author: "IliaGPT",
      sections: sections.map((s) => ({
        heading: s.heading,
        content: s.paragraphs?.join("\n\n") ||
          s.list?.items.join("\n") || "",
      })),
    };

    const result = await generatePdf(content);
    ensureArtifactsDir();

    const filename = `${sanitizeFilename(topic)}_${Date.now()}.pdf`;
    const filePath = path.join(ARTIFACTS_DIR, filename);
    await fs.promises.writeFile(filePath, result.buffer);

    await notify(ctx.onProgress, `✅ PDF generado: ${filename}`);

    return {
      hasFile: true,
      buffer: result.buffer,
      filename: result.filename || filename,
      mimeType: result.mimeType || "application/pdf",
      pipeline: "pdf_generator",
      success: true,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await notify(ctx.onProgress, `❌ Error generando PDF: ${msg}`);
    return { hasFile: false, pipeline: "pdf_generator", success: false, error: msg };
  }
}

// ── Main Executor ─────────────────────────────────────────────────────────────

/**
 * Execute the appropriate action based on the PromptAnalysis.
 * Returns a file buffer (if document generated) or text (if no file needed).
 */
export async function executeAction(ctx: ActionContext): Promise<ActionResult> {
  const pipeline = resolveActionPipeline(ctx.analysis);

  switch (pipeline) {
    case "pptx_generator":
      return generatePptxFile(ctx);

    case "docx_generator":
      return generateDocxFile(ctx);

    case "xlsx_generator":
      return generateXlsxFile(ctx);

    case "pdf_generator":
      return generatePdfFile(ctx);

    case "visualization_pipeline":
      // Visualization is handled inline by the LLM + artifact system
      await notify(ctx.onProgress, "📈 Preparando visualización...");
      return {
        hasFile: false,
        pipeline: "visualization_pipeline",
        success: true,
        textResponse: "Generating visualization. The LLM will produce an interactive chart.",
      };

    case "code_generation":
      // Code generation is handled by the LLM directly
      return {
        hasFile: false,
        pipeline: "code_generation",
        success: true,
        textResponse: "Routing to code generation mode.",
      };

    case "document_analysis":
      // Document analysis is handled by documentAnalyzer.ts + LLM
      await notify(ctx.onProgress, "🔍 Analizando documento...");
      return {
        hasFile: false,
        pipeline: "document_analysis",
        success: true,
        textResponse: "Document analysis in progress.",
      };

    case "standard_llm":
    default:
      return {
        hasFile: false,
        pipeline: "standard_llm",
        success: true,
        textResponse: "Routing to standard LLM conversation.",
      };
  }
}

/**
 * Check whether this analysis should trigger file generation.
 * Used by chatAiRouter to decide whether to call executeAction() before the LLM.
 */
export function shouldGenerateFile(analysis: PromptAnalysis): boolean {
  return (
    analysis.deliverable === "presentation" ||
    analysis.deliverable === "document" ||
    analysis.deliverable === "spreadsheet" ||
    analysis.deliverable === "pdf"
  ) && analysis.confidence >= 0.7;
}

export default { executeAction, shouldGenerateFile };
