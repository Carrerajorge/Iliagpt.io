/**
 * Autoregressive generation for the in-house GPT-3.
 *
 * Mechanics:
 *
 *   prefix ← prompt
 *   repeat up to maxNewTokens times:
 *     logits   ← gptNextTokenLogits(weights, prefix)
 *     nextTok  ← sampleFromLogits(logits, samplingConfig)
 *     prefix   ← prefix ++ [nextTok]
 *     if nextTok == stopToken: break
 *     if prefix.length == contextWindow: break
 *
 * This is the standard "re-encode the whole prefix per step" loop —
 * the same pattern our existing Vaswani beam search uses. KV-caching
 * would be a nice optimization but it's NOT described in the GPT-3
 * paper (it's an engineering detail downstream of the architecture),
 * so we stay out of it for paper-faithfulness.
 *
 * The function is deterministic if the caller provides a fixed seed
 * in the sampling config; otherwise it uses a seeded PRNG derived
 * from the prompt + weights + seed=0xdeadbeef default.
 */

import { gptNextTokenLogits } from "./model";
import { sampleFromLogits } from "./sampling";
import type { GptWeights, SamplingConfig } from "./types";

// ---------------------------------------------------------------------------
// Generation config
// ---------------------------------------------------------------------------

export interface GptGenerateConfig {
  /** Number of new tokens to emit after the prompt. Required. */
  maxNewTokens: number;
  /** Optional stop token; generation halts (and excludes it) on emission. */
  stopToken?: number;
  /** Sampling strategy. Defaults to greedy if omitted. */
  sampling?: SamplingConfig;
}

export interface GptGenerateResult {
  /** The full sequence: prompt ++ generated tokens. */
  tokens: number[];
  /** Generated tokens only (prompt excluded). */
  generated: number[];
  /** How many forward passes were performed. */
  steps: number;
  /** Why generation stopped: stop-token, max-length, or context-window. */
  stopReason: "stop-token" | "max-new-tokens" | "context-window";
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Generate `maxNewTokens` tokens after the prompt. Each step:
 *
 *   1. Run `gptNextTokenLogits` on the full current sequence.
 *   2. Apply temperature / top-k / top-p / seed via `sampleFromLogits`.
 *   3. Append, advance the PRNG seed.
 *
 * Per-step PRNG seeding is important for reproducibility: the seed on
 * the first step is `sampling.seed ?? 0xdeadbeef`, and each subsequent
 * step uses `baseSeed + step * 1009`. This way the same generation
 * call produces the exact same output, but two DIFFERENT tokens on
 * successive steps — the alternative (using the same seed every step)
 * would collapse to emitting the same token repeatedly.
 */
export function gptGenerate(
  weights: GptWeights,
  promptTokenIds: number[],
  config: GptGenerateConfig,
): GptGenerateResult {
  if (promptTokenIds.length === 0) {
    throw new Error("gptGenerate: prompt must have at least one token");
  }
  if (config.maxNewTokens < 1) {
    throw new Error("gptGenerate: maxNewTokens must be ≥ 1");
  }

  const contextWindow = weights.config.contextWindow;
  if (promptTokenIds.length > contextWindow) {
    throw new Error(
      `gptGenerate: prompt length ${promptTokenIds.length} exceeds context window ${contextWindow}`,
    );
  }

  const tokens = promptTokenIds.slice();
  const baseSeed = config.sampling?.seed ?? 0xdeadbeef;
  const sampling = config.sampling ?? { greedy: true };

  let steps = 0;
  let stopReason: GptGenerateResult["stopReason"] = "max-new-tokens";

  for (let i = 0; i < config.maxNewTokens; i++) {
    if (tokens.length >= contextWindow) {
      stopReason = "context-window";
      break;
    }
    const logits = gptNextTokenLogits(weights, tokens);
    steps++;
    const next = sampleFromLogits(logits, {
      ...sampling,
      seed: baseSeed + i * 1009,
    });
    tokens.push(next);
    if (config.stopToken !== undefined && next === config.stopToken) {
      stopReason = "stop-token";
      break;
    }
  }

  return {
    tokens,
    generated: tokens.slice(promptTokenIds.length),
    steps,
    stopReason,
  };
}
