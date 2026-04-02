import { describe, expect, it } from "vitest";

import {
  getOpenAIWebOAuthAvailability,
  isGoogleGeminiDirectOAuthAvailable,
} from "./providerOAuthAvailability.js";

describe("providerOAuthAvailability", () => {
  it("rejects the fallback Codex client for direct OpenAI web OAuth", () => {
    const result = getOpenAIWebOAuthAvailability({
      OPENAI_OAUTH_CLIENT_ID: "app_EMoamEEZ73f0CkXaXp7hrann",
    } as NodeJS.ProcessEnv);

    expect(result.available).toBe(false);
    expect(result.reason).toContain("localhost");
  });

  it("accepts an explicitly configured OpenAI web OAuth client", () => {
    const result = getOpenAIWebOAuthAvailability({
      OPENAI_OAUTH_CLIENT_ID: "app_web_openai_123",
    } as NodeJS.ProcessEnv);

    expect(result.available).toBe(true);
    expect(result.clientId).toBe("app_web_openai_123");
    expect(result.reason).toBeNull();
  });

  it("detects when Gemini direct OAuth is configured", () => {
    expect(
      isGoogleGeminiDirectOAuthAvailable({
        GOOGLE_CLIENT_ID: "google-client",
        GOOGLE_CLIENT_SECRET: "google-secret",
      } as NodeJS.ProcessEnv),
    ).toBe(true);

    expect(
      isGoogleGeminiDirectOAuthAvailable({
        GOOGLE_CLIENT_ID: "google-client",
      } as NodeJS.ProcessEnv),
    ).toBe(false);
  });
});
