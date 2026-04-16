import { afterEach, describe, expect, it, vi } from "vitest";
import { users } from "@shared/schema";

type LoadModuleOptions = {
  aiModels?: any[];
  defaultModel?: string;
  userRow?: {
    role?: string | null;
    plan?: string | null;
    subscriptionPlan?: string | null;
    subscriptionStatus?: string | null;
  } | null;
};

async function loadModelCatalogModule(options: LoadModuleOptions = {}) {
  vi.resetModules();

  const aiModels = options.aiModels ?? [];
  const defaultModel = options.defaultModel ?? "z-ai/glm-5";
  const userRows = options.userRow ? [options.userRow] : [];

  vi.doMock("../../storage", () => ({
    storage: {
      getAiModels: vi.fn().mockResolvedValue(aiModels),
    },
  }));

  vi.doMock("../../db", () => ({
    dbRead: {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue(userRows),
          })),
        })),
      })),
    },
  }));

  vi.doMock("../settingsConfigService", () => ({
    getSettingValue: vi.fn().mockResolvedValue(defaultModel),
  }));

  vi.doMock("../modelIntegration", () => ({
    isModelEligibleForPublic: vi.fn(() => true),
    normalizeModelProviderToRuntime: vi.fn((provider: string) => {
      const normalized = String(provider || "").trim().toLowerCase();
      if (normalized === "google" || normalized === "gemini") return "gemini";
      if (normalized === "grok" || normalized === "xai") return "xai";
      return normalized || provider;
    }),
  }));

  const mod = await import("../modelCatalogService");
  mod.invalidateModelCatalogCache();
  return mod;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("modelCatalogService", () => {
  it("keeps the users schema aligned with the subscription fields used by the catalog", () => {
    expect(users.subscriptionPlan).toBeDefined();
    expect(users.subscriptionStatus).toBeDefined();
    expect(users.subscriptionPeriodEnd).toBeDefined();
  });

  it("adds the curated OpenClaw/ILIAGPT presets and falls back to a free default for free users", async () => {
    const { getUnifiedModelCatalog } = await loadModelCatalogModule({
      aiModels: [],
      defaultModel: "z-ai/glm-5",
    });

    const catalog = await getUnifiedModelCatalog({ userId: "anonymous" });

    expect(catalog.models.map((model) => model.name)).toEqual([
      "Gemma 4 31B",
      "Grok 4.1 Rápido",
      "GPT-5.4",
      "Claude Opus",
      "Gemini 3.1 Pro",
      "Grok 4.2",
      "GLM 5.1",
      "Kimi K2.5",
    ]);
    expect(catalog.models.map((model) => model.logoUrl)).toEqual([
      "/logos/gemma.png",
      "/logos/grok.png",
      "/logos/openai.png",
      "/logos/claude.svg",
      "/logos/gemini.svg",
      "/logos/grok.png",
      "/logos/glm.png",
      "/logos/kimi.png",
    ]);
    expect(catalog.models.find((model) => model.name === "GPT-5.4")).toMatchObject({
      availableToUser: false,
      requiresUpgrade: true,
    });
    expect(catalog.defaultModel).toMatchObject({
      name: "Gemma 4 31B",
      modelId: "google/gemma-4-31b-it",
      availableToUser: true,
    });
    expect(catalog.defaultModelId).toBe("google/gemma-4-31b-it");
  });

  it("prefers curated branding metadata over generic provider icons from storage", async () => {
    const { getOpenClawGatewayModelCatalog } = await loadModelCatalogModule({
      aiModels: [
        {
          id: "db-glm-primary",
          provider: "openrouter",
          modelId: "z-ai/glm-5",
          name: "Zhipu GLM",
          description: "Generic GLM entry",
          isEnabled: "true",
          status: "active",
          modelType: "TEXT",
          contextWindow: 12345,
          displayOrder: 1,
          icon: "brain",
        },
      ],
      defaultModel: "z-ai/glm-5",
    });

    const gatewayCatalog = await getOpenClawGatewayModelCatalog({ userId: "anonymous" });
    const glmEntry = gatewayCatalog.models.find((model) => model.id === "z-ai/glm-5");

    expect(glmEntry).toMatchObject({
      id: "z-ai/glm-5",
      provider: "openrouter",
      name: "GLM 5.1",
      providerDisplayName: "Z.ai",
      logoUrl: "/logos/glm.png",
      order: 70,
      available: false,
      requiresUpgrade: true,
    });
  });

  it("resolves provider-qualified OpenClaw selector values back to the canonical model entry", async () => {
    const { getCatalogModelBySelection } = await loadModelCatalogModule({
      aiModels: [],
      defaultModel: "google/gemma-4-31b-it",
    });

    const gptModel = await getCatalogModelBySelection("openai/gpt-5.4", { userId: "anonymous" });
    const kimiModel = await getCatalogModelBySelection("openrouter/moonshotai/kimi-k2.5", {
      userId: "anonymous",
    });

    expect(gptModel).toMatchObject({
      name: "GPT-5.4",
      modelId: "gpt-5.4",
      gatewayProvider: "openai",
    });
    expect(kimiModel).toMatchObject({
      name: "Kimi K2.5",
      modelId: "moonshotai/kimi-k2.5",
      gatewayProvider: "openrouter",
    });
  });
});
