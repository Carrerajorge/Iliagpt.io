import { Router, Request, Response } from "express";
import multer from "multer";
import fs from "fs/promises";
import path from "path";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  validateSpreadsheetFile,
  generateChecksum,
  parseSpreadsheet,
  createUpload,
  getUpload,
  deleteUpload,
  createSheet,
  getSheets,
  createAnalysisSession,
  getAnalysisSession,
  getAnalysisOutputs,
  updateAnalysisSession,
  createAnalysisOutput,
} from "../services/spreadsheetAnalyzer";
import { generateAnalysisCode, validatePythonCode } from "../services/spreadsheetLlmAgent";
import { executePythonCode, initializeSandbox } from "../services/pythonSandbox";
import { parseDocument, extractMetadata, detectFileType } from "../services/documentIngestion";
import { startAnalysis, getAnalysisProgress, getAnalysisResults } from "../services/analysisOrchestrator";
import { LIMITS } from "../lib/constants";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: LIMITS.MAX_FILE_SIZE_BYTES },
});

const TEMP_DIR = "/tmp/spreadsheets";

async function ensureTempDir(): Promise<void> {
  try {
    await fs.mkdir(TEMP_DIR, { recursive: true });
  } catch (error) {
  }
}

function getFileExtensionFromType(fileType: string): string {
  const extensions: Record<string, string> = {
    "xlsx": "xlsx",
    "xls": "xls",
    "csv": "csv",
    "tsv": "tsv",
    "pdf": "pdf",
    "docx": "docx",
    "pptx": "pptx",
    "ppt": "ppt",
    "rtf": "rtf",
    "png": "png",
    "jpeg": "jpg",
    "gif": "gif",
    "bmp": "bmp",
    "tiff": "tiff",
    "webp": "webp",
  };
  return extensions[fileType] || fileType || "bin";
}

export function createSpreadsheetRouter(): Router {
  const router = Router();

  router.post("/upload", upload.single("file"), async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const userId = (req as any).user?.id || "anonymous";
      const buffer = req.file.buffer;
      const mimeType = req.file.mimetype;
      const originalName = req.file.originalname;

      const detectedFileType = await detectFileType(buffer, mimeType);
      if (!detectedFileType) {
        return res.status(400).json({ error: "Unsupported file type" });
      }

      const isTabular = ["xlsx", "xls", "csv", "tsv"].includes(detectedFileType);
      
      if (isTabular) {
        const validation = validateSpreadsheetFile(buffer, mimeType);
        if (!validation.valid) {
          return res.status(400).json({ error: validation.error });
        }
      }

      const checksum = generateChecksum(buffer);

      const parsed = await parseDocument(buffer, mimeType, originalName);

      const uploadId = nanoid();
      const ext = getFileExtensionFromType(parsed.metadata.fileType);
      const tempFilePath = path.join(TEMP_DIR, `${uploadId}.${ext}`);

      await ensureTempDir();
      await fs.writeFile(tempFilePath, buffer);

      const uploadRecord = await createUpload({
        userId,
        fileName: originalName,
        mimeType,
        size: buffer.length,
        storageKey: tempFilePath,
        checksum,
        status: "ready",
        fileType: parsed.metadata.fileType as any,
        encoding: parsed.metadata.encoding,
        pageCount: parsed.metadata.pageCount,
      });

      const sheetsResponse: { name: string; rowCount: number; columnCount: number; headers: string[]; isTabular: boolean }[] = [];

      for (const sheetInfo of parsed.sheets) {
        await createSheet({
          uploadId: uploadRecord.id,
          name: sheetInfo.name,
          sheetIndex: sheetInfo.index,
          rowCount: sheetInfo.rowCount,
          columnCount: sheetInfo.columnCount,
          inferredHeaders: sheetInfo.headers,
          columnTypes: [],
          previewData: sheetInfo.previewData,
        });

        const headers = sheetInfo.headers.length > 0
          ? sheetInfo.headers
          : Array.from({ length: sheetInfo.columnCount }, (_, i) => `Column${i + 1}`);

        sheetsResponse.push({
          name: sheetInfo.name,
          rowCount: sheetInfo.rowCount,
          columnCount: sheetInfo.columnCount,
          headers,
          isTabular: sheetInfo.isTabular,
        });
      }

      let firstSheetPreview: { headers: string[]; data: any[][] } | null = null;
      if (parsed.sheets.length > 0) {
        const firstSheet = parsed.sheets[0];
        const headers = firstSheet.headers.length > 0
          ? firstSheet.headers
          : Array.from({ length: firstSheet.columnCount }, (_, i) => `Column${i + 1}`);
        const dataStartRow = firstSheet.headers.length > 0 && firstSheet.isTabular ? 1 : 0;
        const previewRows = firstSheet.previewData.slice(dataStartRow, dataStartRow + 100);
        firstSheetPreview = {
          headers,
          data: previewRows,
        };
      }

      res.json({
        id: uploadRecord.id,
        filename: originalName,
        fileType: parsed.metadata.fileType,
        sheets: sheetsResponse.map(s => s.name),
        sheetDetails: sheetsResponse,
        firstSheetPreview,
        pageCount: parsed.metadata.pageCount,
        uploadedAt: uploadRecord.createdAt?.toISOString() || new Date().toISOString(),
      });
    } catch (error: any) {
      console.error("[SpreadsheetRoutes] Upload error:", error);
      res.status(500).json({ error: error.message || "Failed to upload file" });
    }
  });

  router.get("/:uploadId/sheets", async (req: Request, res: Response) => {
    try {
      const { uploadId } = req.params;

      const upload = await getUpload(uploadId);
      if (!upload) {
        return res.status(404).json({ error: "Upload not found" });
      }

      const sheets = await getSheets(uploadId);

      res.json({
        sheets: sheets.map((sheet) => ({
          id: sheet.id,
          name: sheet.name,
          sheetIndex: sheet.sheetIndex,
          rowCount: sheet.rowCount,
          columnCount: sheet.columnCount,
          inferredHeaders: sheet.inferredHeaders,
          columnTypes: sheet.columnTypes,
        })),
      });
    } catch (error: any) {
      console.error("[SpreadsheetRoutes] Get sheets error:", error);
      res.status(500).json({ error: error.message || "Failed to get sheets" });
    }
  });

  router.get("/:uploadId/sheet/:sheetName/data", async (req: Request, res: Response) => {
    try {
      const { uploadId, sheetName } = req.params;

      const upload = await getUpload(uploadId);
      if (!upload) {
        return res.status(404).json({ error: "Upload not found" });
      }

      if (!upload.storageKey) {
        return res.status(400).json({ error: "File not available" });
      }

      const buffer = await fs.readFile(upload.storageKey);
      const parsed = await parseSpreadsheet(buffer, upload.mimeType);

      const sheet = parsed.sheets.find((s) => s.name === sheetName);
      if (!sheet) {
        return res.status(404).json({ error: "Sheet not found" });
      }

      const headers = sheet.inferredHeaders.length > 0 
        ? sheet.inferredHeaders 
        : Array.from({ length: sheet.columnCount }, (_, i) => `Column${i + 1}`);

      const dataStartRow = sheet.inferredHeaders.length > 0 ? 1 : 0;
      const allData = sheet.previewData.slice(dataStartRow, dataStartRow + 100);
      const totalRows = allData.length;

      const rows = allData.map((rowArray: any[]) => {
        const rowObj: Record<string, any> = {};
        headers.forEach((header, idx) => {
          rowObj[header] = rowArray[idx] ?? null;
        });
        return rowObj;
      });

      const columnTypesArray = sheet.columnTypes || [];
      const columnTypesMap = new Map(columnTypesArray.map((ct: any) => [ct.name, ct.type]));
      const columns = headers.map((header) => ({
        name: header,
        type: columnTypesMap.get(header) || 'text',
      }));

      res.json({
        rows,
        columns,
        totalRows,
      });
    } catch (error: any) {
      console.error("[SpreadsheetRoutes] Get sheet data error:", error);
      res.status(500).json({ error: error.message || "Failed to get sheet data" });
    }
  });

  const analyzeSchema = z.object({
    sheetName: z.string(),
    mode: z.enum(["full", "text_only", "numbers_only"]),
    prompt: z.string().optional(),
  });

  router.post("/:uploadId/analyze", async (req: Request, res: Response) => {
    try {
      const { uploadId } = req.params;
      const userId = (req as any).user?.id || "anonymous";

      const validation = analyzeSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ error: validation.error.message });
      }

      const { sheetName, mode, prompt } = validation.data;

      const uploadData = await getUpload(uploadId);
      if (!uploadData) {
        return res.status(404).json({ error: "Upload not found" });
      }

      const sheets = await getSheets(uploadId);
      const sheet = sheets.find((s) => s.name === sheetName);
      if (!sheet) {
        return res.status(404).json({ error: "Sheet not found" });
      }

      const session = await createAnalysisSession({
        uploadId,
        userId,
        sheetName,
        mode,
        userPrompt: prompt,
        status: "pending",
      });

      res.json({
        sessionId: session.id,
        status: session.status,
      });

      // Execute analysis asynchronously
      executeAnalysis(session.id, uploadData, sheet, mode, prompt).catch((error) => {
        console.error("[SpreadsheetRoutes] Async analysis error:", error);
      });
    } catch (error: any) {
      console.error("[SpreadsheetRoutes] Analyze error:", error);
      res.status(500).json({ error: error.message || "Failed to start analysis" });
    }
  });

  async function executeAnalysis(
    sessionId: string,
    uploadData: Awaited<ReturnType<typeof getUpload>>,
    sheet: Awaited<ReturnType<typeof getSheets>>[0],
    mode: "full" | "text_only" | "numbers_only",
    prompt?: string
  ) {
    try {
      await updateAnalysisSession(sessionId, { status: "generating_code", startedAt: new Date() });

      const headers = sheet.inferredHeaders || [];
      const columnTypes = sheet.columnTypes || [];
      const sampleData = sheet.previewData?.slice(0, 10) || [];

      // Generate Python code using LLM
      const { code, intent } = await generateAnalysisCode({
        sheetName: sheet.name,
        headers,
        columnTypes,
        sampleData,
        mode,
        userPrompt: prompt,
      });

      // Validate the generated code
      const codeValidation = validatePythonCode(code);
      if (!codeValidation.valid) {
        await updateAnalysisSession(sessionId, {
          status: "failed",
          errorMessage: `Code validation failed: ${codeValidation.errors.join(", ")}`,
          completedAt: new Date(),
        });
        return;
      }

      await updateAnalysisSession(sessionId, { status: "executing", generatedCode: code });

      // Initialize sandbox and execute
      await initializeSandbox();

      const executionResult = await executePythonCode({
        code,
        filePath: uploadData!.storageKey,
        sheetName: sheet.name,
        timeoutMs: 30000,
      });

      if (!executionResult.success) {
        await updateAnalysisSession(sessionId, {
          status: "failed",
          errorMessage: executionResult.error || "Execution failed",
          executionTimeMs: executionResult.executionTimeMs,
          completedAt: new Date(),
        });
        return;
      }

      // Save outputs
      const output = executionResult.output;
      let outputOrder = 0;

      // Save summary as separate output with type='summary'
      if (output?.summary) {
        await createAnalysisOutput({
          sessionId,
          outputType: "summary",
          title: "Summary",
          payload: output.summary,
          order: outputOrder++,
        });
      }

      // Save metrics
      if (output?.metrics && Object.keys(output.metrics).length > 0) {
        await createAnalysisOutput({
          sessionId,
          outputType: "metric",
          title: "Metrics",
          payload: output.metrics,
          order: outputOrder++,
        });
      }

      // Save tables with name field as title
      if (output?.tables?.length > 0) {
        for (const table of output.tables) {
          await createAnalysisOutput({
            sessionId,
            outputType: "table",
            title: table.name || "Data Table",
            payload: { data: table.data, name: table.name },
            order: outputOrder++,
          });
        }
      }

      // Save charts
      if (output?.charts?.length > 0) {
        for (const chart of output.charts) {
          await createAnalysisOutput({
            sessionId,
            outputType: "chart",
            title: chart.title || "Chart",
            payload: chart,
            order: outputOrder++,
          });
        }
      }

      // Save logs as type='log'
      if (output?.logs?.length > 0) {
        await createAnalysisOutput({
          sessionId,
          outputType: "log",
          title: "Execution Logs",
          payload: output.logs,
          order: outputOrder++,
        });
      }

      await updateAnalysisSession(sessionId, {
        status: "succeeded",
        executionTimeMs: executionResult.executionTimeMs,
        completedAt: new Date(),
      });

      console.log(`[SpreadsheetRoutes] Analysis completed for session ${sessionId}`);
    } catch (error: any) {
      console.error(`[SpreadsheetRoutes] Analysis execution error:`, error);
      await updateAnalysisSession(sessionId, {
        status: "failed",
        errorMessage: error.message || "Analysis execution failed",
        completedAt: new Date(),
      });
    }
  }

  router.get("/analyze/status/:sessionId", async (req: Request, res: Response) => {
    try {
      const { sessionId } = req.params;

      const session = await getAnalysisSession(sessionId);
      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }

      let outputs = null;
      if (session.status === "succeeded") {
        const outputRows = await getAnalysisOutputs(sessionId);
        
        outputs = {
          summary: outputRows.find(o => o.outputType === "summary")?.payload,
          metrics: outputRows.filter(o => o.outputType === "metric").map(o => o.payload || {}),
          tables: outputRows.filter(o => o.outputType === "table").map(o => o.payload || {}),
          charts: outputRows.filter(o => o.outputType === "chart").map(o => o.payload || {}),
        };
      }

      res.json({
        sessionId,
        status: session.status,
        generatedCode: session.generatedCode,
        outputs,
        error: session.errorMessage,
      });
    } catch (error: any) {
      console.error("[SpreadsheetRoutes] Get analysis status error:", error);
      res.status(500).json({ error: error.message || "Failed to get analysis status" });
    }
  });

  router.get("/analysis/:sessionId", async (req: Request, res: Response) => {
    try {
      const { sessionId } = req.params;

      const session = await getAnalysisSession(sessionId);
      if (!session) {
        return res.status(404).json({ error: "Analysis session not found" });
      }

      const outputs = await getAnalysisOutputs(sessionId);

      res.json({
        session: {
          id: session.id,
          uploadId: session.uploadId,
          sheetName: session.sheetName,
          mode: session.mode,
          userPrompt: session.userPrompt,
          status: session.status,
          errorMessage: session.errorMessage,
          generatedCode: session.generatedCode,
          executionTimeMs: session.executionTimeMs,
          createdAt: session.createdAt,
          completedAt: session.completedAt,
        },
        outputs: outputs.map((output) => ({
          type: output.outputType,
          title: output.title,
          payload: output.payload,
        })),
      });
    } catch (error: any) {
      console.error("[SpreadsheetRoutes] Get analysis error:", error);
      res.status(500).json({ error: error.message || "Failed to get analysis" });
    }
  });

  const multiAnalyzeSchema = z.object({
    uploadId: z.string(),
    scope: z.enum(['active', 'selected', 'all']),
    sheetNames: z.array(z.string()).optional().default([]),
    analysisMode: z.enum(['full', 'summary', 'extract_tasks', 'text_only', 'custom']).default('full'),
    userPrompt: z.string().optional(),
  });

  router.post("/analyze/start", async (req: Request, res: Response) => {
    try {
      const validation = multiAnalyzeSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ error: validation.error.message });
      }

      const { uploadId, scope, sheetNames, analysisMode, userPrompt } = validation.data;
      const userId = (req as any).user?.id || "anonymous";

      const result = await startAnalysis({
        uploadId,
        userId,
        scope,
        sheetNames,
        analysisMode,
        userPrompt,
      });

      res.json({ sessionId: result.sessionId });
    } catch (error: any) {
      console.error("[SpreadsheetRoutes] Start multi-analysis error:", error);
      res.status(500).json({ error: error.message || "Failed to start analysis" });
    }
  });

  router.get("/analyze/progress/:sessionId", async (req: Request, res: Response) => {
    try {
      const { sessionId } = req.params;
      const progress = await getAnalysisProgress(sessionId);
      res.json(progress);
    } catch (error: any) {
      if (error.message?.includes("not found")) {
        return res.status(404).json({ error: "Session not found" });
      }
      console.error("[SpreadsheetRoutes] Get analysis progress error:", error);
      res.status(500).json({ error: error.message || "Failed to get analysis progress" });
    }
  });

  router.get("/analyze/results/:sessionId", async (req: Request, res: Response) => {
    try {
      const { sessionId } = req.params;
      const results = await getAnalysisResults(sessionId);
      if (!results) {
        return res.status(404).json({ error: "Results not ready or session not found" });
      }
      res.json(results);
    } catch (error: any) {
      console.error("[SpreadsheetRoutes] Get analysis results error:", error);
      res.status(500).json({ error: error.message || "Failed to get analysis results" });
    }
  });

  router.delete("/:uploadId", async (req: Request, res: Response) => {
    try {
      const { uploadId } = req.params;

      const upload = await getUpload(uploadId);
      if (!upload) {
        return res.status(404).json({ error: "Upload not found" });
      }

      if (upload.storageKey) {
        try {
          await fs.unlink(upload.storageKey);
        } catch (error) {
        }
      }

      await deleteUpload(uploadId);

      res.json({ success: true });
    } catch (error: any) {
      console.error("[SpreadsheetRoutes] Delete error:", error);
      res.status(500).json({ error: error.message || "Failed to delete upload" });
    }
  });

  return router;
}
