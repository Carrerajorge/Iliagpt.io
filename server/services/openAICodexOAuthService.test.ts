import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const authProfileState = vi.hoisted(() => ({
  profiles: {} as Record<string, any>,
  setAuthProfileOrder: vi.fn(async () => {}),
  ensureOpenClawModelsJson: vi.fn(async () => {}),
  ensurePiAuthJsonFromAuthProfiles: vi.fn(async () => {}),
  loadValidConfigOrThrow: vi.fn(async () => ({})),
  resolveUserScopedAgentDir: vi.fn(() => "/tmp/openai-codex-oauth-service-test"),
}));

vi.mock("./superIntelligence/agents/auth-profiles.js", () => ({
  ensureAuthProfileStore: vi.fn(() => ({
    profiles: authProfileState.profiles,
  })),
  listProfilesForProvider: vi.fn((_store, provider: string) =>
    Object.entries(authProfileState.profiles)
      .filter(([, credential]) => credential?.provider === provider)
      .map(([profileId]) => profileId),
  ),
  setAuthProfileOrder: authProfileState.setAuthProfileOrder,
  upsertAuthProfile: vi.fn(
    ({
      profileId,
      credential,
    }: {
      profileId: string;
      credential: Record<string, unknown>;
    }) => {
      authProfileState.profiles[profileId] = credential;
    },
  ),
}));

vi.mock("./superIntelligence/agents/models-config.js", () => ({
  ensureOpenClawModelsJson: authProfileState.ensureOpenClawModelsJson,
}));

vi.mock("./superIntelligence/agents/pi-auth-json.js", () => ({
  ensurePiAuthJsonFromAuthProfiles: authProfileState.ensurePiAuthJsonFromAuthProfiles,
}));

vi.mock("./superIntelligence/commands/models/shared.js", () => ({
  loadValidConfigOrThrow: authProfileState.loadValidConfigOrThrow,
}));

vi.mock("./userScopedAgentDir.js", () => ({
  resolveUserScopedAgentDir: authProfileState.resolveUserScopedAgentDir,
}));

import {
  getOpenAICodexOAuthFlowState,
  startOpenAICodexOAuthFlow,
} from "./openAICodexOAuthService.js";

const originalFetch = globalThis.fetch;

function toBase64Url(value: string): string {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function createAccessToken(accountId: string): string {
  return [
    toBase64Url(JSON.stringify({ alg: "none", typ: "JWT" })),
    toBase64Url(
      JSON.stringify({
        "https://api.openai.com/auth": {
          chatgpt_account_id: accountId,
        },
      }),
    ),
    "signature",
  ].join(".");
}

describe("openAICodexOAuthService", () => {
  beforeEach(() => {
    for (const key of Object.keys(authProfileState.profiles)) {
      delete authProfileState.profiles[key];
    }
    vi.clearAllMocks();
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
  });

  afterAll(() => {
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
  });

  it("starts ChatGPT web auth with device code instead of localhost callback", async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(
        JSON.stringify({
          device_auth_id: "deviceauth_123",
          user_code: "ABCD-12345",
          interval: "5",
          expires_at: "2026-03-22T06:33:14.799616+00:00",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const flow = await startOpenAICodexOAuthFlow({
      userId: "user-device-code-start",
    });

    expect(flow.authMode).toBe("device_code");
    expect(flow.authUrl).toBe("https://auth.openai.com/codex/device");
    expect(flow.redirectUri).toBe("https://auth.openai.com/deviceauth/callback");
    expect(flow.userCode).toBe("ABCD-12345");
    expect(flow.expiresAt).toBeTruthy();
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      "https://auth.openai.com/api/accounts/deviceauth/usercode",
    );
  });

  it("polls the device code flow and exchanges tokens with the official device callback", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-22T06:18:14.000Z"));

    const fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url === "https://auth.openai.com/api/accounts/deviceauth/usercode") {
        return new Response(
          JSON.stringify({
            device_auth_id: "deviceauth_456",
            user_code: "AEUE-007MM",
            interval: "1",
            expires_at: "2026-03-22T06:33:14.799616+00:00",
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      if (url === "https://auth.openai.com/api/accounts/deviceauth/token") {
        return new Response(
          JSON.stringify({
            authorization_code: "auth-code-123",
            code_verifier: "device-verifier-123",
            code_challenge: "device-challenge-123",
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      if (url === "https://auth.openai.com/oauth/token") {
        const body = init?.body as URLSearchParams;
        expect(body.get("redirect_uri")).toBe(
          "https://auth.openai.com/deviceauth/callback",
        );
        expect(body.get("code")).toBe("auth-code-123");
        expect(body.get("code_verifier")).toBe("device-verifier-123");

        return new Response(
          JSON.stringify({
            access_token: createAccessToken("acct-device-123"),
            refresh_token: "refresh-token-123",
            expires_in: 3600,
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const flow = await startOpenAICodexOAuthFlow({
      userId: "user-device-code-complete",
    });

    vi.setSystemTime(new Date("2026-03-22T06:18:16.000Z"));

    const state = await getOpenAICodexOAuthFlowState({
      flowId: flow.flowId,
      userId: "user-device-code-complete",
    });

    expect(state.status).toBe("completed");
    expect(state.result?.connected).toBe(true);
    expect(state.result?.accountId).toBe("acct-device-123");
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });
});

