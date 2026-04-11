/**
 * Adam optimizer + Noam learning rate schedule.
 *
 * Section 5.3 of the paper:
 *
 *   "We used the Adam optimizer with β₁ = 0.9, β₂ = 0.98 and ε = 10⁻⁹.
 *    We varied the learning rate over the course of training, according
 *    to the formula:
 *
 *      lrate = d_model^(-0.5) · min(step^(-0.5), step · warmup_steps^(-1.5))
 *
 *    This corresponds to increasing the learning rate linearly for the
 *    first warmup_steps training steps, and decreasing it thereafter
 *    proportionally to the inverse square root of the step number. We
 *    used warmup_steps = 4000."
 *
 * This file implements both: a pure-function LR schedule (computable
 * standalone) and an Adam optimizer that holds moment state and applies
 * updates given gradients.
 */

import { type Matrix, zeros } from "./matrix";

// ---------------------------------------------------------------------------
// Noam learning rate schedule (Equation 3)
// ---------------------------------------------------------------------------

export interface NoamConfig {
  /** d_model from the Transformer config (paper base: 512). */
  dModel: number;
  /** warmup_steps (paper: 4000). */
  warmupSteps: number;
}

/**
 * Noam (a.k.a. "inverse sqrt with warmup") learning rate at training
 * step `step` (1-indexed per the paper; step=0 returns 0 to avoid NaN).
 *
 *   lrate = d_model^(-0.5) · min(step^(-0.5), step · warmup^(-1.5))
 */
export function noamLearningRate(step: number, config: NoamConfig): number {
  if (step <= 0) return 0;
  const { dModel, warmupSteps } = config;
  if (dModel <= 0) throw new Error(`noamLearningRate: dModel ${dModel} must be positive`);
  if (warmupSteps <= 0) throw new Error(`noamLearningRate: warmupSteps ${warmupSteps} must be positive`);
  const invSqrtD = Math.pow(dModel, -0.5);
  const invSqrtStep = Math.pow(step, -0.5);
  const warmupDecay = step * Math.pow(warmupSteps, -1.5);
  return invSqrtD * Math.min(invSqrtStep, warmupDecay);
}

/**
 * Return the peak LR (at step == warmup_steps) for a given config.
 * Useful for verification tests.
 */
export function noamPeakLearningRate(config: NoamConfig): number {
  return noamLearningRate(config.warmupSteps, config);
}

// ---------------------------------------------------------------------------
// Adam optimizer
// ---------------------------------------------------------------------------

export interface AdamHyperparameters {
  /** β₁ for the first-moment estimate. Paper: 0.9. */
  beta1: number;
  /** β₂ for the second-moment estimate. Paper: 0.98. */
  beta2: number;
  /** ε numerical stabilizer. Paper: 1e-9. */
  epsilon: number;
}

export const PAPER_ADAM: AdamHyperparameters = {
  beta1: 0.9,
  beta2: 0.98,
  epsilon: 1e-9,
};

/**
 * BERT's Adam hyperparameters (Devlin et al. 2018, §A.2).
 *
 *   "We use Adam with learning rate of 1e-4, β₁ = 0.9, β₂ = 0.999,
 *    L2 weight decay of 0.01 ..."
 *
 * BERT's β₂ is DIFFERENT from Vaswani's (0.999 vs 0.98). This matters
 * in practice: BERT's higher β₂ means the running second-moment
 * estimate is smoother, which pairs with the longer linear schedule
 * used during BERT pre-training. The paper doesn't spell out ε; we
 * use the canonical 1e-6 from the reference implementation
 * (google-research/bert).
 *
 * Pair this with `BERT_WEIGHT_DECAY = 0.01` when calling `adamUpdate`
 * to get the paper's exact optimizer.
 */
export const BERT_ADAM: AdamHyperparameters = {
  beta1: 0.9,
  beta2: 0.999,
  epsilon: 1e-6,
};

/**
 * BERT's L2 weight decay coefficient (§A.2: "L2 weight decay of 0.01").
 * When passed to `adamUpdate`, the gradient becomes `g + λ·θ` before
 * the moment updates — this is standard L2 regularization, equivalent
 * to adding `½·λ·‖θ‖²` to the loss.
 */
export const BERT_WEIGHT_DECAY = 0.01;

/**
 * Per-parameter Adam state. Stored as Float64Array so updates are
 * allocation-free on the hot path.
 */
export interface AdamState {
  /** First moment (exponential moving average of gradients). */
  m: Float64Array;
  /** Second moment (exponential moving average of squared gradients). */
  v: Float64Array;
  /** Number of steps taken (for bias correction). */
  step: number;
}

/** Create an empty Adam state matching the shape of a parameter tensor. */
export function createAdamState(size: number): AdamState {
  return { m: new Float64Array(size), v: new Float64Array(size), step: 0 };
}

/**
 * Apply one Adam update to a parameter matrix, in place.
 *
 *   m_t = β₁ m_{t-1} + (1 - β₁) g_t
 *   v_t = β₂ v_{t-1} + (1 - β₂) g_t²
 *   m̂_t = m_t / (1 - β₁^t)        (bias correction)
 *   v̂_t = v_t / (1 - β₂^t)        (bias correction)
 *   θ_t = θ_{t-1} - lr · m̂_t / (sqrt(v̂_t) + ε)
 *
 * The Adam state is advanced by one step. Returns the same state for
 * chaining / inspection.
 */
export function adamUpdate(
  parameter: Matrix,
  gradient: Matrix,
  state: AdamState,
  lr: number,
  hyper: AdamHyperparameters = PAPER_ADAM,
  /**
   * Optional L2 weight decay coefficient λ (BERT §A.2 default = 0.01).
   * When non-zero, the gradient becomes `g + λ·θ` before the moment
   * updates. This is the classic "L2 regularization inside Adam"
   * formulation — NOT decoupled weight decay (AdamW). The BERT paper
   * spells it as "L2 weight decay" so the in-training version matches.
   */
  weightDecay = 0,
): AdamState {
  if (parameter.data.length !== gradient.data.length) {
    throw new Error(
      `adamUpdate: parameter (${parameter.data.length}) and gradient (${gradient.data.length}) size mismatch`,
    );
  }
  if (state.m.length !== parameter.data.length || state.v.length !== parameter.data.length) {
    throw new Error(`adamUpdate: Adam state shape does not match parameter shape`);
  }

  state.step++;
  const { beta1, beta2, epsilon } = hyper;
  const t = state.step;
  const biasCorrection1 = 1 - Math.pow(beta1, t);
  const biasCorrection2 = 1 - Math.pow(beta2, t);

  for (let i = 0; i < parameter.data.length; i++) {
    // L2 regularization: g ← g + λ·θ before the moment updates.
    const theta = parameter.data[i];
    const g = gradient.data[i] + (weightDecay > 0 ? weightDecay * theta : 0);
    state.m[i] = beta1 * state.m[i] + (1 - beta1) * g;
    state.v[i] = beta2 * state.v[i] + (1 - beta2) * g * g;
    const mHat = state.m[i] / biasCorrection1;
    const vHat = state.v[i] / biasCorrection2;
    parameter.data[i] = theta - lr * mHat / (Math.sqrt(vHat) + epsilon);
  }

  return state;
}

// ---------------------------------------------------------------------------
// Optimizer wrapper: ties Adam state to a named parameter collection
// ---------------------------------------------------------------------------

/**
 * Simple parameter manager: stores each learnable tensor by name plus
 * its Adam state. Lets callers build a training loop without juggling
 * per-parameter state by hand.
 *
 * Intended usage:
 *
 *   const opt = new AdamOptimizer({ dModel: 32, warmupSteps: 100 });
 *   opt.registerParameter("W_q[0]", Wq0);
 *   opt.registerParameter("W_k[0]", Wk0);
 *   ...
 *   // later, in the training step:
 *   opt.stepOnce(gradients); // gradients is a Record<name, Matrix>
 */
export class AdamOptimizer {
  private readonly states = new Map<string, AdamState>();
  private readonly parameters = new Map<string, Matrix>();
  private globalStep = 0;

  constructor(
    private readonly noamConfig: NoamConfig,
    private readonly hyper: AdamHyperparameters = PAPER_ADAM,
  ) {}

  registerParameter(name: string, parameter: Matrix): void {
    this.parameters.set(name, parameter);
    this.states.set(name, createAdamState(parameter.data.length));
  }

  get currentLR(): number {
    return noamLearningRate(this.globalStep, this.noamConfig);
  }

  get step(): number {
    return this.globalStep;
  }

  /**
   * Apply one gradient update across every registered parameter.
   * Parameters without a gradient are skipped.
   */
  stepOnce(gradients: Record<string, Matrix>): number {
    this.globalStep++;
    const lr = noamLearningRate(this.globalStep, this.noamConfig);
    for (const [name, grad] of Object.entries(gradients)) {
      const param = this.parameters.get(name);
      const state = this.states.get(name);
      if (!param || !state) continue;
      adamUpdate(param, grad, state, lr, this.hyper);
    }
    return lr;
  }

  /** Zero out all stored Adam state (useful between epochs or for tests). */
  resetState(): void {
    for (const [name, param] of this.parameters.entries()) {
      this.states.set(name, createAdamState(param.data.length));
    }
    this.globalStep = 0;
  }
}

// ---------------------------------------------------------------------------
// BERT linear warmup + linear decay schedule (Devlin et al. 2018, §A.2)
// ---------------------------------------------------------------------------

export interface BertLinearScheduleConfig {
  /** Peak learning rate at the end of warmup. BERT pre-training: 1e-4. */
  peakLR: number;
  /** Number of warmup steps (linear ramp 0 → peakLR). Paper: 10,000. */
  warmupSteps: number;
  /** Total training steps (linear decay from peakLR → 0). Paper: 1,000,000. */
  totalSteps: number;
}

/**
 * BERT's learning rate schedule (§A.2 of Devlin et al. 2018):
 *
 *   "learning rate warmup over the first 10,000 steps, and linear decay
 *    of the learning rate."
 *
 * Piecewise linear:
 *
 *   step ∈ [0, warmup]              lr = peak · step / warmup
 *   step ∈ (warmup, total]          lr = peak · (total - step) / (total - warmup)
 *   step > total                    lr = 0
 *
 * This is DIFFERENT from Vaswani's Noam schedule (inverse-sqrt with
 * warmup). Noam is bounded below by its tail; BERT's schedule decays
 * all the way to zero at `totalSteps`, which is the paper's exact
 * training recipe.
 */
export function bertLinearSchedule(step: number, config: BertLinearScheduleConfig): number {
  const { peakLR, warmupSteps, totalSteps } = config;
  if (peakLR <= 0) throw new Error(`bertLinearSchedule: peakLR must be > 0`);
  if (warmupSteps <= 0) throw new Error(`bertLinearSchedule: warmupSteps must be > 0`);
  if (totalSteps <= warmupSteps) {
    throw new Error(
      `bertLinearSchedule: totalSteps (${totalSteps}) must exceed warmupSteps (${warmupSteps})`,
    );
  }
  if (step <= 0) return 0;
  if (step <= warmupSteps) {
    // Linear warmup
    return peakLR * (step / warmupSteps);
  }
  if (step >= totalSteps) return 0;
  // Linear decay
  const remaining = totalSteps - step;
  const decaySpan = totalSteps - warmupSteps;
  return peakLR * (remaining / decaySpan);
}

// ---------------------------------------------------------------------------
// Gradient clipping helper
// ---------------------------------------------------------------------------

/**
 * Clip the global L2 norm of a gradient collection to `maxNorm`. Returns
 * the pre-clip norm so callers can log it. This is a standard trick in
 * Transformer training even though the paper doesn't spell it out.
 */
export function clipGradientNorm(
  gradients: Record<string, Matrix>,
  maxNorm: number,
): number {
  let sumSq = 0;
  for (const g of Object.values(gradients)) {
    for (let i = 0; i < g.data.length; i++) sumSq += g.data[i] * g.data[i];
  }
  const norm = Math.sqrt(sumSq);
  if (norm > maxNorm && norm > 0) {
    const scale = maxNorm / norm;
    for (const g of Object.values(gradients)) {
      for (let i = 0; i < g.data.length; i++) g.data[i] *= scale;
    }
  }
  return norm;
}

// Suppress unused import warning; `zeros` is re-exported for test convenience.
void zeros;
