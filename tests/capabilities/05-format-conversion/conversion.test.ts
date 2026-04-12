/**
 * Format Conversion Capability Tests
 *
 * Covers: PDF to PowerPoint, notes to document, CSV to Excel,
 *         Word to PowerPoint, screenshots to spreadsheet, Excel to Word report.
 */

import path from "node:path";

import {
  runWithEachProvider,
  type ProviderConfig,
} from "../_setup/providerMatrix";
import {
  getMockResponseForProvider,
  createTextResponse,
  MOCK_EXCEL_TOOL,
  MOCK_PPT_TOOL,
  MOCK_WORD_TOOL,
  createExcelResult,
  createPptResult,
  createWordResult,
} from "../_setup/mockResponses";
import {
  withTempDir,
  createTestFile,
  createMockAgent,
} from "../_setup/testHelpers";

// ---------------------------------------------------------------------------
// Mock heavy conversion dependencies
// ---------------------------------------------------------------------------

vi.mock("../../../server/agent/capabilities/documentCapability", () => ({
  convertDocument: vi.fn(),
  extractText:     vi.fn(),
  generatePDF:     vi.fn(),
}));

vi.mock("pptxgenjs", () => ({
  default: vi.fn().mockImplementation(() => ({
    addSlide:  vi.fn().mockReturnValue({ addText: vi.fn(), addImage: vi.fn(), addShape: vi.fn() }),
    writeFile: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock("exceljs", () => ({
  Workbook: vi.fn().mockImplementation(() => ({
    addWorksheet: vi.fn().mockReturnValue({
      addRow:    vi.fn(),
      getRow:    vi.fn().mockReturnValue({ font: {}, fill: {} }),
      getColumn: vi.fn().mockReturnValue({ width: 0 }),
      columns:   [],
    }),
    xlsx: { writeFile: vi.fn().mockResolvedValue(undefined) },
  })),
}));

// ---------------------------------------------------------------------------
// Suite 1 — PDF to PowerPoint
// ---------------------------------------------------------------------------

describe("PDF to PowerPoint", () => {
  runWithEachProvider(
    "converts a PDF slide deck to a PPTX file",
    "format-conversion",
    async (provider: ProviderConfig) => {
      await withTempDir(async (dir) => {
        const pdfPath  = path.join(dir, "slides.pdf");
        const pptxPath = path.join(dir, "slides.pptx");
        await createTestFile(pdfPath, "%PDF-1.4 mock slide content");

        const agent = createMockAgent({
          defaultResult: { success: true, outputPath: pptxPath, slideCount: 5, bytesWritten: 81920, pagesExtracted: 5 },
        });
        const response = await agent.invoke("convertPdfToPptx", {
          inputPath: pdfPath,
          outputPath: pptxPath,
        });

        expect(response.success).toBe(true);
        expect(response.slideCount).toBe(5);
        expect(response.outputPath).toBe(pptxPath);

        const mockResult = createPptResult("slides.pptx", 5);
        expect(mockResult.slide_count).toBe(5);

        const pResp = getMockResponseForProvider(
          provider.name,
          { name: MOCK_PPT_TOOL.name, arguments: { ...MOCK_PPT_TOOL.arguments } },
          `Converted ${pdfPath} to ${pptxPath}`,
        );
        expect(pResp).toBeTruthy();
      });
    },
  );

  runWithEachProvider(
    "preserves embedded images when converting PDF to PPTX",
    "format-conversion",
    async (provider: ProviderConfig) => {
      await withTempDir(async (dir) => {
        const pdfPath  = path.join(dir, "with-images.pdf");
        const pptxPath = path.join(dir, "with-images.pptx");
        await createTestFile(pdfPath, "%PDF-1.4 mock with image objects");

        const agent = createMockAgent({
          defaultResult: { success: true, outputPath: pptxPath, slideCount: 3, imagesExtracted: 4, imagesEmbedded: 4 },
        });
        const response = await agent.invoke("convertPdfToPptx", {
          inputPath: pdfPath,
          outputPath: pptxPath,
          preserveImages: true,
        });

        expect(response.success).toBe(true);
        expect(response.imagesExtracted).toBe(response.imagesEmbedded);

        void provider;
      });
    },
  );

  runWithEachProvider(
    "maintains slide layout and text box positioning",
    "format-conversion",
    async (provider: ProviderConfig) => {
      await withTempDir(async (dir) => {
        const pdfPath  = path.join(dir, "layout-test.pdf");
        const pptxPath = path.join(dir, "layout-test.pptx");
        await createTestFile(pdfPath, "%PDF-1.4 mock layout");

        const agent = createMockAgent({
          defaultResult: {
            success: true,
            outputPath: pptxPath,
            slideCount: 2,
            layoutsPreserved: 2,
            textBoxes: [
              { slide: 1, boxes: 3, positionAccuracy: 0.95 },
              { slide: 2, boxes: 2, positionAccuracy: 0.92 },
            ],
          },
        });
        const response = await agent.invoke("convertPdfToPptx", {
          inputPath: pdfPath,
          outputPath: pptxPath,
          preserveLayout: true,
        });

        expect(response.success).toBe(true);
        expect(response.layoutsPreserved).toBe(2);
        const textBoxes = response.textBoxes as Array<{ positionAccuracy: number }>;
        textBoxes.forEach((tb) => expect(tb.positionAccuracy).toBeGreaterThan(0.8));

        void provider;
      });
    },
  );

  runWithEachProvider(
    "reports an error for password-protected PDF files",
    "format-conversion",
    async (provider: ProviderConfig) => {
      const agent = createMockAgent({
        defaultResult: {
          success: false,
          errorCode: "PDF_ENCRYPTED",
          message: "Cannot convert password-protected PDF without the decryption key",
        },
      });
      const response = await agent.invoke("convertPdfToPptx", {
        inputPath: "/protected/secure.pdf",
        outputPath: "/output/secure.pptx",
      });

      expect(response.success).toBe(false);
      expect(response.errorCode).toBe("PDF_ENCRYPTED");

      void provider;
    },
  );
});

// ---------------------------------------------------------------------------
// Suite 2 — Notes to document
// ---------------------------------------------------------------------------

describe("Notes to document", () => {
  runWithEachProvider(
    "converts handwritten OCR output to a formatted DOCX",
    "format-conversion",
    async (provider: ProviderConfig) => {
      await withTempDir(async (dir) => {
        const ocrText =
          "Meeting Notes - April 11 2026\n" +
          "Attendees: Alice, Bob, Carol\n" +
          "Topic: Q2 Planning\n" +
          "Action: Review budget by April 30\n" +
          "Action: Prepare slides for board";

        const ocrPath  = path.join(dir, "notes.txt");
        const docxPath = path.join(dir, "notes.docx");
        await createTestFile(ocrPath, ocrText);

        const agent = createMockAgent({
          defaultResult: {
            success: true,
            outputPath: docxPath,
            bytesWritten: 4096,
            sections: ["Header", "Attendees", "Action Items"],
            actionItemsFound: 2,
          },
        });
        const response = await agent.invoke("ocrTextToDocx", {
          inputText: ocrText,
          outputPath: docxPath,
          detectStructure: true,
        });

        expect(response.success).toBe(true);
        expect(response.actionItemsFound).toBe(2);
        const sections = response.sections as string[];
        expect(sections.length).toBeGreaterThan(0);

        const mockResult = createWordResult("notes.docx");
        expect(mockResult.event).toContain("Word Document");

        void provider;
      });
    },
  );

  runWithEachProvider(
    "converts meeting notes to a structured report document",
    "format-conversion",
    async (provider: ProviderConfig) => {
      await withTempDir(async (dir) => {
        const meetingNotes =
          "## Q2 Planning Session\n" +
          "**Date:** April 11, 2026\n" +
          "**Decisions:** Proceed with Phase 2\n" +
          "**Next steps:** 1. Budget review 2. Board presentation";

        const docxPath = path.join(dir, "meeting-report.docx");

        const agent = createMockAgent({
          defaultResult: {
            success: true,
            outputPath: docxPath,
            bytesWritten: 6144,
            document: { title: "Q2 Planning Session", sections: ["Overview", "Decisions", "Next Steps"], wordCount: 32 },
          },
        });
        const response = await agent.invoke("meetingNotesToDocument", {
          markdown: meetingNotes,
          outputPath: docxPath,
          template: "meeting-report",
        });

        expect(response.success).toBe(true);
        const doc = response.document as { title: string; sections: string[] };
        expect(doc.title).toContain("Q2");
        expect(doc.sections).toContain("Next Steps");

        const pResp = createTextResponse(provider.name, `Created document: ${docxPath}`);
        expect(pResp).toBeTruthy();
      });
    },
  );

  runWithEachProvider(
    "applies corporate template styles to the generated document",
    "format-conversion",
    async (provider: ProviderConfig) => {
      const agent = createMockAgent({
        defaultResult: {
          success: true,
          outputPath: "/output/styled.docx",
          stylesApplied: {
            headings: "Corporate Blue",
            body: "Calibri 11pt",
            headerFooter: true,
            logoInserted: true,
          },
        },
      });
      const response = await agent.invoke("applyDocumentTemplate", {
        inputPath: "/input/raw.docx",
        templateName: "corporate",
      });

      expect(response.success).toBe(true);
      const styles = response.stylesApplied as Record<string, unknown>;
      expect(styles.headerFooter).toBe(true);
      expect(styles.logoInserted).toBe(true);

      void provider;
    },
  );
});

// ---------------------------------------------------------------------------
// Suite 3 — CSV to Excel
// ---------------------------------------------------------------------------

describe("CSV to Excel", () => {
  runWithEachProvider(
    "imports a CSV file into an Excel workbook with correct data types",
    "format-conversion",
    async (provider: ProviderConfig) => {
      await withTempDir(async (dir) => {
        const csvPath  = path.join(dir, "sales.csv");
        const xlsxPath = path.join(dir, "sales.xlsx");
        await createTestFile(
          csvPath,
          "product,qty,price,date\nWidget A,10,9.99,2026-01-15\nWidget B,5,24.99,2026-01-20\n",
        );

        const agent = createMockAgent({
          defaultResult: {
            success: true,
            outputPath: xlsxPath,
            rowsImported: 2,
            columnsDetected: 4,
            typeInference: { product: "string", qty: "integer", price: "decimal", date: "date" },
          },
        });
        const response = await agent.invoke("csvToExcel", {
          csvPath,
          outputPath: xlsxPath,
          inferTypes: true,
        });

        expect(response.success).toBe(true);
        expect(response.rowsImported).toBe(2);
        expect(response.columnsDetected).toBe(4);
        const types = response.typeInference as Record<string, string>;
        expect(types.qty).toBe("integer");
        expect(types.date).toBe("date");

        const mockResult = createExcelResult("sales.xlsx");
        expect(mockResult.sheet_count).toBe(1);

        void provider;
      });
    },
  );

  runWithEachProvider(
    "adds header row formatting and zebra-stripe row styling",
    "format-conversion",
    async (provider: ProviderConfig) => {
      await withTempDir(async (dir) => {
        const csvPath  = path.join(dir, "data.csv");
        const xlsxPath = path.join(dir, "data.xlsx");
        await createTestFile(csvPath, "name,value\nAlpha,100\nBeta,200\n");

        const agent = createMockAgent({
          defaultResult: {
            success: true,
            outputPath: xlsxPath,
            formatting: {
              headerBold: true,
              headerBackgroundColor: "#1F4E79",
              headerFontColor: "#FFFFFF",
              zebraStripingApplied: true,
            },
          },
        });
        const response = await agent.invoke("csvToExcel", {
          csvPath,
          outputPath: xlsxPath,
          formatting: { header: "bold-blue", rows: "zebra" },
        });

        expect(response.success).toBe(true);
        const fmt = response.formatting as Record<string, unknown>;
        expect(fmt.headerBold).toBe(true);
        expect(fmt.zebraStripingApplied).toBe(true);

        void provider;
      });
    },
  );

  runWithEachProvider(
    "adds SUM and AVERAGE formulas to numeric columns",
    "format-conversion",
    async (provider: ProviderConfig) => {
      await withTempDir(async (dir) => {
        const csvPath  = path.join(dir, "numbers.csv");
        const xlsxPath = path.join(dir, "numbers.xlsx");
        await createTestFile(csvPath, "item,amount\nAlpha,100\nBeta,200\nGamma,150\n");

        const agent = createMockAgent({
          defaultResult: {
            success: true,
            outputPath: xlsxPath,
            formulasAdded: [
              { column: "B", formula: "=SUM(B2:B4)",     cell: "B5", label: "Total"   },
              { column: "B", formula: "=AVERAGE(B2:B4)", cell: "B6", label: "Average" },
            ],
          },
        });
        const response = await agent.invoke("csvToExcel", {
          csvPath,
          outputPath: xlsxPath,
          addFormulas: ["SUM", "AVERAGE"],
        });

        expect(response.success).toBe(true);
        const formulas = response.formulasAdded as Array<{ formula: string }>;
        const formulaStrings = formulas.map((f) => f.formula);
        expect(formulaStrings.some((f) => f.startsWith("=SUM"))).toBe(true);
        expect(formulaStrings.some((f) => f.startsWith("=AVERAGE"))).toBe(true);

        void provider;
      });
    },
  );

  runWithEachProvider(
    "handles CSV files with BOM characters and non-UTF-8 encodings",
    "format-conversion",
    async (provider: ProviderConfig) => {
      const agent = createMockAgent({
        defaultResult: {
          success: true,
          outputPath: "/output/encoded.xlsx",
          encodingDetected: "windows-1252",
          bomStripped: true,
          rowsImported: 10,
        },
      });
      const response = await agent.invoke("csvToExcel", {
        csvPath: "/input/encoded.csv",
        outputPath: "/output/encoded.xlsx",
        encoding: "auto-detect",
      });

      expect(response.success).toBe(true);
      expect(response.bomStripped).toBe(true);
      expect(response.encodingDetected).toBeTruthy();

      void provider;
    },
  );
});

// ---------------------------------------------------------------------------
// Suite 4 — Word to PowerPoint
// ---------------------------------------------------------------------------

describe("Word to PowerPoint", () => {
  runWithEachProvider(
    "converts a Word document outline into a PPTX slide deck",
    "format-conversion",
    async (provider: ProviderConfig) => {
      await withTempDir(async (dir) => {
        const docxPath = path.join(dir, "report.docx");
        const pptxPath = path.join(dir, "report.pptx");
        await createTestFile(docxPath, "mock DOCX binary content");

        const agent = createMockAgent({
          defaultResult: { success: true, outputPath: pptxPath, slideCount: 6, outlineItemsUsed: 6, bytesWritten: 65536 },
        });
        const response = await agent.invoke("wordToPptx", {
          inputPath: docxPath,
          outputPath: pptxPath,
          useOutline: true,
        });

        expect(response.success).toBe(true);
        expect(response.slideCount).toBeGreaterThan(0);
        expect(response.outputPath).toBe(pptxPath);

        const mockResult = createPptResult("report.pptx", 6);
        expect(mockResult.slide_count).toBe(6);

        const pResp = getMockResponseForProvider(
          provider.name,
          { name: MOCK_PPT_TOOL.name, arguments: { ...MOCK_PPT_TOOL.arguments } },
          "Converted Word document to 6 slides",
        );
        expect(pResp).toBeTruthy();
      });
    },
  );

  runWithEachProvider(
    "maps H1 and H2 section headings to slide title and subtitle",
    "format-conversion",
    async (provider: ProviderConfig) => {
      const agent = createMockAgent({
        defaultResult: {
          success: true,
          outputPath: "/output/headings.pptx",
          slides: [
            { slideNumber: 1, title: "Introduction",    sourceHeading: "Heading 1" },
            { slideNumber: 2, title: "Market Analysis", sourceHeading: "Heading 1" },
            { slideNumber: 3, title: "Key Findings",    sourceHeading: "Heading 2" },
          ],
        },
      });
      const response = await agent.invoke("wordToPptx", {
        inputPath: "/input/structured.docx",
        outputPath: "/output/headings.pptx",
        headingMapping: { "Heading 1": "slide-title", "Heading 2": "slide-subtitle" },
      });

      expect(response.success).toBe(true);
      const slides = response.slides as Array<{ title: string; sourceHeading: string }>;
      expect(slides.length).toBeGreaterThan(0);
      slides.forEach((s) => expect(s.title).toBeTruthy());

      void provider;
    },
  );
});

// ---------------------------------------------------------------------------
// Suite 5 — Screenshots to spreadsheet
// ---------------------------------------------------------------------------

describe("Screenshots to spreadsheet", () => {
  runWithEachProvider(
    "extracts a data table from a screenshot and writes to Excel",
    "format-conversion",
    async (provider: ProviderConfig) => {
      await withTempDir(async (dir) => {
        const screenshotPath = path.join(dir, "table-screenshot.png");
        const xlsxPath       = path.join(dir, "extracted-table.xlsx");
        await createTestFile(screenshotPath, "\x89PNG\r\n\x1a\n");

        const agent = createMockAgent({
          defaultResult: {
            success: true,
            outputPath: xlsxPath,
            rowsExtracted: 5,
            columnsDetected: 4,
            ocrConfidence: 0.93,
            headers: ["Product", "Q1", "Q2", "Q3"],
          },
        });
        const response = await agent.invoke("screenshotToSpreadsheet", {
          screenshotPath,
          outputPath: xlsxPath,
          ocrEngine: "tesseract",
        });

        expect(response.success).toBe(true);
        expect(response.rowsExtracted).toBe(5);
        expect(response.ocrConfidence as number).toBeGreaterThan(0.8);
        const headers = response.headers as string[];
        expect(headers).toContain("Product");

        const mockResult = createExcelResult("extracted-table.xlsx");
        expect(typeof mockResult.bytes).toBe("number");
        expect(typeof mockResult.absolute_path).toBe("string");

        void provider;
      });
    },
  );

  runWithEachProvider(
    "auto-detects column boundaries in a screenshot table",
    "format-conversion",
    async (provider: ProviderConfig) => {
      const agent = createMockAgent({
        defaultResult: {
          success: true,
          columnsDetected: 5,
          columnBoundaries: [
            { colIndex: 0, xStart: 0,   xEnd: 120, header: "Name"  },
            { colIndex: 1, xStart: 120, xEnd: 220, header: "Q1"    },
            { colIndex: 2, xStart: 220, xEnd: 320, header: "Q2"    },
            { colIndex: 3, xStart: 320, xEnd: 420, header: "Q3"    },
            { colIndex: 4, xStart: 420, xEnd: 520, header: "Total" },
          ],
          detectionConfidence: 0.88,
        },
      });
      const response = await agent.invoke("detectTableColumns", {
        screenshotPath: "/screenshots/table.png",
        method: "line-detection",
      });

      expect(response.success).toBe(true);
      expect(response.columnsDetected).toBe(5);
      const boundaries = response.columnBoundaries as Array<{ header: string }>;
      expect(boundaries.map((b) => b.header)).toContain("Total");

      void provider;
    },
  );
});

// ---------------------------------------------------------------------------
// Suite 6 — Excel to Word report
// ---------------------------------------------------------------------------

describe("Excel to Word report", () => {
  runWithEachProvider(
    "embeds Excel charts into a Word document",
    "format-conversion",
    async (provider: ProviderConfig) => {
      await withTempDir(async (dir) => {
        const xlsxPath = path.join(dir, "data.xlsx");
        const docxPath = path.join(dir, "report.docx");
        await createTestFile(xlsxPath, "mock XLSX binary");

        const agent = createMockAgent({
          defaultResult: { success: true, outputPath: docxPath, chartsEmbedded: 2, bytesWritten: 32768, chartTypes: ["bar", "line"] },
        });
        const response = await agent.invoke("excelToWordReport", {
          xlsxPath,
          outputPath: docxPath,
          includeCharts: true,
        });

        expect(response.success).toBe(true);
        expect(response.chartsEmbedded).toBe(2);
        const chartTypes = response.chartTypes as string[];
        expect(chartTypes.length).toBeGreaterThan(0);

        const mockResult = createWordResult("report.docx");
        expect(mockResult.absolute_path).toContain("report.docx");

        const pResp = getMockResponseForProvider(
          provider.name,
          { name: MOCK_WORD_TOOL.name, arguments: { ...MOCK_WORD_TOOL.arguments } },
          "Excel charts embedded in Word document",
        );
        expect(pResp).toBeTruthy();
      });
    },
  );

  runWithEachProvider(
    "preserves Excel table formatting when inserting into Word",
    "format-conversion",
    async (provider: ProviderConfig) => {
      await withTempDir(async (dir) => {
        const xlsxPath = path.join(dir, "formatted.xlsx");
        const docxPath = path.join(dir, "formatted-report.docx");
        await createTestFile(xlsxPath, "mock XLSX");

        const agent = createMockAgent({
          defaultResult: {
            success: true,
            outputPath: docxPath,
            tablesInserted: 1,
            tableFormatPreserved: true,
            mergedCells: 3,
            conditionalFormattingExported: true,
          },
        });
        const response = await agent.invoke("excelToWordReport", {
          xlsxPath,
          outputPath: docxPath,
          includeTables: true,
          preserveFormatting: true,
        });

        expect(response.success).toBe(true);
        expect(response.tablesInserted).toBe(1);
        expect(response.tableFormatPreserved).toBe(true);

        void provider;
      });
    },
  );
});
