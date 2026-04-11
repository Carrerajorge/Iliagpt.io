/**
 * Auto-regressive decoding: greedy + beam search.
 *
 * Section 6.1 of the paper:
 *
 *   "We used beam search with a beam size of 4 and length penalty α = 0.6
 *    [31]. These hyperparameters were chosen after experimentation on the
 *    development set. We set the maximum output length during inference
 *    to input length + 50, but terminate early when possible."
 *
 * This module exposes two decoders that both operate on the same
 * Transformer stack we built earlier (section 3.1). Both decoders:
 *
 *   1. Start with the BOS (begin-of-sequence) token only.
 *   2. Repeat: encode the full tgt so far, take the logits of the LAST
 *      position, select next token, append, re-run the decoder.
 *   3. Terminate on EOS or when reaching `maxLength`.
 *
 * This is the standard "re-encode the prefix" pattern. Incremental
 * KV-caching would be a later optimization — it's not part of the
 * paper and isn't needed for the pedagogical scope of this module.
 */

import { type Matrix } from "./matrix";
import { type MultiHeadConfig } from "./attention";
import { runDecoder, type DecoderLayerWeights } from "./transformer";
import { type EmbeddingTable, embedTokens, positionalEncoding, addPositional } from "./encoding";
import { tiedOutputLogits, argmaxTokens, logitsToProbs } from "./outputProjection";
import { logSoftmax } from "./loss";

// ---------------------------------------------------------------------------
// Common machinery: given a target prefix, run encoder→decoder and return
// the logits over the vocab for the NEXT token.
// ---------------------------------------------------------------------------

export interface DecodeContext {
  /** Encoder output, shape (src_len, d_model). Precomputed once per call. */
  encoderOutput: Matrix;
  /** The shared embedding table (used for tgt embedding + tied output projection). */
  embeddingTable: EmbeddingTable;
  /** Decoder layer weights stack. */
  decoderWeights: DecoderLayerWeights[];
  /** Multi-head attention config. */
  attentionConfig: MultiHeadConfig;
  /** Optional source padding mask. Same shape each call. */
  srcPaddingMask?: boolean[][];
}

/**
 * Run the decoder for a given target prefix and return the logits over
 * the vocabulary for the LAST position. This is the per-step work of
 * auto-regressive decoding.
 */
export function nextTokenLogits(tgtTokens: number[], ctx: DecodeContext): Float64Array {
  const tgtEmb = embedTokens(ctx.embeddingTable, tgtTokens);
  const withPE = addPositional(tgtEmb, positionalEncoding(tgtTokens.length, ctx.embeddingTable.dModel));
  const decoderOutput = runDecoder(
    withPE,
    ctx.encoderOutput,
    ctx.decoderWeights,
    ctx.attentionConfig,
    ctx.srcPaddingMask,
  );
  const logits = tiedOutputLogits(decoderOutput, ctx.embeddingTable);
  // Take the LAST row (the prediction for the position we just appended)
  const last = logits.rows - 1;
  const vocab = logits.cols;
  const row = new Float64Array(vocab);
  for (let j = 0; j < vocab; j++) row[j] = logits.data[last * vocab + j];
  return row;
}

// ---------------------------------------------------------------------------
// Greedy decoding
// ---------------------------------------------------------------------------

export interface GreedyConfig {
  /** Begin-of-sequence token id. Used to seed the decoder. */
  bosId: number;
  /** End-of-sequence token id. Terminates generation when emitted. */
  eosId: number;
  /** Maximum output length (paper: src_len + 50). */
  maxLength: number;
}

export interface GreedyResult {
  /** The generated token ids, including BOS and (optionally) EOS. */
  tokens: number[];
  /** Whether generation terminated naturally via an EOS emission. */
  hitEOS: boolean;
  /** Total number of decoder forward passes performed (≤ maxLength). */
  steps: number;
}

/**
 * Greedy auto-regressive decoding: at each step, emit the argmax token.
 * Terminates on EOS or when the output length reaches `maxLength`.
 */
export function greedyDecode(ctx: DecodeContext, config: GreedyConfig): GreedyResult {
  const tokens: number[] = [config.bosId];
  let hitEOS = false;
  let steps = 0;

  while (tokens.length < config.maxLength) {
    const logits = nextTokenLogits(tokens, ctx);
    steps++;
    // argmax over the 1-row matrix
    let bestId = 0;
    let bestVal = -Infinity;
    for (let j = 0; j < logits.length; j++) {
      if (logits[j] > bestVal) {
        bestVal = logits[j];
        bestId = j;
      }
    }
    tokens.push(bestId);
    if (bestId === config.eosId) {
      hitEOS = true;
      break;
    }
  }

  return { tokens, hitEOS, steps };
}

// ---------------------------------------------------------------------------
// Beam search
// ---------------------------------------------------------------------------

export interface BeamSearchConfig {
  /** Begin-of-sequence token id. */
  bosId: number;
  /** End-of-sequence token id. */
  eosId: number;
  /** Maximum output length. Paper: src_len + 50. */
  maxLength: number;
  /** Beam width. Paper: 4. */
  beamSize: number;
  /**
   * Length penalty exponent α (paper: 0.6).
   *
   *   length_norm = ((5 + len)^α) / ((5 + 1)^α)
   *
   * Setting α to 0 disables length normalization. Higher α favors
   * longer sequences (since it divides negative log-prob sums by the
   * normalizer).
   */
  lengthPenalty: number;
}

export interface BeamHypothesis {
  tokens: number[];
  /** Sum of log-probabilities along the sequence (negative, larger = better). */
  logProbSum: number;
  /** Final normalized score (the actual ranking signal). */
  score: number;
  /** Whether this hypothesis terminated with an EOS. */
  finished: boolean;
}

export interface BeamSearchResult {
  /** Top-k hypotheses ordered by descending score. */
  hypotheses: BeamHypothesis[];
  /** The best hypothesis (convenience shortcut = hypotheses[0]). */
  best: BeamHypothesis;
  /** Total number of decoder forward passes performed. */
  steps: number;
}

/**
 * Length-penalty normalization (Wu et al. 2016, as used by the paper).
 *
 *   lp(Y) = ((5 + |Y|)^α) / ((5 + 1)^α)
 *
 * The final hypothesis score is `logProbSum / lp(|Y|)`.
 */
function lengthPenalty(length: number, alpha: number): number {
  if (alpha === 0) return 1;
  return Math.pow((5 + length) / 6, alpha);
}

/**
 * Beam search decoding. Produces the top-k hypotheses sorted by
 * length-penalized log-probability.
 *
 * Implementation notes:
 *   - We keep a single list of "live" beams and a separate list of
 *     "finished" (EOS-terminated) beams. At each step we expand every
 *     live beam with its top-`beamSize` next tokens, then prune to
 *     `beamSize` best sequences overall.
 *   - Termination: when all live beams have finished OR `maxLength`
 *     is reached, we return the top `beamSize` finished hypotheses
 *     (falling back to live beams if none finished).
 */
export function beamSearchDecode(
  ctx: DecodeContext,
  config: BeamSearchConfig,
): BeamSearchResult {
  if (config.beamSize < 1) {
    throw new Error(`beamSearchDecode: beamSize must be ≥ 1`);
  }

  // Each beam is represented as (tokens, cumulative log prob)
  let live: Array<{ tokens: number[]; logProbSum: number }> = [
    { tokens: [config.bosId], logProbSum: 0 },
  ];
  const finished: BeamHypothesis[] = [];
  let steps = 0;

  while (live.length > 0) {
    // Hard stop: any beam reached maxLength
    if (live.some((b) => b.tokens.length >= config.maxLength)) break;

    // Expand every live beam with its top-`beamSize` next tokens
    const candidates: Array<{ tokens: number[]; logProbSum: number }> = [];

    for (const beam of live) {
      const logits = nextTokenLogits(beam.tokens, ctx);
      steps++;
      // Numerically stable log-softmax for this row
      const logitsMat: Matrix = {
        rows: 1,
        cols: logits.length,
        data: logits,
      };
      const logProbs = logSoftmax(logitsMat).data;
      // Take top-beamSize token ids for this beam
      const topIds: Array<{ id: number; lp: number }> = [];
      for (let j = 0; j < logProbs.length; j++) {
        topIds.push({ id: j, lp: logProbs[j] });
      }
      topIds.sort((a, b) => b.lp - a.lp);
      for (let i = 0; i < Math.min(config.beamSize, topIds.length); i++) {
        const { id, lp } = topIds[i];
        candidates.push({
          tokens: [...beam.tokens, id],
          logProbSum: beam.logProbSum + lp,
        });
      }
    }

    // Sort all candidates by raw log-prob and keep top `beamSize`
    candidates.sort((a, b) => b.logProbSum - a.logProbSum);
    const survivors = candidates.slice(0, config.beamSize);

    // Separate finished (EOS-terminated) from live
    live = [];
    for (const c of survivors) {
      const lastTok = c.tokens[c.tokens.length - 1];
      if (lastTok === config.eosId) {
        // Exclude BOS from length for normalization
        const seqLen = c.tokens.length - 1;
        finished.push({
          tokens: c.tokens,
          logProbSum: c.logProbSum,
          score: c.logProbSum / lengthPenalty(seqLen, config.lengthPenalty),
          finished: true,
        });
      } else {
        live.push(c);
      }
    }

    if (finished.length >= config.beamSize) break;
  }

  // If we ran out of iterations with live beams, convert them too
  for (const b of live) {
    const seqLen = b.tokens.length - 1;
    finished.push({
      tokens: b.tokens,
      logProbSum: b.logProbSum,
      score: b.logProbSum / lengthPenalty(seqLen, config.lengthPenalty),
      finished: false,
    });
  }

  finished.sort((a, b) => b.score - a.score);
  const topK = finished.slice(0, config.beamSize);
  return { hypotheses: topK, best: topK[0], steps };
}

// Suppress unused import warning
void argmaxTokens;
void logitsToProbs;
