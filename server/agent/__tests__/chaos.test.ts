import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { z } from "zod";
import { RunStateMachine, StepStateMachine } from "../stateMachine";
import { ToolRegistry, type ToolDefinition, type ToolContext } from "../toolRegistry";
import { ExecutionEngine, CancellationToken, CircuitBreaker } from "../executionEngine";
import { PolicyEngine } from "../policyEngine";
import { metricsCollector } from "../metricsCollector";

describe("Chaos Tests - Agent Infrastructure", () => {
  describe("State Machine Resilience", () => {
    it("should handle rapid state transitions without corruption", () => {
      for (let i = 0; i < 100; i++) {
        const m = new RunStateMachine(`run-${i}`);
        m.transition("planning");
        m.transition("running");
        expect(m.getStatus()).toBe("running");
      }
    });

    it("should reject invalid transitions under load", () => {
      for (let i = 0; i < 50; i++) {
        const machine = new RunStateMachine(`run-${i}`);
        expect(() => machine.transition("completed")).toThrow();
      }
    });

    it("should maintain history integrity through many transitions", () => {
      const machine = new RunStateMachine("stress-run");
      machine.transition("planning");
      machine.transition("running");
      machine.transition("paused");
      machine.transition("running");
      machine.transition("verifying");
      machine.transition("completed");
      
      const history = machine.getHistory();
      expect(history.length).toBe(7);
      expect(history[history.length - 1].to).toBe("completed");
    });

    it("should handle step state machine stress", () => {
      for (let i = 0; i < 100; i++) {
        const step = new StepStateMachine(`step-${i}`);
        step.transition("running");
        step.transition("succeeded");
        expect(step.getStatus()).toBe("succeeded");
        expect(step.isTerminal()).toBe(true);
      }
    });

    it("should correctly track retries in step state machine", () => {
      const step = new StepStateMachine("retry-step", "pending", 5);
      step.transition("running");
      
      for (let i = 0; i < 3; i++) {
        step.transition("failed");
        expect(step.canRetry()).toBe(true);
        step.transition("running");
      }
      
      expect(step.getRetryCount()).toBe(3);
    });
  });

  describe("Circuit Breaker Behavior", () => {
    it("should open after consecutive failures", () => {
      const breaker = new CircuitBreaker(5, 60000, 2);
      const toolName = "test-service";
      
      for (let i = 0; i < 5; i++) {
        breaker.recordFailure(toolName);
      }
      
      expect(breaker.canExecute(toolName)).toBe(false);
    });

    it("should recover after timeout", async () => {
      const breaker = new CircuitBreaker(5, 100, 2);
      const toolName = "recovery-service";
      
      for (let i = 0; i < 5; i++) {
        breaker.recordFailure(toolName);
      }
      
      expect(breaker.canExecute(toolName)).toBe(false);
      
      await new Promise(r => setTimeout(r, 150));
      
      expect(breaker.canExecute(toolName)).toBe(true);
    });

    it("should track multiple services independently", () => {
      const breaker = new CircuitBreaker(3, 60000, 2);
      
      for (let i = 0; i < 3; i++) {
        breaker.recordFailure("service-a");
      }
      
      expect(breaker.canExecute("service-a")).toBe(false);
      expect(breaker.canExecute("service-b")).toBe(true);
    });

    it("should transition through half-open state", async () => {
      const breaker = new CircuitBreaker(2, 50, 2);
      const toolName = "halfopen-service";
      
      breaker.recordFailure(toolName);
      breaker.recordFailure(toolName);
      expect(breaker.canExecute(toolName)).toBe(false);
      
      await new Promise(r => setTimeout(r, 60));
      
      expect(breaker.canExecute(toolName)).toBe(true);
      const status = breaker.getStatus(toolName);
      expect(status.state).toBe("half-open");
      
      breaker.recordSuccess(toolName);
      breaker.recordSuccess(toolName);
      
      const finalStatus = breaker.getStatus(toolName);
      expect(finalStatus.state).toBe("closed");
    });

    it("should reset to open if failure during half-open", async () => {
      const breaker = new CircuitBreaker(2, 50, 2);
      const toolName = "reopen-service";
      
      breaker.recordFailure(toolName);
      breaker.recordFailure(toolName);
      
      await new Promise(r => setTimeout(r, 60));
      breaker.canExecute(toolName);
      
      breaker.recordFailure(toolName);
      
      const status = breaker.getStatus(toolName);
      expect(status.state).toBe("open");
    });
  });

  describe("Cancellation Token Stress", () => {
    it("should handle multiple cancellations gracefully", async () => {
      const token = new CancellationToken();
      const promises = [];
      
      for (let i = 0; i < 10; i++) {
        promises.push(token.cancel("Test cancel"));
      }
      
      await Promise.all(promises);
      expect(token.isCancelled).toBe(true);
    });

    it("should maintain reason from first cancellation", async () => {
      const token = new CancellationToken();
      
      await token.cancel("First reason");
      await token.cancel("Second reason");
      
      expect(token.reason).toBe("First reason");
    });

    it("should throw when throwIfCancelled is called after cancellation", async () => {
      const token = new CancellationToken();
      await token.cancel("Test");
      
      expect(() => token.throwIfCancelled()).toThrow();
    });

    it("should trigger onCancelled callbacks", async () => {
      const token = new CancellationToken();
      let callbackCount = 0;
      
      for (let i = 0; i < 5; i++) {
        token.onCancelled(() => callbackCount++);
      }
      
      await token.cancel("Test");
      
      expect(callbackCount).toBe(5);
    });

    it("should call onCancelled immediately if already cancelled", async () => {
      const token = new CancellationToken();
      await token.cancel("Test");
      
      let called = false;
      token.onCancelled(() => { called = true; });
      
      expect(called).toBe(true);
    });
  });

  describe("Tool Registry Under Load", () => {
    let registry: ToolRegistry;

    beforeEach(() => {
      registry = new ToolRegistry();
    });

    it("should handle concurrent tool registrations", () => {
      for (let i = 0; i < 50; i++) {
        const tool: ToolDefinition = {
          name: `tool-${i}`,
          description: `Mock tool ${i}`,
          inputSchema: z.object({}),
          execute: async () => ({
            success: true,
            output: { id: i },
            artifacts: [],
            previews: [],
            logs: [],
          }),
        };
        registry.register(tool);
      }
      
      expect(registry.list().length).toBe(50);
    });

    it("should handle rapid get operations", () => {
      const tool: ToolDefinition = {
        name: "lookup-tool",
        description: "Tool for lookup test",
        inputSchema: z.object({}),
        execute: async () => ({
          success: true,
          output: null,
          artifacts: [],
          previews: [],
          logs: [],
        }),
      };
      registry.register(tool);
      
      for (let i = 0; i < 1000; i++) {
        const found = registry.get("lookup-tool");
        expect(found).toBeDefined();
        expect(found?.name).toBe("lookup-tool");
      }
    });

    it("should overwrite tools with same name", () => {
      const tool1: ToolDefinition = {
        name: "overwrite-tool",
        description: "Version 1",
        inputSchema: z.object({}),
        execute: async () => ({
          success: true,
          output: "v1",
          artifacts: [],
          previews: [],
          logs: [],
        }),
      };
      
      const tool2: ToolDefinition = {
        name: "overwrite-tool",
        description: "Version 2",
        inputSchema: z.object({}),
        execute: async () => ({
          success: true,
          output: "v2",
          artifacts: [],
          previews: [],
          logs: [],
        }),
      };
      
      registry.register(tool1);
      registry.register(tool2);
      
      const tool = registry.get("overwrite-tool");
      expect(tool?.description).toBe("Version 2");
    });

    it("should return undefined for non-existent tools", () => {
      for (let i = 0; i < 100; i++) {
        const tool = registry.get(`non-existent-tool-${i}`);
        expect(tool).toBeUndefined();
      }
    });
  });

  describe("Metrics Under High Volume", () => {
    beforeEach(() => {
      metricsCollector.clear();
    });

    it("should accurately track 1000+ events", () => {
      for (let i = 0; i < 1000; i++) {
        metricsCollector.record({
          toolName: "test-tool",
          latencyMs: i % 100,
          success: i % 2 === 0,
          timestamp: new Date(),
        });
      }
      
      const metrics = metricsCollector.exportMetrics();
      expect(metrics.aggregate.totalCalls).toBe(1000);
    });

    it("should calculate success rate correctly under high volume", () => {
      for (let i = 0; i < 1000; i++) {
        metricsCollector.record({
          toolName: "rate-tool",
          latencyMs: 50,
          success: i < 800,
          timestamp: new Date(),
        });
      }
      
      const successRate = metricsCollector.getSuccessRate("rate-tool");
      expect(successRate).toBe(80);
    });

    it("should track multiple tools independently", () => {
      for (let i = 0; i < 100; i++) {
        metricsCollector.record({
          toolName: "tool-a",
          latencyMs: 10,
          success: true,
          timestamp: new Date(),
        });
        metricsCollector.record({
          toolName: "tool-b",
          latencyMs: 20,
          success: false,
          timestamp: new Date(),
        });
      }
      
      const stats = metricsCollector.getToolStats();
      expect(stats["tool-a"].totalCalls).toBe(100);
      expect(stats["tool-a"].successRate).toBe(100);
      expect(stats["tool-b"].totalCalls).toBe(100);
      expect(stats["tool-b"].successRate).toBe(0);
    });

    it("should calculate P95 latency correctly", () => {
      for (let i = 1; i <= 100; i++) {
        metricsCollector.record({
          toolName: "latency-tool",
          latencyMs: i,
          success: true,
          timestamp: new Date(),
        });
      }
      
      const p95 = metricsCollector.getLatencyP95("latency-tool");
      expect(p95).toBeGreaterThanOrEqual(95);
    });
  });

  describe("Policy Engine Stress", () => {
    let policyEngine: PolicyEngine;

    beforeEach(() => {
      policyEngine = new PolicyEngine();
    });

    it("should handle rapid policy checks", () => {
      for (let i = 0; i < 500; i++) {
        const result = policyEngine.checkAccess({
          userId: `user-${i}`,
          userPlan: "free",
          toolName: "web_search",
        });
        expect(result.allowed).toBe(true);
      }
    });

    it("should enforce rate limits under load with incrementRateLimit", () => {
      const policy = {
        toolName: "rate-limited-tool",
        capabilities: [] as any[],
        allowedPlans: ["free", "pro", "admin"] as any[],
        requiresConfirmation: false,
        maxExecutionTimeMs: 30000,
        maxRetries: 3,
        rateLimit: {
          maxCalls: 5,
          windowMs: 60000,
        },
        deniedByDefault: false,
      };
      
      policyEngine.registerPolicy(policy);
      
      const context = {
        userId: "rate-test-user",
        userPlan: "free" as const,
        toolName: "rate-limited-tool",
      };
      
      for (let i = 0; i < 5; i++) {
        const result = policyEngine.checkAccess(context);
        expect(result.allowed).toBe(true);
        policyEngine.incrementRateLimit(context);
      }
      
      const result = policyEngine.checkAccess(context);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Rate limit exceeded");
    });

    it("should correctly filter tools by plan", () => {
      const freeTools = policyEngine.getToolsForPlan("free");
      const proTools = policyEngine.getToolsForPlan("pro");
      const adminTools = policyEngine.getToolsForPlan("admin");
      
      expect(proTools.length).toBeGreaterThanOrEqual(freeTools.length);
      expect(adminTools.length).toBeGreaterThanOrEqual(proTools.length);
    });

    it("should handle missing policy gracefully", () => {
      for (let i = 0; i < 100; i++) {
        const result = policyEngine.checkAccess({
          userId: "test-user",
          userPlan: "admin",
          toolName: `non-existent-tool-${i}`,
        });
        // Tools without an explicit policy are allowed by default
        expect(result.allowed).toBe(true);
        expect(result.reason).toContain("No explicit policy");
      }
    });
  });

  describe("Execution Engine Stress", () => {
    let engine: ExecutionEngine;

    beforeEach(() => {
      engine = new ExecutionEngine();
    });

    it("should handle rapid successful executions", async () => {
      const results = await Promise.all(
        Array.from({ length: 20 }, (_, i) => 
          engine.execute(
            `tool-${i}`,
            async () => ({ value: i }),
            { maxRetries: 0, timeoutMs: 1000 }
          )
        )
      );
      
      expect(results.every(r => r.success)).toBe(true);
    });

    it("should handle mixed success and failure", async () => {
      const results = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          engine.execute(
            `mixed-tool-${i}`,
            async () => {
              if (i % 2 === 0) throw new Error("Intentional failure");
              return { value: i };
            },
            { maxRetries: 0, timeoutMs: 1000 }
          )
        )
      );
      
      const successes = results.filter(r => r.success).length;
      const failures = results.filter(r => !r.success).length;
      
      expect(successes).toBe(5);
      expect(failures).toBe(5);
    });

    it("should respect timeout", async () => {
      const result = await engine.execute(
        "slow-tool",
        async () => {
          await new Promise(r => setTimeout(r, 500));
          return { done: true };
        },
        { maxRetries: 0, timeoutMs: 50 }
      );
      
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("timed out");
    });

    it("should retry on failure", async () => {
      let attempts = 0;
      
      const result = await engine.execute(
        "retry-tool-unique",
        async () => {
          attempts++;
          if (attempts < 3) throw new Error("temporarily unavailable - retry");
          return { attempts };
        },
        { maxRetries: 5, timeoutMs: 5000, baseDelayMs: 10, maxDelayMs: 50 }
      );
      
      expect(result.success).toBe(true);
      expect(result.data?.attempts).toBe(3);
      expect(result.metrics.attempts).toBe(3);
    });

    it("should track metrics correctly", async () => {
      const result = await engine.execute(
        "metrics-tool",
        async () => ({ done: true }),
        { maxRetries: 0, timeoutMs: 1000 }
      );
      
      expect(result.metrics).toBeDefined();
      expect(result.metrics.attempts).toBe(1);
      expect(result.metrics.totalDurationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Concurrent Operations", () => {
    it("should handle parallel state machine operations", () => {
      const machines = Array.from({ length: 50 }, (_, i) => 
        new RunStateMachine(`concurrent-${i}`)
      );
      
      machines.forEach(m => m.transition("planning"));
      machines.forEach(m => m.transition("running"));
      
      expect(machines.every(m => m.getStatus() === "running")).toBe(true);
    });

    it("should handle interleaved operations", async () => {
      const engine = new ExecutionEngine();
      const breaker = new CircuitBreaker(10, 60000, 2);
      
      const operations = Array.from({ length: 30 }, async (_, i) => {
        const toolName = `interleaved-${i % 5}`;
        
        if (breaker.canExecute(toolName)) {
          const result = await engine.execute(
            toolName,
            async () => ({ id: i }),
            { maxRetries: 0, timeoutMs: 100 }
          );
          
          if (result.success) {
            breaker.recordSuccess(toolName);
          } else {
            breaker.recordFailure(toolName);
          }
          
          return result;
        }
        
        return { success: false, skipped: true };
      });
      
      const results = await Promise.all(operations);
      expect(results.length).toBe(30);
    });
  });

  describe("Edge Cases and Boundary Conditions", () => {
    it("should handle empty tool names", () => {
      const registry = new ToolRegistry();
      expect(registry.get("")).toBeUndefined();
    });

    it("should handle very long tool names", () => {
      const registry = new ToolRegistry();
      const longName = "a".repeat(1000);
      
      const tool: ToolDefinition = {
        name: longName,
        description: "Long named tool",
        inputSchema: z.object({}),
        execute: async () => ({
          success: true,
          output: null,
          artifacts: [],
          previews: [],
          logs: [],
        }),
      };
      
      registry.register(tool);
      expect(registry.get(longName)).toBeDefined();
    });

    it("should handle special characters in tool names", () => {
      const registry = new ToolRegistry();
      const specialName = "tool-with_special.chars:123";
      
      const tool: ToolDefinition = {
        name: specialName,
        description: "Special chars tool",
        inputSchema: z.object({}),
        execute: async () => ({
          success: true,
          output: null,
          artifacts: [],
          previews: [],
          logs: [],
        }),
      };
      
      registry.register(tool);
      expect(registry.get(specialName)).toBeDefined();
    });

    it("should handle zero metrics", () => {
      const freshCollector = metricsCollector;
      freshCollector.clear();
      
      const p95 = freshCollector.getLatencyP95("non-existent");
      const successRate = freshCollector.getSuccessRate("non-existent");
      
      expect(p95).toBe(0);
      expect(successRate).toBe(0);
    });

    it("should handle step machine max retries boundary", () => {
      const step = new StepStateMachine("boundary-step", "pending", 0);
      step.transition("running");
      step.transition("failed");
      
      expect(step.canRetry()).toBe(false);
    });
  });
});
