-- Track authenticated/anonymous user identity for express-session (connect-pg-simple)
-- and backfill conversation_states.user_id from chats.user_id when missing.

ALTER TABLE IF EXISTS "sessions" ADD COLUMN IF NOT EXISTS "user_id" varchar;
--> statement-breakpoint
ALTER TABLE IF EXISTS "sessions" ADD COLUMN IF NOT EXISTS "created_at" timestamp DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE IF EXISTS "sessions" ADD COLUMN IF NOT EXISTS "updated_at" timestamp DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE IF EXISTS "sessions" ADD COLUMN IF NOT EXISTS "last_seen_at" timestamp;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "sessions_user_idx" ON "sessions" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sessions_user_expire_idx" ON "sessions" USING btree ("user_id","expire");
--> statement-breakpoint

CREATE OR REPLACE FUNCTION sessions_set_user_id_and_timestamps()
RETURNS trigger AS $$
DECLARE
  uid text;
  passport_user jsonb;
  sess_jsonb jsonb;
BEGIN
  uid := NULL;
  -- connect-pg-simple historically uses `json`, while our drizzle schema uses `jsonb`.
  -- Cast defensively so the trigger works with either.
  sess_jsonb := NEW.sess::jsonb;

  -- Explicit session-bound auth user id (email/password + admin login routes)
  IF sess_jsonb ? 'authUserId' THEN
    uid := sess_jsonb->>'authUserId';
  END IF;

  -- Passport-managed identity:
  -- - passport may store a string user id or an object (depending on serializeUser)
  IF uid IS NULL AND sess_jsonb ? 'passport' THEN
    passport_user := sess_jsonb->'passport'->'user';

    IF passport_user IS NOT NULL THEN
      IF jsonb_typeof(passport_user) = 'string' THEN
        uid := sess_jsonb->'passport'->>'user';
      ELSIF jsonb_typeof(passport_user) = 'object' THEN
        uid := passport_user->'claims'->>'sub';
        IF uid IS NULL THEN
          uid := passport_user->>'id';
        END IF;
      END IF;
    END IF;
  END IF;

  -- Anonymous sessions (optional)
  IF uid IS NULL AND sess_jsonb ? 'anonUserId' THEN
    uid := sess_jsonb->>'anonUserId';
  END IF;

  NEW.user_id := uid;

  IF TG_OP = 'INSERT' THEN
    NEW.created_at := COALESCE(NEW.created_at, now());
  END IF;

  NEW.updated_at := now();
  NEW.last_seen_at := now();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS "sessions_set_user_id_and_timestamps_trigger" ON "sessions";
--> statement-breakpoint
CREATE TRIGGER "sessions_set_user_id_and_timestamps_trigger"
BEFORE INSERT OR UPDATE ON "sessions"
FOR EACH ROW
EXECUTE FUNCTION sessions_set_user_id_and_timestamps();
--> statement-breakpoint

-- Backfill user_id for existing rows (fires the trigger).
UPDATE "sessions" SET "sess" = "sess" WHERE "user_id" IS NULL;
--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='conversation_states')
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='chats') THEN
    EXECUTE '
      UPDATE conversation_states cs
      SET user_id = c.user_id,
          updated_at = NOW()
      FROM chats c
      WHERE cs.chat_id = c.id
        AND cs.user_id IS NULL
        AND c.user_id IS NOT NULL
    ';
  END IF;
END $$;
