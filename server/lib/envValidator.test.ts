import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Save the real process.env so we can restore it
const ORIGINAL_ENV = process.env;

describe("envValidator", () => {
  beforeEach(() => {
    vi.resetModules();
    // Create a fresh copy of process.env for each test
    // This ensures no cross-test pollution
    process.env = { ...ORIGINAL_ENV };
    // Clean optional keys that might leak between tests
    delete process.env.REDIS_URL;
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.BRAVE_API_KEY;
    delete process.env.SEMANTIC_SCHOLAR_API_KEY;
    delete process.env.PUBMED_API_KEY;
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.XAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.SESSION_SECRET;
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    vi.restoreAllMocks();
  });

  describe("validateEnv", () => {
    it("returns a valid config when all required vars are present", async () => {
      process.env.NODE_ENV = "test";
      process.env.DATABASE_URL = "postgres://localhost/testdb";
      process.env.OPENAI_API_KEY = "sk-test-key-12345";
      process.env.PORT = "3000";
      process.env.LOG_LEVEL = "debug";

      const { validateEnv } = await import("./envValidator");
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const config = validateEnv();

      expect(config.NODE_ENV).toBe("test");
      expect(config.DATABASE_URL).toBe("postgres://localhost/testdb");
      expect(config.PORT).toBe(3000);
      expect(config.LOG_LEVEL).toBe("debug");
      logSpy.mockRestore();
    });

    it("defaults NODE_ENV to development when not specified", async () => {
      delete process.env.NODE_ENV;
      process.env.DATABASE_URL = "postgres://localhost/testdb";

      const { validateEnv } = await import("./envValidator");
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const config = validateEnv();

      expect(config.NODE_ENV).toBe("development");
      logSpy.mockRestore();
      warnSpy.mockRestore();
    });

    it("defaults PORT to 5000 when not specified", async () => {
      process.env.NODE_ENV = "test";
      process.env.DATABASE_URL = "postgres://localhost/testdb";
      delete process.env.PORT;

      const { validateEnv } = await import("./envValidator");
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const config = validateEnv();

      expect(config.PORT).toBe(5000);
      logSpy.mockRestore();
      warnSpy.mockRestore();
    });

    it("defaults LOG_LEVEL to info when not specified", async () => {
      process.env.NODE_ENV = "test";
      process.env.DATABASE_URL = "postgres://localhost/testdb";
      delete process.env.LOG_LEVEL;

      const { validateEnv } = await import("./envValidator");
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const config = validateEnv();

      expect(config.LOG_LEVEL).toBe("info");
      logSpy.mockRestore();
      warnSpy.mockRestore();
    });

    it("creates partial config in development when DATABASE_URL is missing", async () => {
      process.env.NODE_ENV = "development";
      delete process.env.DATABASE_URL;

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const { validateEnv } = await import("./envValidator");
      const config = validateEnv();

      expect(config).toBeDefined();
      expect(config.NODE_ENV).toBe("development");
      expect(config.DATABASE_URL).toBe("");

      consoleSpy.mockRestore();
      warnSpy.mockRestore();
    });

    it("caches validated env and returns same object on second call", async () => {
      process.env.NODE_ENV = "test";
      process.env.DATABASE_URL = "postgres://localhost/testdb";

      const { validateEnv } = await import("./envValidator");
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const first = validateEnv();
      const second = validateEnv();

      expect(first).toBe(second);
      logSpy.mockRestore();
      warnSpy.mockRestore();
    });

    it("transforms PORT string to number", async () => {
      process.env.NODE_ENV = "test";
      process.env.DATABASE_URL = "postgres://localhost/testdb";
      process.env.PORT = "8080";

      const { validateEnv } = await import("./envValidator");
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const config = validateEnv();

      expect(typeof config.PORT).toBe("number");
      expect(config.PORT).toBe(8080);
      logSpy.mockRestore();
      warnSpy.mockRestore();
    });

    it("warns when no LLM API key is configured", async () => {
      process.env.NODE_ENV = "test";
      process.env.DATABASE_URL = "postgres://localhost/testdb";

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      const { validateEnv } = await import("./envValidator");
      validateEnv();

      const warningCalls = warnSpy.mock.calls.flat().join(" ");
      expect(warningCalls).toContain("No LLM API key configured");

      warnSpy.mockRestore();
      logSpy.mockRestore();
    });

    it("does not warn when at least one LLM key is present", async () => {
      process.env.NODE_ENV = "test";
      process.env.DATABASE_URL = "postgres://localhost/testdb";
      process.env.ANTHROPIC_API_KEY = "sk-ant-test";

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      const { validateEnv } = await import("./envValidator");
      validateEnv();

      const warningCalls = warnSpy.mock.calls.flat().join(" ");
      expect(warningCalls).not.toContain("No LLM API key configured");

      warnSpy.mockRestore();
      logSpy.mockRestore();
    });

    it("accepts development and test as valid NODE_ENV values", async () => {
      for (const env of ["development", "test"]) {
        vi.resetModules();
        process.env = { ...ORIGINAL_ENV };
        // Clean keys that might cause validation issues
        delete process.env.SESSION_SECRET;
        process.env.NODE_ENV = env;
        process.env.DATABASE_URL = "postgres://localhost/testdb";

        const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

        const { validateEnv } = await import("./envValidator");
        const config = validateEnv();
        expect(config.NODE_ENV).toBe(env);

        logSpy.mockRestore();
        warnSpy.mockRestore();
      }
    });

    it("accepts production as a valid NODE_ENV value", async () => {
      process.env.NODE_ENV = "production";
      process.env.DATABASE_URL = "postgres://localhost/testdb";

      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const { validateEnv } = await import("./envValidator");
      const config = validateEnv();
      expect(config.NODE_ENV).toBe("production");

      logSpy.mockRestore();
      warnSpy.mockRestore();
    });
  });

  describe("getEnv", () => {
    it("calls validateEnv if not validated yet", async () => {
      process.env.NODE_ENV = "test";
      process.env.DATABASE_URL = "postgres://localhost/testdb";

      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const { getEnv } = await import("./envValidator");
      const config = getEnv();

      expect(config).toBeDefined();
      expect(config.NODE_ENV).toBe("test");

      logSpy.mockRestore();
      warnSpy.mockRestore();
    });

    it("returns cached config when already validated", async () => {
      process.env.NODE_ENV = "test";
      process.env.DATABASE_URL = "postgres://localhost/testdb";

      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const { validateEnv, getEnv } = await import("./envValidator");
      const first = validateEnv();
      const second = getEnv();

      expect(first).toBe(second);

      logSpy.mockRestore();
      warnSpy.mockRestore();
    });
  });

  describe("hasFeature", () => {
    it("returns true for redis when REDIS_URL is set", async () => {
      process.env.NODE_ENV = "test";
      process.env.DATABASE_URL = "postgres://localhost/testdb";
      process.env.REDIS_URL = "redis://localhost:6379";

      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const { validateEnv, hasFeature } = await import("./envValidator");
      validateEnv();
      expect(hasFeature("redis")).toBe(true);

      logSpy.mockRestore();
      warnSpy.mockRestore();
    });

    it("returns false for redis when REDIS_URL is not set", async () => {
      process.env.NODE_ENV = "test";
      process.env.DATABASE_URL = "postgres://localhost/testdb";
      delete process.env.REDIS_URL;

      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const { validateEnv, hasFeature } = await import("./envValidator");
      validateEnv();
      expect(hasFeature("redis")).toBe(false);

      logSpy.mockRestore();
      warnSpy.mockRestore();
    });

    it("returns true for stripe when both keys are set", async () => {
      process.env.NODE_ENV = "test";
      process.env.DATABASE_URL = "postgres://localhost/testdb";
      process.env.STRIPE_SECRET_KEY = "sk_test_xxx";
      process.env.STRIPE_WEBHOOK_SECRET = "whsec_xxx";

      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const { validateEnv, hasFeature } = await import("./envValidator");
      validateEnv();
      expect(hasFeature("stripe")).toBe(true);

      logSpy.mockRestore();
      warnSpy.mockRestore();
    });

    it("returns false for stripe when only one key is set", async () => {
      process.env.NODE_ENV = "test";
      process.env.DATABASE_URL = "postgres://localhost/testdb";
      process.env.STRIPE_SECRET_KEY = "sk_test_xxx";
      delete process.env.STRIPE_WEBHOOK_SECRET;

      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const { validateEnv, hasFeature } = await import("./envValidator");
      validateEnv();
      expect(hasFeature("stripe")).toBe(false);

      logSpy.mockRestore();
      warnSpy.mockRestore();
    });

    it("returns true for google when both client ID and secret are set", async () => {
      process.env.NODE_ENV = "test";
      process.env.DATABASE_URL = "postgres://localhost/testdb";
      process.env.GOOGLE_CLIENT_ID = "client-id";
      process.env.GOOGLE_CLIENT_SECRET = "client-secret";

      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const { validateEnv, hasFeature } = await import("./envValidator");
      validateEnv();
      expect(hasFeature("google")).toBe(true);

      logSpy.mockRestore();
      warnSpy.mockRestore();
    });

    it("returns false for google when client secret is missing", async () => {
      process.env.NODE_ENV = "test";
      process.env.DATABASE_URL = "postgres://localhost/testdb";
      process.env.GOOGLE_CLIENT_ID = "client-id";
      delete process.env.GOOGLE_CLIENT_SECRET;

      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const { validateEnv, hasFeature } = await import("./envValidator");
      validateEnv();
      expect(hasFeature("google")).toBe(false);

      logSpy.mockRestore();
      warnSpy.mockRestore();
    });

    it("returns true for brave when BRAVE_API_KEY is set", async () => {
      process.env.NODE_ENV = "test";
      process.env.DATABASE_URL = "postgres://localhost/testdb";
      process.env.BRAVE_API_KEY = "brave-key";

      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const { validateEnv, hasFeature } = await import("./envValidator");
      validateEnv();
      expect(hasFeature("brave")).toBe(true);

      logSpy.mockRestore();
      warnSpy.mockRestore();
    });

    it("returns true for llm when any LLM key is set", async () => {
      process.env.NODE_ENV = "test";
      process.env.DATABASE_URL = "postgres://localhost/testdb";
      process.env.DEEPSEEK_API_KEY = "deepseek-key";

      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const { validateEnv, hasFeature } = await import("./envValidator");
      validateEnv();
      expect(hasFeature("llm")).toBe(true);

      logSpy.mockRestore();
      warnSpy.mockRestore();
    });

    it("returns false for llm when no LLM keys are set", async () => {
      process.env.NODE_ENV = "test";
      process.env.DATABASE_URL = "postgres://localhost/testdb";

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      const { validateEnv, hasFeature } = await import("./envValidator");
      validateEnv();
      expect(hasFeature("llm")).toBe(false);

      warnSpy.mockRestore();
      logSpy.mockRestore();
    });

    it("returns false for unknown feature names", async () => {
      process.env.NODE_ENV = "test";
      process.env.DATABASE_URL = "postgres://localhost/testdb";

      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const { validateEnv, hasFeature } = await import("./envValidator");
      validateEnv();
      expect(hasFeature("nonexistent" as any)).toBe(false);

      logSpy.mockRestore();
      warnSpy.mockRestore();
    });
  });
});
