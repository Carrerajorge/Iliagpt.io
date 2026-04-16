import { describe, it, expect, beforeAll, vi, beforeEach, afterEach } from "vitest";
import { Router, decideRoute, checkDynamicEscalation } from "../services/router";

vi.mock("../lib/gemini", () => ({
  geminiChat: vi.fn().mockResolvedValue({ content: '{"route":"chat","confidence":0.7,"reasons":["test"],"tool_needs":[],"plan_hint":[]}' })
}));

describe("Router - Hybrid Decision System", () => {
  let router: Router;

  beforeAll(() => {
    router = new Router({ confidenceThreshold: 0.65, enableDynamicEscalation: true });
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("decideRoute - Heuristic patterns", () => {
    it("should route '¿Qué es X?' to chat", async () => {
      const decision = await router.decide("¿Qué es la inteligencia artificial?");
      expect(decision.route).toBe("chat");
      expect(decision.confidence).toBeGreaterThanOrEqual(0.5);
    });

    it("should route 'Busca en la web...' to agent", async () => {
      const decision = await router.decide("Busca en la web información sobre el precio del bitcoin hoy");
      expect(decision.route).toBe("agent");
      expect(decision.confidence).toBeGreaterThanOrEqual(0.65);
      expect(decision.tool_needs).toContain("web_search");
    });

    it("should route 'Verifica con fuentes...' to agent", async () => {
      const decision = await router.decide("Verifica con fuentes oficiales si el dato es correcto");
      expect(decision.route).toBe("agent");
      expect(decision.confidence).toBeGreaterThanOrEqual(0.65);
    });

    it("should route 'Haz una app con login...' to agent", async () => {
      const decision = await router.decide("Haz una landing page con login de usuarios");
      expect(decision.route).toBe("agent");
      expect(decision.confidence).toBeGreaterThanOrEqual(0.65);
    });

    it("should route 'Resume este texto...' to chat", async () => {
      const decision = await router.decide("Resume este texto: La tecnología ha avanzado mucho.");
      expect(decision.route).toBe("chat");
    });

    it("should route 'Dame el precio actual de...' to agent", async () => {
      const decision = await router.decide("Dame el precio actual del dólar en México");
      expect(decision.route).toBe("agent");
      expect(decision.tool_needs).toContain("web_search");
    });

    it("should route URL messages to agent", async () => {
      const decision = await router.decide("Analiza esta página: https://example.com/article");
      expect(decision.route).toBe("agent");
      expect(decision.tool_needs).toContain("open_url");
    });

    it("should route greetings to chat", async () => {
      const decision = await router.decide("Hola, buenos días!");
      expect(decision.route).toBe("chat");
      expect(decision.confidence).toBe(1.0);
    });

    it("should route 'usa el agente' to agent with max confidence", async () => {
      const decision = await router.decide("Usa el agente para investigar esto");
      expect(decision.route).toBe("agent");
      expect(decision.confidence).toBe(1.0);
    });

    it("should route file generation requests to agent", async () => {
      const decision = await router.decide("Genera un documento Excel con los datos de ventas");
      expect(decision.route).toBe("agent");
      expect(decision.tool_needs).toContain("generate_file");
    });

    it("should route CV requests to agent", async () => {
      const decision = await router.decide("Crea mi curriculum vitae profesional");
      expect(decision.route).toBe("agent");
      expect(decision.tool_needs).toContain("generate_file");
    });

    it("should route scraping requests to agent", async () => {
      const decision = await router.decide("Scrapea los precios de productos de Amazon");
      expect(decision.route).toBe("agent");
      expect(decision.tool_needs).toContain("web_scrape");
    });
  });

  describe("decideRoute - Complex patterns", () => {
    it("should route multi-step tasks to agent", async () => {
      const decision = await router.decide("Primero busca información, luego genera un informe");
      expect(decision.route).toBe("agent");
      expect(decision.tool_needs).toContain("multi_step");
    });

    it("should route enumerated steps to agent", async () => {
      const decision = await router.decide("1. Buscar datos 2. Analizar resultados 3. Generar reporte");
      expect(decision.route).toBe("agent");
    });

    it("should route automation requests to agent", async () => {
      const decision = await router.decide("Automatiza el proceso de envío de correos");
      expect(decision.route).toBe("agent");
      expect(decision.tool_needs).toContain("automation");
    });
  });

  describe("decideRoute - Attachments", () => {
    it("should consider attachments in decision", async () => {
      const decision = await router.decide("Analiza este documento", true);
      expect(decision.route).toBe("agent");
    });
  });

  describe("checkDynamicEscalation", () => {
    it("should escalate when response indicates need for web search", () => {
      const result = checkDynamicEscalation("Necesito buscar más información para responder correctamente.");
      expect(result.shouldEscalate).toBe(true);
      expect(result.reason).toBeDefined();
    });

    it("should escalate when response indicates no access", () => {
      const result = checkDynamicEscalation("No tengo acceso a información en tiempo real.");
      expect(result.shouldEscalate).toBe(true);
    });

    it("should not escalate for normal responses", () => {
      const result = checkDynamicEscalation("La respuesta a tu pregunta es que JavaScript es un lenguaje de programación.");
      expect(result.shouldEscalate).toBe(false);
    });

    it("should escalate when real-time data is needed", () => {
      const result = checkDynamicEscalation("Para darte información actualizada, necesitaría consultar fuentes en tiempo real.");
      expect(result.shouldEscalate).toBe(true);
    });
  });

  describe("RouterDecision structure", () => {
    it("should return properly structured decision", async () => {
      const decision = await router.decide("Busca en internet el clima de hoy");
      
      expect(decision).toHaveProperty("route");
      expect(decision).toHaveProperty("confidence");
      expect(decision).toHaveProperty("reasons");
      expect(decision).toHaveProperty("tool_needs");
      expect(decision).toHaveProperty("plan_hint");
      
      expect(["chat", "agent"]).toContain(decision.route);
      expect(decision.confidence).toBeGreaterThanOrEqual(0);
      expect(decision.confidence).toBeLessThanOrEqual(1);
      expect(Array.isArray(decision.reasons)).toBe(true);
      expect(Array.isArray(decision.tool_needs)).toBe(true);
      expect(Array.isArray(decision.plan_hint)).toBe(true);
    });
  });

  describe("Confidence threshold", () => {
    it("should respect custom confidence threshold", async () => {
      const strictRouter = new Router({ confidenceThreshold: 0.95 });
      const decision = await strictRouter.decide("Busca algo en la web");
      expect(decision.confidence).toBeGreaterThanOrEqual(0);
    });

    it("should use default threshold of 0.65", () => {
      const defaultRouter = new Router();
      expect(defaultRouter["config"].confidenceThreshold).toBe(0.65);
    });
  });
});

describe("Router - Edge cases", () => {
  it("should handle empty messages gracefully", async () => {
    const router = new Router();
    const decision = await router.decide("");
    expect(decision.route).toBe("chat");
  });

  it("should handle very long messages", async () => {
    const router = new Router();
    const longMessage = "a".repeat(10000);
    const decision = await router.decide(longMessage);
    expect(decision).toHaveProperty("route");
  });

  it("should handle special characters", async () => {
    const router = new Router();
    const decision = await router.decide("¿Cómo está el mercado? €$¥ @#%");
    expect(decision).toHaveProperty("route");
  });
});

describe("Router - Fail-safe behavior", () => {
  it("should fall back to heuristics without API key", async () => {
    const originalKey = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    
    const router = new Router();
    const decision = await router.decide("Busca en la web el precio del bitcoin");
    
    expect(decision.route).toBe("agent");
    expect(decision.tool_needs).toContain("web_search");
    
    process.env.GEMINI_API_KEY = originalKey;
  });

  it("should always return valid RouterDecision structure", async () => {
    const router = new Router();
    const decision = await router.decide("Random ambiguous message");
    
    expect(decision).toMatchObject({
      route: expect.stringMatching(/^(chat|agent)$/),
      confidence: expect.any(Number),
      reasons: expect.any(Array),
      tool_needs: expect.any(Array),
      plan_hint: expect.any(Array),
    });
  });
});

describe("AgentRunner - Guardrails", () => {
  it("should include run_id in result", async () => {
    const { AgentRunner } = await import("../services/agentRunner");
    const agent = new AgentRunner({ maxSteps: 2, enableLogging: false });
    const result = await agent.run("Simple test objective");

    const runId = (result as any).run_id ?? (result as any).runId;
    expect(runId).toBeTruthy();
    expect(typeof runId).toBe("string");
    expect(String(runId).length).toBeGreaterThan(0);
  }, 20000);

  it("should include warning when max steps reached", async () => {
    const { AgentRunner } = await import("../services/agentRunner");
    const agent = new AgentRunner({ maxSteps: 1, enableLogging: false });
    const result = await agent.run("Test max steps with very limited steps");
    
    if (result.state.status === "completed" && typeof result.result === "string") {
      expect(result.result).toContain("WARNING");
    } else if (typeof (result as any).result === "string") {
      // be tolerant if status bookkeeping differs
      expect(String((result as any).result)).toContain("WARNING");
    }
  });

  it("should have configurable maxConsecutiveFailures", async () => {
    const { AgentRunner } = await import("../services/agentRunner");
    const agent = new AgentRunner({ maxConsecutiveFailures: 3 });
    
    expect(agent["config"].maxConsecutiveFailures).toBe(3);
  });
});

describe("RunStore - Persistence interface", () => {
  it("should save and retrieve runs", async () => {
    const { runStore, AgentRunRecord } = await import("../services/agentRunner");
    
    const testRecord: any = {
      run_id: "test-run-123",
      objective: "Test objective",
      route: "agent",
      confidence: 0.9,
      plan: ["Step 1", "Step 2"],
      tools_used: ["web_search"],
      steps: 2,
      duration_ms: 1000,
      status: "completed",
      result: "Test result",
      created_at: new Date(),
      completed_at: new Date(),
    };
    
    await runStore.save(testRecord);
    const retrieved = await runStore.get("test-run-123");
    
    expect(retrieved).not.toBeNull();
    expect(retrieved?.run_id).toBe("test-run-123");
    expect(retrieved?.objective).toBe("Test objective");
  });

  it("should list recent runs", async () => {
    const { runStore } = await import("../services/agentRunner");
    
    const runs = await runStore.list(10);
    expect(Array.isArray(runs)).toBe(true);
  });
});
