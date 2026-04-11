import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  consumeBillingCredits,
  createBillingCreditGrant,
  detectBillingCreditLedgerMode,
  getBillingCreditSummary,
  resetBillingCreditLedgerModeCache,
} from "../billingCreditLedgerService";

function makeDbMock() {
  return {
    execute: vi.fn(),
  };
}

function makeColumns(columns: string[]) {
  return {
    rows: columns.map((columnName) => ({ column_name: columnName })),
  };
}

describe("billingCreditLedgerService", () => {
  beforeEach(() => {
    resetBillingCreditLedgerModeCache();
  });

  it("detects the ledger schema when all current columns are present", async () => {
    const db = makeDbMock();
    db.execute.mockResolvedValueOnce(
      makeColumns([
        "id",
        "user_id",
        "credits_granted",
        "credits_remaining",
        "currency",
        "amount_minor",
        "stripe_payment_intent_id",
        "expires_at",
      ]),
    );

    await expect(detectBillingCreditLedgerMode(db as any)).resolves.toBe("ledger");
  });

  it("detects the legacy schema when only the historical amount column exists", async () => {
    const db = makeDbMock();
    db.execute.mockResolvedValueOnce(
      makeColumns(["id", "user_id", "amount", "reason", "stripe_checkout_session_id", "created_at"]),
    );

    await expect(detectBillingCreditLedgerMode(db as any)).resolves.toBe("legacy");
  });

  it("returns a zeroed summary when the billing credit table is missing", async () => {
    const db = makeDbMock();
    db.execute.mockResolvedValueOnce(makeColumns([]));

    await expect(getBillingCreditSummary("user-1", new Date("2026-04-11T00:00:00.000Z"), db as any)).resolves.toEqual({
      mode: "missing",
      extraCredits: 0,
      nextExpiry: null,
    });
  });

  it("summarizes extra credits from the ledger schema", async () => {
    const db = makeDbMock();
    db.execute
      .mockResolvedValueOnce(
        makeColumns([
          "id",
          "user_id",
          "credits_granted",
          "credits_remaining",
          "currency",
          "amount_minor",
          "stripe_payment_intent_id",
          "expires_at",
        ]),
      )
      .mockResolvedValueOnce({
        rows: [{ extra_credits: 4200, next_expiry: "2026-12-31T00:00:00.000Z" }],
      });

    const summary = await getBillingCreditSummary("user-1", new Date("2026-04-11T00:00:00.000Z"), db as any);

    expect(summary.mode).toBe("ledger");
    expect(summary.extraCredits).toBe(4200);
    expect(summary.nextExpiry?.toISOString()).toBe("2026-12-31T00:00:00.000Z");
  });

  it("summarizes extra credits from the legacy schema without expiry", async () => {
    const db = makeDbMock();
    db.execute
      .mockResolvedValueOnce(makeColumns(["id", "user_id", "amount", "created_at"]))
      .mockResolvedValueOnce({
        rows: [{ extra_credits: 1750 }],
      });

    await expect(getBillingCreditSummary("user-1", new Date("2026-04-11T00:00:00.000Z"), db as any)).resolves.toEqual({
      mode: "legacy",
      extraCredits: 1750,
      nextExpiry: null,
    });
  });

  it("creates a legacy credit grant idempotently when the checkout session already exists", async () => {
    const db = makeDbMock();
    db.execute
      .mockResolvedValueOnce(makeColumns(["id", "user_id", "amount", "created_at"]))
      .mockResolvedValueOnce({ rows: [{ id: "existing-grant" }] });

    const inserted = await createBillingCreditGrant(
      {
        userId: "user-1",
        creditsGranted: 1000,
        currency: "usd",
        amountMinor: 500,
        stripeCheckoutSessionId: "cs_test_existing",
        stripePaymentIntentId: null,
        createdAt: new Date("2026-04-11T00:00:00.000Z"),
        expiresAt: new Date("2027-04-11T00:00:00.000Z"),
        metadata: { source: "test" },
      },
      db as any,
    );

    expect(inserted).toBe(false);
    expect(db.execute).toHaveBeenCalledTimes(2);
  });

  it("consumes legacy credits from the oldest grants first", async () => {
    const db = makeDbMock();
    db.execute
      .mockResolvedValueOnce(makeColumns(["id", "user_id", "amount", "created_at"]))
      .mockResolvedValueOnce({
        rows: [
          { id: "grant-1", balance: 5 },
          { id: "grant-2", balance: 4 },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const charged = await consumeBillingCredits(db as any, "user-1", 7, new Date("2026-04-11T00:00:00.000Z"));

    expect(charged).toBe(7);
    expect(db.execute).toHaveBeenCalledTimes(4);
  });
});
