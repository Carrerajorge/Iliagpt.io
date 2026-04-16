import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const {
  normalizeDocumentMock,
  streamChatMock,
  validateResponseContractMock,
  validateDataModeResponseEnhancedMock,
} = vi.hoisted(() => ({
  normalizeDocumentMock: vi.fn(),
  streamChatMock: vi.fn(),
  validateResponseContractMock: vi.fn(),
  validateDataModeResponseEnhancedMock: vi.fn(),
}));

vi.mock("../storage", () => ({
  storage: {
    getUserSettings: vi.fn(async () => ({
      featureFlags: {
        canvasEnabled: true,
        webSearchAuto: false,
        codeInterpreterEnabled: true,
        memoryEnabled: false,
        recordingHistoryEnabled: false,
      },
    })),
    createAuditLog: vi.fn(async () => null),
    getChat: vi.fn(async () => null),
    createChat: vi.fn(async () => null),
    createChatMessage: vi.fn(async () => ({ id: "m-assistant" })),
    createChatRun: vi.fn(async () => ({ id: "run-created" })),
    createUserMessageAndRun: vi.fn(async () => ({
      message: { id: "m-user" },
      run: {
        id: "run-created",
        chatId: "chat-analyze",
        clientRequestId: "client-request-1",
        userMessageId: "m-user",
        status: "pending",
      },
    })),
    updateChatMessageContent: vi.fn(async () => null),
    getChatMessages: vi.fn(async () => []),
    getChatRun: vi.fn(async () => null),
    getChatRunByClientRequestId: vi.fn(async () => null),
    claimPendingRun: vi.fn(async () => null),
    updateChatRunStatus: vi.fn(async () => null),
    findMessageByRequestId: vi.fn(async () => null),
    getFile: vi.fn(async () => null),
  },
}));

vi.mock("../services/ChatServiceV2", () => ({
  chatService: { chat: vi.fn() },
  AVAILABLE_MODELS: {},
  DEFAULT_PROVIDER: "xai",
  DEFAULT_MODEL: "grok-3-fast",
}));

vi.mock("../lib/llmGateway", () => ({
  llmGateway: {
    chat: vi.fn(),
    guaranteeResponse: vi.fn(),
    streamChat: streamChatMock,
  },
}));

vi.mock("../services/conversationMemory", () => ({
  conversationMemoryManager: {
    augmentWithHistory: vi.fn(async (_cid: string, msgs: any[]) => msgs),
  },
}));

vi.mock("../services/conversationStateService", () => ({
  conversationStateService: {
    appendMessage: vi.fn(async () => null),
  },
}));

vi.mock("../services/usageQuotaService", () => ({
  usageQuotaService: {
    hasTokenQuota: vi.fn(async () => true),
    getDailyTokenQuotaStatus: vi.fn(async () => ({
      allowed: true,
      resetAt: null,
      inputUsed: 0,
      outputUsed: 0,
      totalUsed: 0,
      inputLimit: null,
      outputLimit: null,
      inputRemaining: null,
      outputRemaining: null,
    })),
    checkAndIncrementUsage: vi.fn(async () => ({ allowed: true })),
    recordTokenUsage: vi.fn(async () => null),
    recordTokenUsageDetailed: vi.fn(async () => null),
  },
}));

vi.mock("../lib/anonUserHelper", () => ({
  getOrCreateSecureUserId: vi.fn(() => "user_test"),
  getSecureUserId: vi.fn(() => "user_test"),
}));

vi.mock("../types/express", () => ({
  getUserId: vi.fn(() => "user_test"),
}));

vi.mock("../lib/ensureUserRowExists", () => ({
  ensureUserRowExists: vi.fn(async () => null),
}));

vi.mock("../services/questionClassifier", () => ({
  questionClassifier: {
    classifyQuestion: vi.fn(() => ({ type: "factual_simple", maxTokens: 128 })),
  },
}));

vi.mock("../services/skillContextResolver", () => ({
  drizzleSkillStore: {},
  resolveSkillContextFromRequest: vi.fn(async () => null),
  buildSkillSystemPromptSection: vi.fn(() => ""),
}));

vi.mock("../services/skillPlatform", () => ({
  getSkillPlatformService: vi.fn(() => ({
    executeFromMessage: vi.fn(async () => ({
      status: "skipped",
      continueWithModel: true,
      outputText: "",
      autoCreated: false,
      requiresConfirmation: false,
      traces: [],
      fallbackText: "",
      error: undefined,
      output: undefined,
      policyBreached: undefined,
      selectedSkill: undefined,
    })),
  })),
}));

vi.mock("../services/intentRouter", () => ({
  routeIntent: vi.fn(async () => ({
    intent: "SUMMARIZE",
    confidence: 0.98,
    output_format: "text",
    slots: {},
    language_detected: "es",
    fallback_used: false,
  })),
}));

vi.mock("../services/structuredDocumentNormalizer", () => ({
  normalizeDocument: normalizeDocumentMock,
}));

vi.mock("../lib/pareResponseContract", () => ({
  validateResponseContract: validateResponseContractMock,
}));

vi.mock("../lib/dataModeValidator", () => ({
  validateDataModeResponseEnhanced: validateDataModeResponseEnhancedMock,
  DataModeOutputViolationError: class DataModeOutputViolationError extends Error {},
}));

function parseSsePayloads(raw: string): Array<{ event: string; data: any }> {
  return raw
    .split("\n\n")
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const eventMatch = block.match(/^event:\s*(.+)$/m);
      const dataMatch = block.match(/^data:\s*(.+)$/m);
      if (!eventMatch || !dataMatch) {
        return null;
      }
      return {
        event: eventMatch[1].trim(),
        data: JSON.parse(dataMatch[1]),
      };
    })
    .filter((item): item is { event: string; data: any } => !!item);
}

async function makeApp() {
  const { createChatAiRouter } = await import("../routes/chatAiRouter");
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/api", createChatAiRouter(() => {}));
  return app;
}

describe("chat analyze integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    normalizeDocumentMock.mockResolvedValue({
      version: "1.0",
      documentMeta: {
        id: "doc-1",
        fileName: "ventas.xlsx",
        fileSize: 128,
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        documentType: "excel",
        title: "Ventas",
        sheetCount: 1,
      },
      sections: [
        {
          id: "section-1",
          type: "sheet",
          title: "Ventas",
          content: "Ingresos 1200, costos 800, margen 400",
          sourceRef: "documento sheet:Ventas!A1:C3",
        },
      ],
      tables: [],
      metrics: [],
      anomalies: [],
      insights: [],
      sources: [],
      sheets: [
        {
          name: "Ventas",
          rowCount: 3,
          columnCount: 3,
          usedRange: "A1:C3",
          headers: ["Ingresos", "Costos", "Margen"],
        },
      ],
      suggestedQuestions: [],
      extractionDiagnostics: {
        extractedAt: new Date().toISOString(),
        durationMs: 12,
        parserUsed: "excelExtractor",
        mimeTypeDetected: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        bytesProcessed: 128,
      },
    });

    streamChatMock.mockImplementation(async function* (_messages: any, options: any) {
      expect(options?.abortSignal).toBeInstanceOf(AbortSignal);
      yield { content: "Resumen ejecutivo: los ingresos superan a los costos [documento sheet:Ventas!A1:C3]." };
    });

    validateResponseContractMock.mockReturnValue({
      valid: true,
      hasValidContentType: true,
      hasNoBlobs: true,
      hasNoBase64Data: true,
      hasNoImageUrls: true,
      coverageRatio: 1,
      meetsCoverageRequirement: true,
      documentsWithCitations: ["ventas.xlsx"],
      documentsWithoutCitations: [],
      violations: [],
    });

    validateDataModeResponseEnhancedMock.mockReturnValue({
      valid: true,
      violations: [],
      stack: null,
    });
  });

  it("streams document analysis successfully with a valid upstream abort signal", async () => {
    const app = await makeApp();

    const response = await request(app)
      .post("/api/analyze")
      .set("x-request-id", "req-analyze-1")
      .send({
        messages: [{ role: "user", content: "Dame un resumen ejecutivo" }],
        conversationId: "chat-analyze",
        attachments: [
          {
            id: "file-1",
            fileId: "file-1",
            type: "document",
            name: "ventas.xlsx",
            mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            content: Buffer.from("fake-xlsx").toString("base64"),
          },
        ],
      });

    expect(response.status).toBe(200);

    const events = parseSsePayloads(response.text);
    const errorEvent = events.find((event) => event.event === "error");
    const doneEvent = events.find((event) => event.event === "done");

    expect(errorEvent).toBeUndefined();
    expect(doneEvent?.data.answer_text).toContain("Resumen ejecutivo");
    expect(streamChatMock).toHaveBeenCalledTimes(1);
  });
});
