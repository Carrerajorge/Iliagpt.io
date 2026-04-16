/**
 * Back-compat re-exports for the multi-format engine dispatcher.
 *
 * Historically this file held NOT_IMPLEMENTED stubs for XLSX / PPTX / PDF.
 * All three now have real engines:
 *
 *   - xlsxEngine → server/lib/office/engine/XlsxEngine.ts (full pipeline)
 *   - pptxEngine → server/lib/office/engine/PptxEngine.ts (PptxGenJS primary)
 *   - pdfEngine  → server/lib/office/engine/PdfEngine.ts  (PDFKit primary)
 *
 * The re-exports keep any downstream imports working without touching them.
 */

export { xlsxEngine } from "./XlsxEngine.ts";
export { pptxEngine } from "./PptxEngine.ts";
export { pdfEngine } from "./PdfEngine.ts";
