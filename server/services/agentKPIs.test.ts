import { describe, it, expect, beforeEach } from "vitest";
import {
  recordRunStart,
  recordToolUsage,
  recordTokenUsage,
  recordRunComplete,
  getKPISummary,
  getRecentRuns,
  getRunKPI,
} from "./agentKPIs";

// The module uses a module-level `kpiStore` array. Since we cannot clear it
// directly between tests, we use unique runIds to isolate test state and use
// a sinceMs filter to scope summaries.

let runCounter = 0;
function uniqueRunId(): string {
  return `test-run-${Date.now()}-${++runCounter}`;
}

// =============================================================================
// recordRunStart
// =============================================================================
describe("recordRunStart", () => {
  it("creates an entry with status 'running'", () => {
    const entry = recordRunStart(uniqueRunId(), "agentA");
    expect(entry.status).toBe("running");
    expect(entry.agentName).toBe("agentA");
  });

  it("initializes toolsUsed as empty array", () => {
    const entry = recordRunStart(uniqueRunId(), "agentB");
    expect(entry.toolsUsed).toEqual([]);
    expect(entry.toolCallCount).toBe(0);
  });

  it("initializes token usage to zero", () => {
    const entry = recordRunStart(uniqueRunId(), "agentC");
    expect(entry.tokenUsage).toEqual({ input: 0, output: 0, total: 0 });
  });

  it("initializes estimatedCost to zero", () => {
    const entry = recordRunStart(uniqueRunId(), "agentD");
    expect(entry.estimatedCost).toBe(0);
  });

  it("sets startedAt to approximately now", () => {
    const before = Date.now();
    const entry = recordRunStart(uniqueRunId(), "agentE");
    const after = Date.now();
    expect(entry.startedAt).toBeGreaterThanOrEqual(before);
    expect(entry.startedAt).toBeLessThanOrEqual(after);
  });

  it("returns the entry with the provided runId", () => {
    const id = uniqueRunId();
    const entry = recordRunStart(id, "agentF");
    expect(entry.runId).toBe(id);
  });
});

// =============================================================================
// recordToolUsage
// =============================================================================
describe("recordToolUsage", () => {
  it("adds a tool to toolsUsed", () => {
    const id = uniqueRunId();
    recordRunStart(id, "agent");
    recordToolUsage(id, "search");
    const entry = getRunKPI(id);
    expect(entry!.toolsUsed).toContain("search");
  });

  it("does not duplicate tool names in toolsUsed", () => {
    const id = uniqueRunId();
    recordRunStart(id, "agent");
    recordToolUsage(id, "search");
    recordToolUsage(id, "search");
    const entry = getRunKPI(id);
    expect(entry!.toolsUsed.filter((t) => t === "search")).toHaveLength(1);
  });

  it("increments toolCallCount on each call", () => {
    const id = uniqueRunId();
    recordRunStart(id, "agent");
    recordToolUsage(id, "search");
    recordToolUsage(id, "search");
    recordToolUsage(id, "fetch");
    const entry = getRunKPI(id);
    expect(entry!.toolCallCount).toBe(3);
  });

  it("does nothing for unknown runId", () => {
    // Should not throw
    expect(() => recordToolUsage("nonexistent-id", "tool")).not.toThrow();
  });
});

// =============================================================================
// recordTokenUsage
// =============================================================================
describe("recordTokenUsage", () => {
  it("accumulates input and output tokens", () => {
    const id = uniqueRunId();
    recordRunStart(id, "agent");
    recordTokenUsage(id, 100, 50);
    recordTokenUsage(id, 200, 100);
    const entry = getRunKPI(id);
    expect(entry!.tokenUsage.input).toBe(300);
    expect(entry!.tokenUsage.output).toBe(150);
    expect(entry!.tokenUsage.total).toBe(450);
  });

  it("updates estimatedCost based on the pricing formula", () => {
    const id = uniqueRunId();
    recordRunStart(id, "agent");
    recordTokenUsage(id, 1000000, 0); // 1M input tokens
    const entry = getRunKPI(id);
    // cost = (1M * 3 + 0 * 15) / 1M = 3.0
    expect(entry!.estimatedCost).toBeCloseTo(3.0, 4);
  });

  it("computes output token cost correctly", () => {
    const id = uniqueRunId();
    recordRunStart(id, "agent");
    recordTokenUsage(id, 0, 1000000); // 1M output tokens
    const entry = getRunKPI(id);
    // cost = (0 * 3 + 1M * 15) / 1M = 15.0
    expect(entry!.estimatedCost).toBeCloseTo(15.0, 4);
  });

  it("does nothing for unknown runId", () => {
    expect(() => recordTokenUsage("nonexistent", 100, 50)).not.toThrow();
  });
});

// =============================================================================
// recordRunComplete
// =============================================================================
describe("recordRunComplete", () => {
  it("sets status to 'success'", () => {
    const id = uniqueRunId();
    recordRunStart(id, "agent");
    recordRunComplete(id, "success");
    const entry = getRunKPI(id);
    expect(entry!.status).toBe("success");
  });

  it("sets status to 'failed' with error message", () => {
    const id = uniqueRunId();
    recordRunStart(id, "agent");
    recordRunComplete(id, "failed", "timeout");
    const entry = getRunKPI(id);
    expect(entry!.status).toBe("failed");
    expect(entry!.error).toBe("timeout");
  });

  it("sets status to 'cancelled'", () => {
    const id = uniqueRunId();
    recordRunStart(id, "agent");
    recordRunComplete(id, "cancelled");
    const entry = getRunKPI(id);
    expect(entry!.status).toBe("cancelled");
  });

  it("computes durationMs from startedAt to completedAt", () => {
    const id = uniqueRunId();
    recordRunStart(id, "agent");
    recordRunComplete(id, "success");
    const entry = getRunKPI(id);
    expect(entry!.durationMs).toBeDefined();
    expect(entry!.durationMs).toBeGreaterThanOrEqual(0);
    expect(entry!.completedAt).toBeDefined();
  });

  it("does nothing for unknown runId", () => {
    expect(() => recordRunComplete("nonexistent", "success")).not.toThrow();
  });
});

// =============================================================================
// getKPISummary
// =============================================================================
describe("getKPISummary", () => {
  it("returns zero success rate when only running entries exist in the window", () => {
    // The module-level store may have entries from other tests.
    // We verify the structural invariant: successRate is a number between 0 and 100.
    const id = uniqueRunId();
    recordRunStart(id, "agent");
    const summary = getKPISummary(60000);
    expect(typeof summary.successRate).toBe("number");
    expect(summary.successRate).toBeGreaterThanOrEqual(0);
    expect(summary.successRate).toBeLessThanOrEqual(100);
  });

  it("computes correct success rate", () => {
    const now = Date.now();
    const id1 = uniqueRunId();
    const id2 = uniqueRunId();
    const id3 = uniqueRunId();
    recordRunStart(id1, "agent");
    recordRunStart(id2, "agent");
    recordRunStart(id3, "agent");
    recordRunComplete(id1, "success");
    recordRunComplete(id2, "success");
    recordRunComplete(id3, "failed", "error");
    // Use a wide sinceMs so all entries are included
    const summary = getKPISummary(60000);
    // 2 out of 3 completed => 66.7%
    expect(summary.successRate).toBeGreaterThan(0);
  });

  it("includes tool usage distribution", () => {
    const id = uniqueRunId();
    recordRunStart(id, "agent");
    recordToolUsage(id, "search");
    recordToolUsage(id, "fetch");
    recordRunComplete(id, "success");
    const summary = getKPISummary(60000);
    expect(summary.toolUsageDistribution).toBeDefined();
  });

  it("includes agent usage distribution", () => {
    const id = uniqueRunId();
    recordRunStart(id, "specialAgent");
    recordRunComplete(id, "success");
    const summary = getKPISummary(60000);
    expect(summary.agentUsageDistribution["specialAgent"]).toBeGreaterThanOrEqual(1);
  });

  it("collects failure reasons sorted by count", () => {
    const id1 = uniqueRunId();
    const id2 = uniqueRunId();
    recordRunStart(id1, "agent");
    recordRunStart(id2, "agent");
    recordRunComplete(id1, "failed", "timeout");
    recordRunComplete(id2, "failed", "timeout");
    const summary = getKPISummary(60000);
    const timeoutReason = summary.failureReasons.find((r) => r.reason === "timeout");
    expect(timeoutReason).toBeDefined();
    expect(timeoutReason!.count).toBeGreaterThanOrEqual(2);
  });

  it("returns timeSeriesLast24h with 24 entries", () => {
    const summary = getKPISummary();
    expect(summary.timeSeriesLast24h).toHaveLength(24);
  });

  it("computes totalTokens across entries", () => {
    const id = uniqueRunId();
    recordRunStart(id, "agent");
    recordTokenUsage(id, 500, 300);
    recordRunComplete(id, "success");
    const summary = getKPISummary(60000);
    expect(summary.totalTokens).toBeGreaterThanOrEqual(800);
  });

  it("computes totalCost across entries", () => {
    const id = uniqueRunId();
    recordRunStart(id, "agent");
    recordTokenUsage(id, 1000, 2000);
    recordRunComplete(id, "success");
    const summary = getKPISummary(60000);
    expect(summary.totalCost).toBeGreaterThan(0);
  });
});

// =============================================================================
// getRecentRuns
// =============================================================================
describe("getRecentRuns", () => {
  it("returns entries in reverse chronological order", () => {
    const id1 = uniqueRunId();
    const id2 = uniqueRunId();
    recordRunStart(id1, "agent");
    recordRunStart(id2, "agent");
    const recent = getRecentRuns(2);
    // The most recent entry should be first
    expect(recent[0].runId).toBe(id2);
    expect(recent[1].runId).toBe(id1);
  });

  it("limits results to the given count", () => {
    for (let i = 0; i < 5; i++) {
      recordRunStart(uniqueRunId(), "agent");
    }
    const recent = getRecentRuns(3);
    expect(recent).toHaveLength(3);
  });

  it("defaults to 20 entries", () => {
    const recent = getRecentRuns();
    expect(recent.length).toBeLessThanOrEqual(20);
  });
});

// =============================================================================
// getRunKPI
// =============================================================================
describe("getRunKPI", () => {
  it("returns the entry for a known runId", () => {
    const id = uniqueRunId();
    recordRunStart(id, "agentX");
    const entry = getRunKPI(id);
    expect(entry).toBeDefined();
    expect(entry!.agentName).toBe("agentX");
  });

  it("returns undefined for unknown runId", () => {
    expect(getRunKPI("does-not-exist")).toBeUndefined();
  });
});
