import { describe, it, expect } from "vitest";
import { AGENT_TIMEOUTS, TimeoutError, withTimeout } from "./agentTimeouts";

describe("AGENT_TIMEOUTS", () => {
  it("has expected timeout values", () => {
    expect(AGENT_TIMEOUTS.TOOL_EXECUTION).toBe(60_000);
    expect(AGENT_TIMEOUTS.ANALYSIS_TASK).toBe(300_000);
    expect(AGENT_TIMEOUTS.AGENT_RUN_TOTAL).toBe(900_000);
    expect(AGENT_TIMEOUTS.LLM_INFERENCE).toBe(90_000);
  });
});

describe("TimeoutError", () => {
  it("has correct name and message", () => {
    const err = new TimeoutError("test timeout");
    expect(err.name).toBe("TimeoutError");
    expect(err.message).toBe("test timeout");
    expect(err.code).toBe("TIMEOUT_EXCEEDED");
    expect(err).toBeInstanceOf(Error);
  });
  it("accepts custom code", () => {
    const err = new TimeoutError("test", "CUSTOM_CODE");
    expect(err.code).toBe("CUSTOM_CODE");
  });
});

describe("withTimeout", () => {
  it("resolves if promise completes before timeout", async () => {
    const result = await withTimeout(Promise.resolve(42), 1000);
    expect(result).toBe(42);
  });

  it("throws TimeoutError if promise exceeds timeout", async () => {
    const slow = new Promise((r) => setTimeout(() => r("done"), 500));
    await expect(withTimeout(slow, 50, "SlowOp")).rejects.toThrow(TimeoutError);
    await expect(withTimeout(slow, 50, "SlowOp")).rejects.toThrow(/SlowOp timed out/);
  });

  it("propagates promise rejection", async () => {
    const failing = Promise.reject(new Error("original error"));
    await expect(withTimeout(failing, 1000)).rejects.toThrow("original error");
  });

  it("uses default context in error message", async () => {
    const slow = new Promise((r) => setTimeout(() => r("done"), 500));
    await expect(withTimeout(slow, 50)).rejects.toThrow(/Operation timed out/);
  });
});
