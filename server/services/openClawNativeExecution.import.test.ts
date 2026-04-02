import { describe, expect, it } from "vitest";

describe("openClawNativeExecution module", () => {
  it("loads without bootstrapping the embedded runner at import time", async () => {
    const mod = await import("./openClawNativeExecution");

    expect(typeof mod.executeOpenClawNativePrompt).toBe("function");
  });
});
