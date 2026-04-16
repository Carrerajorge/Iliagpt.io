import { describe, it, expect } from "vitest";

import { getSuperAgentCoverageReport } from "../superAgentCoverage";

describe("Super Agent Coverage", () => {
  it(
    "should return a 100-capability report for langgraph",
    async () => {
      const report = await getSuperAgentCoverageReport("langgraph");
      expect(report.source).toBe("langgraph");
      expect(report.toolCount).toBeGreaterThan(0);
      expect(report.capabilities).toHaveLength(100);
      expect(report.summary.total).toBe(100);
      expect(report.summary.covered + report.summary.partial + report.summary.missing).toBe(100);
    },
    20000
  );

  it(
    "should return a 100-capability report for combined",
    async () => {
      const report = await getSuperAgentCoverageReport("combined");
      expect(report.source).toBe("combined");
      expect(report.toolCount).toBeGreaterThan(0);
      expect(report.capabilities).toHaveLength(100);
      expect(report.summary.total).toBe(100);
      expect(report.summary.covered + report.summary.partial + report.summary.missing).toBe(100);
    },
    20000
  );
});

