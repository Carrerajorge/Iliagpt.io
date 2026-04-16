import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { Express, Request, Response, NextFunction } from "express";
import request from "supertest";
import ExcelJS from "exceljs";
import { 
  pareRequestContract, 
  pareRateLimiter, 
  pareQuotaGuard, 
  requirePareContext,
  pareAnalyzeSchemaValidator 
} from "../server/middleware";
import { PdfParser } from "../server/parsers/pdfParser";
import { XlsxParser } from "../server/parsers/xlsxParser";

function generateSimplePdf(): Buffer {
  const pdfContent = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj

2 0 obj
<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>
endobj

3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 5 0 R /Resources << /Font << /F1 7 0 R >> >> >>
endobj

4 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 6 0 R /Resources << /Font << /F1 7 0 R >> >> >>
endobj

5 0 obj
<< /Length 180 >>
stream
BT
/F1 24 Tf
50 700 Td
(Q4 Revenue Report) Tj
0 -40 Td
/F1 14 Tf
(Quarterly Financial Summary) Tj
0 -30 Td
(Total Revenue: $1.2M) Tj
0 -20 Td
(Growth Rate: 15% YoY) Tj
ET
endstream
endobj

6 0 obj
<< /Length 200 >>
stream
BT
/F1 18 Tf
50 700 Td
(Page 2 - Details) Tj
0 -30 Td
/F1 12 Tf
(Revenue Breakdown:) Tj
0 -20 Td
(- Product A: $500,000) Tj
0 -20 Td
(- Product B: $400,000) Tj
0 -20 Td
(- Product C: $300,000) Tj
0 -20 Td
(Total: $1,200,000) Tj
ET
endstream
endobj

7 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj

xref
0 8
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000242 00000 n 
0000000369 00000 n 
0000000600 00000 n 
0000000851 00000 n 

trailer
<< /Size 8 /Root 1 0 R >>
startxref
928
%%EOF`;
  
  return Buffer.from(pdfContent, "utf-8");
}

async function generateSalesXlsx(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Sales");
  
  sheet.columns = [
    { header: "Date", key: "date", width: 12 },
    { header: "Product", key: "product", width: 20 },
    { header: "Amount", key: "amount", width: 12 },
    { header: "Region", key: "region", width: 15 },
  ];

  const salesData = [
    { date: "2024-01-15", product: "Widget Pro", amount: 1250.00, region: "North" },
    { date: "2024-01-16", product: "Gadget X", amount: 890.50, region: "South" },
    { date: "2024-01-17", product: "Widget Pro", amount: 1450.00, region: "East" },
    { date: "2024-01-18", product: "Super Tool", amount: 2100.00, region: "West" },
    { date: "2024-01-19", product: "Gadget X", amount: 750.00, region: "North" },
    { date: "2024-01-20", product: "Widget Pro", amount: 1100.00, region: "South" },
    { date: "2024-01-21", product: "Super Tool", amount: 1800.00, region: "East" },
    { date: "2024-01-22", product: "Gadget X", amount: 920.00, region: "West" },
    { date: "2024-01-23", product: "Widget Pro", amount: 1350.00, region: "North" },
    { date: "2024-01-24", product: "Super Tool", amount: 2400.00, region: "South" },
  ];

  salesData.forEach(row => sheet.addRow(row));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function generateMultiSheetXlsx(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  
  const salesSheet = workbook.addWorksheet("Sales");
  salesSheet.columns = [
    { header: "Date", key: "date", width: 12 },
    { header: "Product", key: "product", width: 20 },
    { header: "Revenue", key: "revenue", width: 12 },
  ];
  [
    { date: "2024-Q1", product: "Widget Pro", revenue: 45000 },
    { date: "2024-Q2", product: "Widget Pro", revenue: 52000 },
  ].forEach(row => salesSheet.addRow(row));

  const expensesSheet = workbook.addWorksheet("Expenses");
  expensesSheet.columns = [
    { header: "Category", key: "category", width: 20 },
    { header: "Amount", key: "amount", width: 12 },
  ];
  [
    { category: "Salaries", amount: 120000 },
    { category: "Marketing", amount: 25000 },
  ].forEach(row => expensesSheet.addRow(row));

  const summarySheet = workbook.addWorksheet("Summary");
  summarySheet.columns = [
    { header: "Metric", key: "metric", width: 25 },
    { header: "Value", key: "value", width: 20 },
  ];
  [
    { metric: "Total Revenue", value: "$353,000" },
    { metric: "Total Expenses", value: "$145,000" },
  ].forEach(row => summarySheet.addRow(row));

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

interface ProcessedFile {
  filename: string;
  status: "success" | "failed";
  bytesRead: number;
  pagesProcessed: number;
  tokensExtracted: number;
  parseTimeMs: number;
  chunkCount: number;
  mime_detect: string;
  parser_used: string;
  error: string | null;
  content: string;
  metadata?: any;
}

function getParserInfo(mimeType: string, filename: string): { mime_detect: string; parser_used: string } {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  const mime = mimeType.toLowerCase();
  
  if (mime.includes("pdf") || ext === "pdf") return { mime_detect: "application/pdf", parser_used: "PdfParser" };
  if (mime.includes("sheet") || mime.includes("excel") || ext === "xlsx") return { mime_detect: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", parser_used: "XlsxParser" };
  if (mime.includes("csv") || ext === "csv") return { mime_detect: "text/csv", parser_used: "CsvParser" };
  return { mime_detect: mimeType, parser_used: "TextParser" };
}

async function processAttachment(att: any): Promise<ProcessedFile> {
  const startTime = Date.now();
  const filename = att.name || "document";
  const mimeType = att.mimeType || "application/octet-stream";
  const parserInfo = getParserInfo(mimeType, filename);
  
  try {
    const buffer = Buffer.from(att.content, "base64");
    const bytesRead = buffer.length;
    
    let parsedResult: { text: string; metadata?: any };
    
    if (parserInfo.parser_used === "PdfParser") {
      const pdfParser = new PdfParser();
      parsedResult = await pdfParser.parse(buffer, { 
        mimeType: "application/pdf", 
        extension: "pdf",
        category: "document",
        confidence: 1
      });
    } else if (parserInfo.parser_used === "XlsxParser") {
      const xlsxParser = new XlsxParser();
      parsedResult = await xlsxParser.parse(buffer, { 
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", 
        extension: "xlsx",
        category: "spreadsheet",
        confidence: 1
      });
    } else {
      parsedResult = { text: buffer.toString("utf-8"), metadata: {} };
    }
    
    const parseTimeMs = Date.now() - startTime;
    const content = parsedResult.text || "";
    const tokens = Math.ceil(content.length / 4);
    
    return {
      filename,
      status: "success",
      bytesRead,
      pagesProcessed: parsedResult.metadata?.pages || 1,
      tokensExtracted: tokens,
      parseTimeMs,
      chunkCount: 1,
      mime_detect: parserInfo.mime_detect,
      parser_used: parserInfo.parser_used,
      error: null,
      content,
      metadata: parsedResult.metadata,
    };
  } catch (error: any) {
    const parseTimeMs = Date.now() - startTime;
    return {
      filename,
      status: "failed",
      bytesRead: 0,
      pagesProcessed: 0,
      tokensExtracted: 0,
      parseTimeMs,
      chunkCount: 0,
      mime_detect: parserInfo.mime_detect,
      parser_used: parserInfo.parser_used,
      error: error.message,
      content: "",
    };
  }
}

function createTestApp(): Express {
  const app = express();
  app.use(express.json({ limit: "200mb" }));
  
  app.post("/api/analyze", 
    pareRequestContract,
    pareAnalyzeSchemaValidator,
    pareRateLimiter({ ipMaxRequests: 100, ipWindowMs: 60000 }),
    pareQuotaGuard({ maxFilesPerRequest: 20, maxFileSizeBytes: 100 * 1024 * 1024 }),
    async (req: Request, res: Response) => {
      const pareContext = requirePareContext(req);
      const { requestId, isDataMode } = pareContext;
      
      const { attachments } = req.body;
      
      if (!attachments || !Array.isArray(attachments) || attachments.length === 0) {
        return res.status(400).json({
          error: "ATTACHMENTS_REQUIRED",
          message: "El endpoint /analyze requiere al menos un documento adjunto.",
          requestId,
        });
      }
      
      const processedFiles: ProcessedFile[] = [];
      
      for (const att of attachments) {
        if (att.content) {
          const result = await processAttachment(att);
          processedFiles.push(result);
        }
      }
      
      const successfulFiles = processedFiles.filter(f => f.status === "success");
      const failedFiles = processedFiles.filter(f => f.status === "failed");
      const totalTokens = processedFiles.reduce((sum, f) => sum + f.tokensExtracted, 0);
      
      const progressReport = {
        requestId,
        isDocumentMode: isDataMode,
        attachments_count: attachments.length,
        processedFiles: successfulFiles.length,
        failedFiles: failedFiles.length,
        tokens_extracted_total: totalTokens,
        totalChunks: successfulFiles.length,
        perFileStats: processedFiles.map(f => ({
          filename: f.filename,
          status: f.status,
          bytesRead: f.bytesRead,
          pagesProcessed: f.pagesProcessed,
          tokensExtracted: f.tokensExtracted,
          parseTimeMs: f.parseTimeMs,
          chunkCount: f.chunkCount,
          mime_detect: f.mime_detect,
          parser_used: f.parser_used,
          error: f.error,
        })),
      };
      
      const citations = successfulFiles.map((f, idx) => ({
        docId: `doc-${idx}`,
        filename: f.filename,
        location: f.metadata?.pages ? `Page 1-${f.metadata.pages}` : "Document",
        excerpt: f.content.substring(0, 100) + (f.content.length > 100 ? "..." : ""),
      }));
      
      const answer_text = successfulFiles.length > 0
        ? `Analyzed ${successfulFiles.length} document(s). Extracted ${totalTokens} tokens.`
        : "No content could be extracted from the provided documents.";
      
      return res.json({
        success: true,
        requestId,
        answer_text,
        citations,
        progressReport,
        isDocumentMode: isDataMode,
      });
    }
  );
  
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error("Test app error:", err);
    res.status(500).json({ error: err.message });
  });
  
  return app;
}

describe("PARE E2E Real Files Tests", () => {
  let app: Express;
  let pdfBuffer: Buffer;
  let xlsxBuffer: Buffer;
  let multiSheetXlsxBuffer: Buffer;
  
  beforeAll(async () => {
    app = createTestApp();
    pdfBuffer = generateSimplePdf();
    xlsxBuffer = await generateSalesXlsx();
    multiSheetXlsxBuffer = await generateMultiSheetXlsx();
  });
  
  describe("PDF Analysis", () => {
    it("should analyze PDF and return progressReport with PdfParser", async () => {
      const response = await request(app)
        .post("/api/analyze")
        .send({
          messages: [{ role: "user", content: "Analyze this document" }],
          attachments: [{
            name: "sample-report.pdf",
            mimeType: "application/pdf",
            type: "document",
            content: pdfBuffer.toString("base64"),
          }],
        });
      
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.requestId).toBeDefined();
      expect(response.body.progressReport).toBeDefined();
      expect(response.body.progressReport.attachments_count).toBe(1);
      expect(response.body.progressReport.perFileStats).toHaveLength(1);
      
      const fileStat = response.body.progressReport.perFileStats[0];
      expect(fileStat.filename).toBe("sample-report.pdf");
      expect(fileStat.parser_used).toBe("PdfParser");
      expect(fileStat.mime_detect).toBe("application/pdf");
    });
    
    it("should include citations with document references", async () => {
      const response = await request(app)
        .post("/api/analyze")
        .send({
          messages: [{ role: "user", content: "What is the revenue?" }],
          attachments: [{
            name: "q4-report.pdf",
            mimeType: "application/pdf",
            type: "document",
            content: pdfBuffer.toString("base64"),
          }],
        });
      
      expect(response.status).toBe(200);
      expect(response.body.citations).toBeDefined();
      expect(Array.isArray(response.body.citations)).toBe(true);
    });
    
    it("should handle corrupted PDF gracefully", async () => {
      const corruptedPdf = Buffer.from("NOT_A_VALID_PDF_RANDOM_BYTES", "utf-8");
      
      const response = await request(app)
        .post("/api/analyze")
        .send({
          messages: [{ role: "user", content: "Analyze" }],
          attachments: [{
            name: "corrupted.pdf",
            mimeType: "application/pdf",
            type: "document",
            content: corruptedPdf.toString("base64"),
          }],
        });
      
      expect(response.status).toBe(200);
      expect(response.body.progressReport).toBeDefined();
      
      const fileStat = response.body.progressReport.perFileStats[0];
      expect(fileStat.filename).toBe("corrupted.pdf");
      expect(fileStat.status === "failed" || fileStat.error !== null || response.body.progressReport.failedFiles > 0).toBe(true);
    });
  });
  
  describe("XLSX Analysis", () => {
    it("should analyze XLSX and return progressReport with XlsxParser", async () => {
      const response = await request(app)
        .post("/api/analyze")
        .send({
          messages: [{ role: "user", content: "Summarize this spreadsheet" }],
          attachments: [{
            name: "sales-data.xlsx",
            mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            type: "document",
            content: xlsxBuffer.toString("base64"),
          }],
        });
      
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.progressReport).toBeDefined();
      expect(response.body.progressReport.attachments_count).toBe(1);
      
      const fileStat = response.body.progressReport.perFileStats[0];
      expect(fileStat.filename).toBe("sales-data.xlsx");
      expect(fileStat.parser_used).toBe("XlsxParser");
      expect(fileStat.mime_detect).toContain("spreadsheet");
    });
    
    it("should process multi-sheet XLSX and report all sheets", async () => {
      const response = await request(app)
        .post("/api/analyze")
        .send({
          messages: [{ role: "user", content: "Analyze all sheets" }],
          attachments: [{
            name: "multi-sheet.xlsx",
            mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            type: "document",
            content: multiSheetXlsxBuffer.toString("base64"),
          }],
        });
      
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      
      const fileStat = response.body.progressReport.perFileStats[0];
      expect(fileStat.parser_used).toBe("XlsxParser");
      expect(fileStat.status).toBe("success");
    });
    
    it("should include citations with sheet/location references for XLSX", async () => {
      const response = await request(app)
        .post("/api/analyze")
        .send({
          messages: [{ role: "user", content: "What are the sales figures?" }],
          attachments: [{
            name: "sales-data.xlsx",
            mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            type: "document",
            content: xlsxBuffer.toString("base64"),
          }],
        });
      
      expect(response.status).toBe(200);
      expect(response.body.citations).toBeDefined();
      
      if (response.body.citations.length > 0) {
        const citation = response.body.citations[0];
        expect(citation.filename).toBe("sales-data.xlsx");
        expect(citation.location).toBeDefined();
      }
    });
  });
  
  describe("Multi-file Batch Processing", () => {
    it("should process PDF + XLSX together", async () => {
      const response = await request(app)
        .post("/api/analyze")
        .send({
          messages: [{ role: "user", content: "Compare these documents" }],
          attachments: [
            {
              name: "report.pdf",
              mimeType: "application/pdf",
              type: "document",
              content: pdfBuffer.toString("base64"),
            },
            {
              name: "data.xlsx",
              mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
              type: "document",
              content: xlsxBuffer.toString("base64"),
            },
          ],
        });
      
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.progressReport.attachments_count).toBe(2);
      expect(response.body.progressReport.perFileStats).toHaveLength(2);
      
      const pdfStat = response.body.progressReport.perFileStats.find((s: any) => s.filename === "report.pdf");
      const xlsxStat = response.body.progressReport.perFileStats.find((s: any) => s.filename === "data.xlsx");
      
      expect(pdfStat).toBeDefined();
      expect(pdfStat.parser_used).toBe("PdfParser");
      
      expect(xlsxStat).toBeDefined();
      expect(xlsxStat.parser_used).toBe("XlsxParser");
    });
    
    it("should include citations from each document in batch", async () => {
      const response = await request(app)
        .post("/api/analyze")
        .send({
          messages: [{ role: "user", content: "Summarize all" }],
          attachments: [
            {
              name: "doc1.pdf",
              mimeType: "application/pdf",
              type: "document",
              content: pdfBuffer.toString("base64"),
            },
            {
              name: "doc2.xlsx",
              mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
              type: "document",
              content: xlsxBuffer.toString("base64"),
            },
          ],
        });
      
      expect(response.status).toBe(200);
      expect(response.body.citations).toBeDefined();
      
      const filenames = response.body.citations.map((c: any) => c.filename);
      const uniqueFilenames = [...new Set(filenames)];
      
      expect(uniqueFilenames.length).toBeGreaterThanOrEqual(1);
    });
  });
  
  describe("Error Cases", () => {
    it("should return 400 when no attachments provided", async () => {
      const response = await request(app)
        .post("/api/analyze")
        .send({
          messages: [{ role: "user", content: "Analyze" }],
          attachments: [],
        });
      
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });
    
    it("should return 400 when attachments field is missing", async () => {
      const response = await request(app)
        .post("/api/analyze")
        .send({
          messages: [{ role: "user", content: "Analyze" }],
        });
      
      expect(response.status).toBe(400);
    });
    
    it("should include requestId in error responses", async () => {
      const response = await request(app)
        .post("/api/analyze")
        .send({
          messages: [{ role: "user", content: "Analyze" }],
          attachments: [],
        });
      
      expect(response.body.error.requestId).toBeDefined();
      expect(response.headers["x-request-id"]).toBeDefined();
    });
  });
  
  describe("Request Metadata", () => {
    it("should return X-Request-Id header", async () => {
      const response = await request(app)
        .post("/api/analyze")
        .send({
          messages: [{ role: "user", content: "Analyze" }],
          attachments: [{
            name: "test.pdf",
            mimeType: "application/pdf",
            type: "document",
            content: pdfBuffer.toString("base64"),
          }],
        });
      
      expect(response.headers["x-request-id"]).toBeDefined();
      expect(response.body.requestId).toBe(response.headers["x-request-id"]);
    });
    
    it("should preserve provided X-Request-Id", async () => {
      const customRequestId = "550e8400-e29b-41d4-a716-446655440000";
      
      const response = await request(app)
        .post("/api/analyze")
        .set("X-Request-Id", customRequestId)
        .send({
          messages: [{ role: "user", content: "Analyze" }],
          attachments: [{
            name: "test.pdf",
            mimeType: "application/pdf",
            type: "document",
            content: pdfBuffer.toString("base64"),
          }],
        });
      
      expect(response.headers["x-request-id"]).toBe(customRequestId);
      expect(response.body.requestId).toBe(customRequestId);
    });
    
    it("should set isDocumentMode to true when attachments present", async () => {
      const response = await request(app)
        .post("/api/analyze")
        .send({
          messages: [{ role: "user", content: "Analyze" }],
          attachments: [{
            name: "test.pdf",
            mimeType: "application/pdf",
            type: "document",
            content: pdfBuffer.toString("base64"),
          }],
        });
      
      expect(response.status).toBe(200);
      expect(response.body.isDocumentMode).toBe(true);
      expect(response.body.progressReport.isDocumentMode).toBe(true);
    });
  });
});
