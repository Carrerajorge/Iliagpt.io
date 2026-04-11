/**
 * Sparse attention patterns for GPT-3 (§2.1 of Brown et al. 2020).
 *
 *   "we use alternating dense and locally banded sparse attention
 *    patterns in the layers of the transformer, similar to the Sparse
 *    Transformer [CGRS19]"
 *
 * Reference: Child, Gray, Radford, Sutskever 2019 — "Generating Long
 * Sequences with Sparse Transformers" (arXiv:1904.10509).
 *
 * The Sparse Transformer paper describes two sparse patterns:
 *
 *   1. "Strided" — for each query i, attend to i, i-stride, i-2·stride, ...
 *      AND to a local band [i - bandSize, i].
 *
 *   2. "Fixed" — for each query i, attend to all positions in the
 *      current block of size `stride` and to the last `bandSize`
 *      positions of every previous block.
 *
 * GPT-3's paper text says "locally banded sparse attention patterns"
 * which is closest to the strided version with a local band. We
 * implement BOTH this strided+band mask and the pure local-band mask
 * (which is the simplest locally-banded pattern). Callers choose via
 * the `kind` parameter.
 *
 * Every mask produced here is STILL CAUSAL: position i can never
 * attend to positions j > i. The sparse pattern is applied on top of
 * the causal constraint — it REMOVES some of the allowed attends, it
 * never adds new ones past the diagonal.
 */

// ---------------------------------------------------------------------------
// Local band mask (the simplest locally-banded causal pattern)
// ---------------------------------------------------------------------------

/**
 * Locally banded causal mask: position i attends only to positions
 * [max(0, i - bandSize), i]. Everything else is masked out.
 *
 *   bandSize = 3:
 *                j=0 j=1 j=2 j=3 j=4 j=5
 *     i=0         ✓   .   .   .   .   .
 *     i=1         ✓   ✓   .   .   .   .
 *     i=2         ✓   ✓   ✓   .   .   .
 *     i=3         ✓   ✓   ✓   ✓   .   .
 *     i=4         .   ✓   ✓   ✓   ✓   .
 *     i=5         .   .   ✓   ✓   ✓   ✓
 *
 * Note that positions near the start see fewer neighbors than the
 * band size; this is the standard convention and matches the paper.
 */
export function localBandMask(seqLen: number, bandSize: number): boolean[][] {
  if (seqLen < 0) throw new Error(`localBandMask: seqLen must be ≥ 0`);
  if (bandSize < 1) throw new Error(`localBandMask: bandSize must be ≥ 1`);
  const out: boolean[][] = [];
  for (let i = 0; i < seqLen; i++) {
    const row: boolean[] = new Array(seqLen).fill(false);
    const start = Math.max(0, i - bandSize + 1);
    for (let j = start; j <= i; j++) row[j] = true;
    out.push(row);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Sparse Transformer-style strided + local-band mask
// ---------------------------------------------------------------------------

/**
 * Strided + local-band sparse attention mask. For each query position
 * i, allowed keys are:
 *
 *   • Every position in the local band [i - bandSize + 1, i]
 *   • Every position at the strided offsets {i - stride, i - 2·stride, ...}
 *
 * All subject to the causal constraint j ≤ i.
 *
 * With `bandSize = 1` and `stride = 1` this degenerates to a diagonal
 * mask. With `bandSize = seqLen` and any `stride` it's equivalent to
 * the full causal mask. The useful region is in between.
 *
 * The Sparse Transformer paper uses `bandSize ≈ sqrt(seqLen)` and a
 * similar `stride`, which gives O(n·sqrt(n)) total edges instead of
 * the O(n²) of a dense mask.
 */
export function stridedSparseMask(
  seqLen: number,
  bandSize: number,
  stride: number,
): boolean[][] {
  if (seqLen < 0) throw new Error(`stridedSparseMask: seqLen must be ≥ 0`);
  if (bandSize < 1) throw new Error(`stridedSparseMask: bandSize must be ≥ 1`);
  if (stride < 1) throw new Error(`stridedSparseMask: stride must be ≥ 1`);
  const out: boolean[][] = [];
  for (let i = 0; i < seqLen; i++) {
    const row: boolean[] = new Array(seqLen).fill(false);
    // Local band
    const bandStart = Math.max(0, i - bandSize + 1);
    for (let j = bandStart; j <= i; j++) row[j] = true;
    // Strided hops backward
    for (let j = i - stride; j >= 0; j -= stride) row[j] = true;
    out.push(row);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Full causal (no sparsity) — convenience wrapper
// ---------------------------------------------------------------------------

/**
 * Full causal mask — every position attends to everything up to and
 * including itself. This is what GPT-3's "dense" layers use.
 *
 * Same semantics as the existing `causalMask` in matrix.ts but
 * re-exported here so callers don't have to mix imports.
 */
export function fullCausalMask(seqLen: number): boolean[][] {
  const out: boolean[][] = [];
  for (let i = 0; i < seqLen; i++) {
    const row: boolean[] = new Array(seqLen).fill(false);
    for (let j = 0; j <= i; j++) row[j] = true;
    out.push(row);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Density accounting (tests + analytics)
// ---------------------------------------------------------------------------

/**
 * Return the density (fraction of `true` entries) of a boolean mask.
 * Useful for sanity-checking that a sparse pattern is actually sparser
 * than the corresponding dense mask.
 */
export function maskDensity(mask: boolean[][]): number {
  if (mask.length === 0) return 0;
  const n = mask.length;
  let live = 0;
  for (const row of mask) for (const v of row) if (v) live++;
  return live / (n * n);
}
