import { beforeEach, describe, expect, it, vi } from "vitest";

async function importFreshCorsModule() {
  vi.resetModules();
  return import("./cors");
}

describe("cors origin allowlist", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOWED_ORIGINS", "");
    vi.stubEnv("APP_URL", "");
    vi.stubEnv("BASE_URL", "");
    vi.stubEnv("REPLIT_DOMAINS", "");
  });

  it("includes BASE_URL origin in production-like mode", async () => {
    vi.stubEnv("BASE_URL", "http://127.0.0.1:41734");
    const { getAllowedOrigins } = await importFreshCorsModule();
    expect(getAllowedOrigins()).toContain("http://127.0.0.1:41734");
  });

  it("allows the exact loopback origin declared via BASE_URL", async () => {
    vi.stubEnv("BASE_URL", "http://127.0.0.1:41734");
    const { isAllowedOrigin } = await importFreshCorsModule();
    expect(isAllowedOrigin("http://127.0.0.1:41734")).toBe(true);
    expect(isAllowedOrigin("http://127.0.0.1:5050")).toBe(false);
  });

  it("includes APP_URL origin alongside explicit allowlist entries", async () => {
    vi.stubEnv("APP_URL", "https://app.iliagpt.io");
    vi.stubEnv("ALLOWED_ORIGINS", "https://console.iliagpt.io");
    const { getAllowedOrigins } = await importFreshCorsModule();
    expect(getAllowedOrigins()).toEqual(
      expect.arrayContaining(["https://app.iliagpt.io", "https://console.iliagpt.io"]),
    );
  });
});
