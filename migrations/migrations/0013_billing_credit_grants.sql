CREATE TABLE IF NOT EXISTS "billing_credit_grants" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "credits_granted" integer NOT NULL,
  "credits_remaining" integer NOT NULL,
  "currency" text NOT NULL DEFAULT 'usd',
  "amount_minor" integer NOT NULL,
  "stripe_checkout_session_id" text,
  "stripe_payment_intent_id" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "expires_at" timestamp NOT NULL,
  "metadata" jsonb
);

CREATE INDEX IF NOT EXISTS "billing_credit_grants_user_idx" ON "billing_credit_grants" ("user_id");
CREATE INDEX IF NOT EXISTS "billing_credit_grants_expires_idx" ON "billing_credit_grants" ("expires_at");
CREATE INDEX IF NOT EXISTS "billing_credit_grants_user_expires_idx" ON "billing_credit_grants" ("user_id", "expires_at");
CREATE UNIQUE INDEX IF NOT EXISTS "billing_credit_grants_checkout_session_unique" ON "billing_credit_grants" ("stripe_checkout_session_id");

