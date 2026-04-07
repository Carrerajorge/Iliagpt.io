import { describe, it, expect, beforeEach, afterEach } from "vitest";

const ENV_KEYS = [
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "XAI_API_KEY",
  "GROK_API_KEY",
  "ILIAGPT_API_KEY",
  "OPENAI_API_KEY",
] as const;

describe("modelIntegration", () => {
  const originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) originalEnv[k] = process.env[k];
    for (const k of ENV_KEYS) delete process.env[k];
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      const v = originalEnv[k];
      if (typeof v === "string") process.env[k] = v;
      else delete process.env[k];
    }
  });

  it("normalizes provider ids to runtime providers", async () => {
    const { normalizeModelProviderToRuntime } = await import("../modelIntegration");
    expect(normalizeModelProviderToRuntime("google")).toBe("gemini");
    expect(normalizeModelProviderToRuntime("gemini")).toBe("gemini");
    expect(normalizeModelProviderToRuntime("xai")).toBe("xai");
    expect(normalizeModelProviderToRuntime("grok")).toBe("xai");
    expect(normalizeModelProviderToRuntime("openai")).toBe("openai");
  });

  it("treats GOOGLE_API_KEY as Gemini integration key", async () => {
    process.env.GOOGLE_API_KEY = "x";
    const { isModelProviderIntegrated } = await import("../modelIntegration");
    expect(isModelProviderIntegrated("google")).toBe(true);
    expect(isModelProviderIntegrated("gemini")).toBe(true);
  });

  it("treats ILIAGPT_API_KEY as xAI integration key (legacy)", async () => {
    process.env.ILIAGPT_API_KEY = "x";
    const { isModelProviderIntegrated } = await import("../modelIntegration");
    expect(isModelProviderIntegrated("xai")).toBe(true);
    expect(isModelProviderIntegrated("grok")).toBe(true);
  });

  it("computes chat capability based on provider+modelId+modelType", async () => {
    const { isModelChatCapable } = await import("../modelIntegration");
    expect(isModelChatCapable({ provider: "google", modelId: "gemini-2.0-flash", modelType: "TEXT" })).toBe(true);
    expect(isModelChatCapable({ provider: "google", modelId: "imagen-4", modelType: "IMAGE" })).toBe(false);
    expect(isModelChatCapable({ provider: "xai", modelId: "grok-4-fast", modelType: "TEXT" })).toBe(true);
    expect(isModelChatCapable({ provider: "openai", modelId: "gpt-5", modelType: "TEXT" })).toBe(true);
  });

  it("only exposes Minimax M2.5 models publicly", async () => {
    const { isModelEligibleForPublic } = await import("../modelIntegration");

    process.env.GEMINI_API_KEY = "x";
    expect(isModelEligibleForPublic({ provider: "google", modelId: "gemini-2.0-flash", modelType: "TEXT", status: "active", isEnabled: "true" })).toBe(false);
    expect(isModelEligibleForPublic({ provider: "google", modelId: "gemini-2.0-flash", modelType: "TEXT", status: "inactive", isEnabled: "true" })).toBe(false);
    expect(isModelEligibleForPublic({ provider: "google", modelId: "imagen-4", modelType: "IMAGE", status: "active", isEnabled: "true" })).toBe(false);
    expect(isModelEligibleForPublic({ provider: "openai", modelId: "minimax-m2.5", modelType: "TEXT", status: "active", isEnabled: "true" })).toBe(true);
  });
});
