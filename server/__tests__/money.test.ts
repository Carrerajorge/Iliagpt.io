import { describe, expect, it } from "vitest";

import {
  decimalFromMinorUnits,
  formatStoredAmount,
  normalizeStoredMoneyFields,
  parseMoneyDecimal,
  toMinorUnits,
} from "../lib/money";

describe("money", () => {
  it("converts USD amounts to minor units without float drift", () => {
    expect(toMinorUnits("19.99", "USD")).toBe(1999);
    expect(toMinorUnits(parseMoneyDecimal("0.1").plus("0.2"), "USD")).toBe(30);
  });

  it("respects zero-decimal currencies", () => {
    expect(toMinorUnits("1500", "JPY")).toBe(1500);
    expect(decimalFromMinorUnits(1500, "JPY").toString()).toBe("1500");
    expect(formatStoredAmount("1500", "JPY")).toBe("1500");
  });

  it("normalizes stored money fields consistently", () => {
    expect(
      normalizeStoredMoneyFields({
        amount: "19,99",
        currency: "usd",
      }),
    ).toMatchObject({
      amount: "19.99",
      amountValue: "19.990000",
      amountMinor: 1999,
      currency: "USD",
    });
  });
});
