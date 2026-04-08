/**
 * Code Execution Document Generator — Replicates Claude's architecture:
 * LLM generates code → Server executes in sandbox → Produces real binary file
 *
 * This is the "show your work" approach: the user sees the code being generated
 * and executed, then gets the real .pptx/.docx/.xlsx/.pdf file.
 */

import * as fs from "fs";
import * as path from "path";
import * as vm from "vm";
import { randomUUID } from "crypto";
import { loadSkill, buildSkillPrompt } from "../../skills/skillLoader";

export interface CodeExecutionResult {
  code: string;           // The generated code (shown to user)
  language: string;       // "javascript"
  output: string;         // Console output from execution
  files: GeneratedFile[]; // Binary files produced
  error?: string;
  durationMs: number;
}

export interface GeneratedFile {
  filename: string;
  buffer: Buffer;
  mimeType: string;
  downloadUrl: string;
}

const ARTIFACTS_DIR = path.join(process.cwd(), "artifacts");

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9\u00C0-\u024F._-]/g, "_").slice(0, 80);
}

/**
 * Execute Node.js code that generates a document file.
 * Runs in a restricted VM context with access to document libraries.
 */
export async function executeDocumentCode(code: string): Promise<CodeExecutionResult> {
  const startMs = Date.now();
  const outputDir = path.join(ARTIFACTS_DIR, `run_${Date.now()}`);
  ensureDir(outputDir);
  ensureDir(ARTIFACTS_DIR);

  const logs: string[] = [];
  const generatedFiles: GeneratedFile[] = [];

  try {
    // Create sandbox context with document libraries
    const context = vm.createContext({
      // Standard globals
      console: {
        log: (...args: any[]) => logs.push(args.map(String).join(" ")),
        error: (...args: any[]) => logs.push("[ERROR] " + args.map(String).join(" ")),
        warn: (...args: any[]) => logs.push("[WARN] " + args.map(String).join(" ")),
      },
      Buffer,
      setTimeout: (fn: Function, ms: number) => setTimeout(fn, Math.min(ms, 5000)),
      clearTimeout,
      Date,
      Math,
      JSON,
      Array,
      Object,
      String,
      Number,
      Boolean,
      RegExp,
      Map,
      Set,
      Promise,
      Error,

      // Document libraries (pre-loaded)
      require: (mod: string) => {
        const allowed: Record<string, string> = {
          "pptxgenjs": "pptxgenjs",
          "exceljs": "exceljs",
          "docx": "docx",
          "pdfkit": "pdfkit",
          "fs": "fs",
          "path": "path",
        };
        const resolved = allowed[mod];
        if (!resolved) throw new Error(`Module "${mod}" is not available in sandbox. Available: ${Object.keys(allowed).join(", ")}`);
        return require(resolved);
      },

      // Output directory for generated files
      __outputDir: outputDir,

      // Helper to save file and register it
      saveFile: (filename: string, buffer: Buffer | Uint8Array) => {
        const safe = sanitizeFilename(filename);
        const storedName = `${Date.now()}_${safe}`;
        const fullPath = path.join(ARTIFACTS_DIR, storedName);
        fs.writeFileSync(fullPath, Buffer.from(buffer));

        const ext = path.extname(safe).toLowerCase();
        const mimeTypes: Record<string, string> = {
          ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          ".pdf": "application/pdf",
          ".csv": "text/csv",
        };

        generatedFiles.push({
          filename: safe,
          buffer: Buffer.from(buffer),
          mimeType: mimeTypes[ext] || "application/octet-stream",
          downloadUrl: `/api/artifacts/${storedName}/download`,
        });
        logs.push(`✓ Saved: ${safe} (${Buffer.from(buffer).length} bytes)`);
      },
    });

    // Execute the code with timeout
    const wrappedCode = `(async () => { ${code} })()`;
    const script = new vm.Script(wrappedCode, { timeout: 30000 });
    await script.runInContext(context, { timeout: 30000 });

    // Clean up temp dir
    try { fs.rmSync(outputDir, { recursive: true, force: true }); } catch {}

    return {
      code,
      language: "javascript",
      output: logs.join("\n"),
      files: generatedFiles,
      durationMs: Date.now() - startMs,
    };
  } catch (error: any) {
    try { fs.rmSync(outputDir, { recursive: true, force: true }); } catch {}

    return {
      code,
      language: "javascript",
      output: logs.join("\n"),
      files: generatedFiles,
      error: error?.message || "Execution failed",
      durationMs: Date.now() - startMs,
    };
  }
}

/**
 * Build the system prompt that tells the LLM to generate executable code
 * for document creation, following Claude's Agent Skills pattern.
 */
export function getDocumentCodePrompt(locale: string): string {
  const isEs = locale.startsWith("es");
  return isEs ? `
GENERACION DE DOCUMENTOS CON CODIGO:
Cuando el usuario pida crear un documento (Word, Excel, PPT, PDF), genera codigo JavaScript ejecutable que use las librerias nativas para crear el archivo.

LIBRERIAS DISPONIBLES:
- pptxgenjs: Para presentaciones PowerPoint (.pptx)
- docx: Para documentos Word (.docx) — usa Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, etc.
- exceljs: Para hojas de calculo Excel (.xlsx) — usa Workbook, Worksheet
- pdfkit: Para documentos PDF (.pdf) — usa PDFDocument

REGLAS:
1. Genera el codigo dentro de un bloque \`\`\`javascript
2. El codigo debe ser COMPLETO y ejecutable
3. Al final del codigo, llama saveFile(filename, buffer) para guardar el archivo
4. Usa colores profesionales: azul corporativo #1F4E79, gris #58595B, acento #E8532E
5. Incluye: portada, headers, footers, estilos profesionales
6. Para PPT: usa pptxgenjs con slides de 16:9, titulo + contenido + tablas
7. Para Word: usa docx con Document, secciones, tablas estilizadas, headers/footers
8. Para Excel: usa exceljs con headers coloreados, formulas, filtros, filas alternas
9. Para PDF: usa pdfkit con portada, secciones, tablas, numeracion de paginas

EJEMPLO PPT:
\`\`\`javascript
const PptxGenJS = require("pptxgenjs");
const pptx = new PptxGenJS();
pptx.layout = "LAYOUT_WIDE";

// Slide 1: Portada
const slide1 = pptx.addSlide();
slide1.background = { fill: "1F4E79" };
slide1.addText("Titulo de la Presentacion", { x: 0.5, y: 2, w: "90%", h: 1.5, fontSize: 36, color: "FFFFFF", bold: true, fontFace: "Calibri", align: "center" });
slide1.addText("Subtitulo", { x: 0.5, y: 3.5, w: "90%", fontSize: 18, color: "CCCCCC", fontFace: "Arial", align: "center" });

// Slide 2: Contenido
const slide2 = pptx.addSlide();
slide2.addText("Seccion 1", { x: 0.5, y: 0.3, w: "90%", fontSize: 28, color: "1F4E79", bold: true });
slide2.addText("• Punto clave 1\\n• Punto clave 2\\n• Punto clave 3", { x: 0.8, y: 1.2, w: "85%", fontSize: 16, color: "333333", lineSpacing: 28 });

const buffer = await pptx.write({ outputType: "nodebuffer" });
saveFile("presentacion.pptx", buffer);
\`\`\`

SIEMPRE genera codigo profesional, completo y listo para ejecutar.` : `
DOCUMENT GENERATION WITH CODE:
When user asks to create a document (Word, Excel, PPT, PDF), generate executable JavaScript code using native libraries.

AVAILABLE LIBRARIES:
- pptxgenjs: PowerPoint (.pptx)
- docx: Word documents (.docx)
- exceljs: Excel spreadsheets (.xlsx)
- pdfkit: PDF documents (.pdf)

Generate complete code in a \`\`\`javascript block. Call saveFile(filename, buffer) at the end.
Use professional colors (#1F4E79, #58595B, #E8532E), include cover pages, headers, footers.`;
}

/**
 * Skill-enhanced prompt: loads SKILL.md content if available,
 * otherwise falls back to the generic document code prompt.
 */
export function getSkillEnhancedPrompt(skillName: string, locale: string): string {
  const skill = loadSkill(skillName);
  if (skill && skill.instructions) {
    return buildSkillPrompt(skill);
  }
  return getDocumentCodePrompt(locale);
}

/**
 * Generate an HTML preview for a document file.
 * Returns a simplified HTML string for inline display in the chat.
 */
export function generateHtmlPreview(file: GeneratedFile): string {
  const ext = path.extname(file.filename).toLowerCase();
  const sizeKb = Math.round(file.buffer.length / 1024);
  const typeLabels: Record<string, string> = {
    ".pptx": "PowerPoint Presentation",
    ".docx": "Word Document",
    ".xlsx": "Excel Spreadsheet",
    ".pdf": "PDF Document",
  };
  const typeLabel = typeLabels[ext] || "Document";
  const iconColors: Record<string, string> = {
    ".pptx": "#D24726",
    ".docx": "#2B579A",
    ".xlsx": "#217346",
    ".pdf": "#F40F02",
  };
  const color = iconColors[ext] || "#1F4E79";

  return `<div style="border:1px solid #e2e8f0;border-radius:8px;padding:16px;max-width:400px;font-family:system-ui,sans-serif">
  <div style="display:flex;align-items:center;gap:12px">
    <div style="width:48px;height:48px;border-radius:8px;background:${color};display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:14px">${ext.replace(".", "").toUpperCase()}</div>
    <div>
      <div style="font-weight:600;font-size:14px;color:#1a202c">${file.filename}</div>
      <div style="font-size:12px;color:#718096">${typeLabel} &middot; ${sizeKb} KB</div>
    </div>
  </div>
  <a href="${file.downloadUrl}" style="display:block;margin-top:12px;text-align:center;padding:8px;background:${color};color:#fff;border-radius:6px;text-decoration:none;font-size:13px;font-weight:500">Download</a>
</div>`;
}
