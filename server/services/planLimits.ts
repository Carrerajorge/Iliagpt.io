/**
 * Centralized Plan Limits Configuration
 *
 * Single source of truth for per-plan quotas, rate limits, features, and pricing.
 * Other services (usageQuotaService, userPlanRateLimiter, TenantBilling) should
 * migrate to importing from here over time.
 */

// ─── Interfaces ─────────────────────────────────────────────────────────────

export interface PlanFeatures {
  webSearch: boolean;
  codeExecution: boolean;
  documentGeneration: boolean;
  voiceChat: boolean;
  imageGeneration: boolean;
  browserAutomation: boolean;
}

export interface PlanConfig {
  name: string;
  displayName: string;
  tokensPerDay: number;           // -1 = unlimited
  queriesPerDay: number;          // -1 = unlimited
  queriesPerMinute: number;
  maxFileUploadMB: number;
  maxChats: number;               // -1 = unlimited
  modelsAllowed: string[] | "all";
  documentsPerDay: number;        // -1 = unlimited
  searchesPerDay: number;         // -1 = unlimited
  codeExecutionsPerDay: number;   // -1 = unlimited
  features: PlanFeatures;
  monthlyTokenLimit: number | null; // null = unlimited
  priceMonthlyUSD: number;
  priceYearlyUSD: number;
}

// ─── Plan Definitions ───────────────────────────────────────────────────────

const FREE_MODELS = [
  "grok-4-1-fast-non-reasoning",
  "gemini-2.0-flash",
  "deepseek-chat",
];

const PLAN_CONFIGS_MUTABLE: Record<string, PlanConfig> = {
  free: {
    name: "free",
    displayName: "Free",
    tokensPerDay: 50_000,
    queriesPerDay: 3,
    queriesPerMinute: 20,
    maxFileUploadMB: 10,
    maxChats: 50,
    modelsAllowed: FREE_MODELS,
    documentsPerDay: 3,
    searchesPerDay: 10,
    codeExecutionsPerDay: 5,
    features: {
      webSearch: true,
      codeExecution: false,
      documentGeneration: true,
      voiceChat: false,
      imageGeneration: false,
      browserAutomation: false,
    },
    monthlyTokenLimit: 100_000,
    priceMonthlyUSD: 0,
    priceYearlyUSD: 0,
  },
  pro: {
    name: "pro",
    displayName: "Pro",
    tokensPerDay: -1,
    queriesPerDay: -1,
    queriesPerMinute: 100,
    maxFileUploadMB: 100,
    maxChats: -1,
    modelsAllowed: "all",
    documentsPerDay: -1,
    searchesPerDay: -1,
    codeExecutionsPerDay: -1,
    features: {
      webSearch: true,
      codeExecution: true,
      documentGeneration: true,
      voiceChat: true,
      imageGeneration: true,
      browserAutomation: true,
    },
    monthlyTokenLimit: null,
    priceMonthlyUSD: 20,
    priceYearlyUSD: 192,
  },
  enterprise: {
    name: "enterprise",
    displayName: "Enterprise",
    tokensPerDay: -1,
    queriesPerDay: -1,
    queriesPerMinute: 500,
    maxFileUploadMB: 500,
    maxChats: -1,
    modelsAllowed: "all",
    documentsPerDay: -1,
    searchesPerDay: -1,
    codeExecutionsPerDay: -1,
    features: {
      webSearch: true,
      codeExecution: true,
      documentGeneration: true,
      voiceChat: true,
      imageGeneration: true,
      browserAutomation: true,
    },
    monthlyTokenLimit: null,
    priceMonthlyUSD: 50,
    priceYearlyUSD: 480,
  },
  admin: {
    name: "admin",
    displayName: "Administrador",
    tokensPerDay: -1,
    queriesPerDay: -1,
    queriesPerMinute: -1,
    maxFileUploadMB: -1,
    maxChats: -1,
    modelsAllowed: "all",
    documentsPerDay: -1,
    searchesPerDay: -1,
    codeExecutionsPerDay: -1,
    features: {
      webSearch: true,
      codeExecution: true,
      documentGeneration: true,
      voiceChat: true,
      imageGeneration: true,
      browserAutomation: true,
    },
    monthlyTokenLimit: null,
    priceMonthlyUSD: 0,
    priceYearlyUSD: 0,
  },
};

// Freeze all objects so consumers cannot mutate plan configs at runtime
for (const cfg of Object.values(PLAN_CONFIGS_MUTABLE)) {
  Object.freeze(cfg.features);
  Object.freeze(cfg);
}

export const PLAN_CONFIGS: Readonly<Record<string, PlanConfig>> =
  Object.freeze(PLAN_CONFIGS_MUTABLE);

// ─── Helper Functions ───────────────────────────────────────────────────────

const UNLIMITED = -1;

/** Returns the config for a plan, falling back to free if unknown. */
export function getPlanConfig(plan: string): PlanConfig {
  return PLAN_CONFIGS[plan] ?? PLAN_CONFIGS.free;
}

/** Checks whether a specific feature is enabled for the given plan. */
export function isFeatureAllowed(
  plan: string,
  feature: keyof PlanFeatures,
): boolean {
  if (plan === "admin") return true;
  return getPlanConfig(plan).features[feature];
}

/** Checks whether a model is available on the given plan. */
export function isModelAllowed(plan: string, modelId: string): boolean {
  if (plan === "admin") return true;
  const { modelsAllowed } = getPlanConfig(plan);
  return modelsAllowed === "all" || modelsAllowed.includes(modelId);
}

/** Returns true when a numeric limit represents "unlimited". */
export function isUnlimited(value: number): boolean {
  return value === UNLIMITED;
}

/** Returns the human-readable display name for a plan. */
export function getPlanDisplayName(plan: string): string {
  return getPlanConfig(plan).displayName;
}
