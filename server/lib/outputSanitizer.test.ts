import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  sanitizeOutput,
  validateOutput,
  detectPII,
  detectSecrets,
} from "./outputSanitizer";

describe("detectPII", () => {
  it("should detect email addresses", () => {
    const matches = detectPII("Contact us at test@example.com for info.");
    const emailMatches = matches.filter((m) => m.type === "email");
    expect(emailMatches.length).toBeGreaterThanOrEqual(1);
    expect(emailMatches[0].value).toBe("test@example.com");
  });

  it("should have high confidence for well-formed emails", () => {
    const matches = detectPII("Email: john.doe@company.org");
    const emailMatch = matches.find((m) => m.type === "email");
    expect(emailMatch).toBeDefined();
    expect(emailMatch!.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("should detect phone numbers", () => {
    const matches = detectPII("Call me at 555-123-4567 please.");
    const phoneMatches = matches.filter((m) => m.type === "phone");
    expect(phoneMatches.length).toBeGreaterThanOrEqual(1);
  });

  it("should detect SSN patterns", () => {
    const matches = detectPII("SSN: 123-45-6789");
    const ssnMatches = matches.filter((m) => m.type === "ssn");
    expect(ssnMatches.length).toBeGreaterThanOrEqual(1);
    expect(ssnMatches[0].value).toContain("123");
  });

  it("should detect credit card numbers with Luhn validation", () => {
    // 4111 1111 1111 1111 passes Luhn check
    const matches = detectPII("Card: 4111 1111 1111 1111");
    const ccMatches = matches.filter((m) => m.type === "credit_card");
    expect(ccMatches.length).toBeGreaterThanOrEqual(1);
    // Should have high confidence because it passes Luhn
    expect(ccMatches[0].confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("should have low confidence for numbers that fail Luhn check", () => {
    // 1234 5678 9012 3456 does NOT pass Luhn
    const matches = detectPII("Number: 1234 5678 9012 3456");
    const ccMatches = matches.filter((m) => m.type === "credit_card");
    if (ccMatches.length > 0) {
      expect(ccMatches[0].confidence).toBeLessThan(0.5);
    }
  });

  it("should return empty array for clean content", () => {
    const matches = detectPII("This is a perfectly clean string with no PII.");
    // Filter out low-confidence phone matches that might hit random digit sequences
    const highConfidence = matches.filter((m) => m.confidence >= 0.5);
    expect(highConfidence).toHaveLength(0);
  });
});

describe("detectSecrets", () => {
  it("should detect Stripe-style API keys (sk_live_...)", () => {
    const prefix = "sk_" + "live_";
    const matches = detectSecrets(`key: ${prefix}abcdefghijklmnopqrstuvwx`);
    const apiKeyMatches = matches.filter((m) => m.type === "api_key");
    expect(apiKeyMatches.length).toBeGreaterThanOrEqual(1);
  });

  it("should detect AWS access keys (AKIA...)", () => {
    const matches = detectSecrets("AKIAIOSFODNN7EXAMPLE");
    const awsMatches = matches.filter((m) => m.type === "aws_key");
    expect(awsMatches.length).toBeGreaterThanOrEqual(1);
  });

  it("should detect JWT tokens (eyJ...)", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    const matches = detectSecrets(jwt);
    const jwtMatches = matches.filter((m) => m.type === "jwt_token");
    expect(jwtMatches.length).toBeGreaterThanOrEqual(1);
  });

  it("should detect Bearer tokens", () => {
    const matches = detectSecrets("Authorization: Bearer abc123def456ghi789jkl012mno345");
    const bearerMatches = matches.filter((m) => m.type === "bearer_token");
    expect(bearerMatches.length).toBeGreaterThanOrEqual(1);
  });

  it("should return empty array for content with no secrets", () => {
    const matches = detectSecrets("This text has no secrets at all.");
    expect(matches).toHaveLength(0);
  });
});

describe("sanitizeOutput", () => {
  it("should redact PII and return modified content", () => {
    const result = sanitizeOutput("Email me at test@example.com", {
      contextLevel: "api",
      piiAction: "REDACT",
    });
    expect(result.wasModified).toBe(true);
    expect(result.content).toContain("[REDACTED]");
    expect(result.content).not.toContain("test@example.com");
    expect(result.redactedCount).toBeGreaterThan(0);
  });

  it("should return unmodified content when there is nothing to sanitize", () => {
    const result = sanitizeOutput("Hello world, nothing sensitive here.", {
      contextLevel: "user",
    });
    expect(result.wasModified).toBe(false);
    expect(result.content).toBe("Hello world, nothing sensitive here.");
    expect(result.redactedCount).toBe(0);
  });

  it("should mask content when mask action is used", () => {
    const result = sanitizeOutput("Email: john@example.com", {
      contextLevel: "user",
      piiAction: "MASK",
    });
    expect(result.wasModified).toBe(true);
    expect(result.maskedCount).toBeGreaterThan(0);
    // Masked email should preserve domain
    expect(result.content).toContain("@example.com");
    expect(result.content).not.toContain("john@example.com");
  });
});

describe("validateOutput", () => {
  it("should return low risk for clean content", () => {
    const result = validateOutput("No PII or secrets here.");
    expect(result.riskLevel).toBe("low");
    expect(result.hasPII).toBe(false);
    expect(result.hasSecrets).toBe(false);
    expect(result.isValid).toBe(true);
  });

  it("should return high risk when secrets are detected", () => {
    const prefix = "sk_" + "live_";
    const result = validateOutput(`key: ${prefix}abcdefghijklmnopqrstuvwx`);
    expect(result.hasSecrets).toBe(true);
    expect(result.riskLevel).toBe("high");
  });

  it("should return high risk when SSN is detected", () => {
    const result = validateOutput("SSN is 123-45-6789");
    expect(result.hasPII).toBe(true);
    // SSN triggers "high" risk
    expect(["high", "critical"]).toContain(result.riskLevel);
  });
});
