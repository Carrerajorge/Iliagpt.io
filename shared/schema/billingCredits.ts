import { sql } from "drizzle-orm";
import {
  pgTable,
  varchar,
  integer,
  text,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { users } from "./auth";

/**
 * Prepaid credit grants (top-ups) for token usage.
 *
 * Credits are consumed after the monthly plan allowance is exhausted and
 * each grant expires 12 months after purchase.
 */
export const billingCreditGrants = pgTable(
  "billing_credit_grants",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    creditsGranted: integer("credits_granted").notNull(),
    creditsRemaining: integer("credits_remaining").notNull(),
    // Stripe payment metadata (optional but useful for reconciliation/idempotency).
    currency: text("currency").notNull().default("usd"),
    amountMinor: integer("amount_minor").notNull(), // e.g. cents for USD
    stripeCheckoutSessionId: text("stripe_checkout_session_id"),
    stripePaymentIntentId: text("stripe_payment_intent_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    metadata: jsonb("metadata"),
  },
  (table: any) => [
    index("billing_credit_grants_user_idx").on(table.userId),
    index("billing_credit_grants_expires_idx").on(table.expiresAt),
    index("billing_credit_grants_user_expires_idx").on(table.userId, table.expiresAt),
    uniqueIndex("billing_credit_grants_checkout_session_unique").on(table.stripeCheckoutSessionId),
  ]
);

export type BillingCreditGrant = typeof billingCreditGrants.$inferSelect;
export type InsertBillingCreditGrant = typeof billingCreditGrants.$inferInsert;

