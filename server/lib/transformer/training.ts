/**
 * Training step + copy-task proof of convergence.
 *
 * The paper trained on WMT English-German with backprop through the
 * full architecture. Implementing a hand-written autograd engine for
 * the entire Transformer would be thousands of lines; instead we use
 * **finite-difference gradients** to prove the math is consistent and
 * the optimizer can reduce the loss on a toy task.
 *
 * Finite differences:
 *
 *   df/dθ_i ≈ (f(θ + h·e_i) - f(θ - h·e_i)) / (2h)
 *
 * Central differences have O(h²) error for smooth functions. For this
 * Transformer the forward pass is O(N · seq² · d_model²), and computing
 * the gradient of every parameter costs one forward pass per parameter
 * — so we only do this on TINY configurations (d_model=8, N=1, seq=4).
 *
 * The key test: after ~50 training steps on a 4-token copy-reverse
 * dataset with a tiny model, the loss drops AT LEAST 50% from its
 * initial value. That's the threshold we enforce in the test suite as
 * proof that the whole machinery (forward → loss → gradient → Adam
 * update → next forward) works end-to-end.
 */

import { type Matrix, zeros } from "./matrix";
import {
  runEncoder,
  runDecoder,
  type EncoderLayerWeights,
  type DecoderLayerWeights,
  type TransformerConfig,
} from "./transformer";
import {
  type EmbeddingTable,
  embedTokens,
  positionalEncoding,
  addPositional,
} from "./encoding";
import { tiedOutputLogits } from "./outputProjection";
import { crossEntropyLoss, type LabelSmoothingConfig } from "./loss";
import { AdamOptimizer, type NoamConfig } from "./optimizer";

// ---------------------------------------------------------------------------
// Forward + loss on a single example
// ---------------------------------------------------------------------------

export interface TrainingBatch {
  src: number[];
  tgtIn: number[];
  tgtOut: number[];
}

export interface TrainingSetup {
  config: TransformerConfig;
  embeddingTable: EmbeddingTable;
  encoder: EncoderLayerWeights[];
  decoder: DecoderLayerWeights[];
}

/**
 * Compute the cross-entropy loss for one example given the current
 * weights. Returns a single scalar; used both by the training step
 * and by the finite-difference gradient helper.
 */
export function computeLoss(
  batch: TrainingBatch,
  setup: TrainingSetup,
  lsConfig: LabelSmoothingConfig,
): number {
  const dModel = setup.embeddingTable.dModel;

  const srcEmb = addPositional(
    embedTokens(setup.embeddingTable, batch.src),
    positionalEncoding(batch.src.length, dModel),
  );
  const encoderOutput = runEncoder(srcEmb, setup.encoder, setup.config.attention);

  const tgtEmb = addPositional(
    embedTokens(setup.embeddingTable, batch.tgtIn),
    positionalEncoding(batch.tgtIn.length, dModel),
  );
  const decoderOutput = runDecoder(
    tgtEmb,
    encoderOutput,
    setup.decoder,
    setup.config.attention,
  );

  const logits = tiedOutputLogits(decoderOutput, setup.embeddingTable);
  const loss = crossEntropyLoss(logits, batch.tgtOut, lsConfig);
  return loss.loss;
}

// ---------------------------------------------------------------------------
// Finite-difference gradient helper
// ---------------------------------------------------------------------------

export interface FDConfig {
  /** Step size `h`. Too small → round-off; too large → truncation. */
  h: number;
  /** If provided, only estimate gradients for this many parameters total
   *  (helps keep training fast on small models). */
  maxParams?: number;
}

export const FD_DEFAULTS: FDConfig = { h: 1e-4 };

/**
 * Compute the gradient of `computeLoss(batch, setup, ...)` with respect
 * to a single parameter matrix by central differences, MUTATING the
 * matrix temporarily on each probe and restoring the original value
 * before the next iteration.
 *
 * Returns a gradient matrix of the same shape as `parameter`.
 *
 * This is O(param_count) forward passes — fine for tiny models but
 * exponential for the base model. We cap evaluations via `fdConfig.maxParams`.
 */
export function finiteDifferenceGradient(
  parameter: Matrix,
  batch: TrainingBatch,
  setup: TrainingSetup,
  lsConfig: LabelSmoothingConfig,
  fdConfig: FDConfig = FD_DEFAULTS,
): Matrix {
  const grad = zeros(parameter.rows, parameter.cols);
  const h = fdConfig.h;
  const max = fdConfig.maxParams ?? parameter.data.length;
  const limit = Math.min(max, parameter.data.length);
  for (let i = 0; i < limit; i++) {
    const original = parameter.data[i];
    parameter.data[i] = original + h;
    const lossPlus = computeLoss(batch, setup, lsConfig);
    parameter.data[i] = original - h;
    const lossMinus = computeLoss(batch, setup, lsConfig);
    parameter.data[i] = original;
    grad.data[i] = (lossPlus - lossMinus) / (2 * h);
  }
  return grad;
}

// ---------------------------------------------------------------------------
// Full training step: forward → FD gradients → Adam update
// ---------------------------------------------------------------------------

/**
 * Collect every learnable parameter of the setup as a named record.
 * Used by the training step to build the gradient dictionary.
 */
function collectParameters(setup: TrainingSetup): Record<string, Matrix> {
  const params: Record<string, Matrix> = {};
  params["embeddingTable"] = setup.embeddingTable.weights;

  for (let i = 0; i < setup.encoder.length; i++) {
    const layer = setup.encoder[i];
    for (let h = 0; h < layer.selfAttn.WQ.length; h++) {
      params[`enc${i}.WQ${h}`] = layer.selfAttn.WQ[h];
      params[`enc${i}.WK${h}`] = layer.selfAttn.WK[h];
      params[`enc${i}.WV${h}`] = layer.selfAttn.WV[h];
    }
    params[`enc${i}.WO`] = layer.selfAttn.WO;
    params[`enc${i}.W1`] = layer.ffn.W1;
    params[`enc${i}.b1`] = layer.ffn.b1;
    params[`enc${i}.W2`] = layer.ffn.W2;
    params[`enc${i}.b2`] = layer.ffn.b2;
    // Learnable LayerNorm params (Ba et al. 2016) — γ, β per Add & Norm
    params[`enc${i}.norm1.gamma`] = layer.norm1.gamma;
    params[`enc${i}.norm1.beta`] = layer.norm1.beta;
    params[`enc${i}.norm2.gamma`] = layer.norm2.gamma;
    params[`enc${i}.norm2.beta`] = layer.norm2.beta;
  }

  for (let i = 0; i < setup.decoder.length; i++) {
    const layer = setup.decoder[i];
    for (let h = 0; h < layer.maskedSelfAttn.WQ.length; h++) {
      params[`dec${i}.msa.WQ${h}`] = layer.maskedSelfAttn.WQ[h];
      params[`dec${i}.msa.WK${h}`] = layer.maskedSelfAttn.WK[h];
      params[`dec${i}.msa.WV${h}`] = layer.maskedSelfAttn.WV[h];
      params[`dec${i}.cross.WQ${h}`] = layer.crossAttn.WQ[h];
      params[`dec${i}.cross.WK${h}`] = layer.crossAttn.WK[h];
      params[`dec${i}.cross.WV${h}`] = layer.crossAttn.WV[h];
    }
    params[`dec${i}.msa.WO`] = layer.maskedSelfAttn.WO;
    params[`dec${i}.cross.WO`] = layer.crossAttn.WO;
    params[`dec${i}.W1`] = layer.ffn.W1;
    params[`dec${i}.b1`] = layer.ffn.b1;
    params[`dec${i}.W2`] = layer.ffn.W2;
    params[`dec${i}.b2`] = layer.ffn.b2;
    // Learnable LayerNorm params — 3 Add & Norm blocks in the decoder layer
    params[`dec${i}.norm1.gamma`] = layer.norm1.gamma;
    params[`dec${i}.norm1.beta`] = layer.norm1.beta;
    params[`dec${i}.norm2.gamma`] = layer.norm2.gamma;
    params[`dec${i}.norm2.beta`] = layer.norm2.beta;
    params[`dec${i}.norm3.gamma`] = layer.norm3.gamma;
    params[`dec${i}.norm3.beta`] = layer.norm3.beta;
  }

  return params;
}

export interface TrainingStepResult {
  loss: number;
  learningRate: number;
  gradientNorm: number;
  step: number;
}

/**
 * Register every parameter in `setup` with the Adam optimizer so future
 * `trainingStep` calls can update them. Idempotent per parameter name.
 */
export function registerSetupWithOptimizer(setup: TrainingSetup, optimizer: AdamOptimizer): void {
  const params = collectParameters(setup);
  for (const [name, p] of Object.entries(params)) {
    optimizer.registerParameter(name, p);
  }
}

/**
 * One training step: forward pass to compute the loss, finite-difference
 * gradients for a budget of `fdConfig.maxParams` entries across the
 * entire parameter collection, then an Adam update.
 *
 * Returns the loss BEFORE the update (the standard reporting convention).
 */
export function trainingStep(
  batch: TrainingBatch,
  setup: TrainingSetup,
  lsConfig: LabelSmoothingConfig,
  optimizer: AdamOptimizer,
  fdConfig: FDConfig = FD_DEFAULTS,
): TrainingStepResult {
  // 1. Current loss
  const lossBefore = computeLoss(batch, setup, lsConfig);

  // 2. Gradients (finite-difference over every registered parameter)
  const params = collectParameters(setup);
  const gradients: Record<string, Matrix> = {};
  let gradientNormSq = 0;
  for (const [name, p] of Object.entries(params)) {
    const g = finiteDifferenceGradient(p, batch, setup, lsConfig, fdConfig);
    gradients[name] = g;
    for (let i = 0; i < g.data.length; i++) gradientNormSq += g.data[i] * g.data[i];
  }
  const gradientNorm = Math.sqrt(gradientNormSq);

  // 3. Adam update
  const lr = optimizer.stepOnce(gradients);

  return { loss: lossBefore, learningRate: lr, gradientNorm, step: optimizer.step };
}

// Suppress unused re-export warning
export type { NoamConfig };
