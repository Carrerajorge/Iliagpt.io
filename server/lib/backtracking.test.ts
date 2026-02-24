import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock external dependencies
vi.mock("prom-client", () => {
  return {
    Counter: class { constructor() {} inc = vi.fn(); },
    Gauge: class { constructor() {} set = vi.fn(); },
    Registry: class { constructor() {} metrics = vi.fn().mockResolvedValue(""); },
  };
});

vi.mock("./structuredLogger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import {
  BacktrackingManager,
  getBacktrackingManager,
  removeBacktrackingManager,
  createCheckpoint,
  attemptBacktrack,
  detectFailure,
  createBacktrackingHooks,
  backtrackingEvents,
  type CheckpointState,
  type FailureInfo,
  type PlanSnapshot,
} from "./backtracking";

function makeState(overrides: Partial<CheckpointState> = {}): CheckpointState {
  return {
    context: {},
    partialOutputs: [],
    currentPlan: null,
    stepIndex: 0,
    artifacts: [],
    memory: {},
    ...overrides,
  };
}

function makePlan(overrides: Partial<PlanSnapshot> = {}): PlanSnapshot {
  return {
    objective: "Test objective",
    steps: [
      {
        index: 0,
        toolName: "web_search",
        description: "Search the web",
        input: { query: "test" },
        status: "completed",
      },
      {
        index: 1,
        toolName: "browse_url",
        description: "Browse a URL",
        input: { url: "https://example.com" },
        status: "pending",
      },
      {
        index: 2,
        toolName: "generate_document",
        description: "Generate doc",
        input: { template: "report" },
        status: "pending",
      },
    ],
    completedSteps: [0],
    failedSteps: [],
    ...overrides,
  };
}

describe("backtracking", () => {
  let manager: BacktrackingManager;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    manager = new BacktrackingManager("test-run-1");
  });

  afterEach(() => {
    manager.destroy();
    removeBacktrackingManager("test-run-1");
    vi.useRealTimers();
  });

  // ===== BacktrackingManager constructor =====

  describe("constructor", () => {
    it("should initialize with a runId", () => {
      expect(manager.runId).toBe("test-run-1");
    });

    it("should accept partial config overrides", () => {
      const custom = new BacktrackingManager("run-custom", {
        maxCheckpoints: 5,
        maxBacktrackAttempts: 1,
      });
      expect(custom.getRemainingAttempts()).toBe(1);
      custom.destroy();
    });
  });

  // ===== Checkpoint Management =====

  describe("createCheckpoint", () => {
    it("should create a checkpoint and return an id string", () => {
      const id = manager.createCheckpoint("step-0", makeState());
      expect(typeof id).toBe("string");
      expect(id).toMatch(/^chk_/);
    });

    it("should store the checkpoint retrievable by id", () => {
      const state = makeState({ stepIndex: 3 });
      const id = manager.createCheckpoint("step-3", state, {
        trigger: "step_complete",
        stepIndex: 3,
      });
      const checkpoint = manager.getCheckpoint(id);
      expect(checkpoint).not.toBeNull();
      expect(checkpoint?.name).toBe("step-3");
      expect(checkpoint?.state.stepIndex).toBe(3);
      expect(checkpoint?.isValid).toBe(true);
    });

    it("should deep-clone the state (no reference sharing)", () => {
      const state = makeState({ context: { key: "original" } });
      const id = manager.createCheckpoint("clone-test", state);
      state.context.key = "modified";
      const retrieved = manager.getCheckpoint(id);
      expect(retrieved?.state.context.key).toBe("original");
    });

    it("should evict oldest checkpoint when maxCheckpoints exceeded", () => {
      const m = new BacktrackingManager("evict-test", { maxCheckpoints: 2 });
      const id1 = m.createCheckpoint("cp1", makeState());
      m.createCheckpoint("cp2", makeState());
      m.createCheckpoint("cp3", makeState());
      // id1 should have been evicted
      expect(m.getCheckpoint(id1)).toBeNull();
      m.destroy();
    });

    it("should emit checkpoint_created event", () => {
      const listener = vi.fn();
      backtrackingEvents.on("checkpoint_created", listener);
      manager.createCheckpoint("event-test", makeState());
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0][0].name).toBe("event-test");
      backtrackingEvents.removeAllListeners("checkpoint_created");
    });
  });

  describe("getCheckpoint", () => {
    it("should return null for non-existent checkpoint", () => {
      expect(manager.getCheckpoint("non-existent-id")).toBeNull();
    });

    it("should return null for expired checkpoint", () => {
      const id = manager.createCheckpoint("expire-test", makeState());
      // Advance time past TTL (default 30 min)
      vi.advanceTimersByTime(31 * 60 * 1000);
      expect(manager.getCheckpoint(id)).toBeNull();
    });

    it("should return null for invalidated checkpoint", () => {
      const id = manager.createCheckpoint("invalid-test", makeState());
      manager.invalidateCheckpoint(id, "test-reason");
      expect(manager.getCheckpoint(id)).toBeNull();
    });
  });

  describe("getCheckpointHistory", () => {
    it("should return checkpoints sorted by creation time (newest first)", () => {
      manager.createCheckpoint("first", makeState());
      vi.advanceTimersByTime(100);
      manager.createCheckpoint("second", makeState());
      vi.advanceTimersByTime(100);
      manager.createCheckpoint("third", makeState());

      const history = manager.getCheckpointHistory();
      expect(history).toHaveLength(3);
      expect(history[0].name).toBe("third");
      expect(history[2].name).toBe("first");
    });
  });

  describe("getLastValidCheckpoint", () => {
    it("should return null when no checkpoints exist", () => {
      expect(manager.getLastValidCheckpoint()).toBeNull();
    });

    it("should return the most recent valid checkpoint", () => {
      manager.createCheckpoint("cp-a", makeState());
      vi.advanceTimersByTime(100);
      const id2 = manager.createCheckpoint("cp-b", makeState());

      const last = manager.getLastValidCheckpoint();
      expect(last).not.toBeNull();
      expect(last?.id).toBe(id2);
    });
  });

  describe("findCheckpointByStep", () => {
    it("should find the latest checkpoint before the given step", () => {
      manager.createCheckpoint("at-step-1", makeState(), {
        trigger: "step_complete",
        stepIndex: 1,
      });
      vi.advanceTimersByTime(100);
      manager.createCheckpoint("at-step-3", makeState(), {
        trigger: "step_complete",
        stepIndex: 3,
      });

      const found = manager.findCheckpointByStep(4);
      expect(found).not.toBeNull();
      expect(found?.name).toBe("at-step-3");
    });

    it("should return null when no checkpoint exists before the step", () => {
      manager.createCheckpoint("at-step-5", makeState(), {
        trigger: "step_complete",
        stepIndex: 5,
      });
      expect(manager.findCheckpointByStep(3)).toBeNull();
    });
  });

  describe("findCheckpointByName", () => {
    it("should find checkpoint by exact name", () => {
      manager.createCheckpoint("named-cp", makeState());
      const found = manager.findCheckpointByName("named-cp");
      expect(found).not.toBeNull();
      expect(found?.name).toBe("named-cp");
    });

    it("should return null for non-matching name", () => {
      manager.createCheckpoint("actual-name", makeState());
      expect(manager.findCheckpointByName("wrong-name")).toBeNull();
    });
  });

  describe("invalidateCheckpointsAfter", () => {
    it("should invalidate checkpoints after a given step index", () => {
      const id1 = manager.createCheckpoint("step-1", makeState(), {
        trigger: "step_complete",
        stepIndex: 1,
      });
      const id2 = manager.createCheckpoint("step-3", makeState(), {
        trigger: "step_complete",
        stepIndex: 3,
      });
      const id3 = manager.createCheckpoint("step-5", makeState(), {
        trigger: "step_complete",
        stepIndex: 5,
      });

      manager.invalidateCheckpointsAfter(2);

      expect(manager.getCheckpoint(id1)).not.toBeNull(); // step 1 < 2
      expect(manager.getCheckpoint(id2)).toBeNull(); // step 3 > 2 (invalidated)
      expect(manager.getCheckpoint(id3)).toBeNull(); // step 5 > 2 (invalidated)
    });
  });

  // ===== Backtracking =====

  describe("canBacktrack", () => {
    it("should return false when no checkpoints exist", () => {
      expect(manager.canBacktrack()).toBe(false);
    });

    it("should return true when a valid checkpoint exists", () => {
      manager.createCheckpoint("valid", makeState());
      expect(manager.canBacktrack()).toBe(true);
    });

    it("should return false when max attempts are exhausted", async () => {
      const m = new BacktrackingManager("exhaust-test", {
        maxBacktrackAttempts: 1,
      });
      const state = makeState({
        currentPlan: makePlan(),
        stepIndex: 0,
      });
      m.createCheckpoint("cp", state, {
        trigger: "step_complete",
        stepIndex: 0,
      });
      const failure: FailureInfo = {
        type: "execution_error",
        message: "fail",
        stepIndex: 1,
        timestamp: Date.now(),
      };
      await m.backtrack(failure);
      expect(m.canBacktrack()).toBe(false);
      m.destroy();
    });
  });

  describe("backtrack", () => {
    it("should fail when no valid checkpoint is available", async () => {
      const failure: FailureInfo = {
        type: "execution_error",
        message: "Error occurred",
        timestamp: Date.now(),
      };
      const result = await manager.backtrack(failure);
      expect(result.success).toBe(false);
      expect(result.error).toContain("No valid checkpoint");
    });

    it("should succeed when checkpoint and plan are available", async () => {
      const plan = makePlan();
      const state = makeState({ currentPlan: plan, stepIndex: 0 });
      manager.createCheckpoint("before-fail", state, {
        trigger: "step_complete",
        stepIndex: 0,
      });

      const failure: FailureInfo = {
        type: "execution_error",
        message: "Tool crashed",
        stepIndex: 1,
        toolName: "browse_url",
        timestamp: Date.now(),
      };
      const result = await manager.backtrack(failure);
      expect(result.success).toBe(true);
      expect(result.restoredCheckpoint).not.toBeNull();
      expect(result.failureAnalysis).not.toBeNull();
      expect(result.newPlan).not.toBeNull();
      expect(result.backtrackDepth).toBeGreaterThanOrEqual(0);
    });

    it("should fail replan when original plan is null", async () => {
      const state = makeState({ currentPlan: null, stepIndex: 0 });
      manager.createCheckpoint("no-plan", state, {
        trigger: "manual",
        stepIndex: 0,
      });

      const failure: FailureInfo = {
        type: "timeout",
        message: "Timed out",
        timestamp: Date.now(),
      };
      const result = await manager.backtrack(failure);
      expect(result.success).toBe(false);
      expect(result.error).toContain("Failed to generate alternative plan");
    });
  });

  // ===== Stats =====

  describe("getStats", () => {
    it("should return initial stats with all zeroes", () => {
      const stats = manager.getStats();
      expect(stats.checkpointCount).toBe(0);
      expect(stats.backtrackAttempts).toBe(0);
      expect(stats.successfulBacktracks).toBe(0);
      expect(stats.failureHistory).toHaveLength(0);
      expect(stats.avoidanceConstraints).toHaveLength(0);
      expect(stats.avgBacktrackDepth).toBe(0);
    });
  });

  describe("getRemainingAttempts", () => {
    it("should return max attempts initially", () => {
      expect(manager.getRemainingAttempts()).toBe(3); // default
    });
  });

  // ===== destroy =====

  describe("destroy", () => {
    it("should clear all state on destroy", () => {
      manager.createCheckpoint("cp", makeState());
      manager.destroy();
      expect(manager.getStats().checkpointCount).toBe(0);
    });
  });

  // ===== Global Registry =====

  describe("getBacktrackingManager", () => {
    it("should return the same manager for the same runId", () => {
      const m1 = getBacktrackingManager("shared-run");
      const m2 = getBacktrackingManager("shared-run");
      expect(m1).toBe(m2);
      removeBacktrackingManager("shared-run");
    });

    it("should return different managers for different runIds", () => {
      const m1 = getBacktrackingManager("run-a");
      const m2 = getBacktrackingManager("run-b");
      expect(m1).not.toBe(m2);
      removeBacktrackingManager("run-a");
      removeBacktrackingManager("run-b");
    });
  });

  describe("removeBacktrackingManager", () => {
    it("should remove and destroy the manager", () => {
      const m = getBacktrackingManager("removable-run");
      m.createCheckpoint("cp", makeState());
      removeBacktrackingManager("removable-run");
      // Getting again should yield a fresh manager
      const fresh = getBacktrackingManager("removable-run");
      expect(fresh.getStats().checkpointCount).toBe(0);
      removeBacktrackingManager("removable-run");
    });

    it("should be safe to call for non-existent runId", () => {
      expect(() => removeBacktrackingManager("does-not-exist")).not.toThrow();
    });
  });

  // ===== Convenience Functions =====

  describe("createCheckpoint (convenience)", () => {
    it("should create checkpoint via global registry", () => {
      const id = createCheckpoint("conv-run", "step-0", makeState());
      expect(typeof id).toBe("string");
      expect(id).toMatch(/^chk_/);
      removeBacktrackingManager("conv-run");
    });
  });

  describe("attemptBacktrack (convenience)", () => {
    it("should return failure when no checkpoints exist", async () => {
      const result = await attemptBacktrack("empty-run", {
        type: "execution_error",
        message: "fail",
        timestamp: Date.now(),
      });
      expect(result.success).toBe(false);
      removeBacktrackingManager("empty-run");
    });
  });

  // ===== detectFailure =====

  describe("detectFailure", () => {
    it("should return timeout failure when timeout option is true", () => {
      const failure = detectFailure({}, { timeout: true });
      expect(failure).not.toBeNull();
      expect(failure?.type).toBe("timeout");
    });

    it("should return user_rejection when userRejected is true", () => {
      const failure = detectFailure({}, { userRejected: true });
      expect(failure).not.toBeNull();
      expect(failure?.type).toBe("user_rejection");
    });

    it("should return execution_error when result has error property", () => {
      const failure = detectFailure({
        error: new Error("Something broke"),
      });
      expect(failure).not.toBeNull();
      expect(failure?.type).toBe("execution_error");
      expect(failure?.message).toContain("Something broke");
    });

    it("should return low_confidence when confidence is below threshold", () => {
      const failure = detectFailure(
        { confidence: 0.2 },
        { confidenceThreshold: 0.5 }
      );
      expect(failure).not.toBeNull();
      expect(failure?.type).toBe("low_confidence");
    });

    it("should return validation_failure when type does not match expected", () => {
      const failure = detectFailure(
        { type: "text" },
        { expectedType: "json" }
      );
      expect(failure).not.toBeNull();
      expect(failure?.type).toBe("validation_failure");
      expect(failure?.context).toEqual({ expected: "json", actual: "text" });
    });

    it("should return null when no failure conditions are met", () => {
      const failure = detectFailure({ confidence: 0.9, type: "json" }, {
        confidenceThreshold: 0.4,
        expectedType: "json",
      });
      expect(failure).toBeNull();
    });

    it("should use default confidence threshold of 0.4", () => {
      const noFail = detectFailure({ confidence: 0.5 });
      expect(noFail).toBeNull();

      const fail = detectFailure({ confidence: 0.3 });
      expect(fail).not.toBeNull();
      expect(fail?.type).toBe("low_confidence");
    });
  });

  // ===== createBacktrackingHooks =====

  describe("createBacktrackingHooks", () => {
    it("should return hooks object with all four handlers", () => {
      const hooks = createBacktrackingHooks();
      expect(typeof hooks.onStepComplete).toBe("function");
      expect(typeof hooks.onToolSuccess).toBe("function");
      expect(typeof hooks.onVerification).toBe("function");
      expect(typeof hooks.onError).toBe("function");
    });

    it("onStepComplete should create checkpoint when auto-checkpoint is on", () => {
      const hooks = createBacktrackingHooks({
        autoCheckpointOnStepComplete: true,
      });
      hooks.onStepComplete("hooks-run-1", 2, makeState({ stepIndex: 2 }));
      const m = getBacktrackingManager("hooks-run-1");
      expect(m.getStats().checkpointCount).toBeGreaterThan(0);
      removeBacktrackingManager("hooks-run-1");
    });

    it("onVerification should create checkpoint only for high confidence", () => {
      const hooks = createBacktrackingHooks();
      hooks.onVerification("hooks-run-2", 0.9, makeState());
      const m = getBacktrackingManager("hooks-run-2");
      expect(m.getStats().checkpointCount).toBe(1);
      removeBacktrackingManager("hooks-run-2");
    });

    it("onVerification should NOT create checkpoint for low confidence", () => {
      const hooks = createBacktrackingHooks();
      hooks.onVerification("hooks-run-3", 0.3, makeState());
      const m = getBacktrackingManager("hooks-run-3");
      // The hook only creates checkpoint for confidence >= 0.8
      expect(m.getStats().checkpointCount).toBe(0);
      removeBacktrackingManager("hooks-run-3");
    });

    it("onError should return null when no backtrack is possible", async () => {
      const hooks = createBacktrackingHooks();
      const result = await hooks.onError(
        "hooks-run-4",
        new Error("test error")
      );
      expect(result).toBeNull();
      removeBacktrackingManager("hooks-run-4");
    });
  });
});
