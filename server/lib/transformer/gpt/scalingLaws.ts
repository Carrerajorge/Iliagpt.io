/**
 * Predictable scaling laws (GPT-4 Technical Report, §2.1).
 *
 *   "We developed infrastructure and optimization methods that have
 *    very predictable behavior across multiple scales. To verify this
 *    scalability, we accurately predicted in advance GPT-4's final
 *    loss on our internal codebase [...] by extrapolating from models
 *    trained using the same methodology but using 10,000× less
 *    compute."  — GPT-4 Technical Report, §2.1
 *
 * The scaling law form the OpenAI scaling papers (Kaplan et al. 2020,
 * Hoffmann et al. 2022 "Chinchilla") use is:
 *
 *   L(C) = a · C^b + c
 *
 * where `L` is the final training loss, `C` is compute (in PF-days or
 * any consistent unit), `b` is a small negative number (≈ −0.05 in
 * Kaplan, ≈ −0.08 in Chinchilla) — meaning loss shrinks slowly as
 * compute grows — and `c` is the irreducible loss asymptote.
 *
 * This module provides a simple two-step fitter:
 *
 *   1. Fix the asymptote `c` to the minimum observed loss (or a
 *      caller-supplied value).
 *   2. Fit `log(L - c) = log(a) + b · log(C)` by ordinary least
 *      squares on the residuals.
 *
 * Then `predictLoss(C, {a, b, c})` extrapolates to any compute.
 *
 * This is enough to reproduce the "predictable scaling" methodology
 * that the GPT-4 paper reports: fit from small-scale runs, predict
 * the loss at the big run. Callers with more exotic observations can
 * build their own fitters — the shape of the output record (`a`,
 * `b`, `c`) is the same either way.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScalingObservation {
  /** Training compute (any consistent unit — PF-days, FLOPs, tokens, etc.). */
  compute: number;
  /** Final loss reached at that compute. */
  loss: number;
}

export interface ScalingLawParams {
  /** Leading coefficient. */
  a: number;
  /** Power exponent (typically a small negative number). */
  b: number;
  /** Irreducible-loss asymptote. */
  c: number;
}

export interface ScalingLawFit {
  params: ScalingLawParams;
  /** Root mean squared residual on the training observations. */
  rmseTrain: number;
  /** R² on the training observations (1 − SS_res / SS_tot). */
  r2Train: number;
  /** The observations used to fit. */
  observations: ScalingObservation[];
}

// ---------------------------------------------------------------------------
// Power-law prediction
// ---------------------------------------------------------------------------

/** Predict the loss at a given compute under a fitted scaling law. */
export function predictLoss(compute: number, params: ScalingLawParams): number {
  if (compute <= 0) {
    throw new Error(`predictLoss: compute must be > 0, got ${compute}`);
  }
  return params.a * Math.pow(compute, params.b) + params.c;
}

// ---------------------------------------------------------------------------
// Fitter
// ---------------------------------------------------------------------------

export interface FitScalingLawOptions {
  /**
   * Fixed asymptote `c`. If omitted, the fitter uses a conservative
   * default: `min(loss) - 0.1 · (max(loss) - min(loss))`. This puts
   * `c` clearly below every observation (so `log(L - c)` is well
   * defined) without letting the minimum-loss point become a
   * dominant outlier in log space — a naive `c = min - ε` default
   * turns the minimum point's `log(L - c)` into `log(ε) ≈ −13.8`,
   * which swamps the OLS fit.
   *
   * Callers who know the true asymptote can pass it in directly.
   */
  asymptote?: number;
}

/**
 * Fit a scaling law of the form `L(C) = a·C^b + c` to a set of
 * (compute, loss) observations. Returns the best-fit parameters plus
 * training-set diagnostics (RMSE and R²).
 *
 * Method: two-phase.
 *   1. Fix `c` to `min(loss) - ε` (or caller-supplied).
 *   2. On `(log C, log(L − c))`, do ordinary least squares for the
 *      line `y = log(a) + b·x`. This is the classic log-log
 *      linearization of a power law.
 *
 * Requires at least 2 observations; more is better. Observations at
 * the same `compute` are allowed and do not cause division by zero.
 */
export function fitScalingLaw(
  observations: ScalingObservation[],
  options: FitScalingLawOptions = {},
): ScalingLawFit {
  if (observations.length < 2) {
    throw new Error(
      `fitScalingLaw: need at least 2 observations, got ${observations.length}`,
    );
  }
  for (let i = 0; i < observations.length; i++) {
    const o = observations[i];
    if (!Number.isFinite(o.compute) || o.compute <= 0) {
      throw new Error(
        `fitScalingLaw: observation[${i}].compute must be positive and finite`,
      );
    }
    if (!Number.isFinite(o.loss)) {
      throw new Error(`fitScalingLaw: observation[${i}].loss must be finite`);
    }
  }

  // Pick the asymptote
  let c: number;
  if (options.asymptote !== undefined) {
    c = options.asymptote;
  } else {
    let minLoss = Infinity;
    let maxLoss = -Infinity;
    for (const o of observations) {
      if (o.loss < minLoss) minLoss = o.loss;
      if (o.loss > maxLoss) maxLoss = o.loss;
    }
    // Gap = 10% of the observed loss range. Falls back to ε when the
    // range is degenerate. This keeps every `log(L - c)` comfortably
    // away from `log(0)`, so no single observation dominates the OLS
    // fit in log space.
    const range = maxLoss - minLoss;
    const gap = range > 0 ? 0.1 * range : 1e-6;
    c = minLoss - gap;
  }

  // Check every observation has loss > c
  for (let i = 0; i < observations.length; i++) {
    if (observations[i].loss <= c) {
      throw new Error(
        `fitScalingLaw: observation[${i}].loss (${observations[i].loss}) ≤ asymptote c (${c}); pick a smaller asymptote`,
      );
    }
  }

  // Log-log OLS: y = log(a) + b·x where x = log(C), y = log(L − c)
  const xs: number[] = [];
  const ys: number[] = [];
  for (const o of observations) {
    xs.push(Math.log(o.compute));
    ys.push(Math.log(o.loss - c));
  }
  const n = xs.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (let i = 0; i < n; i++) {
    sumX += xs[i];
    sumY += ys[i];
    sumXY += xs[i] * ys[i];
    sumXX += xs[i] * xs[i];
  }
  const denom = n * sumXX - sumX * sumX;
  if (Math.abs(denom) < 1e-12) {
    throw new Error(
      `fitScalingLaw: degenerate observations — every compute value is identical`,
    );
  }
  const b = (n * sumXY - sumX * sumY) / denom;
  const logA = (sumY - b * sumX) / n;
  const a = Math.exp(logA);
  const params: ScalingLawParams = { a, b, c };

  // Diagnostics on the ORIGINAL loss (not the log-transformed version),
  // so the numbers are meaningful in the same units as the input.
  let sumSqRes = 0;
  let sumObsLoss = 0;
  for (const o of observations) sumObsLoss += o.loss;
  const meanObs = sumObsLoss / n;
  let sumSqTot = 0;
  for (const o of observations) {
    const pred = predictLoss(o.compute, params);
    sumSqRes += (o.loss - pred) ** 2;
    sumSqTot += (o.loss - meanObs) ** 2;
  }
  const rmseTrain = Math.sqrt(sumSqRes / n);
  const r2Train = sumSqTot > 0 ? 1 - sumSqRes / sumSqTot : 1;

  return {
    params,
    rmseTrain,
    r2Train,
    observations,
  };
}

// ---------------------------------------------------------------------------
// Diagnostics / evaluation
// ---------------------------------------------------------------------------

/**
 * Compute the residual error of a fit at a withheld test observation —
 * useful for the §2.1 "predictability" methodology where small-scale
 * runs are used to predict a large-scale run.
 */
export function extrapolationError(
  fit: ScalingLawFit,
  test: ScalingObservation,
): { predicted: number; actual: number; absError: number; relError: number } {
  const predicted = predictLoss(test.compute, fit.params);
  const absError = Math.abs(predicted - test.loss);
  const relError = absError / Math.abs(test.loss);
  return { predicted, actual: test.loss, absError, relError };
}
