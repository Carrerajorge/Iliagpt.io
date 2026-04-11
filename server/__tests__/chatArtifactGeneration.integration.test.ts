import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { storage } from "../storage";
import { getOrCreateSecureUserId } from "../lib/anonUserHelper";
import { getUserId } from "../types/express";
import { routeIntent } from "../services/intentRouter";

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
    vi.mocked(getOrCreateSecureUserId).mockReturnValue("user_test");
    vi.mocked(getUserId).mockReturnValue("user_test");
    vi.mocked(routeIntent).mockReturnValue({
      intent: "CREATE_DOCUMENT",
      output_format: "docx",
      slots: { topic: "IA" },
      confidence: 0.98,
      normalized_text: "crea un word de la ia",
      language_detected: "es",
    } as any);
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

  it("downgrades anonymous premium model requests to the free model instead of failing the office flow", async () => {
    vi.mocked(getOrCreateSecureUserId).mockReturnValue("anon_test");
    vi.mocked(getUserId).mockReturnValue(null as any);

    officeEngineRunMock.mockImplementation(async (req: any, streamer: any) => {
      req.onStart?.("office-chat-run-anon");
      const plan = streamer.start("thinking", "Planificando documento ejecutivo");
      streamer.complete(plan, { output: "market study executive summary" });
      return {
        runId: "office-chat-run-anon",
        status: "succeeded",
        fallbackLevel: 0,
        durationMs: 180,
        artifacts: [
          {
            id: "artifact-chat-anon",
            kind: "exported",
            path: "/tmp/office-chat-run-anon.docx",
            mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            sizeBytes: 4096,
            checksumSha256: "sha-chat-anon",
            downloadUrl: "/api/office-engine/runs/office-chat-run-anon/artifacts/exported",
            previewUrl: "/api/office-engine/runs/office-chat-run-anon/artifacts/preview",
          },
        ],
      };
    });

    const app = await makeApp();
    const response = await request(app)
      .post("/api/chat/stream")
      .set("x-request-id", "req-chat-artifact-anon")
      .send({
        messages: [{ role: "user", content: "crea un Word con resumen ejecutivo para directorio sobre estudio de mercado de banca digital" }],
        conversationId: "chat-artifact-anon",
        chatId: "chat-artifact-anon",
        model: "z-ai/glm-5",
        latencyMode: "fast",
      });

    expect(response.status).toBe(200);
    const events = parseSsePayloads(response.text);
    const startEvent = events.find((event) => event.event === "production_start");
    const doneEvent = events.find((event) => event.event === "done");

    expect(startEvent?.data).toMatchObject({
      workflow: "artifact_generation",
      classification: "artifact_generation",
      engine: "office-engine",
      docKind: "docx",
    });
    expect(doneEvent?.data.conversationId).toBe("chat-artifact-anon");
    expect(response.text).toContain("Documento listo para descargar");
    expect(response.text).not.toContain("AUTH_REQUIRED");
    expect(response.text).not.toContain("Authentication required");
    expect(officeEngineRunMock).toHaveBeenCalledTimes(1);
  });

  it("routes a natural XLSX request from chat into the office engine and finishes with a spreadsheet artifact", async () => {
    vi.mocked(routeIntent).mockReturnValue({
      intent: "CREATE_SPREADSHEET",
      output_format: "xlsx",
      slots: { topic: "proyección financiera trimestral" },
      confidence: 0.97,
      normalized_text: "crea un excel profesional con proyeccion financiera trimestral",
      language_detected: "es",
    } as any);

    officeEngineRunMock.mockImplementation(async (req: any, streamer: any) => {
      req.onStart?.("office-chat-run-xlsx");
      const plan = streamer.start("thinking", "Planificando edición XLSX");
      streamer.complete(plan, { output: "build financial workbook" });
      return {
        runId: "office-chat-run-xlsx",
        status: "succeeded",
        fallbackLevel: 1,
        durationMs: 190,
        artifacts: [
          {
            id: "artifact-chat-xlsx",
            kind: "exported",
            path: "/tmp/office-chat-run-xlsx.xlsx",
            mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            sizeBytes: 6144,
            checksumSha256: "sha-chat-xlsx",
            downloadUrl: "/api/office-engine/runs/office-chat-run-xlsx/artifacts/exported",
            previewUrl: "/api/office-engine/runs/office-chat-run-xlsx/artifacts/preview",
          },
        ],
      };
    });

    const app = await makeApp();
    const response = await request(app)
      .post("/api/chat/stream")
      .set("x-request-id", "req-chat-artifact-xlsx")
      .send({
        messages: [{ role: "user", content: "crea un Excel profesional con proyección financiera trimestral" }],
        conversationId: "chat-artifact-xlsx",
        chatId: "chat-artifact-xlsx",
        latencyMode: "fast",
      });

    expect(response.status).toBe(200);
    const events = parseSsePayloads(response.text);
    const startEvent = events.find((event) => event.event === "production_start");
    const artifactEvent = events.find((event) => event.event === "artifact");

    expect(startEvent?.data).toMatchObject({
      workflow: "artifact_generation",
      engine: "office-engine",
      docKind: "xlsx",
      conversationId: "chat-artifact-xlsx",
    });
    expect(artifactEvent?.data).toMatchObject({
      type: "xlsx",
      downloadUrl: "/api/office-engine/runs/office-chat-run-xlsx/artifacts/exported",
      previewUrl: "/api/office-engine/runs/office-chat-run-xlsx/artifacts/preview",
      metadata: expect.objectContaining({
        officeRunId: "office-chat-run-xlsx",
        engine: "office-engine",
        docKind: "xlsx",
      }),
    });
    expect(response.text).toContain("Hoja de cálculo lista para descargar");
  });

  it("routes a natural PDF request from chat into the office engine and finishes with a pdf artifact", async () => {
    vi.mocked(routeIntent).mockReturnValue({
      intent: "CREATE_DOCUMENT",
      output_format: "pdf",
      slots: { topic: "reporte ejecutivo" },
      confidence: 0.97,
      normalized_text: "crea un pdf ejecutivo",
      language_detected: "es",
    } as any);

    officeEngineRunMock.mockImplementation(async (req: any, streamer: any) => {
      req.onStart?.("office-chat-run-pdf");
      const plan = streamer.start("thinking", "Planificando PDF ejecutivo");
      streamer.complete(plan, { output: "build executive pdf" });
      return {
        runId: "office-chat-run-pdf",
        status: "succeeded",
        fallbackLevel: 0,
        durationMs: 164,
        artifacts: [
          {
            id: "artifact-chat-pdf",
            kind: "exported",
            path: "/tmp/office-chat-run-pdf.pdf",
            mimeType: "application/pdf",
            sizeBytes: 4096,
            checksumSha256: "sha-chat-pdf",
            downloadUrl: "/api/office-engine/runs/office-chat-run-pdf/artifacts/exported",
            previewUrl: "/api/office-engine/runs/office-chat-run-pdf/artifacts/preview",
          },
        ],
      };
    });

    const app = await makeApp();
    const response = await request(app)
      .post("/api/chat/stream")
      .set("x-request-id", "req-chat-artifact-pdf")
      .send({
        messages: [{ role: "user", content: "crea un pdf ejecutivo de estudio de mercado" }],
        conversationId: "chat-artifact-pdf",
        chatId: "chat-artifact-pdf",
        latencyMode: "fast",
      });

    expect(response.status).toBe(200);
    const events = parseSsePayloads(response.text);
    const startEvent = events.find((event) => event.event === "production_start");
    const artifactEvent = events.find((event) => event.event === "artifact");

    expect(startEvent?.data).toMatchObject({
      workflow: "artifact_generation",
      engine: "office-engine",
      docKind: "pdf",
      conversationId: "chat-artifact-pdf",
    });
    expect(artifactEvent?.data).toMatchObject({
      type: "pdf",
      downloadUrl: "/api/office-engine/runs/office-chat-run-pdf/artifacts/exported",
      previewUrl: "/api/office-engine/runs/office-chat-run-pdf/artifacts/preview",
      metadata: expect.objectContaining({
        officeRunId: "office-chat-run-pdf",
        engine: "office-engine",
        docKind: "pdf",
      }),
    });
    expect(response.text).toContain("PDF listo para descargar");
  });
});
