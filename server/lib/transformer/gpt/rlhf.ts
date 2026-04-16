/**
 * RLHF primitives (GPT-4 Technical Report, §2.3 via InstructGPT).
 *
 *   "We trained models to refuse harmful requests using RLHF. In RLHF,
 *    we collect human comparison data between model samples and then
 *    train a reward model on this data. We then use this reward model
 *    to train the base model using proximal policy optimization (PPO)
 *    [...]" — GPT-4 paper §2.3 and the InstructGPT paper it cites.
 *
 * The full RLHF pipeline has three stages:
 *
 *   1. SFT (Supervised Fine-Tuning) — fine-tune the base LM on
 *      human-written demonstrations. Uses ordinary cross-entropy
 *      loss. We already have the building blocks for this: just a
 *      supervised training loop over `gptNextTokenLogits`.
 *
 *   2. Reward Modeling — train a scalar head on top of the LM's
 *      hidden state to predict which of two candidate completions a
 *      human annotator would prefer. This file builds:
 *        • `initRewardHead(config)` — scalar projection, 1-D output
 *        • `gptReward(lastHidden, head)` — scalar reward for a seq
 *        • `bradleyTerryLoss(rChosen, rRejected)` — CE on the implied
 *          σ(r_chosen − r_rejected) preference distribution.
 *
 *   3. RL Fine-Tuning — use REINFORCE / PPO to update the policy
 *      against the reward signal, with a KL-divergence penalty
 *      against the SFT baseline to stay close to well-formed text.
 *      This file builds the minimal REINFORCE gradient estimator;
 *      full PPO (clipped surrogate objective, value function) is a
 *      deliberate non-goal for this audit pass.
 *
 * Every primitive lives as a pure function with no hidden global
 * state, matching the style of the rest of the math library.
 */

import {
  type Matrix,
  zeros,
  truncatedNormal,
  matmul,
  sliceRows,
} from "../matrix";
import type { GptConfig } from "./types";

// ---------------------------------------------------------------------------
// Reward head
// ---------------------------------------------------------------------------

export interface GptRewardHeadWeights {
  /** Scalar projection vector W ∈ R^(H, 1). */
  weight: Matrix;
  /** Scalar bias ∈ R. */
  bias: number;
}

/**
 * Initialize a reward head for a given GPT config. Uses the same
 * TruncatedNormal(σ=0.02) init as the rest of the stack.
 */
export function initGptRewardHead(
  config: GptConfig,
  seed = 60000,
): GptRewardHeadWeights {
  return {
    weight: truncatedNormal(config.hiddenSize, 1, config.initStdDev, seed),
    bias: 0,
  };
}

/**
 * Compute a scalar reward for a sequence from its final hidden state.
 *
 * Convention (following InstructGPT / GPT-4): the reward model reads
 * the hidden state at the LAST position of the sequence (the end of
 * the generated completion, typically right before the `<|endoftext|>`
 * token). For GPT-style models this position sees the whole context
 * under the causal mask, so it's the natural summarization point.
 *
 *   r(x) = W · h_last + b                    (scalar)
 *
 * Takes `sequenceOutput` from `runGptStack` — shape (seqLen, H) —
 * and extracts the last row internally.
 */
export function gptReward(
  sequenceOutput: Matrix,
  head: GptRewardHeadWeights,
): number {
  if (sequenceOutput.rows === 0) {
    throw new Error("gptReward: empty sequenceOutput");
  }
  const lastRow = sliceRows(sequenceOutput, sequenceOutput.rows - 1, sequenceOutput.rows);
  // (1, H) · (H, 1) → scalar
  const dot = matmul(lastRow, head.weight);
  return dot.data[0] + head.bias;
}

// ---------------------------------------------------------------------------
// Bradley-Terry preference loss
// ---------------------------------------------------------------------------

export interface PreferenceLossResult {
  /** Scalar loss (always ≥ 0). */
  loss: number;
  /** Probability that the chosen completion wins under the current rewards. */
  probChosenWins: number;
  /** Signed reward gap `r_chosen − r_rejected`. Positive = model already agrees with the human. */
  rewardGap: number;
}

/**
 * Bradley-Terry preference loss: given two scalar rewards for a
 * "chosen" and "rejected" completion of the same prompt, compute the
 * negative log-likelihood that the chosen one wins under the implied
 * Bradley-Terry model:
 *
 *   P(chosen ≻ rejected) = σ(r_chosen − r_rejected)
 *   loss                  = −log σ(r_chosen − r_rejected)
 *                         = softplus(r_rejected − r_chosen)
 *
 * This is the loss that OpenAI, Anthropic and DeepMind all use for
 * reward model training (InstructGPT §3.3, Constitutional AI §3.3,
 * Sparrow §3.2). Numerically stable: uses `log(1 + exp(-x))` via
 * the softplus form so extreme rewards don't saturate.
 */
export function bradleyTerryLoss(
  rChosen: number,
  rRejected: number,
): PreferenceLossResult {
  const gap = rChosen - rRejected;
  // Stable softplus(-gap) = log(1 + exp(-gap))
  const loss = gap >= 0 ? Math.log1p(Math.exp(-gap)) : -gap + Math.log1p(Math.exp(gap));
  // σ(gap) via stable form
  const probChosenWins = gap >= 0 ? 1 / (1 + Math.exp(-gap)) : Math.exp(gap) / (1 + Math.exp(gap));
  return { loss, probChosenWins, rewardGap: gap };
}

/**
 * Batched version: take arrays of (chosen, rejected) reward pairs and
 * return the MEAN preference loss plus per-pair probabilities. This
 * is what a real reward-model training step computes on a minibatch.
 */
export function batchBradleyTerryLoss(
  rChosen: number[],
  rRejected: number[],
): { meanLoss: number; perPair: PreferenceLossResult[] } {
  if (rChosen.length !== rRejected.length) {
    throw new Error(
      `batchBradleyTerryLoss: length mismatch ${rChosen.length} vs ${rRejected.length}`,
    );
  }
  if (rChosen.length === 0) {
    throw new Error("batchBradleyTerryLoss: empty batch");
  }
  const perPair = rChosen.map((rc, i) => bradleyTerryLoss(rc, rRejected[i]));
  let sum = 0;
  for (const p of perPair) sum += p.loss;
  return { meanLoss: sum / perPair.length, perPair };
}

// ---------------------------------------------------------------------------
// REINFORCE policy gradient
// ---------------------------------------------------------------------------

export interface ReinforceStepInput {
  /**
   * Per-token log probabilities of the sampled tokens under the
   * current policy. Length = number of tokens generated.
   */
  logProbs: number[];
  /** Scalar reward for the entire completion (e.g. from a reward model). */
  reward: number;
  /** Baseline subtracted from the reward for variance reduction. Defaults to 0. */
  baseline?: number;
  /**
   * KL penalty β · KL(policy || reference). Pass the per-token
   * log-prob difference between the current policy and a frozen
   * reference policy (SFT model). If omitted, no KL penalty.
   */
  klDivergencePerToken?: number[];
  /** KL penalty coefficient β. */
  klCoefficient?: number;
}

export interface ReinforceStepResult {
  /** Scalar loss (negative of the expected reward). */
  loss: number;
  /** Advantage = reward − baseline. */
  advantage: number;
  /** Sum of the KL penalty. 0 if no KL was provided. */
  klPenalty: number;
  /** Per-token gradient of the loss w.r.t. each logProb entry. */
  perTokenGradient: number[];
}

/**
 * Compute the REINFORCE policy gradient step (Williams 1992) — the
 * simplest possible policy gradient estimator, which PPO extends.
 *
 *   loss = −(advantage) · Σ_t log π(a_t | s_t)  +  β · Σ_t KL_t
 *
 * This function DOES NOT update any weights itself — it returns the
 * scalar loss plus per-token gradients w.r.t. the token log-probs.
 * Real training code plugs these into its autograd / finite-diff
 * gradient collector (same pattern we already use for the Vaswani
 * training step).
 *
 * The advantage is computed as `reward − baseline`. Callers
 * implementing an actor-critic variant pass a value-function estimate
 * as `baseline`; otherwise a running average of rewards works fine
 * for variance reduction.
 *
 * The optional KL penalty mirrors InstructGPT §3.4 and PPO: it
 * discourages the policy from drifting too far from the SFT baseline,
 * which is necessary to avoid "reward hacking" / degenerate outputs.
 */
export function reinforceStep(input: ReinforceStepInput): ReinforceStepResult {
  const { logProbs, reward } = input;
  if (logProbs.length === 0) {
    throw new Error("reinforceStep: logProbs is empty");
  }
  const baseline = input.baseline ?? 0;
  const advantage = reward - baseline;

  // KL penalty sum
  let klPenalty = 0;
  if (input.klDivergencePerToken && input.klCoefficient && input.klCoefficient > 0) {
    for (const kl of input.klDivergencePerToken) klPenalty += kl;
    klPenalty *= input.klCoefficient;
  }

  // loss = −advantage · Σ log π(a|s)  +  klPenalty
  let sumLogProb = 0;
  for (const lp of logProbs) sumLogProb += lp;
  const loss = -advantage * sumLogProb + klPenalty;

  // ∂loss / ∂(log π(a_t | s_t)) = −advantage  for every t
  const perTokenGradient: number[] = new Array(logProbs.length);
  for (let i = 0; i < logProbs.length; i++) perTokenGradient[i] = -advantage;

  return { loss, advantage, klPenalty, perTokenGradient };
}

// Guard against unused-import warnings when only types are consumed.
void (null as unknown as Matrix);
void zeros;
