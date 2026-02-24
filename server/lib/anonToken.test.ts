import { describe, it, expect } from "vitest";
import { generateAnonToken, verifyAnonToken } from "./anonToken";

describe("generateAnonToken", () => {
  it("generates a hex string", () => {
    const token = generateAnonToken("user-123");
    expect(token).toMatch(/^[a-f0-9]{64}$/);
  });

  it("generates deterministic tokens for same input", () => {
    const t1 = generateAnonToken("user-123");
    const t2 = generateAnonToken("user-123");
    expect(t1).toBe(t2);
  });

  it("generates different tokens for different inputs", () => {
    const t1 = generateAnonToken("user-123");
    const t2 = generateAnonToken("user-456");
    expect(t1).not.toBe(t2);
  });
});

describe("verifyAnonToken", () => {
  it("verifies a valid token", () => {
    const userId = "anon-abc-123";
    const token = generateAnonToken(userId);
    expect(verifyAnonToken(userId, token)).toBe(true);
  });

  it("rejects an invalid token", () => {
    const userId = "anon-abc-123";
    expect(verifyAnonToken(userId, "invalid-token-value-that-is-64-chars-long-padded-for-length-ok!!")).toBe(false);
  });

  it("rejects empty userId", () => {
    expect(verifyAnonToken("", "sometoken")).toBe(false);
  });

  it("rejects empty token", () => {
    expect(verifyAnonToken("user-123", "")).toBe(false);
  });

  it("rejects null/undefined", () => {
    expect(verifyAnonToken(null as any, "token")).toBe(false);
    expect(verifyAnonToken("user", null as any)).toBe(false);
  });

  it("rejects mismatched length tokens gracefully", () => {
    expect(verifyAnonToken("user-123", "short")).toBe(false);
  });
});
