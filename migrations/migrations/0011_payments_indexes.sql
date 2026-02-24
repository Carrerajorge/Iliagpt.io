-- Add indexes for faster payment queries and idempotency on Stripe invoice writes.

CREATE INDEX IF NOT EXISTS "payments_created_at_idx" ON "payments" USING btree ("created_at");
CREATE UNIQUE INDEX IF NOT EXISTS "payments_stripe_payment_id_unique_idx" ON "payments" USING btree ("stripe_payment_id");

