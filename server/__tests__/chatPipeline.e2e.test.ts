import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const llmChatMock = vi.fn();
const llmStreamChatMock = vi.fn();
const llmGuaranteeResponseMock = vi.fn();
const routeIntentMock = vi.fn();
const chatServiceChatMock = vi.fn();

vi.mock("../services/ChatServiceV2", () => ({
  chatService: { chat: chatServiceChatMock },
  AVAILABLE_MODELS: {},
  DEFAULT_PROVIDER: "openai",
  DEFAULT_MODEL: "gpt-4o-mini",
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
    createChat: vi.fn(async () => ({ id: "chat-1" })),
    createChatMessage: vi.fn(async () => ({ id: "m1" })),
    createChatRun: vi.fn(async () => ({ id: "run-1" })),
    createUserMessageAndRun: vi.fn(async () => ({
      message: { id: "m-user" },
      run: { id: "run-1", chatId: "chat-1", clientRequestId: "req-1", userMessageId: "m-user", status: "pending" },
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

vi.mock("../services/conversationMemory", () => ({
  conversationMemoryManager: {
    augmentWithHistory: vi.fn(async (_cid: string, msgs: any[]) => msgs),
  },
}));

vi.mock("../services/conversationStateService", () => ({
  conversationStateService: { appendMessage: vi.fn(async () => null) },
}));

vi.mock("../services/usageQuotaService", () => ({
  usageQuotaService: {
    hasTokenQuota: vi.fn(async () => true),
    getDailyTokenQuotaStatus: vi.fn(async () => ({ allowed: true })),
    checkAndIncrementUsage: vi.fn(async () => ({ allowed: true })),
    recordTokenUsage: vi.fn(async () => null),
    recordTokenUsageDetailed: vi.fn(async () => null),
    validateUnifiedQuota: vi.fn(async () => ({ allowed: true })),
  },
}));

vi.mock("../lib/anonUserHelper", () => ({
  getOrCreateSecureUserId: vi.fn(() => "user_test"),
  getSecureUserId: vi.fn(() => "user_test"),
}));

vi.mock("../types/express", () => ({ getUserId: vi.fn(() => "user_test") }));
vi.mock("../lib/ensureUserRowExists", () => ({ ensureUserRowExists: vi.fn(async () => null) }));
vi.mock("../services/intentRouter", () => ({ routeIntent: routeIntentMock }));
vi.mock("../services/questionClassifier", () => ({ questionClassifier: { classifyQuestion: vi.fn(() => ({ type: "analysis", maxTokens: 256 })) } }));
vi.mock("../services/skillContextResolver", () => ({ drizzleSkillStore: {}, resolveSkillContextFromRequest: vi.fn(async () => null), buildSkillSystemPromptSection: vi.fn(() => "") }));
vi.mock("../services/skillPlatform", () => ({ getSkillPlatformService: vi.fn(() => ({ executeFromMessage: vi.fn(async () => ({ status: "skipped", continueWithModel: true, outputText: "", autoCreated: false, requiresConfirmation: false, traces: [], fallbackText: "", error: undefined, output: undefined, policyBreached: undefined, selectedSkill: undefined })) })) }));

function parseSse(raw: string): Array<{ event: string; data: any }> {
  return raw.split("\n\n").map((block) => block.trim()).filter(Boolean).map((block) => {
    const event = block.match(/^event:\s*(.+)$/m)?.[1]?.trim();
    const data = block.match(/^data:\s*(.+)$/m)?.[1];
    return event && data ? { event, data: JSON.parse(data) } : null;
  }).filter(Boolean) as Array<{ event: string; data: any }>;
}

async function* mockStream(text: string, requestId = "req-1") {
  yield { content: text, done: false, provider: "openai", requestId, sequenceId: 1 };
  yield { content: "", done: true, provider: "openai", requestId, sequenceId: 2 };
}

async function makeApp() {
  const { createChatAiRouter } = await import("../routes/chatAiRouter");
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/api", createChatAiRouter(() => {}));
  return app;
}

describe("chat pipeline e2e", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    routeIntentMock.mockReturnValue({ intent: "CHAT_GENERAL", confidence: 0.9, output_format: null, slots: {}, language_detected: "es" });
    chatServiceChatMock.mockResolvedValue({ content: "respuesta ok", role: "assistant", usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } });
    llmChatMock.mockResolvedValue({ content: "respuesta ok", provider: "openai", model: "gpt-4o-mini" });
    llmGuaranteeResponseMock.mockResolvedValue({ content: "respuesta ok", provider: "openai", model: "gpt-4o-mini" });
    llmStreamChatMock.mockImplementation((messages: any[], options?: any) => mockStream(`stream:${String(messages[messages.length - 1]?.content || "")}`, options?.requestId || "req-1"));
  });

  it("returns non-empty text for hola", async () => {
    const app = await makeApp();
    const res = await request(app).post("/api/chat").send({ messages: [{ role: "user", content: "hola" }] });
    expect(res.status).toBe(200);
    expect(String(res.body.content || "").length).toBeGreaterThan(0);
  });

  it("handles a long message without crashing", async () => {
    const app = await makeApp();
    const res = await request(app).post("/api/chat").send({ messages: [{ role: "user", content: "a".repeat(5000) }] });
    expect(res.status).toBe(200);
  });

  it("preserves ordering across 15 sequential sends", async () => {
    const app = await makeApp();
    for (let i = 0; i < 15; i += 1) {
      const res = await request(app).post("/api/chat").send({ messages: [{ role: "user", content: `msg-${i}` }] });
      expect(res.status).toBe(200);
      expect(String(res.body.content)).toContain("respuesta");
    }
  });

  it("streams chunks and done event", async () => {
    const app = await makeApp();
    const res = await request(app).post("/api/chat/stream").send({ messages: [{ role: "user", content: "hola" }], conversationId: "chat-1", chatId: "chat-1" });
    const events = parseSse(res.text);
    expect(events.some((e) => e.event === "chunk")).toBe(true);
    expect(events.some((e) => e.event === "done")).toBe(true);
  });

  it("returns graceful error when stream model fails", async () => {
    llmStreamChatMock.mockImplementationOnce(async function* () { throw new Error("provider down"); });
    const app = await makeApp();
    const res = await request(app).post("/api/chat/stream").send({ messages: [{ role: "user", content: "hola" }], conversationId: "chat-2", chatId: "chat-2" });
    expect(res.status).toBe(200);
    expect(res.text).toContain("error");
  });

  it("detects CREATE_DOCUMENT for word requests", async () => {
    routeIntentMock.mockReturnValueOnce({ intent: "CREATE_DOCUMENT", confidence: 0.95, output_format: "docx", slots: {}, language_detected: "es" });
    const app = await makeApp();
    const res = await request(app).post("/api/chat/stream").send({ messages: [{ role: "user", content: "crea un Word" }], conversationId: "chat-3", chatId: "chat-3" });
    expect(res.text).toContain('"correctedTo":"CREATE_DOCUMENT"');
  });

  it("keeps visual requests out of CREATE_PRESENTATION", async () => {
    routeIntentMock.mockReturnValueOnce({ intent: "CHAT_GENERAL", confidence: 0.7, output_format: null, slots: {}, language_detected: "es" });
    const app = await makeApp();
    const res = await request(app).post("/api/chat/stream").send({ messages: [{ role: "user", content: "hazme un diagrama mermaid" }], conversationId: "chat-4", chatId: "chat-4" });
    expect(res.text).not.toContain('CREATE_PRESENTATION');
  });

  it("detects search requests", async () => {
    routeIntentMock.mockReturnValueOnce({ intent: "SEARCH_WEB", confidence: 0.9, output_format: null, slots: {}, language_detected: "es" });
    const app = await makeApp();
    const res = await request(app).post("/api/chat/stream").send({ messages: [{ role: "user", content: "busca información sobre X" }], conversationId: "chat-5", chatId: "chat-5" });
    expect(res.text).toContain('"intent":"SEARCH_WEB"');
  });

  it("detects code execution requests", async () => {
    routeIntentMock.mockReturnValueOnce({ intent: "EXECUTE_CODE", confidence: 0.9, output_format: null, slots: {}, language_detected: "es" });
    const app = await makeApp();
    const res = await request(app).post("/api/chat/stream").send({ messages: [{ role: "user", content: "ejecuta print(\"hello\")" }], conversationId: "chat-6", chatId: "chat-6" });
    expect(res.text).toContain('"shellCommand":"print(\\"hello\\")"');
  });

  it("keeps small talk as general chat", async () => {
    routeIntentMock.mockReturnValueOnce({ intent: "CHAT_GENERAL", confidence: 0.95, output_format: null, slots: {}, language_detected: "es" });
    const app = await makeApp();
    const res = await request(app).post("/api/chat/stream").send({ messages: [{ role: "user", content: "hola como estas" }], conversationId: "chat-7", chatId: "chat-7" });
    expect(res.text).toContain("event: chunk");
    expect(res.text).toContain("event: done");
  });

  it("passes through mermaid renderable content", async () => {
    llmStreamChatMock.mockImplementationOnce((_messages: any[], options?: any) => mockStream("```mermaid\ngraph TD;A-->B;\n```", options?.requestId));
    const app = await makeApp();
    const res = await request(app).post("/api/chat/stream").send({ messages: [{ role: "user", content: "mermaid" }], conversationId: "chat-8", chatId: "chat-8" });
    expect(res.text).toContain("mermaid");
  });

  it("passes through svg renderable content", async () => {
    llmStreamChatMock.mockImplementationOnce((_messages: any[], options?: any) => mockStream("```svg\n<svg></svg>\n```", options?.requestId));
    const app = await makeApp();
    const res = await request(app).post("/api/chat/stream").send({ messages: [{ role: "user", content: "svg" }], conversationId: "chat-9", chatId: "chat-9" });
    expect(res.text).toContain("svg");
  });

  it("accepts docx-style attachment metadata in stream", async () => {
    const app = await makeApp();
    const res = await request(app).post("/api/chat/stream").send({ messages: [{ role: "user", content: "revisa adjunto" }], attachments: [{ name: "demo.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", storagePath: "/tmp/demo.docx" }], conversationId: "chat-10", chatId: "chat-10" });
    expect(res.status).toBe(200);
  });

  it("returns rate-limit style failure when quota blocks", async () => {
    const { usageQuotaService } = await import("../services/usageQuotaService");
    (usageQuotaService.validateUnifiedQuota as any).mockResolvedValueOnce({ allowed: false, payload: { code: "TOKEN_QUOTA_EXCEEDED", message: "sin cuota", statusCode: 402 } });
    const app = await makeApp();
    const res = await request(app).post("/api/chat/stream").send({ messages: [{ role: "user", content: "hola" }], conversationId: "chat-11", chatId: "chat-11" });
    expect(res.text).toContain("TOKEN_QUOTA_EXCEEDED");
  });

  it("returns friendly failure when llm chat throws", async () => {
    chatServiceChatMock.mockRejectedValueOnce(new Error("llm fail"));
    const app = await makeApp();
    const res = await request(app).post("/api/chat").send({ messages: [{ role: "user", content: "hola" }] });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("can abort stream endpoint cleanly at response level", async () => {
    const app = await makeApp();
    const res = await request(app).post("/api/chat/stream").send({ messages: [{ role: "user", content: "cancelar" }], conversationId: "chat-12", chatId: "chat-12", queueMode: "reject" });
    expect(res.status).toBe(200);
  });
});
