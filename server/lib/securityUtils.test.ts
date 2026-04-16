import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  sanitizeSensitiveData,
  containsDangerousSql,
  sanitizeCsvValue,
  sanitizeFilePath,
  sanitizeFileName,
  isInternalIP,
  maskSensitiveValue,
  generateRateLimitKey,
  validateContentLength,
} from "./securityUtils";

describe("containsDangerousSql", () => {
  it("should detect DROP TABLE injection", () => {
    expect(containsDangerousSql("SELECT * FROM users; DROP TABLE users")).toBe(true);
  });

  it("should detect UNION SELECT injection", () => {
    expect(containsDangerousSql("1 INTO OUTFILE '/tmp/test'")).toBe(true);
  });

  it("should detect pg_sleep injection", () => {
    expect(containsDangerousSql("SELECT pg_sleep(10)")).toBe(true);
  });

  it("should return false for safe queries", () => {
    expect(containsDangerousSql("SELECT id, name FROM users WHERE id = 1")).toBe(false);
  });

  it("should return false for non-string input", () => {
    expect(containsDangerousSql(42 as any)).toBe(false);
  });
});

describe("sanitizeCsvValue", () => {
  it("should prefix formula characters with single quote", () => {
    const result = sanitizeCsvValue("=cmd|'/C calc'!A0");
    expect(result[0]).toBe("'");
  });

  it("should prefix plus sign to prevent formula injection", () => {
    const result = sanitizeCsvValue("+cmd|'/C calc'!A0");
    expect(result[0]).toBe("'");
  });

  it("should handle null and undefined", () => {
    expect(sanitizeCsvValue(null)).toBe("");
    expect(sanitizeCsvValue(undefined)).toBe("");
  });

  it("should return normal strings unchanged when no special chars", () => {
    expect(sanitizeCsvValue("hello world")).toBe("hello world");
  });
});

describe("sanitizeFilePath", () => {
  it("should reject path traversal with ..", () => {
    expect(sanitizeFilePath("../../etc/passwd")).toBeNull();
  });

  it("should reject paths with null bytes", () => {
    expect(sanitizeFilePath("file\0.txt")).toBeNull();
  });

  it("should return sanitized path for valid input", () => {
    const result = sanitizeFilePath("uploads/file.txt");
    expect(result).not.toBeNull();
  });

  it("should return null for empty string", () => {
    expect(sanitizeFilePath("")).toBeNull();
  });
});

describe("sanitizeFileName", () => {
  it("should strip path separators and dangerous characters", () => {
    const result = sanitizeFileName("file/name\\with:bad*chars?.txt");
    expect(result).not.toContain("/");
    expect(result).not.toContain("\\");
    expect(result).not.toContain(":");
    expect(result).not.toContain("*");
    expect(result).not.toContain("?");
  });

  it("should truncate to maxLength while preserving extension", () => {
    const longName = "a".repeat(300) + ".pdf";
    const result = sanitizeFileName(longName, 50);
    expect(result.length).toBeLessThanOrEqual(50);
    expect(result).toMatch(/\.pdf$/);
  });

  it("should return empty string for non-string input", () => {
    expect(sanitizeFileName(123 as any)).toBe("");
  });
});

describe("isInternalIP", () => {
  it("should detect 127.0.0.1 as internal", () => {
    expect(isInternalIP("127.0.0.1")).toBe(true);
  });

  it("should detect 10.x.x.x as internal", () => {
    expect(isInternalIP("10.0.0.1")).toBe(true);
  });

  it("should detect 192.168.x.x as internal", () => {
    expect(isInternalIP("192.168.1.1")).toBe(true);
  });

  it("should detect ::1 as internal", () => {
    expect(isInternalIP("::1")).toBe(true);
  });

  it("should detect localhost as internal", () => {
    expect(isInternalIP("localhost")).toBe(true);
  });

  it("should return false for public IP", () => {
    expect(isInternalIP("8.8.8.8")).toBe(false);
  });

  it("should return false for undefined/null/empty", () => {
    expect(isInternalIP(undefined)).toBe(false);
    expect(isInternalIP("")).toBe(false);
  });
});

describe("maskSensitiveValue", () => {
  it("should mask the middle of a value", () => {
    expect(maskSensitiveValue("abcdefghij", 3)).toBe("abc***hij");
  });

  it("should return *** for short values", () => {
    expect(maskSensitiveValue("ab", 3)).toBe("***");
  });

  it("should return *** for empty string", () => {
    expect(maskSensitiveValue("", 3)).toBe("***");
  });
});

describe("generateRateLimitKey", () => {
  it("should include prefix and userId", () => {
    expect(generateRateLimitKey("api", "user-123")).toBe("api:user-123");
  });

  it("should fall back to IP when userId is absent", () => {
    expect(generateRateLimitKey("api", undefined, "1.2.3.4")).toBe("api:1.2.3.4");
  });

  it("should use 'anonymous' when neither userId nor IP provided", () => {
    expect(generateRateLimitKey("api")).toBe("api:anonymous");
  });
});

describe("validateContentLength", () => {
  it("should return valid for content within bounds", () => {
    expect(validateContentLength("hello", 100).valid).toBe(true);
  });

  it("should return invalid for content exceeding maxLength", () => {
    const result = validateContentLength("hello world", 5);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("maximum length");
  });

  it("should return invalid for content below minLength", () => {
    const result = validateContentLength("hi", 100, 5);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("at least");
  });

  it("should return invalid for non-string input", () => {
    const result = validateContentLength(42 as any, 100);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("string");
  });
});

describe("sanitizeSensitiveData", () => {
  it("should redact fields that match sensitive field names", () => {
    const data = { username: "alice", password: "secret123", api_key: "sk-abc" };
    const sanitized = sanitizeSensitiveData(data);
    expect(sanitized.username).toBe("alice");
    expect(sanitized.password).toBe("[REDACTED]");
    expect(sanitized.api_key).toBe("[REDACTED]");
  });

  it("should handle non-object input gracefully", () => {
    expect(sanitizeSensitiveData(null as any)).toBeNull();
    expect(sanitizeSensitiveData(undefined as any)).toBeUndefined();
  });
});
