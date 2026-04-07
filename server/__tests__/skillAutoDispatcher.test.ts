import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — vi.mock factories are hoisted, no external variable references
// ---------------------------------------------------------------------------
vi.mock("../lib/llmGateway", () => ({
  llmGateway: {
    chat: vi.fn().mockResolvedValue({
      content: JSON.stringify({
        sheetName: "Data",
        headers: ["Name", "Value"],
        rows: [["Item A", "100"], ["Item B", "200"]],
        title: "Test Spreadsheet",
      }),
    }),
  },
}));

vi.mock("../services/libraryService", () => ({
  libraryService: {
    generateUploadUrl: vi.fn().mockResolvedValue({ uploadUrl: "http://mock", objectPath: "mock" }),
    saveFileMetadata: vi.fn().mockResolvedValue({ uuid: "mock-uuid", storageUrl: "http://mock" }),
  },
}));

vi.mock("../services/imageGeneration", () => ({
  generateImage: vi.fn().mockResolvedValue({ base64Data: "iVBOR...", error: null }),
  detectImageRequest: vi.fn().mockReturnValue(false),
  extractImagePrompt: vi.fn().mockReturnValue("test image"),
}));

vi.mock("../services/videoGeneration", () => ({
  generateVideo: vi.fn().mockResolvedValue({ videoUrl: "http://mock-video" }),
  detectVideoRequest: vi.fn().mockReturnValue(false),
  extractVideoPrompt: vi.fn().mockReturnValue("test video"),
}));

vi.mock("../services/academicSearchService", () => ({
  academicSearchService: {
    search: vi.fn().mockResolvedValue({ results: [] }),
  },
}));

vi.mock("../services/pythonSandbox", () => ({
  safeExecutePython: vi.fn().mockResolvedValue({ output: "Hello World", error: undefined }),
}));

vi.mock("../services/pdfGeneration", () => ({
  generatePdfFromHtml: vi.fn().mockResolvedValue(Buffer.from("%PDF-1.4 mock pdf content")),
}));

vi.mock("../services/productionHandler", () => ({
  handleProductionRequest: vi.fn(),
  isProductionIntent: vi.fn().mockReturnValue(false),
  getDeliverables: vi.fn().mockReturnValue([]),
}));

vi.mock("../services/markdownToDocx", () => ({
  generateWordFromMarkdown: vi.fn().mockResolvedValue(Buffer.from("PK\x03\x04mock-docx-content")),
}));

vi.mock("../services/docxCodeGenerator", () => ({
  generateProfessionalDocument: vi.fn().mockResolvedValue({ buffer: Buffer.from("PK\x03\x04mock-docx") }),
}));

vi.mock("../services/enterpriseDocumentService", () => {
  class MockEnterpriseDocumentService {
    generateDocument = vi.fn().mockResolvedValue({ success: true, buffer: Buffer.from("mock") });
  }
  return {
    EnterpriseDocumentService: MockEnterpriseDocumentService,
    WordDocumentGenerator: class {},
    ExcelDocumentGenerator: class {},
  };
});

vi.mock("../services/advancedExcelBuilder", () => ({
  createExcelFromData: vi.fn().mockResolvedValue({ buffer: Buffer.from("mock-xlsx"), filename: "test.xlsx" }),
  createMultiSheetExcel: vi.fn().mockResolvedValue({ buffer: Buffer.from("mock-xlsx"), filename: "test.xlsx" }),
  AdvancedExcelBuilder: vi.fn().mockImplementation(() => ({
    getWorkbook: vi.fn().mockReturnValue({ creator: "" }),
    addSheet: vi.fn(),
    addSummarySheet: vi.fn(),
    build: vi.fn().mockResolvedValue(Buffer.from("PK\x03\x04mock-xlsx-content")),
  })),
}));

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: vi.fn().mockReturnValue(true),
      mkdirSync: vi.fn(),
      promises: {
        ...actual.promises,
        writeFile: vi.fn().mockResolvedValue(undefined),
      },
    },
    existsSync: vi.fn().mockReturnValue(true),
    mkdirSync: vi.fn(),
    promises: {
      ...actual.promises,
      writeFile: vi.fn().mockResolvedValue(undefined),
    },
  };
});

vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------
import { skillAutoDispatcher } from "../services/skillAutoDispatcher";
import { llmGateway } from "../lib/llmGateway";
import type { IntentResult } from "../../shared/schemas/intent";

const llmChatMock = llmGateway.chat as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeIntent(
  intent: string,
  confidence = 0.85,
  output_format?: string,
): IntentResult {
  return {
    intent,
    confidence,
    output_format: output_format || null,
    language_detected: "es",
    slots: { topic: "test" },
    matched_patterns: [],
    fallback_used: false,
    clarification_question: null,
  } as IntentResult;
}

function baseRequest(message: string, intentResult: IntentResult | null = null) {
  return {
    message,
    intentResult,
    userId: "test-user",
    chatId: "test-chat",
    locale: "es",
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("skillAutoDispatcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    llmChatMock.mockResolvedValue({
      content: JSON.stringify({
        sheetName: "Data",
        headers: ["Name", "Value"],
        rows: [["Item A", "100"], ["Item B", "200"]],
        title: "Test Spreadsheet",
      }),
    });
  });

  // ==========================================================================
  // 1. Document-related intents dispatch to the document skill
  // ==========================================================================

  describe("document intent dispatch", () => {
    it("dispatches CREATE_DOCUMENT intent to the Word document handler", async () => {
      llmChatMock.mockResolvedValueOnce({
        content: "# Business Report\n\nQuarterly performance analysis.",
      });

      const result = await skillAutoDispatcher.dispatch(
        baseRequest("crea un documento Word sobre estrategia empresarial", makeIntent("CREATE_DOCUMENT", 0.9, "docx")),
      );

      expect(result.handled).toBe(true);
      expect(result.category).toContain("document");
      expect(result.artifacts.length).toBeGreaterThanOrEqual(1);
      expect(result.artifacts[0].mimeType).toContain("wordprocessingml");
      expect(result.artifacts[0].filename).toMatch(/\.docx$/);
    });

    it("dispatches CREATE_SPREADSHEET intent to the Excel handler", async () => {
      const result = await skillAutoDispatcher.dispatch(
        baseRequest("genera un Excel con datos de ventas", makeIntent("CREATE_SPREADSHEET", 0.9, "xlsx")),
      );

      expect(result.handled).toBe(true);
      expect(result.category).toContain("document");
      expect(result.artifacts[0].mimeType).toContain("spreadsheetml");
      expect(result.artifacts[0].filename).toMatch(/\.xlsx$/);
    });

    it("dispatches CREATE_PRESENTATION intent to the PowerPoint handler", async () => {
      llmChatMock.mockResolvedValueOnce({
        content: JSON.stringify([
          { title: "Overview", bullets: ["Key insight 1", "Key insight 2"] },
          { title: "Details", bullets: ["Metric A", "Metric B"] },
        ]),
      });

      const result = await skillAutoDispatcher.dispatch(
        baseRequest("haz una presentación sobre IA", makeIntent("CREATE_PRESENTATION", 0.9, "pptx")),
      );

      expect(result.handled).toBe(true);
      expect(result.artifacts[0].mimeType).toContain("presentationml");
      expect(result.artifacts[0].filename).toMatch(/\.pptx$/);
    });
  });

  // ==========================================================================
  // 2. File format detection (keyword-based matching for docx, xlsx, pptx, pdf)
  // ==========================================================================

  describe("file format detection via keywords", () => {
    it("detects .docx from Word-related keywords", () => {
      const match = skillAutoDispatcher.matchSkill(
        "crear un documento word con el reporte anual",
        null,
      );
      expect(match).not.toBeNull();
      expect(match!.skillId).toBe("word");
      expect(match!.mapping.outputFormat).toBe("docx");
      expect(match!.matchedVia).toBe("keyword");
    });

    it("detects .xlsx from Excel/spreadsheet keywords", () => {
      const match = skillAutoDispatcher.matchSkill(
        "genera una hoja de cálculo con presupuesto",
        null,
      );
      expect(match).not.toBeNull();
      expect(match!.skillId).toBe("excel");
      expect(match!.mapping.outputFormat).toBe("xlsx");
    });

    it("detects .pptx from presentation keywords", () => {
      const match = skillAutoDispatcher.matchSkill(
        "necesito diapositivas para la conferencia",
        null,
      );
      expect(match).not.toBeNull();
      expect(match!.skillId).toBe("powerpoint");
      expect(match!.mapping.outputFormat).toBe("pptx");
    });

    it("detects .pdf from PDF-related keywords", () => {
      const match = skillAutoDispatcher.matchSkill(
        "convertir a documento pdf",
        null,
      );
      expect(match).not.toBeNull();
      expect(match!.skillId).toBe("pdf");
      expect(match!.mapping.outputFormat).toBe("pdf");
    });

    it("detects .csv from CSV keywords", () => {
      const match = skillAutoDispatcher.matchSkill(
        "exporta los datos como CSV",
        null,
      );
      expect(match).not.toBeNull();
      expect(match!.skillId).toBe("csv");
      expect(match!.mapping.outputFormat).toBe("csv");
    });
  });

  // ==========================================================================
  // 3. Edge cases (empty input, malformed requests)
  // ==========================================================================

  describe("edge cases", () => {
    it("returns handled=false for an empty message with no intent", async () => {
      const result = await skillAutoDispatcher.dispatch({
        message: "",
        intentResult: null,
        userId: "",
        chatId: "",
        locale: "es",
      });

      expect(result.handled).toBe(false);
      expect(result.artifacts).toHaveLength(0);
      expect(result.skillId).toBe("");
    });

    it("returns handled=false when intent is NEED_CLARIFICATION", async () => {
      const result = await skillAutoDispatcher.dispatch(
        baseRequest("no entiendo bien", makeIntent("NEED_CLARIFICATION", 0.5)),
      );

      expect(result.handled).toBe(false);
      expect(result.artifacts).toHaveLength(0);
    });

    it("returns handled=false for whitespace-only message without matching intent", async () => {
      const result = await skillAutoDispatcher.dispatch(
        baseRequest("   ", null),
      );

      expect(result.handled).toBe(false);
      expect(result.artifacts).toHaveLength(0);
    });
  });

  // ==========================================================================
  // 4. Non-document intents do NOT trigger document generation
  // ==========================================================================

  describe("non-document intents must not trigger document generation", () => {
    it("CHAT_GENERAL intent does NOT produce any artifacts", async () => {
      const result = await skillAutoDispatcher.dispatch(
        baseRequest("hola, cómo estás hoy?", makeIntent("CHAT_GENERAL", 0.95)),
      );

      expect(result.handled).toBe(false);
      expect(result.artifacts).toHaveLength(0);
      expect(result.skillId).toBe("");
    });

    it("generic greeting without intent does NOT match a document skill", () => {
      const match = skillAutoDispatcher.matchSkill(
        "buenos días, cuéntame un chiste",
        null,
      );

      expect(match).toBeNull();
    });

    it("code execution intent routes to code handler, not document handler", () => {
      const match = skillAutoDispatcher.matchSkill(
        "ejecuta un script python",
        makeIntent("EXECUTE_CODE", 0.85),
      );

      expect(match).not.toBeNull();
      expect(match!.mapping.handler).toBe("code_execution");
      expect(match!.mapping.handler).not.toBe("document");
    });

    it("web search keyword matches search handler, not document handler", () => {
      const match = skillAutoDispatcher.matchSkill(
        "buscar en internet sobre machine learning",
        null,
      );

      expect(match).not.toBeNull();
      expect(match!.mapping.handler).toBe("search");
      expect(match!.mapping.handler).not.toBe("document");
    });
  });

  // ==========================================================================
  // Metrics tracking
  // ==========================================================================

  describe("metrics tracking", () => {
    it("includes latency metrics when a skill is handled", async () => {
      llmChatMock.mockResolvedValueOnce({ content: "Name,Age\nAlice,30" });

      const result = await skillAutoDispatcher.dispatch(
        baseRequest("exporta datos como CSV"),
      );

      if (result.handled) {
        expect(result.metrics).toBeDefined();
        expect(result.metrics!.latencyMs).toBeGreaterThanOrEqual(0);
        expect(result.metrics!.handlerUsed).toBeTruthy();
      }
    });
  });
});
