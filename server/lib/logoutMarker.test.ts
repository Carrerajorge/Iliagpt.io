import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  setLogoutMarker,
  clearLogoutMarker,
  hasLogoutMarker,
  LOGOUT_MARKER_COOKIE,
} from "../lib/logoutMarker";

// ── Mock Express req/res ─────────────────────────────────────

function mockRes() {
  return {
    cookie: vi.fn(),
    clearCookie: vi.fn(),
  } as any;
}

function mockReq(
  options: { cookies?: Record<string, string>; cookieHeader?: string } = {},
) {
  return {
    cookies: options.cookies,
    headers: {
      cookie: options.cookieHeader,
    },
  } as any;
}

// ── Tests ────────────────────────────────────────────────────

describe("logoutMarker", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // ---------- LOGOUT_MARKER_COOKIE constant ----------

  describe("LOGOUT_MARKER_COOKIE", () => {
    it("has the expected cookie name", () => {
      expect(LOGOUT_MARKER_COOKIE).toBe("siragpt.logged_out");
    });
  });

  // ---------- setLogoutMarker ----------

  describe("setLogoutMarker", () => {
    it("calls res.cookie with correct cookie name", () => {
      const res = mockRes();
      setLogoutMarker(res);
      expect(res.cookie).toHaveBeenCalledTimes(1);
      expect(res.cookie.mock.calls[0][0]).toBe(LOGOUT_MARKER_COOKIE);
    });

    it("sets cookie value to '1'", () => {
      const res = mockRes();
      setLogoutMarker(res);
      expect(res.cookie.mock.calls[0][1]).toBe("1");
    });

    it("sets httpOnly and path options", () => {
      const res = mockRes();
      setLogoutMarker(res);
      const opts = res.cookie.mock.calls[0][2];
      expect(opts.httpOnly).toBe(true);
      expect(opts.path).toBe("/");
      expect(opts.maxAge).toBeDefined();
    });
  });

  // ---------- clearLogoutMarker ----------

  describe("clearLogoutMarker", () => {
    it("calls res.clearCookie with the correct cookie name", () => {
      const res = mockRes();
      clearLogoutMarker(res);
      expect(res.clearCookie).toHaveBeenCalledTimes(1);
      expect(res.clearCookie.mock.calls[0][0]).toBe(LOGOUT_MARKER_COOKIE);
    });

    it("passes cookie options to clearCookie", () => {
      const res = mockRes();
      clearLogoutMarker(res);
      const opts = res.clearCookie.mock.calls[0][1];
      expect(opts.httpOnly).toBe(true);
      expect(opts.path).toBe("/");
    });
  });

  // ---------- hasLogoutMarker ----------

  describe("hasLogoutMarker", () => {
    it("returns true when cookie is present in req.cookies", () => {
      const req = mockReq({
        cookies: { [LOGOUT_MARKER_COOKIE]: "1" },
      });
      expect(hasLogoutMarker(req)).toBe(true);
    });

    it("returns false when cookie is absent", () => {
      const req = mockReq({});
      expect(hasLogoutMarker(req)).toBe(false);
    });

    it("returns true when cookie is in raw cookie header", () => {
      const req = mockReq({
        cookieHeader: `${LOGOUT_MARKER_COOKIE}=1; other=value`,
      });
      expect(hasLogoutMarker(req)).toBe(true);
    });

    it("returns false when raw cookie header has different value", () => {
      const req = mockReq({
        cookieHeader: `${LOGOUT_MARKER_COOKIE}=0`,
      });
      expect(hasLogoutMarker(req)).toBe(false);
    });
  });
});
