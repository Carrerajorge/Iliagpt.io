import { db } from "../db";
import { payments, users } from "@shared/schema";
import { eq } from "drizzle-orm";

// Stripe reports amounts in the smallest currency unit. Most are 2-decimal (cents),
// but some are 0-decimal (JPY) or 3-decimal (BHD). Keep conversion logic centralized.
const STRIPE_ZERO_DECIMAL_CURRENCIES = new Set([
  "bif",
  "clp",
  "djf",
  "gnf",
  "jpy",
  "kmf",
  "krw",
  "mga",
  "pyg",
  "rwf",
  "ugx",
  "vnd",
  "vuv",
  "xaf",
  "xof",
  "xpf",
]);

const STRIPE_THREE_DECIMAL_CURRENCIES = new Set(["bhd", "jod", "kwd", "omr", "tnd"]);

function getStripeCurrencyExponent(currency: string | null | undefined): number {
  const c = String(currency || "").toLowerCase().trim();
  if (!c) return 2;
  if (STRIPE_ZERO_DECIMAL_CURRENCIES.has(c)) return 0;
  if (STRIPE_THREE_DECIMAL_CURRENCIES.has(c)) return 3;
  return 2;
}

export function formatStripeAmountToMajorUnit(amountMinor: unknown, currency: string | null | undefined): string {
  const n = typeof amountMinor === "number" ? amountMinor : Number(amountMinor || 0);
  if (!Number.isFinite(n)) return "0.00";
  const exponent = getStripeCurrencyExponent(currency);
  const divisor = Math.pow(10, exponent);
  return (n / divisor).toFixed(exponent);
}

function unixSecondsToDate(value: unknown): Date | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return new Date(value * 1000);
}

export function getStripeCustomerIdFromInvoice(invoice: any): string | null {
  const customer = invoice?.customer;
  if (!customer) return null;
  if (typeof customer === "string") return customer;
  if (typeof customer === "object" && typeof customer.id === "string") return customer.id;
  return null;
}

export function getStripePaymentIntentIdFromInvoice(invoice: any): string | null {
  const pi = invoice?.payment_intent;
  if (!pi) return null;
  if (typeof pi === "string") return pi;
  if (typeof pi === "object" && typeof pi.id === "string") return pi.id;
  return null;
}

export function getStripeChargeIdFromInvoice(invoice: any): string | null {
  const charge = invoice?.charge;
  if (typeof charge === "string") return charge;
  if (typeof charge === "object" && typeof charge.id === "string") return charge.id;

  const pi = invoice?.payment_intent;
  const latestCharge = typeof pi === "object" ? (pi as any)?.latest_charge : null;
  if (typeof latestCharge === "string") return latestCharge;
  if (latestCharge && typeof latestCharge === "object" && typeof (latestCharge as any).id === "string") {
    return (latestCharge as any).id;
  }

  return null;
}

export async function resolveUserIdFromStripeCustomerId(stripeCustomerId: string | null): Promise<string | null> {
  if (!stripeCustomerId) return null;
  const [result] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.stripeCustomerId, stripeCustomerId))
    .limit(1);
  return result?.id || null;
}

export async function upsertPaymentFromStripeInvoice(args: {
  invoice: any;
  status: "completed" | "failed";
  userId: string | null;
  plan?: string | null;
}): Promise<{ created: boolean }> {
  const { invoice, status, userId, plan } = args;

  const stripePaymentId = typeof invoice?.id === "string" ? invoice.id : null;
  if (!stripePaymentId) return { created: false };

  const currencyRaw = typeof invoice?.currency === "string" ? invoice.currency : "eur";
  const currency = currencyRaw.toUpperCase();

  const amountMinor =
    status === "completed"
      ? (typeof invoice?.amount_paid === "number" ? invoice.amount_paid : 0)
      : (typeof invoice?.amount_due === "number" ? invoice.amount_due : 0);
  const amount = formatStripeAmountToMajorUnit(amountMinor, currencyRaw);

  const occurredAt =
    unixSecondsToDate(invoice?.status_transitions?.paid_at) ||
    unixSecondsToDate(invoice?.created) ||
    new Date();

  const stripeCustomerId = getStripeCustomerIdFromInvoice(invoice);
  const stripePaymentIntentId = getStripePaymentIntentIdFromInvoice(invoice);
  const stripeChargeId = getStripeChargeIdFromInvoice(invoice);

  const billingReason = typeof invoice?.billing_reason === "string" ? invoice.billing_reason : "";
  const descriptionParts = ["stripe"];
  if (plan) descriptionParts.push(String(plan));
  if (billingReason) descriptionParts.push(`(${billingReason})`);
  const description = descriptionParts.join(" ").trim();

  // Use an upsert to avoid duplicates on webhook retries or concurrent processing.
  const insertValues: typeof payments.$inferInsert = {
    userId: userId || null,
    amount,
    amountValue: amount,
    amountMinor,
    currency,
    status,
    method: "stripe",
    description,
    stripePaymentId,
    stripeCustomerId,
    stripePaymentIntentId,
    stripeChargeId,
    createdAt: occurredAt,
  };

  const updateSet: Partial<typeof payments.$inferInsert> = {
    amount,
    amountValue: amount,
    amountMinor,
    currency,
    status,
    method: "stripe",
    description,
    createdAt: occurredAt,
  };

  if (stripeCustomerId) updateSet.stripeCustomerId = stripeCustomerId;
  if (stripePaymentIntentId) updateSet.stripePaymentIntentId = stripePaymentIntentId;
  if (stripeChargeId) updateSet.stripeChargeId = stripeChargeId;

  // `onConflictDoUpdate` doesn't expose whether we inserted or updated. We do two
  // steps so the sync endpoint can report created vs updated.
  const inserted = await db
    .insert(payments)
    .values(insertValues)
    .onConflictDoNothing({ target: payments.stripePaymentId })
    .returning({ id: payments.id });

  if (inserted.length > 0) {
    return { created: true };
  }

  // If we couldn't resolve userId for this event, don't overwrite an existing userId.
  if (userId) {
    updateSet.userId = userId;
  }

  await db.update(payments).set(updateSet).where(eq(payments.stripePaymentId, stripePaymentId));

  return { created: false };
}
