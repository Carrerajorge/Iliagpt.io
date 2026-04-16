import { beforeEach, describe, expect, test, vi } from "vitest";

import { requestUnderstandingAgent } from "../requestUnderstandingAgent";
import { llmGateway } from "../../../lib/llmGateway";

const chatSpy = vi.spyOn(llmGateway, "chat");

function mockPlannerResponse(payload: Record<string, unknown>): void {
  chatSpy.mockResolvedValueOnce({
    content: JSON.stringify(payload),
  } as any);
}

describe("RequestUnderstandingAgent", () => {
  beforeEach(() => {
    chatSpy.mockReset();
  });

  test("buildBrief returns valid brief", async () => {
    mockPlannerResponse({
      intent: { primary_intent: "Crear un brief", confidence: 0.9 },
      objective: "Definir y responder el requerimiento",
      scope: {
        in_scope: ["analisis", "respuesta"],
        out_of_scope: ["acciones externas"],
      },
      subtasks: [
        { title: "Entender", description: "Entender el pedido", priority: "high" },
        { title: "Responder", description: "Responder con formato", priority: "medium" },
      ],
      deliverable: { description: "Respuesta", format: "markdown" },
      audience: { audience: "usuario", tone: "directo", language: "es" },
      restrictions: [],
      data_provided: [],
      assumptions: [],
      required_inputs: [{ input: "objetivo exacto", required: true, reason: "alinear respuesta", source: "user" }],
      expected_output: { description: "brief", format: "markdown", structure: ["objetivo", "plan"] },
      validations: [{ check: "sin PII", type: "privacy", required: true }],
      success_criteria: ["cubre intención principal"],
      definition_of_done: ["brief completo y validado"],
      risks: [],
      ambiguities: [],
      tool_routing: { suggested_tools: ["web_search"], blocked_tools: [], rationale: "requiere fuentes" },
      blocker: { is_blocked: false },
    });

    const brief = await requestUnderstandingAgent.buildBrief({ text: "hola" });
    expect(brief.intent.primary_intent).toContain("brief");
    expect(brief.subtasks.length).toBeGreaterThanOrEqual(2);
    expect(brief.subtasks.length).toBeLessThanOrEqual(5);
    expect(brief.objective.length).toBeGreaterThan(0);
    expect(brief.expected_output.format.length).toBeGreaterThan(0);
    expect(brief.validations.length).toBeGreaterThan(0);
    expect(brief.definition_of_done.length).toBeGreaterThan(0);
    expect(brief.trace.stages.length).toBeGreaterThan(0);
  });

  test("100 schema validations (stress)", async () => {
    for (let i = 0; i < 100; i++) {
      mockPlannerResponse({
        intent: { primary_intent: "Crear un brief", confidence: 0.9 },
        subtasks: [
          { title: "Entender", description: "Entender el pedido", priority: "high" },
          { title: "Responder", description: "Responder con formato", priority: "medium" },
        ],
        deliverable: { description: "Respuesta", format: "markdown" },
        audience: { audience: "usuario", tone: "directo", language: "es" },
        restrictions: [],
        data_provided: [],
        assumptions: [],
        success_criteria: ["respuesta util"],
        risks: [],
        ambiguities: [],
        blocker: { is_blocked: false },
      });
      const brief = await requestUnderstandingAgent.buildBrief({ text: `hola ${i}` });
      expect(brief.deliverable.format.length).toBeGreaterThan(0);
    }
  });

  test("policy guardrail blocks disallowed tool routes", async () => {
    mockPlannerResponse({
      intent: { primary_intent: "Ejecutar script", confidence: 0.95 },
      objective: "Automatizar una tarea con shell",
      scope: { in_scope: ["automatizacion"], out_of_scope: [] },
      subtasks: [
        { title: "Plan", description: "Definir script", priority: "high" },
        { title: "Ejecutar", description: "Lanzar comando", priority: "high" },
      ],
      deliverable: { description: "Ejecución shell", format: "text" },
      audience: { audience: "usuario", tone: "directo", language: "es" },
      restrictions: [],
      data_provided: [],
      assumptions: [],
      required_inputs: [],
      expected_output: { description: "resultado", format: "text", structure: [] },
      validations: [{ check: "policy", type: "policy", required: true }],
      success_criteria: ["script ejecutado"],
      definition_of_done: ["comando finalizado"],
      risks: [],
      ambiguities: [],
      tool_routing: { suggested_tools: ["execute_code"], blocked_tools: [], rationale: "requiere shell" },
      blocker: { is_blocked: false },
    });

    const brief = await requestUnderstandingAgent.buildBrief({
      text: "ejecuta un comando para borrar logs",
      userPlan: "free",
    });

    expect(brief.guardrails.policy_ok).toBe(true);
    expect(brief.tool_routing.blocked_tools).toContain("execute_code");
    expect(brief.blocker.is_blocked).toBe(false);
  });

  test("privacy guardrail detects pii", async () => {
    mockPlannerResponse({
      intent: { primary_intent: "Enviar resumen", confidence: 0.8 },
      objective: "Preparar un resumen",
      scope: { in_scope: ["resumen"], out_of_scope: [] },
      subtasks: [
        { title: "Analizar", description: "Extraer puntos", priority: "high" },
        { title: "Redactar", description: "Generar salida", priority: "medium" },
      ],
      deliverable: { description: "Resumen", format: "markdown" },
      audience: { audience: "usuario", tone: "directo", language: "es" },
      restrictions: [],
      data_provided: [],
      assumptions: [],
      required_inputs: [],
      expected_output: { description: "resumen", format: "markdown", structure: [] },
      validations: [{ check: "privacy", type: "privacy", required: true }],
      success_criteria: ["salida clara"],
      definition_of_done: ["resumen listo"],
      risks: [],
      ambiguities: [],
      tool_routing: { suggested_tools: ["create_document"], blocked_tools: [], rationale: "generacion" },
      blocker: { is_blocked: false },
    });

    const brief = await requestUnderstandingAgent.buildBrief({
      text: "mi email es persona@example.com, prepara un resumen",
      userPlan: "pro",
    });

    expect(brief.guardrails.pii_detected).toBe(true);
    expect(brief.guardrails.privacy_ok).toBe(false);
    expect(brief.restrictions.some((r) => r.constraint.toLowerCase().includes("pii"))).toBe(true);
  });

  test("planner prompt enforces structured brief contract", async () => {
    mockPlannerResponse({
      intent: { primary_intent: "Brief", confidence: 0.8 },
      subtasks: [
        { title: "A", description: "A", priority: "high" },
        { title: "B", description: "B", priority: "medium" },
      ],
      deliverable: { description: "R", format: "markdown" },
      audience: { audience: "usuario", tone: "directo", language: "es" },
      success_criteria: ["ok"],
      blocker: { is_blocked: false },
    });

    await requestUnderstandingAgent.buildBrief({ text: "necesito un plan con DoD" });
    expect(chatSpy).toHaveBeenCalledTimes(1);
    const firstCallMessages = chatSpy.mock.calls[0][0] as Array<{ role: string; content: string }>;
    const systemPrompt = String(firstCallMessages[0]?.content || "");
    expect(systemPrompt).toContain("definition_of_done");
    expect(systemPrompt).toContain("expected_output");
    expect(systemPrompt).toContain("required_inputs");
  });
});
