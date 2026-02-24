import { describe, it, expect, vi, beforeEach } from "vitest";
import { evaluateSafeMathExpression } from "./mathExpressionEvaluator";

describe("evaluateSafeMathExpression", () => {
  describe("basic arithmetic", () => {
    it("should evaluate addition", () => {
      expect(evaluateSafeMathExpression("2 + 3")).toBe(5);
    });

    it("should evaluate subtraction", () => {
      expect(evaluateSafeMathExpression("10 - 4")).toBe(6);
    });

    it("should evaluate multiplication", () => {
      expect(evaluateSafeMathExpression("6 * 7")).toBe(42);
    });

    it("should evaluate division", () => {
      expect(evaluateSafeMathExpression("15 / 3")).toBe(5);
    });

    it("should evaluate modulo", () => {
      expect(evaluateSafeMathExpression("17 % 5")).toBe(2);
    });

    it("should evaluate power operator", () => {
      expect(evaluateSafeMathExpression("2 ** 10")).toBe(1024);
    });
  });

  describe("operator precedence", () => {
    it("should respect multiplication over addition: 2+3*4=14", () => {
      expect(evaluateSafeMathExpression("2 + 3 * 4")).toBe(14);
    });

    it("should respect parentheses: (2+3)*4=20", () => {
      expect(evaluateSafeMathExpression("(2 + 3) * 4")).toBe(20);
    });
  });

  describe("unary operators", () => {
    it("should evaluate unary minus", () => {
      expect(evaluateSafeMathExpression("-5")).toBe(-5);
    });

    it("should evaluate unary plus", () => {
      expect(evaluateSafeMathExpression("+3")).toBe(3);
    });

    it("should evaluate double negation", () => {
      expect(evaluateSafeMathExpression("--7")).toBe(7);
    });
  });

  describe("built-in constants", () => {
    it("should resolve pi to approximately 3.14159", () => {
      const result = evaluateSafeMathExpression("pi", { constants: { pi: Math.PI } });
      expect(result).toBeCloseTo(Math.PI, 5);
    });

    it("should resolve e to approximately 2.71828", () => {
      const result = evaluateSafeMathExpression("e", { constants: { e: Math.E } });
      expect(result).toBeCloseTo(Math.E, 5);
    });
  });

  describe("custom functions", () => {
    const withSqrtAbs = {
      functions: {
        sqrt: { fn: Math.sqrt, minArity: 1, maxArity: 1 },
        abs: { fn: Math.abs, minArity: 1, maxArity: 1 },
      },
    };

    it("should evaluate sqrt(9) = 3", () => {
      expect(evaluateSafeMathExpression("sqrt(9)", withSqrtAbs)).toBe(3);
    });

    it("should evaluate abs(-5) = 5", () => {
      expect(evaluateSafeMathExpression("abs(-5)", withSqrtAbs)).toBe(5);
    });
  });

  describe("scientific notation", () => {
    it("should parse 1e3 as 1000", () => {
      expect(evaluateSafeMathExpression("1e3")).toBe(1000);
    });

    it("should parse 2.5e-2 as 0.025", () => {
      expect(evaluateSafeMathExpression("2.5e-2")).toBe(0.025);
    });
  });

  describe("error cases", () => {
    it("should throw on division by zero", () => {
      expect(() => evaluateSafeMathExpression("10 / 0")).toThrow("Division by zero");
    });

    it("should throw on empty string", () => {
      expect(() => evaluateSafeMathExpression("")).toThrow();
    });

    it("should throw when max depth is exceeded", () => {
      // Deeply nested expression
      expect(() =>
        evaluateSafeMathExpression("1+1", { maxDepth: 1 })
      ).toThrow();
    });

    it("should throw when too many tokens are provided", () => {
      expect(() =>
        evaluateSafeMathExpression("1+2+3+4+5+6", { maxTokenCount: 3 })
      ).toThrow("too many tokens");
    });

    it("should throw on unknown identifiers", () => {
      expect(() => evaluateSafeMathExpression("foo")).toThrow("Unknown identifier");
    });

    it("should throw on modulo by zero", () => {
      expect(() => evaluateSafeMathExpression("10 % 0")).toThrow("Modulo by zero");
    });
  });
});
