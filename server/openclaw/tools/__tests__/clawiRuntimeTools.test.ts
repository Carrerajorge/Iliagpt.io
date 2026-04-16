import { describe, it, expect } from "vitest";
import { createClawiRuntimeTools } from "../clawiRuntimeTools";

describe("clawiRuntimeTools", () => {
  it("registers status and exec tools", () => {
    const tools = createClawiRuntimeTools();
    const names = tools.map((tool) => tool.name);
    expect(names).toContain("openclaw_clawi_status");
    expect(names).toContain("openclaw_clawi_exec");
  });
});
