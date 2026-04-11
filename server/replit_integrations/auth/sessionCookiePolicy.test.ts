import { describe, expect, it } from "vitest";

import { resolveSessionCookieSettings } from "./sessionCookiePolicy";

describe("resolveSessionCookieSettings", () => {
  it("keeps secure none cookies for real production domains", () => {
    expect(resolveSessionCookieSettings("production", "https://app.iliagpt.com")).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: "none",
    });
  });

  it("downgrades to lax non-secure cookies for loopback production-like runtimes", () => {
    expect(resolveSessionCookieSettings("production", "http://127.0.0.1:41734")).toEqual({
      httpOnly: true,
      secure: false,
      sameSite: "lax",
    });
    expect(resolveSessionCookieSettings("production", "http://localhost:41734")).toEqual({
      httpOnly: true,
      secure: false,
      sameSite: "lax",
    });
  });

  it("uses lax non-secure cookies outside production", () => {
    expect(resolveSessionCookieSettings("development", "http://127.0.0.1:41734")).toEqual({
      httpOnly: true,
      secure: false,
      sameSite: "lax",
    });
  });
});
