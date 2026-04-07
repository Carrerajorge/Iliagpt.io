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

// Mock fs to prevent real file writes during artifact saving
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
  // Keyword Matching (pure logic, no I/O)
  // ==========================================================================

  describe("keyword matching", () => {
    it("matches Word keywords", () => {
      const match = skillAutoDispatcher.matchSkill(
        "necesito crear un documento word sobre biología",
        null,
      );
      expect(match).not.toBeNull();
      expect(match!.skillId).toBe("word");
      expect(match!.matchedVia).toBe("keyword");
    });

    it("matches Excel keywords in Spanish", () => {
      const match = skillAutoDispatcher.matchSkill(
        "genera una hoja de cálculo con estadísticas",
        null,
      );
      expect(match).not.toBeNull();
      expect(match!.skillId).toBe("excel");
    });

    it("matches PowerPoint keywords", () => {
      const match = skillAutoDispatcher.matchSkill(
        "necesito diapositivas para la reunión",
        null,
      );
      expect(match).not.toBeNull();
      expect(match!.skillId).toBe("powerpoint");
    });

    it("matches PDF keyword", () => {
      const match = skillAutoDispatcher.matchSkill(
        "convertir a documento pdf",
        null,
      );
      expect(match).not.toBeNull();
      expect(match!.skillId).toBe("pdf");
    });

    it("matches web search keywords", () => {
      const match = skillAutoDispatcher.matchSkill(
        "buscar online sobre energías renovables",
        null,
      );
      expect(match).not.toBeNull();
      expect(match!.skillId).toBe("web_search");
    });

    it("matches code execution keywords", () => {
      const match = skillAutoDispatcher.matchSkill(
        "ejecuta este código python",
        null,
      );
      expect(match).not.toBeNull();
      expect(match!.skillId).toBe("code_execution");
    });

    it("matches image generation keywords", () => {
      const match = skillAutoDispatcher.matchSkill(
        "crear imagen de un paisaje tropical",
        null,
      );
      expect(match).not.toBeNull();
      expect(match!.skillId).toBe("generate_image");
    });

    it("matches CSV keyword", () => {
      const match = skillAutoDispatcher.matchSkill(
        "exporta los datos como CSV",
        null,
      );
      expect(match).not.toBeNull();
      expect(match!.skillId).toBe("csv");
    });

    it("matches Docker keyword → automation handler", () => {
      const match = skillAutoDispatcher.matchSkill(
        "crea un dockerfile para mi aplicación node",
        null,
      );
      expect(match).not.toBeNull();
      expect(match!.skillId).toBe("docker");
      expect(match!.mapping.handler).toBe("automation");
    });

    it("returns null for unmatched messages", () => {
      const match = skillAutoDispatcher.matchSkill(
        "cuéntame un chiste",
        null,
      );
      expect(match).toBeNull();
    });

    it("prefers longer keyword matches (higher specificity)", () => {
      const match = skillAutoDispatcher.matchSkill(
        "busca artículos en google scholar sobre redes neuronales",
        null,
      );
      expect(match).not.toBeNull();
      expect(match!.skillId).toBe("academic_search");
    });

    it("matches integration keywords (Gmail)", () => {
      const match = skillAutoDispatcher.matchSkill(
        "revisa mi bandeja de entrada de gmail",
        null,
      );
      expect(match).not.toBeNull();
      expect(match!.skillId).toBe("gmail");
      expect(match!.mapping.handler).toBe("integration");
    });

    it("matches integration keywords (Slack)", () => {
      const match = skillAutoDispatcher.matchSkill(
        "envía un mensaje slack al equipo",
        null,
      );
      expect(match).not.toBeNull();
      expect(match!.skillId).toBe("slack");
    });
  });

  // ==========================================================================
  // Intent-based matching
  // ==========================================================================

  describe("intent-based matching", () => {
    it("matches CREATE_DOCUMENT intent to Word", () => {
      const match = skillAutoDispatcher.matchSkill(
        "crea un documento sobre IA",
        makeIntent("CREATE_DOCUMENT", 0.9, "docx"),
      );
      expect(match).not.toBeNull();
      expect(match!.skillId).toBe("word");
      expect(match!.matchedVia).toBe("intent");
    });

    it("matches CREATE_SPREADSHEET intent to Excel", () => {
      const match = skillAutoDispatcher.matchSkill(
        "genera un reporte de datos",
        makeIntent("CREATE_SPREADSHEET", 0.9, "xlsx"),
      );
      expect(match).not.toBeNull();
      expect(match!.skillId).toBe("excel");
      expect(match!.matchedVia).toBe("intent");
    });

    it("matches CREATE_PRESENTATION intent to PowerPoint", () => {
      const match = skillAutoDispatcher.matchSkill(
        "haz unas diapositivas",
        makeIntent("CREATE_PRESENTATION", 0.9, "pptx"),
      );
      expect(match).not.toBeNull();
      expect(match!.skillId).toBe("powerpoint");
      expect(match!.matchedVia).toBe("intent");
    });

    it("matches SEARCH_WEB intent", () => {
      const match = skillAutoDispatcher.matchSkill(
        "busca sobre el tema",
        makeIntent("SEARCH_WEB", 0.8),
      );
      expect(match).not.toBeNull();
      expect(match!.mapping.handler).toBe("search");
    });

    it("matches EXECUTE_CODE intent", () => {
      const match = skillAutoDispatcher.matchSkill(
        "ejecuta un script",
        makeIntent("EXECUTE_CODE", 0.8),
      );
      expect(match).not.toBeNull();
      expect(match!.mapping.handler).toBe("code_execution");
    });

    it("matches MEDIA_GENERATE intent", () => {
      const match = skillAutoDispatcher.matchSkill(
        "quiero una imagen",
        makeIntent("MEDIA_GENERATE", 0.8),
      );
      expect(match).not.toBeNull();
      expect(match!.mapping.handler).toBe("media");
    });
  });

  // ==========================================================================
  // Full Dispatch — Intent Detection → Handler Execution
  // ==========================================================================

  describe("dispatch execution", () => {
    it("dispatches Word creation and produces artifacts", async () => {
      llmChatMock.mockResolvedValueOnce({
        content: "# Test Document\n\nContent here.",
      });

      const result = await skillAutoDispatcher.dispatch(
        baseRequest("crea un documento Word sobre IA", makeIntent("CREATE_DOCUMENT", 0.9, "docx")),
      );

      expect(result.handled).toBe(true);
      expect(result.category).toContain("document");
      expect(result.artifacts.length).toBeGreaterThanOrEqual(1);
      expect(result.artifacts[0].mimeType).toContain("wordprocessingml");
      expect(result.artifacts[0].filename).toMatch(/\.docx$/);
      expect(result.artifacts[0].buffer.length).toBeGreaterThan(0);
    });

    it("dispatches Excel creation and produces artifacts", async () => {
      const result = await skillAutoDispatcher.dispatch(
        baseRequest("hazme un Excel con datos de ventas", makeIntent("CREATE_SPREADSHEET", 0.9, "xlsx")),
      );

      expect(result.handled).toBe(true);
      expect(result.category).toContain("document");
      expect(result.artifacts.length).toBeGreaterThanOrEqual(1);
      expect(result.artifacts[0].mimeType).toContain("spreadsheetml");
      expect(result.artifacts[0].filename).toMatch(/\.xlsx$/);
      expect(result.artifacts[0].buffer.length).toBeGreaterThan(0);
    });

    it("dispatches PowerPoint creation and produces artifacts", async () => {
      llmChatMock.mockResolvedValueOnce({
        content: JSON.stringify([
          { title: "Introduction", bullets: ["Point 1", "Point 2"] },
          { title: "Details", bullets: ["Detail A", "Detail B"] },
        ]),
      });

      const result = await skillAutoDispatcher.dispatch(
        baseRequest("crea una presentación sobre IA", makeIntent("CREATE_PRESENTATION", 0.9, "pptx")),
      );

      expect(result.handled).toBe(true);
      expect(result.category).toContain("document");
      expect(result.artifacts.length).toBeGreaterThanOrEqual(1);
      expect(result.artifacts[0].mimeType).toContain("presentationml");
      expect(result.artifacts[0].filename).toMatch(/\.pptx$/);
    });

    it("dispatches PDF creation", async () => {
      llmChatMock.mockResolvedValueOnce({
        content: "<h1>Test Report</h1><p>Content.</p>",
      });

      const result = await skillAutoDispatcher.dispatch(
        baseRequest("genera un PDF con el reporte"),
      );

      expect(result.handled).toBe(true);
      expect(result.category).toContain("document");
      expect(result.artifacts.length).toBeGreaterThanOrEqual(1);
      // PDF handler generates either actual PDF or Word fallback
      const artifact = result.artifacts[0];
      expect(artifact.buffer.length).toBeGreaterThan(0);
      expect(artifact.filename).toMatch(/\.(pdf|docx)$/);
    });

    it("dispatches CSV creation", async () => {
      llmChatMock.mockResolvedValueOnce({
        content: "Name,Age\nAlice,30\nBob,25",
      });

      const result = await skillAutoDispatcher.dispatch(
        baseRequest("exporta datos como CSV"),
      );

      expect(result.handled).toBe(true);
      expect(result.artifacts.length).toBeGreaterThanOrEqual(1);
      expect(result.artifacts[0].mimeType).toContain("csv");
    });

    it("dispatches web search and returns results", async () => {
      llmChatMock.mockResolvedValue({
        content: JSON.stringify({
          title: "Research",
          summary: "Summary",
          results: [{ title: "A", url: "http://a.com", snippet: "...", relevance: "High" }],
          keyFindings: ["Finding 1"],
          conclusion: "Done",
        }),
      });

      const result = await skillAutoDispatcher.dispatch(
        baseRequest("busca en internet sobre IA", makeIntent("SEARCH_WEB", 0.8)),
      );

      expect(result.handled).toBe(true);
      expect(result.textResponse.length).toBeGreaterThan(0);
      expect(result.artifacts.length).toBeGreaterThanOrEqual(1);
    });

    it("dispatches code execution (Python)", async () => {
      const result = await skillAutoDispatcher.dispatch(
        baseRequest('ejecuta este código python:\n```python\nprint("hello")\n```'),
      );

      expect(result.handled).toBe(true);
      expect(result.textResponse).toContain("Python");
      expect(result.artifacts.length).toBeGreaterThanOrEqual(1);
      const codeArtifact = result.artifacts.find(a => a.type === "code");
      expect(codeArtifact).toBeDefined();
      expect(codeArtifact!.filename).toMatch(/\.py$/);
    });

    it("dispatches code execution (JavaScript)", async () => {
      const result = await skillAutoDispatcher.dispatch(
        baseRequest('ejecuta este código javascript:\n```javascript\nconsole.log(2 + 2)\n```'),
      );

      expect(result.handled).toBe(true);
      expect(result.textResponse).toContain("JavaScript");
    });

    it("dispatches image generation", async () => {
      llmChatMock.mockResolvedValueOnce({
        content: "A beautiful tropical landscape with palm trees",
      });

      const result = await skillAutoDispatcher.dispatch(
        baseRequest("crear imagen de un paisaje tropical"),
      );

      expect(result.handled).toBe(true);
      expect(result.artifacts.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ==========================================================================
  // Non-matching / Error Handling
  // ==========================================================================

  describe("non-matching and error handling", () => {
    it('normal "hola como estas" → does NOT activate any skill', async () => {
      const result = await skillAutoDispatcher.dispatch(
        baseRequest("hola como estas", makeIntent("CHAT_GENERAL", 0.95)),
      );

      expect(result.handled).toBe(false);
      expect(result.skillId).toBe("");
      expect(result.artifacts).toHaveLength(0);
    });

    it("ignores NEED_CLARIFICATION intent", async () => {
      const result = await skillAutoDispatcher.dispatch(
        baseRequest("hmm no se", makeIntent("NEED_CLARIFICATION", 0.5)),
      );

      expect(result.handled).toBe(false);
    });

    it("returns handled=false for empty message with no intent", async () => {
      const result = await skillAutoDispatcher.dispatch({
        message: "",
        intentResult: null,
        userId: "",
        chatId: "",
        locale: "es",
      });

      expect(result.handled).toBe(false);
      expect(result.artifacts).toHaveLength(0);
    });

    it("gracefully handles unmatched messages", async () => {
      const result = await skillAutoDispatcher.dispatch(
        baseRequest("test message without matching skill"),
      );

      expect(result).toBeDefined();
      expect(result.handled).toBe(false);
    });
  });

  // ==========================================================================
  // Metrics
  // ==========================================================================

  describe("metrics tracking", () => {
    it("includes latency metrics when skill is handled", async () => {
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
