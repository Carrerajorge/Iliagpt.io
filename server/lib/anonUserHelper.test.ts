import { describe, it, expect } from "vitest";
import { getSecureUserId, getOrCreateSecureUserId, isAuthenticated, getAuthEmail } from "./anonUserHelper";

function mockReq(overrides: any = {}): any {
  return {
    user: overrides.user || null,
    session: overrides.session || {},
    sessionID: overrides.sessionID || "test-session-id",
    headers: overrides.headers || {},
    ...overrides,
  };
}

describe("getSecureUserId", () => {
  it("returns authenticated user ID from user.id", () => {
    const req = mockReq({ user: { id: "user-123" } });
    expect(getSecureUserId(req)).toBe("user-123");
  });

  it("returns authenticated user ID from user.claims.sub", () => {
    const req = mockReq({ user: { claims: { sub: "auth-456" } } });
    expect(getSecureUserId(req)).toBe("auth-456");
  });

  it("returns session.authUserId", () => {
    const req = mockReq({ session: { authUserId: "session-user-789" } });
    expect(getSecureUserId(req)).toBe("session-user-789");
  });

  it("returns passport serialized string user", () => {
    const req = mockReq({ session: { passport: { user: "passport-user-id" } } });
    expect(getSecureUserId(req)).toBe("passport-user-id");
  });

  it("returns passport user with claims.sub", () => {
    const req = mockReq({ session: { passport: { user: { claims: { sub: "pp-sub" } } } } });
    expect(getSecureUserId(req)).toBe("pp-sub");
  });

  it("returns passport user with id", () => {
    const req = mockReq({ session: { passport: { user: { id: "pp-id" } } } } );
    expect(getSecureUserId(req)).toBe("pp-id");
  });

  it("returns anon header if it matches session", () => {
    const req = mockReq({
      headers: { "x-anonymous-user-id": "anon_abc" },
      session: { anonUserId: "anon_abc" },
    });
    expect(getSecureUserId(req)).toBe("anon_abc");
  });

  it("rejects anon header if it doesnt match session", () => {
    const req = mockReq({
      headers: { "x-anonymous-user-id": "anon_evil" },
      session: { anonUserId: "anon_real" },
    });
    // Should not return the header value
    expect(getSecureUserId(req)).toBe("anon_real");
  });

  it("generates session-bound anon ID from sessionID", () => {
    const req = mockReq({ session: {}, sessionID: "sess-xyz" });
    const result = getSecureUserId(req);
    expect(result).toBe("anon_sess-xyz");
    expect(req.session.anonUserId).toBe("anon_sess-xyz");
  });

  it("returns null when no session available", () => {
    const req = mockReq({ session: undefined, sessionID: undefined });
    expect(getSecureUserId(req)).toBeNull();
  });
});

describe("getOrCreateSecureUserId", () => {
  it("returns user ID when available", () => {
    const req = mockReq({ user: { id: "user-123" } });
    expect(getOrCreateSecureUserId(req)).toBe("user-123");
  });

  it("generates fallback anon ID when no session", () => {
    const req = mockReq({ session: undefined, sessionID: undefined });
    const result = getOrCreateSecureUserId(req);
    expect(result).toMatch(/^anon_[a-f0-9]{32}$/);
  });
});

describe("isAuthenticated", () => {
  it("returns true for user with id", () => {
    expect(isAuthenticated(mockReq({ user: { id: "u1" } }))).toBe(true);
  });
  it("returns true for user with claims.sub", () => {
    expect(isAuthenticated(mockReq({ user: { claims: { sub: "s1" } } }))).toBe(true);
  });
  it("returns true for session.authUserId", () => {
    expect(isAuthenticated(mockReq({ session: { authUserId: "a1" } }))).toBe(true);
  });
  it("returns true for passport string user", () => {
    expect(isAuthenticated(mockReq({ session: { passport: { user: "p1" } } }))).toBe(true);
  });
  it("returns false for anonymous user", () => {
    expect(isAuthenticated(mockReq())).toBe(false);
  });
});

describe("getAuthEmail", () => {
  it("returns email from user.claims", () => {
    const req = mockReq({ user: { claims: { email: "user@test.com" } } });
    expect(getAuthEmail(req)).toBe("user@test.com");
  });
  it("returns null when no email", () => {
    expect(getAuthEmail(mockReq())).toBeNull();
    expect(getAuthEmail(mockReq({ user: { id: "u1" } }))).toBeNull();
  });
});
