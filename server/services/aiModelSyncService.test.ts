import { describe, expect, it } from "vitest";
import { getAvailableProviders, getKnownModelsForProvider } from "./aiModelSyncService";

describe("aiModelSyncService catalog", () => {
  it("includes the native DeepSeek provider in the sync catalog", () => {
    expect(getAvailableProviders()).toContain("deepseek");
  });

  it("publishes DeepSeek chat and reasoning models for synchronization", () => {
    const models = getKnownModelsForProvider("deepseek");
    const modelIds = models.map((model) => model.modelId);

    expect(modelIds).toContain("deepseek-chat");
    expect(modelIds).toContain("deepseek-reasoner");
    expect(models.every((model) => model.type === "TEXT")).toBe(true);
  });
});
