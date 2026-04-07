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
    createChatRun: vi.fn(async () => ({ id: "run_created" })),
    createUserMessageAndRun: vi.fn(async () => ({
      message: { id: "m_user" },
      run: { id: "run_created", chatId: "chat_created", clientRequestId: "cr_created", userMessageId: "m_user", status: "pending" },
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
    classifyQuestion: vi.fn(() => ({ type: "factual_simple", maxTokens: 128 })),
  },
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

async function* createMockStream(content: string, requestId = "stream_test") {
  yield {
    content,
    done: false,
    provider: "xai",
    requestId,
    sequenceId: 1,
  };
  yield {
    content: "",
    done: true,
    provider: "xai",
    requestId,
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

describe("chat stream isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    resolveSkillContextMock.mockResolvedValue(null);
    buildSkillSectionMock.mockReturnValue("");
    chatMock.mockResolvedValue({ content: "ok", role: "assistant", usage: { totalTokens: 10 } });
    llmChatMock.mockImplementation(async (messages: any[]) => {
      const last = messages[messages.length - 1];
      return {
        content: `stream:${String(last?.content || "")}`,
        provider: "xai",
        model: "grok-3-fast",
      };
    });
    llmGuaranteeResponseMock.mockImplementation(async (messages: any[]) => ({
      content: `stream:${String(messages[messages.length - 1]?.content || "")}`,
      provider: "xai",
      model: "grok-3-fast",
    }));
    llmStreamChatMock.mockImplementation((messages: any[], options?: { requestId?: string }) =>
      createMockStream(`stream:${String(messages[messages.length - 1]?.content || "")}`, options?.requestId || "stream_test")
    );
  });

  it("keeps SSE metadata isolated across concurrent conversations", async () => {
    const app = await makeApp();
    const { client, close } = await createHttpTestClient(app);

    try {
      const requests = [
        {
          conversationId: "chat_iso_a",
          requestId: "req_iso_a",
          text: "A",
        },
        {
          conversationId: "chat_iso_b",
          requestId: "req_iso_b",
          text: "B",
        },
        {
          conversationId: "chat_iso_c",
          requestId: "req_iso_c",
          text: "C",
        },
      ] as const;

      const responses = await Promise.all(
        requests.map((item) =>
          client
            .post("/api/chat/stream")
            .set("x-request-id", item.requestId)
            .send({
              messages: [{ role: "user", content: item.text }],
              conversationId: item.conversationId,
              chatId: item.conversationId,
              latencyMode: "fast",
            })
        )
      );

      responses.forEach((res, idx) => {
        expect(res.status).toBe(200);

        const expectedConversationId = requests[idx].conversationId;
        const expectedRequestId = requests[idx].requestId;
        const events = parseSsePayloads(res.text);

        expect(events.length).toBeGreaterThan(0);
        expect(events.some((e) => e.event === "chunk")).toBe(true);
        expect(events.some((e) => e.event === "done")).toBe(true);
        expect(events.some((e) => e.event === "complete")).toBe(true);

        for (const evt of events) {
          expect(evt.data?.conversationId).toBe(expectedConversationId);
          expect(evt.data?.requestId).toBe(expectedRequestId);
        }

        const foreignConversationIds = requests
          .filter((r) => r.conversationId !== expectedConversationId)
          .map((r) => r.conversationId);

        for (const foreignId of foreignConversationIds) {
          expect(res.text.includes(`\"conversationId\":\"${foreignId}\"`)).toBe(false);
        }
      });
    } finally {
      await close();
    }
  }, 60000);

  it("rejects a second stream for the same conversation when queueMode=reject", async () => {
    const app = await makeApp();
    const { client, close } = await createHttpTestClient(app);

    try {
      let markFirstLockHeld!: () => void;
      const firstLockHeld = new Promise<void>((resolve) => {
        markFirstLockHeld = resolve;
      });

      let releaseFirstLock!: () => void;
      const releaseFirstLockGate = new Promise<void>((resolve) => {
        releaseFirstLock = resolve;
      });

      // The router acquires the per-conversation lock before resolving skill context. Hold the
      // first request at that await point so the second request deterministically observes the lock.
      resolveSkillContextMock.mockImplementationOnce(async () => {
        markFirstLockHeld();
        await releaseFirstLockGate;
        return null;
      });

      const payload = {
        messages: [{ role: "user", content: "A" }],
        conversationId: "chat_lock_a",
        chatId: "chat_lock_a",
        latencyMode: "fast",
        queueMode: "reject",
      };

      let released = false;
      const safeRelease = () => {
        if (released) return;
        released = true;
        releaseFirstLock();
      };

      const firstPromise = client
        .post("/api/chat/stream")
        .set("x-request-id", "req_lock_a")
        .send(payload)
        // supertest requests start when the thenable is consumed; ensure we start it immediately.
        .then((res) => res);

      await Promise.race([
        firstLockHeld,
        new Promise((_, reject) =>
          setTimeout(() => {
            safeRelease();
            reject(new Error("first stream did not start in time"));
          }, 2000)
        ),
      ]);

      const second = await client.post("/api/chat/stream").set("x-request-id", "req_lock_b").send(payload);

      safeRelease();
      const first = await firstPromise;

      const statuses = [first.status, second.status];
      expect(statuses.includes(200)).toBe(true);
      expect(statuses.includes(409)).toBe(true);
    } finally {
      await close();
    }
  }, 60000);

  it("queues a second stream for the same conversation by default and lets both complete", async () => {
    const app = await makeApp();
    const { client, close } = await createHttpTestClient(app);

    try {
      let markFirstLockHeld!: () => void;
      const firstLockHeld = new Promise<void>((resolve) => {
        markFirstLockHeld = resolve;
      });

      let releaseFirstLock!: () => void;
      const releaseFirstLockGate = new Promise<void>((resolve) => {
        releaseFirstLock = resolve;
      });

      resolveSkillContextMock.mockImplementationOnce(async () => {
        markFirstLockHeld();
        await releaseFirstLockGate;
        return null;
      });

      const payload = {
        messages: [{ role: "user", content: "A" }],
        conversationId: "chat_queue_a",
        chatId: "chat_queue_a",
        latencyMode: "fast",
      };

      const firstPromise = client
        .post("/api/chat/stream")
        .set("x-request-id", "req_queue_a")
        .send(payload)
        .then((res) => res);

      await Promise.race([
        firstLockHeld,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("first queued stream did not start in time")), 2000)
        ),
      ]);

      let secondResolved = false;
      const secondPromise = client
        .post("/api/chat/stream")
        .set("x-request-id", "req_queue_b")
        .send(payload)
        .then((res) => {
          secondResolved = true;
          return res;
        });

      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(secondResolved).toBe(false);

      releaseFirstLock();

      const [first, second] = await Promise.all([firstPromise, secondPromise]);
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(second.headers["x-chat-queue-position"]).toBe("1");

      const firstEvents = parseSsePayloads(first.text);
      const secondEvents = parseSsePayloads(second.text);
      expect(firstEvents.some((event) => event.event === "done")).toBe(true);
      expect(secondEvents.some((event) => event.event === "done")).toBe(true);
    } finally {
      await close();
    }
  }, 60000);

  it("waits for the run created by /messages and never recreates the user message in /chat/stream", async () => {
    const app = await makeApp();
    const { client, close } = await createHttpTestClient(app);
    const { storage } = await import("../storage");

    const pendingRun = {
      id: "run_wait",
      chatId: "chat_wait",
      clientRequestId: "cr_wait",
      userMessageId: "msg_wait",
      assistantMessageId: null,
      status: "pending",
      lastSeq: 0,
      startedAt: null,
    };

    vi.mocked(storage.getChatRunByClientRequestId)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(pendingRun as any);
    vi.mocked(storage.claimPendingRun).mockResolvedValue({
      ...pendingRun,
      status: "processing",
      startedAt: new Date(),
    } as any);

    try {
      const response = await client
        .post("/api/chat/stream")
        .set("x-request-id", "req_wait")
        .send({
          messages: [{ role: "user", content: "Hola" }],
          conversationId: "chat_wait",
          chatId: "chat_wait",
          clientRequestId: "cr_wait",
          userRequestId: "user_req_wait",
          latencyMode: "fast",
        });

      expect(response.status).toBe(200);
      expect(storage.getChatRunByClientRequestId).toHaveBeenCalledTimes(3);
      expect(storage.claimPendingRun).toHaveBeenCalledWith("chat_wait", "cr_wait");
      expect((storage as any).createUserMessageAndRun).not.toHaveBeenCalled();
      expect((storage as any).createChatRun).not.toHaveBeenCalled();
    } finally {
      await close();
    }
  }, 60000);
});
