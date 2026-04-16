import { describe, expect, it, vi, afterEach } from "vitest";
import { InMemoryClientErrorLogStore } from "../infrastructure/inMemoryClientErrorLogStore";
import { getClientErrorStats, getRecentClientErrors, logClientError } from "./clientErrorService";

describe("client error service", () => {
  afterEach(() => {
    vi.useRealTimers();
  });
  it("logs and queries recent + stats", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-18T00:00:00.000Z"));
    const store = new InMemoryClientErrorLogStore({ maxLogs: 5 });

    const logged = await logClientError(store, {
      errorId: "E_TEST",
      message: "Hello",
      url: "https://example.com/a?token=1",
      userAgent: "UA",
      componentName: "Widget",
      now: new Date("2026-02-18T00:00:00.000Z"),
    });

    expect(logged.ok).toBe(true);

    const recent = await getRecentClientErrors(store, { limit: 50 });
    expect(recent.total).toBe(1);
    expect(recent.errors[0]?.componentName).toBe("Widget");
    expect(recent.components).toContain("Widget");

    const stats = await getClientErrorStats(store);
    expect(stats.total).toBe(1);
    expect(stats.byComponent.Widget).toBe(1);
    expect(stats.healthScore).toBe(90);
  });

  it("supports component filters, max logs, and invalid payloads", async () => {
    const store = new InMemoryClientErrorLogStore({ maxLogs: 1 });

    await logClientError(store, {
      errorId: "E1",
      message: "One",
      url: "https://example.com/one",
      userAgent: "UA",
      componentName: "A",
      now: new Date("2026-02-18T00:00:00.000Z"),
    });

    await logClientError(store, {
      errorId: "E2",
      message: "Two",
      url: "https://example.com/two",
      userAgent: "UA",
      componentName: "B",
      now: new Date("2026-02-18T00:00:00.000Z"),
    });

    const all = await store.all();
    expect(all.length).toBe(1);
    expect(all[0]?.errorId).toBe("E2");

    const filtered = await getRecentClientErrors(store, { limit: 10, componentName: "B" });
    expect(filtered.errors.length).toBe(1);
    expect(filtered.errors[0]?.componentName).toBe("B");

    const invalid = await logClientError(store, {
      errorId: "E3",
      message: "Bad",
      url: "notaurl",
      userAgent: "UA",
    } as any);
    expect(invalid.ok).toBe(false);

    const emptyStore = new InMemoryClientErrorLogStore({ maxLogs: 10 });
    const emptyStats = await getClientErrorStats(emptyStore);
    expect(emptyStats.total).toBe(0);
    expect(emptyStats.healthScore).toBe(100);
  });

  it("covers health score branches and Unknown component bucketing", async () => {
    const store = new InMemoryClientErrorLogStore({ maxLogs: 500 });

    // 10 errors -> <20 => 75
    for (let i = 0; i < 10; i++) {
      await logClientError(store, {
        errorId: `E_${i}`,
        message: `M_${i}`,
        url: `https://example.com/${i}`,
        userAgent: "UA",
      });
    }
    let stats = await getClientErrorStats(store);
    expect(stats.healthScore).toBe(75);
    expect(stats.byComponent.Unknown).toBe(10);

    // 25 errors total -> <50 => 50
    for (let i = 10; i < 25; i++) {
      await logClientError(store, {
        errorId: `E_${i}`,
        message: `M_${i}`,
        url: `https://example.com/${i}`,
        userAgent: "UA",
      });
    }
    stats = await getClientErrorStats(store);
    expect(stats.healthScore).toBe(50);

    // 75 errors total -> <100 => 25
    for (let i = 25; i < 75; i++) {
      await logClientError(store, {
        errorId: `E_${i}`,
        message: `M_${i}`,
        url: `https://example.com/${i}`,
        userAgent: "UA",
      });
    }
    stats = await getClientErrorStats(store);
    expect(stats.healthScore).toBe(25);

    // 120 errors total -> >=100 => 10
    for (let i = 75; i < 120; i++) {
      await logClientError(store, {
        errorId: `E_${i}`,
        message: `M_${i}`,
        url: `https://example.com/${i}`,
        userAgent: "UA",
      });
    }
    stats = await getClientErrorStats(store);
    expect(stats.healthScore).toBe(10);

    // Component list excludes falsy names (filter(Boolean) branch)
    await logClientError(store, {
      errorId: "E_COMP",
      message: "With component",
      url: "https://example.com/comp",
      userAgent: "UA",
      componentName: "Widget",
    });
    const recent = await getRecentClientErrors(store, { limit: 0 });
    expect(recent.components).toContain("Widget");
  });
});
