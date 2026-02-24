import { describe, it, expect } from "vitest";
import {
  validateEmail,
  validatePassword,
  getPasswordStrength,
  validatePasswordMatch,
  validateUsername,
  validatePhone,
  validateUrl,
  validateRequired,
  validateLength,
} from "./validation";

describe("validateEmail", () => {
  it("accepts valid emails", () => {
    expect(validateEmail("user@example.com").isValid).toBe(true);
    expect(validateEmail("user+tag@gmail.com").isValid).toBe(true);
    expect(validateEmail("name@sub.domain.com").isValid).toBe(true);
  });
  it("rejects empty/null input", () => {
    expect(validateEmail("").isValid).toBe(false);
    expect(validateEmail(null as any).isValid).toBe(false);
    expect(validateEmail(undefined as any).isValid).toBe(false);
    expect(validateEmail("   ").isValid).toBe(false);
  });
  it("rejects invalid format", () => {
    expect(validateEmail("notanemail").isValid).toBe(false);
    expect(validateEmail("@nodomain.com").isValid).toBe(false);
  });
  it("rejects too-long emails", () => {
    const longEmail = "a".repeat(250) + "@b.com";
    expect(longEmail.length).toBeGreaterThan(254);
    expect(validateEmail(longEmail).isValid).toBe(false);
  });
  it("warns on common typos", () => {
    const result = validateEmail("user@gmial.com");
    expect(result.isValid).toBe(true);
    expect(result.warnings).toBeDefined();
    expect(result.warnings![0]).toContain("gmail.com");
  });
});

describe("validatePassword", () => {
  it("accepts valid passwords", () => {
    expect(validatePassword("SecureP@ss1").isValid).toBe(true);
    expect(validatePassword("longpassword").isValid).toBe(true);
  });
  it("rejects empty/null", () => {
    expect(validatePassword("").isValid).toBe(false);
    expect(validatePassword(null as any).isValid).toBe(false);
  });
  it("rejects short passwords", () => {
    expect(validatePassword("short").isValid).toBe(false);
  });
  it("rejects too long passwords", () => {
    expect(validatePassword("a".repeat(129)).isValid).toBe(false);
  });
  it("rejects common passwords", () => {
    expect(validatePassword("password").isValid).toBe(false);
    expect(validatePassword("12345678").isValid).toBe(false);
    expect(validatePassword("qwerty123").isValid).toBe(false);
  });
  it("warns on repeated characters", () => {
    const result = validatePassword("aaaaabcdef");
    expect(result.isValid).toBe(true);
    expect(result.warnings).toBeDefined();
  });
  it("warns on sequential numbers", () => {
    const result = validatePassword("abc12345def");
    expect(result.isValid).toBe(true);
    expect(result.warnings).toBeDefined();
  });
});

describe("getPasswordStrength", () => {
  it("scores empty as 0", () => {
    expect(getPasswordStrength("").score).toBe(0);
  });
  it("scores short simple as weak", () => {
    const s = getPasswordStrength("abcdefgh");
    expect(s.score).toBeLessThanOrEqual(2);
  });
  it("scores complex long as strong", () => {
    const s = getPasswordStrength("C0mpl3x!P@ssw0rd!!");
    expect(s.score).toBeGreaterThanOrEqual(3);
  });
  it("provides feedback for missing character types", () => {
    const s = getPasswordStrength("alllowercase");
    expect(s.feedback.length).toBeGreaterThan(0);
  });
});

describe("validatePasswordMatch", () => {
  it("accepts matching passwords", () => {
    expect(validatePasswordMatch("abc123", "abc123").isValid).toBe(true);
  });
  it("rejects mismatched passwords", () => {
    expect(validatePasswordMatch("abc123", "abc456").isValid).toBe(false);
  });
  it("rejects empty confirmation", () => {
    expect(validatePasswordMatch("abc123", "").isValid).toBe(false);
  });
});

describe("validateUsername", () => {
  it("accepts valid usernames", () => {
    expect(validateUsername("john_doe").isValid).toBe(true);
    expect(validateUsername("user-123").isValid).toBe(true);
  });
  it("rejects empty/null", () => {
    expect(validateUsername("").isValid).toBe(false);
    expect(validateUsername(null as any).isValid).toBe(false);
  });
  it("rejects too short", () => {
    expect(validateUsername("ab").isValid).toBe(false);
  });
  it("rejects too long", () => {
    expect(validateUsername("a".repeat(31)).isValid).toBe(false);
  });
  it("rejects special characters", () => {
    expect(validateUsername("user@name").isValid).toBe(false);
    expect(validateUsername("user name").isValid).toBe(false);
  });
  it("rejects reserved names", () => {
    expect(validateUsername("admin").isValid).toBe(false);
    expect(validateUsername("ROOT").isValid).toBe(false);
    expect(validateUsername("system").isValid).toBe(false);
  });
});

describe("validatePhone", () => {
  it("accepts valid international numbers", () => {
    expect(validatePhone("+521234567890").isValid).toBe(true);
    expect(validatePhone("+1 (555) 123-4567").isValid).toBe(true);
  });
  it("rejects empty/null", () => {
    expect(validatePhone("").isValid).toBe(false);
    expect(validatePhone(null as any).isValid).toBe(false);
  });
  it("rejects invalid formats", () => {
    expect(validatePhone("abcdef").isValid).toBe(false);
    expect(validatePhone("123").isValid).toBe(false);
  });
});

describe("validateUrl", () => {
  it("accepts valid URLs", () => {
    expect(validateUrl("https://example.com").isValid).toBe(true);
    expect(validateUrl("http://localhost:3000").isValid).toBe(true);
  });
  it("rejects empty/null", () => {
    expect(validateUrl("").isValid).toBe(false);
    expect(validateUrl(null as any).isValid).toBe(false);
  });
  it("rejects non-http protocols", () => {
    expect(validateUrl("ftp://example.com").isValid).toBe(false);
  });
  it("rejects invalid URLs", () => {
    expect(validateUrl("not a url").isValid).toBe(false);
  });
});

describe("validateRequired", () => {
  it("accepts valid values", () => {
    expect(validateRequired("hello").isValid).toBe(true);
    expect(validateRequired(42).isValid).toBe(true);
    expect(validateRequired([1, 2]).isValid).toBe(true);
  });
  it("rejects null/undefined/empty", () => {
    expect(validateRequired(null).isValid).toBe(false);
    expect(validateRequired(undefined).isValid).toBe(false);
    expect(validateRequired("").isValid).toBe(false);
    expect(validateRequired("   ").isValid).toBe(false);
    expect(validateRequired([]).isValid).toBe(false);
  });
  it("uses custom field name in error", () => {
    const result = validateRequired(null, "Email");
    expect(result.error).toContain("Email");
  });
});

describe("validateLength", () => {
  it("accepts valid lengths", () => {
    expect(validateLength("hello", 1, 10).isValid).toBe(true);
  });
  it("rejects too short", () => {
    expect(validateLength("a", 3, 10).isValid).toBe(false);
  });
  it("rejects too long", () => {
    expect(validateLength("a".repeat(11), 1, 10).isValid).toBe(false);
  });
  it("rejects empty/null", () => {
    expect(validateLength("", 1, 10).isValid).toBe(false);
    expect(validateLength(null as any, 1, 10).isValid).toBe(false);
  });
});
