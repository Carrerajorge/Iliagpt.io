import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { storage } from "../storage";

const { generateProfessionalPptxMock } = vi.hoisted(() => ({
  generateProfessionalPptxMock: vi.fn(),
}));

vi.mock("../services/documentGenerators/professionalPptxGenerator", () => ({
  generateProfessionalPptx: generateProfessionalPptxMock,
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
        chatId: "chat-ppt",
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
    streamChat: vi.fn(),
    guaranteeResponse: vi.fn(),
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
  routeIntent: vi.fn(() => ({
    intent: "CREATE_PRESENTATION",
    output_format: "pptx",
    slots: { topic: "ventas" },
    confidence: 0.98,
    normalized_text: "crea un excelente ppt con formulas de ventas",
    language_detected: "es",
  })),
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
      try {
        return {
          event: eventMatch[1].trim(),
          data: JSON.parse(dataMatch[1]),
        };
      } catch {
        return null;
      }
    })
    .filter((item): item is { event: string; data: any } => !!item);
}

async function makeApp() {
  const { createChatAiRouter } = await import("../routes/chatAiRouter");
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use("/api", createChatAiRouter(() => {}));
  return app;
}

describe("chat artifact generation integration - PPT", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    generateProfessionalPptxMock.mockResolvedValue({
      buffer: Buffer.from("pptx-binary"),
      filename: "ventas-ejecutivas.pptx",
      mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      previewHtml: "<div>Preview PPT ventas CAC</div>",
      slideCount: 6,
    });
  });

  it("routes a natural PPT request from chat into the professional artifact engine", async () => {
    const app = await makeApp();
    const response = await request(app)
      .post("/api/chat/stream")
      .set("x-request-id", "req-chat-ppt-1")
      .send({
        messages: [{ role: "user", content: "crea un excelente ppt con formulas de ventas" }],
        conversationId: "chat-ppt",
        chatId: "chat-ppt",
        latencyMode: "fast",
      });

    expect(response.status).toBe(200);
    const events = parseSsePayloads(response.text);

    const startEvent = events.find((event) => event.event === "production_start");
    const artifactEvent = events.find((event) => event.event === "artifact");
    const completeEvent = events.find((event) => event.event === "production_complete");
    const doneEvent = events.find((event) => event.event === "done");

    expect(startEvent?.data).toMatchObject({
      workflow: "artifact_generation",
      engine: "artifact-engine",
      docKind: "pptx",
      conversationId: "chat-ppt",
    });
    expect(artifactEvent?.data).toMatchObject({
      type: "ppt",
      previewHtml: "<div>Preview PPT ventas CAC</div>",
      metadata: expect.objectContaining({
        engine: "artifact-engine",
        slideCount: 6,
      }),
    });
    expect(completeEvent?.data.success).toBe(true);
    expect(doneEvent?.data.artifact).toMatchObject({
      type: "presentation",
      previewHtml: "<div>Preview PPT ventas CAC</div>",
    });
    expect(response.text).toContain("Presentación lista para descargar");
  });

  it("persists the final PPT artifact in the assistant message metadata", async () => {
    const app = await makeApp();
    const response = await request(app)
      .post("/api/chat/stream")
      .set("x-request-id", "req-chat-ppt-2")
      .send({
        messages: [{ role: "user", content: "crea un excelente ppt con formulas de ventas" }],
        conversationId: "chat-ppt",
        chatId: "chat-ppt",
        latencyMode: "fast",
      });

    expect(response.status).toBe(200);
    expect(vi.mocked(storage.updateChatMessageContent)).toHaveBeenCalledWith(
      "m-assistant",
      "Presentación lista para descargar. Haz clic en descargar para obtenerla.",
      "done",
      expect.objectContaining({
        artifact: expect.objectContaining({
          filename: "ventas-ejecutivas.pptx",
          previewHtml: "<div>Preview PPT ventas CAC</div>",
          metadata: expect.objectContaining({
            engine: "artifact-engine",
          }),
        }),
      }),
    );
  });
});
