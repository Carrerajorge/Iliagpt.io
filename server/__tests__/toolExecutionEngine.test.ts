import { describe, it, expect, vi } from "vitest";
import { ToolExecutionEngine } from "../services/toolExecutionEngine";

const baseTool = {
  name: "echo",
  description: "Echo tool",
  type: "typescript" as const,
  category: "general",
  isAvailable: true,
};

function mockToolExecutionSuccess(engine: ToolExecutionEngine, resultDelayMs = 25): void {
  const delay = async () =>
    new Promise<void>((resolve) => {
      setTimeout(resolve, resultDelayMs);
    });

  (engine as any).getTool = vi.fn(async () => baseTool);
  (engine as any).getCircuitBreaker = vi.fn(() => ({
    call: async (fn: () => Promise<unknown>) => {
      const data = await fn();
      return {
        success: true,
        data,
        latencyMs: resultDelayMs,
        circuitState: "CLOSED",
        retryCount: 0,
      };
    },
  }));
  (engine as any).executeTypescriptTool = vi.fn(async () => {
    await delay();
    return { message: "ok" };
  });
}

describe("ToolExecutionEngine", () => {
  it("returns hard failure result for invalid tool names", async () => {
    const engine = new ToolExecutionEngine();

    const result = await engine.execute("invalid name!", { value: 1 });

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("INVALID_INPUT");
    expect(result.metadata?.userId).toBeUndefined();
    expect(result.metrics.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("returns deterministic conflict when idempotency key is reused with different payload", async () => {
    const engine = new ToolExecutionEngine();
    mockToolExecutionSuccess(engine, 50);

    const first = engine.execute("echo", { value: 1 }, { idempotencyKey: "idemkey-test-0001" });
    await Promise.resolve();

    const second = await engine.execute("echo", { value: 2 }, { idempotencyKey: "idemkey-test-0001" });
    expect(second.errorCode).toBe("IDEMPOTENCY_CONFLICT");

    (engine as any).activeExecutions.clear();
    const firstResult = await first;
    expect(firstResult.success).toBe(true);
    expect(firstResult.data).toEqual({ message: "ok" });
  });

  it("returns overloaded error when active executions hit concurrency limit", async () => {
    const engine = new ToolExecutionEngine();
    mockToolExecutionSuccess(engine, 1);

    const saturatedActive = engine as unknown as {
      activeExecutions: Map<string, any>;
    };
    for (let i = 0; i < 64; i += 1) {
      saturatedActive.activeExecutions.set(`execution-${i}`, {
        executionId: `execution-${i}`,
        toolName: "echo",
        status: "running",
        progress: 0,
        message: "pre-filled",
        step: 1,
        totalSteps: 1,
        startedAt: Date.now(),
        updatedAt: Date.now(),
      });
    }

    const result = await engine.execute("echo", { value: 1 }, { idempotencyKey: "idem-overload-01" });

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("TOOL_OVERLOADED");
    expect(result.error).toContain("concurrency limit");
  });
});
