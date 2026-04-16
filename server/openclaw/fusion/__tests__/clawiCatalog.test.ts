import { describe, it, expect } from "vitest";
import { buildClawiCapabilitiesSummary, getClawiCatalog } from "../clawiCatalog";

describe("clawiCatalog", () => {
  it("builds a catalog object without throwing", async () => {
    const catalog = await getClawiCatalog();
    expect(catalog).toBeTruthy();
    expect(typeof catalog.sourceRoot).toBe("string");
    expect(Array.isArray(catalog.skills)).toBe(true);
    expect(Array.isArray(catalog.extensions)).toBe(true);
    expect(Array.isArray(catalog.agentTools)).toBe(true);
  });

  it("builds a non-empty summary", async () => {
    const summary = await buildClawiCapabilitiesSummary({ maxItems: 5 });
    expect(summary).toContain("[Clawi Capabilities Catalog]");
  });
});
