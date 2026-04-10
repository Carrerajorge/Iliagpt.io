import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { storage } from "../storage";

const { officeEngineRunMock } = vi.hoisted(() => ({
  officeEngineRunMock: vi.fn(),
}));

vi.mock("../lib/office/engine/OfficeEngine", () => ({
  officeEngine: {
    run: officeEngineRunMock,
  },
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
        chatId: "chat-artifact",
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
    intent: "CREATE_DOCUMENT",
    output_format: "docx",
    slots: { topic: "IA" },
    confidence: 0.98,
    normalized_text: "crea un word de la ia",
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

describe("chat artifact generation integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("routes a natural DOCX request from chat into the office engine and finishes with an artifact", async () => {
    officeEngineRunMock.mockImplementation(async (req: any, streamer: any) => {
      req.onStart?.("office-chat-run-1");
      const plan = streamer.start("thinking", "Planificando edición DOCX");
      streamer.complete(plan, { output: "create document from spec" });
      const preview = streamer.start("generating", "Preparando vista previa");
      streamer.complete(preview, { output: "preview ready" });
      return {
        runId: "office-chat-run-1",
        status: "succeeded",
        fallbackLevel: 0,
        durationMs: 210,
        artifacts: [
          {
            id: "artifact-chat-1",
            kind: "exported",
            path: "/tmp/office-chat-run-1.docx",
            mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            sizeBytes: 3072,
            checksumSha256: "sha-chat-1",
            downloadUrl: "/api/office-engine/runs/office-chat-run-1/artifacts/exported",
            previewUrl: "/api/office-engine/runs/office-chat-run-1/artifacts/preview",
          },
        ],
      };
    });

    const app = await makeApp();
    const response = await request(app)
      .post("/api/chat/stream")
      .set("x-request-id", "req-chat-artifact-1")
      .send({
        messages: [{ role: "user", content: "crea un Word de la IA" }],
        conversationId: "chat-artifact",
        chatId: "chat-artifact",
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
      classification: "artifact_generation",
      engine: "office-engine",
      docKind: "docx",
      conversationId: "chat-artifact",
    });
    expect(artifactEvent?.data.downloadUrl).toBe("/api/office-engine/runs/office-chat-run-1/artifacts/exported");
    expect(artifactEvent?.data.metadata).toMatchObject({
      officeRunId: "office-chat-run-1",
      engine: "office-engine",
      workflow: "artifact_generation",
    });
    expect(completeEvent?.data.success).toBe(true);
    expect(doneEvent?.data.conversationId).toBe("chat-artifact");
    expect(response.text).toContain("Documento listo para descargar");
    expect(vi.mocked(storage.updateChatMessageContent)).toHaveBeenCalledWith(
      "m-assistant",
      "Documento listo para descargar. Vista previa y pipeline estructural disponibles.",
      "done",
      expect.objectContaining({
        artifact: expect.objectContaining({
          downloadUrl: "/api/office-engine/runs/office-chat-run-1/artifacts/exported",
          metadata: expect.objectContaining({
            officeRunId: "office-chat-run-1",
            engine: "office-engine",
          }),
        }),
      }),
    );
  });
});
