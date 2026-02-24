import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("safeErrorMessage", () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    vi.resetModules();
  });

  it("returns error message in development/test", async () => {
    process.env.NODE_ENV = "test";
    const { safeErrorMessage } = await import("./safeError");
    const result = safeErrorMessage(new Error("detailed error"));
    expect(result).toBe("detailed error");
  });

  it("returns fallback for non-Error in development", async () => {
    process.env.NODE_ENV = "test";
    const { safeErrorMessage } = await import("./safeError");
    const result = safeErrorMessage("string error");
    expect(result).toBe("Internal server error");
  });

  it("returns default fallback message", async () => {
    process.env.NODE_ENV = "test";
    const { safeErrorMessage } = await import("./safeError");
    const result = safeErrorMessage(null);
    expect(result).toBe("Internal server error");
  });

  it("accepts custom fallback", async () => {
    process.env.NODE_ENV = "test";
    const { safeErrorMessage } = await import("./safeError");
    const result = safeErrorMessage(null, "Custom error");
    expect(result).toBe("Custom error");
  });
});
