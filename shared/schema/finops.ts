import { pgTable, text, timestamp, integer, uuid, doublePrecision, boolean, jsonb } from "drizzle-orm/pg-core";

// --- T100-2.1: CATÁLOGO DE MODELOS Y PRICING OFICIAL ---
export const pricingCatalog = pgTable("pricing_catalog", {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull(), // e.g. 'openai', 'anthropic', 'xai', 'gemini'
    model: text("model").notNull(), // e.g. 'gpt-4o', 'claude-3-opus'

    // Cost per 1M tokens in USD
    inputCostPerMillion: doublePrecision("input_cost_per_million").notNull(),
    outputCostPerMillion: doublePrecision("output_cost_per_million").notNull(),

    contextWindow: integer("context_window").notNull(),
    maxOutputTokens: integer("max_output_tokens"),

    // Limits
    rpmLimit: integer("rpm_limit"), // Requests Per Minute
    tpmLimit: integer("tpm_limit"), // Tokens Per Minute

    status: text("status").notNull().default('enabled'), // enabled | disabled | deprecated | canary
    pricingVersion: text("pricing_version").notNull().default('v1'),

    effectiveDate: timestamp("effective_date").notNull().defaultNow(),
    deprecatedDate: timestamp("deprecated_date"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow()
});

// --- T100-2.2: MEDICIÓN DE TOKENS POR REQUEST (LEDGER AUDITABLE) ---
export const tokenLedgerUsage = pgTable("token_ledger_usage", {
    id: uuid("id").primaryKey().defaultRandom(),
    requestId: text("request_id").notNull(), // Corelated with x-correlation-id Pino log
    sessionId: text("session_id"),

    userId: text("user_id"),
    workspaceId: text("workspace_id"),

    modelId: uuid("model_id").references(() => pricingCatalog.id),
    modelName: text("model_name").notNull(), // Snapshot of the model string used

    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheTokens: integer("cache_tokens").notNull().default(0),

    totalTokens: integer("total_tokens").notNull().default(0),

    // Calculated cost in USD
    calculatedInputCost: doublePrecision("calculated_input_cost").notNull().default(0),
    calculatedOutputCost: doublePrecision("calculated_output_cost").notNull().default(0),
    totalCalculatedCost: doublePrecision("total_calculated_cost").notNull().default(0),

    latencyMs: integer("latency_ms"),

    wasFallback: boolean("was_fallback").default(false),
    fallbackFromModel: text("fallback_from_model"),

    metadata: jsonb("metadata"), // Free field for feature tracing

    createdAt: timestamp("created_at").notNull().defaultNow(),
});
