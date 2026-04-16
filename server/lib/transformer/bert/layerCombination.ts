/**
 * Layer combination utilities for the §5.3 feature-based approach.
 *
 * Devlin et al. 2018, Table 7 evaluates six ways to combine BERT's
 * hidden states for NER:
 *
 *   Strategy                        Dev F1
 *   ─────────────────────────────   ──────
 *   Embeddings                       91.0
 *   Second-to-Last Hidden            95.6
 *   Last Hidden                      94.9
 *   Weighted Sum Last Four Hidden    95.9
 *   Concat Last Four Hidden          96.1   ← best
 *   Weighted Sum All 12 Layers       95.5
 *
 * and concludes §5.3 with:
 *
 *   "The best performing method concatenates the token representations
 *    from the top four hidden layers of the pre-trained Transformer,
 *    which is only 0.3 F1 behind fine-tuning the entire model."
 *
 * We expose that recipe plus the other three strategies the paper
 * explicitly reports, all operating on the `allHiddenStates` array
 * returned by `bertForwardWithLayers`.
 *
 * Index convention: `allHiddenStates[0]` is the input embedding and
 * `allHiddenStates[i]` for i ≥ 1 is the output of encoder layer i.
 * So `len = L + 1` where L is the number of encoder layers.
 */

import { type Matrix, zeros, add, concatCols } from "../matrix";

// ---------------------------------------------------------------------------
// Concatenation: "Concat Last Four Hidden" (Table 7 best)
// ---------------------------------------------------------------------------

/**
 * Concatenate the last `k` hidden states along the feature dimension.
 *
 *   shape: (seqLen, k · hiddenSize)
 *
 * Passing `k = 4` and the `allHiddenStates` from `bertForwardWithLayers`
 * reproduces the paper's best feature-based strategy (§5.3, Table 7,
 * "Concat Last Four Hidden" → 96.1 Dev F1 on CoNLL-2003 NER).
 */
export function concatLastKLayers(allHiddenStates: Matrix[], k: number): Matrix {
  if (allHiddenStates.length === 0) {
    throw new Error(`concatLastKLayers: allHiddenStates is empty`);
  }
  if (k < 1 || k > allHiddenStates.length) {
    throw new Error(
      `concatLastKLayers: k (${k}) must be in [1, ${allHiddenStates.length}]`,
    );
  }
  // Slice the last `k` and concat along the column (feature) axis
  const lastK = allHiddenStates.slice(-k);
  return concatCols(lastK);
}

// ---------------------------------------------------------------------------
// Sum / weighted sum: "Weighted Sum Last Four Hidden", "Weighted Sum All"
// ---------------------------------------------------------------------------

/**
 * Element-wise sum of the last `k` hidden states.
 *
 *   shape: (seqLen, hiddenSize)
 *
 * Paper reports "Weighted Sum Last Four Hidden" at 95.9 Dev F1 — this
 * helper is the unweighted version (equivalent to weighted sum with
 * uniform weights = 1/k, scaled by k).
 */
export function sumLastKLayers(allHiddenStates: Matrix[], k: number): Matrix {
  if (allHiddenStates.length === 0) {
    throw new Error(`sumLastKLayers: allHiddenStates is empty`);
  }
  if (k < 1 || k > allHiddenStates.length) {
    throw new Error(
      `sumLastKLayers: k (${k}) must be in [1, ${allHiddenStates.length}]`,
    );
  }
  const lastK = allHiddenStates.slice(-k);
  let result = lastK[0];
  for (let i = 1; i < lastK.length; i++) {
    result = add(result, lastK[i]);
  }
  return result;
}

/**
 * Weighted linear combination of every hidden state. The paper's
 * "Weighted Sum Last Four Hidden" and "Weighted Sum All 12 Layers"
 * strategies are both expressible here by zeroing the unwanted
 * coefficients. Returns a matrix of shape (seqLen, hiddenSize).
 *
 *   out[i, j] = Σ_ℓ weights[ℓ] · allHiddenStates[ℓ][i, j]
 *
 * Weights do not need to sum to 1 — the caller controls whether they
 * are normalized.
 */
export function weightedSumLayers(
  allHiddenStates: Matrix[],
  weights: number[],
): Matrix {
  if (weights.length !== allHiddenStates.length) {
    throw new Error(
      `weightedSumLayers: weights length ${weights.length} != states length ${allHiddenStates.length}`,
    );
  }
  if (allHiddenStates.length === 0) {
    throw new Error(`weightedSumLayers: allHiddenStates is empty`);
  }
  const rows = allHiddenStates[0].rows;
  const cols = allHiddenStates[0].cols;
  for (const h of allHiddenStates) {
    if (h.rows !== rows || h.cols !== cols) {
      throw new Error(
        `weightedSumLayers: all hidden states must share shape; got ${h.rows}x${h.cols} vs ${rows}x${cols}`,
      );
    }
  }
  const out = zeros(rows, cols);
  const n = rows * cols;
  for (let ℓ = 0; ℓ < allHiddenStates.length; ℓ++) {
    const w = weights[ℓ];
    if (w === 0) continue;
    const data = allHiddenStates[ℓ].data;
    for (let i = 0; i < n; i++) {
      out.data[i] += w * data[i];
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Convenience wrappers for the exact strategies in Table 7
// ---------------------------------------------------------------------------

/**
 * Return the second-to-last hidden state (Table 7: 95.6 Dev F1).
 * This is often a better feature extractor than the very last layer
 * because the last layer is more specialized to the pre-training
 * objective.
 */
export function secondToLastHidden(allHiddenStates: Matrix[]): Matrix {
  if (allHiddenStates.length < 2) {
    throw new Error(
      `secondToLastHidden: need at least 2 hidden states, got ${allHiddenStates.length}`,
    );
  }
  return allHiddenStates[allHiddenStates.length - 2];
}

/**
 * Paper's best strategy verbatim: concatenate the top four hidden
 * layers. Equivalent to `concatLastKLayers(allHiddenStates, 4)` but
 * exposes the paper's actual name as the function name so callers
 * don't have to remember the magic `k=4`.
 *
 * §5.3: "The best performing method concatenates the token
 *  representations from the top four hidden layers" → 96.1 F1.
 */
export function concatLastFourHidden(allHiddenStates: Matrix[]): Matrix {
  return concatLastKLayers(allHiddenStates, 4);
}
