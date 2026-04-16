/**
 * LibreOffice server-side document converter.
 *
 * Uses `soffice --convert-to` for high-fidelity conversion of
 * DOCX/XLSX/PPTX to PDF (or other formats).
 *
 * Falls back gracefully when LibreOffice is not installed.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

const execFileAsync = promisify(execFile);

const SOFFICE_PATHS = [
  process.env.LIBREOFFICE_PATH,
  "/Applications/LibreOffice.app/Contents/MacOS/soffice",
  "/usr/bin/soffice",
  "/usr/local/bin/soffice",
  "/snap/bin/soffice",
].filter(Boolean) as string[];

let resolvedPath: string | null = null;
let checked = false;

function findSoffice(): string | null {
  if (checked) return resolvedPath;
  checked = true;
  for (const p of SOFFICE_PATHS) {
    if (existsSync(p)) {
      resolvedPath = p;
      console.log(`[LibreOffice] Found soffice at: ${p}`);
      return p;
    }
  }
  console.log("[LibreOffice] soffice not found — document conversion disabled. Install with: brew install --cask libreoffice");
  return null;
}

export function isLibreOfficeAvailable(): boolean {
  return findSoffice() !== null;
}

export type ConvertFormat = "pdf" | "html" | "png" | "txt";

export interface ConvertResult {
  buffer: Buffer;
  filename: string;
  mimeType: string;
}

const FORMAT_MIME: Record<ConvertFormat, string> = {
  pdf: "application/pdf",
  html: "text/html",
  png: "image/png",
  txt: "text/plain",
};

/**
 * Convert a document buffer (DOCX, XLSX, PPTX) to the target format.
 *
 * @param inputBuffer  The source file content
 * @param inputName    Original filename (used to determine source type)
 * @param targetFormat Target format (default: "pdf")
 * @param timeoutMs    Conversion timeout (default: 30s)
 */
export async function convertDocument(
  inputBuffer: Buffer,
  inputName: string,
  targetFormat: ConvertFormat = "pdf",
  timeoutMs = 30_000,
): Promise<ConvertResult> {
  const soffice = findSoffice();
  if (!soffice) {
    throw new Error("LibreOffice is not installed. Set LIBREOFFICE_PATH in .env or install LibreOffice.");
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ilia-convert-"));
  const inputPath = path.join(tmpDir, inputName);

  try {
    await fs.writeFile(inputPath, inputBuffer);

    await execFileAsync(soffice, [
      "--headless",
      "--norestore",
      "--convert-to", targetFormat,
      "--outdir", tmpDir,
      inputPath,
    ], { timeout: timeoutMs });

    const baseName = path.basename(inputName, path.extname(inputName));
    const outputPath = path.join(tmpDir, `${baseName}.${targetFormat}`);

    if (!existsSync(outputPath)) {
      throw new Error(`Conversion produced no output file: ${outputPath}`);
    }

    const buffer = await fs.readFile(outputPath);
    const mimeType = FORMAT_MIME[targetFormat] || "application/octet-stream";
    const filename = `${baseName}.${targetFormat}`;

    return { buffer, filename, mimeType };
  } finally {
    // Cleanup temp files
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
