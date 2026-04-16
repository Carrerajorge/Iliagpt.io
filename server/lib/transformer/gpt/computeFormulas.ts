/**
 * Training compute formulas from §D of Brown et al. 2020.
 *
 *   "Most of the compute for language models comes from scaled
 *    matrix multiplies and biases [...] we approximate the total
 *    compute as 6ND" — §D (Total Compute Used to Train Language Models)
 *
 * and
 *
 *   "1 PF-day = 10¹⁵ × 24 × 3600 = 8.64 × 10¹⁹ floating-point operations"
 *
 * The approximation `C ≈ 6·N·D` holds because, for a dense Transformer,
 * each training token costs:
 *
 *   • 2·N flops for the forward pass (matmul-dominated)
 *   • 4·N flops for the backward pass (2N for input grads + 2N for
 *     parameter grads)
 *
 * Total: 6·N flops per token. Multiply by the dataset size D to get
 * the training compute. This is the SAME formula Kaplan et al. 2020
 * and Hoffmann et al. 2022 (Chinchilla) use in their scaling-law papers.
 *
 * These helpers are paper-cited documentation primitives: they don't
 * drive any runtime code path, but they let training scripts,
 * dashboards, and planning docs reproduce the paper's compute math
 * exactly without hand-copying constants.
 */

// ---------------------------------------------------------------------------
// Constants (§D)
// ---------------------------------------------------------------------------

/**
 * One PF-day in raw floating-point operations:
 * 10¹⁵ flop/s × 24 × 3600 seconds = 8.64 × 10¹⁹ flops.
 */
export const FLOPS_PER_PF_DAY = 8.64e19;

/** Forward-pass flops per parameter per token. */
export const FORWARD_FLOPS_PER_PARAM_PER_TOKEN = 2;

/** Backward-pass flops per parameter per token (input + param grads). */
export const BACKWARD_FLOPS_PER_PARAM_PER_TOKEN = 4;

/** Total training flops per parameter per token: 2 + 4 = 6. */
export const TRAINING_FLOPS_PER_PARAM_PER_TOKEN =
  FORWARD_FLOPS_PER_PARAM_PER_TOKEN + BACKWARD_FLOPS_PER_PARAM_PER_TOKEN;

// ---------------------------------------------------------------------------
// Core estimators
// ---------------------------------------------------------------------------

export interface TrainingFlopsInput {
  /** Total learnable parameter count (N). */
  numParams: number;
  /** Total training tokens (D). */
  numTokens: number;
}

/**
 * Total training compute in raw FLOPs under the §D approximation:
 *
 *   C ≈ 6 · N · D
 *
 * where N is the parameter count and D is the number of training
 * tokens. This is the headline formula from Brown et al. §D.
 */
export function estimateTrainingFlops(input: TrainingFlopsInput): number {
  const { numParams, numTokens } = input;
  if (numParams < 0 || !Number.isFinite(numParams)) {
    throw new Error(`estimateTrainingFlops: numParams ${numParams} must be ≥ 0 and finite`);
  }
  if (numTokens < 0 || !Number.isFinite(numTokens)) {
    throw new Error(`estimateTrainingFlops: numTokens ${numTokens} must be ≥ 0 and finite`);
  }
  return TRAINING_FLOPS_PER_PARAM_PER_TOKEN * numParams * numTokens;
}

/** Same as `estimateTrainingFlops` but expressed in PF-days. */
export function estimateTrainingPfDays(input: TrainingFlopsInput): number {
  return estimateTrainingFlops(input) / FLOPS_PER_PF_DAY;
}

/** Convert raw FLOPs to PF-days. */
export function flopsToPfDays(flops: number): number {
  if (!Number.isFinite(flops)) {
    throw new Error(`flopsToPfDays: flops ${flops} must be finite`);
  }
  return flops / FLOPS_PER_PF_DAY;
}

/** Convert PF-days to raw FLOPs. */
export function pfDaysToFlops(pfDays: number): number {
  if (!Number.isFinite(pfDays)) {
    throw new Error(`pfDaysToFlops: pfDays ${pfDays} must be finite`);
  }
  return pfDays * FLOPS_PER_PF_DAY;
}

// ---------------------------------------------------------------------------
// Per-step estimator
// ---------------------------------------------------------------------------

export interface PerStepFlopsInput {
  numParams: number;
  /** Sequences per minibatch. */
  batchSize: number;
  /** Sequence length (tokens per sequence). */
  seqLen: number;
}

/**
 * Per-step training flops. Each step processes `batchSize × seqLen`
 * tokens; the same 6·N formula applies per token.
 *
 *   flops_per_step = 6 · N · (batchSize · seqLen)
 *
 * Useful for budgeting step time vs. wall-clock in a planning doc
 * without needing the total-tokens figure.
 */
export function estimateFlopsPerStep(input: PerStepFlopsInput): number {
  const { numParams, batchSize, seqLen } = input;
  if (batchSize < 1 || !Number.isInteger(batchSize)) {
    throw new Error(`estimateFlopsPerStep: batchSize ${batchSize} must be a positive integer`);
  }
  if (seqLen < 1 || !Number.isInteger(seqLen)) {
    throw new Error(`estimateFlopsPerStep: seqLen ${seqLen} must be a positive integer`);
  }
  return estimateTrainingFlops({
    numParams,
    numTokens: batchSize * seqLen,
  });
}

// ---------------------------------------------------------------------------
// Totals from steps
// ---------------------------------------------------------------------------

export interface TotalFlopsFromStepsInput extends PerStepFlopsInput {
  /** Total number of optimizer steps across training. */
  totalSteps: number;
}

/**
 * Total training flops computed from a step count rather than a
 * direct token count:
 *
 *   flops_total = totalSteps · flops_per_step
 *              = 6 · N · (batchSize · seqLen · totalSteps)
 *              = 6 · N · D
 *
 * where D = batchSize · seqLen · totalSteps is the implied token
 * total. This is the accountant's equivalent of `estimateTrainingFlops`
 * when you have `totalSteps` but not `numTokens` directly.
 */
export function estimateTotalFlopsFromSteps(input: TotalFlopsFromStepsInput): number {
  const { totalSteps } = input;
  if (totalSteps < 1 || !Number.isInteger(totalSteps)) {
    throw new Error(
      `estimateTotalFlopsFromSteps: totalSteps ${totalSteps} must be a positive integer`,
    );
  }
  return estimateFlopsPerStep(input) * totalSteps;
}
