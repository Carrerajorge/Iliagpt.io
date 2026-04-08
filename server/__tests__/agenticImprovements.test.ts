import { describe, it, expect } from "vitest";

// ─── Agentic Prompt Builder ─────────────────────────────────────────────────
describe("agenticPromptBuilder", () => {
  it("builds a system prompt with all sections", async () => {
    const { buildAgenticSystemPrompt } = await import("../agent/agenticPromptBuilder");
    const prompt = buildAgenticSystemPrompt({
      userId: "user-1",
      locale: "es",
      intent: "document_generation",
      intentConfidence: 0.9,
      model: "gpt-4o",
      latencyMode: "auto",
    });
    expect(prompt).toContain("IliaGPT");
    expect(prompt.length).toBeGreaterThan(200);
  });

  it("includes tools relevant to intent", async () => {
    const { buildAgenticSystemPrompt } = await import("../agent/agenticPromptBuilder");
    const prompt = buildAgenticSystemPrompt({
      userId: "u1",
      locale: "es",
      intent: "code_generation",
    });
    expect(prompt).toContain("execute_code");
  });

  it("includes memory context when provided", async () => {
    const { buildAgenticSystemPrompt } = await import("../agent/agenticPromptBuilder");
    const prompt = buildAgenticSystemPrompt({
      userId: "u1",
      locale: "es",
      userFacts: ["El usuario se llama Luis", "Prefiere modo oscuro"],
    });
    expect(prompt).toContain("Luis");
    expect(prompt).toContain("oscuro");
  });

  it("adapts to latency mode", async () => {
    const { buildAgenticSystemPrompt } = await import("../agent/agenticPromptBuilder");
    const fast = buildAgenticSystemPrompt({ userId: "u1", locale: "es", latencyMode: "fast" });
    const deep = buildAgenticSystemPrompt({ userId: "u1", locale: "es", latencyMode: "deep" });
    expect(fast).not.toBe(deep);
  });

  it("returns tools for different intents", async () => {
    const { getToolsForIntent } = await import("../agent/agenticPromptBuilder");
    const docTools = getToolsForIntent("document_generation");
    const codeTools = getToolsForIntent("code_generation");
    expect(docTools.some(t => t.name === "create_document")).toBe(true);
    expect(codeTools.some(t => t.name === "execute_code")).toBe(true);
  });
});

// ─── Enhanced Intent Classifier ─────────────────────────────────────────────
describe("enhancedIntentClassifier", () => {
  it("classifies document creation in Spanish", async () => {
    const { classifyIntent } = await import("../agent/enhancedIntentClassifier");
    const result = classifyIntent("crea un documento word sobre inteligencia artificial");
    expect(result.primary.intent).toBe("document_generation");
    expect(result.confidence).toBeGreaterThan(0.5);
    expect(result.language).toBe("es");
  });

  it("classifies web search", async () => {
    const { classifyIntent } = await import("../agent/enhancedIntentClassifier");
    const result = classifyIntent("busca información sobre machine learning");
    expect(result.primary.intent).toBe("web_search");
  });

  it("classifies code execution", async () => {
    const { classifyIntent } = await import("../agent/enhancedIntentClassifier");
    const result = classifyIntent("ejecuta este codigo python: print('hello')");
    expect(result.primary.intent).toBe("code_execution");
  });

  it("detects multi-intent messages", async () => {
    const { classifyIntent } = await import("../agent/enhancedIntentClassifier");
    const result = classifyIntent("busca información sobre IA y crea un documento con los resultados");
    expect(result.primary).toBeDefined();
    expect(result.secondary).toBeDefined();
  });

  it("classifies simple greeting as chat_general", async () => {
    const { classifyIntent } = await import("../agent/enhancedIntentClassifier");
    const result = classifyIntent("hola");
    expect(result.primary.intent).toBe("chat_general");
    expect(result.complexity).toBe("simple");
  });

  it("detects language correctly", async () => {
    const { detectLanguage } = await import("../agent/enhancedIntentClassifier");
    expect(detectLanguage("crea un documento")).toBe("es");
    expect(detectLanguage("create a document")).toBe("en");
  });

  it("classifies Excel creation", async () => {
    const { classifyIntent } = await import("../agent/enhancedIntentClassifier");
    const result = classifyIntent("crea un excel con datos de ventas por mes");
    expect(result.primary.intent).toBe("spreadsheet_creation");
  });

  it("classifies PowerPoint creation", async () => {
    const { classifyIntent } = await import("../agent/enhancedIntentClassifier");
    const result = classifyIntent("crea una presentacion sobre gestion administrativa");
    expect(result.primary.intent).toBe("presentation_creation");
  });

  it("provides suggested approach", async () => {
    const { classifyIntent } = await import("../agent/enhancedIntentClassifier");
    const result = classifyIntent("crea un documento word sobre IA");
    expect(result.suggestedApproach).toBeDefined();
    expect(result.suggestedApproach.length).toBeGreaterThan(5);
  });

  it("boosts from conversation context", async () => {
    const { classifyIntent } = await import("../agent/enhancedIntentClassifier");
    const history = [
      { role: "user", content: "analizar datos de ventas por mes" },
      { role: "assistant", content: "Los datos muestran un crecimiento..." },
    ];
    const result = classifyIntent("ahora haz un grafico con esos datos", history);
    // Context boost should elevate data_analysis
    expect(result.primary.intent).toBe("data_analysis");
  });
});

// ─── Agentic Reasoning Engine ───────────────────────────────────────────────
describe("agenticReasoning", () => {
  it("creates execution plans", async () => {
    const { AgenticReasoningEngine } = await import("../agent/agenticReasoning");
    const engine = new AgenticReasoningEngine();
    const plan = engine.planExecution("crea un word sobre IA", "document_generation", ["create_document", "web_search"]);
    expect(plan.goal).toBeDefined();
    expect(plan.steps.length).toBeGreaterThan(0);
    expect(plan.complexity).toBeDefined();
    expect(plan.estimatedDurationMs).toBeGreaterThan(0);
  });

  it("classifies complexity correctly", async () => {
    const { classifyComplexity } = await import("../agent/agenticReasoning");
    expect(classifyComplexity("hola", "chat_general")).toBe("simple");
    const longMsg = "crea un word sobre inteligencia artificial con investigación web, análisis de datos y resumen ejecutivo";
    expect(["moderate", "complex"]).toContain(classifyComplexity(longMsg, "document_generation"));
  });

  it("records thinking steps", async () => {
    const { AgenticReasoningEngine } = await import("../agent/agenticReasoning");
    const steps: any[] = [];
    const engine = new AgenticReasoningEngine({ onStep: (s) => steps.push(s) });
    engine.think("Analyzing request", "User wants a document about AI");
    expect(steps.length).toBe(1);
    expect(steps[0].type).toBe("think");
  });

  it("records tool execution steps", async () => {
    const { AgenticReasoningEngine } = await import("../agent/agenticReasoning");
    const engine = new AgenticReasoningEngine();
    engine.execute("web_search", { query: "AI trends" }, { results: 5 }, 2500);
    const steps = engine.getSteps();
    expect(steps.length).toBe(1);
    expect(steps[0].toolName).toBe("web_search");
    expect(steps[0].durationMs).toBe(2500);
  });

  it("provides execution summary", async () => {
    const { AgenticReasoningEngine } = await import("../agent/agenticReasoning");
    const engine = new AgenticReasoningEngine();
    engine.think("Planning", "Will search and create doc");
    engine.execute("web_search", {}, {}, 3000);
    engine.execute("create_document", {}, {}, 5000);
    engine.verify("Quality check", "Document looks good", 0.9);
    const summary = engine.getSummary();
    expect(summary.totalSteps).toBe(4);
    expect(summary.toolsUsed).toContain("web_search");
    expect(summary.toolsUsed).toContain("create_document");
  });

  it("formats plan for user in Spanish", async () => {
    const { AgenticReasoningEngine, formatPlanForUser } = await import("../agent/agenticReasoning");
    const engine = new AgenticReasoningEngine();
    const plan = engine.planExecution("crear documento", "document_generation", ["create_document"]);
    const formatted = formatPlanForUser(plan, "es");
    expect(formatted.length).toBeGreaterThan(10);
  });
});
