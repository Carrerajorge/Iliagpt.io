/**
 * Model-Aware Context Budgets
 *
 * Maps (provider, model) to precise context window sizes.
 * Used by ContextWindowManager and truncateContext() to make
 * model-specific budget decisions instead of a single global MAX_CONTEXT_TOKENS.
 */

export interface ContextBudget {
  maxInputTokens: number;
  maxOutputTokens: number;
  reserveForOutput: number;
  /** Effective input budget = maxInputTokens - reserveForOutput */
  effectiveInputBudget: number;
}

interface ModelBudgetEntry {
  pattern: RegExp;
  maxInput: number;
  maxOutput: number;
  reserve: number;
}

const BUDGET_TABLE: ModelBudgetEntry[] = [
  // Gemini family
  { pattern: /^gemini-2\.5-flash/i, maxInput: 1_048_576, maxOutput: 65_536, reserve: 65_536 },
  { pattern: /^gemini-2\.5-pro/i, maxInput: 1_048_576, maxOutput: 65_536, reserve: 65_536 },
  { pattern: /^gemini-2\.0/i, maxInput: 1_048_576, maxOutput: 8_192, reserve: 8_192 },
  { pattern: /^gemini-1\.5-pro/i, maxInput: 2_097_152, maxOutput: 8_192, reserve: 8_192 },
  { pattern: /^gemini-1\.5-flash/i, maxInput: 1_048_576, maxOutput: 8_192, reserve: 8_192 },
  { pattern: /^gemini/i, maxInput: 1_048_576, maxOutput: 8_192, reserve: 8_192 },

  // OpenAI family
  { pattern: /^gpt-4o/i, maxInput: 128_000, maxOutput: 16_384, reserve: 16_384 },
  { pattern: /^gpt-4-turbo/i, maxInput: 128_000, maxOutput: 4_096, reserve: 4_096 },
  { pattern: /^gpt-4/i, maxInput: 8_192, maxOutput: 4_096, reserve: 4_096 },
  { pattern: /^gpt-3\.5/i, maxInput: 16_385, maxOutput: 4_096, reserve: 4_096 },
  { pattern: /^o1-mini/i, maxInput: 128_000, maxOutput: 65_536, reserve: 16_384 },
  { pattern: /^o1/i, maxInput: 200_000, maxOutput: 100_000, reserve: 32_768 },
  { pattern: /^o3/i, maxInput: 200_000, maxOutput: 100_000, reserve: 32_768 },

  // Anthropic Claude family
  { pattern: /^claude-3\.5-sonnet/i, maxInput: 200_000, maxOutput: 8_192, reserve: 8_192 },
  { pattern: /^claude-3-opus/i, maxInput: 200_000, maxOutput: 4_096, reserve: 4_096 },
  { pattern: /^claude-3-haiku/i, maxInput: 200_000, maxOutput: 4_096, reserve: 4_096 },
  { pattern: /^claude/i, maxInput: 200_000, maxOutput: 8_192, reserve: 8_192 },

  // Deepseek
  { pattern: /^deepseek-v3/i, maxInput: 64_000, maxOutput: 8_192, reserve: 8_192 },
  { pattern: /^deepseek-r1/i, maxInput: 64_000, maxOutput: 8_192, reserve: 8_192 },
  { pattern: /^deepseek/i, maxInput: 64_000, maxOutput: 8_192, reserve: 8_192 },

  // xAI Grok
  { pattern: /^grok-3/i, maxInput: 131_072, maxOutput: 16_384, reserve: 16_384 },
  { pattern: /^grok-2/i, maxInput: 131_072, maxOutput: 8_192, reserve: 8_192 },
  { pattern: /^grok/i, maxInput: 131_072, maxOutput: 8_192, reserve: 8_192 },

  // Mistral
  { pattern: /^mistral-large/i, maxInput: 128_000, maxOutput: 4_096, reserve: 4_096 },
  { pattern: /^mistral/i, maxInput: 32_000, maxOutput: 4_096, reserve: 4_096 },
];

const DEFAULT_BUDGET: ContextBudget = {
  maxInputTokens: 32_000,
  maxOutputTokens: 4_096,
  reserveForOutput: 4_096,
  effectiveInputBudget: 28_000,
};

/**
 * Get the context budget for a given model.
 * Falls back to a conservative 32K budget for unknown models.
 */
export function getContextBudget(model?: string): ContextBudget {
  if (!model) return DEFAULT_BUDGET;

  for (const entry of BUDGET_TABLE) {
    if (entry.pattern.test(model)) {
      return {
        maxInputTokens: entry.maxInput,
        maxOutputTokens: entry.maxOutput,
        reserveForOutput: entry.reserve,
        effectiveInputBudget: entry.maxInput - entry.reserve,
      };
    }
  }

  return DEFAULT_BUDGET;
}

/**
 * Get budget by provider + model for cases where model name isn't enough.
 */
export function getContextBudgetByProvider(provider?: string, model?: string): ContextBudget {
  // Model name is usually enough. Provider is a fallback for ambiguous names.
  if (model) return getContextBudget(model);

  // Provider-level defaults
  switch (provider?.toLowerCase()) {
    case "gemini": return getContextBudget("gemini-2.5-flash");
    case "anthropic": return getContextBudget("claude-3.5-sonnet");
    case "openai": return getContextBudget("gpt-4o");
    case "deepseek": return getContextBudget("deepseek-v3");
    case "xai": return getContextBudget("grok-3");
    default: return DEFAULT_BUDGET;
  }
}
