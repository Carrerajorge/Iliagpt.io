/**
 * GPT-3 — paper-faithful test suite (Brown et al. 2020, arXiv:2005.14165).
 *
 * Covers every piece of the in-house GPT-3 implementation:
 *
 *   1. Table 2.1 model presets (configs, alternating pattern)
 *   2. Sparse attention masks (localBand, strided, fullCausal)
 *   3. Sampling strategies (temperature, top-k, top-p, composition)
 *   4. Full forward pass (decoder-only, bidirectional NOT allowed)
 *   5. gptGenerate autoregressive loop (greedy + sampled)
 *   6. In-context learning prompt builder (zero/one/few-shot)
 *   7. GPT3_ADAM + cosine LR schedule
 */

import { describe, it, expect } from "vitest";
import {
  type Matrix,
  // matrix utilities
  fromArray,
  // sampling
  applyTemperature,
  softmaxVector,
  topKFilter,
  topPFilter,
  sampleFromLogits,
  countSurvivors,
  // masks
  localBandMask,
  stridedSparseMask,
  fullCausalMask,
  maskDensity,
  // configs + presets
  gpt3SmallConfig,
  gpt3LargeConfig,
  gpt3_175BConfig,
  gptTinyConfig,
  allGptPresets,
  gptPreset,
  defaultAlternatingPattern,
  // model
  initGptWeights,
  gptInputEmbeddings,
  gptForward,
  gptNextTokenLogits,
  runGptStack,
  // generate
  gptGenerate,
  // in-context learning
  buildInContextPrompt,
  inContextModeOf,
  assertInContextMode,
  validateInContextPrompt,
  // optimizer / schedule
  GPT3_ADAM,
  GPT3_WEIGHT_DECAY,
  PAPER_ADAM,
  BERT_ADAM,
  gpt3CosineSchedule,
} from "../lib/transformer";

function allFinite(m: Matrix): boolean {
  for (const v of m.data) if (!Number.isFinite(v)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// 1. Table 2.1 model presets
// ---------------------------------------------------------------------------

describe("GPT-3 model presets (Table 2.1)", () => {
  it("1 gpt3-small matches the paper: L=12 d=768 h=12 d_head=64", () => {
    const c = gpt3SmallConfig();
    expect(c.numLayers).toBe(12);
    expect(c.hiddenSize).toBe(768);
    expect(c.numHeads).toBe(12);
    expect(c.headSize).toBe(64);
    expect(c.intermediateSize).toBe(4 * 768); // 4H rule
    expect(c.contextWindow).toBe(2048);
    expect(c.vocabSize).toBe(50257);
  });

  it("2 gpt3-large matches paper: L=24 d=1536 h=16", () => {
    const c = gpt3LargeConfig();
    expect(c.numLayers).toBe(24);
    expect(c.hiddenSize).toBe(1536);
    expect(c.numHeads).toBe(16);
  });

  it("3 gpt3-175b matches paper: L=96 d=12288 h=96 d_head=128", () => {
    const c = gpt3_175BConfig();
    expect(c.numLayers).toBe(96);
    expect(c.hiddenSize).toBe(12288);
    expect(c.numHeads).toBe(96);
    expect(c.headSize).toBe(128);
    // The paper headlines ~175B params; our estimator rounds to a
    // close-but-not-identical value. Accept [160B, 200B].
    expect(c.approxParamsMillions).toBeGreaterThan(160_000);
    expect(c.approxParamsMillions).toBeLessThan(200_000);
  });

  it("4 allGptPresets exposes every Table 2.1 row plus the tiny config", () => {
    const keys = Object.keys(allGptPresets()).sort();
    expect(keys).toEqual([
      "gpt3-13b",
      "gpt3-175b",
      "gpt3-2.7b",
      "gpt3-6.7b",
      "gpt3-large",
      "gpt3-medium",
      "gpt3-small",
      "gpt3-tiny",
      "gpt3-xl",
    ]);
  });

  it("5 gptPreset throws on unknown names", () => {
    expect(() => gptPreset("gpt4-ultra")).toThrow();
  });

  it("6 defaultAlternatingPattern alternates dense/sparse starting with dense", () => {
    const pattern = defaultAlternatingPattern(6);
    expect(pattern).toEqual(["dense", "sparse", "dense", "sparse", "dense", "sparse"]);
  });

  it("7 preset attentionPatterns length == numLayers", () => {
    for (const [, cfg] of Object.entries(allGptPresets())) {
      expect(cfg.attentionPatterns.length).toBe(cfg.numLayers);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Sparse attention masks
// ---------------------------------------------------------------------------

describe("GPT-3 sparse attention masks (§2.1, Sparse Transformer)", () => {
  it("8 fullCausalMask is lower-triangular", () => {
    const m = fullCausalMask(4);
    // Row i: true for j ≤ i, false for j > i
    expect(m).toEqual([
      [true, false, false, false],
      [true, true, false, false],
      [true, true, true, false],
      [true, true, true, true],
    ]);
    // Density = (1+2+3+4)/16 = 10/16 = 0.625
    expect(maskDensity(m)).toBeCloseTo(10 / 16, 10);
  });

  it("9 localBandMask with bandSize=2 only attends to the current and previous position", () => {
    const m = localBandMask(4, 2);
    expect(m).toEqual([
      [true, false, false, false],
      [true, true, false, false],
      [false, true, true, false],
      [false, false, true, true],
    ]);
  });

  it("10 stridedSparseMask is strictly sparser than full causal for a long sequence", () => {
    const n = 20;
    const dense = fullCausalMask(n);
    const sparse = stridedSparseMask(n, 3, 4);
    const denseDensity = maskDensity(dense);
    const sparseDensity = maskDensity(sparse);
    expect(sparseDensity).toBeLessThan(denseDensity);
    expect(sparseDensity).toBeGreaterThan(0);
  });

  it("11 stridedSparseMask stays causal (never attends to the future)", () => {
    const m = stridedSparseMask(10, 2, 3);
    for (let i = 0; i < m.length; i++) {
      for (let j = i + 1; j < m.length; j++) {
        expect(m[i][j]).toBe(false);
      }
    }
  });

  it("12 localBandMask rejects invalid parameters", () => {
    expect(() => localBandMask(-1, 2)).toThrow();
    expect(() => localBandMask(10, 0)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// 3. Sampling strategies
// ---------------------------------------------------------------------------

describe("GPT-3 sampling (temperature, top-k, top-p)", () => {
  it("13 applyTemperature with T=1 is identity", () => {
    const logits = [1, 2, 3, 4];
    const out = applyTemperature(logits, 1);
    for (let i = 0; i < 4; i++) expect(out[i]).toBeCloseTo(logits[i], 12);
  });

  it("14 applyTemperature with T<1 makes argmax dominate", () => {
    const logits = [1, 2];
    const cool = applyTemperature(logits, 0.5);
    const probsCool = softmaxVector(cool);
    const probsHot = softmaxVector(applyTemperature(logits, 2));
    // Lower temperature → argmax dominates more
    expect(probsCool[1]).toBeGreaterThan(probsHot[1]);
  });

  it("15 applyTemperature with T≤0 collapses to argmax", () => {
    const logits = [1, 5, 3, 2];
    const out = applyTemperature(logits, 0);
    // Only the argmax (index 1) is finite (= 0); others are -Infinity
    expect(out[1]).toBe(0);
    for (let i = 0; i < 4; i++) {
      if (i !== 1) expect(out[i]).toBe(-Infinity);
    }
  });

  it("16 topKFilter keeps exactly K finite entries", () => {
    const logits = [0.1, 0.9, 0.2, 0.8, 0.5];
    const out = topKFilter(logits, 2);
    // Sorted desc: 0.9, 0.8, 0.5, 0.2, 0.1 — threshold = 0.8
    // Survivors: 0.9, 0.8
    const finite: number[] = [];
    for (let i = 0; i < out.length; i++) if (Number.isFinite(out[i])) finite.push(out[i]);
    expect(finite.sort()).toEqual([0.8, 0.9]);
  });

  it("17 topPFilter keeps the smallest nucleus that reaches p", () => {
    // Logits chosen so probabilities are ~[0.05, 0.25, 0.60, 0.10]
    const logits = [-1, 0.6, 1.5, -0.3];
    const out = topPFilter(logits, 0.7);
    // Top by prob: 0.60 alone = 0.60 < 0.70, add 0.25 → 0.85 ≥ 0.70 → keep 2
    const finite: number[] = [];
    for (let i = 0; i < out.length; i++) if (Number.isFinite(out[i])) finite.push(out[i]);
    expect(finite.length).toBe(2);
  });

  it("18 countSurvivors composes temperature+topK+topP correctly", () => {
    const logits = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    // With topK=5, 5 survivors
    expect(countSurvivors(logits, { topK: 5 })).toBe(5);
    // With topK=3 topP=0.5, topK applied first → 3 survivors max
    const n = countSurvivors(logits, { topK: 3, topP: 0.5 });
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThanOrEqual(3);
  });

  it("19 sampleFromLogits is deterministic under a fixed seed", () => {
    const logits = [0.1, 0.2, 0.3, 0.4, 0.5];
    const a = sampleFromLogits(logits, { temperature: 1.5, topK: 3, seed: 42 });
    const b = sampleFromLogits(logits, { temperature: 1.5, topK: 3, seed: 42 });
    expect(a).toBe(b);
  });

  it("20 sampleFromLogits with greedy=true returns argmax regardless of seed", () => {
    const logits = [-1, 3, 0.5, -2, 1];
    const a = sampleFromLogits(logits, { greedy: true, seed: 1 });
    const b = sampleFromLogits(logits, { greedy: true, seed: 2 });
    const c = sampleFromLogits(logits, { greedy: true });
    expect(a).toBe(1);
    expect(b).toBe(1);
    expect(c).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 4. Forward pass (decoder-only, causal)
// ---------------------------------------------------------------------------

describe("GPT-3 forward pass (decoder-only, causal §2.1)", () => {
  const c = gptTinyConfig();
  const w = initGptWeights(c, 7);

  it("21 gptInputEmbeddings shape and finiteness", () => {
    const tokens = [3, 5, 7, 9, 11];
    const emb = gptInputEmbeddings(w, tokens);
    expect(emb.rows).toBe(tokens.length);
    expect(emb.cols).toBe(c.hiddenSize);
    expect(allFinite(emb)).toBe(true);
  });

  it("22 gptForward produces (seqLen, vocabSize) logits", () => {
    const { sequenceOutput, logits } = gptForward(w, [3, 5, 7, 9, 11]);
    expect(sequenceOutput.rows).toBe(5);
    expect(sequenceOutput.cols).toBe(c.hiddenSize);
    expect(logits.rows).toBe(5);
    expect(logits.cols).toBe(c.vocabSize);
    expect(allFinite(logits)).toBe(true);
  });

  it("23 GPT is CAUSAL: appending a future token does NOT change [pos 0]", () => {
    // This is the regression test for decoder-only: unlike BERT, the
    // hidden state at position 0 MUST be independent of later tokens.
    // (In BERT, the bidirectional test asserts the OPPOSITE property.)
    const tokensShort = [3, 5, 7];
    const tokensLong = [3, 5, 7, 9, 11, 13];
    const seqShort = runGptStack(w, tokensShort);
    const seqLong = runGptStack(w, tokensLong);
    for (let j = 0; j < c.hiddenSize; j++) {
      expect(seqLong.data[j]).toBeCloseTo(seqShort.data[j], 12);
    }
    // And position 1 and 2 also match (they only see tokens 0..2 and 0..1 resp.)
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < c.hiddenSize; j++) {
        expect(seqLong.data[i * c.hiddenSize + j]).toBeCloseTo(
          seqShort.data[i * c.hiddenSize + j],
          12,
        );
      }
    }
  });

  it("24 gptNextTokenLogits returns the LAST row of gptLogits", () => {
    const tokens = [3, 5, 7, 9];
    const { logits } = gptForward(w, tokens);
    const last = gptNextTokenLogits(w, tokens);
    const lastRowIdx = logits.rows - 1;
    for (let j = 0; j < c.vocabSize; j++) {
      expect(last[j]).toBeCloseTo(logits.data[lastRowIdx * c.vocabSize + j], 12);
    }
  });

  it("25 rejects sequences longer than contextWindow", () => {
    const tooLong = new Array(c.contextWindow + 1).fill(5);
    expect(() => gptInputEmbeddings(w, tooLong)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// 5. Autoregressive generation
// ---------------------------------------------------------------------------

describe("GPT-3 autoregressive generation", () => {
  const c = gptTinyConfig();
  const w = initGptWeights(c, 11);

  it("26 gptGenerate greedy: deterministic and length = prompt + maxNewTokens", () => {
    const prompt = [3, 5, 7];
    const a = gptGenerate(w, prompt, { maxNewTokens: 5, sampling: { greedy: true } });
    const b = gptGenerate(w, prompt, { maxNewTokens: 5, sampling: { greedy: true } });
    expect(a.tokens).toEqual(b.tokens);
    expect(a.tokens.length).toBe(prompt.length + 5);
    expect(a.generated.length).toBe(5);
    expect(a.steps).toBe(5);
  });

  it("27 gptGenerate with a stop token halts early and sets stopReason", () => {
    // Greedy with a prompt long enough to exercise the loop; we don't
    // know exactly which token greedy will pick, so we "force" a stop
    // by making the target stopToken something the model COULD pick.
    // This test still deterministically verifies the stop-token code
    // path by picking the stopToken from the greedy trajectory.
    const prompt = [3, 5];
    const probe = gptGenerate(w, prompt, {
      maxNewTokens: 10,
      sampling: { greedy: true },
    });
    const stopToken = probe.generated[2]; // something we know greedy emits
    const withStop = gptGenerate(w, prompt, {
      maxNewTokens: 10,
      stopToken,
      sampling: { greedy: true },
    });
    expect(withStop.stopReason).toBe("stop-token");
    // Generated must end with the stopToken
    expect(withStop.generated[withStop.generated.length - 1]).toBe(stopToken);
  });

  it("28 gptGenerate rejects empty prompt and prompt > contextWindow", () => {
    expect(() => gptGenerate(w, [], { maxNewTokens: 3 })).toThrow();
    const tooLong = new Array(c.contextWindow + 1).fill(5);
    expect(() => gptGenerate(w, tooLong, { maxNewTokens: 1 })).toThrow();
  });

  it("29 gptGenerate with temperature+seed is reproducible", () => {
    const prompt = [3, 5, 7];
    const a = gptGenerate(w, prompt, {
      maxNewTokens: 6,
      sampling: { temperature: 1.3, topK: 10, seed: 91 },
    });
    const b = gptGenerate(w, prompt, {
      maxNewTokens: 6,
      sampling: { temperature: 1.3, topK: 10, seed: 91 },
    });
    expect(a.tokens).toEqual(b.tokens);
  });
});

// ---------------------------------------------------------------------------
// 6. In-context learning
// ---------------------------------------------------------------------------

describe("GPT-3 in-context learning (§2, Figure 2.1)", () => {
  it("30 inContextModeOf: 0 → zero-shot, 1 → one-shot, ≥2 → few-shot", () => {
    expect(inContextModeOf(0)).toBe("zero-shot");
    expect(inContextModeOf(1)).toBe("one-shot");
    expect(inContextModeOf(2)).toBe("few-shot");
    expect(inContextModeOf(64)).toBe("few-shot");
  });

  it("31 assertInContextMode throws on mode / example-count mismatch", () => {
    expect(() => assertInContextMode("zero-shot", 3)).toThrow();
    expect(() => assertInContextMode("few-shot", 0)).toThrow();
    // Consistent cases pass silently
    expect(() => assertInContextMode("zero-shot", 0)).not.toThrow();
    expect(() => assertInContextMode("one-shot", 1)).not.toThrow();
    expect(() => assertInContextMode("few-shot", 5)).not.toThrow();
  });

  it("32 buildInContextPrompt renders the canonical Figure 2.1 shape", () => {
    // Simulated tokens: taskDescription=[100], inputOutputSeparator=[200],
    // exampleSeparator=[201], two examples.
    const result = buildInContextPrompt({
      taskDescription: [100],
      taskDescriptionSeparator: [201],
      examples: [
        { input: [1, 2], output: [10] },
        { input: [3], output: [20, 21] },
      ],
      query: [4],
      inputOutputSeparator: [200],
      exampleSeparator: [201],
    });
    // Expected: 100 201   1 2 200 10 201   3 200 20 21 201   4 200
    expect(result.tokenIds).toEqual([
      100, 201,
      1, 2, 200, 10, 201,
      3, 200, 20, 21, 201,
      4, 200,
    ]);
    expect(result.mode).toBe("few-shot");
    expect(result.numExamples).toBe(2);
  });

  it("33 buildInContextPrompt zero-shot omits demonstration block", () => {
    const result = buildInContextPrompt({
      taskDescription: [100],
      examples: [],
      query: [5],
      inputOutputSeparator: [200],
      exampleSeparator: [201],
    });
    expect(result.mode).toBe("zero-shot");
    // taskDescription + query + separator, no demonstrations
    expect(result.tokenIds).toEqual([100, 5, 200]);
  });

  it("34 validateInContextPrompt catches out-of-vocab tokens", () => {
    const spec = {
      taskDescription: [1, 2, 999],
      examples: [],
      query: [3],
      inputOutputSeparator: [4],
      exampleSeparator: [5],
    };
    expect(() => validateInContextPrompt(spec, 48)).toThrow();
  });

  it("35 generate from in-context prompt produces a continuation (end-to-end)", () => {
    const c = gptTinyConfig();
    const w = initGptWeights(c, 17);
    const built = buildInContextPrompt({
      taskDescription: [5],
      examples: [
        { input: [6], output: [7] },
        { input: [8], output: [9] },
      ],
      query: [10],
      inputOutputSeparator: [11],
      exampleSeparator: [12],
    });
    // Validate tokens against the tiny vocab
    validateInContextPrompt({
      taskDescription: [5],
      examples: [{ input: [6], output: [7] }, { input: [8], output: [9] }],
      query: [10],
      inputOutputSeparator: [11],
      exampleSeparator: [12],
    }, c.vocabSize);
    const result = gptGenerate(w, built.tokenIds, {
      maxNewTokens: 3,
      sampling: { greedy: true },
    });
    expect(result.generated.length).toBe(3);
    expect(result.tokens.length).toBe(built.tokenIds.length + 3);
    // Every generated token is a valid vocab id
    for (const t of result.generated) {
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThan(c.vocabSize);
    }
  });
});

// ---------------------------------------------------------------------------
// 7. GPT-3 optimizer + schedule
// ---------------------------------------------------------------------------

describe("GPT-3 optimizer + cosine schedule (§C)", () => {
  it("36 GPT3_ADAM has β2=0.95 — distinct from Vaswani (0.98) and BERT (0.999)", () => {
    expect(GPT3_ADAM.beta1).toBe(0.9);
    expect(GPT3_ADAM.beta2).toBe(0.95);
    expect(GPT3_ADAM.epsilon).toBe(1e-8);
    // All three papers must have different β2 — this lock is important
    // to prevent someone accidentally replacing the GPT3 value.
    expect(GPT3_ADAM.beta2).not.toBe(PAPER_ADAM.beta2);
    expect(GPT3_ADAM.beta2).not.toBe(BERT_ADAM.beta2);
  });

  it("37 GPT3_WEIGHT_DECAY is 0.1 (10× BERT's 0.01)", () => {
    expect(GPT3_WEIGHT_DECAY).toBe(0.1);
  });

  it("38 gpt3CosineSchedule: linear warmup 0 → peakLR", () => {
    const cfg = { peakLR: 6e-4, warmupSteps: 1000, totalSteps: 10000 };
    expect(gpt3CosineSchedule(0, cfg)).toBe(0);
    expect(gpt3CosineSchedule(500, cfg)).toBeCloseTo(3e-4, 12);
    expect(gpt3CosineSchedule(1000, cfg)).toBeCloseTo(6e-4, 12);
  });

  it("39 gpt3CosineSchedule: cosine decay peakLR → minLR over the decay phase", () => {
    const cfg = {
      peakLR: 6e-4,
      warmupSteps: 1000,
      totalSteps: 11000,
      minLRFraction: 0.1,
    };
    // At step=totalSteps, lr = minLR = 10% of peak
    expect(gpt3CosineSchedule(11000, cfg)).toBeCloseTo(0.6e-4, 12);
    // Halfway through decay (step=6000, halfway from 1000 to 11000),
    // cosine = 0.5·(1+cos(π/2)) = 0.5·(1+0) = 0.5 →
    // lr = minLR + 0.5·(peak - minLR) = 0.6e-4 + 0.5·5.4e-4 = 3.3e-4
    expect(gpt3CosineSchedule(6000, cfg)).toBeCloseTo(3.3e-4, 10);
    // Past totalSteps → clamp to minLR
    expect(gpt3CosineSchedule(20000, cfg)).toBeCloseTo(0.6e-4, 12);
  });

  it("40 gpt3CosineSchedule rejects invalid configs", () => {
    expect(() =>
      gpt3CosineSchedule(1, { peakLR: 0, warmupSteps: 10, totalSteps: 100 }),
    ).toThrow();
    expect(() =>
      gpt3CosineSchedule(1, { peakLR: 1e-4, warmupSteps: 0, totalSteps: 100 }),
    ).toThrow();
    expect(() =>
      gpt3CosineSchedule(1, { peakLR: 1e-4, warmupSteps: 100, totalSteps: 50 }),
    ).toThrow();
    expect(() =>
      gpt3CosineSchedule(1, {
        peakLR: 1e-4,
        warmupSteps: 10,
        totalSteps: 100,
        minLRFraction: 1.5,
      }),
    ).toThrow();
  });
});

// Silence unused import warnings
void fromArray;
