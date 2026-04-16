import { beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import type { IntentResult } from "../services/intentRouter";

const { officeEngineRunMock, generateFilePreviewMock } = vi.hoisted(() => ({
  officeEngineRunMock: vi.fn(),
  generateFilePreviewMock: vi.fn(),
}));

vi.mock("../lib/office/engine/OfficeEngine", () => ({
  officeEngine: {
    run: officeEngineRunMock,
  },
}));

vi.mock("../services/filePreviewService", () => ({
  generateFilePreview: generateFilePreviewMock,
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

import { storage } from "../storage";
import { handleProductionRequest } from "../services/productionHandler";

function makeIntentResult(overrides: Partial<IntentResult> = {}): IntentResult {
  return {
    intent: "CREATE_SPREADSHEET",
    output_format: "xlsx",
    slots: { topic: "proyección financiera trimestral" },
    confidence: 0.95,
    normalized_text: "crea un excel profesional con proyeccion financiera trimestral",
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

describe("productionHandler XLSX office-engine bridge", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await fs.writeFile("/tmp/office-run-xlsx.xlsx", Buffer.from("xlsx-preview-binary"));
    generateFilePreviewMock.mockResolvedValue({
      type: "xlsx",
      html: "<div>Preview Excel SaaS</div>",
    });
    officeEngineRunMock.mockImplementation(async (req: any, streamer: any) => {
      req.onStart?.("office-run-xlsx");
      const plan = streamer.start("thinking", "Planificando edición XLSX");
      streamer.complete(plan, { output: "financial model workbook" });
      const preview = streamer.start("generating", "Preparando vista previa xlsx");
      streamer.complete(preview, { output: "xlsx preview ready" });
      return {
        runId: "office-run-xlsx",
        status: "succeeded",
        fallbackLevel: 1,
        durationMs: 198,
        artifacts: [
          {
            id: "artifact-xlsx-1",
            kind: "exported",
            path: "/tmp/office-run-xlsx.xlsx",
            mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            sizeBytes: 8192,
            checksumSha256: "sha256-xlsx",
            downloadUrl: "/api/office-engine/runs/office-run-xlsx/artifacts/exported",
            previewUrl: "/api/office-engine/runs/office-run-xlsx/artifacts/preview",
          },
        ],
      };
    });
  });

  it("routes a single XLSX request to the office engine", async () => {
    const { res } = createMockResponse();

    const result = await handleProductionRequest(
      {
        message: "crea un Excel profesional con proyección financiera trimestral para una empresa SaaS",
        userId: "user-1",
        chatId: "chat-1",
        conversationId: "conv-1",
        requestId: "req-xlsx-1",
        assistantMessageId: "assistant-xlsx-1",
        intentResult: makeIntentResult(),
      },
      res,
    );

    expect(result.handled).toBe(true);
    expect(officeEngineRunMock).toHaveBeenCalledOnce();
    expect(officeEngineRunMock.mock.calls[0]?.[0]).toMatchObject({
      docKind: "xlsx",
      objective: "crea un Excel profesional con proyección financiera trimestral para una empresa SaaS",
    });
  });

  it("emits artifact_generation metadata with office-engine for XLSX", async () => {
    const { res, chunks } = createMockResponse();

    await handleProductionRequest(
      {
        message: "crea un Excel profesional con proyección financiera trimestral para una empresa SaaS",
        userId: "user-1",
        chatId: "chat-1",
        conversationId: "conv-1",
        requestId: "req-xlsx-2",
        assistantMessageId: "assistant-xlsx-2",
        intentResult: makeIntentResult(),
      },
      res,
    );

    const startEvent = parseSseEvents(chunks).find((event) => event.event === "production_start");
    expect(startEvent?.data).toMatchObject({
      workflow: "artifact_generation",
      classification: "artifact_generation",
      engine: "office-engine",
      docKind: "xlsx",
    });
  });

  it("streams the XLSX artifact with previewUrl and office metadata", async () => {
    const { res, chunks } = createMockResponse();

    await handleProductionRequest(
      {
        message: "crea un Excel profesional con proyección financiera trimestral para una empresa SaaS",
        userId: "user-1",
        chatId: "chat-1",
        conversationId: "conv-1",
        requestId: "req-xlsx-3",
        assistantMessageId: "assistant-xlsx-3",
        intentResult: makeIntentResult(),
      },
      res,
    );

    const artifactEvent = parseSseEvents(chunks).find((event) => event.event === "artifact");

    expect(artifactEvent?.data).toMatchObject({
      type: "xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      downloadUrl: "/api/office-engine/runs/office-run-xlsx/artifacts/exported",
      previewUrl: "/api/office-engine/runs/office-run-xlsx/artifacts/preview",
      previewHtml: "<div>Preview Excel SaaS</div>",
      metadata: expect.objectContaining({
        engine: "office-engine",
        docKind: "xlsx",
        officeRunId: "office-run-xlsx",
      }),
    });
  });

  it("emits the XLSX completion summary and done artifact payload", async () => {
    const { res, chunks } = createMockResponse();

    await handleProductionRequest(
      {
        message: "crea un Excel profesional con proyección financiera trimestral para una empresa SaaS",
        userId: "user-1",
        chatId: "chat-1",
        conversationId: "conv-1",
        requestId: "req-xlsx-4",
        assistantMessageId: "assistant-xlsx-4",
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
      "Hoja de cálculo lista para descargar. Vista previa y pipeline estructural disponibles.",
    );
    expect(chunkEvent?.data.content).toBe(
      "Hoja de cálculo lista para descargar. Vista previa y pipeline estructural disponibles.",
    );
    expect(doneEvent?.data.artifact).toMatchObject({
      type: "spreadsheet",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      downloadUrl: "/api/office-engine/runs/office-run-xlsx/artifacts/exported",
      previewUrl: "/api/office-engine/runs/office-run-xlsx/artifacts/preview",
      previewHtml: "<div>Preview Excel SaaS</div>",
    });
  });

  it("persists the assistant message with XLSX office metadata", async () => {
    const { res } = createMockResponse();

    await handleProductionRequest(
      {
        message: "crea un Excel profesional con proyección financiera trimestral para una empresa SaaS",
        userId: "user-1",
        chatId: "chat-1",
        conversationId: "conv-1",
        requestId: "req-xlsx-5",
        assistantMessageId: "assistant-xlsx-5",
        intentResult: makeIntentResult(),
      },
      res,
    );

    expect(vi.mocked(storage.updateChatMessageContent)).toHaveBeenCalledWith(
      "assistant-xlsx-5",
      "Hoja de cálculo lista para descargar. Vista previa y pipeline estructural disponibles.",
      "done",
      expect.objectContaining({
        artifact: expect.objectContaining({
          type: "xlsx",
          previewUrl: "/api/office-engine/runs/office-run-xlsx/artifacts/preview",
          previewHtml: "<div>Preview Excel SaaS</div>",
          metadata: expect.objectContaining({
            engine: "office-engine",
            docKind: "xlsx",
            officeRunId: "office-run-xlsx",
          }),
        }),
      }),
    );
  });
});
