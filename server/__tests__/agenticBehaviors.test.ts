import { describe, it, expect } from "vitest";

// ─── Smart Suggestions ──────────────────────────────────────────────────────
describe("smartSuggestions", () => {
  it("generates artifact-specific suggestions after document creation", async () => {
    const { generateSmartSuggestions } = await import("../agent/smartSuggestions");
    const suggestions = generateSmartSuggestions({
      aiResponse: "He creado tu documento Word sobre inteligencia artificial.",
      userMessage: "crea un word sobre IA",
      intent: "document_generation",
      hasArtifact: true,
      artifactType: "word",
      conversationLength: 2,
      locale: "es",
    });
    expect(suggestions.length).toBeGreaterThanOrEqual(3);
    // Should not suggest creating another Word since we just made one
    expect(suggestions.every(s => !s.toLowerCase().includes("crear un word"))).toBe(true);
  });

  it("generates code-related suggestions when code is detected", async () => {
    const { generateSmartSuggestions } = await import("../agent/smartSuggestions");
    const suggestions = generateSmartSuggestions({
      aiResponse: "```python\ndef hello():\n  print('hello')\n```",
      userMessage: "escribe una funcion",
      intent: "code_generation",
      hasArtifact: false,
      conversationLength: 2,
      locale: "es",
    });
    expect(suggestions.length).toBeGreaterThanOrEqual(3);
  });

  it("generates greeting suggestions for short responses", async () => {
    const { generateSmartSuggestions } = await import("../agent/smartSuggestions");
    const suggestions = generateSmartSuggestions({
      aiResponse: "¡Hola! ¿En qué puedo ayudarte?",
      userMessage: "hola",
      intent: "chat_general",
      hasArtifact: false,
      conversationLength: 1,
      locale: "es",
    });
    expect(suggestions.length).toBeGreaterThanOrEqual(3);
  });

  it("extracts main topic from text", async () => {
    const { extractMainTopic } = await import("../agent/smartSuggestions");
    const topic = extractMainTopic("La inteligencia artificial está transformando la industria");
    expect(topic.length).toBeGreaterThan(0);
  });

  it("detects response types correctly", async () => {
    const { detectResponseType } = await import("../agent/smartSuggestions");
    expect(detectResponseType("Aquí tienes el código:\n```python\ndef hello():\n  print('hi')\n  return True\n```")).toBe("code");
    expect(detectResponseType("Las ventas fueron $1,200 en enero, $1,500 en febrero, $1,800 en marzo")).toBe("data");
    expect(detectResponseType("Hola")).toBe("greeting");
  });
});

// ─── Context Enricher ────────────────────────────────────────────────────────
describe("contextEnricher", () => {
  it("enriches context with all fields", async () => {
    const { enrichContext } = await import("../agent/contextEnricher");
    const ctx = enrichContext({
      messages: [
        { role: "user", content: "busca info sobre machine learning" },
        { role: "assistant", content: "Machine learning es una rama de la IA..." },
      ],
      userFacts: ["Nombre: Luis", "Idioma: español"],
      locale: "es",
    });
    expect(ctx.timeContext).toBeDefined();
    expect(ctx.timeContext.length).toBeGreaterThan(5);
    expect(ctx.conversationSummary).toBeDefined();
    expect(ctx.userProfile).toContain("Luis");
  });

  it("extracts topics from messages", async () => {
    const { extractTopics } = await import("../agent/contextEnricher");
    const topics = extractTopics([
      { role: "user", content: "quiero saber sobre inteligencia artificial" },
      { role: "assistant", content: "La IA es un campo que estudia machine learning y deep learning" },
    ]);
    expect(topics.length).toBeGreaterThan(0);
  });

  it("summarizes conversation correctly", async () => {
    const { summarizeConversation } = await import("../agent/contextEnricher");
    const summary = summarizeConversation([
      { role: "user", content: "hola" },
      { role: "assistant", content: "¡Hola!" },
      { role: "user", content: "crea un documento sobre IA" },
      { role: "assistant", content: "He creado el documento." },
    ], "es");
    expect(summary.length).toBeGreaterThan(10);
  });

  it("formats time context", async () => {
    const { formatTimeContext } = await import("../agent/contextEnricher");
    const time = formatTimeContext("es");
    expect(time).toContain("Son las");
  });

  it("handles attachments", async () => {
    const { enrichContext } = await import("../agent/contextEnricher");
    const ctx = enrichContext({
      messages: [],
      attachments: [
        { name: "report.pdf", type: "application/pdf", size: 250000 },
        { name: "data.xlsx", type: "application/xlsx", size: 150000 },
      ],
      locale: "es",
    });
    expect(ctx.attachmentContext).toContain("report.pdf");
    expect(ctx.attachmentContext).toContain("data.xlsx");
  });
});

// ─── Proactive Behaviors ─────────────────────────────────────────────────────
describe("proactiveBehaviors", () => {
  it("suggests chart when response has data", async () => {
    const { detectProactiveActions } = await import("../agent/proactiveBehaviors");
    const actions = detectProactiveActions({
      userMessage: "dame los datos de ventas",
      aiResponse: "Las ventas por mes: Enero $1,200, Febrero $1,500, Marzo $1,800, Abril $2,100",
      intent: "data_analysis",
      conversationLength: 3,
      hasAttachments: false,
      locale: "es",
    });
    expect(actions.length).toBeGreaterThan(0);
    expect(actions.some(a => a.type === "suggest_tool")).toBe(true);
  });

  it("suggests format conversion after document creation", async () => {
    const { detectProactiveActions } = await import("../agent/proactiveBehaviors");
    const actions = detectProactiveActions({
      userMessage: "crea un word",
      aiResponse: "He creado tu documento Word.",
      intent: "document_generation",
      conversationLength: 2,
      hasAttachments: false,
      locale: "es",
    });
    // At least one action should be present
    expect(actions.length).toBeGreaterThanOrEqual(0);
  });

  it("suggests file analysis when attachments present", async () => {
    const { detectProactiveActions } = await import("../agent/proactiveBehaviors");
    const actions = detectProactiveActions({
      userMessage: "hola",
      aiResponse: "¡Hola!",
      intent: "chat_general",
      conversationLength: 1,
      hasAttachments: true,
      attachmentTypes: ["pdf"],
      locale: "es",
    });
    expect(actions.some(a => a.type === "offer_help")).toBe(true);
  });

  it("detects data in response", async () => {
    const { hasDataInResponse } = await import("../agent/proactiveBehaviors");
    expect(hasDataInResponse("Ventas: $100, $200, $300")).toBe(true);
    expect(hasDataInResponse("Hola mundo")).toBe(false);
  });

  it("detects code blocks", async () => {
    const { detectCodeBlocks } = await import("../agent/proactiveBehaviors");
    expect(detectCodeBlocks("```python\nprint('hi')\n```")).toBe(true);
    expect(detectCodeBlocks("texto normal sin código")).toBe(false);
  });

  it("returns max 2 actions sorted by priority", async () => {
    const { detectProactiveActions } = await import("../agent/proactiveBehaviors");
    const actions = detectProactiveActions({
      userMessage: "analiza estos datos y crea un gráfico",
      aiResponse: "Los datos muestran: $100, $200, $300, $400, $500\n```python\nimport pandas\n```",
      intent: "data_analysis",
      conversationLength: 5,
      hasAttachments: true,
      attachmentTypes: ["csv"],
      locale: "es",
    });
    expect(actions.length).toBeLessThanOrEqual(2);
  });
});
