import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../agent/requestUnderstanding/requestUnderstandingAgent", () => ({
  requestUnderstandingAgent: {
    buildBrief: vi.fn(),
  },
}));
vi.mock("../lib/tracing", () => ({
  withSpan: async (_name: string, fn: any) => fn({ setAttribute: () => undefined }),
}));

import { requestUnderstandingAgent } from "../agent/requestUnderstanding/requestUnderstandingAgent";
import { preExecutionIntentGuard } from "../middleware/preExecutionIntentGuard";

const buildBriefMock = vi.mocked(requestUnderstandingAgent.buildBrief);

function makeBrief(overrides: Partial<Record<string, any>> = {}) {
  return {
    intent: { primary_intent: "Ejecutar acción", confidence: 0.92 },
    objective: "Completar acción solicitada",
    scope: { in_scope: ["accion"], out_of_scope: [] },
    subtasks: [
      { title: "Validar", description: "Validar entrada", priority: "high" },
      { title: "Ejecutar", description: "Ejecutar acción", priority: "high" },
    ],
    deliverable: { description: "Resultado", format: "json" },
    audience: { audience: "usuario", tone: "directo", language: "es" },
    restrictions: [],
    data_provided: [],
    assumptions: [],
    required_inputs: [{ input: "mensaje", required: true, reason: "contexto", source: "user" }],
    expected_output: { description: "resultado", format: "json", structure: [] },
    validations: [{ check: "policy", type: "policy", required: true }],
    success_criteria: ["accion completada"],
    definition_of_done: ["accion completada y validada"],
    risks: [],
    ambiguities: [],
    tool_routing: { suggested_tools: ["execute_code"], blocked_tools: [], rationale: "accion requerida" },
    guardrails: { policy_ok: true, privacy_ok: true, security_ok: true, pii_detected: false, flags: [] },
    self_check: { passed: true, score: 0.91, issues: [] },
    trace: { planner_model: "mock", planner_mode: "heuristic", total_duration_ms: 12, stages: [] },
    blocker: { is_blocked: false, question: "" },
    ...overrides,
  };
}

function makeReq(overrides: Partial<Record<string, any>> = {}) {
  return {
    method: "POST",
    path: "/api/execution/run",
    originalUrl: "/api/execution/run",
    body: { message: "ejecuta una accion segura" },
    query: {},
    headers: {},
    ...overrides,
  } as any;
}

function makeRes() {
  const res: any = {
    locals: { traceId: "trace-test-1" },
    statusCode: 200,
  };
  res.status = vi.fn().mockImplementation((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json = vi.fn().mockImplementation((payload: any) => payload);
  return res;
}

describe("preExecutionIntentGuard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.EXECUTION_INTENT_GUARD_MODE = "enforce";
  });

  test("allows execution when brief passes guardrails", async () => {
    buildBriefMock.mockResolvedValueOnce(makeBrief() as any);
    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();

    await preExecutionIntentGuard(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.executionIntentGuard?.decision.allowed).toBe(true);
    expect(res.status).not.toHaveBeenCalled();
  });

  test("blocks execution in enforce mode when brief is blocked", async () => {
    buildBriefMock.mockResolvedValueOnce(
      makeBrief({
        blocker: { is_blocked: true, question: "Falta dato crítico." },
        guardrails: {
          policy_ok: false,
          privacy_ok: true,
          security_ok: true,
          pii_detected: false,
          flags: ["policy_block"],
        },
      }) as any,
    );

    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();

    await preExecutionIntentGuard(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalled();
  });

  test("does not block in monitor mode", async () => {
    process.env.EXECUTION_INTENT_GUARD_MODE = "monitor";
    buildBriefMock.mockResolvedValueOnce(
      makeBrief({
        blocker: { is_blocked: true, question: "Necesito aclaración." },
        self_check: { passed: false, score: 0.42, issues: ["missing_required_inputs"] },
      }) as any,
    );

    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();

    await preExecutionIntentGuard(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
    expect(req.executionIntentGuard?.decision.allowed).toBe(false);
  });

  test("returns 503 in enforce mode if analyzer is unavailable", async () => {
    buildBriefMock.mockRejectedValueOnce(new Error("planner unavailable"));

    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();

    await preExecutionIntentGuard(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalled();
  });
});
