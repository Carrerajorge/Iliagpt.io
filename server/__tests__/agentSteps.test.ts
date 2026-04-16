import { describe, it, expect, vi } from "vitest";

describe("agent step types", () => {
  it("creates a step with auto-generated ID and timestamp", async () => {
    const { createStep } = await import("../agent/stepTypes");
    const step = createStep("reading", "Reading document");
    expect(step.id).toMatch(/^step-/);
    expect(step.type).toBe("reading");
    expect(step.title).toBe("Reading document");
    expect(step.status).toBe("running");
    expect(step.timestamp).toBeInstanceOf(Date);
    expect(step.expandable).toBe(false); // reading is not expandable by default
  });

  it("creates expandable steps for executing type", async () => {
    const { createStep } = await import("../agent/stepTypes");
    const step = createStep("executing", "Running script", { script: "echo hi" });
    expect(step.expandable).toBe(true);
    expect(step.script).toBe("echo hi");
  });

  it("creates editing step with diff", async () => {
    const { createStep } = await import("../agent/stepTypes");
    const step = createStep("editing", "Fix title", {
      fileName: "document.xml",
      diff: { added: 1, removed: 1 },
    });
    expect(step.type).toBe("editing");
    expect(step.fileName).toBe("document.xml");
    expect(step.diff).toEqual({ added: 1, removed: 1 });
    expect(step.expandable).toBe(true); // editing is expandable by default
  });

  it("completes a step with duration", async () => {
    const { createStep, completeStep } = await import("../agent/stepTypes");
    const step = createStep("thinking", "Planning");
    // Simulate some time passing
    const completed = completeStep(step, { output: "Done planning" });
    expect(completed.status).toBe("completed");
    expect(completed.output).toBe("Done planning");
    expect(typeof completed.duration).toBe("number");
    expect(completed.duration).toBeGreaterThanOrEqual(0);
  });

  it("fails a step with error message", async () => {
    const { createStep, failStep } = await import("../agent/stepTypes");
    const step = createStep("executing", "Running code");
    const failed = failStep(step, "Timeout exceeded");
    expect(failed.status).toBe("failed");
    expect(failed.output).toBe("Timeout exceeded");
  });
});

describe("step streamer", () => {
  it("starts and completes steps", async () => {
    const { StepStreamer } = await import("../agent/stepStreamer");
    const streamer = new StepStreamer();

    const step = streamer.start("reading", "Reading file.docx", { fileName: "file.docx" });
    expect(step.status).toBe("running");

    const completed = streamer.complete(step, { output: "File read successfully" });
    expect(completed.status).toBe("completed");
    expect(completed.output).toBe("File read successfully");
  });

  it("collects all steps", async () => {
    const { StepStreamer } = await import("../agent/stepStreamer");
    const streamer = new StepStreamer();

    streamer.add("reading", "Analizando documento adjunto");
    streamer.add("thinking", "Planificando estructura");
    const genStep = streamer.start("generating", "Generando documento Word");
    streamer.complete(genStep);
    streamer.add("completed", "Documento creado exitosamente");

    const steps = streamer.getSteps();
    expect(steps).toHaveLength(4);
    expect(steps[0].type).toBe("reading");
    expect(steps[1].type).toBe("thinking");
    expect(steps[2].type).toBe("generating");
    expect(steps[3].type).toBe("completed");
  });

  it("emits step events", async () => {
    const { StepStreamer } = await import("../agent/stepStreamer");
    const streamer = new StepStreamer();
    const emitted: any[] = [];
    streamer.on("step", (s: any) => emitted.push(s));

    streamer.add("searching", "Buscando en internet");
    expect(emitted).toHaveLength(1);
    expect(emitted[0].type).toBe("searching");
  });

  it("writes SSE format to response", async () => {
    const { StepStreamer } = await import("../agent/stepStreamer");

    const chunks: string[] = [];
    const mockRes = {
      writableEnded: false,
      write: (data: string) => { chunks.push(data); return true; },
    } as any;

    const streamer = new StepStreamer(mockRes);
    streamer.add("reading", "Reading SKILL.md", { fileName: "SKILL.md" });

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatch(/^data: /);

    const payload = JSON.parse(chunks[0].replace("data: ", "").trim());
    expect(payload.type).toBe("step");
    expect(payload.step.type).toBe("reading");
    expect(payload.step.title).toBe("Reading SKILL.md");
    expect(payload.step.fileName).toBe("SKILL.md");
  });

  it("truncates long scripts and output in SSE", async () => {
    const { StepStreamer } = await import("../agent/stepStreamer");

    const chunks: string[] = [];
    const mockRes = {
      writableEnded: false,
      write: (data: string) => { chunks.push(data); return true; },
    } as any;

    const streamer = new StepStreamer(mockRes);
    const longScript = "x".repeat(600);
    streamer.add("executing", "Long script", { script: longScript });

    const payload = JSON.parse(chunks[0].replace("data: ", "").trim());
    expect(payload.step.script.length).toBeLessThan(longScript.length);
    expect(payload.step.script).toContain("...");
  });

  it("handles closed response gracefully", async () => {
    const { StepStreamer } = await import("../agent/stepStreamer");

    const mockRes = {
      writableEnded: true, // Response already closed
      write: vi.fn(),
    } as any;

    const streamer = new StepStreamer(mockRes);
    // Should not throw
    streamer.add("thinking", "After close");
    expect(mockRes.write).not.toHaveBeenCalled();
  });
});

describe("document generation steps sequence", () => {
  it("creates correct steps for document generation", async () => {
    const { StepStreamer, createDocumentSteps } = await import("../agent/stepStreamer");
    const streamer = new StepStreamer();

    const { analyzeStep, planStep } = createDocumentSteps(streamer, "Word", true);
    expect(analyzeStep).toBeDefined();
    expect(analyzeStep!.type).toBe("reading");

    const completedPlan = streamer.complete(planStep);
    expect(completedPlan.status).toBe("completed");

    const genStep = streamer.start("generating", "Generando documento Word profesional");
    streamer.complete(genStep, {
      artifact: {
        id: "doc-1",
        name: "Report.docx",
        type: "docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        downloadUrl: "/api/documents/download/doc-1",
        size: 45000,
      },
    });

    streamer.add("completed", "Documento creado exitosamente");

    const steps = streamer.getSteps();
    expect(steps.length).toBeGreaterThanOrEqual(4);
    expect(steps[steps.length - 1].type).toBe("completed");
  });
});

describe("code execution steps sequence", () => {
  it("creates correct steps for code execution", async () => {
    const { StepStreamer, createCodeSteps } = await import("../agent/stepStreamer");
    const streamer = new StepStreamer();

    const { analyzeStep, executeStep } = createCodeSteps(streamer, "Python", "print(42)");
    expect(analyzeStep.type).toBe("reading");
    expect(executeStep.type).toBe("executing");
    expect(executeStep.script).toBe("print(42)");

    streamer.complete(executeStep, { output: "42" });
    streamer.add("completed", "Ejecución completada");

    const steps = streamer.getSteps();
    expect(steps).toHaveLength(3);
  });
});

describe("web search steps sequence", () => {
  it("creates correct steps for web search", async () => {
    const { StepStreamer, createSearchSteps } = await import("../agent/stepStreamer");
    const streamer = new StepStreamer();

    const { searchStep } = createSearchSteps(streamer, "TypeScript best practices");
    expect(searchStep.type).toBe("searching");

    streamer.complete(searchStep);
    streamer.add("analyzing", "Analizando 5 resultados encontrados");
    streamer.add("generating", "Sintetizando información");
    streamer.add("completed", "Investigación completada");

    const steps = streamer.getSteps();
    expect(steps).toHaveLength(4);
    expect(steps.map((s: any) => s.type)).toEqual(["searching", "analyzing", "generating", "completed"]);
  });
});
