/**
 * useTokenCounter — Real-time token estimation hook
 *
 * Provides debounced (300ms) token count estimation for the chat input.
 * Uses the same Math.ceil(length / 4) heuristic as the server's fast path.
 */

import { useState, useEffect, useRef } from "react";

export type TokenTier = "short" | "medium" | "long" | "very_long";

export interface TokenCounterResult {
  tokens: number;
  percentage: number;
  overBudget: boolean;
  tier: TokenTier;
  charCount: number;
}

// Default context budget for client-side estimation (conservative)
const DEFAULT_MODEL_BUDGET = 32_000;

// Model budget map (client-side knowledge of model limits)
const MODEL_BUDGETS: Record<string, number> = {
  "gemini-2.5-flash": 1_000_000,
  "gemini-2.5-pro": 1_000_000,
  "gemini-2.0-flash": 1_000_000,
  "gemini-1.5-pro": 2_000_000,
  "gpt-4o": 128_000,
  "gpt-4-turbo": 128_000,
  "gpt-4": 8_192,
  "gpt-3.5-turbo": 16_385,
  "claude-3.5-sonnet": 200_000,
  "claude-3-opus": 200_000,
  "deepseek-v3": 64_000,
  "deepseek-r1": 64_000,
  "grok-3": 131_072,
  "grok-2": 131_072,
};

function getModelBudget(model?: string): number {
  if (!model) return DEFAULT_MODEL_BUDGET;
  // Try exact match first
  if (MODEL_BUDGETS[model]) return MODEL_BUDGETS[model];
  // Try prefix match
  for (const [key, budget] of Object.entries(MODEL_BUDGETS)) {
    if (model.startsWith(key)) return budget;
  }
  return DEFAULT_MODEL_BUDGET;
}

function getTier(tokens: number): TokenTier {
  if (tokens < 100) return "short";
  if (tokens < 1000) return "medium";
  if (tokens < 4000) return "long";
  return "very_long";
}

export function useTokenCounter(
  text: string,
  model?: string,
  debounceMs = 300,
): TokenCounterResult {
  const [result, setResult] = useState<TokenCounterResult>({
    tokens: 0,
    percentage: 0,
    overBudget: false,
    tier: "short",
    charCount: 0,
  });

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);

    if (!text) {
      setResult({
        tokens: 0,
        percentage: 0,
        overBudget: false,
        tier: "short",
        charCount: 0,
      });
      return;
    }

    timerRef.current = setTimeout(() => {
      const tokens = Math.ceil(text.length / 4);
      const budget = getModelBudget(model);
      const percentage = Math.min((tokens / budget) * 100, 100);

      setResult({
        tokens,
        percentage,
        overBudget: tokens > budget,
        tier: getTier(tokens),
        charCount: text.length,
      });
    }, debounceMs);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [text, model, debounceMs]);

  return result;
}
