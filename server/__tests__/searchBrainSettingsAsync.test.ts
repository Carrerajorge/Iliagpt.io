/**
 * Tests for the async (DB-backed) settings path introduced in
 * Phase 1c-3a. Uses an injected in-memory SettingsStore so tests
 * run without Postgres.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getSettingsAsync,
  updateSettingsAsync,
  __resetSettingsStore,
  __resetDbSettingsStore,
  type SettingsStore,
  type UserSearchBrainSettings,
} from "../services/searchBrain/settingsService";

beforeEach(() => {
  __resetSettingsStore();
  __resetDbSettingsStore();
});

function makeFakeStore(): SettingsStore & { data: Map<string, UserSearchBrainSettings>; getCalls: number; upsertCalls: number } {
  const data = new Map<string, UserSearchBrainSettings>();
  const s = {
    data,
    getCalls: 0,
    upsertCalls: 0,
    async get(userId: string) {
      s.getCalls++;
      return data.get(userId) ?? null;
    },
    async upsert(userId: string, next: UserSearchBrainSettings) {
      s.upsertCalls++;
      data.set(userId, next);
    },
  };
  return s;
}

describe("getSettingsAsync", () => {
  it("returns defaults when user has no row anywhere", async () => {
    const store = makeFakeStore();
    const s = await getSettingsAsync("u1", { store });
    expect(s.enableScrapingProviders).toBe(false);
    expect(s.mailto).toBeUndefined();
    expect(store.getCalls).toBe(1);
  });

  it("returns DB row when present", async () => {
    const store = makeFakeStore();
    store.data.set("u1", {
      mailto: "dev@example.com",
      enableScrapingProviders: true,
      updatedAt: 123,
    });
    const s = await getSettingsAsync("u1", { store });
    expect(s.mailto).toBe("dev@example.com");
    expect(s.enableScrapingProviders).toBe(true);
  });

  it("falls back to defaults when DB store errors", async () => {
    const failing: SettingsStore = {
      get: vi.fn(async () => { throw new Error("db down"); }),
      upsert: vi.fn(async () => {}),
    };
    const s = await getSettingsAsync("u1", { store: failing });
    expect(s).toMatchObject({ enableScrapingProviders: false });
  });

  it("returns defaults when userId undefined", async () => {
    const store = makeFakeStore();
    const s = await getSettingsAsync(undefined, { store });
    expect(s.enableScrapingProviders).toBe(false);
    expect(store.getCalls).toBe(0);
  });
});

describe("updateSettingsAsync", () => {
  it("persists via the injected store", async () => {
    const store = makeFakeStore();
    const r = await updateSettingsAsync(
      "u1",
      { mailto: "x@example.com", enableScrapingProviders: true },
      { store },
    );
    expect(r.ok).toBe(true);
    expect(store.upsertCalls).toBe(1);
    expect(store.data.get("u1")).toMatchObject({ mailto: "x@example.com", enableScrapingProviders: true });
    // Subsequent read comes from the store (DB-backed).
    const after = await getSettingsAsync("u1", { store });
    expect(after.mailto).toBe("x@example.com");
  });

  it("rejects malformed patch and does not persist", async () => {
    const store = makeFakeStore();
    const r = await updateSettingsAsync("u1", { mailto: "not-email" }, { store });
    expect(r.ok).toBe(false);
    expect(store.upsertCalls).toBe(0);
  });

  it("swallows DB write failures but keeps ok=true (in-memory still reflects)", async () => {
    const failing: SettingsStore = {
      get: vi.fn(async () => null),
      upsert: vi.fn(async () => { throw new Error("upsert fail"); }),
    };
    const r = await updateSettingsAsync(
      "u1",
      { mailto: "ok@example.com" },
      { store: failing },
    );
    expect(r.ok).toBe(true);
    expect(r.settings.mailto).toBe("ok@example.com");
  });

  it("without userId: no-op on DB but ok=true on validation", async () => {
    const store = makeFakeStore();
    const r = await updateSettingsAsync(undefined, { mailto: "a@b.c" }, { store });
    expect(r.ok).toBe(true);
    expect(store.upsertCalls).toBe(0);
  });

  it("coreApiKey null clears previous value", async () => {
    const store = makeFakeStore();
    await updateSettingsAsync("u1", { coreApiKey: "abcDEF1234-_" }, { store });
    const mid = store.data.get("u1")!;
    expect(mid.coreApiKey).toBe("abcDEF1234-_");
    await updateSettingsAsync("u1", { coreApiKey: null }, { store });
    const after = store.data.get("u1")!;
    expect(after.coreApiKey).toBeUndefined();
  });
});
