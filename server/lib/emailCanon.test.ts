import { describe, it, expect } from "vitest";
import { canonicalizeEmail, validateEmailRFC } from "./emailCanon";

describe("canonicalizeEmail", () => {
  it("lowercases the entire email", () => {
    expect(canonicalizeEmail("User@Example.COM")).toBe("user@example.com");
  });

  it("trims whitespace", () => {
    expect(canonicalizeEmail("  user@example.com  ")).toBe("user@example.com");
  });

  it("handles email without @", () => {
    const result = canonicalizeEmail("noemail");
    expect(result).toBe("noemail");
  });

  it("handles email with multiple @ signs (uses last)", () => {
    const result = canonicalizeEmail("user@weird@example.com");
    expect(result).toContain("@example.com");
  });

  it("converts internationalized domains to punycode", () => {
    const result = canonicalizeEmail("user@münchen.de");
    expect(result).toContain("@xn--mnchen-3ya.de");
  });

  it("preserves ASCII domains as-is", () => {
    expect(canonicalizeEmail("test@gmail.com")).toBe("test@gmail.com");
  });
});

describe("validateEmailRFC", () => {
  it("accepts valid emails", () => {
    expect(validateEmailRFC("user@example.com").valid).toBe(true);
    expect(validateEmailRFC("user.name@example.com").valid).toBe(true);
    expect(validateEmailRFC("user+tag@example.com").valid).toBe(true);
    expect(validateEmailRFC("a@b.co").valid).toBe(true);
  });

  it("rejects empty/null input", () => {
    expect(validateEmailRFC("").valid).toBe(false);
    expect(validateEmailRFC(null as any).valid).toBe(false);
    expect(validateEmailRFC(undefined as any).valid).toBe(false);
  });

  it("rejects email exceeding 254 chars", () => {
    const longEmail = "a".repeat(250) + "@b.co";
    const result = validateEmailRFC(longEmail);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("254");
  });

  it("rejects email without @ separator", () => {
    expect(validateEmailRFC("noemail").valid).toBe(false);
    expect(validateEmailRFC("noemail").reason).toContain("@");
  });

  it("rejects local part exceeding 64 chars", () => {
    const result = validateEmailRFC("a".repeat(65) + "@example.com");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("64");
  });

  it("rejects empty local part", () => {
    const result = validateEmailRFC("@example.com");
    expect(result.valid).toBe(false);
  });

  it("rejects local part starting/ending with dot", () => {
    expect(validateEmailRFC(".user@example.com").valid).toBe(false);
    expect(validateEmailRFC("user.@example.com").valid).toBe(false);
  });

  it("rejects consecutive dots in local part", () => {
    const result = validateEmailRFC("user..name@example.com");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("consecutive dots");
  });

  it("rejects empty domain", () => {
    // lastIndexOf("@") will be last char, domain will be empty
    const result = validateEmailRFC("user@");
    expect(result.valid).toBe(false);
  });

  it("rejects domain exceeding 255 chars", () => {
    const longDomain = "a".repeat(256) + ".com";
    const result = validateEmailRFC("user@" + longDomain);
    expect(result.valid).toBe(false);
  });

  it("rejects consecutive dots in domain", () => {
    expect(validateEmailRFC("user@example..com").valid).toBe(false);
  });

  it("rejects domain with less than 2 labels", () => {
    expect(validateEmailRFC("user@localhost").valid).toBe(false);
  });

  it("rejects domain label with invalid length", () => {
    const longLabel = "a".repeat(64) + ".com";
    const result = validateEmailRFC("user@" + longLabel);
    expect(result.valid).toBe(false);
  });

  it("rejects domain label starting/ending with hyphen", () => {
    expect(validateEmailRFC("user@-example.com").valid).toBe(false);
    expect(validateEmailRFC("user@example-.com").valid).toBe(false);
  });

  it("rejects domain with invalid characters", () => {
    expect(validateEmailRFC("user@exam ple.com").valid).toBe(false);
  });

  it("rejects local part with invalid characters", () => {
    expect(validateEmailRFC("user name@example.com").valid).toBe(false);
  });
});
