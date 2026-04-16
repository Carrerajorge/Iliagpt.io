/**
 * Transformer — mathematical correctness suite.
 *
 * Validates the pure TypeScript implementation of "Attention Is All You
 * Need" against hand-computed reference values and the paper's stated
 * invariants. Zero external libraries, zero randomness leakage (all
 * tests use seeded weights), deterministic.
 *
 * Cases:
 *   01. matmul: 2x3 × 3x2 against a hand-computed reference
 *   02. matmul: identity is neutral
 *   03. transpose: double transpose is the original
 *   04. softmax: each row sums to 1
 *   05. softmax: numerical stability with +1e9 inputs
 *   06. softmax: uniform input yields uniform output (1/n per entry)
 *   07. layer norm: per-row mean 0 and variance 1
 *   08. scaled dot-product attention: hand-computed small case
 *   09. attention scaling factor 1/sqrt(d_k) is applied
 *   10. attention weights sum to 1 per query row
 *   11. causal mask: future positions receive 0 attention
 *   12. masked attention: output only depends on allowed positions
 *   13. multi-head output shape is (n_q, d_model)
 *   14. multi-head splitHeads round-trips via concatCols
 *   15. positional encoding: PE(pos, 2i) = sin(...)
 *   16. positional encoding: different positions differ (injective)
 *   17. positional encoding: PE_{pos+k} is a linear function of PE_pos
 *       (the exact property the paper justifies the sinusoidal choice on)
 *   18. feed-forward: ReLU zeros negative inner activations
 *   19. encoder layer: forward pass is finite and shape-preserving
 *   20. decoder layer: masked self-attention + cross-attention + FFN
 *       produce finite output of the expected shape
 *   21. full transformer forward (tiny config): encoder + decoder pass
 *   22. encoder stack preserves the shape of its input
 *   23. attention-based reranker: query attends more to its nearest neighbor
 */

import { describe, it, expect } from "vitest";
import {
  // matrix
  type Matrix,
  create,
  zeros,
  identity,
  fromArray,
  toArray,
  xavier,
  matmul,
  transpose,
  add,
  softmax,
  layerNorm,
  causalMask,
  relu,
  concatCols,
  // attention
  scaledDotProductAttention,
  multiHeadAttention,
  initMultiHeadWeights,
  baseConfig,
  splitHeads,
  // encoding
  positionalEncoding,
  addPositional,
  initEmbeddingTable,
  embedTokens,
  // ffn
  feedForward,
  initFFNWeights,
  // transformer
  encoderLayer,
  decoderLayer,
  runEncoder,
  initEncoderLayerWeights,
  initDecoderLayerWeights,
  initTransformerWeights,
  tinyTransformerConfig,
  transformerForward,
} from "../lib/transformer";

// Small helper: all entries finite?
function allFinite(m: Matrix): boolean {
  for (let i = 0; i < m.data.length; i++) {
    if (!Number.isFinite(m.data[i])) return false;
  }
  return true;
}

function approxEqual(a: number, b: number, eps = 1e-9): boolean {
  return Math.abs(a - b) < eps;
}

describe("Transformer — mathematical correctness", () => {
  // -------------------------------------------------------------------------
  // 1. matmul small reference
  // -------------------------------------------------------------------------
  it("01 matmul: 2x3 × 3x2 matches hand-computed reference", () => {
    const a = fromArray([
      [1, 2, 3],
      [4, 5, 6],
    ]);
    const b = fromArray([
      [7, 8],
      [9, 10],
      [11, 12],
    ]);
    const out = toArray(matmul(a, b));
    // row 0: 1*7+2*9+3*11=58 | 1*8+2*10+3*12=64
    // row 1: 4*7+5*9+6*11=139 | 4*8+5*10+6*12=154
    expect(out).toEqual([
      [58, 64],
      [139, 154],
    ]);
  });

  // -------------------------------------------------------------------------
  // 2. identity is neutral
  // -------------------------------------------------------------------------
  it("02 matmul: identity is neutral for any matrix", () => {
    const m = fromArray([
      [1, 2, 3],
      [4, 5, 6],
    ]);
    const i3 = identity(3);
    const out = toArray(matmul(m, i3));
    expect(out).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
  });

  // -------------------------------------------------------------------------
  // 3. transpose is an involution
  // -------------------------------------------------------------------------
  it("03 transpose: applying twice returns the original", () => {
    const m = xavier(5, 7, 13);
    const twice = transpose(transpose(m));
    expect(twice.rows).toBe(m.rows);
    expect(twice.cols).toBe(m.cols);
    for (let i = 0; i < m.data.length; i++) {
      expect(twice.data[i]).toBeCloseTo(m.data[i], 12);
    }
  });

  // -------------------------------------------------------------------------
  // 4. softmax rows sum to 1
  // -------------------------------------------------------------------------
  it("04 softmax: every row sums to 1 (within 1e-12)", () => {
    const scores = fromArray([
      [1, 2, 3, 4],
      [-5, 0, 5, 10],
      [0.1, 0.1, 0.1, 0.1],
    ]);
    const probs = softmax(scores);
    for (let i = 0; i < probs.rows; i++) {
      let s = 0;
      for (let j = 0; j < probs.cols; j++) s += probs.data[i * probs.cols + j];
      expect(s).toBeCloseTo(1, 12);
    }
  });

  // -------------------------------------------------------------------------
  // 5. softmax numerical stability
  // -------------------------------------------------------------------------
  it("05 softmax: numerical stability on extreme inputs (max subtraction)", () => {
    // A naive softmax (exp(1e9) = Infinity → NaN on divide) would fail here.
    // Our stable version should still produce finite values summing to 1.
    const scores = fromArray([[1e9, 1e9 + 1, 1e9 + 2]]);
    const probs = softmax(scores);
    expect(allFinite(probs)).toBe(true);
    const sum = probs.data[0] + probs.data[1] + probs.data[2];
    expect(sum).toBeCloseTo(1, 12);
    // The largest score should get the largest probability.
    expect(probs.data[2]).toBeGreaterThan(probs.data[1]);
    expect(probs.data[1]).toBeGreaterThan(probs.data[0]);
  });

  // -------------------------------------------------------------------------
  // 6. softmax uniform input
  // -------------------------------------------------------------------------
  it("06 softmax: uniform input → uniform distribution (1/n each)", () => {
    const scores = fromArray([[7, 7, 7, 7]]);
    const probs = softmax(scores);
    for (let j = 0; j < 4; j++) {
      expect(probs.data[j]).toBeCloseTo(0.25, 12);
    }
  });

  // -------------------------------------------------------------------------
  // 7. layer norm stats
  // -------------------------------------------------------------------------
  it("07 layerNorm: each row has mean ≈ 0 and variance ≈ 1", () => {
    const m = fromArray([
      [1, 2, 3, 4, 5],
      [10, -10, 0, 5, -5],
      [100, 200, 300, 400, 500],
    ]);
    const ln = layerNorm(m);
    for (let i = 0; i < ln.rows; i++) {
      let mean = 0;
      for (let j = 0; j < ln.cols; j++) mean += ln.data[i * ln.cols + j];
      mean /= ln.cols;
      let v = 0;
      for (let j = 0; j < ln.cols; j++) {
        const d = ln.data[i * ln.cols + j] - mean;
        v += d * d;
      }
      v /= ln.cols;
      expect(Math.abs(mean)).toBeLessThan(1e-12);
      // Variance is (1 - eps/(var+eps)) slightly less than 1; close enough
      // for non-degenerate rows.
      expect(v).toBeCloseTo(1, 4);
    }
  });

  // -------------------------------------------------------------------------
  // 8. scaled dot-product attention — hand-computed reference
  // -------------------------------------------------------------------------
  it("08 scaled dot-product attention: hand-computed small case matches", () => {
    // Q: 1 query, d_k=2
    // K: 2 keys,  d_k=2
    // V: 2 vals,  d_v=3
    const Q = fromArray([[1, 0]]);
    const K = fromArray([
      [1, 0],
      [0, 1],
    ]);
    const V = fromArray([
      [1, 2, 3],
      [4, 5, 6],
    ]);
    // scores = Q·K^T = [[1, 0]]
    // scaled = scores / sqrt(2) = [[0.7071..., 0]]
    // softmax([[0.7071, 0]]) = [[e^0.7071, 1] / (e^0.7071 + 1)]
    const { output, weights, scaledScores } = scaledDotProductAttention(Q, K, V);
    // scaled scores: expect [0.707..., 0]
    expect(scaledScores.data[0]).toBeCloseTo(1 / Math.sqrt(2), 12);
    expect(scaledScores.data[1]).toBeCloseTo(0, 12);
    // weights should sum to 1
    expect(weights.data[0] + weights.data[1]).toBeCloseTo(1, 12);
    // Output = w0*V[0] + w1*V[1]
    const w0 = weights.data[0];
    const w1 = weights.data[1];
    expect(output.data[0]).toBeCloseTo(w0 * 1 + w1 * 4, 12);
    expect(output.data[1]).toBeCloseTo(w0 * 2 + w1 * 5, 12);
    expect(output.data[2]).toBeCloseTo(w0 * 3 + w1 * 6, 12);
  });

  // -------------------------------------------------------------------------
  // 9. attention scaling factor
  // -------------------------------------------------------------------------
  it("09 attention: scores are divided by sqrt(d_k)", () => {
    // Build Q=K=V with d_k=16 so sqrt(d_k)=4. Then a dot product of 16
    // should turn into a scaled score of exactly 4.
    const d_k = 16;
    const Q = create(1, d_k, 1); // all ones
    const K = create(1, d_k, 1); // all ones → Q·K^T = [d_k]
    const V = fromArray([[99]]);
    const { scaledScores } = scaledDotProductAttention(Q, K, V);
    expect(scaledScores.data[0]).toBeCloseTo(d_k / Math.sqrt(d_k), 12);
    expect(scaledScores.data[0]).toBeCloseTo(Math.sqrt(d_k), 12);
  });

  // -------------------------------------------------------------------------
  // 10. weights per-row sum
  // -------------------------------------------------------------------------
  it("10 attention: weights sum to 1 per query row", () => {
    const Q = xavier(5, 8, 1);
    const K = xavier(7, 8, 2);
    const V = xavier(7, 4, 3);
    const { weights } = scaledDotProductAttention(Q, K, V);
    for (let i = 0; i < 5; i++) {
      let s = 0;
      for (let j = 0; j < 7; j++) s += weights.data[i * 7 + j];
      expect(s).toBeCloseTo(1, 12);
    }
  });

  // -------------------------------------------------------------------------
  // 11. causal mask: decoder can't peek at the future
  // -------------------------------------------------------------------------
  it("11 causal mask: decoder self-attention zeroes future positions", () => {
    const seq = 5;
    const d_k = 4;
    const Q = xavier(seq, d_k, 10);
    const K = xavier(seq, d_k, 11);
    const V = xavier(seq, d_k, 12);
    const mask = causalMask(seq);
    const { weights } = scaledDotProductAttention(Q, K, V, mask);
    // weights[i][j] must be 0 for j > i
    for (let i = 0; i < seq; i++) {
      for (let j = i + 1; j < seq; j++) {
        expect(weights.data[i * seq + j]).toBeCloseTo(0, 12);
      }
      // Row still sums to 1 (rebalanced across allowed positions)
      let s = 0;
      for (let j = 0; j <= i; j++) s += weights.data[i * seq + j];
      expect(s).toBeCloseTo(1, 12);
    }
  });

  // -------------------------------------------------------------------------
  // 12. masked attention output only sees allowed positions
  // -------------------------------------------------------------------------
  it("12 masked attention: output is a convex combination of allowed values only", () => {
    const Q = fromArray([[1, 0]]);
    const K = fromArray([
      [1, 0],
      [0.9, 0.1],
      [0, 1],
    ]);
    const V = fromArray([
      [1, 0],
      [0, 1],
      [1, 1],
    ]);
    // Mask out the middle key
    const mask = [[true, false, true]];
    const { output, weights } = scaledDotProductAttention(Q, K, V, mask);
    // The middle weight must be exactly 0
    expect(weights.data[1]).toBeCloseTo(0, 12);
    // The two remaining weights must sum to 1
    expect(weights.data[0] + weights.data[2]).toBeCloseTo(1, 12);
    // Output components are within the convex hull of V[0] and V[2]
    const min0 = Math.min(V.data[0], V.data[4]);
    const max0 = Math.max(V.data[0], V.data[4]);
    expect(output.data[0]).toBeGreaterThanOrEqual(min0 - 1e-12);
    expect(output.data[0]).toBeLessThanOrEqual(max0 + 1e-12);
  });

  // -------------------------------------------------------------------------
  // 13. multi-head output shape
  // -------------------------------------------------------------------------
  it("13 multi-head attention: output shape = (n_q, d_model)", () => {
    const cfg = baseConfig(32, 4); // d_model=32, h=4, d_k=d_v=8
    const W = initMultiHeadWeights(cfg, 99);
    const Q = xavier(6, 32, 10);
    const K = xavier(10, 32, 11);
    const V = xavier(10, 32, 12);
    const { output, perHeadWeights } = multiHeadAttention(Q, K, V, cfg, W);
    expect(output.rows).toBe(6);
    expect(output.cols).toBe(32);
    expect(perHeadWeights.length).toBe(4);
    for (const w of perHeadWeights) {
      expect(w.rows).toBe(6);
      expect(w.cols).toBe(10);
    }
    expect(allFinite(output)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 14. splitHeads ↔ concatCols round trip
  // -------------------------------------------------------------------------
  it("14 splitHeads + concatCols round-trips the original matrix", () => {
    const m = xavier(8, 32, 7);
    const heads = splitHeads(m, 4);
    expect(heads.length).toBe(4);
    for (const h of heads) {
      expect(h.rows).toBe(8);
      expect(h.cols).toBe(8);
    }
    const rebuilt = concatCols(heads);
    expect(rebuilt.rows).toBe(8);
    expect(rebuilt.cols).toBe(32);
    for (let i = 0; i < m.data.length; i++) {
      expect(rebuilt.data[i]).toBeCloseTo(m.data[i], 12);
    }
  });

  // -------------------------------------------------------------------------
  // 15. positional encoding values
  // -------------------------------------------------------------------------
  it("15 positional encoding: PE(pos, 0) = sin(pos), PE(pos, 1) = cos(pos)", () => {
    const pe = positionalEncoding(5, 8);
    // For i=0: denominator = 10000^(0/8) = 1, so PE(pos, 0) = sin(pos)
    // For i=1: denominator = 10000^(0/8) = 1, so PE(pos, 1) = cos(pos)
    for (let pos = 0; pos < 5; pos++) {
      expect(pe.data[pos * 8 + 0]).toBeCloseTo(Math.sin(pos), 12);
      expect(pe.data[pos * 8 + 1]).toBeCloseTo(Math.cos(pos), 12);
    }
    // For i=2: denominator = 10000^(2/8) = 10^(1) = 10
    for (let pos = 0; pos < 5; pos++) {
      expect(pe.data[pos * 8 + 2]).toBeCloseTo(Math.sin(pos / 10), 12);
      expect(pe.data[pos * 8 + 3]).toBeCloseTo(Math.cos(pos / 10), 12);
    }
  });

  // -------------------------------------------------------------------------
  // 16. positional encoding: different positions differ
  // -------------------------------------------------------------------------
  it("16 positional encoding: different positions yield different encodings", () => {
    const pe = positionalEncoding(100, 64);
    // Collect each row as a string key
    const seen = new Set<string>();
    for (let pos = 0; pos < 100; pos++) {
      const row: number[] = [];
      for (let j = 0; j < 64; j++) row.push(pe.data[pos * 64 + j]);
      const key = row.map((n) => n.toFixed(8)).join(",");
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  // -------------------------------------------------------------------------
  // 17. PE_{pos+k} is a linear function of PE_pos (the paper's key claim)
  // -------------------------------------------------------------------------
  it("17 positional encoding: PE_{pos+k} is a linear function of PE_pos (sin/cos rotation)", () => {
    // sin(pos+k) = sin(pos)cos(k) + cos(pos)sin(k)
    // cos(pos+k) = cos(pos)cos(k) - sin(pos)sin(k)
    // Which is exactly multiplication by a 2x2 rotation matrix for each
    // (sin, cos) pair of dimensions. We verify this numerically.
    const dModel = 16;
    const seqLen = 20;
    const pe = positionalEncoding(seqLen, dModel);
    const k = 3;
    for (let pos = 0; pos + k < seqLen; pos++) {
      for (let i = 0; i < dModel; i += 2) {
        const denom = Math.pow(10000, (2 * Math.floor(i / 2)) / dModel);
        const angleK = k / denom;
        const cosK = Math.cos(angleK);
        const sinK = Math.sin(angleK);
        const sinPos = pe.data[pos * dModel + i];
        const cosPos = pe.data[pos * dModel + i + 1];
        // Expected PE_{pos+k}:
        const expectedSin = sinPos * cosK + cosPos * sinK;
        const expectedCos = cosPos * cosK - sinPos * sinK;
        const actualSin = pe.data[(pos + k) * dModel + i];
        const actualCos = pe.data[(pos + k) * dModel + i + 1];
        expect(actualSin).toBeCloseTo(expectedSin, 10);
        expect(actualCos).toBeCloseTo(expectedCos, 10);
      }
    }
  });

  // -------------------------------------------------------------------------
  // 18. FFN / ReLU
  // -------------------------------------------------------------------------
  it("18 feed-forward: ReLU masks out negative pre-activations", () => {
    const m = fromArray([
      [-1, 2, -3, 4],
      [5, -6, 7, -8],
    ]);
    const r = relu(m);
    expect(toArray(r)).toEqual([
      [0, 2, 0, 4],
      [5, 0, 7, 0],
    ]);
  });

  // -------------------------------------------------------------------------
  // 19. encoder layer: forward pass shape + finite
  // -------------------------------------------------------------------------
  it("19 encoder layer: forward pass is finite and shape-preserving", () => {
    const cfg = baseConfig(16, 4); // d_model=16, h=4
    const weights = initEncoderLayerWeights(cfg, 32, 777);
    const x = addPositional(xavier(8, 16, 100), positionalEncoding(8, 16));
    const out = encoderLayer(x, weights, cfg);
    expect(out.rows).toBe(8);
    expect(out.cols).toBe(16);
    expect(allFinite(out)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 20. decoder layer: forward pass
  // -------------------------------------------------------------------------
  it("20 decoder layer: masked self-attn + cross-attn + FFN is finite and shape-preserving", () => {
    const cfg = baseConfig(16, 4);
    const weights = initDecoderLayerWeights(cfg, 32, 888);
    const tgt = addPositional(xavier(5, 16, 200), positionalEncoding(5, 16));
    const encOut = xavier(8, 16, 300);
    const out = decoderLayer(tgt, encOut, weights, cfg);
    expect(out.rows).toBe(5);
    expect(out.cols).toBe(16);
    expect(allFinite(out)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 21. full transformer forward
  // -------------------------------------------------------------------------
  it("21 full transformer (tiny config): encoder + decoder forward pass", () => {
    const config = tinyTransformerConfig();
    const weights = initTransformerWeights(config, 42);
    const dModel = config.attention.dModel;
    const src = addPositional(xavier(10, dModel, 50), positionalEncoding(10, dModel));
    const tgt = addPositional(xavier(6, dModel, 51), positionalEncoding(6, dModel));
    const { encoderOutput, decoderOutput } = transformerForward(src, tgt, weights, config);
    expect(encoderOutput.rows).toBe(10);
    expect(encoderOutput.cols).toBe(dModel);
    expect(decoderOutput.rows).toBe(6);
    expect(decoderOutput.cols).toBe(dModel);
    expect(allFinite(encoderOutput)).toBe(true);
    expect(allFinite(decoderOutput)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 22. encoder stack preserves shape across N layers
  // -------------------------------------------------------------------------
  it("22 encoder stack (6 layers) preserves input shape", () => {
    const cfg = baseConfig(16, 4);
    const stack = [
      initEncoderLayerWeights(cfg, 32, 1),
      initEncoderLayerWeights(cfg, 32, 2),
      initEncoderLayerWeights(cfg, 32, 3),
      initEncoderLayerWeights(cfg, 32, 4),
      initEncoderLayerWeights(cfg, 32, 5),
      initEncoderLayerWeights(cfg, 32, 6),
    ];
    const x = addPositional(xavier(12, 16, 999), positionalEncoding(12, 16));
    const out = runEncoder(x, stack, cfg);
    expect(out.rows).toBe(12);
    expect(out.cols).toBe(16);
    expect(allFinite(out)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 23. attention-based reranker: the nearest neighbor wins
  // -------------------------------------------------------------------------
  it("23 attention reranker: query attends most to its nearest-neighbor document", () => {
    // Three "document" vectors — one of them is identical to the query
    // (modulo rotation). Dot-product attention should give it the highest
    // weight since it maximizes the alignment.
    const query = fromArray([[1, 0, 0, 0]]);
    const docs = fromArray([
      [0.9, 0.1, 0.0, 0.0], // close
      [0.0, 0.0, 1.0, 0.0], // orthogonal
      [-1, 0, 0, 0], // opposite
    ]);
    const values = identity(3); // one-hot rows so we can read which doc "won"
    const { weights } = scaledDotProductAttention(query, docs, values);
    // Doc 0 (close) should win
    const w0 = weights.data[0];
    const w1 = weights.data[1];
    const w2 = weights.data[2];
    expect(w0).toBeGreaterThan(w1);
    expect(w0).toBeGreaterThan(w2);
    expect(w0 + w1 + w2).toBeCloseTo(1, 12);
  });

  // -------------------------------------------------------------------------
  // 24. embedding table + positional encoding composition
  // -------------------------------------------------------------------------
  it("24 token embedding + positional encoding: combined shape is (seq_len, d_model)", () => {
    const table = initEmbeddingTable(100, 16, 123);
    const tokens = [5, 42, 17, 99, 0];
    const emb = embedTokens(table, tokens);
    const pe = positionalEncoding(tokens.length, 16);
    const combined = addPositional(emb, pe);
    expect(combined.rows).toBe(5);
    expect(combined.cols).toBe(16);
    expect(allFinite(combined)).toBe(true);
    // The scale factor sqrt(d_model)=4 is baked into embedTokens
    expect(Math.abs(emb.data[0]) > Math.abs(table.weights.data[5 * 16 + 0])).toBe(true);
  });
});
