import { describe, expect, it } from "vitest";

import { computeWillDeactivate, isMissingUsersColumnError } from "./usageQuotaService";

describe("computeWillDeactivate", () => {
  it("returns true when a paid subscription is set to cancel at period end", () => {
    expect(
      computeWillDeactivate({
        subscriptionStatus: "active",
        subscriptionCancelAtPeriodEnd: true,
        subscriptionPeriodEnd: new Date(Date.now() + 86_400_000),
        subscriptionExpiresAt: null,
      } as any),
    ).toBe(true);
  });

  it("returns true for cancelled-like states while access remains active", () => {
    expect(
      computeWillDeactivate({
        subscriptionStatus: "cancelled",
        subscriptionCancelAtPeriodEnd: false,
        subscriptionPeriodEnd: null,
        subscriptionExpiresAt: new Date(Date.now() + 86_400_000),
      } as any),
    ).toBe(true);
  });

  it("returns false when there is no future billing boundary", () => {
    expect(
      computeWillDeactivate({
        subscriptionStatus: "active",
        subscriptionCancelAtPeriodEnd: true,
        subscriptionPeriodEnd: new Date(Date.now() - 60_000),
        subscriptionExpiresAt: null,
      } as any),
    ).toBe(false);
  });
});

describe("isMissingUsersColumnError", () => {
  it("detects nested postgres missing-column errors wrapped by Drizzle", () => {
    const error = new Error("Failed query");
    (error as any).query =
      'select "subscription_cancel_at_period_end" from "users" where "users"."id" = $1';
    (error as any).cause = {
      code: "42703",
      message: 'column "subscription_cancel_at_period_end" does not exist',
      routine: "errorMissingColumn",
    };

    expect(
      isMissingUsersColumnError(error, "subscription_cancel_at_period_end"),
    ).toBe(true);
  });

  it("ignores unrelated query failures", () => {
    const error = new Error("Failed query");
    (error as any).query = 'select "email" from "users" where "users"."id" = $1';
    (error as any).cause = {
      code: "23505",
      message: "duplicate key value violates unique constraint",
    };

    expect(
      isMissingUsersColumnError(error, "subscription_cancel_at_period_end"),
    ).toBe(false);
  });
});
