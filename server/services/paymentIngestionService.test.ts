import { describe, expect, it } from "vitest";
import {
  formatStripeAmountToMajorUnit,
  getStripeChargeIdFromInvoice,
  getStripeCustomerIdFromInvoice,
  getStripePaymentIntentIdFromInvoice,
} from "./paymentIngestionService";

describe("paymentIngestionService", () => {
  describe("formatStripeAmountToMajorUnit", () => {
    it("formats 2-decimal currencies (USD)", () => {
      expect(formatStripeAmountToMajorUnit(1234, "usd")).toBe("12.34");
      expect(formatStripeAmountToMajorUnit("99", "USD")).toBe("0.99");
    });

    it("formats 0-decimal currencies (JPY)", () => {
      expect(formatStripeAmountToMajorUnit(1234, "jpy")).toBe("1234");
    });

    it("formats 3-decimal currencies (BHD)", () => {
      expect(formatStripeAmountToMajorUnit(1234, "bhd")).toBe("1.234");
    });

    it("returns a safe default for invalid amounts", () => {
      expect(formatStripeAmountToMajorUnit("not-a-number", "usd")).toBe("0.00");
    });
  });

  describe("getStripeCustomerIdFromInvoice", () => {
    it("returns a customer id when customer is a string", () => {
      expect(getStripeCustomerIdFromInvoice({ customer: "cus_123" })).toBe("cus_123");
    });

    it("returns a customer id when customer is an object", () => {
      expect(getStripeCustomerIdFromInvoice({ customer: { id: "cus_abc" } })).toBe("cus_abc");
    });

    it("returns null when missing or invalid", () => {
      expect(getStripeCustomerIdFromInvoice({})).toBe(null);
      expect(getStripeCustomerIdFromInvoice({ customer: 123 })).toBe(null);
    });
  });

  describe("getStripePaymentIntentIdFromInvoice", () => {
    it("returns an intent id when payment_intent is a string", () => {
      expect(getStripePaymentIntentIdFromInvoice({ payment_intent: "pi_123" })).toBe("pi_123");
    });

    it("returns an intent id when payment_intent is an object", () => {
      expect(getStripePaymentIntentIdFromInvoice({ payment_intent: { id: "pi_abc" } })).toBe("pi_abc");
    });

    it("returns null when missing or invalid", () => {
      expect(getStripePaymentIntentIdFromInvoice({})).toBe(null);
      expect(getStripePaymentIntentIdFromInvoice({ payment_intent: 123 })).toBe(null);
    });
  });

  describe("getStripeChargeIdFromInvoice", () => {
    it("returns a charge id when charge is a string", () => {
      expect(getStripeChargeIdFromInvoice({ charge: "ch_123" })).toBe("ch_123");
    });

    it("returns a charge id when charge is an object", () => {
      expect(getStripeChargeIdFromInvoice({ charge: { id: "ch_abc" } })).toBe("ch_abc");
    });

    it("returns latest_charge from an expanded payment_intent", () => {
      expect(getStripeChargeIdFromInvoice({ payment_intent: { latest_charge: "ch_latest" } })).toBe("ch_latest");
      expect(getStripeChargeIdFromInvoice({ payment_intent: { latest_charge: { id: "ch_latest_obj" } } })).toBe("ch_latest_obj");
    });

    it("returns null when missing or invalid", () => {
      expect(getStripeChargeIdFromInvoice({})).toBe(null);
      expect(getStripeChargeIdFromInvoice({ charge: 123 })).toBe(null);
    });
  });
});
