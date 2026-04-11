import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { createHttpTestClient } from "../../tests/helpers/httpTestClient";

const runtimeRuns: any[] = [];
const ensureUserRowExistsMock = vi.fn(async () => {});
const getCatalogModelBySelectionMock = vi.fn(async (selection?: string) => ({
  id: selection || "gpt-5.4",
  modelId: selection || "gpt-5.4",
  gatewayProvider: "openai",
  availableToUser: true,
}));
const validateUnifiedQuotaMock = vi.fn(async () => ({ allowed: true as const }));
const recordUnifiedOpenClawUsageMock = vi.fn(async () => {});
const executeOpenClawNativePromptMock = vi.fn(async (params: any) => ({
  engine: "OpenClaw native embedded runtime",
  sessionId: "native-session-1",
  sessionKey: "iliagpt:native:test",
  workspaceDir: "/tmp/openclaw-native",
  response: `respuesta nativa para ${params.prompt}`,
  payloads: [{ text: `respuesta nativa para ${params.prompt}` }],
  mediaUrls: [],
  meta: { durationMs: 42 },
  nativeToolsEnabled: Boolean(params.enableTools),
}));

const orchestrationEngineMock = {
  decomposeTask: vi.fn(async (objective: string) => [
    {
      id: "subtask_1",
      description: `Analizar objetivo: ${objective}`,
      toolId: "analyze",
      dependencies: [],
      priority: 1,
      status: "pending",
    },
    {
      id: "subtask_2",
      description: "Generar salida consolidada",
      toolId: null,
      dependencies: ["subtask_1"],
      priority: 2,
      status: "pending",
    },
  ]),
  buildExecutionPlan: vi.fn((subtasks: any[]) => ({
    waves: [[subtasks[0]], [subtasks[1]]],
    totalEstimatedTime: 10_000,
    maxParallelism: 1,
  })),
  executeParallel: vi.fn(async () => ({
    success: true,
    completedTasks: 2,
    failedTasks: 0,
    results: new Map([
      ["subtask_1", { ok: true }],
      ["subtask_2", { summary: "done" }],
    ]),
    errors: new Map(),
    executionTimeMs: 123,
  })),
  combineResults: vi.fn(() => ({
    success: true,
    summary: {
      completed: 2,
      failed: 0,
      executionTime: "123ms",
    },
    results: {
      subtask_1: { ok: true },
      subtask_2: { summary: "done" },
    },
    errors: {},
  })),
};

vi.mock("../lib/anonUserHelper", () => ({
  getOrCreateSecureUserId: () => "user_test",
}));

vi.mock("../lib/ensureUserRowExists", () => ({
  ensureUserRowExists: (...args: any[]) => ensureUserRowExistsMock(...args),
}));

vi.mock("../services/ragService", () => ({
  RAGService: class {
    async search() {
      return [{ content: "mocked memory", score: 0.91, chatId: "chat_1" }];
    }

    async getContextForMessage() {
      return "[Contexto]\nmocked memory";
    }
  },
}));

vi.mock("../services/orchestrationEngine", () => ({
  orchestrationEngine: orchestrationEngineMock,
}));

vi.mock("../services/modelCatalogService", () => ({
  getCatalogModelBySelection: (...args: any[]) => getCatalogModelBySelectionMock(...args),
}));

vi.mock("../services/usageQuotaService", () => ({
  usageQuotaService: {
    validateUnifiedQuota: (...args: any[]) => validateUnifiedQuotaMock(...args),
    recordUnifiedOpenClawUsage: (...args: any[]) => recordUnifiedOpenClawUsageMock(...args),
  },
}));

vi.mock("../services/openClawNativeExecution", () => ({
  executeOpenClawNativePrompt: (...args: any[]) => executeOpenClawNativePromptMock(...args),
}));

vi.mock("../openclaw/skills/skillRegistry", () => ({
  skillRegistry: {
    list: vi.fn(() => [
      {
        id: "coding-agent",
        name: "Coding Agent",
        description: "Code skill",
        tools: ["openclaw_exec"],
        source: "builtin",
      },
    ]),
    resolve: vi.fn((skillIds?: string[]) => ({
      skills: [
        {
          id: skillIds?.[0] || "coding-agent",
          name: "Coding Agent",
          description: "Code skill",
          tools: ["openclaw_exec"],
          source: "builtin",
        },
      ],
      prompt: "## Skill: Coding Agent\nUse tools.",
      tools: ["openclaw_exec"],
    })),
  },
}));

vi.mock("../openclaw/config", () => ({
  getOpenClawConfig: () => ({
    gateway: { enabled: false, path: "/ws/openclaw" },
    tools: {
      enabled: false,
      safeBins: [],
      workspaceRoot: "/tmp",
      execTimeout: 120000,
      execSecurity: "warn",
    },
    plugins: { enabled: false, directory: "" },
    skills: {
      enabled: true,
      directory: "/tmp/skills",
      extraDirectories: [],
      workspaceDirectory: "/tmp",
      includeBuiltins: true,
      autoImportClawi: false,
      maxSkillFileBytes: 1000,
    },
    streaming: { enabled: false, blockMinChars: 50, blockMaxChars: 500, previewMode: "partial" },
  }),
}));

vi.mock("../openclaw/skills/skillLoader", () => ({
  initSkills: vi.fn(async () => {}),
}));

vi.mock("../openclaw/agents/subagentService", () => ({
  openclawSubagentService: {
    spawn: vi.fn((params: any) => {
      const run = {
        id: `sub_${runtimeRuns.length + 1}`,
        requesterUserId: params.requesterUserId,
        chatId: params.chatId,
        objective: params.objective,
        planHint: params.planHint || [],
        parentRunId: params.parentRunId,
        status: "queued",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        stepCount: 0,
      };
      runtimeRuns.push(run);
      return run;
    }),
    list: vi.fn((params: any = {}) => {
      return runtimeRuns
        .filter((run) => !params.requesterUserId || run.requesterUserId === params.requesterUserId)
        .filter((run) => !params.chatId || run.chatId === params.chatId)
        .filter((run) => !params.parentRunId || run.parentRunId === params.parentRunId)
        .filter((run) => !params.status || run.status === params.status)
        .slice(0, Math.max(1, params.limit || 100));
    }),
    get: vi.fn((runId: string) => runtimeRuns.find((run) => run.id === runId)),
    cancel: vi.fn((runId: string) => {
      const found = runtimeRuns.find((run) => run.id === runId);
      if (!found) return false;
      found.status = "cancelled";
      return true;
    }),
  },
}));

async function createTestApp() {
  const { createOpenClawRuntimeRouter } = await import("../routes/openclawRuntimeRouter");
  const app = express();
  app.use(express.json());
  app.use("/api/openclaw/runtime", createOpenClawRuntimeRouter());
  return app;
}

describe("openclawRuntimeRouter smoke flow", () => {
  beforeEach(() => {
    runtimeRuns.length = 0;
    vi.clearAllMocks();
    getCatalogModelBySelectionMock.mockResolvedValue({
      id: "gpt-5.4",
      modelId: "gpt-5.4",
      gatewayProvider: "openai",
      availableToUser: true,
    });
    validateUnifiedQuotaMock.mockResolvedValue({ allowed: true });
    executeOpenClawNativePromptMock.mockImplementation(async (params: any) => ({
      engine: "OpenClaw native embedded runtime",
      sessionId: "native-session-1",
      sessionKey: "iliagpt:native:test",
      workspaceDir: "/tmp/openclaw-native",
      response: `respuesta nativa para ${params.prompt}`,
      payloads: [{ text: `respuesta nativa para ${params.prompt}` }],
      mediaUrls: [],
      meta: { durationMs: 42 },
      nativeToolsEnabled: Boolean(params.enableTools),
    }));
  });

  it("executes objective -> plan -> subagents -> consolidated response", async () => {
    const app = await createTestApp();
    const { client, close } = await createHttpTestClient(app);
    try {
      const objective = "analiza ventas y genera resumen";

      const planRes = await client
        .post("/api/openclaw/runtime/orchestrator/plan")
        .send({ objective });
      expect(planRes.status).toBe(200);
      expect(Array.isArray(planRes.body.subtasks)).toBe(true);
      expect(planRes.body.subtasks.length).toBeGreaterThanOrEqual(1);

      const spawnRes = await client
        .post("/api/openclaw/runtime/subagents")
        .send({ objective: planRes.body.subtasks[0].description, chatId: "chat-alpha" });
      expect(spawnRes.status).toBe(202);
      expect(spawnRes.body.id).toBeTruthy();
      expect(spawnRes.body.chatId).toBe("chat-alpha");

      await client
        .post("/api/openclaw/runtime/subagents")
        .send({ objective: "otra tarea", chatId: "chat-beta" });

      const listRes = await client.get("/api/openclaw/runtime/subagents").query({ chatId: "chat-alpha" });
      expect(listRes.status).toBe(200);
      expect(Array.isArray(listRes.body.runs)).toBe(true);
      expect(listRes.body.runs).toHaveLength(1);
      expect(listRes.body.stats.active).toBe(1);
      expect(listRes.body.runs[0].chatId).toBe("chat-alpha");

      const runRes = await client
        .post("/api/openclaw/runtime/orchestrator/run")
        .send({ objective });
      expect(runRes.status).toBe(200);
      expect(runRes.body.combined).toBeTruthy();
      expect(runRes.body.combined.summary.completed).toBe(2);

      const flowRes = await client
        .post("/api/openclaw/runtime/orchestrator/flow")
        .send({ objective, spawnSubagents: true, maxSubagents: 2, chatId: "chat-flow" });
      expect(flowRes.status).toBe(200);
      expect(Array.isArray(flowRes.body.delegatedRuns)).toBe(true);
      expect(flowRes.body.delegatedRuns.length).toBeGreaterThanOrEqual(1);
      expect(flowRes.body.delegatedRuns.every((run: any) => typeof run.id === "string")).toBe(true);
      expect(flowRes.body.combined.summary.completed).toBe(2);
    } finally {
      await close();
    }
  });

  it("reports native runtime status", async () => {
    const app = await createTestApp();
    const { client, close } = await createHttpTestClient(app);
    try {
      const res = await client.get("/api/openclaw/runtime/native/status");
      expect([200, 503]).toContain(res.status);
      expect(typeof res.body.ok).toBe("boolean");
    } finally {
      await close();
    }
  });

  it("executes the native runtime with unified catalog and billing", async () => {
    const app = await createTestApp();
    const { client, close } = await createHttpTestClient(app);
    try {
      const res = await client.post("/api/openclaw/runtime/native/exec").send({
        prompt: "resume este documento",
        model: "gpt-5.4",
        chatId: "chat-native",
        enableTools: true,
      });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(ensureUserRowExistsMock).toHaveBeenCalledWith("user_test", expect.anything());
      expect(validateUnifiedQuotaMock).toHaveBeenCalledWith("user_test", expect.any(Number));
      expect(getCatalogModelBySelectionMock).toHaveBeenCalledWith("gpt-5.4", { userId: "user_test" });
      expect(executeOpenClawNativePromptMock).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: "resume este documento",
          userId: "user_test",
          chatId: "chat-native",
          provider: "openai",
          model: "gpt-5.4",
          enableTools: true,
        }),
      );
      expect(recordUnifiedOpenClawUsageMock).toHaveBeenCalledWith("user_test", expect.any(Number), expect.any(Number));
    } finally {
      await close();
    }
  });

  it("blocks native execution when unified quota is exhausted", async () => {
    validateUnifiedQuotaMock.mockResolvedValueOnce({
      allowed: false,
      payload: {
        ok: false,
        code: "TOKEN_QUOTA_EXCEEDED",
        message: "saldo agotado",
        statusCode: 402,
        quota: {
          unified: true,
          resetAt: null,
          monthlyAllowed: false,
          dailyAllowed: true,
          requestAllowed: true,
        },
        billing: {
          unified: true,
          statusUrl: "/api/billing/status",
          upgradeUrl: "/workspace-settings?section=billing",
        },
      },
    });

    const app = await createTestApp();
    const { client, close } = await createHttpTestClient(app);
    try {
      const res = await client.post("/api/openclaw/runtime/native/exec").send({
        prompt: "ejecuta algo costoso",
      });

      expect(res.status).toBe(402);
      expect(res.body.code).toBe("TOKEN_QUOTA_EXCEEDED");
      expect(executeOpenClawNativePromptMock).not.toHaveBeenCalled();
    } finally {
      await close();
    }
  });

  it("blocks native execution when the model requires upgrade", async () => {
    getCatalogModelBySelectionMock.mockResolvedValueOnce({
      id: "claude-opus-4",
      modelId: "claude-opus-4",
      gatewayProvider: "anthropic",
      availableToUser: false,
    });

    const app = await createTestApp();
    const { client, close } = await createHttpTestClient(app);
    try {
      const res = await client.post("/api/openclaw/runtime/native/exec").send({
        prompt: "usa claude opus",
        model: "claude-opus-4",
      });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe("MODEL_UPGRADE_REQUIRED");
      expect(executeOpenClawNativePromptMock).not.toHaveBeenCalled();
    } finally {
      await close();
    }
  });
});
