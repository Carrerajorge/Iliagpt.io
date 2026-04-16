import { describe, expect, it, vi } from "vitest";
import type { ContentSpec, WorkOrder } from "../agent/production/types";

vi.mock("../agent/langgraph/agents/ResearchAssistantAgent", () => ({
  researchAgent: { execute: vi.fn() },
}));

vi.mock("../agent/langgraph/agents/DocumentAgent", () => ({
  documentAgent: { execute: vi.fn() },
}));

vi.mock("../agent/langgraph/agents/QAAgent", () => ({
  qaAgent: { execute: vi.fn() },
}));

vi.mock("../agent/langgraph/agents/DataAnalystAgent", () => ({
  dataAgent: { execute: vi.fn() },
}));

vi.mock("../agent/langgraph/agents/ContentAgent", () => ({
  contentAgent: { execute: vi.fn() },
}));

vi.mock("../agent/production/consistencyAgent", () => ({
  consistencyAgent: { execute: vi.fn() },
}));

vi.mock("../agent/production/blueprintAgent", () => ({
  generateBlueprint: vi.fn(),
}));

import { contentAgent } from "../agent/langgraph/agents/ContentAgent";
import { ProductionPipeline } from "../agent/production/productionPipeline";

function makeWorkOrder(deliverables: WorkOrder["deliverables"], topic = "Informe trimestral de ventas"): WorkOrder {
  return {
    id: "wo-test",
    createdAt: new Date("2026-04-06T12:00:00.000Z"),
    userId: "user-1",
    chatId: "chat-1",
    intent: "report",
    topic,
    description: topic,
    audience: "general",
    deliverables,
    tone: "formal",
    citationStyle: "none",
    sourcePolicy: "none",
    uploadedDocuments: [],
    constraints: {
      language: "es",
      corporateStyle: false,
    },
    budget: {
      maxLLMCalls: 1,
      maxSearchQueries: 1,
      maxRetries: 1,
      timeoutMinutes: 1,
    },
    status: "pending",
    currentStage: 0,
    totalStages: 10,
  };
}

function makeContentSpec(title: string): ContentSpec {
  return {
    title,
    authors: ["ILIAGPT AI"],
    date: "2026-04-06",
    abstract: "Resumen ejecutivo del documento.",
    sections: [
      {
        id: "intro",
        type: "h1",
        title: "Introducción",
        content: "Este es el cuerpo principal del documento con suficiente contenido para pruebas.",
        children: [],
      },
      {
        id: "analysis",
        type: "h2",
        title: "Hallazgos",
        content: "Los resultados muestran crecimiento sostenido en ingresos y margen operativo.",
        children: [],
      },
    ],
    bibliography: [],
  };
}

describe("ProductionPipeline stageRender", () => {
  it("reads nested presentation slides returned by ContentAgent", async () => {
    const pipeline = new ProductionPipeline(makeWorkOrder(["ppt"], "Gestion administrativa"));

    vi.mocked(contentAgent.execute).mockResolvedValue({
      taskId: "task-1",
      agentId: "agent-1",
      success: true,
      output: {
        presentation: {
          title: "Gestion administrativa",
          slides: [{ title: "Portada", content: ["Resumen ejecutivo"] }],
        },
      },
      duration: 10,
    });

    await (pipeline as any).stageSlides();

    expect((pipeline as any).workOrder.pptData).toEqual([
      { title: "Portada", content: ["Resumen ejecutivo"] },
    ]);
  });

  it("downgrades an empty successful run to failed when no requested artifacts were produced", () => {
    const pipeline = new ProductionPipeline(makeWorkOrder(["ppt"], "Gestion administrativa"));

    const result = (pipeline as any).buildResult("success");

    expect(result.status).toBe("failed");
    expect(result.summary).toContain("Producción Fallida");
    expect(result.summary).toContain("**Entregables solicitados:** ppt");
    expect(result.qaReport.blockers[0]).toContain("No se generó ningún entregable solicitado");
  });

  it("renders a real PDF artifact when pdf is requested", async () => {
    const pipeline = new ProductionPipeline(makeWorkOrder(["pdf"]));
    (pipeline as any).contentSpec = makeContentSpec("Informe trimestral de ventas");

    await (pipeline as any).stageRender();

    const artifacts = (pipeline as any).artifacts;
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].type).toBe("pdf");
    expect(artifacts[0].mimeType).toBe("application/pdf");
    expect(artifacts[0].filename).toMatch(/\.pdf$/);
    expect(artifacts[0].buffer.subarray(0, 4).toString("utf8")).toBe("%PDF");
  });

  it("renders a real DOCX artifact from the structured content spec", async () => {
    const pipeline = new ProductionPipeline(makeWorkOrder(["word"], "Informe trimestral de ventas"));
    (pipeline as any).contentSpec = makeContentSpec("Informe trimestral de ventas");

    await (pipeline as any).stageRender();

    const artifacts = (pipeline as any).artifacts;
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].type).toBe("word");
    expect(artifacts[0].mimeType).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(artifacts[0].filename).toMatch(/\.docx$/);
    expect(artifacts[0].buffer.subarray(0, 2).toString("utf8")).toBe("PK");
    expect(artifacts[0].metadata.wordCount).toBeGreaterThan(0);
  });

  it("renders a real PPTX artifact when ppt is requested", async () => {
    const pipeline = new ProductionPipeline(makeWorkOrder(["ppt"], "Gestion administrativa"));
    (pipeline as any).contentSpec = makeContentSpec("Gestion administrativa");
    (pipeline as any).workOrder.pptData = [
      {
        title: "Portada",
        content: ["Resumen ejecutivo de la gestion administrativa."],
      },
      {
        title: "Hallazgos",
        bullets: ["Procesos", "Controles", "Seguimiento"],
      },
    ];

    await (pipeline as any).stageRender();

    const artifacts = (pipeline as any).artifacts;
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].type).toBe("ppt");
    expect(artifacts[0].mimeType).toBe("application/vnd.openxmlformats-officedocument.presentationml.presentation");
    expect(artifacts[0].filename).toMatch(/\.pptx$/);
    expect(artifacts[0].buffer.subarray(0, 2).toString("utf8")).toBe("PK");
    expect(artifacts[0].metadata.slides).toBe(2);
  });
});
