-- Seed baseline Gemini models so production has at least one available model.
--
-- Rationale:
-- - seed-production.ts enables these models on start, but only if the rows already exist.
-- - Some production DBs can have an empty ai_models table (fresh schema), causing /api/models/available to return {"models":[]}.
--
-- This migration is idempotent (safe to run multiple times).

INSERT INTO "ai_models" (
  "name",
  "provider",
  "model_id",
  "status",
  "model_type",
  "display_order",
  "is_enabled",
  "enabled_at"
)
SELECT
  v."name",
  v."provider",
  v."model_id",
  'active',
  'TEXT',
  v."display_order",
  'true',
  NOW()
FROM (
  VALUES
    ('Gemini 2.5 Flash', 'google', 'gemini-2.5-flash', 10),
    ('Gemini 2.5 Pro', 'google', 'gemini-2.5-pro', 20),
    ('Gemini 3 Flash Preview', 'google', 'gemini-3-flash-preview', 30),
    ('Gemini 2.0 Flash', 'google', 'gemini-2.0-flash', 40)
) AS v("name", "provider", "model_id", "display_order")
WHERE NOT EXISTS (
  SELECT 1
  FROM "ai_models" m
  WHERE m."provider" = v."provider" AND m."model_id" = v."model_id"
);

-- Ensure stable ordering even if rows already existed (e.g., previously inserted with display_order=0)
UPDATE "ai_models"
SET "display_order" = CASE "model_id"
  WHEN 'gemini-2.5-flash' THEN 10
  WHEN 'gemini-2.5-pro' THEN 20
  WHEN 'gemini-3-flash-preview' THEN 30
  WHEN 'gemini-2.0-flash' THEN 40
  ELSE "display_order"
END
WHERE "provider" = 'google'
  AND "model_id" IN ('gemini-2.5-flash','gemini-2.5-pro','gemini-3-flash-preview','gemini-2.0-flash')
  AND ("display_order" IS NULL OR "display_order" = 0);
