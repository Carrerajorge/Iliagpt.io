import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IntentResult } from "../services/intentRouter";

const {
  startProductionPipelineMock,
  generateProfessionalPptxMock,
} = vi.hoisted(() => ({
  startProductionPipelineMock: vi.fn(),
  generateProfessionalPptxMock: vi.fn(),
}));

vi.mock("../agent/production", () => ({
  startProductionPipeline: startProductionPipelineMock,
}));

vi.mock("../services/documentGenerators/professionalPptxGenerator", () => ({
  generateProfessionalPptx: generateProfessionalPptxMock,
}));

vi.mock("../services/libraryService", () => ({
  libraryService: {
    generateUploadUrl: vi.fn(),
    saveFileMetadata: vi.fn(),
  },
}));

vi.mock("../storage", () => ({
  storage: {
    createChatMessage: vi.fn(async () => ({ id: "assistant-placeholder" })),
    updateChatMessageContent: vi.fn(async () => null),
  },
}));

vi.mock("../services/conversationStateService", () => ({
  conversationStateService: {
    appendMessage: vi.fn(async () => null),
  },
}));

vi.mock("../services/academicArticlesExport", () => ({
  exportAcademicArticlesFromPrompt: vi.fn(),
}));

import { storage } from "../storage";
import { handleProductionRequest } from "../services/productionHandler";

function makeIntentResult(overrides: Partial<IntentResult> = {}): IntentResult {
  return {
    intent: "CREATE_PRESENTATION",
    output_format: "pptx",
    slots: { topic: "ventas" },
    confidence: 0.95,
    normalized_text: "crea un excelente ppt con formulas de ventas",
    ...overrides,
  };
}

function makePptResult(overrides: Record<string, unknown> = {}) {
  return {
    buffer: Buffer.from("pptx-binary"),
    filename: "ventas-ejecutivas.pptx",
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    previewHtml: "<div>Preview PPT ventas CAC</div>",
    slideCount: 6,
    ...overrides,
  };
}

function createMockResponse() {
  const chunks: string[] = [];
  const res = {
    locals: {},
    headersSent: false,
    setHeader: vi.fn(),
    flushHeaders: vi.fn(),
    write: vi.fn((chunk: string) => {
      chunks.push(chunk);
      return true;
    }),
    end: vi.fn(),
  } as any;

  return { res, chunks };
}

function parseSseEvents(chunks: string[]) {
  return chunks
    .map((chunk) => {
      const match = chunk.match(/^event: ([^\n]+)\ndata: ([\s\S]+)\n\n$/);
      if (!match) return null;
      return {
        event: match[1],
        data: JSON.parse(match[2]),
      };
    })
    .filter(Boolean) as Array<{ event: string; data: Record<string, any> }>;
}

describe("productionHandler professional PPT fast path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    generateProfessionalPptxMock.mockResolvedValue(makePptResult());
  });

  it("routes a single PPTX request to the professional artifact engine instead of the legacy pipeline", async () => {
    const { res } = createMockResponse();

    const result = await handleProductionRequest(
      {
        message: "crea un excelente ppt con formulas de ventas",
        userId: "user-1",
        chatId: "chat-1",
        conversationId: "conv-1",
        requestId: "req-ppt-1",
        assistantMessageId: "assistant-ppt-1",
        intentResult: makeIntentResult(),
      },
      res,
    );

    expect(result.handled).toBe(true);
    expect(generateProfessionalPptxMock).toHaveBeenCalledOnce();
    expect(startProductionPipelineMock).not.toHaveBeenCalled();
  });

  it("emits artifact_generation start metadata with artifact-engine for PPTX", async () => {
    const { res, chunks } = createMockResponse();

    await handleProductionRequest(
      {
        message: "crea un excelente ppt con formulas de ventas",
        userId: "user-1",
        chatId: "chat-1",
        conversationId: "conv-1",
        requestId: "req-ppt-2",
        assistantMessageId: "assistant-ppt-2",
        intentResult: makeIntentResult(),
      },
      res,
    );

    const events = parseSseEvents(chunks);
    const startEvent = events.find((event) => event.event === "production_start");

    expect(startEvent?.data).toMatchObject({
      workflow: "artifact_generation",
      classification: "artifact_generation",
      engine: "artifact-engine",
      docKind: "pptx",
    });
  });

  it("emits deterministic stage events from intake to export", async () => {
    const { res, chunks } = createMockResponse();

    await handleProductionRequest(
      {
        message: "crea un excelente ppt con formulas de ventas",
        userId: "user-1",
        chatId: "chat-1",
        conversationId: "conv-1",
        requestId: "req-ppt-3",
        assistantMessageId: "assistant-ppt-3",
        intentResult: makeIntentResult(),
      },
      res,
    );

    const stages = parseSseEvents(chunks)
      .filter((event) => event.event === "production_event")
      .map((event) => String(event.data.stage));

    expect(stages).toEqual(["intake", "blueprint", "slides", "render", "export"]);
  });

  it("streams the PPT artifact with previewHtml and slide metadata", async () => {
    const { res, chunks } = createMockResponse();

    await handleProductionRequest(
      {
        message: "crea un excelente ppt con formulas de ventas",
        userId: "user-1",
        chatId: "chat-1",
        conversationId: "conv-1",
        requestId: "req-ppt-4",
        assistantMessageId: "assistant-ppt-4",
        intentResult: makeIntentResult(),
      },
      res,
    );

    const artifactEvent = parseSseEvents(chunks).find((event) => event.event === "artifact");

    expect(artifactEvent?.data).toMatchObject({
      type: "ppt",
      filename: "ventas-ejecutivas.pptx",
      previewHtml: "<div>Preview PPT ventas CAC</div>",
      mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      metadata: expect.objectContaining({
        engine: "artifact-engine",
        docKind: "pptx",
        slideCount: 6,
        theme: "corporate-blue",
      }),
    });
    expect(String(artifactEvent?.data.downloadUrl || "")).toContain("/api/artifacts/");
  });

  it("emits a concise completion summary and a done artifact payload", async () => {
    const { res, chunks } = createMockResponse();

    await handleProductionRequest(
      {
        message: "crea un excelente ppt con formulas de ventas",
        userId: "user-1",
        chatId: "chat-1",
        conversationId: "conv-1",
        requestId: "req-ppt-5",
        assistantMessageId: "assistant-ppt-5",
        intentResult: makeIntentResult(),
      },
      res,
    );

    const events = parseSseEvents(chunks);
    const completeEvent = events.find((event) => event.event === "production_complete");
    const chunkEvent = events.find((event) => event.event === "chunk");
    const doneEvent = events.find((event) => event.event === "done");

    expect(completeEvent?.data.success).toBe(true);
    expect(completeEvent?.data.summary).toBe(
      "Presentación lista para descargar. Haz clic en descargar para obtenerla.",
    );
    expect(chunkEvent?.data.content).toBe(
      "Presentación lista para descargar. Haz clic en descargar para obtenerla.",
    );
    expect(doneEvent?.data.artifact).toMatchObject({
      type: "presentation",
      filename: "ventas-ejecutivas.pptx",
      previewHtml: "<div>Preview PPT ventas CAC</div>",
    });
  });

  it("persists the assistant message with PPT preview metadata", async () => {
    const { res } = createMockResponse();

    await handleProductionRequest(
      {
        message: "crea un excelente ppt con formulas de ventas",
        userId: "user-1",
        chatId: "chat-1",
        conversationId: "conv-1",
        requestId: "req-ppt-6",
        assistantMessageId: "assistant-ppt-6",
        intentResult: makeIntentResult(),
      },
      res,
    );

    expect(vi.mocked(storage.updateChatMessageContent)).toHaveBeenCalledWith(
      "assistant-ppt-6",
      "Presentación lista para descargar. Haz clic en descargar para obtenerla.",
      "done",
      expect.objectContaining({
        artifact: expect.objectContaining({
          filename: "ventas-ejecutivas.pptx",
          previewHtml: "<div>Preview PPT ventas CAC</div>",
          metadata: expect.objectContaining({
            engine: "artifact-engine",
            slideCount: 6,
          }),
        }),
      }),
    );
  });

  it("injects a formulas table for sales prompts", async () => {
    const { res } = createMockResponse();

    await handleProductionRequest(
      {
        message: "crea un excelente ppt con formulas de ventas",
        userId: "user-1",
        chatId: "chat-1",
        conversationId: "conv-1",
        requestId: "req-ppt-7",
        assistantMessageId: "assistant-ppt-7",
        intentResult: makeIntentResult(),
      },
      res,
    );

    const generatorRequest = vi.mocked(generateProfessionalPptxMock).mock.calls[0]?.[0];
    const formulaSlide = generatorRequest?.slides.find((slide: any) => slide.type === "table");

    expect(formulaSlide?.title).toBe("Fórmulas y KPIs prioritarios");
    expect(formulaSlide?.tableData?.rows).toEqual(
      expect.arrayContaining([
        expect.arrayContaining(["CAC", "Inversión comercial / Clientes nuevos"]),
        expect.arrayContaining(["Tasa de conversión", "Clientes cerrados / Leads calificados"]),
      ]),
    );
  });

  it("maps prompt style hints to a professional theme", async () => {
    const { res } = createMockResponse();

    await handleProductionRequest(
      {
        message: "crea un ppt minimal de ventas",
        userId: "user-1",
        chatId: "chat-1",
        conversationId: "conv-1",
        requestId: "req-ppt-8",
        assistantMessageId: "assistant-ppt-8",
        intentResult: makeIntentResult({
          normalized_text: "crea un ppt minimal de ventas",
        }),
      },
      res,
    );

    const generatorRequest = vi.mocked(generateProfessionalPptxMock).mock.calls[0]?.[0];
    expect(generatorRequest?.theme).toBe("minimal-gray");
  });

  it("captures brand metadata from the prompt", async () => {
    const { res, chunks } = createMockResponse();

    await handleProductionRequest(
      {
        message: "crea un ppt de ventas marca Acme Corp",
        userId: "user-1",
        chatId: "chat-1",
        conversationId: "conv-1",
        requestId: "req-ppt-9",
        assistantMessageId: "assistant-ppt-9",
        intentResult: makeIntentResult({
          normalized_text: "crea un ppt de ventas marca acme corp",
        }),
      },
      res,
    );

    const artifactEvent = parseSseEvents(chunks).find((event) => event.event === "artifact");
    expect(artifactEvent?.data.metadata).toMatchObject({
      brandName: "Acme Corp",
      engine: "artifact-engine",
    });
  });

  it("falls back to a safe executive title when the prompt has no topic", async () => {
    const { res } = createMockResponse();

    await handleProductionRequest(
      {
        message: "crea un powerpoint",
        userId: "user-1",
        chatId: "chat-1",
        conversationId: "conv-1",
        requestId: "req-ppt-10",
        assistantMessageId: "assistant-ppt-10",
        intentResult: makeIntentResult({
          slots: {},
          normalized_text: "crea un powerpoint",
        }),
      },
      res,
    );

    const generatorRequest = vi.mocked(generateProfessionalPptxMock).mock.calls[0]?.[0];
    expect(generatorRequest?.title).toBe("Presentación Ejecutiva");
  });
});
