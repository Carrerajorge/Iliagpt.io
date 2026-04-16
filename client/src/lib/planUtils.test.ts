import { describe, it, expect } from "vitest";
import { getEffectivePlan, getPlanLabel, isPaidPlan } from "./planUtils";

describe("getEffectivePlan", () => {
  it("returns 'free' for null/undefined user", () => {
    expect(getEffectivePlan(null)).toBe("free");
    expect(getEffectivePlan(undefined)).toBe("free");
  });

  it("returns 'admin' for admin/superadmin roles", () => {
    expect(getEffectivePlan({ role: "admin" })).toBe("admin");
    expect(getEffectivePlan({ role: "superadmin" })).toBe("admin");
    expect(getEffectivePlan({ role: "ADMIN" })).toBe("admin");
    expect(getEffectivePlan({ role: "  Admin  " })).toBe("admin");
  });

  it("prefers active subscription plan", () => {
    expect(
      getEffectivePlan({ subscriptionStatus: "active", subscriptionPlan: "pro" })
    ).toBe("pro");
    expect(
      getEffectivePlan({ subscriptionStatus: "active", subscriptionPlan: "enterprise" })
    ).toBe("enterprise");
  });

  it("ignores inactive subscription", () => {
    expect(
      getEffectivePlan({ subscriptionStatus: "canceled", subscriptionPlan: "pro", plan: "free" })
    ).toBe("free");
    expect(
      getEffectivePlan({ subscriptionStatus: "past_due", subscriptionPlan: "pro" })
    ).toBe("free");
  });

  it("falls back to user.plan", () => {
    expect(getEffectivePlan({ plan: "go" })).toBe("go");
    expect(getEffectivePlan({ plan: "Plus" })).toBe("plus");
  });

  it("returns 'free' when no plan info", () => {
    expect(getEffectivePlan({})).toBe("free");
    expect(getEffectivePlan({ plan: null })).toBe("free");
    expect(getEffectivePlan({ plan: "" })).toBe("free");
  });
});

describe("getPlanLabel", () => {
  it("returns correct labels for known plans", () => {
    expect(getPlanLabel(null)).toBe("Free");
    expect(getPlanLabel({ role: "admin" })).toBe("Admin");
    expect(getPlanLabel({ subscriptionStatus: "active", subscriptionPlan: "enterprise" })).toBe("Enterprise");
    expect(getPlanLabel({ subscriptionStatus: "active", subscriptionPlan: "business" })).toBe("Enterprise");
    expect(getPlanLabel({ subscriptionStatus: "active", subscriptionPlan: "go" })).toBe("Go");
    expect(getPlanLabel({ subscriptionStatus: "active", subscriptionPlan: "plus" })).toBe("Plus");
    expect(getPlanLabel({ subscriptionStatus: "active", subscriptionPlan: "pro" })).toBe("Pro");
  });

  it("capitalizes unknown plans", () => {
    expect(getPlanLabel({ subscriptionStatus: "active", subscriptionPlan: "custom" })).toBe("Custom");
  });
});

describe("isPaidPlan", () => {
  it("returns false for free users", () => {
    expect(isPaidPlan(null)).toBe(false);
    expect(isPaidPlan({ plan: "free" })).toBe(false);
  });
  it("returns false for admin", () => {
    expect(isPaidPlan({ role: "admin" })).toBe(false);
  });
  it("returns true for paid plans", () => {
    expect(isPaidPlan({ subscriptionStatus: "active", subscriptionPlan: "pro" })).toBe(true);
    expect(isPaidPlan({ subscriptionStatus: "active", subscriptionPlan: "enterprise" })).toBe(true);
    expect(isPaidPlan({ plan: "go" })).toBe(true);
  });
});
