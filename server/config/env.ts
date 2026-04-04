import dotenv from "dotenv";
import { z } from "zod";

const nodeEnv = process.env.NODE_ENV || "development";
const loadEnvLocal = process.env.LOAD_ENV_LOCAL === "true";
const envLoadedByBootstrap = process.env.ENV_LOADED_BY_BOOTSTRAP === "true";

// Load local overrides first, then defaults.
// .env.local is intended for development only; tests should be hermetic by default.
if (!envLoadedByBootstrap) {
  if (nodeEnv === "development" || loadEnvLocal) {
    dotenv.config({ path: ".env.local" });
  }
  dotenv.config();
}
// Backward compatible aliases for xAI keys used across different parts of the codebase.
process.env.XAI_API_KEY = process.env.XAI_API_KEY || process.env.GROK_API_KEY || process.env.ILIAGPT_API_KEY;

if (nodeEnv === "test") {
  // Keep route/unit tests hermetic: many modules import env eagerly even when the
  // database and session layer are mocked away by the test itself.
  process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://test:test@127.0.0.1:5432/iliagpt_test";
  process.env.SESSION_SECRET =
    process.env.SESSION_SECRET || "test-session-secret-1234567890abcdefghijklmnopqrstuvwxyz";
}

const boolish = z
  .preprocess((v) => {
    if (typeof v !== "string") return v;
    const t = v.trim().toLowerCase();
    if (t === "1") return "true";
    if (t === "0") return "false";
    return t;
  }, z.enum(["true", "false"]).default("false"))
  .transform((v) => v === "true");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.string().transform(Number).default("5000"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  DATABASE_READ_URL: z.string().optional(),

  // LLM keys
  GEMINI_API_KEY: z.string().optional(),
  GOOGLE_API_KEY: z.string().optional(), // backward/alternate name used in parts of the codebase
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().optional(),
  XAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  DEEPSEEK_API_KEY: z.string().optional(),

  // Optional model/baseURL overrides
  OPENAI_MODEL: z.string().optional(),
  ANTHROPIC_MODEL: z.string().optional(),
  DEEPSEEK_MODEL: z.string().optional(),
  DEEPSEEK_BASE_URL: z.string().optional(),

  SESSION_SECRET: z.string().min(1, "SESSION_SECRET is required"),

  BASE_URL: z.string().default("http://localhost:5000"),

  // Token encryption (required for storing OAuth tokens securely in production)
  TOKEN_ENCRYPTION_KEY: z.string().min(32, "TOKEN_ENCRYPTION_KEY must be at least 32 characters").optional(),

  // Admin / bootstrap (used by admin panel and production seeding)
  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_PASSWORD: z.string().optional(),
  ADMIN_REQUIRE_2FA: boolish.optional(),
  SEED_ON_START: boolish.optional(),

  // Dangerous operations: keep off by default, enable explicitly for one-off seeding tasks.
  ALLOW_CATALOG_SEEDING: boolish.optional(),
  ALLOW_STRIPE_PRODUCT_SEEDING: boolish.optional(),

  MICROSOFT_CLIENT_ID: z.string().optional(),
  MICROSOFT_CLIENT_SECRET: z.string().optional(),
  MICROSOFT_TENANT_ID: z.string().optional(),

  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

  AUTH0_DOMAIN: z.string().optional(),
  AUTH0_CLIENT_ID: z.string().optional(),
  AUTH0_CLIENT_SECRET: z.string().optional(),

  DB_POOL_MAX: z.string().transform(Number).default("20"),
  DB_POOL_MIN: z.string().transform(Number).default("2"),
  DB_READ_POOL_MAX: z.string().transform(Number).optional(),
  DB_READ_POOL_MIN: z.string().transform(Number).optional(),

  // Channels (Telegram / WhatsApp Cloud)
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_WEBHOOK_SECRET_TOKEN: z.string().optional(),
  TELEGRAM_WEBHOOK_URL: z.string().optional(),
  TELEGRAM_AUTO_SET_WEBHOOK: boolish.optional(),

  WHATSAPP_VERIFY_TOKEN: z.string().optional(),
  WHATSAPP_APP_SECRET: z.string().optional(),
  WHATSAPP_CLOUD_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_CLOUD_DEFAULT_USER_ID: z.string().optional(),

  // Messenger (Meta)
  MESSENGER_PAGE_ACCESS_TOKEN: z.string().optional(),
  MESSENGER_APP_SECRET: z.string().optional(),
  MESSENGER_VERIFY_TOKEN: z.string().optional(),
  MESSENGER_DEFAULT_USER_ID: z.string().optional(),

  // WeChat Official Account
  WECHAT_APP_ID: z.string().optional(),
  WECHAT_APP_SECRET: z.string().optional(),
  WECHAT_TOKEN: z.string().optional(),
  WECHAT_DEFAULT_USER_ID: z.string().optional(),

  // Channel ingest execution mode:
  // - auto: queue in production when Redis is configured, otherwise in-process
  // - queue: always enqueue to BullMQ (requires Redis + worker)
  // - inprocess: process inside web server (best for local dev)
  CHANNEL_INGEST_MODE: z.enum(["auto", "queue", "inprocess"]).default("auto"),
  MAX_CHANNEL_INGEST_JOB_BYTES: z.string().optional(),
  CHANNEL_INGEST_ATTEMPTS: z.string().optional(),
  CHANNEL_INGEST_BACKOFF_MS: z.string().optional(),
  CHANNEL_INGEST_IDEMPOTENCY_TTL_MS: z.string().optional(),
  CHANNEL_INGEST_IDEMPOTENCY_MAX_ENTRIES: z.string().optional(),
  CHANNEL_INGEST_QUEUE_FAILURE_THRESHOLD: z.string().optional(),
  CHANNEL_INGEST_QUEUE_CIRCUIT_OPEN_MS: z.string().optional(),
  CHANNEL_INGEST_QUEUE_BACKPRESSURE_LIMIT: z.string().optional(),
  CHANNEL_INGEST_QUEUE_OPERATION_TIMEOUT_MS: z.string().optional(),
  CHANNEL_INGEST_INPROCESS_CONCURRENCY: z.string().optional(),
  CHANNEL_INGEST_INPROCESS_TIMEOUT_MS: z.string().optional(),
  CHANNEL_INGEST_INPROCESS_QUEUE_MAX: z.string().optional(),
  CHANNEL_INGEST_INPROCESS_DEDUPE_TTL_MS: z.string().optional(),
  CHANNEL_INGEST_INPROCESS_RESERVATION_TTL_MS: z.string().optional(),

  // Request body limits. Keep configurable so chat/vision flows can raise them
  // without reopening the global DoS window for every API route.
  API_JSON_BODY_LIMIT: z.string().optional(),
  CHAT_STREAM_JSON_BODY_LIMIT: z.string().optional(),
  URLENCODED_BODY_LIMIT: z.string().optional(),
});

function validateEnv() {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error("❌ Invalid environment variables:");
    const errors = result.error.flatten().fieldErrors;
    Object.entries(errors).forEach(([key, msgs]) => {
      console.error(`   ${key}: ${msgs?.join(", ")}`);
    });
    process.exit(1);
  }

  // Warn about missing LLM keys
  const data = result.data;
  const cerebrasKey = process.env.CEREBRAS_API_KEY;
  const hasAnyLlm =
    Boolean(data.XAI_API_KEY) ||
    Boolean(data.GEMINI_API_KEY || data.GOOGLE_API_KEY) ||
    Boolean(data.OPENAI_API_KEY) ||
    Boolean(data.ANTHROPIC_API_KEY) ||
    Boolean(data.DEEPSEEK_API_KEY) ||
    Boolean(cerebrasKey);

  if (!hasAnyLlm) {
    console.warn("⚠️  WARNING: No LLM API keys configured (XAI_API_KEY, GEMINI_API_KEY/GOOGLE_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY, DEEPSEEK_API_KEY, CEREBRAS_API_KEY)");
    console.warn("   Chat functionality will not work without at least one LLM provider.");
  } else {
    const providers = [];
    if (data.XAI_API_KEY) providers.push("xAI");
    if (data.GEMINI_API_KEY || data.GOOGLE_API_KEY) providers.push("Gemini");
    if (data.OPENAI_API_KEY) providers.push("OpenAI");
    if (data.ANTHROPIC_API_KEY) providers.push("Anthropic");
    if (data.DEEPSEEK_API_KEY) providers.push("DeepSeek");
    if (cerebrasKey) providers.push("Cerebras");
    console.log(`✅ LLM Providers configured: ${providers.join(", ")}`);
  }

  // Session hardening: require a strong secret in production, warn in other envs.
  if (data.NODE_ENV === "production" && data.SESSION_SECRET.length < 32) {
    console.error("❌ SESSION_SECRET must be at least 32 characters in production.");
    process.exit(1);
  }
  if (data.NODE_ENV !== "production" && data.NODE_ENV !== "test" && data.SESSION_SECRET.length < 32) {
    console.warn("⚠️  WARNING: SESSION_SECRET should be at least 32 characters.");
  }

  // Security hardening: require a dedicated encryption key if OAuth token storage is enabled in production.
  // TokenManager falls back to a default key if unset, which is not acceptable for production.
  const oauthEnabled = Boolean(
    (data.GOOGLE_CLIENT_ID && data.GOOGLE_CLIENT_SECRET) ||
      (data.MICROSOFT_CLIENT_ID && data.MICROSOFT_CLIENT_SECRET) ||
      (data.AUTH0_DOMAIN && data.AUTH0_CLIENT_ID && data.AUTH0_CLIENT_SECRET)
  );
  if (data.NODE_ENV === "production" && oauthEnabled && !data.TOKEN_ENCRYPTION_KEY) {
    console.error("❌ TOKEN_ENCRYPTION_KEY is required in production when OAuth is enabled.");
    process.exit(1);
  }

  // Production bootstrap hardening: seed-production.ts runs on startup.
  if (data.NODE_ENV === "production") {
    if (!data.ADMIN_EMAIL) {
      console.error("❌ ADMIN_EMAIL is required in production.");
      process.exit(1);
    }
    if (!data.ADMIN_PASSWORD) {
      console.error("❌ ADMIN_PASSWORD is required in production.");
      process.exit(1);
    }
    if (data.ADMIN_PASSWORD && data.ADMIN_PASSWORD.length < 12) {
      console.warn("⚠️  WARNING: ADMIN_PASSWORD should be at least 12 characters in production.");
    }
  }

  // Channel hardening (best-effort warnings; keep optional to avoid breaking deployments
  // that don't use these connectors).
  if (data.TELEGRAM_BOT_TOKEN && !data.TELEGRAM_WEBHOOK_SECRET_TOKEN) {
    console.warn("⚠️  WARNING: TELEGRAM_WEBHOOK_SECRET_TOKEN is not set. Telegram webhook requests won't be authenticated.");
  }
  if (data.TELEGRAM_AUTO_SET_WEBHOOK && !data.TELEGRAM_WEBHOOK_URL) {
    console.warn("⚠️  WARNING: TELEGRAM_AUTO_SET_WEBHOOK=true but TELEGRAM_WEBHOOK_URL is not set. Webhook auto-registration will be skipped.");
  }
  if (data.WHATSAPP_VERIFY_TOKEN && !data.WHATSAPP_APP_SECRET) {
    console.warn("⚠️  WARNING: WHATSAPP_APP_SECRET is not set. WhatsApp Cloud webhook signatures will not be verified.");
  }
  if (data.MESSENGER_PAGE_ACCESS_TOKEN && !data.MESSENGER_VERIFY_TOKEN) {
    console.warn("⚠️  WARNING: MESSENGER_VERIFY_TOKEN is not set. Messenger webhook verification will reject all requests.");
  }
  if (data.MESSENGER_PAGE_ACCESS_TOKEN && !data.MESSENGER_APP_SECRET) {
    console.warn("⚠️  WARNING: MESSENGER_APP_SECRET is not set. Messenger webhook signatures will not be verified.");
  }
  if (data.WECHAT_APP_ID && !data.WECHAT_TOKEN) {
    console.warn("⚠️  WARNING: WECHAT_TOKEN is not set. WeChat webhook requests won't be authenticated.");
  }

  return data;
}

export const env = validateEnv();
