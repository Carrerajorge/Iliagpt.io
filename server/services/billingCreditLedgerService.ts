import { randomUUID } from "crypto";

import { sql } from "drizzle-orm";

import { db } from "../db";

type SqlExecutor = {
  execute: (query: unknown) => Promise<{ rows?: unknown[] }>;
};

export type BillingCreditLedgerMode = "ledger" | "legacy" | "missing";

export interface BillingCreditLedgerSummary {
  mode: BillingCreditLedgerMode;
  extraCredits: number;
  nextExpiry: Date | null;
}

export interface CreateBillingCreditGrantInput {
  userId: string;
  creditsGranted: number;
  currency: string;
  amountMinor: number;
  stripeCheckoutSessionId: string | null;
  stripePaymentIntentId: string | null;
  createdAt: Date;
  expiresAt: Date;
  metadata?: Record<string, unknown> | null;
}

const MODE_CACHE_TTL_MS = 60_000;
const LEDGER_REQUIRED_COLUMNS = new Set([
  "credits_granted",
  "credits_remaining",
  "currency",
  "amount_minor",
  "stripe_payment_intent_id",
  "expires_at",
]);

let cachedMode: { value: BillingCreditLedgerMode; expiresAt: number } | null = null;

function getErrorCode(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const directCode = "code" in error ? String((error as any).code || "") : "";
  if (directCode) return directCode;
  const cause = "cause" in error ? (error as any).cause : null;
  if (cause && typeof cause === "object" && "code" in cause) {
    return String((cause as any).code || "");
  }
  return "";
}

function isSchemaMismatchError(error: unknown): boolean {
  const code = getErrorCode(error);
  if (code === "42703" || code === "42P01") return true;
  const message = error instanceof Error ? error.message : String(error || "");
  return /column .* does not exist|relation .* does not exist/i.test(message);
}

function toSafeDate(value: unknown): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date : null;
}

function toSafeInt(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value || 0);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.round(numeric));
}

export function resetBillingCreditLedgerModeCache(): void {
  cachedMode = null;
}

export async function detectBillingCreditLedgerMode(
  execDb: SqlExecutor = db,
  options: { forceRefresh?: boolean } = {},
): Promise<BillingCreditLedgerMode> {
  const now = Date.now();
  if (!options.forceRefresh && cachedMode && cachedMode.expiresAt > now) {
    return cachedMode.value;
  }

  try {
    const result = await execDb.execute(sql`
      select column_name
      from information_schema.columns
      where table_schema = current_schema()
        and table_name = 'billing_credit_grants'
    `);

    const columns = new Set(
      (result.rows || []).map((row: any) => String(row?.column_name || "").trim()).filter(Boolean),
    );

    let mode: BillingCreditLedgerMode = "missing";
    if (columns.size > 0 && Array.from(LEDGER_REQUIRED_COLUMNS).every((column) => columns.has(column))) {
      mode = "ledger";
    } else if (columns.has("amount")) {
      mode = "legacy";
    }

    cachedMode = { value: mode, expiresAt: now + MODE_CACHE_TTL_MS };
    return mode;
  } catch {
    cachedMode = { value: "missing", expiresAt: now + 5_000 };
    return "missing";
  }
}

export async function getBillingCreditSummary(
  userId: string,
  now: Date = new Date(),
  execDb: SqlExecutor = db,
): Promise<BillingCreditLedgerSummary> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const mode = await detectBillingCreditLedgerMode(execDb, { forceRefresh: attempt > 0 });

    try {
      if (mode === "ledger") {
        const result = await execDb.execute(sql`
          select
            coalesce(sum(credits_remaining), 0)::int as extra_credits,
            min(expires_at) as next_expiry
          from billing_credit_grants
          where user_id = ${userId}
            and credits_remaining > 0
            and expires_at > ${now}
        `);
        const row = (result.rows || [])[0] as any;
        return {
          mode,
          extraCredits: toSafeInt(row?.extra_credits),
          nextExpiry: toSafeDate(row?.next_expiry),
        };
      }

      if (mode === "legacy") {
        const result = await execDb.execute(sql`
          select coalesce(sum(amount), 0)::int as extra_credits
          from billing_credit_grants
          where user_id = ${userId}
            and coalesce(amount, 0) > 0
        `);
        const row = (result.rows || [])[0] as any;
        return {
          mode,
          extraCredits: toSafeInt(row?.extra_credits),
          nextExpiry: null,
        };
      }

      return { mode, extraCredits: 0, nextExpiry: null };
    } catch (error) {
      if (attempt === 0 && isSchemaMismatchError(error)) {
        resetBillingCreditLedgerModeCache();
        continue;
      }
      throw error;
    }
  }

  return { mode: "missing", extraCredits: 0, nextExpiry: null };
}

export async function createBillingCreditGrant(
  input: CreateBillingCreditGrantInput,
  execDb: SqlExecutor = db,
): Promise<boolean> {
  const metadataJson = input.metadata ? JSON.stringify(input.metadata) : null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const mode = await detectBillingCreditLedgerMode(execDb, { forceRefresh: attempt > 0 });
    if (mode === "missing") {
      throw new Error("Billing credit storage is not available");
    }

    try {
      if (input.stripeCheckoutSessionId) {
        const existing = await execDb.execute(sql`
          select id
          from billing_credit_grants
          where stripe_checkout_session_id = ${input.stripeCheckoutSessionId}
          limit 1
        `);
        if ((existing.rows || []).length > 0) {
          return false;
        }
      }

      if (mode === "ledger") {
        await execDb.execute(sql`
          insert into billing_credit_grants (
            id,
            user_id,
            credits_granted,
            credits_remaining,
            currency,
            amount_minor,
            stripe_checkout_session_id,
            stripe_payment_intent_id,
            created_at,
            expires_at,
            metadata
          ) values (
            ${randomUUID()},
            ${input.userId},
            ${toSafeInt(input.creditsGranted)},
            ${toSafeInt(input.creditsGranted)},
            ${String(input.currency || "usd").trim() || "usd"},
            ${toSafeInt(input.amountMinor)},
            ${input.stripeCheckoutSessionId},
            ${input.stripePaymentIntentId},
            ${input.createdAt},
            ${input.expiresAt},
            ${metadataJson}::jsonb
          )
        `);
      } else {
        await execDb.execute(sql`
          insert into billing_credit_grants (
            id,
            user_id,
            amount,
            reason,
            stripe_checkout_session_id,
            metadata,
            created_at
          ) values (
            ${randomUUID()},
            ${input.userId},
            ${toSafeInt(input.creditsGranted)},
            ${"credits_topup"},
            ${input.stripeCheckoutSessionId},
            ${metadataJson}::jsonb,
            ${input.createdAt}
          )
        `);
      }

      return true;
    } catch (error) {
      if (attempt === 0 && isSchemaMismatchError(error)) {
        resetBillingCreditLedgerModeCache();
        continue;
      }
      throw error;
    }
  }

  return false;
}

export async function consumeBillingCredits(
  execDb: SqlExecutor,
  userId: string,
  creditsToConsume: number,
  now: Date = new Date(),
): Promise<number> {
  let remainingToConsume = toSafeInt(creditsToConsume);
  if (remainingToConsume <= 0) return 0;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const mode = await detectBillingCreditLedgerMode(execDb, { forceRefresh: attempt > 0 });

    try {
      if (mode === "missing") {
        return 0;
      }

      const result =
        mode === "ledger"
          ? await execDb.execute(sql`
              select id, credits_remaining as balance
              from billing_credit_grants
              where user_id = ${userId}
                and credits_remaining > 0
                and expires_at > ${now}
              order by expires_at asc, created_at asc
            `)
          : await execDb.execute(sql`
              select id, amount as balance
              from billing_credit_grants
              where user_id = ${userId}
                and coalesce(amount, 0) > 0
              order by created_at asc
            `);

      let charged = 0;
      for (const grant of (result.rows || []) as any[]) {
        if (remainingToConsume <= 0) break;
        const balance = toSafeInt(grant?.balance);
        if (balance <= 0) continue;

        const take = Math.min(balance, remainingToConsume);
        if (mode === "ledger") {
          await execDb.execute(sql`
            update billing_credit_grants
            set credits_remaining = greatest(coalesce(credits_remaining, 0) - ${take}, 0)
            where id = ${String(grant?.id || "")}
          `);
        } else {
          await execDb.execute(sql`
            update billing_credit_grants
            set amount = greatest(coalesce(amount, 0) - ${take}, 0)
            where id = ${String(grant?.id || "")}
          `);
        }

        remainingToConsume -= take;
        charged += take;
      }

      return charged;
    } catch (error) {
      if (attempt === 0 && isSchemaMismatchError(error)) {
        resetBillingCreditLedgerModeCache();
        continue;
      }
      throw error;
    }
  }

  return 0;
}
