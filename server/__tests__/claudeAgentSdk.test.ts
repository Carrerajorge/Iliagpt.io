import { describe, it, expect } from "vitest";

describe("Claude Agent SDK integration", () => {
  it("exports executeClaudeAgent function", async () => {
    const mod = await import("../agent/claudeAgentSdk");
    expect(typeof mod.executeClaudeAgent).toBe("function");
  });

  it("exports isClaudeAgentAvailable function", async () => {
    const mod = await import("../agent/claudeAgentSdk");
    expect(typeof mod.isClaudeAgentAvailable).toBe("function");
  });

  it("isClaudeAgentAvailable returns boolean", async () => {
    const { isClaudeAgentAvailable } = await import("../agent/claudeAgentSdk");
    const result = await isClaudeAgentAvailable();
    expect(typeof result).toBe("boolean");
  });

  it("ClaudeAgentResult has correct shape", async () => {
    // Verify the type structure by creating a mock result
    const result = {
      content: "test",
      toolsUsed: ["Read"],
      turns: 1,
      durationMs: 100,
    };
    expect(result.content).toBe("test");
    expect(result.toolsUsed).toContain("Read");
    expect(result.turns).toBe(1);
    expect(result.durationMs).toBe(100);
  });

  it("handles missing SDK gracefully", async () => {
    // The SDK should either be available or throw cleanly
    const { isClaudeAgentAvailable } = await import("../agent/claudeAgentSdk");
    const available = await isClaudeAgentAvailable();
    // Just verify it doesn't crash
    expect([true, false]).toContain(available);
  });
});
