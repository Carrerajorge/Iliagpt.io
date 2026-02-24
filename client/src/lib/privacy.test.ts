import { describe, it, expect, beforeEach, vi } from "vitest";

// Need to reset module state between tests
describe("privacy settings", () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  it("has correct default settings", async () => {
    const mod = await import("./privacy");
    expect(mod.DEFAULT_PRIVACY_SETTINGS).toEqual({
      trainingOptIn: false,
      remoteBrowserDataAccess: false,
      analyticsTracking: true,
      chatHistoryEnabled: true,
    });
  });

  it("getPrivacySettingsSnapshot returns defaults when no storage", async () => {
    const mod = await import("./privacy");
    const settings = mod.getPrivacySettingsSnapshot();
    expect(settings.trainingOptIn).toBe(false);
    expect(settings.analyticsTracking).toBe(true);
  });

  it("setPrivacySettingsSnapshot updates and persists", async () => {
    const mod = await import("./privacy");
    const result = mod.setPrivacySettingsSnapshot({ trainingOptIn: true });
    expect(result.trainingOptIn).toBe(true);
    expect(result.analyticsTracking).toBe(true); // defaults preserved
    // Check localStorage
    const stored = JSON.parse(localStorage.getItem("ilia_privacy_settings_v1") || "{}");
    expect(stored.trainingOptIn).toBe(true);
  });

  it("setPrivacySettingsSnapshot(null) resets to defaults", async () => {
    const mod = await import("./privacy");
    mod.setPrivacySettingsSnapshot({ trainingOptIn: true });
    const result = mod.setPrivacySettingsSnapshot(null);
    expect(result).toEqual(mod.DEFAULT_PRIVACY_SETTINGS);
    expect(localStorage.getItem("ilia_privacy_settings_v1")).toBeNull();
  });

  it("clearPrivacySettingsSnapshot resets to defaults", async () => {
    const mod = await import("./privacy");
    mod.setPrivacySettingsSnapshot({ analyticsTracking: false });
    mod.clearPrivacySettingsSnapshot();
    const settings = mod.getPrivacySettingsSnapshot();
    expect(settings.analyticsTracking).toBe(true);
  });

  it("normalizes invalid stored data to defaults", async () => {
    localStorage.setItem(
      "ilia_privacy_settings_v1",
      JSON.stringify({ trainingOptIn: "not-a-boolean", unknownKey: 123 })
    );
    const mod = await import("./privacy");
    const settings = mod.getPrivacySettingsSnapshot();
    expect(settings.trainingOptIn).toBe(false); // default
    expect((settings as any).unknownKey).toBeUndefined();
  });

  it("handles corrupt localStorage gracefully", async () => {
    localStorage.setItem("ilia_privacy_settings_v1", "not-json{}{");
    const mod = await import("./privacy");
    const settings = mod.getPrivacySettingsSnapshot();
    expect(settings).toBeDefined();
  });

  it("PRIVACY_SETTINGS_UPDATED_EVENT is correct", async () => {
    const mod = await import("./privacy");
    expect(mod.PRIVACY_SETTINGS_UPDATED_EVENT).toBe("privacy-settings-updated");
  });

  it("dispatches custom event on update", async () => {
    const mod = await import("./privacy");
    let eventDetail: any = null;
    window.addEventListener(mod.PRIVACY_SETTINGS_UPDATED_EVENT, (e: any) => {
      eventDetail = e.detail;
    });
    mod.setPrivacySettingsSnapshot({ remoteBrowserDataAccess: true });
    expect(eventDetail).toBeDefined();
    expect(eventDetail.remoteBrowserDataAccess).toBe(true);
  });
});
