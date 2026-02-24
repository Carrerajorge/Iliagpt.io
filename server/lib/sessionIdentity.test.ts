import { describe, it, expect, vi, beforeEach } from "vitest";
import { extractUserIdFromSession, isOwnedByUser } from "./sessionIdentity";

describe("extractUserIdFromSession", () => {
  it("should return null for null session", () => {
    expect(extractUserIdFromSession(null)).toBeNull();
  });

  it("should return null for undefined session", () => {
    expect(extractUserIdFromSession(undefined)).toBeNull();
  });

  it("should extract from authUserId", () => {
    const session = { authUserId: "user-123" };
    expect(extractUserIdFromSession(session)).toBe("user-123");
  });

  it("should extract from passport.user when it is a string", () => {
    const session = { passport: { user: "user-456" } };
    expect(extractUserIdFromSession(session)).toBe("user-456");
  });

  it("should extract from passport.user.claims.sub", () => {
    const session = { passport: { user: { claims: { sub: "sub-789" } } } };
    expect(extractUserIdFromSession(session)).toBe("sub-789");
  });

  it("should extract from passport.user.id as fallback", () => {
    const session = { passport: { user: { id: "id-111" } } };
    expect(extractUserIdFromSession(session)).toBe("id-111");
  });

  it("should return null when session has no recognized fields", () => {
    const session = { someOtherField: "value" };
    expect(extractUserIdFromSession(session)).toBeNull();
  });
});

describe("isOwnedByUser", () => {
  it("should return true when userId matches session user", () => {
    const session = { authUserId: "user-123" };
    expect(isOwnedByUser(session, "user-123")).toBe(true);
  });

  it("should return false when userId does not match", () => {
    const session = { authUserId: "user-123" };
    expect(isOwnedByUser(session, "user-999")).toBe(false);
  });

  it("should return false when session is null", () => {
    expect(isOwnedByUser(null, "user-123")).toBe(false);
  });
});
