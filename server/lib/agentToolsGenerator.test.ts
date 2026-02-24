import { describe, expect, it } from "vitest";

import { AgentToolsData, generateAgentToolsExcel } from "./agentToolsGenerator";

describe("AgentToolsGenerator", () => {
  it(
    "generates a non-empty XLSX buffer",
    async () => {
      const buffer = await generateAgentToolsExcel();

      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(buffer.length).toBeGreaterThan(10_000);
      // XLSX is a ZIP container.
      expect(buffer.subarray(0, 2).toString("utf8")).toBe("PK");
    },
    20_000,
  );

  it("exposes a consistent tools catalog", () => {
    const coreTools = AgentToolsData.getCoreTools();
    // Guard against accidental truncation while allowing the curated core catalog size to evolve.
    expect(coreTools.length).toBeGreaterThanOrEqual(25);
    expect(coreTools[0]).toMatchObject({
      id: 1,
      category: expect.any(String),
      keyword: expect.any(String),
      function: expect.any(String),
      description: expect.any(String),
      priority: expect.any(String),
      dependencies: expect.any(String),
    });

    const allTools = AgentToolsData.getAllTools();
    expect(allTools.length).toBeGreaterThan(coreTools.length);
    expect(new Set(allTools.map((tool) => tool.id)).size).toBe(allTools.length);
    expect(AgentToolsData.countByPriority("Crítica")).toBeGreaterThan(0);

    const categories = AgentToolsData.getUniqueCategories();
    expect(categories.length).toBeGreaterThan(0);
    expect(new Set(categories).size).toBe(categories.length);
  });
});
