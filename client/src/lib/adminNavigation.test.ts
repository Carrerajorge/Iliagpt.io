import { describe, expect, it } from "vitest";

import { getAdminHref, getAdminSectionFromRoute } from "./adminNavigation";

describe("adminNavigation", () => {
  it("defaults to dashboard on the base admin route", () => {
    expect(getAdminSectionFromRoute("/admin", "")).toBe("dashboard");
  });

  it("reads the section from the query string", () => {
    expect(getAdminSectionFromRoute("/admin", "?section=users")).toBe("users");
  });

  it("supports slug-based admin paths", () => {
    expect(getAdminSectionFromRoute("/admin/budget", "")).toBe("budget");
    expect(getAdminSectionFromRoute("/admin/security", "")).toBe("security");
    expect(getAdminSectionFromRoute("/admin/data-plane", "")).toBe("data-plane");
    expect(getAdminSectionFromRoute("/admin/agentic-engine", "")).toBe("agentic");
    expect(getAdminSectionFromRoute("/admin/security-monitor", "")).toBe("security-dashboard");
    expect(getAdminSectionFromRoute("/admin/file-plane", "")).toBe("files");
    expect(getAdminSectionFromRoute("/admin/browser-plane", "")).toBe("browser");
  });

  it("builds stable hrefs for every admin section", () => {
    expect(getAdminHref("dashboard")).toBe("/admin");
    expect(getAdminHref("budget")).toBe("/admin/budget");
    expect(getAdminHref("users")).toBe("/admin/users");
    expect(getAdminHref("security-dashboard")).toBe("/admin/security-monitor");
    expect(getAdminHref("agentic")).toBe("/admin/agentic-engine");
    expect(getAdminHref("voice")).toBe("/admin/voice-plane");
  });
});
