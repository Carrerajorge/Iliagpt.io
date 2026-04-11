import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server as HttpServer } from "http";
import fs from "fs";
import os from "os";
import path from "path";
import WebSocket from "ws";
import { OPENCLAW_RELEASE_VERSION } from "@shared/openclawRelease";

type MockedCatalogModel = {
  id: string;
  modelId: string;
  provider: string;
  providerDisplayName: string;
  name: string;
  description: string;
  logoUrl: string;
  available: boolean;
  availableToUser: boolean;
  requiresUpgrade: boolean;
  accessState: string;
  status: "active";
  permissions: {
    chat: boolean;
    tools: boolean;
    streaming: boolean;
  };
  contextWindow: number | null;
  tier: string;
  order: number;
  gatewayProvider: string;
};

type GatewayHarness = {
  close: () => Promise<void>;
  connect: (userId?: string) => Promise<GatewayClient>;
  mocks: {
    ensureUserRowExistsMock: ReturnType<typeof vi.fn>;
    getOpenClawGatewayModelCatalogMock: ReturnType<typeof vi.fn>;
    getCatalogModelBySelectionMock: ReturnType<typeof vi.fn>;
    getUnifiedQuotaSnapshotMock: ReturnType<typeof vi.fn>;
    validateUnifiedQuotaMock: ReturnType<typeof vi.fn>;
    recordUnifiedOpenClawUsageMock: ReturnType<typeof vi.fn>;
    executeInternetToolMock: ReturnType<typeof vi.fn>;
    streamChatMock: ReturnType<typeof vi.fn>;
  };
};

type GatewayClient = {
  ws: WebSocket;
  messages: any[];
  request: (method: string, params?: any) => Promise<{ response: any; startIndex: number; id: string }>;
  waitForMessage: (predicate: (message: any) => boolean, label: string, startIndex?: number) => Promise<any>;
  close: () => Promise<void>;
};

type SetupOptions = {
  activeMemoryEnabled?: boolean;
  activeMemoryMode?: string;
  quotaAllowed?: boolean;
  quotaPayload?: Record<string, unknown>;
  quotaSnapshot?: Record<string, unknown>;
  streamChunks?: Array<{ content?: string; done?: boolean }>;
  toolExecutionResult?: Record<string, unknown>;
};

const DEFAULT_QUOTA_SNAPSHOT = {
  unified: true as const,
  userId: "user_test",
  plan: "free",
  isAdmin: false,
  isPaid: false,
  blockingState: "ok",
  billing: {
    statusUrl: "/api/billing/status",
    upgradeUrl: "/workspace-settings?section=billing",
  },
  requests: {
    allowed: true,
    remaining: 97,
    limit: 100,
    resetAt: null,
    plan: "free",
  },
  daily: {
    allowed: true,
    resetAt: null,
    inputUsed: 120,
    outputUsed: 45,
    totalUsed: 165,
    inputLimit: 1000,
    outputLimit: 1000,
    inputRemaining: 880,
    outputRemaining: 955,
  },
  monthly: {
    allowed: true,
    resetAt: new Date("2026-05-01T00:00:00.000Z"),
    used: 510,
    limit: 1000,
    remaining: 490,
    extraCredits: 0,
    plan: "free",
    isAdmin: false,
    isPaid: false,
  },
  channels: {
    totalConsumed: 510,
    openclawUsed: 210,
    creditsBalance: 0,
  },
};

function createCatalog(): {
  models: MockedCatalogModel[];
  default: { provider: string; model: string };
} {
  return {
    models: [
      {
        id: "google/gemma-4-31b-it",
        modelId: "google/gemma-4-31b-it",
        provider: "openrouter",
        providerDisplayName: "Google",
        name: "Gemma 4 31B",
        description: "Fast default model",
        logoUrl: "/logos/gemma.png",
        available: true,
        availableToUser: true,
        requiresUpgrade: false,
        accessState: "enabled",
        status: "active",
        permissions: { chat: true, tools: true, streaming: true },
        contextWindow: 128000,
        tier: "free",
        order: 10,
        gatewayProvider: "openrouter",
      },
      {
        id: "gpt-5.4",
        modelId: "gpt-5.4",
        provider: "openai",
        providerDisplayName: "OpenAI",
        name: "GPT-5.4",
        description: "Enterprise reasoning model",
        logoUrl: "/logos/openai.png",
        available: false,
        availableToUser: false,
        requiresUpgrade: true,
        accessState: "upgrade_required",
        status: "active",
        permissions: { chat: false, tools: false, streaming: false },
        contextWindow: 200000,
        tier: "pro",
        order: 20,
        gatewayProvider: "openai",
      },
    ],
    default: {
      provider: "openrouter",
      model: "google/gemma-4-31b-it",
    },
  };
}

function createAsyncStream(chunks: Array<{ content?: string; done?: boolean }>) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) {
        await new Promise((resolve) => setTimeout(resolve, 1));
        yield chunk;
      }
    },
  };
}

function buildQuotaErrorPayload() {
  return {
    code: "TOKEN_QUOTA_EXCEEDED",
    message: "Has agotado tu saldo global mensual de tokens.",
    quota: {
      ...DEFAULT_QUOTA_SNAPSHOT,
      blockingState: "monthly_token_limit",
      monthly: {
        ...DEFAULT_QUOTA_SNAPSHOT.monthly,
        allowed: false,
        remaining: 0,
      },
    },
    billing: DEFAULT_QUOTA_SNAPSHOT.billing,
  };
}

async function waitFor<T>(
  getValue: () => T | undefined,
  label: string,
  timeoutMs = 4000,
): Promise<T> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = getValue();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timeout waiting for ${label}`);
}

async function setupGatewayHarness(options: SetupOptions = {}): Promise<GatewayHarness> {
  vi.resetModules();

  const catalog = createCatalog();
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-gateway-contract-"));
  process.env.OPENCLAW_WORKSPACE_ROOT = tmpRoot;
  process.env.OPENCLAW_ACTIVE_MEMORY = options.activeMemoryEnabled ? "true" : "false";
  process.env.OPENCLAW_ACTIVE_MEMORY_MODE = options.activeMemoryMode || "recent";

  const ensureUserRowExistsMock = vi.fn(async () => {});
  const getOpenClawGatewayModelCatalogMock = vi.fn(async () => catalog);
  const getCatalogModelBySelectionMock = vi.fn(async (selection?: string) => {
    if (!selection) {
      return catalog.models[0];
    }

    const normalized = String(selection).trim();
    const byId =
      catalog.models.find((model) => model.id === normalized) ||
      catalog.models.find((model) => model.modelId === normalized) ||
      catalog.models.find((model) => `${model.gatewayProvider}/${model.modelId}` === normalized);

    if (byId) return byId;
    return {
      ...catalog.models[0],
      id: normalized,
      modelId: normalized,
    };
  });
  const getUnifiedQuotaSnapshotMock = vi.fn(async (userId: string) => ({
    ...DEFAULT_QUOTA_SNAPSHOT,
    userId,
    ...(options.quotaSnapshot || {}),
  }));
  const validateUnifiedQuotaMock = vi.fn(async () => {
    if (options.quotaAllowed === false) {
      return { allowed: false as const, payload: options.quotaPayload || buildQuotaErrorPayload() };
    }
    return { allowed: true as const };
  });
  const recordUnifiedOpenClawUsageMock = vi.fn(async () => {});
  const executeInternetToolMock = vi.fn(async () =>
    options.toolExecutionResult || {
      ok: true,
      output: { summary: "tool executed" },
    },
  );
  const streamChatMock = vi.fn(() =>
    createAsyncStream(
      options.streamChunks || [
        { content: "Hola" },
        { content: " mundo" },
        { done: true },
      ],
    ),
  );

  vi.doMock("../../lib/ensureUserRowExists", () => ({
    ensureUserRowExists: (...args: any[]) => ensureUserRowExistsMock(...args),
  }));

  vi.doMock("../modelCatalogService", () => ({
    getOpenClawGatewayModelCatalog: (...args: any[]) => getOpenClawGatewayModelCatalogMock(...args),
    getCatalogModelBySelection: (...args: any[]) => getCatalogModelBySelectionMock(...args),
  }));

  vi.doMock("../usageQuotaService", () => ({
    usageQuotaService: {
      getUnifiedQuotaSnapshot: (...args: any[]) => getUnifiedQuotaSnapshotMock(...args),
      validateUnifiedQuota: (...args: any[]) => validateUnifiedQuotaMock(...args),
      recordUnifiedOpenClawUsage: (...args: any[]) => recordUnifiedOpenClawUsageMock(...args),
    },
  }));

  vi.doMock("../../lib/llmGateway", () => ({
    llmGateway: {
      streamChat: (...args: any[]) => streamChatMock(...args),
    },
  }));

  vi.doMock("../../openclaw/lib/internetAccess", () => ({
    internetToolDefinitions: [
      {
        id: "web.search",
        name: "web.search",
        description: "Search the web",
      },
    ],
    executeInternetTool: (...args: any[]) => executeInternetToolMock(...args),
  }));

  vi.doMock("../../openclaw/lib/chatInternetBridge", () => ({
    gatherInternetContext: vi.fn(async () => null),
    buildInternetSystemPrompt: vi.fn(() => "internet-system-prompt"),
  }));

  vi.doMock("../../openclaw/skills/skillRegistry", () => ({
    skillRegistry: {
      list: vi.fn(() => [
        {
          id: "coding-agent",
          name: "Coding Agent",
          description: "Enterprise coding workflow",
          source: "builtin",
          status: "ready",
          tools: ["openclaw_exec"],
          filePath: "/tmp/skills/coding-agent/SKILL.md",
          updatedAt: "2026-04-11T00:00:00.000Z",
        },
      ]),
    },
  }));

  const httpServer = createServer();
  const { attachOpenClawGateway, generateGatewayToken } = await import("../openclawGateway");
  attachOpenClawGateway(httpServer);

  await new Promise<void>((resolve) => {
    httpServer.listen(0, "127.0.0.1", () => resolve());
  });

  const address = httpServer.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const sockets = new Set<WebSocket>();

  async function connect(userId = "user_test"): Promise<GatewayClient> {
    const authToken = generateGatewayToken(userId);
    const ws = new WebSocket(`ws://127.0.0.1:${port}/openclaw-ws`);
    const messages: any[] = [];
    sockets.add(ws);

    ws.on("message", (raw) => {
      messages.push(JSON.parse(raw.toString()));
    });

    await waitFor(
      () => messages.find((message) => message.type === "event" && message.event === "connect.challenge"),
      "connect.challenge",
    );

    const connectId = "connect-1";
    ws.send(
      JSON.stringify({
        type: "request",
        id: connectId,
        method: "connect",
        params: {
          client: {
            name: "control-ui",
            role: "control",
          },
          auth: {
            authToken,
          },
        },
      }),
    );

    await waitFor(
      () => messages.find((message) => message.type === "res" && message.id === connectId),
      "connect response",
    );
    await waitFor(
      () => messages.find((message) => message.type === "event" && message.event === "connected"),
      "connected event",
    );

    let sequence = 0;
    return {
      ws,
      messages,
      async request(method: string, params?: any) {
        const id = `rpc-${++sequence}`;
        const startIndex = messages.length;
        ws.send(JSON.stringify({ type: "request", id, method, params }));
        const response = await waitFor(
          () =>
            messages
              .slice(startIndex)
              .find((message) => message.type === "res" && message.id === id),
          `${method} response`,
        );
        return { response, startIndex, id };
      },
      async waitForMessage(predicate, label, startIndex = 0) {
        return waitFor(
          () => messages.slice(startIndex).find((message) => predicate(message)),
          label,
        );
      },
      async close() {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }
        await waitFor(
          () => (ws.readyState === WebSocket.CLOSED ? true : undefined),
          "websocket close",
        );
        sockets.delete(ws);
      },
    };
  }

  return {
    async close() {
      for (const socket of sockets) {
        if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
          socket.close();
        }
      }
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
      fs.rmSync(tmpRoot, { recursive: true, force: true });
      delete process.env.OPENCLAW_WORKSPACE_ROOT;
      delete process.env.OPENCLAW_ACTIVE_MEMORY;
      delete process.env.OPENCLAW_ACTIVE_MEMORY_MODE;
    },
    connect,
    mocks: {
      ensureUserRowExistsMock,
      getOpenClawGatewayModelCatalogMock,
      getCatalogModelBySelectionMock,
      getUnifiedQuotaSnapshotMock,
      validateUnifiedQuotaMock,
      recordUnifiedOpenClawUsageMock,
      executeInternetToolMock,
      streamChatMock,
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("openclawGateway enterprise contract", () => {
  it("authenticates via generated token and exposes the enterprise feature set", async () => {
    const harness = await setupGatewayHarness();
    const client = await harness.connect("user_auth");

    try {
      const connectResponse = client.messages.find((message) => message.type === "res" && message.id === "connect-1");
      expect(connectResponse.ok).toBe(true);
      expect(connectResponse.payload.version).toBe(OPENCLAW_RELEASE_VERSION);
      expect(connectResponse.payload.features).toEqual(
        expect.arrayContaining(["chat", "skills", "commands", "config", "memory", "desktop-native-mode"]),
      );

      await waitFor(
        () =>
          harness.mocks.ensureUserRowExistsMock.mock.calls.find(
            (call) => call[0] === "user_auth",
          ),
        "ensureUserRowExists call",
      );
    } finally {
      await client.close();
      await harness.close();
    }
  });

  it("reports the aligned release version on status and health RPCs", async () => {
    const harness = await setupGatewayHarness();
    const client = await harness.connect();

    try {
      const statusResult = await client.request("status");
      const healthResult = await client.request("health");

      expect(statusResult.response.payload.version).toBe(OPENCLAW_RELEASE_VERSION);
      expect(healthResult.response.payload.version).toBe(OPENCLAW_RELEASE_VERSION);
      expect(healthResult.response.payload.ok).toBe(true);
    } finally {
      await client.close();
      await harness.close();
    }
  });

  it("returns the mandatory operator commands list", async () => {
    const harness = await setupGatewayHarness();
    const client = await harness.connect();

    try {
      const { response } = await client.request("commands.list");
      const commandNames = response.payload.commands.map((command: any) => command.name);

      expect(commandNames).toEqual(
        expect.arrayContaining([
          "commands.list",
          "config.patch",
          "skills.search",
          "skills.detail",
          "doctor.memory.status",
          "chat.send",
        ]),
      );
    } finally {
      await client.close();
      await harness.close();
    }
  });

  it("returns config.get with the unified quota snapshot and desktop native mode", async () => {
    const harness = await setupGatewayHarness();
    const client = await harness.connect("user_config");

    try {
      const { response } = await client.request("config.get");

      expect(response.payload.version).toBe(OPENCLAW_RELEASE_VERSION);
      expect(response.payload.desktopNativeMode).toEqual({ enabled: true });
      expect(response.payload.quota.unified).toBe(true);
      expect(response.payload.quota.snapshot).toMatchObject({
        userId: "user_config",
        blockingState: "ok",
        channels: {
          openclawUsed: 210,
        },
      });
    } finally {
      await client.close();
      await harness.close();
    }
  });

  it("returns the unified model catalog with logos, availability, permissions and provider metadata", async () => {
    const harness = await setupGatewayHarness();
    const client = await harness.connect();

    try {
      const { response } = await client.request("models.list");
      const models = response.payload.models;

      expect(models).toHaveLength(2);
      expect(models[0]).toMatchObject({
        name: "Gemma 4 31B",
        logoUrl: "/logos/gemma.png",
        providerDisplayName: "Google",
        accessState: "enabled",
        status: "active",
        permissions: {
          chat: true,
          tools: true,
          streaming: true,
        },
      });
      expect(models[1]).toMatchObject({
        name: "GPT-5.4",
        logoUrl: "/logos/openai.png",
        availableToUser: false,
        requiresUpgrade: true,
        accessState: "upgrade_required",
      });
    } finally {
      await client.close();
      await harness.close();
    }
  });

  it("applies config.patch model overrides and reflects them in sessions.list", async () => {
    const harness = await setupGatewayHarness();
    const client = await harness.connect();

    try {
      const patchResult = await client.request("config.patch", {
        sessionKey: "main",
        raw: JSON.stringify({
          model: {
            model: "gpt-5.4",
            provider: "openai",
          },
        }),
      });
      expect(patchResult.response.payload.ok).toBe(true);

      const { response } = await client.request("sessions.list");
      expect(response.payload.sessions[0]).toMatchObject({
        key: "main",
        model: "gpt-5.4",
        provider: "openai",
        modelProvider: "openai",
      });
    } finally {
      await client.close();
      await harness.close();
    }
  });

  it("resolves sessions.patch against the canonical catalog and persists the selected provider", async () => {
    const harness = await setupGatewayHarness();
    const client = await harness.connect();

    try {
      const patchResult = await client.request("sessions.patch", {
        key: "analysis",
        model: "openai/gpt-5.4",
      });

      expect(patchResult.response.payload.resolved).toEqual({
        model: "gpt-5.4",
        modelProvider: "openai",
      });

      const { response } = await client.request("sessions.patch", {
        key: "analysis",
        model: "google/gemma-4-31b-it",
      });
      expect(response.payload.resolved).toEqual({
        model: "google/gemma-4-31b-it",
        modelProvider: "openrouter",
      });
    } finally {
      await client.close();
      await harness.close();
    }
  });

  it("reports installed skills and supports skill search", async () => {
    const harness = await setupGatewayHarness();
    const client = await harness.connect();

    try {
      const statusResult = await client.request("skills.status");
      expect(statusResult.response.payload.total).toBe(1);
      expect(statusResult.response.payload.ready).toBe(1);
      expect(statusResult.response.payload.skills[0]).toMatchObject({
        id: "coding-agent",
        name: "Coding Agent",
      });

      const searchResult = await client.request("skills.search", {
        query: "coding",
      });
      expect(searchResult.response.payload.results).toEqual([
        expect.objectContaining({
          id: "coding-agent",
          slug: "coding-agent",
          tools: ["openclaw_exec"],
        }),
      ]);
    } finally {
      await client.close();
      await harness.close();
    }
  });

  it("returns skill detail and errors cleanly when the skill does not exist", async () => {
    const harness = await setupGatewayHarness();
    const client = await harness.connect();

    try {
      const detailResult = await client.request("skills.detail", {
        id: "coding-agent",
      });
      expect(detailResult.response.payload).toMatchObject({
        id: "coding-agent",
        filePath: "/tmp/skills/coding-agent/SKILL.md",
      });

      const missingResult = await client.request("skills.detail", {
        id: "missing-skill",
      });
      expect(missingResult.response.ok).toBe(false);
      expect(missingResult.response.error).toMatchObject({
        code: "-32601",
        message: "Skill not found: missing-skill",
      });
    } finally {
      await client.close();
      await harness.close();
    }
  });

  it("reports Active Memory / dreaming status", async () => {
    const harness = await setupGatewayHarness({
      activeMemoryEnabled: true,
      activeMemoryMode: "signal",
    });
    const client = await harness.connect();

    try {
      const { response } = await client.request("doctor.memory.status");
      expect(response.payload.dreaming).toMatchObject({
        enabled: true,
        storageMode: "signal",
        shortTermCount: 0,
      });
    } finally {
      await client.close();
      await harness.close();
    }
  });

  it("exposes internet tools and executes them with running/done lifecycle events", async () => {
    const harness = await setupGatewayHarness();
    const client = await harness.connect();

    try {
      const catalogResult = await client.request("tools.catalog");
      expect(catalogResult.response.payload.tools).toEqual([
        expect.objectContaining({
          id: "web.search",
          source: "openclaw-internet",
          enabled: true,
        }),
      ]);

      const executionResult = await client.request("tools.execute", {
        toolId: "web.search",
        params: { query: "ILIAGPT enterprise" },
        runId: "tool-run-1",
      });
      expect(executionResult.response.payload.ok).toBe(true);
      expect(harness.mocks.executeInternetToolMock).toHaveBeenCalledWith("web.search", {
        query: "ILIAGPT enterprise",
      });

      const runningEvent = await client.waitForMessage(
        (message) =>
          message.type === "event" &&
          message.event === "tool.status" &&
          message.payload.runId === "tool-run-1" &&
          message.payload.state === "running",
        "tool running event",
        executionResult.startIndex,
      );
      const doneEvent = await client.waitForMessage(
        (message) =>
          message.type === "event" &&
          message.event === "tool.status" &&
          message.payload.runId === "tool-run-1" &&
          message.payload.state === "done",
        "tool done event",
        executionResult.startIndex,
      );

      expect(runningEvent.payload.toolId).toBe("web.search");
      expect(doneEvent.payload.ok).toBe(true);
    } finally {
      await client.close();
      await harness.close();
    }
  });

  it("persists downloaded files through the agents.files lifecycle", async () => {
    const harness = await setupGatewayHarness();
    const client = await harness.connect("user_files");

    try {
      const setResult = await client.request("agents.files.set", {
        name: "evidence.txt",
        content: "enterprise-openclaw",
      });
      expect(setResult.response.payload).toMatchObject({
        ok: true,
        name: "evidence.txt",
      });

      const listResult = await client.request("agents.files.list");
      expect(listResult.response.payload.files).toEqual([
        expect.objectContaining({
          name: "evidence.txt",
        }),
      ]);

      const getResult = await client.request("agents.files.get", {
        name: "evidence.txt",
      });
      expect(Buffer.from(getResult.response.payload.data, "base64").toString("utf-8")).toBe(
        "enterprise-openclaw",
      );

      const deleteResult = await client.request("agents.files.delete", {
        name: "evidence.txt",
      });
      expect(deleteResult.response.payload.ok).toBe(true);

      const listAfterDelete = await client.request("agents.files.list");
      expect(listAfterDelete.response.payload.files).toEqual([]);
    } finally {
      await client.close();
      await harness.close();
    }
  });

  it("streams chat responses end-to-end and records usage in the unified billing system", async () => {
    const harness = await setupGatewayHarness({
      streamChunks: [{ content: "Respuesta" }, { content: " final" }, { done: true }],
    });
    const client = await harness.connect("user_stream");

    try {
      const startIndex = client.messages.length;
      client.ws.send(
        JSON.stringify({
          type: "request",
          id: "chat-stream-1",
          method: "chat.send",
          params: {
            sessionKey: "main",
            message: "resume el cierre de la integración enterprise",
          },
        }),
      );

      const ack = await client.waitForMessage(
        (message) => message.type === "res" && message.id === "chat-stream-1",
        "chat ack",
        startIndex,
      );
      const deltaEvent = await client.waitForMessage(
        (message) =>
          message.type === "event" &&
          message.event === "chat" &&
          message.payload.runId === ack.payload.runId &&
          message.payload.state === "delta" &&
          message.payload.message?.content?.[0]?.text?.includes("Respuesta"),
        "stream delta event",
        startIndex,
      );
      const finalEvent = await client.waitForMessage(
        (message) =>
          message.type === "event" &&
          message.event === "chat" &&
          message.payload.runId === ack.payload.runId &&
          message.payload.state === "final",
        "stream final event",
        startIndex,
      );

      expect(deltaEvent.payload.message.content[0].text).toContain("Respuesta");
      expect(finalEvent.payload.message.content[0].text).toBe("Respuesta final");
      expect(harness.mocks.streamChatMock).toHaveBeenCalledTimes(1);
      expect(harness.mocks.recordUnifiedOpenClawUsageMock).toHaveBeenCalledWith(
        "user_stream",
        expect.any(Number),
        expect.any(Number),
      );
    } finally {
      await client.close();
      await harness.close();
    }
  });

  it("blocks chat.send consistently when the shared quota is exhausted", async () => {
    const harness = await setupGatewayHarness({
      quotaAllowed: false,
    });
    const client = await harness.connect("user_quota_blocked");

    try {
      const startIndex = client.messages.length;
      client.ws.send(
        JSON.stringify({
          type: "request",
          id: "chat-quota-1",
          method: "chat.send",
          params: {
            sessionKey: "main",
            message: "haz un análisis largo",
          },
        }),
      );

      const errorResponse = await client.waitForMessage(
        (message) => message.type === "res" && message.id === "chat-quota-1",
        "quota error response",
        startIndex,
      );
      const errorEvent = await client.waitForMessage(
        (message) =>
          message.type === "event" &&
          message.event === "chat" &&
          message.payload.state === "error" &&
          message.payload.errorCode === "TOKEN_QUOTA_EXCEEDED",
        "quota error event",
        startIndex,
      );

      expect(errorResponse.ok).toBe(false);
      expect(errorResponse.error.message).toContain("saldo global mensual");
      expect(errorEvent.payload.billing).toMatchObject(DEFAULT_QUOTA_SNAPSHOT.billing);
      expect(harness.mocks.streamChatMock).not.toHaveBeenCalled();
      expect(harness.mocks.recordUnifiedOpenClawUsageMock).not.toHaveBeenCalled();
    } finally {
      await client.close();
      await harness.close();
    }
  });

  it("blocks chat.send when the chosen model requires an upgrade", async () => {
    const harness = await setupGatewayHarness();
    const client = await harness.connect("user_upgrade");

    try {
      const startIndex = client.messages.length;
      client.ws.send(
        JSON.stringify({
          type: "request",
          id: "chat-upgrade-1",
          method: "chat.send",
          params: {
            sessionKey: "main",
            model: "gpt-5.4",
            provider: "openai",
            message: "usa el mejor modelo posible",
          },
        }),
      );

      const errorResponse = await client.waitForMessage(
        (message) => message.type === "res" && message.id === "chat-upgrade-1",
        "upgrade error response",
        startIndex,
      );
      const errorEvent = await client.waitForMessage(
        (message) =>
          message.type === "event" &&
          message.event === "chat" &&
          message.payload.state === "error" &&
          message.payload.errorCode === "MODEL_UPGRADE_REQUIRED",
        "upgrade error event",
        startIndex,
      );

      expect(errorResponse.ok).toBe(false);
      expect(errorResponse.error.message).toContain("no está disponible para tu plan actual");
      expect(errorEvent.payload.billing).toMatchObject(DEFAULT_QUOTA_SNAPSHOT.billing);
      expect(harness.mocks.validateUnifiedQuotaMock).not.toHaveBeenCalled();
      expect(harness.mocks.streamChatMock).not.toHaveBeenCalled();
    } finally {
      await client.close();
      await harness.close();
    }
  });

  it("resolves explicit math requests locally and still bills them through the unified counter", async () => {
    const harness = await setupGatewayHarness();
    const client = await harness.connect("user_math");

    try {
      const startIndex = client.messages.length;
      client.ws.send(
        JSON.stringify({
          type: "request",
          id: "chat-math-1",
          method: "chat.send",
          params: {
            sessionKey: "main",
            message: "renderiza en katex: x^2 + y^2 = z^2",
          },
        }),
      );

      const ack = await client.waitForMessage(
        (message) => message.type === "res" && message.id === "chat-math-1",
        "math ack",
        startIndex,
      );
      const finalEvent = await client.waitForMessage(
        (message) =>
          message.type === "event" &&
          message.event === "chat" &&
          message.payload.runId === ack.payload.runId &&
          message.payload.state === "final",
        "math final event",
        startIndex,
      );

      expect(finalEvent.payload.message.content[0].text).toContain("$$x^2 + y^2 = z^2$$");
      expect(harness.mocks.streamChatMock).not.toHaveBeenCalled();
      expect(harness.mocks.recordUnifiedOpenClawUsageMock).toHaveBeenCalledWith(
        "user_math",
        expect.any(Number),
        expect.any(Number),
      );
    } finally {
      await client.close();
      await harness.close();
    }
  });
});
