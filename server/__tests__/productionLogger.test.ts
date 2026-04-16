import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("ProductionLogger.error", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalLogLevel = process.env.LOG_LEVEL;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.NODE_ENV = "production";
    process.env.LOG_LEVEL = "error";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env.NODE_ENV = originalNodeEnv;
    process.env.LOG_LEVEL = originalLogLevel;
  });

  it("treats a plain object second argument as log context", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { createLogger } = await import("../lib/productionLogger");
    const logger = createLogger("PromptAuditStore");

    logger.error("logTransformation failed", {
      requestId: "req_1",
      error: "db unavailable",
    });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const entry = JSON.parse(String(logSpy.mock.calls[0][0]));

    expect(entry.message).toBe("logTransformation failed");
    expect(entry.context.component).toBe("PromptAuditStore");
    expect(entry.context.requestId).toBe("req_1");
    expect(entry.context.error).toBe("db unavailable");
    expect(entry.error).toBeUndefined();
  });

  it("supports context-first error logging with a trailing Error", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { createLogger } = await import("../lib/productionLogger");
    const logger = createLogger("Stream");

    logger.error(
      { requestId: "req_2", runId: "run_9" },
      "provider stream failed",
      new Error("socket closed"),
    );

    expect(logSpy).toHaveBeenCalledTimes(1);
    const entry = JSON.parse(String(logSpy.mock.calls[0][0]));

    expect(entry.message).toBe("provider stream failed");
    expect(entry.context.component).toBe("Stream");
    expect(entry.context.requestId).toBe("req_2");
    expect(entry.context.runId).toBe("run_9");
    expect(entry.error.message).toBe("socket closed");
  });
});
