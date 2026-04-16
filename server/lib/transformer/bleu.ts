/**
 * BLEU-4 metric (Papineni et al. 2002).
 *
 * The paper reports results in BLEU and the code we used for their
 * evaluation is published at https://github.com/tensorflow/tensor2tensor.
 * Here we implement a clean in-TypeScript BLEU-4 with:
 *
 *   - Modified n-gram precision (clip candidate counts by max reference count)
 *   - Brevity penalty BP = exp(1 - r/c) if c < r else 1
 *   - BLEU = BP · exp(Σ w_n log p_n)  with w_n = 1/N (uniform weights)
 *   - Corpus-level (the usual reporting unit)
 *   - Sentence-level (with additive +1 smoothing for n-grams with 0 matches)
 *
 * The module takes tokenized inputs (number[] or string[]) so it can be
 * used with either a tokenizer's ids or plain word-pieces. All operations
 * are pure functions.
 */

// ---------------------------------------------------------------------------
// N-gram helpers
// ---------------------------------------------------------------------------

/**
 * Build a multiset of n-grams from a tokenized sequence. The n-grams
 * are joined by "\u0001" internally so any token representation (number
 * or string) works without collisions.
 */
export function ngramCounts<T>(tokens: readonly T[], n: number): Map<string, number> {
  const counts = new Map<string, number>();
  if (tokens.length < n || n < 1) return counts;
  for (let i = 0; i <= tokens.length - n; i++) {
    const gram = tokens.slice(i, i + n).join("\u0001");
    counts.set(gram, (counts.get(gram) ?? 0) + 1);
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Modified n-gram precision
// ---------------------------------------------------------------------------

/**
 * Modified n-gram precision over a single sentence pair.
 *
 *   Clip candidate count by the MAX over all references.
 *   p_n = sum_gram min(count_c(g), max_r count_r(g)) / sum_g count_c(g)
 */
export function modifiedPrecision<T>(
  candidate: readonly T[],
  references: ReadonlyArray<readonly T[]>,
  n: number,
): { numerator: number; denominator: number } {
  const candCounts = ngramCounts(candidate, n);

  // Max count for each n-gram across all references
  const maxRefCounts = new Map<string, number>();
  for (const ref of references) {
    const refCounts = ngramCounts(ref, n);
    for (const [gram, count] of refCounts.entries()) {
      const current = maxRefCounts.get(gram) ?? 0;
      if (count > current) maxRefCounts.set(gram, count);
    }
  }

  let numerator = 0;
  let denominator = 0;
  for (const [gram, count] of candCounts.entries()) {
    denominator += count;
    const clip = Math.min(count, maxRefCounts.get(gram) ?? 0);
    numerator += clip;
  }
  return { numerator, denominator };
}

// ---------------------------------------------------------------------------
// Brevity penalty
// ---------------------------------------------------------------------------

/**
 * Choose the reference length closest to the candidate length (classic
 * BLEU definition). Ties break in favor of the shorter reference.
 */
function closestRefLength(candidateLen: number, refs: ReadonlyArray<readonly unknown[]>): number {
  let best = refs[0].length;
  let bestDiff = Math.abs(candidateLen - refs[0].length);
  for (let i = 1; i < refs.length; i++) {
    const diff = Math.abs(candidateLen - refs[i].length);
    if (diff < bestDiff || (diff === bestDiff && refs[i].length < best)) {
      best = refs[i].length;
      bestDiff = diff;
    }
  }
  return best;
}

export function brevityPenalty(candidateLen: number, refLen: number): number {
  if (candidateLen > refLen) return 1;
  if (candidateLen === 0) return 0;
  return Math.exp(1 - refLen / candidateLen);
}

// ---------------------------------------------------------------------------
// Corpus-level BLEU
// ---------------------------------------------------------------------------

/**
 * Corpus-level BLEU-N (default N=4, weights uniform).
 *
 *   BLEU = BP · exp(Σ_n (1/N) log p_n)
 *
 * `candidates[i]` is scored against `references[i]` which is a list of
 * one or more reference sequences (BLEU allows multi-reference).
 */
export function corpusBleu<T>(
  candidates: ReadonlyArray<readonly T[]>,
  references: ReadonlyArray<ReadonlyArray<readonly T[]>>,
  order = 4,
): number {
  if (candidates.length !== references.length) {
    throw new Error(
      `corpusBleu: candidates (${candidates.length}) and references (${references.length}) must have the same length`,
    );
  }

  const numerators = new Array(order).fill(0) as number[];
  const denominators = new Array(order).fill(0) as number[];
  let candLengthTotal = 0;
  let refLengthTotal = 0;

  for (let i = 0; i < candidates.length; i++) {
    const cand = candidates[i];
    const refs = references[i];
    if (refs.length === 0) continue;
    candLengthTotal += cand.length;
    refLengthTotal += closestRefLength(cand.length, refs);
    for (let n = 1; n <= order; n++) {
      const { numerator, denominator } = modifiedPrecision(cand, refs, n);
      numerators[n - 1] += numerator;
      denominators[n - 1] += denominator;
    }
  }

  // If any precision is 0, BLEU is 0 (log(0) = -inf). This is the
  // "corpus-level" behaviour; sentence-level uses smoothing instead.
  for (let n = 0; n < order; n++) {
    if (denominators[n] === 0 || numerators[n] === 0) return 0;
  }

  let logSum = 0;
  for (let n = 0; n < order; n++) {
    const p = numerators[n] / denominators[n];
    logSum += Math.log(p) / order; // uniform weight 1/N
  }
  const bp = brevityPenalty(candLengthTotal, refLengthTotal);
  return bp * Math.exp(logSum);
}

// ---------------------------------------------------------------------------
// Sentence-level BLEU with +1 smoothing
// ---------------------------------------------------------------------------

/**
 * Sentence-level BLEU-N with additive smoothing (method 1 from Chen &
 * Cherry 2014). Avoids the "all precisions must be > 0" requirement that
 * corpus BLEU has, at the cost of a slight upward bias on short
 * candidates.
 */
export function sentenceBleu<T>(
  candidate: readonly T[],
  references: ReadonlyArray<readonly T[]>,
  order = 4,
): number {
  if (references.length === 0) return 0;
  if (candidate.length === 0) return 0;

  let logSum = 0;
  for (let n = 1; n <= order; n++) {
    const { numerator, denominator } = modifiedPrecision(candidate, references, n);
    // +1 smoothing: add 1 to both numerator and denominator for n > 1
    // when numerator == 0 (method 1 of Chen & Cherry).
    let num = numerator;
    let den = denominator;
    if (n > 1 && num === 0) {
      num = 1;
      den = den + 1;
    }
    if (den === 0) return 0;
    const p = num / den;
    logSum += Math.log(p) / order;
  }
  const refLen = closestRefLength(candidate.length, references);
  const bp = brevityPenalty(candidate.length, refLen);
  return bp * Math.exp(logSum);
}

// ---------------------------------------------------------------------------
// Convenience wrapper: BLEU-4 (the standard reported in papers)
// ---------------------------------------------------------------------------

export function bleu4<T>(candidate: readonly T[], references: ReadonlyArray<readonly T[]>): number {
  return sentenceBleu(candidate, references, 4);
}

export function corpusBleu4<T>(
  candidates: ReadonlyArray<readonly T[]>,
  references: ReadonlyArray<ReadonlyArray<readonly T[]>>,
): number {
  return corpusBleu(candidates, references, 4);
}
