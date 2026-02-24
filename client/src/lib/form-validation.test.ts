import { describe, it, expect } from "vitest";
import {
  escapeHtml,
  sanitizeInput,
  sanitizeUrl,
  ValidationRules,
  validate,
  validateForm,
  isFormValid,
  getFirstError,
  createFormFieldState,
  updateFormField,
  FormRateLimiter,
} from "./form-validation";

describe("escapeHtml", () => {
  it("escapes all dangerous characters", () => {
    expect(escapeHtml("&")).toBe("&amp;");
    expect(escapeHtml("<")).toBe("&lt;");
    expect(escapeHtml(">")).toBe("&gt;");
    expect(escapeHtml('"')).toBe("&quot;");
    expect(escapeHtml("'")).toBe("&#39;");
    expect(escapeHtml("/")).toBe("&#x2F;");
    expect(escapeHtml("`")).toBe("&#x60;");
    expect(escapeHtml("=")).toBe("&#x3D;");
  });
  it("escapes a complex XSS attempt", () => {
    const result = escapeHtml('<script>alert("xss")</script>');
    expect(result).not.toContain("<");
    expect(result).not.toContain(">");
    expect(result).toContain("&lt;script&gt;");
  });
  it("preserves safe text", () => {
    expect(escapeHtml("Hello world")).toBe("Hello world");
  });
});

describe("sanitizeInput", () => {
  it("trims whitespace", () => {
    expect(sanitizeInput("  hello  ")).toBe("hello");
  });
  it("removes control characters", () => {
    expect(sanitizeInput("hello\x00world")).toBe("helloworld");
    expect(sanitizeInput("hello\x1Fworld")).toBe("helloworld");
  });
  it("truncates to 10000 chars", () => {
    const long = "a".repeat(15000);
    expect(sanitizeInput(long).length).toBe(10000);
  });
});

describe("sanitizeUrl", () => {
  it("accepts valid http/https URLs", () => {
    expect(sanitizeUrl("https://example.com")).toBe("https://example.com/");
    expect(sanitizeUrl("http://localhost:3000")).toBe("http://localhost:3000/");
  });
  it("rejects non-http protocols", () => {
    expect(sanitizeUrl("ftp://example.com")).toBeNull();
    expect(sanitizeUrl("javascript:alert(1)")).toBeNull();
  });
  it("adds https:// to bare domains", () => {
    const result = sanitizeUrl("example.com");
    expect(result).toContain("https://");
    expect(result).toContain("example.com");
  });
  it("returns null for garbage input", () => {
    expect(sanitizeUrl("not a url at all !!!")).toBeNull();
  });
});

describe("ValidationRules", () => {
  it("required rule works", () => {
    const rule = ValidationRules.required();
    expect(rule.validate("hello")).toBe(true);
    expect(rule.validate("")).toBe(false);
    expect(rule.validate("   ")).toBe(false);
  });

  it("email rule works", () => {
    const rule = ValidationRules.email();
    expect(rule.validate("user@example.com")).toBe(true);
    expect(rule.validate("invalid")).toBe(false);
  });

  it("minLength rule works", () => {
    const rule = ValidationRules.minLength(3);
    expect(rule.validate("abc")).toBe(true);
    expect(rule.validate("ab")).toBe(false);
  });

  it("maxLength rule works", () => {
    const rule = ValidationRules.maxLength(5);
    expect(rule.validate("hello")).toBe(true);
    expect(rule.validate("toolong")).toBe(false);
  });

  it("pattern rule works", () => {
    const rule = ValidationRules.pattern(/^\d+$/, "Numbers only");
    expect(rule.validate("123")).toBe(true);
    expect(rule.validate("abc")).toBe(false);
  });

  it("url rule works", () => {
    const rule = ValidationRules.url();
    expect(rule.validate("https://example.com")).toBe(true);
    expect(rule.validate("not a url")).toBe(false);
  });

  it("numeric rule works", () => {
    const rule = ValidationRules.numeric();
    expect(rule.validate("123")).toBe(true);
    expect(rule.validate("12.3")).toBe(false);
    expect(rule.validate("abc")).toBe(false);
  });

  it("alphanumeric rule works", () => {
    const rule = ValidationRules.alphanumeric();
    expect(rule.validate("abc123")).toBe(true);
    expect(rule.validate("abc_123")).toBe(false);
  });

  it("noScript rule works", () => {
    const rule = ValidationRules.noScript();
    expect(rule.validate("safe text")).toBe(true);
    expect(rule.validate("<script>alert(1)</script>")).toBe(false);
    expect(rule.validate("onclick=doSomething()")).toBe(false);
  });

  it("password rule works", () => {
    const rule = ValidationRules.password();
    expect(rule.validate("Passw0rd")).toBe(true);
    expect(rule.validate("short")).toBe(false);
    expect(rule.validate("nouppercase1")).toBe(false);
  });

  it("match rule works", () => {
    const rule = ValidationRules.match("abc123");
    expect(rule.validate("abc123")).toBe(true);
    expect(rule.validate("abc456")).toBe(false);
  });
});

describe("validate", () => {
  it("passes all rules", () => {
    const result = validate("hello", [
      ValidationRules.required(),
      ValidationRules.minLength(3),
    ]);
    expect(result.isValid).toBe(true);
  });
  it("returns first failing error", () => {
    const result = validate("", [
      ValidationRules.required("Campo requerido"),
      ValidationRules.minLength(3),
    ]);
    expect(result.isValid).toBe(false);
    expect(result.error).toBe("Campo requerido");
  });
});

describe("validateForm", () => {
  it("validates multiple fields", () => {
    const results = validateForm(
      { name: "John", email: "" },
      {
        name: [ValidationRules.required()],
        email: [ValidationRules.required(), ValidationRules.email()],
      }
    );
    expect(results.name.isValid).toBe(true);
    expect(results.email.isValid).toBe(false);
  });
});

describe("isFormValid", () => {
  it("returns true when all valid", () => {
    expect(isFormValid({ a: { isValid: true }, b: { isValid: true } })).toBe(true);
  });
  it("returns false when any invalid", () => {
    expect(isFormValid({ a: { isValid: true }, b: { isValid: false, error: "err" } })).toBe(false);
  });
});

describe("getFirstError", () => {
  it("returns null when all valid", () => {
    expect(getFirstError({ a: { isValid: true }, b: { isValid: true } })).toBeNull();
  });
  it("returns first error message", () => {
    expect(
      getFirstError({ a: { isValid: false, error: "Error A" }, b: { isValid: true } })
    ).toBe("Error A");
  });
});

describe("createFormFieldState", () => {
  it("creates default state", () => {
    const state = createFormFieldState();
    expect(state.value).toBe("");
    expect(state.touched).toBe(false);
    expect(state.error).toBeNull();
    expect(state.isValid).toBe(true);
  });
  it("creates state with initial value", () => {
    const state = createFormFieldState("hello");
    expect(state.value).toBe("hello");
  });
});

describe("updateFormField", () => {
  it("validates and updates field", () => {
    const field = createFormFieldState();
    const updated = updateFormField(field, "hello", [ValidationRules.required()]);
    expect(updated.value).toBe("hello");
    expect(updated.touched).toBe(true);
    expect(updated.isValid).toBe(true);
  });
  it("marks invalid field", () => {
    const field = createFormFieldState();
    const updated = updateFormField(field, "", [ValidationRules.required()]);
    expect(updated.isValid).toBe(false);
    expect(updated.error).toBeTruthy();
  });
});

describe("FormRateLimiter", () => {
  it("allows first submit", () => {
    const limiter = new FormRateLimiter();
    expect(limiter.canSubmit()).toBe(true);
  });

  it("blocks rapid submits", () => {
    const limiter = new FormRateLimiter({ minInterval: 1000 });
    limiter.recordSubmit();
    expect(limiter.canSubmit()).toBe(false);
  });

  it("reports remaining time", () => {
    const limiter = new FormRateLimiter({ minInterval: 1000 });
    limiter.recordSubmit();
    expect(limiter.getRemainingTime()).toBeGreaterThan(0);
  });

  it("returns 0 remaining when no recent submit", () => {
    const limiter = new FormRateLimiter();
    expect(limiter.getRemainingTime()).toBe(0);
  });
});
