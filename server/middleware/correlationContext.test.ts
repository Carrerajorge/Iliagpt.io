import { describe, it, expect, beforeEach } from "vitest";
import {
  getContext,
  getTraceId,
  getUserId,
  getCorrelationIds,
  setContext,
  runWithContext,
  updateContext,
  type CorrelationContext,
} from "./correlationContext";

describe("correlationContext", () => {
  // Helper to build a minimal context
  function makeContext(overrides: Partial<CorrelationContext> = {}): CorrelationContext {
    return {
      traceId: "trace-abc-123",
      startTime: Date.now(),
      ...overrides,
    };
  }

  // ── getContext ──────────────────────────────────────────────────────

  it("returns undefined when called outside a context", () => {
    expect(getContext()).toBeUndefined();
  });

  it("returns the active context inside runWithContext", () => {
    const ctx = makeContext({ userId: "u1" });
    runWithContext(ctx, () => {
      expect(getContext()).toBe(ctx);
    });
  });

  // ── getTraceId ─────────────────────────────────────────────────────

  it("returns undefined for traceId outside a context", () => {
    expect(getTraceId()).toBeUndefined();
  });

  it("returns the traceId inside a context", () => {
    runWithContext(makeContext({ traceId: "t-42" }), () => {
      expect(getTraceId()).toBe("t-42");
    });
  });

  // ── getUserId ──────────────────────────────────────────────────────

  it("returns undefined for userId when not set", () => {
    runWithContext(makeContext(), () => {
      expect(getUserId()).toBeUndefined();
    });
  });

  it("returns the userId when set", () => {
    runWithContext(makeContext({ userId: "user-99" }), () => {
      expect(getUserId()).toBe("user-99");
    });
  });

  // ── getCorrelationIds ──────────────────────────────────────────────

  it("returns { traceId: 'unknown' } outside a context", () => {
    const ids = getCorrelationIds();
    expect(ids).toEqual({ traceId: "unknown" });
  });

  it("falls back requestId to traceId when requestId is absent", () => {
    runWithContext(makeContext({ traceId: "t-100" }), () => {
      const ids = getCorrelationIds();
      expect(ids.requestId).toBe("t-100");
    });
  });

  it("uses explicit requestId when provided", () => {
    runWithContext(makeContext({ traceId: "t-100", requestId: "r-200" }), () => {
      const ids = getCorrelationIds();
      expect(ids.requestId).toBe("r-200");
    });
  });

  it("includes all optional fields in correlation ids", () => {
    const ctx = makeContext({
      traceId: "t-1",
      requestId: "r-1",
      userId: "u-1",
      workspaceId: "w-1",
      conversationId: "c-1",
      runId: "run-1",
    });
    runWithContext(ctx, () => {
      const ids = getCorrelationIds();
      expect(ids).toEqual({
        traceId: "t-1",
        requestId: "r-1",
        userId: "u-1",
        workspaceId: "w-1",
        conversationId: "c-1",
        runId: "run-1",
      });
    });
  });

  // ── setContext ──────────────────────────────────────────────────────

  it("does nothing when called outside a context (no throw)", () => {
    // Should not throw even without an active store
    expect(() => setContext(makeContext())).not.toThrow();
  });

  it("replaces the active context fields", () => {
    runWithContext(makeContext({ traceId: "old" }), () => {
      setContext(makeContext({ traceId: "new", userId: "u-new" }));
      expect(getTraceId()).toBe("new");
      expect(getUserId()).toBe("u-new");
    });
  });

  // ── updateContext ──────────────────────────────────────────────────

  it("does nothing when called outside a context (no throw)", () => {
    expect(() => updateContext({ userId: "u-x" })).not.toThrow();
  });

  it("merges partial updates into the active context", () => {
    runWithContext(makeContext({ traceId: "t-5", userId: "u-5" }), () => {
      updateContext({ workspaceId: "ws-1" });
      const ctx = getContext();
      expect(ctx?.workspaceId).toBe("ws-1");
      // Original fields remain
      expect(ctx?.traceId).toBe("t-5");
      expect(ctx?.userId).toBe("u-5");
    });
  });

  // ── runWithContext ─────────────────────────────────────────────────

  it("returns the value produced by the callback", () => {
    const result = runWithContext(makeContext(), () => 42);
    expect(result).toBe(42);
  });

  it("isolates nested contexts", () => {
    runWithContext(makeContext({ traceId: "outer" }), () => {
      runWithContext(makeContext({ traceId: "inner" }), () => {
        expect(getTraceId()).toBe("inner");
      });
      // After the inner run completes, outer context is restored
      expect(getTraceId()).toBe("outer");
    });
  });

  it("context is unavailable after runWithContext completes", () => {
    runWithContext(makeContext({ traceId: "ephemeral" }), () => {
      // Inside
      expect(getTraceId()).toBe("ephemeral");
    });
    // Outside
    expect(getTraceId()).toBeUndefined();
  });
});
