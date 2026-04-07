import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IntentResult } from "../services/intentRouter";

const { startProductionPipelineMock } = vi.hoisted(() => ({
  startProductionPipelineMock: vi.fn(),
}));

vi.mock("../agent/production", () => ({
  startProductionPipeline: startProductionPipelineMock,
}));

vi.mock("../services/libraryService", () => ({
  libraryService: {
    generateUploadUrl: vi.fn(),
    saveFileMetadata: vi.fn(),
  },
}));

vi.mock("../services/academicArticlesExport", () => ({
  exportAcademicArticlesFromPrompt: vi.fn(),
}));

import { handleProductionRequest } from "../services/productionHandler";

function makeIntentResult(overrides: Partial<IntentResult> = {}): IntentResult {
  return {
    intent: "CREATE_PRESENTATION",
    output_format: "pptx",
    slots: { topic: "gestion administrativa" },
    confidence: 0.92,
    normalized_text: "crea una ppt de la gestion administrativa",
    ...overrides,
  };
}

function makeProductionResult(overrides: Record<string, unknown> = {}) {
  return {
    workOrderId: "wo-1",
    status: "failed",
    artifacts: [],
    summary: "## Producción Fallida\n\n**Error:** No se pudo generar la presentación.",
    evidencePack: {
      sources: [],
      notes: [],
      dataPoints: [],
      gaps: [],
      limitations: [],
    },
    traceMap: {
      links: [],
      inconsistencies: [],
      coverageScore: 0,
    },
    qaReport: {
      overallScore: 0,
      passed: false,
      checks: [],
      suggestions: [],
      blockers: [],
    },
    timing: {
      startedAt: new Date("2026-04-07T04:00:00.000Z"),
      completedAt: new Date("2026-04-07T04:00:01.000Z"),
      durationMs: 1000,
      stageTimings: {} as any,
    },
    costs: {
      llmCalls: 0,
      searchQueries: 0,
      tokensUsed: 0,
    },
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

describe("productionHandler execution failures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("emits a production error instead of a fake completed summary when the pipeline fails", async () => {
    startProductionPipelineMock.mockResolvedValue(
      makeProductionResult({
        status: "failed",
        summary: "## Producción Fallida\n\n**Error:** No se pudo generar la presentación.",
      }),
    );

    const { res, chunks } = createMockResponse();
    const result = await handleProductionRequest(
      {
        message: "crea una ppt de la gestion administrativa",
        userId: "user-1",
        chatId: "chat-1",
        conversationId: "conv-1",
        requestId: "req-1",
        assistantMessageId: "assistant-1",
        intentResult: makeIntentResult(),
      },
      res,
    );

    const events = parseSseEvents(chunks);
    const completionEvent = events.find((event) => event.event === "production_complete");
    const errorEvent = events.find((event) => event.event === "production_error");
    const chunkEvent = events.find((event) => event.event === "chunk");

    expect(result.error).toBe("No se pudo generar la presentación.");
    expect(completionEvent?.data.success).toBe(false);
    expect(errorEvent?.data.error).toBe("No se pudo generar la presentación.");
    expect(chunkEvent?.data.content).toContain("Error en la producción documental");
    expect(chunkEvent?.data.content).not.toContain("## 📄 Documentos Generados");
  });

  it("treats empty successful results as failures when no artifacts were generated", async () => {
    startProductionPipelineMock.mockResolvedValue(
      makeProductionResult({
        status: "success",
        summary: "## Producción Completada\n\n**Entregables:** Ninguno",
      }),
    );

    const { res, chunks } = createMockResponse();
    const result = await handleProductionRequest(
      {
        message: "crea una ppt de la gestion administrativa",
        userId: "user-1",
        chatId: "chat-1",
        conversationId: "conv-1",
        requestId: "req-2",
        assistantMessageId: "assistant-2",
        intentResult: makeIntentResult(),
      },
      res,
    );

    const events = parseSseEvents(chunks);
    const completionEvent = events.find((event) => event.event === "production_complete");
    const errorEvent = events.find((event) => event.event === "production_error");

    expect(result.error).toContain("No se pudo generar ninguno de los entregables solicitados");
    expect(completionEvent?.data.success).toBe(false);
    expect(errorEvent?.data.error).toContain("No se pudo generar ninguno de los entregables solicitados");
  });

  it("streams a concise delivery message when an artifact is generated successfully", async () => {
    startProductionPipelineMock.mockResolvedValue(
      makeProductionResult({
        status: "success",
        artifacts: [
          {
            type: "ppt",
            filename: "gestion_administrativa.pptx",
            buffer: Buffer.from("pptx"),
            mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            size: 4,
          },
        ],
        summary: "## Producción Completada\n\nPresentación generada.",
      }),
    );

    const { res, chunks } = createMockResponse();
    const result = await handleProductionRequest(
      {
        message: "crea una ppt de la gestion administrativa",
        userId: "user-1",
        chatId: "chat-1",
        conversationId: "conv-1",
        requestId: "req-3",
        assistantMessageId: "assistant-3",
        intentResult: makeIntentResult(),
      },
      res,
    );

    const events = parseSseEvents(chunks);
    const artifactEvent = events.find((event) => event.event === "artifact");
    const completionEvent = events.find((event) => event.event === "production_complete");
    const chunkEvent = events.find((event) => event.event === "chunk");

    expect(result.handled).toBe(true);
    expect(artifactEvent?.data.downloadUrl).toContain("/api/artifacts/");
    expect(completionEvent?.data.success).toBe(true);
    expect(completionEvent?.data.summary).toBe("Presentación lista para descargar. Haz clic en descargar para obtenerlo.");
    expect(chunkEvent?.data.content).toBe("Presentación lista para descargar. Haz clic en descargar para obtenerlo.");
    expect(chunkEvent?.data.content).not.toContain("## 📄 Documentos Generados");
  });
});
