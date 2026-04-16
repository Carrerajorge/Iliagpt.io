/**
 * Toy copy task — the simplest possible sequence-to-sequence problem.
 *
 * Input : a sequence of random integers in [2, vocab_size)
 * Target: the same sequence, reversed
 *
 * Special tokens:
 *   0 = PAD
 *   1 = BOS / EOS (shared for simplicity)
 *
 * A Transformer that learns this task end-to-end is a direct proof that
 * the attention + FFN machinery + Adam optimizer + LR schedule actually
 * do something meaningful when wired together. It's the smallest
 * non-trivial sequence modeling task that still exercises self-attention
 * and encoder-decoder cross-attention.
 */

export interface CopyTaskExample {
  src: number[]; // input sequence (no BOS/EOS)
  tgt: number[]; // target sequence (no BOS/EOS) — reversed
  tgtIn: number[]; // decoder input = [BOS, ...target[:-1]]
  tgtOut: number[]; // decoder target = [...target, EOS]
}

export const PAD_ID = 0;
export const BOS_ID = 1;
export const EOS_ID = 1; // same as BOS — simpler for test setup

export interface CopyTaskConfig {
  vocabSize: number;
  sequenceLength: number;
  /** Seed for reproducibility. */
  seed?: number;
}

function makeRand(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generate `count` examples of the copy/reverse task.
 *
 *   example.src    = [a, b, c, d]         (random ids in [2, vocab))
 *   example.tgt    = [d, c, b, a]         (reversed)
 *   example.tgtIn  = [BOS, d, c, b]       (shifted right, BOS-prepended)
 *   example.tgtOut = [d, c, b, a, EOS]    (target for CE loss)
 */
export function generateCopyTaskBatch(
  count: number,
  config: CopyTaskConfig,
): CopyTaskExample[] {
  if (config.vocabSize < 3) {
    throw new Error(`generateCopyTaskBatch: vocabSize must be ≥ 3`);
  }
  const rand = makeRand(config.seed ?? 0xdeadbeef);
  const out: CopyTaskExample[] = [];
  for (let i = 0; i < count; i++) {
    const src: number[] = [];
    for (let j = 0; j < config.sequenceLength; j++) {
      // Token ids in [2, vocab) — avoid PAD=0 and BOS/EOS=1
      src.push(2 + Math.floor(rand() * (config.vocabSize - 2)));
    }
    const tgt = [...src].reverse();
    // Standard "shifted-right" pattern: both tgtIn and tgtOut have length n+1.
    //   tgtIn  = [BOS, y_1, y_2, ..., y_n]      — decoder input
    //   tgtOut = [y_1, y_2, ..., y_n, EOS]      — target for CE loss
    // At each position i, the model predicts tgtOut[i] given tgtIn[0..i].
    const tgtIn = [BOS_ID, ...tgt];
    const tgtOut = [...tgt, EOS_ID];
    out.push({ src, tgt, tgtIn, tgtOut });
  }
  return out;
}
