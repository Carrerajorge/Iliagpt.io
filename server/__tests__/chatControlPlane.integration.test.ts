import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const {
  officeEngineRunMock,
  generateFilePreviewMock,
  routeIntentMock,
  validateUnifiedQuotaMock,
  userSettingsMock,
  llmStreamChatMock,
  createChatCognitiveKernelDecisionMock,
} = vi.hoisted(() => ({
  officeEngineRunMock: vi.fn(),
  generateFilePreviewMock: vi.fn(),
  routeIntentMock: vi.fn(),
  validateUnifiedQuotaMock: vi.fn(),
  userSettingsMock: vi.fn(),
  llmStreamChatMock: vi.fn(),
  createChatCognitiveKernelDecisionMock: vi.fn(),
}));

vi.mock("../lib/office/engine/OfficeEngine", () => ({
  officeEngine: {
    run: officeEngineRunMock,
  },
}));

vi.mock("../services/filePreviewService", () => ({
  generateFilePreview: generateFilePreviewMock,
}));

vi.mock("../services/intentRouter", () => ({
  routeIntent: routeIntentMock,
}));

vi.mock("../cognitive", () => ({
  createChatCognitiveKernelDecision: createChatCognitiveKernelDecisionMock,
}));

vi.mock("../storage", () => ({
  storage: {
    getUserSettings: userSettingsMock,
    createAuditLog: vi.fn(async () => null),
    getChat: vi.fn(async () => null),
    createChat: vi.fn(async () => null),
    createChatMessage: vi.fn(async () => ({ id: "m-assistant" })),
    createChatRun: vi.fn(async () => ({ id: "run-created" })),
    createUserMessageAndRun: vi.fn(async () => ({
      message: { id: "m-user" },
      run: {
        id: "run-created",
        chatId: "chat-control-plane",
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
    incrementGptUsage: vi.fn(async () => null),
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
    streamChat: llmStreamChatMock,
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
    validateUnifiedQuota: validateUnifiedQuotaMock,
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
    classifyQuestion: vi.fn(() => ({ type: "analysis", maxTokens: 256 })),
  },
}));

vi.mock("../agent/nativeAgenticFusion", () => ({
  hasNativeAgenticSignal: vi.fn(() => false),
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

describe("chat control plane integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userSettingsMock.mockResolvedValue({
      featureFlags: {
        canvasEnabled: true,
        webSearchAuto: false,
        codeInterpreterEnabled: true,
        memoryEnabled: false,
        recordingHistoryEnabled: false,
        voiceEnabled: true,
        voiceAdvanced: false,
        connectorSearchAuto: false,
      },
      responsePreferences: {
        responseStyle: "default",
        customInstructions: "",
      },
      userProfile: null,
    });
    routeIntentMock.mockReturnValue({
      intent: "CREATE_DOCUMENT",
      output_format: "docx",
      slots: { topic: "mercado" },
      confidence: 0.98,
      normalized_text: "crea un word",
      language_detected: "es",
    });
    createChatCognitiveKernelDecisionMock.mockImplementation(async ({ intentResult, preferredProvider }: any) => ({
      workflow: intentResult?.intent === "CREATE_DOCUMENT" ? "artifact_generation" : "conversation",
      cognitiveIntent: { intent: "doc_generation", confidence: 0.98, reasoning: "test" },
      sharedIntent: intentResult ?? null,
      authoritativeIntentResult: intentResult ?? null,
      provider: { name: preferredProvider || "xai", reason: "mock", capabilities: [] },
      context: {
        retrievedCount: 0,
        includedCount: 0,
        totalChars: 0,
        errors: [],
        renderedContext: null,
        telemetry: { memoryLookupMs: 0, documentLookupMs: 0, totalMs: 0 },
      },
      corrected: false,
      correctionReason: null,
      metadata: {},
    }));
    validateUnifiedQuotaMock.mockResolvedValue({ allowed: true });
    generateFilePreviewMock.mockResolvedValue({
      type: "docx",
      html: "<div>Preview Word</div>",
    });
    officeEngineRunMock.mockImplementation(async (req: any, streamer: any) => {
      req.onStart?.("office-control-run-1");
      const plan = streamer.start("thinking", "Planificando edición DOCX");
      streamer.complete(plan, { output: "plan ready" });
      return {
        runId: "office-control-run-1",
        status: "succeeded",
        fallbackLevel: 0,
        durationMs: 120,
        artifacts: [
          {
            id: "artifact-control-1",
            kind: "exported",
            path: "/tmp/control-plane.docx",
            mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            sizeBytes: 4096,
            checksumSha256: "sha-control",
            downloadUrl: "/api/office-engine/runs/office-control-run-1/artifacts/exported",
            previewUrl: "/api/office-engine/runs/office-control-run-1/artifacts/preview",
          },
        ],
      };
    });
  });

  it("emits the control plane contract and routes document requests through production", async () => {
    const app = await makeApp();
    const response = await request(app)
      .post("/api/chat/stream")
      .send({
        messages: [{ role: "user", content: "crea un Word de estudio de mercado" }],
        conversationId: "chat-control-plane",
        chatId: "chat-control-plane",
        latencyMode: "fast",
      });

    expect(response.status).toBe(200);
    const events = parseSsePayloads(response.text);
    const controlPlaneNotice = events.find((event) => event.event === "notice" && event.data?.type === "chat_control_plane");
    const productionStart = events.find((event) => event.event === "production_start");
    const errorEvent = events.find((event) => event.event === "error");

    expect(controlPlaneNotice?.data).toMatchObject({
      workflow: "artifact_generation",
      handler: "production_handler",
      renderSurface: "artifact_card",
      splitView: true,
      policyAllowed: true,
    });
    expect(productionStart).toBeTruthy();
    expect(errorEvent).toBeFalsy();
    expect(officeEngineRunMock).toHaveBeenCalledOnce();
  });

  it("blocks document generation when the capability is disabled by policy", async () => {
    userSettingsMock.mockResolvedValueOnce({
      featureFlags: {
        canvasEnabled: false,
        webSearchAuto: false,
        codeInterpreterEnabled: true,
        memoryEnabled: false,
        recordingHistoryEnabled: false,
        voiceEnabled: true,
        voiceAdvanced: false,
        connectorSearchAuto: false,
      },
      responsePreferences: {
        responseStyle: "default",
        customInstructions: "",
      },
      userProfile: null,
    });

    const app = await makeApp();
    const response = await request(app)
      .post("/api/chat/stream")
      .send({
        messages: [{ role: "user", content: "crea un Word de administración" }],
        conversationId: "chat-control-plane",
        chatId: "chat-control-plane",
        latencyMode: "fast",
      });

    expect(response.status).toBe(200);
    const events = parseSsePayloads(response.text);
    const controlPlaneNotice = events.find((event) => event.event === "notice" && event.data?.type === "chat_control_plane");
    const errorEvent = events.find((event) => event.event === "error");
    const productionStart = events.find((event) => event.event === "production_start");

    expect(controlPlaneNotice?.data?.policyAllowed).toBe(false);
    expect(errorEvent?.data?.code).toBe("CAPABILITY_DISABLED");
    expect(productionStart).toBeFalsy();
    expect(officeEngineRunMock).not.toHaveBeenCalled();
    expect(llmStreamChatMock).not.toHaveBeenCalled();
  });

  it("blocks the stream when unified quota rejects the request", async () => {
    routeIntentMock.mockReturnValueOnce({
      intent: "CHAT_GENERAL",
      output_format: null,
      slots: {},
      confidence: 0.7,
      normalized_text: "hola",
      language_detected: "es",
    });
    createChatCognitiveKernelDecisionMock.mockImplementationOnce(async ({ intentResult, preferredProvider }: any) => ({
      workflow: "conversation",
      cognitiveIntent: { intent: "general_chat", confidence: 0.8, reasoning: "test" },
      sharedIntent: intentResult ?? null,
      authoritativeIntentResult: intentResult ?? null,
      provider: { name: preferredProvider || "xai", reason: "mock", capabilities: [] },
      context: {
        retrievedCount: 0,
        includedCount: 0,
        totalChars: 0,
        errors: [],
        renderedContext: null,
        telemetry: { memoryLookupMs: 0, documentLookupMs: 0, totalMs: 0 },
      },
      corrected: false,
      correctionReason: null,
      metadata: {},
    }));
    validateUnifiedQuotaMock.mockResolvedValueOnce({
      allowed: false,
      payload: {
        ok: false,
        code: "TOKEN_QUOTA_EXCEEDED",
        message: "sin cuota",
        statusCode: 402,
        quota: {
          unified: true,
          resetAt: null,
          monthlyAllowed: false,
          dailyAllowed: true,
          requestAllowed: true,
        },
        billing: {
          unified: true,
          statusUrl: "/api/billing/status",
          upgradeUrl: "/workspace-settings?section=billing",
        },
      },
    });

    const app = await makeApp();
    const response = await request(app)
      .post("/api/chat/stream")
      .send({
        messages: [{ role: "user", content: "hola" }],
        conversationId: "chat-control-plane",
        chatId: "chat-control-plane",
        latencyMode: "fast",
      });

    expect(response.status).toBe(200);
    const events = parseSsePayloads(response.text);
    const errorEvent = events.find((event) => event.event === "error");
    const productionStart = events.find((event) => event.event === "production_start");

    expect(errorEvent?.data?.code).toBe("TOKEN_QUOTA_EXCEEDED");
    expect(errorEvent?.data?.billing?.statusUrl).toBe("/api/billing/status");
    expect(productionStart).toBeFalsy();
    expect(officeEngineRunMock).not.toHaveBeenCalled();
    expect(llmStreamChatMock).not.toHaveBeenCalled();
  });

  it("uses the control plane provider for model streaming when provider is auto", async () => {
    routeIntentMock.mockReturnValueOnce({
      intent: "CHAT_GENERAL",
      output_format: null,
      slots: {},
      confidence: 0.88,
      normalized_text: "hola",
      language_detected: "es",
    });
    createChatCognitiveKernelDecisionMock.mockImplementationOnce(async ({ intentResult }: any) => ({
      workflow: "conversation",
      cognitiveIntent: { intent: "general_chat", confidence: 0.9, reasoning: "test" },
      sharedIntent: intentResult ?? null,
      authoritativeIntentResult: intentResult ?? null,
      provider: { name: "gemini", reason: "control-plane", capabilities: [] },
      context: {
        retrievedCount: 0,
        includedCount: 0,
        totalChars: 0,
        errors: [],
        renderedContext: null,
        telemetry: { memoryLookupMs: 0, documentLookupMs: 0, totalMs: 0 },
      },
      corrected: false,
      correctionReason: null,
      metadata: {},
    }));
    llmStreamChatMock.mockImplementation(async function* (_messages: any, options: any) {
      yield { content: "hola", done: false, provider: options?.provider || "unknown" };
      yield { content: "", done: true, provider: options?.provider || "unknown" };
    });

    const app = await makeApp();
    const response = await request(app)
      .post("/api/chat/stream")
      .send({
        messages: [{ role: "user", content: "hola" }],
        conversationId: "chat-control-plane",
        chatId: "chat-control-plane",
        latencyMode: "fast",
        provider: "auto",
      });

    expect(response.status).toBe(200);
    expect(llmStreamChatMock).toHaveBeenCalled();
    expect(llmStreamChatMock.mock.calls.at(-1)?.[1]).toMatchObject({ provider: "gemini" });

    const events = parseSsePayloads(response.text);
    const controlPlaneNotice = events.find((event) => event.event === "notice" && event.data?.type === "chat_control_plane");
    expect(controlPlaneNotice?.data?.provider).toBe("gemini");
  });
});
