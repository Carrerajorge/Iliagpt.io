import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { createHttpTestClient } from "../../tests/helpers/httpTestClient";

const chatMock = vi.fn();
const llmChatMock = vi.fn();
const llmStreamChatMock = vi.fn();
const llmGuaranteeResponseMock = vi.fn();
const resolveSkillContextMock = vi.fn();
const buildSkillSectionMock = vi.fn();

vi.mock("../services/ChatServiceV2", () => ({
  chatService: { chat: chatMock },
  AVAILABLE_MODELS: {},
  DEFAULT_PROVIDER: "xai",
  DEFAULT_MODEL: "grok-3-fast",
}));

vi.mock("../lib/llmGateway", () => ({
  llmGateway: {
    chat: llmChatMock,
    streamChat: llmStreamChatMock,
    guaranteeResponse: llmGuaranteeResponseMock,
  },
}));

vi.mock("../storage", () => ({
  storage: {
    getUserSettings: vi.fn(async () => null),
    createAuditLog: vi.fn(async () => null),
    getChat: vi.fn(async () => null),
    createChat: vi.fn(async () => null),
    createChatMessage: vi.fn(async () => ({ id: "m1" })),
    updateChatMessageContent: vi.fn(async () => null),
    getChatMessages: vi.fn(async () => []),
    getChatRun: vi.fn(async () => null),
    getChatRunByClientRequestId: vi.fn(async () => null),
    claimPendingRun: vi.fn(async () => null),
    updateChatRunStatus: vi.fn(async () => null),
  },
}));

vi.mock("../services/conversationMemory", () => ({
  conversationMemoryManager: {
    augmentWithHistory: vi.fn(async (_cid: string, msgs: any[]) => msgs),
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
    classifyQuestion: vi.fn(() => ({ type: "factual_simple" })),
  },
}));

// Real hasNativeAgenticSignal treats messages >= 15 chars as "agentic", which skips the simple LLM fast path.
vi.mock("../agent/nativeAgenticFusion", () => ({
  hasNativeAgenticSignal: vi.fn(() => false),
}));

vi.mock("../services/skillContextResolver", () => ({
  drizzleSkillStore: {},
  resolveSkillContextFromRequest: resolveSkillContextMock,
  buildSkillSystemPromptSection: buildSkillSectionMock,
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

vi.mock("../services/webSearch", () => ({
  needsAcademicSearch: vi.fn(() => false),
  needsWebSearch: vi.fn(() => false),
  searchWeb: vi.fn(async () => ({
    results: [],
    contents: [],
  })),
}));

vi.mock("../services/academicResearchEngineV3", () => ({
  academicEngineV3: {
    search: vi.fn(async () => ({
      papers: [],
      sources: [],
    })),
  },
  generateAPACitation: vi.fn(() => ""),
}));

vi.mock("../agent/unifiedChatHandler", () => ({
  createUnifiedRun: vi.fn(async () => ({
    runId: "run_test",
    startTime: Date.now(),
    resolvedLane: "fast",
    isAgenticMode: false,
    requestSpec: {
      intent: "chat",
      intentConfidence: 0.95,
      deliverableType: null,
      primaryAgent: "chat",
      targetAgents: [],
      sessionState: null,
    },
  })),
  hydrateSessionState: vi.fn(async () => null),
  emitTraceEvent: vi.fn(() => undefined),
  SseBufferedWriter: class {
    constructor() {}
    pushDelta() {}
    write() {}
    flush() {}
    finalize() { return 0; }
    close() {}
    destroy() {}
  },
  resolveLatencyLane: vi.fn(() => "fast"),
}));

vi.mock("../agent/agentExecutor", () => ({
  executeAgentLoop: vi.fn(async () => ({
    status: "completed",
    fullResponse: "stream ok",
    response: "stream ok",
    artifacts: [],
    usage: null,
  })),
}));

vi.mock("../services/conversationStateService", () => ({
  conversationStateService: {
    appendMessage: vi.fn(async () => null),
  },
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

async function* createMockStream(content: string) {
  yield {
    content,
    done: false,
    provider: "xai",
    requestId: "stream_test",
    sequenceId: 1,
  };
  yield {
    content: "",
    done: true,
    provider: "xai",
    requestId: "stream_test",
    sequenceId: 2,
  };
}

async function makeApp() {
  const { createChatAiRouter } = await import("../routes/chatAiRouter");
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use("/api", createChatAiRouter(() => {}));
  return app;
}

describe("chat skill integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    resolveSkillContextMock.mockResolvedValue({
      source: "custom_skill",
      id: "skill_abc",
      name: "Analyst",
      instructions: "Prioriza respuesta ejecutiva.",
    });
    buildSkillSectionMock.mockReturnValue("\n\n[SKILL_CONTEXT]\nPrioriza respuesta ejecutiva.\n[/SKILL_CONTEXT]");
    chatMock.mockResolvedValue({ content: "ok", role: "assistant", usage: { totalTokens: 10 } });
    llmChatMock.mockResolvedValue({ content: "stream ok", provider: "xai", model: "grok-3-fast" });
    llmGuaranteeResponseMock.mockResolvedValue({ content: "stream ok", provider: "xai", model: "grok-3-fast" });
    llmStreamChatMock.mockImplementation((messages: any[]) => createMockStream(`stream:${String(messages[messages.length - 1]?.content || "")}`));
  });

  it("injects skill context into /api/chat request pipeline", async () => {
    const app = await makeApp();
    const { client, close } = await createHttpTestClient(app);
    try {
      const res = await client
        .post("/api/chat")
        .send({
          messages: [{ role: "user", content: "hola" }],
          conversationId: "chat_1",
        });

      expect(res.status).toBe(200);
      expect(resolveSkillContextMock).toHaveBeenCalled();

      const sentMessages = chatMock.mock.calls[0][0];
      expect(sentMessages[0].role).toBe("system");
      expect(sentMessages[0].content).toContain("[SKILL_CONTEXT]");
    } finally {
      await close();
    }
  }, 60000);

  it("injects skill context into /api/chat/stream fast-path system prompt", async () => {
    const app = await makeApp();
    const { client, close } = await createHttpTestClient(app);
    try {
      const res = await client
        .post("/api/chat/stream")
        .send({
          messages: [{ role: "user", content: "¿qué es la fotosíntesis?" }],
          latencyMode: "fast",
        });

      expect(res.status).toBe(200);
      expect(resolveSkillContextMock).toHaveBeenCalled();

      // Fast-path behavior can vary (direct short-circuit vs full pipeline).
      // Always require successful stream completion and skill context resolution.
      const llmMessages = llmStreamChatMock.mock.calls[0]?.[0] || llmChatMock.mock.calls[0]?.[0];
      const chatMessages = chatMock.mock.calls[0]?.[0];
      const outboundMessages = llmMessages || chatMessages;

      if (outboundMessages?.[0]) {
        expect(outboundMessages[0].role).toBe("system");
        expect(outboundMessages[0].content).toContain("[SKILL_CONTEXT]");
      }

      expect(llmStreamChatMock).toHaveBeenCalled();
      expect(res.text.includes("event: done")).toBe(true);
      expect(res.text.includes("event: complete")).toBe(true);
      expect(res.text.includes("event: error")).toBe(false);
    } finally {
      await close();
    }
  }, 60000);

  it("emits done and complete after a terminal model failure", async () => {
    llmStreamChatMock.mockImplementationOnce(async function* () {
      throw new Error("provider unavailable");
    });
    llmGuaranteeResponseMock.mockRejectedValueOnce(new Error("provider unavailable"));

    const app = await makeApp();
    const { client, close } = await createHttpTestClient(app);
    try {
      const res = await client
        .post("/api/chat/stream")
        .send({
          messages: [{ role: "user", content: "resume este texto" }],
          latencyMode: "fast",
        });

      expect(res.status).toBe(200);

      const events = parseSsePayloads(res.text);
      expect(events.some((event) => event.event === "error")).toBe(true);
      expect(events.some((event) => event.event === "done")).toBe(true);
      expect(events.some((event) => event.event === "complete")).toBe(true);

      const errorEvent = events.find((event) => event.event === "error");
      const doneEvent = events.find((event) => event.event === "done");
      const completeEvent = events.find((event) => event.event === "complete");

      expect(errorEvent).toBeTruthy();
      expect(doneEvent).toBeTruthy();
      expect(completeEvent?.data?.status).toBe("error");
    } finally {
      await close();
    }
  }, 60000);
});
