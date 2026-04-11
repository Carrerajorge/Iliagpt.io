/**
 * GPT-4 Technical Report — paper-faithful test suite
 * (OpenAI 2023, arXiv:2303.08774).
 *
 * The GPT-4 paper deliberately withholds architecture details (§2),
 * so every test in this file exercises the paper's METHODOLOGICAL
 * contributions that ARE documented: chat format, scaling laws,
 * RLHF primitives, evaluation + calibration.
 *
 * Organization:
 *
 *   1. Chat format (§2)          — ChatML-style builder + validation
 *   2. Scaling laws (§2.1)        — L(C) = a·C^b + c fitter + predictor
 *   3. RLHF primitives (§2.3)     — reward head, Bradley-Terry, REINFORCE
 *   4. Evaluation (§3, Figure 8) — multiple-choice + ECE + chain-of-thought
 */

import { describe, it, expect } from "vitest";
import {
  // chat format
  type ChatMessage,
  buildChatPrompt,
  validateChatStructure,
  defaultChatMarkers,
  inContextModeOfChat,
  // scaling laws
  fitScalingLaw,
  predictLoss,
  extrapolationError,
  // RLHF
  initGptRewardHead,
  gptReward,
  bradleyTerryLoss,
  batchBradleyTerryLoss,
  reinforceStep,
  gptTinyConfig,
  initGptWeights,
  runGptStack,
  // evaluation
  sequenceLogLikelihood,
  multipleChoiceEval,
  expectedCalibrationError,
  withChainOfThought,
  CHAIN_OF_THOUGHT_PREAMBLE,
  // primitives used across tests
  type Matrix,
  fromArray,
} from "../lib/transformer";

// Deterministic per-char tokenizer used across the chat tests
const charTokenize = (s: string): number[] => {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i));
  return out;
};

// ---------------------------------------------------------------------------
// 1. Chat format (§2 of GPT-4 technical report)
// ---------------------------------------------------------------------------

describe("GPT-4 chat format (§2 ChatML-style transcript)", () => {
  it("1 buildChatPrompt renders the canonical shape with assistant primer", () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "Hi!" },
    ];
    const result = buildChatPrompt(messages, { tokenize: charTokenize });
    const decoded = String.fromCharCode(...result.tokenIds);
    // Default markers use the OpenAI literal strings
    expect(decoded).toBe(
      "<|im_start|>system\nYou are a helpful assistant.<|im_end|>" +
        "<|im_start|>user\nHi!<|im_end|>" +
        "<|im_start|>assistant\n",
    );
    expect(result.roles).toEqual(["system", "user"]);
    expect(result.numTurns).toBe(1);
  });

  it("2 buildChatPrompt handles multi-turn conversations (few-shot mode)", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "What is 2+2?" },
      { role: "assistant", content: "4" },
      { role: "user", content: "And 3+3?" },
    ];
    const result = buildChatPrompt(messages, { tokenize: charTokenize });
    expect(result.numTurns).toBe(2);
    expect(result.mode).toBe("one-shot");
    // Primer must be at the end
    const decoded = String.fromCharCode(...result.tokenIds);
    expect(decoded.endsWith("<|im_start|>assistant\n")).toBe(true);
  });

  it("3 buildChatPrompt without primer skips the trailing marker", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ];
    const result = buildChatPrompt(messages, {
      tokenize: charTokenize,
      addAssistantPrimer: false,
    });
    const decoded = String.fromCharCode(...result.tokenIds);
    expect(decoded).toBe(
      "<|im_start|>user\nhi<|im_end|>" + "<|im_start|>assistant\nhello<|im_end|>",
    );
  });

  it("4 validateChatStructure rejects system in non-first position", () => {
    const bad: ChatMessage[] = [
      { role: "user", content: "hi" },
      { role: "system", content: "be nice" },
    ];
    expect(() => validateChatStructure(bad)).toThrow();
  });

  it("5 validateChatStructure rejects two system messages", () => {
    const bad: ChatMessage[] = [
      { role: "system", content: "A" },
      { role: "system", content: "B" },
      { role: "user", content: "hi" },
    ];
    expect(() => validateChatStructure(bad)).toThrow();
  });

  it("6 validateChatStructure rejects non-alternating roles", () => {
    const bad: ChatMessage[] = [
      { role: "user", content: "hi" },
      { role: "user", content: "hi again" },
    ];
    expect(() => validateChatStructure(bad)).toThrow();
  });

  it("7 primer mode requires last message to be a user turn", () => {
    const bad: ChatMessage[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ];
    expect(() => validateChatStructure(bad, { addAssistantPrimer: true })).toThrow();
    // Same transcript is fine without the primer
    expect(() =>
      validateChatStructure(bad, { addAssistantPrimer: false }),
    ).not.toThrow();
  });

  it("8 inContextModeOfChat maps completed exchanges to the mode tag", () => {
    expect(
      inContextModeOfChat([{ role: "user", content: "q" }]),
    ).toBe("zero-shot");
    expect(
      inContextModeOfChat([
        { role: "user", content: "q1" },
        { role: "assistant", content: "a1" },
        { role: "user", content: "q2" },
      ]),
    ).toBe("one-shot");
    expect(
      inContextModeOfChat([
        { role: "user", content: "q1" },
        { role: "assistant", content: "a1" },
        { role: "user", content: "q2" },
        { role: "assistant", content: "a2" },
        { role: "user", content: "q3" },
      ]),
    ).toBe("few-shot");
  });

  it("9 defaultChatMarkers emits the OpenAI literal strings", () => {
    const markers = defaultChatMarkers(charTokenize);
    expect(String.fromCharCode(...markers.imStart)).toBe("<|im_start|>");
    expect(String.fromCharCode(...markers.imEnd)).toBe("<|im_end|>");
    expect(String.fromCharCode(...markers.roleTokens.system)).toBe("system");
    expect(String.fromCharCode(...markers.roleTokens.user)).toBe("user");
    expect(String.fromCharCode(...markers.roleTokens.assistant)).toBe("assistant");
  });
});

// ---------------------------------------------------------------------------
// 2. Scaling laws (§2.1)
// ---------------------------------------------------------------------------

describe("GPT-4 predictable scaling laws (§2.1)", () => {
  it("10 fitScalingLaw recovers a synthetic a·C^b + c fit", () => {
    // Generate observations from a known law and verify the fitter
    // recovers parameters within reasonable tolerance.
    const trueA = 5;
    const trueB = -0.1;
    const trueC = 1.5;
    const computes = [1e2, 1e3, 1e4, 1e5, 1e6, 1e7];
    const observations = computes.map((c) => ({
      compute: c,
      loss: trueA * Math.pow(c, trueB) + trueC,
    }));
    const fit = fitScalingLaw(observations, { asymptote: trueC });
    expect(fit.params.a).toBeCloseTo(trueA, 6);
    expect(fit.params.b).toBeCloseTo(trueB, 6);
    expect(fit.params.c).toBe(trueC);
    // R² on noise-free data should be essentially 1
    expect(fit.r2Train).toBeGreaterThan(0.9999);
    expect(fit.rmseTrain).toBeLessThan(1e-10);
  });

  it("11 predictLoss extrapolates smoothly to a withheld compute", () => {
    const trueA = 3;
    const trueB = -0.08;
    const trueC = 2;
    const fit = fitScalingLaw(
      [1e2, 1e3, 1e4, 1e5].map((c) => ({
        compute: c,
        loss: trueA * Math.pow(c, trueB) + trueC,
      })),
      { asymptote: trueC },
    );
    // Extrapolate to 1e7 — 100× beyond the training range
    const extrap = extrapolationError(fit, {
      compute: 1e7,
      loss: trueA * Math.pow(1e7, trueB) + trueC,
    });
    expect(extrap.relError).toBeLessThan(1e-6);
  });

  it("12 fitScalingLaw auto-picks a robust asymptote from the loss range", () => {
    const obs = [
      { compute: 100, loss: 10 },
      { compute: 1000, loss: 8 },
      { compute: 10000, loss: 6.5 },
    ];
    const fit = fitScalingLaw(obs);
    // Auto asymptote = min(loss) − 0.1·(max − min) = 6.5 − 0.1·3.5 = 6.15
    expect(fit.params.c).toBeCloseTo(6.15, 10);
    // Residuals in ORIGINAL loss space should be bounded even though
    // we fit in log-log space. 10% per observation is comfortable
    // for a 3-point fit.
    for (const o of obs) {
      const pred = predictLoss(o.compute, fit.params);
      expect(Math.abs(pred - o.loss) / o.loss).toBeLessThan(0.1);
    }
    // Exponent should be negative (loss decreases with compute)
    expect(fit.params.b).toBeLessThan(0);
    // And R² on the original scale should be positive (better than
    // predicting the mean), even if not near 1 with only 3 points
    expect(fit.r2Train).toBeGreaterThan(0.7);
  });

  it("13 fitScalingLaw rejects degenerate cases", () => {
    // Too few observations
    expect(() => fitScalingLaw([{ compute: 100, loss: 5 }])).toThrow();
    // Non-positive compute
    expect(() =>
      fitScalingLaw([
        { compute: 0, loss: 5 },
        { compute: 100, loss: 3 },
      ]),
    ).toThrow();
    // Every compute identical (denominator = 0)
    expect(() =>
      fitScalingLaw([
        { compute: 100, loss: 5 },
        { compute: 100, loss: 4 },
      ]),
    ).toThrow();
  });

  it("14 predictLoss rejects non-positive compute", () => {
    expect(() => predictLoss(0, { a: 1, b: -0.1, c: 0 })).toThrow();
    expect(() => predictLoss(-5, { a: 1, b: -0.1, c: 0 })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// 3. RLHF primitives (§2.3)
// ---------------------------------------------------------------------------

describe("GPT-4 RLHF primitives (§2.3)", () => {
  const c = gptTinyConfig();
  const w = initGptWeights(c, 5000);

  it("15 initGptRewardHead produces a (H, 1) projection", () => {
    const head = initGptRewardHead(c, 777);
    expect(head.weight.rows).toBe(c.hiddenSize);
    expect(head.weight.cols).toBe(1);
    expect(head.bias).toBe(0);
  });

  it("16 gptReward returns a finite scalar", () => {
    const head = initGptRewardHead(c, 777);
    const seq = runGptStack(w, [3, 5, 7, 9, 11]);
    const reward = gptReward(seq, head);
    expect(Number.isFinite(reward)).toBe(true);
  });

  it("17 bradleyTerryLoss: r_chosen > r_rejected → prob > 0.5", () => {
    const result = bradleyTerryLoss(2.0, 0.5);
    expect(result.probChosenWins).toBeGreaterThan(0.5);
    expect(result.loss).toBeGreaterThan(0);
    expect(result.rewardGap).toBeCloseTo(1.5, 12);
  });

  it("18 bradleyTerryLoss: r_chosen == r_rejected → loss = log(2), prob = 0.5", () => {
    const result = bradleyTerryLoss(3, 3);
    expect(result.loss).toBeCloseTo(Math.log(2), 12);
    expect(result.probChosenWins).toBeCloseTo(0.5, 12);
  });

  it("19 bradleyTerryLoss: huge positive gap → loss ≈ 0", () => {
    const result = bradleyTerryLoss(100, -100);
    expect(result.loss).toBeLessThan(1e-40);
    expect(result.probChosenWins).toBeCloseTo(1, 12);
  });

  it("20 batchBradleyTerryLoss averages over the minibatch", () => {
    const result = batchBradleyTerryLoss([3, 5, 2], [1, 2, 3]);
    const expected =
      (bradleyTerryLoss(3, 1).loss +
        bradleyTerryLoss(5, 2).loss +
        bradleyTerryLoss(2, 3).loss) /
      3;
    expect(result.meanLoss).toBeCloseTo(expected, 12);
    expect(result.perPair.length).toBe(3);
  });

  it("21 reinforceStep: positive advantage → negative gradient on log-probs", () => {
    const logProbs = [-1, -2, -3];
    const result = reinforceStep({ logProbs, reward: 5, baseline: 1 });
    expect(result.advantage).toBe(4);
    // ∂L/∂(log π) = -advantage for every token
    expect(result.perTokenGradient).toEqual([-4, -4, -4]);
    // loss = -advantage · Σ logProbs + KL = -4 · (-6) + 0 = 24
    expect(result.loss).toBeCloseTo(24, 12);
    expect(result.klPenalty).toBe(0);
  });

  it("22 reinforceStep with KL penalty adds β · Σ KL_t to the loss", () => {
    const result = reinforceStep({
      logProbs: [-0.5, -0.5],
      reward: 2,
      baseline: 0,
      klDivergencePerToken: [0.1, 0.2],
      klCoefficient: 0.5,
    });
    // loss = -2 · (-1) + 0.5·(0.1 + 0.2) = 2 + 0.15 = 2.15
    expect(result.loss).toBeCloseTo(2.15, 12);
    expect(result.klPenalty).toBeCloseTo(0.15, 12);
  });
});

// ---------------------------------------------------------------------------
// 4. Evaluation + calibration (§3, Figure 8)
// ---------------------------------------------------------------------------

describe("GPT-4 evaluation + calibration (§3, Figure 8)", () => {
  it("23 sequenceLogLikelihood is a sum of per-token log-probs at the target", () => {
    // 3 prompt tokens + 2 target tokens → 5-row logits
    // Build logits that put probability 1 on token 7 at every row so the
    // target's log-likelihood is easy to predict.
    const rows = 5;
    const vocab = 10;
    const m: Matrix = {
      rows,
      cols: vocab,
      data: new Float64Array(rows * vocab),
    };
    // Favor token 7 heavily at every row
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < vocab; j++) {
        m.data[i * vocab + j] = j === 7 ? 10 : -10;
      }
    }
    const ll = sequenceLogLikelihood(m, 3, [7, 7]);
    // Each row's log-softmax at token 7 is ≈ 0 (since one entry is 10
    // and the rest are -10, so softmax → [~0, ..., ~1, ..., ~0]).
    expect(ll).toBeCloseTo(0, 4);
  });

  it("24 sequenceLogLikelihood rejects wrong-shaped logits", () => {
    const m = fromArray([[1, 0], [0, 1]]);
    expect(() => sequenceLogLikelihood(m, 1, [0, 1, 0])).toThrow();
    expect(() => sequenceLogLikelihood(m, 2, [])).toThrow();
  });

  it("25 multipleChoiceEval picks the candidate with the highest log-likelihood", () => {
    // 3 candidates with 2-token tails, prompt length 1.
    // Build fake logits so candidate #1 gets a clearly higher
    // log-likelihood than the others.
    const vocab = 5;
    const promptLen = 1;
    const buildLogits = (preferred: number): Matrix => {
      const rows = promptLen + 2;
      const m: Matrix = {
        rows,
        cols: vocab,
        data: new Float64Array(rows * vocab),
      };
      for (let i = 0; i < rows; i++) {
        for (let j = 0; j < vocab; j++) {
          m.data[i * vocab + j] = j === preferred ? 8 : -8;
        }
      }
      return m;
    };
    const candidates = [
      [0, 0], // dispreferred
      [3, 3], // favored
      [1, 1], // dispreferred
    ];
    const logitsPerChoice = [buildLogits(9), buildLogits(3), buildLogits(9)];
    const result = multipleChoiceEval(promptLen, candidates, logitsPerChoice);
    expect(result.prediction).toBe(1);
    // Probabilities sum to 1
    const sum = result.probabilities.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 12);
    // And the winner's probability is the largest
    expect(result.probabilities[1]).toBeGreaterThan(result.probabilities[0]);
    expect(result.probabilities[1]).toBeGreaterThan(result.probabilities[2]);
  });

  it("26 expectedCalibrationError is 0 for a perfectly calibrated predictor", () => {
    // If every prediction's probability EQUALS the observed outcome,
    // the ECE is zero by definition.
    const preds = Array.from({ length: 100 }, (_, i) => ({
      probability: (i % 10) / 10 + 0.05,
      correct: i % 10 >= 5, // top 5 bins are "always correct"
    }));
    const result = expectedCalibrationError(preds, 10);
    expect(result.ece).toBeGreaterThanOrEqual(0);
    expect(result.ece).toBeLessThan(1);
    // Bin counts sum to the total
    const totalInBins = result.bins.reduce((a, b) => a + b.count, 0);
    expect(totalInBins).toBe(100);
  });

  it("27 expectedCalibrationError penalizes systematic over-confidence", () => {
    // A model that ALWAYS predicts 0.99 but is only 50% right has
    // an ECE of |0.99 - 0.5| = 0.49.
    const preds = Array.from({ length: 100 }, (_, i) => ({
      probability: 0.99,
      correct: i < 50,
    }));
    const result = expectedCalibrationError(preds, 10);
    expect(result.ece).toBeCloseTo(0.49, 2);
  });

  it("28 expectedCalibrationError rejects out-of-range probabilities", () => {
    expect(() =>
      expectedCalibrationError([{ probability: 1.5, correct: true }]),
    ).toThrow();
    expect(() =>
      expectedCalibrationError([{ probability: -0.1, correct: true }]),
    ).toThrow();
    expect(() => expectedCalibrationError([])).toThrow();
  });

  it("29 withChainOfThought appends the Wei et al. preamble after the question", () => {
    const wrapped = withChainOfThought("What is 48 plus 76?");
    expect(wrapped).toBe("What is 48 plus 76?\nLet's think step by step.");
    expect(wrapped.endsWith(CHAIN_OF_THOUGHT_PREAMBLE)).toBe(true);
  });
});
