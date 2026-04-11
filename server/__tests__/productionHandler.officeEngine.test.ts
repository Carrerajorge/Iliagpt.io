import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IntentResult } from "../services/intentRouter";

const { officeEngineRunMock } = vi.hoisted(() => ({
  officeEngineRunMock: vi.fn(),
}));

vi.mock("../lib/office/engine/OfficeEngine", () => ({
  officeEngine: {
    run: officeEngineRunMock,
  },
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

vi.mock("../agent/production", () => ({
  startProductionPipeline: vi.fn(),
}));

vi.mock("../services/academicArticlesExport", () => ({
  exportAcademicArticlesFromPrompt: vi.fn(),
}));

import { handleProductionRequest } from "../services/productionHandler";

function makeIntentResult(overrides: Partial<IntentResult> = {}): IntentResult {
  return {
    intent: "CREATE_DOCUMENT",
    output_format: "docx",
    slots: { topic: "IA" },
    confidence: 0.97,
    normalized_text: "crea un word de la ia",
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

describe("productionHandler office-engine bridge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("routes DOCX requests to the office engine and emits artifact-generation metadata", async () => {
    officeEngineRunMock.mockImplementation(async (req: any, streamer: any) => {
      req.onStart?.("office-run-docx");

      const plan = streamer.start("thinking", "Planificando edición DOCX");
      streamer.complete(plan, { output: "create document from spec" });

      const edit = streamer.start("editing", "Aplicando edición", {
        diff: { added: 24, removed: 0 },
        expandable: true,
      });
      streamer.complete(edit, { output: "Documento generado desde especificación" });

      return {
        runId: "office-run-docx",
        status: "succeeded",
        fallbackLevel: 0,
        durationMs: 321,
        artifacts: [
          {
            id: "artifact-1",
            kind: "exported",
            path: "/tmp/office-run-docx.docx",
            mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            sizeBytes: 4096,
            checksumSha256: "sha256-docx",
            downloadUrl: "/api/office-engine/runs/office-run-docx/artifacts/exported",
            previewUrl: "/api/office-engine/runs/office-run-docx/artifacts/preview",
          },
        ],
      };
    });

    const { res, chunks } = createMockResponse();
    const result = await handleProductionRequest(
      {
        message: "crea un Word de la IA",
        userId: "user-1",
        chatId: "chat-1",
        conversationId: "conv-1",
        requestId: "req-docx-1",
        assistantMessageId: "assistant-docx-1",
        intentResult: makeIntentResult(),
      },
      res,
    );

    const events = parseSseEvents(chunks);
    const startEvent = events.find((event) => event.event === "production_start");
    const handoffEvent = events.find((event) => event.event === "production_event" && event.data.stage === "handoff");
    const editEvent = events.find((event) => event.event === "production_event" && event.data.stage === "edit");
    const artifactEvent = events.find((event) => event.event === "artifact");
    const completeEvent = events.find((event) => event.event === "production_complete");
    const chunkEvent = events.find((event) => event.event === "chunk");

    expect(result.handled).toBe(true);
    expect(result.assistantContent).toContain("Documento listo para descargar");
    expect(result.artifact).toMatchObject({
      type: "docx",
      filename: "IA.docx",
      downloadUrl: "/api/office-engine/runs/office-run-docx/artifacts/exported",
      previewUrl: "/api/office-engine/runs/office-run-docx/artifacts/preview",
    });
    expect(officeEngineRunMock).toHaveBeenCalledOnce();
    expect(startEvent?.data).toMatchObject({
      workflow: "artifact_generation",
      classification: "artifact_generation",
      engine: "office-engine",
      docKind: "docx",
    });
    expect(handoffEvent?.data.runId).toBe("office-run-docx");
    expect(editEvent?.data.diff).toEqual({ added: 24, removed: 0 });
    expect(artifactEvent?.data.metadata).toMatchObject({
      workflow: "artifact_generation",
      classification: "artifact_generation",
      engine: "office-engine",
      docKind: "docx",
      officeRunId: "office-run-docx",
    });
    expect(artifactEvent?.data.downloadUrl).toBe("/api/office-engine/runs/office-run-docx/artifacts/exported");
    expect(completeEvent?.data.success).toBe(true);
    expect(chunkEvent?.data.content).toContain("Documento listo para descargar");
  });

  it("surfaces office engine failures as explicit production errors", async () => {
    officeEngineRunMock.mockImplementation(async (req: any, streamer: any) => {
      req.onStart?.("office-run-failed");
      const plan = streamer.start("thinking", "Planificando edición DOCX");
      streamer.fail(plan, "Planner rejected objective");
      return {
        runId: "office-run-failed",
        status: "failed",
        fallbackLevel: 0,
        durationMs: 73,
        artifacts: [],
        error: {
          code: "EDIT_FAILED",
          message: "Planner rejected objective",
        },
      };
    });

    const { res, chunks } = createMockResponse();
    const result = await handleProductionRequest(
      {
        message: "crea un Word de la IA",
        userId: "user-1",
        chatId: "chat-1",
        conversationId: "conv-1",
        requestId: "req-docx-2",
        assistantMessageId: "assistant-docx-2",
        intentResult: makeIntentResult(),
      },
      res,
    );

    const events = parseSseEvents(chunks);
    const errorEvent = events.find((event) => event.event === "production_error");
    const completeEvent = events.find((event) => event.event === "production_complete");
    const doneEvent = events.find((event) => event.event === "done");

    expect(result.error).toBe("Planner rejected objective");
    expect(result.assistantContent).toContain("Error en la producción documental");
    expect(errorEvent?.data).toMatchObject({
      workflow: "artifact_generation",
      engine: "office-engine",
      error: "Planner rejected objective",
    });
    expect(completeEvent?.data.success).toBe(false);
    expect(doneEvent?.data.runId).toBe("office-run-failed");
  });

  it("routes XLSX requests to the office engine with spreadsheet metadata", async () => {
    officeEngineRunMock.mockImplementation(async (req: any, streamer: any) => {
      req.onStart?.("office-run-xlsx");
      const plan = streamer.start("thinking", "Planificando edición XLSX");
      streamer.complete(plan, { output: "financial projection workbook" });
      return {
        runId: "office-run-xlsx",
        status: "succeeded",
        fallbackLevel: 1,
        durationMs: 205,
        artifacts: [
          {
            id: "artifact-xlsx-1",
            kind: "exported",
            path: "/tmp/office-run-xlsx.xlsx",
            mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            sizeBytes: 5120,
            checksumSha256: "sha256-xlsx",
            downloadUrl: "/api/office-engine/runs/office-run-xlsx/artifacts/exported",
            previewUrl: "/api/office-engine/runs/office-run-xlsx/artifacts/preview",
          },
        ],
      };
    });

    const { res, chunks } = createMockResponse();
    const result = await handleProductionRequest(
      {
        message: "crea un Excel de la IA",
        userId: "user-1",
        chatId: "chat-1",
        conversationId: "conv-1",
        requestId: "req-xlsx-1",
        assistantMessageId: "assistant-xlsx-1",
        intentResult: makeIntentResult({
          intent: "CREATE_SPREADSHEET",
          output_format: "xlsx",
          normalized_text: "crea un excel de la ia",
        }),
      },
      res,
    );

    const events = parseSseEvents(chunks);
    const startEvent = events.find((event) => event.event === "production_start");
    const artifactEvent = events.find((event) => event.event === "artifact");
    expect(startEvent?.data).toMatchObject({
      workflow: "artifact_generation",
      classification: "artifact_generation",
      engine: "office-engine",
      docKind: "xlsx",
    });
    expect(artifactEvent?.data).toMatchObject({
      type: "xlsx",
      downloadUrl: "/api/office-engine/runs/office-run-xlsx/artifacts/exported",
      previewUrl: "/api/office-engine/runs/office-run-xlsx/artifacts/preview",
      metadata: expect.objectContaining({
        engine: "office-engine",
        docKind: "xlsx",
        officeRunId: "office-run-xlsx",
      }),
    });
    expect(result.artifact).toMatchObject({
      type: "xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    expect(result.assistantContent).toContain("Hoja de cálculo lista para descargar");
  });

  it("routes PDF requests to the office engine with final pdf metadata", async () => {
    officeEngineRunMock.mockImplementation(async (req: any, streamer: any) => {
      req.onStart?.("office-run-pdf");
      const plan = streamer.start("thinking", "Planificando PDF ejecutivo");
      streamer.complete(plan, { output: "executive pdf ready" });
      return {
        runId: "office-run-pdf",
        status: "succeeded",
        fallbackLevel: 0,
        durationMs: 144,
        artifacts: [
          {
            id: "artifact-pdf-1",
            kind: "exported",
            path: "/tmp/office-run-pdf.pdf",
            mimeType: "application/pdf",
            sizeBytes: 6144,
            checksumSha256: "sha256-pdf",
            downloadUrl: "/api/office-engine/runs/office-run-pdf/artifacts/exported",
            previewUrl: "/api/office-engine/runs/office-run-pdf/artifacts/preview",
          },
        ],
      };
    });

    const { res, chunks } = createMockResponse();
    const result = await handleProductionRequest(
      {
        message: "crea un pdf ejecutivo de la IA",
        userId: "user-1",
        chatId: "chat-1",
        conversationId: "conv-1",
        requestId: "req-pdf-1",
        assistantMessageId: "assistant-pdf-1",
        intentResult: makeIntentResult({
          intent: "CREATE_DOCUMENT",
          output_format: "pdf",
          normalized_text: "crea un pdf ejecutivo de la ia",
        }),
      },
      res,
    );

    const events = parseSseEvents(chunks);
    const startEvent = events.find((event) => event.event === "production_start");
    const artifactEvent = events.find((event) => event.event === "artifact");
    expect(startEvent?.data).toMatchObject({
      workflow: "artifact_generation",
      classification: "artifact_generation",
      engine: "office-engine",
      docKind: "pdf",
    });
    expect(artifactEvent?.data).toMatchObject({
      type: "pdf",
      downloadUrl: "/api/office-engine/runs/office-run-pdf/artifacts/exported",
      previewUrl: "/api/office-engine/runs/office-run-pdf/artifacts/preview",
      metadata: expect.objectContaining({
        engine: "office-engine",
        docKind: "pdf",
        officeRunId: "office-run-pdf",
      }),
    });
    expect(result.artifact).toMatchObject({
      type: "pdf",
      mimeType: "application/pdf",
    });
    expect(result.assistantContent).toContain("PDF listo para descargar");
  });
});
