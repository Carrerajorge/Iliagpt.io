import { db } from "./db";
import { sql } from "drizzle-orm";

export async function runStartupMigrations(): Promise<void> {
  const migrations: Array<{ name: string; query: string }> = [
    {
      name: "create_oauth_states",
      query: `
        CREATE TABLE IF NOT EXISTS oauth_states (
          state varchar(255) PRIMARY KEY,
          return_url text NOT NULL DEFAULT '/',
          provider varchar(50) NOT NULL DEFAULT 'google',
          created_at timestamp DEFAULT now() NOT NULL,
          expires_at timestamp NOT NULL
        );
        CREATE INDEX IF NOT EXISTS oauth_states_expires_idx ON oauth_states (expires_at);
      `,
    },
    {
      name: "create_auth_tokens",
      query: `
        CREATE TABLE IF NOT EXISTS auth_tokens (
          id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          provider varchar(50) NOT NULL,
          access_token text NOT NULL,
          refresh_token text,
          expires_at bigint,
          scope text,
          created_at timestamp DEFAULT now() NOT NULL,
          updated_at timestamp DEFAULT now() NOT NULL
        );
        CREATE INDEX IF NOT EXISTS auth_tokens_user_provider_idx ON auth_tokens (user_id, provider);
        CREATE UNIQUE INDEX IF NOT EXISTS auth_tokens_unique_user_provider ON auth_tokens (user_id, provider);
      `,
    },
    {
      name: "create_user_identities",
      query: `
        CREATE TABLE IF NOT EXISTS user_identities (
          id varchar(255) PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id varchar(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          provider text NOT NULL,
          provider_subject text NOT NULL,
          provider_email text,
          email_verified boolean DEFAULT false,
          metadata jsonb,
          linked_at timestamp DEFAULT now() NOT NULL,
          last_used_at timestamp
        );
        CREATE UNIQUE INDEX IF NOT EXISTS user_identities_provider_subject_idx ON user_identities (provider, provider_subject);
        CREATE INDEX IF NOT EXISTS user_identities_user_idx ON user_identities (user_id);
        CREATE INDEX IF NOT EXISTS user_identities_provider_idx ON user_identities (provider);
      `,
    },
    {
      name: "create_magic_links",
      query: `
        CREATE TABLE IF NOT EXISTS magic_links (
          id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id varchar NOT NULL,
          token varchar NOT NULL UNIQUE,
          expires_at timestamp NOT NULL,
          used boolean DEFAULT false NOT NULL,
          created_at timestamp DEFAULT now() NOT NULL
        );
        CREATE INDEX IF NOT EXISTS magic_links_token_idx ON magic_links (token);
        CREATE INDEX IF NOT EXISTS magic_links_user_idx ON magic_links (user_id);
      `,
    },
    {
      name: "add_users_missing_columns",
      query: `
        ALTER TABLE users ADD COLUMN IF NOT EXISTS email_canonical text;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS openclaw_tokens_consumed integer DEFAULT 0;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_verified text DEFAULT 'false';
        ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret text;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled boolean DEFAULT false;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_status text;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_plan text;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_period_end timestamp;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS monthly_token_limit integer;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS monthly_tokens_used integer;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS tokens_reset_at timestamp;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS preferences jsonb;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at timestamp;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_input_tokens_used integer DEFAULT 0;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_output_tokens_used integer DEFAULT 0;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_input_tokens_limit integer;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_output_tokens_limit integer;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_token_usage_reset_at timestamp;
      `,
    },
    {
      name: "add_user_memories_missing_columns",
      query: `
        ALTER TABLE user_memories ADD COLUMN IF NOT EXISTS category text;
        ALTER TABLE user_memories ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true;
        ALTER TABLE user_memories ADD COLUMN IF NOT EXISTS expires_at timestamp;
        ALTER TABLE user_memories ADD COLUMN IF NOT EXISTS updated_at timestamp DEFAULT now();
      `,
    },
    {
      name: "create_billing_credit_grants",
      query: `
        CREATE TABLE IF NOT EXISTS billing_credit_grants (
          id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id varchar NOT NULL,
          amount integer NOT NULL DEFAULT 0,
          reason text,
          stripe_checkout_session_id text,
          metadata jsonb,
          created_at timestamp DEFAULT now() NOT NULL
        );
        CREATE INDEX IF NOT EXISTS billing_credit_grants_user_idx ON billing_credit_grants (user_id);
      `,
    },
    {
      name: "upgrade_billing_credit_grants_ledger_columns",
      query: `
        ALTER TABLE IF EXISTS billing_credit_grants ADD COLUMN IF NOT EXISTS credits_granted integer;
        ALTER TABLE IF EXISTS billing_credit_grants ADD COLUMN IF NOT EXISTS credits_remaining integer;
        ALTER TABLE IF EXISTS billing_credit_grants ADD COLUMN IF NOT EXISTS currency text DEFAULT 'usd';
        ALTER TABLE IF EXISTS billing_credit_grants ADD COLUMN IF NOT EXISTS amount_minor integer;
        ALTER TABLE IF EXISTS billing_credit_grants ADD COLUMN IF NOT EXISTS stripe_payment_intent_id text;
        ALTER TABLE IF EXISTS billing_credit_grants ADD COLUMN IF NOT EXISTS expires_at timestamp;

        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = current_schema()
              AND table_name = 'billing_credit_grants'
              AND column_name = 'amount'
          ) THEN
            UPDATE billing_credit_grants
            SET
              credits_granted = COALESCE(credits_granted, amount, 0),
              credits_remaining = COALESCE(credits_remaining, amount, 0),
              currency = COALESCE(NULLIF(currency, ''), 'usd'),
              amount_minor = COALESCE(amount_minor, 0),
              expires_at = COALESCE(expires_at, COALESCE(created_at, NOW()) + INTERVAL '12 months')
            WHERE credits_granted IS NULL
               OR credits_remaining IS NULL
               OR currency IS NULL
               OR amount_minor IS NULL
               OR expires_at IS NULL;
          ELSE
            UPDATE billing_credit_grants
            SET
              credits_granted = COALESCE(credits_granted, 0),
              credits_remaining = COALESCE(credits_remaining, credits_granted, 0),
              currency = COALESCE(NULLIF(currency, ''), 'usd'),
              amount_minor = COALESCE(amount_minor, 0),
              expires_at = COALESCE(expires_at, COALESCE(created_at, NOW()) + INTERVAL '12 months')
            WHERE credits_granted IS NULL
               OR credits_remaining IS NULL
               OR currency IS NULL
               OR amount_minor IS NULL
               OR expires_at IS NULL;
          END IF;
        END $$;

        CREATE INDEX IF NOT EXISTS billing_credit_grants_expires_idx ON billing_credit_grants (expires_at);
        CREATE INDEX IF NOT EXISTS billing_credit_grants_user_expires_idx ON billing_credit_grants (user_id, expires_at);
      `,
    },
  ];

  for (const migration of migrations) {
    try {
      await db.execute(sql.raw(migration.query));
    } catch (err: any) {
      console.warn(`[StartupMigration] ${migration.name} warning: ${err?.message?.split("\n")[0] || err}`);
    }
  }
}
