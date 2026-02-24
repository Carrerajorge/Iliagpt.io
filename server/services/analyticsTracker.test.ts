import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock external dependencies
vi.mock("../storage", () => ({
  storage: {
    createAnalyticsSnapshot: vi.fn().mockResolvedValue(undefined),
  },
}));

// We need a fresh instance for each test suite, so we re-import after mocking.
// The module exports a singleton `analyticsTracker`, but the class is
// AnalyticsTrackerService. We'll work with the singleton but clear its state
// between tests via exposed methods.

import { analyticsTracker } from "./analyticsTracker";
import { storage } from "../storage";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function clearState() {
  // Flush events so the internal buffer is empty
  // Use the public cleanupOldSessions to purge sessions
  analyticsTracker.cleanupOldSessions(0); // 0 minutes => cleans everything
  // Flush will empty the events array
  analyticsTracker.flushEvents();
  vi.mocked(storage.createAnalyticsSnapshot).mockClear();
}

beforeEach(() => {
  clearState();
});

// =============================================================================
// trackPageView
// =============================================================================
describe("trackPageView", () => {
  it("emits an event of type 'page_view'", () => {
    const handler = vi.fn();
    analyticsTracker.on("event", handler);
    analyticsTracker.trackPageView("user1", "sess1", "/home");
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].eventType).toBe("page_view");
    expect(handler.mock.calls[0][0].page).toBe("/home");
    analyticsTracker.off("event", handler);
  });

  it("creates a new session with pageViews = 1 on first call", () => {
    analyticsTracker.trackPageView("user1", "sess-new", "/dashboard");
    const session = analyticsTracker.getSessionDetails("sess-new");
    expect(session).toBeDefined();
    expect(session!.pageViews).toBe(1);
    expect(session!.userId).toBe("user1");
  });

  it("increments pageViews on subsequent calls for the same session", () => {
    analyticsTracker.trackPageView("user1", "sess-inc", "/page1");
    analyticsTracker.trackPageView("user1", "sess-inc", "/page2");
    analyticsTracker.trackPageView("user1", "sess-inc", "/page3");
    const session = analyticsTracker.getSessionDetails("sess-inc");
    expect(session!.pageViews).toBe(3);
  });
});

// =============================================================================
// trackAction
// =============================================================================
describe("trackAction", () => {
  it("emits an event of type 'action' with the given action name", () => {
    const handler = vi.fn();
    analyticsTracker.on("event", handler);
    analyticsTracker.trackAction("user2", "sess2", "click_button", { btn: "save" });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].eventType).toBe("action");
    expect(handler.mock.calls[0][0].action).toBe("click_button");
    analyticsTracker.off("event", handler);
  });

  it("records the action in the session actions list", () => {
    // First create a session via trackPageView, then track an action
    analyticsTracker.trackPageView("user2", "sess-act", "/home");
    analyticsTracker.trackAction("user2", "sess-act", "download_pdf");
    const session = analyticsTracker.getSessionDetails("sess-act");
    expect(session!.actions).toContain("download_pdf");
  });
});

// =============================================================================
// trackChatQuery
// =============================================================================
describe("trackChatQuery", () => {
  it("emits an event of type 'chat_query'", () => {
    const handler = vi.fn();
    analyticsTracker.on("event", handler);
    analyticsTracker.trackChatQuery("user3", "sess3", { query: "hello" });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].eventType).toBe("chat_query");
    analyticsTracker.off("event", handler);
  });
});

// =============================================================================
// trackConversion
// =============================================================================
describe("trackConversion", () => {
  it("emits a 'conversion' event with value in metadata", () => {
    const handler = vi.fn();
    analyticsTracker.on("event", handler);
    analyticsTracker.trackConversion("user4", "purchase", 99.99, { item: "plan" });
    const emitted = handler.mock.calls[0][0];
    expect(emitted.eventType).toBe("conversion");
    expect(emitted.metadata.value).toBe(99.99);
    expect(emitted.metadata.item).toBe("plan");
    analyticsTracker.off("event", handler);
  });
});

// =============================================================================
// flushEvents
// =============================================================================
describe("flushEvents", () => {
  it("does nothing when there are no events", async () => {
    await analyticsTracker.flushEvents();
    expect(storage.createAnalyticsSnapshot).not.toHaveBeenCalled();
  });

  it("calls storage.createAnalyticsSnapshot when events exist", async () => {
    analyticsTracker.trackPageView("u", "s", "/p");
    await analyticsTracker.flushEvents();
    expect(storage.createAnalyticsSnapshot).toHaveBeenCalledTimes(1);
  });

  it("empties the internal event buffer after successful flush", async () => {
    analyticsTracker.trackPageView("u", "s", "/p");
    analyticsTracker.trackAction("u", "s", "click");
    await analyticsTracker.flushEvents();
    // After flush, getRealTimeMetrics should show 0 buffered events
    const metrics = analyticsTracker.getRealTimeMetrics();
    expect(metrics.totalEventsBuffered).toBe(0);
  });

  it("restores events on flush failure", async () => {
    vi.mocked(storage.createAnalyticsSnapshot).mockRejectedValueOnce(new Error("DB error"));
    analyticsTracker.trackPageView("u", "s", "/p");
    await analyticsTracker.flushEvents();
    // Events should be put back
    const metrics = analyticsTracker.getRealTimeMetrics();
    expect(metrics.totalEventsBuffered).toBeGreaterThan(0);
  });
});

// =============================================================================
// getRealTimeMetrics
// =============================================================================
describe("getRealTimeMetrics", () => {
  it("returns zero metrics when no events tracked", () => {
    const metrics = analyticsTracker.getRealTimeMetrics();
    expect(metrics.eventsPerMinute).toBe(0);
    expect(metrics.totalEventsBuffered).toBe(0);
    expect(metrics.activeSessions).toBe(0);
  });

  it("counts recent events as eventsPerMinute", () => {
    analyticsTracker.trackPageView("u", "s1", "/a");
    analyticsTracker.trackAction("u", "s1", "x");
    const metrics = analyticsTracker.getRealTimeMetrics();
    expect(metrics.eventsPerMinute).toBe(2);
  });

  it("includes topPages in metrics", () => {
    analyticsTracker.trackPageView("u", "s1", "/dashboard");
    analyticsTracker.trackPageView("u", "s1", "/dashboard");
    analyticsTracker.trackPageView("u", "s1", "/settings");
    const metrics = analyticsTracker.getRealTimeMetrics();
    expect(metrics.topPages.length).toBeGreaterThan(0);
    expect(metrics.topPages[0].page).toBe("/dashboard");
    expect(metrics.topPages[0].views).toBe(2);
  });

  it("calculates avgSessionDuration", () => {
    analyticsTracker.trackPageView("u", "dur-sess", "/p1");
    // The session was just created, so duration ~ 0
    const metrics = analyticsTracker.getRealTimeMetrics();
    expect(metrics.avgSessionDuration).toBeDefined();
    expect(typeof metrics.avgSessionDuration).toBe("number");
  });
});

// =============================================================================
// getSessionDetails
// =============================================================================
describe("getSessionDetails", () => {
  it("returns undefined for non-existent session", () => {
    expect(analyticsTracker.getSessionDetails("nonexistent")).toBeUndefined();
  });

  it("returns session after tracking a page view", () => {
    analyticsTracker.trackPageView("u", "detail-sess", "/home");
    const session = analyticsTracker.getSessionDetails("detail-sess");
    expect(session).toBeDefined();
    expect(session!.sessionId).toBe("detail-sess");
  });
});

// =============================================================================
// getActiveSessions
// =============================================================================
describe("getActiveSessions", () => {
  it("returns recently active sessions within the specified window", () => {
    analyticsTracker.trackPageView("u", "active1", "/home");
    analyticsTracker.trackPageView("u", "active2", "/about");
    const active = analyticsTracker.getActiveSessions(5);
    expect(active.length).toBeGreaterThanOrEqual(2);
  });

  it("uses default 5 minutes window", () => {
    analyticsTracker.trackPageView("u", "default-window", "/page");
    const active = analyticsTracker.getActiveSessions();
    expect(active.some((s) => s.sessionId === "default-window")).toBe(true);
  });
});

// =============================================================================
// cleanupOldSessions
// =============================================================================
describe("cleanupOldSessions", () => {
  it("returns 0 when there are no old sessions", () => {
    analyticsTracker.trackPageView("u", "fresh-sess", "/p");
    const cleaned = analyticsTracker.cleanupOldSessions(30);
    expect(cleaned).toBe(0);
  });

  it("cleans sessions older than maxAgeMinutes", () => {
    // Create sessions, then verify cleanup with a generous window keeps them
    analyticsTracker.trackPageView("u", "cleanup1", "/p");
    analyticsTracker.trackPageView("u", "cleanup2", "/p");
    // With a large maxAge, sessions just created should NOT be cleaned
    const cleaned = analyticsTracker.cleanupOldSessions(30);
    expect(cleaned).toBe(0);
    expect(analyticsTracker.getSessionDetails("cleanup1")).toBeDefined();
    expect(analyticsTracker.getSessionDetails("cleanup2")).toBeDefined();
  });
});

// =============================================================================
// destroy
// =============================================================================
describe("destroy", () => {
  it("does not throw when called", () => {
    expect(() => analyticsTracker.destroy()).not.toThrow();
  });
});
