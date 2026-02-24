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

function makeBrief(flags: {
  blocker: boolean;
  policyOk: boolean;
  privacyOk: boolean;
  securityOk: boolean;
  selfCheckPassed: boolean;
}) {
  return {
    intent: { primary_intent: "Ejecucion", confidence: 0.88 },
    objective: "Probar guard estricto",
    scope: { in_scope: ["execution"], out_of_scope: [] },
    subtasks: [
      { title: "Validar", description: "validar", priority: "high" },
      { title: "Ejecutar", description: "ejecutar", priority: "high" },
    ],
    deliverable: { description: "resultado", format: "json" },
    audience: { audience: "usuario", tone: "directo", language: "es" },
    restrictions: [],
    data_provided: [],
    assumptions: [],
    required_inputs: [{ input: "mensaje", required: true, reason: "contexto", source: "user" }],
    expected_output: { description: "resultado", format: "json", structure: [] },
    validations: [{ check: "policy", type: "policy", required: true }],
    success_criteria: ["ok"],
    definition_of_done: ["ok"],
    risks: [],
    ambiguities: [],
    tool_routing: { suggested_tools: ["execute_code"], blocked_tools: [], rationale: "test" },
    guardrails: {
      policy_ok: flags.policyOk,
      privacy_ok: flags.privacyOk,
      security_ok: flags.securityOk,
      pii_detected: !flags.privacyOk,
      flags: [],
    },
    self_check: { passed: flags.selfCheckPassed, score: flags.selfCheckPassed ? 0.9 : 0.3, issues: [] },
    trace: { planner_model: "mock", planner_mode: "heuristic", total_duration_ms: 2, stages: [] },
    blocker: {
      is_blocked: flags.blocker,
      question: flags.blocker ? "Necesito aclaracion." : "",
    },
  } as any;
}

function makeReq(method: string, message = "ejecuta accion segura") {
  return {
    method,
    path: "/api/execution/run",
    originalUrl: "/api/execution/run",
    body: { message },
    query: {},
    headers: {},
  } as any;
}

function makeRes() {
  const res: any = { locals: { traceId: "trace-rigorous" }, statusCode: 200 };
  res.status = vi.fn().mockImplementation((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json = vi.fn().mockImplementation((payload: any) => payload);
  return res;
}

type Scenario = {
  name: string;
  mode: "enforce" | "monitor";
  method: "POST" | "PUT" | "PATCH" | "DELETE";
  blocker: boolean;
  policyOk: boolean;
  privacyOk: boolean;
  securityOk: boolean;
  selfCheckPassed: boolean;
  shouldBlock: boolean;
};

const scenarios: Scenario[] = [];
const methods: Array<Scenario["method"]> = ["POST", "PUT", "PATCH", "DELETE"];
const modes: Array<Scenario["mode"]> = ["enforce", "monitor"];

for (const mode of modes) {
  for (const method of methods) {
    for (let mask = 0; mask < 32; mask += 1) {
      const blocker = Boolean(mask & 1);
      const policyOk = !Boolean(mask & 2);
      const privacyOk = !Boolean(mask & 4);
      const securityOk = !Boolean(mask & 8);
      const selfCheckPassed = !Boolean(mask & 16);
      const shouldBlock =
        mode === "enforce" &&
        (blocker || !policyOk || !privacyOk || !securityOk || !selfCheckPassed);

      scenarios.push({
        name: `${mode}-${method}-m${mask.toString().padStart(2, "0")}`,
        mode,
        method,
        blocker,
        policyOk,
        privacyOk,
        securityOk,
        selfCheckPassed,
        shouldBlock,
      });
    }
  }
}

describe("preExecutionIntentGuard rigorous matrix", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test.each(scenarios)("$name", async (scenario) => {
    process.env.EXECUTION_INTENT_GUARD_MODE = scenario.mode;
    buildBriefMock.mockResolvedValueOnce(
      makeBrief({
        blocker: scenario.blocker,
        policyOk: scenario.policyOk,
        privacyOk: scenario.privacyOk,
        securityOk: scenario.securityOk,
        selfCheckPassed: scenario.selfCheckPassed,
      }),
    );

    const req = makeReq(scenario.method);
    const res = makeRes();
    const next = vi.fn();

    await preExecutionIntentGuard(req, res, next);

    expect(buildBriefMock).toHaveBeenCalledTimes(1);
    if (scenario.shouldBlock) {
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalled();
    } else {
      expect(next).toHaveBeenCalledOnce();
      expect(res.status).not.toHaveBeenCalledWith(409);
    }
  });

  test("skips guard when mode is off", async () => {
    process.env.EXECUTION_INTENT_GUARD_MODE = "off";
    const req = makeReq("POST");
    const res = makeRes();
    const next = vi.fn();

    await preExecutionIntentGuard(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(buildBriefMock).not.toHaveBeenCalled();
  });

  test("skips guard on non-mutation methods", async () => {
    process.env.EXECUTION_INTENT_GUARD_MODE = "enforce";
    const req = makeReq("GET");
    const res = makeRes();
    const next = vi.fn();

    await preExecutionIntentGuard(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(buildBriefMock).not.toHaveBeenCalled();
  });

  test("skips guard when message is empty", async () => {
    process.env.EXECUTION_INTENT_GUARD_MODE = "enforce";
    const req = makeReq("POST", "   ");
    const res = makeRes();
    const next = vi.fn();

    await preExecutionIntentGuard(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(buildBriefMock).not.toHaveBeenCalled();
  });

  test("returns 503 when analyzer fails in enforce mode", async () => {
    process.env.EXECUTION_INTENT_GUARD_MODE = "enforce";
    buildBriefMock.mockRejectedValueOnce(new Error("planner down"));

    const req = makeReq("POST");
    const res = makeRes();
    const next = vi.fn();

    await preExecutionIntentGuard(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalled();
  });

  test("continues when analyzer fails in monitor mode", async () => {
    process.env.EXECUTION_INTENT_GUARD_MODE = "monitor";
    buildBriefMock.mockRejectedValueOnce(new Error("planner down"));

    const req = makeReq("POST");
    const res = makeRes();
    const next = vi.fn();

    await preExecutionIntentGuard(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalledWith(503);
  });
});

