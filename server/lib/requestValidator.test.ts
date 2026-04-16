import { describe, it, expect, vi, beforeEach } from "vitest";
import { sanitizeString } from "./requestValidator";

describe("sanitizeString", () => {
  it("should return normal input unchanged (no special chars)", () => {
    expect(sanitizeString("hello world")).toBe("hello world");
  });

  it("should remove null bytes", () => {
    expect(sanitizeString("hello\u0000world")).toBe("helloworld");
  });

  it("should remove control characters (except newline and tab-like)", () => {
    // \u0001 through \u0008, \u000B, \u000C, \u000E-\u001F, \u007F are stripped
    const input = "hello\u0001\u0002\u0003world";
    const result = sanitizeString(input);
    expect(result).toBe("helloworld");
  });

  it("should escape < and > to HTML entities", () => {
    expect(sanitizeString("<script>alert('xss')</script>")).toContain("&lt;");
    expect(sanitizeString("<script>alert('xss')</script>")).toContain("&gt;");
    expect(sanitizeString("<script>alert('xss')</script>")).not.toContain("<script>");
  });

  it("should escape double quotes", () => {
    expect(sanitizeString('say "hello"')).toContain("&quot;");
    expect(sanitizeString('say "hello"')).not.toContain('"');
  });

  it("should escape single quotes", () => {
    expect(sanitizeString("it's")).toContain("&#x27;");
  });

  it("should escape forward slashes", () => {
    expect(sanitizeString("a/b")).toContain("&#x2F;");
  });

  it("should truncate to 10000 characters", () => {
    const longInput = "a".repeat(20000);
    const result = sanitizeString(longInput);
    expect(result.length).toBeLessThanOrEqual(10000);
  });

  it("should handle empty string", () => {
    expect(sanitizeString("")).toBe("");
  });

  it("should handle a full XSS payload", () => {
    const xss = '<img src="x" onerror="alert(\'XSS\')">';
    const result = sanitizeString(xss);
    expect(result).not.toContain("<img");
    expect(result).toContain("&lt;");
    expect(result).toContain("&gt;");
    expect(result).toContain("&quot;");
  });
});
