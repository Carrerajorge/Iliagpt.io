/**
 * Tests for the in-memory settings service.
 * Each test resets the store so order doesn't matter.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  getSettings,
  updateSettings,
  __resetSettingsStore,
  SETTINGS_INTERNAL,
} from "../services/searchBrain/settingsService";

beforeEach(() => __resetSettingsStore());

describe("isValidEmail", () => {
  const fn = SETTINGS_INTERNAL.isValidEmail;
  it.each([
    ["user@example.com", true],
    ["USER+tag@example.co.uk", true],
    ["no-at", false],
    ["", false],
    [" ", false],
    ["a".repeat(130) + "@x.com", false], // > 120 chars
  ])("isValidEmail(%s) === %s", (input, expected) => {
    expect(fn(input)).toBe(expected);
  });
});

describe("settings defaults", () => {
  it("getSettings returns defaults for unknown user", () => {
    const s = getSettings("u1");
    expect(s.enableScrapingProviders).toBe(false);
    expect(s.mailto).toBeUndefined();
    expect(s.coreApiKey).toBeUndefined();
  });

  it("getSettings returns defaults when userId undefined", () => {
    expect(getSettings(undefined).enableScrapingProviders).toBe(false);
  });
});

describe("updateSettings", () => {
  it("accepts valid mailto + toggles scraping", () => {
    const r = updateSettings("u1", {
      mailto: "dev@example.com",
      enableScrapingProviders: true,
    });
    expect(r.ok).toBe(true);
    expect(r.settings.mailto).toBe("dev@example.com");
    expect(r.settings.enableScrapingProviders).toBe(true);
    const after = getSettings("u1");
    expect(after.mailto).toBe("dev@example.com");
    expect(after.enableScrapingProviders).toBe(true);
  });

  it("rejects malformed email", () => {
    const r = updateSettings("u1", { mailto: "not-email" });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toContain("mailto");
  });

  it("accepts valid CORE key", () => {
    const r = updateSettings("u1", { coreApiKey: "abc123DEF_-xyz" });
    expect(r.ok).toBe(true);
    expect(r.settings.coreApiKey).toBe("abc123DEF_-xyz");
  });

  it("rejects malformed CORE key (spaces, too short)", () => {
    expect(updateSettings("u1", { coreApiKey: "abc 123" }).ok).toBe(false);
    expect(updateSettings("u1", { coreApiKey: "short" }).ok).toBe(false);
  });

  it("null clears the field", () => {
    updateSettings("u1", { mailto: "dev@example.com", coreApiKey: "abc123XYZ_-t" });
    const r = updateSettings("u1", { mailto: null, coreApiKey: null });
    expect(r.ok).toBe(true);
    expect(r.settings.mailto).toBeUndefined();
    expect(r.settings.coreApiKey).toBeUndefined();
  });

  it("rejects non-boolean enableScrapingProviders", () => {
    const r = updateSettings("u1", { enableScrapingProviders: "yes" });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toContain("enableScrapingProviders");
  });

  it("does not persist when validation fails (preserves previous state)", () => {
    updateSettings("u1", { mailto: "dev@example.com" });
    updateSettings("u1", { mailto: "invalid" }); // should NOT persist
    expect(getSettings("u1").mailto).toBe("dev@example.com");
  });

  it("no-op when userId is missing (defaults still returned)", () => {
    const r = updateSettings(undefined, { mailto: "dev@example.com" });
    // ok=true because validation passed; but no store write happens.
    expect(r.ok).toBe(true);
    expect(getSettings(undefined).mailto).toBeUndefined();
  });

  it("bumps updatedAt on each successful update", async () => {
    const r1 = updateSettings("u1", { enableScrapingProviders: true });
    await new Promise((r) => setTimeout(r, 2));
    const r2 = updateSettings("u1", { enableScrapingProviders: false });
    expect(r2.settings.updatedAt).toBeGreaterThan(r1.settings.updatedAt);
  });
});
