/**
 * Code Execution Router — Executes document generation code from LLM responses.
 * POST /api/execute-code — receives JavaScript code, runs in sandbox, returns generated files.
 */

import { Router, type Request, type Response } from "express";
import { executeDocumentCode, generateHtmlPreview } from "../services/documentGenerators/codeExecutionGenerator";

export function createCodeExecutionRouter(): Router {
  const router = Router();

  /**
   * POST /api/execute-code
   * Body: { code: string, language?: string }
   * Returns: { success, output, files: [{ filename, mimeType, size, downloadUrl, previewHtml }], error?, durationMs }
   */
  router.post("/execute-code", async (req: Request, res: Response) => {
    try {
      const { code, language } = req.body;

      if (!code || typeof code !== "string") {
        return res.status(400).json({ success: false, error: "Missing 'code' field" });
      }

      if (code.length > 50000) {
        return res.status(400).json({ success: false, error: "Code too long (max 50KB)" });
      }

      // Only JavaScript/Node.js for now (same as Claude's PptxGenJS/docx/ExcelJS approach)
      if (language && language !== "javascript" && language !== "js" && language !== "node") {
        return res.status(400).json({ success: false, error: `Unsupported language: ${language}. Only JavaScript is supported.` });
      }

      console.log(`[CodeExec] Executing ${code.length} chars of JavaScript...`);

      const result = await executeDocumentCode(code);

      const files = result.files.map((f) => ({
        filename: f.filename,
        mimeType: f.mimeType,
        size: f.buffer.length,
        downloadUrl: f.downloadUrl,
        previewHtml: generateHtmlPreview(f),
      }));

      console.log(`[CodeExec] Done in ${result.durationMs}ms: ${files.length} files, ${result.error ? "ERROR: " + result.error : "OK"}`);

      res.json({
        success: !result.error,
        output: result.output,
        files,
        error: result.error,
        durationMs: result.durationMs,
      });
    } catch (error: any) {
      console.error("[CodeExec] Unexpected error:", error?.message);
      res.status(500).json({
        success: false,
        error: error?.message || "Execution failed",
      });
    }
  });

  return router;
}
