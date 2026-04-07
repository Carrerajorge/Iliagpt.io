import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — must be declared before importing the module under test
// ---------------------------------------------------------------------------

const mockLlmChat = vi.fn();

vi.mock("../lib/llmGateway", () => ({
  llmGateway: {
    chat: (...args: unknown[]) => mockLlmChat(...args),
    streamChat: vi.fn(),
  },
}));

vi.mock("../utils/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import {
  planModeService,
  approvePlan,
  rejectPlan,
  getPlan,
  type AgentPlan,
  type PlanStep,
} from "../agent/planMode";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLlmPlanResponse(plan: {
  title?: string;
  steps: Array<{ title?: string; description: string; toolsRequired?: string[] }>;
  estimatedDurationSec?: number;
}) {
  return {
    content: JSON.stringify(plan),
    usage: { promptTokens: 100, completionTokens: 200, totalTokens: 300 },
    requestId: "test-req",
    latencyMs: 150,
    model: "gpt-4o",
    provider: "openai",
  };
}

async function generateTestPlan(
  overrides?: Partial<Parameters<typeof planModeService.generatePlan>[0]>,
): Promise<AgentPlan> {
  mockLlmChat.mockResolvedValueOnce(
    makeLlmPlanResponse({
      title: "Test Plan",
      steps: [
        { title: "Step 1", description: "Research the topic", toolsRequired: ["web_search"] },
        { title: "Step 2", description: "Write the code", toolsRequired: ["code_gen"] },
        { title: "Step 3", description: "Review and test" },
      ],
      estimatedDurationSec: 120,
    }),
  );

  return planModeService.generatePlan({
    userMessage: "Build a REST API for user management",
    chatId: "chat-1",
    userId: "user-1",
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PlanModeService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 1. Plan generation creates a plan with correct structure
  describe("generatePlan", () => {
    it("creates a plan with correct structure from LLM response", async () => {
      const plan = await generateTestPlan();

      expect(plan.id).toMatch(/^plan_/);
      expect(plan.title).toBe("Test Plan");
      expect(plan.query).toBe("Build a REST API for user management");
      expect(plan.chatId).toBe("chat-1");
      expect(plan.userId).toBe("user-1");
      expect(plan.status).toBe("draft");
      expect(plan.steps).toHaveLength(3);
      expect(plan.totalSteps).toBe(3);
      expect(plan.completedSteps).toBe(0);
      expect(plan.currentStepIndex).toBe(0);
      expect(plan.estimatedDurationSec).toBe(120);
      expect(plan.createdAt).toBeDefined();
    });

    // 2. Each step has correct default status and IDs
    it("assigns unique IDs and pending status to each step", async () => {
      const plan = await generateTestPlan();

      const ids = new Set(plan.steps.map((s) => s.id));
      expect(ids.size).toBe(3); // all unique

      for (const step of plan.steps) {
        expect(step.id).toMatch(/^step_/);
        expect(step.status).toBe("pending");
        expect(step.index).toBeGreaterThanOrEqual(0);
      }

      expect(plan.steps[0].index).toBe(0);
      expect(plan.steps[1].index).toBe(1);
      expect(plan.steps[2].index).toBe(2);
    });

    // 3. Fallback when LLM returns invalid JSON
    it("creates a single-step fallback plan when LLM returns invalid JSON", async () => {
      mockLlmChat.mockResolvedValueOnce({
        content: "Sorry, I cannot create a plan right now.",
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        requestId: "req-bad",
        latencyMs: 50,
        model: "gpt-4o",
        provider: "openai",
      });

      const plan = await planModeService.generatePlan({
        userMessage: "Do something complex",
        chatId: "chat-2",
        userId: "user-2",
      });

      expect(plan.steps).toHaveLength(1);
      expect(plan.title).toBe("Execution Plan");
      expect(plan.steps[0].description).toBe("Do something complex");
    });

    // 4. Plan is stored and retrievable
    it("stores the plan and makes it retrievable via getPlan", async () => {
      const plan = await generateTestPlan();

      const retrieved = getPlan(plan.id);
      expect(retrieved).toBeDefined();
      expect(retrieved!.id).toBe(plan.id);
      expect(retrieved!.title).toBe("Test Plan");
    });
  });

  // 5. Plan approval transitions status correctly
  describe("approvePlan", () => {
    it("transitions a draft plan to approved status", async () => {
      const plan = await generateTestPlan();
      expect(plan.status).toBe("draft");

      const approved = approvePlan(plan.id);
      expect(approved).toBeDefined();
      expect(approved!.status).toBe("approved");
      expect(approved!.approvedAt).toBeDefined();
      expect(approved!.approvedAt).toBeGreaterThan(0);
    });

    it("returns undefined for a non-existent plan", () => {
      const result = approvePlan("plan_does_not_exist");
      expect(result).toBeUndefined();
    });

    it("returns the plan unchanged if already in a terminal state", async () => {
      const plan = await generateTestPlan();
      rejectPlan(plan.id); // move to rejected

      const result = approvePlan(plan.id);
      expect(result).toBeDefined();
      expect(result!.status).toBe("rejected"); // unchanged
    });
  });

  // 6. Plan rejection
  describe("rejectPlan", () => {
    it("transitions a plan to rejected status", async () => {
      const plan = await generateTestPlan();

      const rejected = rejectPlan(plan.id);
      expect(rejected).toBeDefined();
      expect(rejected!.status).toBe("rejected");
    });

    it("returns undefined for a non-existent plan", () => {
      const result = rejectPlan("plan_nonexistent");
      expect(result).toBeUndefined();
    });
  });

  // 7. Plan modification
  describe("modifyPlan", () => {
    it("modifies step descriptions and approves the plan", async () => {
      const plan = await generateTestPlan();

      const modified = planModeService.modifyPlan(plan.id, [
        { stepIndex: 1, newDescription: "Write the code using TypeScript" },
      ]);

      expect(modified.steps[1].description).toBe("Write the code using TypeScript");
      expect(modified.status).toBe("approved");
    });

    it("throws for non-existent plan", () => {
      expect(() =>
        planModeService.modifyPlan("plan_fake", [{ stepIndex: 0, newDescription: "x" }]),
      ).toThrow("Plan not found");
    });

    it("throws for invalid step index", async () => {
      const plan = await generateTestPlan();

      expect(() =>
        planModeService.modifyPlan(plan.id, [{ stepIndex: 99, newDescription: "x" }]),
      ).toThrow("Invalid step index");
    });

    it("throws when plan is in a non-modifiable state", async () => {
      const plan = await generateTestPlan();
      approvePlan(plan.id);

      // Now execute it to move to "executing" state
      // Instead, just set up a second plan and reject it
      const plan2 = await generateTestPlan({ chatId: "chat-mod", userId: "user-mod" });
      rejectPlan(plan2.id);

      expect(() =>
        planModeService.modifyPlan(plan2.id, [{ stepIndex: 0, newDescription: "x" }]),
      ).toThrow("Cannot modify plan in status");
    });
  });

  // 8. Plan execution yields step updates
  describe("executePlan", () => {
    it("executes all steps and yields progress updates", async () => {
      const plan = await generateTestPlan();
      approvePlan(plan.id);

      // Mock LLM responses for each step execution
      mockLlmChat
        .mockResolvedValueOnce({
          content: "Research complete",
          usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
          requestId: "step-1",
          latencyMs: 100,
          model: "gpt-4o",
          provider: "openai",
        })
        .mockResolvedValueOnce({
          content: "Code written",
          usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
          requestId: "step-2",
          latencyMs: 150,
          model: "gpt-4o",
          provider: "openai",
        })
        .mockResolvedValueOnce({
          content: "Tests passing",
          usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
          requestId: "step-3",
          latencyMs: 80,
          model: "gpt-4o",
          provider: "openai",
        });

      const updates = [];
      for await (const update of planModeService.executePlan(plan.id)) {
        updates.push(update);
      }

      // 3 steps => 3 step_start + 3 step_complete + 1 plan_complete = 7 updates
      expect(updates).toHaveLength(7);

      const types = updates.map((u) => u.type);
      expect(types).toEqual([
        "step_start",
        "step_complete",
        "step_start",
        "step_complete",
        "step_start",
        "step_complete",
        "plan_complete",
      ]);

      // Final update should be plan_complete with completed status
      const finalUpdate = updates[updates.length - 1];
      expect(finalUpdate.plan.status).toBe("completed");
      expect(finalUpdate.plan.completedSteps).toBe(3);
    });

    it("throws if plan is not approved", async () => {
      const plan = await generateTestPlan();
      // Plan is in "draft" status, not "approved"

      await expect(async () => {
        for await (const _update of planModeService.executePlan(plan.id)) {
          // consume
        }
      }).rejects.toThrow("Plan must be approved before execution");
    });

    it("marks remaining steps as skipped when a step fails", async () => {
      const plan = await generateTestPlan();
      approvePlan(plan.id);

      // First step succeeds, second step fails
      mockLlmChat
        .mockResolvedValueOnce({
          content: "Step 1 done",
          usage: { promptTokens: 5, completionTokens: 10, totalTokens: 15 },
          requestId: "s1",
          latencyMs: 50,
          model: "gpt-4o",
          provider: "openai",
        })
        .mockRejectedValueOnce(new Error("LLM service unavailable"));

      const updates = [];
      for await (const update of planModeService.executePlan(plan.id)) {
        updates.push(update);
      }

      // step_start(1), step_complete(1), step_start(2), step_failed(2) = 4 updates
      expect(updates).toHaveLength(4);

      const failedUpdate = updates[updates.length - 1];
      expect(failedUpdate.type).toBe("step_failed");
      expect(failedUpdate.step.status).toBe("failed");
      expect(failedUpdate.step.error).toBe("LLM service unavailable");

      // After generator completes, the actual plan should be in failed state
      const finalPlan = getPlan(plan.id);
      expect(finalPlan!.status).toBe("failed");

      // Step 3 (index 2) should be skipped
      expect(finalPlan!.steps[2].status).toBe("skipped");
    });

    it("throws for a non-existent plan", async () => {
      await expect(async () => {
        for await (const _update of planModeService.executePlan("plan_fake")) {
          // consume
        }
      }).rejects.toThrow("Plan not found");
    });
  });

  // 9. Active plans filtering
  describe("getActivePlans", () => {
    it("returns only non-terminal plans for a user", async () => {
      const plan1 = await generateTestPlan({ userId: "active-user" });
      const plan2 = await generateTestPlan({ userId: "active-user", chatId: "chat-2" });
      const plan3 = await generateTestPlan({ userId: "active-user", chatId: "chat-3" });

      rejectPlan(plan3.id); // terminal state

      const active = planModeService.getActivePlans("active-user");
      const activeIds = active.map((p) => p.id);

      expect(activeIds).toContain(plan1.id);
      expect(activeIds).toContain(plan2.id);
      expect(activeIds).not.toContain(plan3.id);
    });

    it("returns empty array for unknown user", () => {
      const active = planModeService.getActivePlans("unknown-user-xyz");
      expect(active).toEqual([]);
    });
  });

  // 10. Conversation history is forwarded to LLM
  describe("conversationHistory", () => {
    it("includes recent conversation history in LLM call", async () => {
      mockLlmChat.mockResolvedValueOnce(
        makeLlmPlanResponse({
          title: "History Plan",
          steps: [{ description: "Do work" }],
        }),
      );

      await planModeService.generatePlan({
        userMessage: "Continue the project",
        chatId: "chat-hist",
        userId: "user-hist",
        conversationHistory: [
          { role: "user", content: "I started a new project yesterday" },
          { role: "assistant", content: "Great, what would you like to do next?" },
        ],
      });

      expect(mockLlmChat).toHaveBeenCalledOnce();
      const messages = mockLlmChat.mock.calls[0][0];

      // Should include: system + 2 history messages + 1 user message = 4
      expect(messages).toHaveLength(4);
      expect(messages[1].content).toBe("I started a new project yesterday");
      expect(messages[2].content).toBe("Great, what would you like to do next?");
      expect(messages[3].content).toBe("Continue the project");
    });
  });
});
