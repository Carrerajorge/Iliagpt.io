/** * MODEL REGISTRY - Single Source of Truth for all model IDs and defaults. * * Every file that references a model name MUST import from here. * This prevents the scattered, inconsistent model 
 references that * caused silent failures across the codebase. */

// ============================================================================
// XAI (Grok) Models
// ============================================================================

export const XAI_MODELS = {
  // Grok 4.1 Series
  GROK_4_1_FAST: "grok-4-1-fast-non-reasoning",
  GROK_4_1_FAST_REASONING: "grok-4-1-fast-reasoning",

  // Grok 4 Series
  GROK_4_FAST: "grok-4-fast-non-reasoning",
  GROK_4_FAST_REASONING: "grok-4-fast-reasoning",
  GROK_4_PREMIUM: "grok-4-0709",
  GROK_CODE: "grok-code-fast-1",

  // Grok 3 Series
  GROK_3: "grok-3",
  GROK_3_FAST: "grok-3-fast",
  GROK_3_MINI: "grok-3-mini",
  GROK_3_MINI_FAST: "grok-3-mini-fast",

  // Grok 2 (Legacy)
  GROK_2_VISION: "grok-2-vision-1212",
} as const;

// ============================================================================
// Local Models (Ollama, LM Studio)
// ============================================================================

export const LOCAL_MODELS = {
  LLAMA3: "llama3-8b",
  MISTRAL: "mistral",
} as const;

// ============================================================================
// Gemini Models
// ============================================================================

export const GEMINI_MODELS_REGISTRY = {
  PRO_31: "gemini-3.1-pro",
  FLASH_31: "gemini-3.1-flash",
  FLASH_PREVIEW: "gemini-3-flash-preview",
  PRO_PREVIEW: "gemini-3.1-pro-preview",
  FLASH_25: "gemini-2.5-flash",
  PRO_25: "gemini-2.5-pro",
  FLASH_20: "gemini-2.0-flash",
} as const;

// ============================================================================
// OpenRouter Models
// ============================================================================

export const OPENROUTER_MODELS = {
  KIMI_K2_5: "moonshotai/kimi-k2.5",
  GEMMA_4_31B_IT: "google/gemma-4-31b-it",
  GEMMA_3_27B_IT_FREE: "google/gemma-3-27b-it:free",
} as const;

// ============================================================================
// Defaults
// ============================================================================

/** Default xAI model for general text completion. */
export const DEFAULT_XAI_TEXT_MODEL = XAI_MODELS.GROK_4_1_FAST;

/** Default xAI model for reasoning / planning tasks. */
export const DEFAULT_XAI_REASONING_MODEL = XAI_MODELS.GROK_4_1_FAST_REASONING;

/** Default xAI model for vision tasks. */
export const DEFAULT_XAI_VISION_MODEL = XAI_MODELS.GROK_2_VISION;

/** Default Gemini model for general text completion. */
export const DEFAULT_GEMINI_TEXT_MODEL = GEMINI_MODELS_REGISTRY.PRO_31;

/** Default Gemini model for reasoning / planning tasks. */
export const DEFAULT_GEMINI_REASONING_MODEL = GEMINI_MODELS_REGISTRY.PRO_31;

/** Default Gemini model for vision tasks. */
export const DEFAULT_GEMINI_VISION_MODEL = GEMINI_MODELS_REGISTRY.FLASH_31;

/** Default provider (app-level). Routes through OpenRouter via OPENAI_BASE_URL. */
export const DEFAULT_PROVIDER = "openai" as const;

/** The model ID available to all users (free tier). */
export const FREE_MODEL_ID = OPENROUTER_MODELS.GEMMA_3_27B_IT_FREE;

export const FREE_MODEL_IDS: ReadonlySet<string> = new Set([
  "google/gemma-4-31b-it",
  XAI_MODELS.GROK_4_1_FAST,
]);

export function isModelFreeForAll(modelId: string): boolean {
  return FREE_MODEL_IDS.has(modelId);
}

/** Default model for general text completion (app-level). */
export const DEFAULT_TEXT_MODEL = FREE_MODEL_ID;

/** Default model for reasoning / planning tasks (app-level). */
export const DEFAULT_REASONING_MODEL = FREE_MODEL_ID;

/** Default model for vision tasks (app-level). */
export const DEFAULT_VISION_MODEL = FREE_MODEL_ID;

// ============================================================================
// Known Model Sets (for provider detection in llmGateway)
// ============================================================================

/** All xAI model IDs that the gateway should recognise. */
export const KNOWN_XAI_MODEL_IDS: ReadonlySet<string> = new Set(
  Object.values(XAI_MODELS).map((id) => id.toLowerCase()),
);

/** All Local model IDs that the gateway should recognise. */
export const KNOWN_LOCAL_MODEL_IDS: ReadonlySet<string> = new Set(
  Object.values(LOCAL_MODELS).map((id) => id.toLowerCase()),
);

/** All Gemini model IDs that the gateway should recognise. */
export const KNOWN_GEMINI_MODEL_IDS: ReadonlySet<string> = new Set([
  ...Object.values(GEMINI_MODELS_REGISTRY).map((id) => id.toLowerCase()),
  // Legacy IDs that may still appear in persisted data
  "gemini-3.1-pro",
  "gemini-3.1-flash",
  "gemini-2.0-flash",
  "gemini-1.5-flash",
  "gemini-1.5-pro",
  "gemini-2.0-pro",
]);

// ============================================================================
// Fallback Chains (used by circuit breaker and retry logic)
// ============================================================================

/**
 * When a model fails, try these alternatives in order.
 * All IDs MUST come from the constants above.
 */
export const FALLBACK_CHAINS: Readonly<Record<string, readonly string[]>> = {
  // Grok 4.1 series
  [XAI_MODELS.GROK_4_1_FAST]: [XAI_MODELS.GROK_4_FAST, XAI_MODELS.GROK_3_FAST],
  [XAI_MODELS.GROK_4_1_FAST_REASONING]: [XAI_MODELS.GROK_4_FAST_REASONING, XAI_MODELS.GROK_3_FAST],

  // Grok 4 series
  [XAI_MODELS.GROK_4_FAST]: [XAI_MODELS.GROK_4_1_FAST, XAI_MODELS.GROK_3_FAST],
  [XAI_MODELS.GROK_4_FAST_REASONING]: [XAI_MODELS.GROK_4_1_FAST_REASONING, XAI_MODELS.GROK_3_FAST],

  // Grok 3 series
  [XAI_MODELS.GROK_3]: [XAI_MODELS.GROK_3_FAST, XAI_MODELS.GROK_4_FAST],
  [XAI_MODELS.GROK_3_FAST]: [XAI_MODELS.GROK_4_FAST, XAI_MODELS.GROK_3],
  [XAI_MODELS.GROK_3_MINI]: [XAI_MODELS.GROK_3_MINI_FAST, XAI_MODELS.GROK_3_FAST],
  [XAI_MODELS.GROK_3_MINI_FAST]: [XAI_MODELS.GROK_3_MINI, XAI_MODELS.GROK_3_FAST],

  // Gemini
  [GEMINI_MODELS_REGISTRY.PRO_31]: [GEMINI_MODELS_REGISTRY.FLASH_31, GEMINI_MODELS_REGISTRY.PRO_25],
  [GEMINI_MODELS_REGISTRY.FLASH_31]: [GEMINI_MODELS_REGISTRY.FLASH_25, GEMINI_MODELS_REGISTRY.FLASH_20],
  [GEMINI_MODELS_REGISTRY.PRO_PREVIEW]: [GEMINI_MODELS_REGISTRY.PRO_31, GEMINI_MODELS_REGISTRY.PRO_25],
  [GEMINI_MODELS_REGISTRY.PRO_25]: [GEMINI_MODELS_REGISTRY.FLASH_25, GEMINI_MODELS_REGISTRY.FLASH_20],
  [GEMINI_MODELS_REGISTRY.FLASH_25]: [GEMINI_MODELS_REGISTRY.FLASH_PREVIEW, GEMINI_MODELS_REGISTRY.FLASH_20],
  [GEMINI_MODELS_REGISTRY.FLASH_20]: [GEMINI_MODELS_REGISTRY.FLASH_25],

};

// ============================================================================
// Pricing (USD per 1 M tokens)
// ============================================================================

export interface ModelPricingEntry {
  inputPerMillion: number;
  outputPerMillion: number;
}

export const MODEL_PRICING_REGISTRY: Readonly<Record<string, ModelPricingEntry>> = {
  // Local (Off-Grid - Free)
  [LOCAL_MODELS.LLAMA3]: { inputPerMillion: 0.00, outputPerMillion: 0.00 },
  [LOCAL_MODELS.MISTRAL]: { inputPerMillion: 0.00, outputPerMillion: 0.00 },

  // Grok 4.1
  [XAI_MODELS.GROK_4_1_FAST]: { inputPerMillion: 0.50, outputPerMillion: 2.00 },
  [XAI_MODELS.GROK_4_1_FAST_REASONING]: { inputPerMillion: 1.00, outputPerMillion: 4.00 },

  // Grok 4
  [XAI_MODELS.GROK_4_FAST]: { inputPerMillion: 0.50, outputPerMillion: 2.00 },
  [XAI_MODELS.GROK_4_FAST_REASONING]: { inputPerMillion: 1.00, outputPerMillion: 4.00 },
  [XAI_MODELS.GROK_4_PREMIUM]: { inputPerMillion: 3.00, outputPerMillion: 15.00 },
  [XAI_MODELS.GROK_CODE]: { inputPerMillion: 0.50, outputPerMillion: 2.00 },

  // Grok 3
  [XAI_MODELS.GROK_3]: { inputPerMillion: 3.00, outputPerMillion: 15.00 },
  [XAI_MODELS.GROK_3_FAST]: { inputPerMillion: 5.00, outputPerMillion: 25.00 },
  [XAI_MODELS.GROK_3_MINI]: { inputPerMillion: 0.30, outputPerMillion: 0.50 },
  [XAI_MODELS.GROK_3_MINI_FAST]: { inputPerMillion: 0.60, outputPerMillion: 4.00 },

  // Grok 2 (legacy)
  [XAI_MODELS.GROK_2_VISION]: { inputPerMillion: 2.00, outputPerMillion: 10.00 },

  // Gemini
  [GEMINI_MODELS_REGISTRY.PRO_31]: { inputPerMillion: 1.25, outputPerMillion: 5.00 },
  [GEMINI_MODELS_REGISTRY.FLASH_31]: { inputPerMillion: 0.075, outputPerMillion: 0.30 },
  [GEMINI_MODELS_REGISTRY.PRO_PREVIEW]: { inputPerMillion: 1.25, outputPerMillion: 5.00 },
  [GEMINI_MODELS_REGISTRY.PRO_25]: { inputPerMillion: 1.25, outputPerMillion: 5.00 },
  [GEMINI_MODELS_REGISTRY.FLASH_25]: { inputPerMillion: 0.075, outputPerMillion: 0.30 },
  [GEMINI_MODELS_REGISTRY.FLASH_20]: { inputPerMillion: 0.10, outputPerMillion: 0.40 },
  [GEMINI_MODELS_REGISTRY.FLASH_PREVIEW]: { inputPerMillion: 0.10, outputPerMillion: 0.40 },
  "gemini-3.1-pro-preview": { inputPerMillion: 1.25, outputPerMillion: 5.00 },
};
