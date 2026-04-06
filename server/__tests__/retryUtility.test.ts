import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/productionLogger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { withRetry } from "../lib/retryUtility";

describe("retryUtility", () => {
  it("retries retryable failures and then resolves", async () => {
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValue("ok");

    await expect(
      withRetry(fn, { maxAttempts: 3, initialDelayMs: 1, jitter: false }),
    ).resolves.toBe("ok");

    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does not retry non-retryable failures", async () => {
    const fn = vi.fn<() => Promise<string>>().mockRejectedValue(new Error("validation failed"));

    await expect(
      withRetry(fn, { maxAttempts: 3, initialDelayMs: 1, jitter: false }),
    ).rejects.toThrow("validation failed");

    expect(fn).toHaveBeenCalledTimes(1);
  });
});
