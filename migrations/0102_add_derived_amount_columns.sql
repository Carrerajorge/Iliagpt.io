-- Migration 0102: Add derived numeric/minor amount columns for payments & invoices
--
-- Context: The Drizzle schemas define amount_value (numeric) and amount_minor (bigint)
-- as derived columns from the legacy `amount` text field, used for robust filtering
-- and sorting. These columns were never migrated, causing
-- /api/admin/finance/payments and /api/admin/finance/payments/stats to 500 with
-- "Cannot convert undefined or null to object" and SQL template errors.

-- Payments
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "amount_value" numeric(18, 6);
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "amount_minor" bigint;

-- Invoices
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "amount_value" numeric(18, 6);
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "amount_minor" bigint;

-- Backfill amount_value from the legacy `amount` text column when possible.
-- Uses resilient parsing: handles both "1.234,56" and "1,234.56" formats.
UPDATE "payments"
SET "amount_value" = nullif(
  regexp_replace(
    CASE
      WHEN position('.' in "amount") > 0 AND position(',' in "amount") > 0
        THEN replace("amount", ',', '')
      ELSE replace("amount", ',', '.')
    END,
    '[^0-9.-]', '', 'g'
  ),
  ''
)::numeric
WHERE "amount_value" IS NULL AND "amount" IS NOT NULL AND "amount" <> '';

UPDATE "invoices"
SET "amount_value" = nullif(
  regexp_replace(
    CASE
      WHEN position('.' in "amount") > 0 AND position(',' in "amount") > 0
        THEN replace("amount", ',', '')
      ELSE replace("amount", ',', '.')
    END,
    '[^0-9.-]', '', 'g'
  ),
  ''
)::numeric
WHERE "amount_value" IS NULL AND "amount" IS NOT NULL AND "amount" <> '';
