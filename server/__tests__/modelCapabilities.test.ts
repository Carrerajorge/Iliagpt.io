import { describe, it, expect, afterEach } from "vitest";
import {
  getModelCapabilities,
  clampMaxOutput,
  supportsReasoning,
} from "../llm/modelCapabilities";

afterEach(() => {
  delete process.env.MODEL_CAPABILITIES_OVERRIDES;
});

describe("getModelCapabilities", () => {
  it("resolves Claude (direct) with anthropic reasoning, vision and caching", () => {
    const caps = getModelCapabilities("claude-sonnet-4-5");
    expect(caps.reasoning).toBe("anthropic");
    expect(caps.vision).toBe(true);
    expect(caps.promptCaching).toBe(true);
    expect(caps.contextWindow).toBe(200_000);
  });

  it("resolves Claude via OpenRouter with openrouter reasoning protocol", () => {
    expect(getModelCapabilities("anthropic/claude-opus-4.6").reasoning).toBe("openrouter");
  });

  it("resolves DeepSeek-R1 per host: openrouter slug vs direct vs self-hosted", () => {
    expect(getModelCapabilities("deepseek/deepseek-r1").reasoning).toBe("openrouter");
    expect(getModelCapabilities("deepseek-reasoner").reasoning).toBe("deepseek");
    expect(getModelCapabilities("DeepSeek-R1-Distill-Qwen-32B").reasoning).toBe("think-tag");
  });

  it("flags non-reasoning models as reasoning:null", () => {
    expect(getModelCapabilities("gpt-4o-mini").reasoning).toBeNull();
    expect(getModelCapabilities("openai/gpt-4o").reasoning).toBeNull();
    expect(supportsReasoning("gpt-4o-mini")).toBe(false);
  });

  it("marks gemma and llama-2 as prompted tool callers, davinci as none", () => {
    expect(getModelCapabilities("google/gemma-3-27b-it").toolCalling).toBe("prompted");
    expect(getModelCapabilities("llama-2-13b-chat").toolCalling).toBe("prompted");
    expect(getModelCapabilities("davinci-002").toolCalling).toBe("none");
  });

  it("returns conservative defaults for unknown models", () => {
    const caps = getModelCapabilities("totally-unknown-model-9000");
    expect(caps.toolCalling).toBe("native");
    expect(caps.reasoning).toBeNull();
    expect(caps.contextWindow).toBe(128_000);
  });

  it("honors env overrides over built-in rules", () => {
    process.env.MODEL_CAPABILITIES_OVERRIDES = JSON.stringify({
      "my-org/custom": { reasoning: "openrouter", maxOutput: 1234 },
    });
    const caps = getModelCapabilities("my-org/custom-r2-pro");
    expect(caps.reasoning).toBe("openrouter");
    expect(caps.maxOutput).toBe(1234);
  });

  it("survives invalid override JSON", () => {
    process.env.MODEL_CAPABILITIES_OVERRIDES = "{not json";
    expect(() => getModelCapabilities("gpt-4o")).not.toThrow();
  });
});

describe("clampMaxOutput", () => {
  it("clamps to the model ceiling and passes small values through", () => {
    expect(clampMaxOutput("gpt-4o", 100_000)).toBe(16_384);
    expect(clampMaxOutput("gpt-4o", 2_000)).toBe(2_000);
    expect(clampMaxOutput("gpt-4o", undefined)).toBeUndefined();
  });
});
