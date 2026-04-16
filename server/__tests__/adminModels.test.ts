import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import { createHttpTestClient } from "../../tests/helpers/httpTestClient";

const ENV_KEYS = [
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "XAI_API_KEY",
  "GROK_API_KEY",
  "ILIAGPT_API_KEY",
  "OPENAI_API_KEY",
] as const;

const storageMock = {
  getAiModelById: vi.fn(),
  updateAiModel: vi.fn(),
  createAuditLog: vi.fn(async () => ({})),
  getAiModels: vi.fn(async () => []),
  getAiModelsFiltered: vi.fn(async () => ({ models: [], total: 0 })),
  createAiModel: vi.fn(),
  deleteAiModel: vi.fn(),
} as any;

const syncModelsForProviderMock = vi.fn(async (_provider: string) => ({ added: 0, updated: 0, errors: [] as string[] }));
const getAvailableProvidersMock = vi.fn(() => ["xai", "google", "openai"]);
const getModelStatsMock = vi.fn(() => ({ totalKnown: 0, byProvider: {}, byType: {} }));

vi.mock("../storage", () => ({ storage: storageMock }));
vi.mock("../services/aiModelSyncService", () => ({
  syncModelsForProvider: (...args: any[]) => syncModelsForProviderMock(...args),
  getAvailableProviders: (...args: any[]) => getAvailableProvidersMock(...args),
  getModelStats: (...args: any[]) => getModelStatsMock(...args),
}));

describe("admin models router", () => {
  const originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) originalEnv[k] = process.env[k];
    for (const k of ENV_KEYS) delete process.env[k];

    storageMock.getAiModelById.mockReset();
    storageMock.updateAiModel.mockReset();
    storageMock.createAuditLog.mockReset();
    storageMock.createAuditLog.mockResolvedValue({});

    syncModelsForProviderMock.mockReset();
    getAvailableProvidersMock.mockReset();
    getModelStatsMock.mockReset();
    getAvailableProvidersMock.mockReturnValue(["xai", "google", "openai"]);
    syncModelsForProviderMock.mockResolvedValue({ added: 0, updated: 0, errors: [] });
    getModelStatsMock.mockReturnValue({ totalKnown: 0, byProvider: {}, byType: {} });
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      const v = originalEnv[k];
      if (typeof v === "string") process.env[k] = v;
      else delete process.env[k];
    }
  });

  async function buildApp() {
    const { modelsRouter } = await import("../routes/admin/models");
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).user = { id: "admin-1", email: "admin@example.com" };
      next();
    });
    app.use("/api/admin/models", modelsRouter);
    return app;
  }

  it("blocks enabling when model status is inactive", async () => {
    process.env.GEMINI_API_KEY = "x";
    storageMock.getAiModelById.mockResolvedValue({
      id: "m1",
      name: "Gemini Flash",
      provider: "google",
      modelId: "gemini-2.0-flash",
      modelType: "TEXT",
      status: "inactive",
      isEnabled: "false",
    });

    const app = await buildApp();
    const { client, close } = await createHttpTestClient(app);
    try {
      const res = await client.patch("/api/admin/models/m1/toggle").send({ isEnabled: true });
      expect(res.status).toBe(409);
      expect(String(res.body?.error || "")).toMatch(/Active/i);
    } finally {
      await close();
    }
  });

  it("blocks enabling when provider is not integrated", async () => {
    storageMock.getAiModelById.mockResolvedValue({
      id: "m1",
      name: "Gemini Flash",
      provider: "google",
      modelId: "gemini-2.0-flash",
      modelType: "TEXT",
      status: "active",
      isEnabled: "false",
    });

    const app = await buildApp();
    const { client, close } = await createHttpTestClient(app);
    try {
      const res = await client.patch("/api/admin/models/m1/toggle").send({ isEnabled: true });
      expect(res.status).toBe(409);
      expect(String(res.body?.error || "")).toMatch(/integrated/i);
    } finally {
      await close();
    }
  });

  it("blocks enabling when model is not chat-capable", async () => {
    process.env.GEMINI_API_KEY = "x";
    storageMock.getAiModelById.mockResolvedValue({
      id: "m1",
      name: "Imagen 4",
      provider: "google",
      modelId: "imagen-4",
      modelType: "IMAGE",
      status: "active",
      isEnabled: "false",
    });

    const app = await buildApp();
    const { client, close } = await createHttpTestClient(app);
    try {
      const res = await client.patch("/api/admin/models/m1/toggle").send({ isEnabled: true });
      expect(res.status).toBe(409);
      expect(String(res.body?.error || "")).toMatch(/chat/i);
    } finally {
      await close();
    }
  });

  it("enables a valid integrated chat model", async () => {
    process.env.GEMINI_API_KEY = "x";
    const existing = {
      id: "m1",
      name: "Gemini Flash",
      provider: "google",
      modelId: "gemini-2.0-flash",
      modelType: "TEXT",
      status: "active",
      isEnabled: "false",
    };
    storageMock.getAiModelById.mockResolvedValue(existing);
    storageMock.updateAiModel.mockImplementation(async (_id: string, updates: any) => ({ ...existing, ...updates }));

    const app = await buildApp();
    const { client, close } = await createHttpTestClient(app);
    try {
      const res = await client.patch("/api/admin/models/m1/toggle").send({ isEnabled: true });
      expect(res.status).toBe(200);
      expect(res.body.isEnabled).toBe("true");
      expect(storageMock.updateAiModel).toHaveBeenCalledTimes(1);
    } finally {
      await close();
    }
  });

  it("forces disable when PATCHing status to inactive", async () => {
    storageMock.getAiModelById.mockResolvedValue({
      id: "m1",
      name: "Gemini Flash",
      provider: "google",
      modelId: "gemini-2.0-flash",
      modelType: "TEXT",
      status: "active",
      isEnabled: "true",
    });
    storageMock.updateAiModel.mockImplementation(async (_id: string, updates: any) => updates);

    const app = await buildApp();
    const { client, close } = await createHttpTestClient(app);
    try {
      const res = await client.patch("/api/admin/models/m1").send({ status: "inactive" });
      expect(res.status).toBe(200);

      const updates = storageMock.updateAiModel.mock.calls[0]?.[1] || {};
      expect(updates.status).toBe("inactive");
      expect(updates.isEnabled).toBe("false");
      expect(updates.enabledAt).toBe(null);
      expect(updates.enabledByAdminId).toBe(null);
    } finally {
      await close();
    }
  });

  it("sync scope=supported filters to only runtime-supported providers", async () => {
    const app = await buildApp();
    const { client, close } = await createHttpTestClient(app);
    try {
      const res = await client.post("/api/admin/models/sync?scope=supported");
      expect(res.status).toBe(200);

      const calledProviders = syncModelsForProviderMock.mock.calls.map((c) => c[0]);
      expect(calledProviders.sort()).toEqual(["google", "openai", "xai"]);
    } finally {
      await close();
    }
  });

  it("sync scope=integrated filters to providers with API keys configured", async () => {
    process.env.GEMINI_API_KEY = "x";
    const app = await buildApp();
    const { client, close } = await createHttpTestClient(app);
    try {
      const res = await client.post("/api/admin/models/sync?scope=integrated");
      expect(res.status).toBe(200);

      const calledProviders = syncModelsForProviderMock.mock.calls.map((c) => c[0]);
      expect(calledProviders).toEqual(["google"]);
    } finally {
      await close();
    }
  });
});
