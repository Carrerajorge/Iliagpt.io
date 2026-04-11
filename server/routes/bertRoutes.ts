/**
 * REST surface for the in-house BERT implementation.
 *
 * Exposes Devlin et al. 2018 via a small set of endpoints under
 * `/api/bert`. Every endpoint builds a fresh, seeded tiny model
 * deterministically so requests are reproducible and bounded in cost —
 * running a 110M-parameter base model in-process per request is
 * obviously not a serious production plan, but for CI, demos, and
 * REST-level sanity this is exactly what's needed.
 *
 * Endpoints:
 *
 *   POST /encode        — run bertForward, return sequenceOutput + pooled
 *   POST /pool          — alias returning only the pooled [CLS] vector
 *   POST /masked-lm     — run MLM head, return top-k predictions at masked
 *                          positions and (optionally) the loss against gold
 *                          tokens
 *   POST /mask-batch    — apply the 80/10/10 BERT masking rule to a given
 *                          token sequence, useful for UI / training tools
 *   POST /nsp           — binary Next-Sentence classifier probabilities
 *   GET  /configs       — list BASE / LARGE / TINY preset summaries
 */

import express, { type Request, type Response, Router } from "express";
import { z } from "zod";
import {
  toArray,
  type Matrix,
  // BERT
  BERT_SPECIAL_TOKENS,
  bertTinyConfig,
  bertPreset,
  allBertPresets,
  estimateBertParams,
  initBertWeights,
  bertForward,
  bertForwardWithLayers,
  bertMLMLogits,
  maskedLMLoss,
  bertMLMTopK,
  bertNSPProbabilities,
  applyMaskingProcedure,
  defaultMaskingConfig,
  // Schedule
  bertLinearSchedule,
  // Fine-tuning heads
  initBertClassificationHead,
  bertClassificationLogits,
  bertClassificationLoss,
  initBertSpanHead,
  bertSpanLogits,
  bertSpanLoss,
  bertSpanLossV2,
  bertSpanPredictV2,
  initBertTokenTaggingHead,
  bertTokenTaggingLogits,
  bertTokenTaggingLoss,
  initBertMultipleChoiceHead,
  bertMultipleChoiceScores,
  bertMultipleChoiceLoss,
  // §5.3 layer combination helpers
  concatLastKLayers,
  concatLastFourHidden,
  sumLastKLayers,
  weightedSumLayers,
  secondToLastHidden,
  // Hyperparameter constants
  BERT_PRE_TRAINING_HYPERS,
  BERT_FINE_TUNING_HYPERS,
  bertFineTuningGrid,
  // Pre-training
  bertPreTrainingLoss,
  NSP_IS_NEXT,
  NSP_NOT_NEXT,
} from "../lib/transformer";

// ── Request schemas ───────────────────────────────────────────────────────

/**
 * "Model params" choose which preset and seed to materialize. We cap at
 * BERT_TINY for any per-request endpoint because materializing BERT_BASE
 * on every call would OOM the server and take multiple seconds.
 */
const modelParamsSchema = z.object({
  preset: z.enum(["bert-tiny"]).default("bert-tiny"),
  seed: z.number().int().default(42),
});

const tokenIdsSchema = z.array(z.number().int().nonnegative()).min(1).max(128);
const segmentIdsSchema = z.array(z.number().int().min(0).max(1)).optional();

const encodeRequestSchema = z.object({
  tokenIds: tokenIdsSchema,
  segmentIds: segmentIdsSchema,
  model: modelParamsSchema.optional(),
});

const poolRequestSchema = encodeRequestSchema;

const maskedLMRequestSchema = z.object({
  tokenIds: tokenIdsSchema,
  segmentIds: segmentIdsSchema,
  /** Positions in the sequence where predictions should be scored. */
  maskedPositions: z.array(z.number().int().nonnegative()).min(1).max(32),
  /** Original (gold) tokens at those positions, in the same order. Optional;
   *  if omitted we only return the top-k predictions without a loss. */
  originalTokens: z.array(z.number().int().nonnegative()).max(32).optional(),
  /** Number of top predictions to return per masked position. */
  topK: z.number().int().min(1).max(20).default(5),
  model: modelParamsSchema.optional(),
});

const maskBatchRequestSchema = z.object({
  tokenIds: tokenIdsSchema,
  vocabSize: z.number().int().min(6).max(10_000).default(48),
  seed: z.number().int().default(1),
  /** Override the 4 probabilities (defaults to 0.15 / 0.8 / 0.1 / 0.1). */
  maskProbability: z.number().min(0).max(1).optional(),
  replaceWithMaskProbability: z.number().min(0).max(1).optional(),
  replaceWithRandomProbability: z.number().min(0).max(1).optional(),
  keepOriginalProbability: z.number().min(0).max(1).optional(),
});

const nspRequestSchema = z.object({
  tokenIds: tokenIdsSchema,
  segmentIds: segmentIdsSchema,
  model: modelParamsSchema.optional(),
});

// ── Audit-fix endpoints ───────────────────────────────────────────────────

const scheduleRequestSchema = z.object({
  step: z.number().int().min(0).max(1_000_000),
  peakLR: z.number().positive().default(1e-4),
  warmupSteps: z.number().int().min(1).max(100_000).default(10_000),
  totalSteps: z.number().int().min(2).max(2_000_000).default(1_000_000),
  curve: z.boolean().optional(),
});

const hiddenStatesRequestSchema = z.object({
  tokenIds: tokenIdsSchema,
  segmentIds: segmentIdsSchema,
  /** Which hidden states to return. Defaults to all layers (embeddings + L). */
  layers: z.array(z.number().int().nonnegative()).max(32).optional(),
  model: modelParamsSchema.optional(),
});

const classifyRequestSchema = z.object({
  tokenIds: tokenIdsSchema,
  segmentIds: segmentIdsSchema,
  numLabels: z.number().int().min(2).max(100).default(3),
  label: z.number().int().nonnegative().optional(),
  headSeed: z.number().int().default(200),
  model: modelParamsSchema.optional(),
});

const spanRequestSchema = z.object({
  tokenIds: tokenIdsSchema,
  segmentIds: segmentIdsSchema,
  goldStart: z.number().int().nonnegative().optional(),
  goldEnd: z.number().int().nonnegative().optional(),
  headSeed: z.number().int().default(300),
  model: modelParamsSchema.optional(),
});

const tagRequestSchema = z.object({
  tokenIds: tokenIdsSchema,
  segmentIds: segmentIdsSchema,
  numLabels: z.number().int().min(2).max(100).default(5),
  /** Gold labels per token; use -100 (or any negative) to ignore a position. */
  labels: z.array(z.number().int()).optional(),
  headSeed: z.number().int().default(400),
  model: modelParamsSchema.optional(),
});

const pretrainLossRequestSchema = z.object({
  tokenIds: tokenIdsSchema,
  segmentIds: z.array(z.number().int().min(0).max(1)).min(1),
  maskedPositions: z.array(z.number().int().nonnegative()).min(1).max(32),
  originalTokens: z.array(z.number().int().nonnegative()).min(1).max(32),
  nspLabel: z.number().int().min(0).max(1).default(NSP_IS_NEXT),
  model: modelParamsSchema.optional(),
});

// Third-pass audit schemas

const spanV2RequestSchema = z.object({
  tokenIds: tokenIdsSchema,
  segmentIds: segmentIdsSchema,
  /** Gold span; pass (0, 0) to train on a "no answer" example. */
  goldStart: z.number().int().nonnegative().optional(),
  goldEnd: z.number().int().nonnegative().optional(),
  /** Decision threshold τ. Default 0 (pure score comparison). */
  tau: z.number().default(0),
  headSeed: z.number().int().default(301),
  model: modelParamsSchema.optional(),
});

const multipleChoiceRequestSchema = z.object({
  /** K candidate sequences, each an array of token ids. */
  candidates: z.array(tokenIdsSchema).min(2).max(8),
  /** K arrays of segment ids; must match the length of each candidate. */
  segmentIdsPerCandidate: z.array(segmentIdsSchema).optional(),
  /** Gold choice index in [0, K). Optional — if omitted, only scores are returned. */
  goldIndex: z.number().int().nonnegative().optional(),
  headSeed: z.number().int().default(501),
  model: modelParamsSchema.optional(),
});

const layerCombineRequestSchema = z.object({
  tokenIds: tokenIdsSchema,
  segmentIds: segmentIdsSchema,
  /** Combination strategy. `concat-last-k` takes a `k`; `weighted-sum` takes `weights`. */
  strategy: z.enum([
    "concat-last-k",
    "concat-last-4",
    "sum-last-k",
    "weighted-sum",
    "second-to-last",
    "last",
  ]),
  k: z.number().int().min(1).max(24).optional(),
  weights: z.array(z.number()).optional(),
  model: modelParamsSchema.optional(),
});

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Build a tiny BERT model. The tiny preset finishes every endpoint in
 * a few milliseconds; larger presets are only exposed via GET /configs
 * (for inspection) and never materialized.
 */
function buildTinyBert(seed: number) {
  const config = bertTinyConfig();
  const weights = initBertWeights(config, seed);
  return { config, weights };
}

function validateVocab(
  tokenIds: number[],
  vocabSize: number,
  label: string,
): string | null {
  for (let i = 0; i < tokenIds.length; i++) {
    if (tokenIds[i] >= vocabSize) {
      return `${label}[${i}] = ${tokenIds[i]} exceeds vocabSize ${vocabSize}`;
    }
  }
  return null;
}

// ── Router ────────────────────────────────────────────────────────────────

export function createBertRouter(): Router {
  const router: Router = express.Router();
  router.use(express.json({ limit: "2mb" }));

  // ── POST /encode ──────────────────────────────────────────────────────
  router.post("/encode", (req: Request, res: Response) => {
    const parsed = encodeRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_request", issues: parsed.error.issues });
    }
    const { tokenIds, segmentIds } = parsed.data;
    const seed = parsed.data.model?.seed ?? 42;
    try {
      const { config, weights } = buildTinyBert(seed);
      const err = validateVocab(tokenIds, config.vocabSize, "tokenIds");
      if (err) return res.status(400).json({ error: "invalid_tokens", message: err });
      const { sequenceOutput, pooledOutput } = bertForward(weights, tokenIds, segmentIds);
      return res.json({
        sequenceOutput: toArray(sequenceOutput),
        pooledOutput: toArray(pooledOutput)[0],
        shape: {
          sequenceOutput: [sequenceOutput.rows, sequenceOutput.cols],
          pooledOutput: [pooledOutput.rows, pooledOutput.cols],
        },
        model: {
          preset: "bert-tiny",
          seed,
          hiddenSize: config.hiddenSize,
          numLayers: config.numLayers,
          numHeads: config.numHeads,
        },
        algorithm: "bidirectional Transformer encoder + tanh pooler (Devlin et al. 2018)",
      });
    } catch (caught) {
      return res.status(400).json({
        error: "encode_failed",
        message: caught instanceof Error ? caught.message : String(caught),
      });
    }
  });

  // ── POST /pool ────────────────────────────────────────────────────────
  //
  // Convenience wrapper returning only the pooled [CLS] vector. Handy
  // for downstream classification / reranking without paying for the
  // full sequence output over the wire.
  router.post("/pool", (req: Request, res: Response) => {
    const parsed = poolRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_request", issues: parsed.error.issues });
    }
    const { tokenIds, segmentIds } = parsed.data;
    const seed = parsed.data.model?.seed ?? 42;
    try {
      const { config, weights } = buildTinyBert(seed);
      const err = validateVocab(tokenIds, config.vocabSize, "tokenIds");
      if (err) return res.status(400).json({ error: "invalid_tokens", message: err });
      const { pooledOutput } = bertForward(weights, tokenIds, segmentIds);
      return res.json({
        pooled: toArray(pooledOutput)[0],
        hiddenSize: config.hiddenSize,
      });
    } catch (caught) {
      return res.status(400).json({
        error: "pool_failed",
        message: caught instanceof Error ? caught.message : String(caught),
      });
    }
  });

  // ── POST /masked-lm ───────────────────────────────────────────────────
  router.post("/masked-lm", (req: Request, res: Response) => {
    const parsed = maskedLMRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_request", issues: parsed.error.issues });
    }
    const { tokenIds, segmentIds, maskedPositions, originalTokens, topK } = parsed.data;
    const seed = parsed.data.model?.seed ?? 42;
    try {
      const { config, weights } = buildTinyBert(seed);
      const err = validateVocab(tokenIds, config.vocabSize, "tokenIds");
      if (err) return res.status(400).json({ error: "invalid_tokens", message: err });
      for (const p of maskedPositions) {
        if (p >= tokenIds.length) {
          return res.status(400).json({
            error: "invalid_position",
            message: `maskedPositions contains ${p} which is ≥ sequence length ${tokenIds.length}`,
          });
        }
      }
      const { sequenceOutput } = bertForward(weights, tokenIds, segmentIds);
      const logits = bertMLMLogits(sequenceOutput, weights);
      const predictions = bertMLMTopK(logits, maskedPositions, topK);

      let lossResult: { loss: number; tokenCount: number; perPosition: number[] } | null = null;
      if (originalTokens) {
        if (originalTokens.length !== maskedPositions.length) {
          return res.status(400).json({
            error: "shape_mismatch",
            message: `originalTokens length ${originalTokens.length} != maskedPositions length ${maskedPositions.length}`,
          });
        }
        const loss = maskedLMLoss(logits, maskedPositions, originalTokens);
        lossResult = {
          loss: loss.loss,
          tokenCount: loss.tokenCount,
          perPosition: loss.perPosition,
        };
      }

      return res.json({
        predictions: maskedPositions.map((pos, i) => ({
          position: pos,
          topK: predictions[i],
        })),
        loss: lossResult,
        model: { preset: "bert-tiny", seed, hiddenSize: config.hiddenSize },
        algorithm: "Masked LM head: Dense → GELU → LayerNorm → tied vocab projection",
      });
    } catch (caught) {
      return res.status(400).json({
        error: "masked_lm_failed",
        message: caught instanceof Error ? caught.message : String(caught),
      });
    }
  });

  // ── POST /mask-batch ──────────────────────────────────────────────────
  //
  // Apply the BERT 80/10/10 rule to a raw token sequence. Useful for
  // visualizing what a training batch would look like and for the test
  // suite to verify the statistical properties externally.
  router.post("/mask-batch", (req: Request, res: Response) => {
    const parsed = maskBatchRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_request", issues: parsed.error.issues });
    }
    const { tokenIds, vocabSize, seed, ...overrides } = parsed.data;
    try {
      const cfg = { ...defaultMaskingConfig(vocabSize, seed), ...cleanOverrides(overrides) };
      const out = applyMaskingProcedure(tokenIds, cfg);
      return res.json({
        maskedInputIds: out.maskedInputIds,
        maskedPositions: out.maskedPositions,
        originalTokens: out.originalTokens,
        actions: out.actions,
        specials: BERT_SPECIAL_TOKENS,
        config: {
          vocabSize,
          seed,
          maskProbability: cfg.maskProbability,
          replaceWithMaskProbability: cfg.replaceWithMaskProbability,
          replaceWithRandomProbability: cfg.replaceWithRandomProbability,
          keepOriginalProbability: cfg.keepOriginalProbability,
        },
      });
    } catch (caught) {
      return res.status(400).json({
        error: "mask_batch_failed",
        message: caught instanceof Error ? caught.message : String(caught),
      });
    }
  });

  // ── POST /nsp ─────────────────────────────────────────────────────────
  router.post("/nsp", (req: Request, res: Response) => {
    const parsed = nspRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_request", issues: parsed.error.issues });
    }
    const { tokenIds, segmentIds } = parsed.data;
    const seed = parsed.data.model?.seed ?? 42;
    try {
      const { config, weights } = buildTinyBert(seed);
      const err = validateVocab(tokenIds, config.vocabSize, "tokenIds");
      if (err) return res.status(400).json({ error: "invalid_tokens", message: err });
      const { pooledOutput } = bertForward(weights, tokenIds, segmentIds);
      const probs = bertNSPProbabilities(pooledOutput, weights.nspHead);
      return res.json({
        isNext: probs.isNext,
        notNext: probs.notNext,
        prediction: probs.isNext >= probs.notNext ? "isNext" : "notNext",
        model: { preset: "bert-tiny", seed, hiddenSize: config.hiddenSize },
      });
    } catch (caught) {
      return res.status(400).json({
        error: "nsp_failed",
        message: caught instanceof Error ? caught.message : String(caught),
      });
    }
  });

  // ── POST /schedule ────────────────────────────────────────────────────
  //
  // BERT's linear warmup + linear decay LR schedule (§A.2). Returns the
  // learning rate at a given step, plus optionally the full [0..step]
  // curve for plotting.
  router.post("/schedule", (req: Request, res: Response) => {
    const parsed = scheduleRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_request", issues: parsed.error.issues });
    }
    const { step, peakLR, warmupSteps, totalSteps, curve } = parsed.data;
    try {
      const lr = bertLinearSchedule(step, { peakLR, warmupSteps, totalSteps });
      let curveData: number[] | undefined;
      if (curve) {
        curveData = new Array(step + 1);
        for (let s = 0; s <= step; s++) {
          curveData[s] = bertLinearSchedule(s, { peakLR, warmupSteps, totalSteps });
        }
      }
      return res.json({
        step,
        learningRate: lr,
        peakLR,
        warmupSteps,
        totalSteps,
        curve: curveData,
        formula:
          "warmup: peakLR · step / warmup;  decay: peakLR · (total - step) / (total - warmup)",
      });
    } catch (caught) {
      return res.status(400).json({
        error: "schedule_failed",
        message: caught instanceof Error ? caught.message : String(caught),
      });
    }
  });

  // ── POST /hidden-states ───────────────────────────────────────────────
  //
  // Feature-based approach (§5.3): return the hidden state at every
  // encoder layer (plus the input embeddings) so callers can reproduce
  // the paper's "concat last 4 layers" recipe or probe the model.
  router.post("/hidden-states", (req: Request, res: Response) => {
    const parsed = hiddenStatesRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_request", issues: parsed.error.issues });
    }
    const { tokenIds, segmentIds, layers } = parsed.data;
    const seed = parsed.data.model?.seed ?? 42;
    try {
      const { config, weights } = buildTinyBert(seed);
      const err = validateVocab(tokenIds, config.vocabSize, "tokenIds");
      if (err) return res.status(400).json({ error: "invalid_tokens", message: err });
      const { allHiddenStates, pooledOutput } = bertForwardWithLayers(
        weights,
        tokenIds,
        segmentIds,
      );
      const maxIdx = allHiddenStates.length - 1;
      const layerIndices =
        layers ?? Array.from({ length: allHiddenStates.length }, (_, i) => i);
      for (const li of layerIndices) {
        if (li > maxIdx) {
          return res.status(400).json({
            error: "invalid_layer",
            message: `Requested layer ${li} but only ${allHiddenStates.length} states available (0..${maxIdx})`,
          });
        }
      }
      return res.json({
        layers: layerIndices.map((li) => ({
          index: li,
          label: li === 0 ? "embeddings" : `encoder_layer_${li}`,
          hiddenState: toArray(allHiddenStates[li]),
        })),
        pooledOutput: toArray(pooledOutput)[0],
        numLayers: config.numLayers,
        hiddenSize: config.hiddenSize,
      });
    } catch (caught) {
      return res.status(400).json({
        error: "hidden_states_failed",
        message: caught instanceof Error ? caught.message : String(caught),
      });
    }
  });

  // ── POST /classify ────────────────────────────────────────────────────
  //
  // Figure 4 (a)+(b): sentence-level classification head. Pools [CLS],
  // runs a Dense(H → K), and returns logits + (optionally) the loss
  // against a gold label.
  router.post("/classify", (req: Request, res: Response) => {
    const parsed = classifyRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_request", issues: parsed.error.issues });
    }
    const { tokenIds, segmentIds, numLabels, label, headSeed } = parsed.data;
    const seed = parsed.data.model?.seed ?? 42;
    try {
      const { config, weights } = buildTinyBert(seed);
      const err = validateVocab(tokenIds, config.vocabSize, "tokenIds");
      if (err) return res.status(400).json({ error: "invalid_tokens", message: err });
      const head = initBertClassificationHead(config, numLabels, headSeed);
      const { pooledOutput } = bertForward(weights, tokenIds, segmentIds);
      const logits = bertClassificationLogits(pooledOutput, head);
      const lossResult =
        label !== undefined
          ? bertClassificationLoss(pooledOutput, head, label)
          : null;
      return res.json({
        logits: toArray(logits)[0],
        numLabels,
        loss: lossResult,
        algorithm: "pooled [CLS] → Dense(H → K) (Figure 4a/b)",
      });
    } catch (caught) {
      return res.status(400).json({
        error: "classify_failed",
        message: caught instanceof Error ? caught.message : String(caught),
      });
    }
  });

  // ── POST /span ────────────────────────────────────────────────────────
  //
  // Figure 4 (c): SQuAD-style span prediction. Two learned vectors S,E
  // produce start/end logits at every position; optionally returns the
  // loss against gold (start, end).
  router.post("/span", (req: Request, res: Response) => {
    const parsed = spanRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_request", issues: parsed.error.issues });
    }
    const { tokenIds, segmentIds, goldStart, goldEnd, headSeed } = parsed.data;
    const seed = parsed.data.model?.seed ?? 42;
    try {
      const { config, weights } = buildTinyBert(seed);
      const err = validateVocab(tokenIds, config.vocabSize, "tokenIds");
      if (err) return res.status(400).json({ error: "invalid_tokens", message: err });
      const head = initBertSpanHead(config, headSeed);
      const { sequenceOutput } = bertForward(weights, tokenIds, segmentIds);
      const { start, end } = bertSpanLogits(sequenceOutput, head);
      let lossResult: ReturnType<typeof bertSpanLoss> | null = null;
      if (goldStart !== undefined && goldEnd !== undefined) {
        if (goldStart >= tokenIds.length || goldEnd >= tokenIds.length) {
          return res.status(400).json({
            error: "invalid_gold_span",
            message: `gold positions out of sequence length ${tokenIds.length}`,
          });
        }
        lossResult = bertSpanLoss(sequenceOutput, head, goldStart, goldEnd);
      }
      return res.json({
        startLogits: start,
        endLogits: end,
        loss: lossResult,
        algorithm: "T_i · S / T_j · E → softmax span (Figure 4c, SQuAD)",
      });
    } catch (caught) {
      return res.status(400).json({
        error: "span_failed",
        message: caught instanceof Error ? caught.message : String(caught),
      });
    }
  });

  // ── POST /tag ─────────────────────────────────────────────────────────
  //
  // Figure 4 (d): per-token tagging (NER / POS). Dense(H → K) applied
  // at every position; loss is averaged over non-ignored positions.
  router.post("/tag", (req: Request, res: Response) => {
    const parsed = tagRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_request", issues: parsed.error.issues });
    }
    const { tokenIds, segmentIds, numLabels, labels, headSeed } = parsed.data;
    const seed = parsed.data.model?.seed ?? 42;
    try {
      const { config, weights } = buildTinyBert(seed);
      const err = validateVocab(tokenIds, config.vocabSize, "tokenIds");
      if (err) return res.status(400).json({ error: "invalid_tokens", message: err });
      if (labels && labels.length !== tokenIds.length) {
        return res.status(400).json({
          error: "shape_mismatch",
          message: `labels length ${labels.length} != tokenIds length ${tokenIds.length}`,
        });
      }
      const head = initBertTokenTaggingHead(config, numLabels, headSeed);
      const { sequenceOutput } = bertForward(weights, tokenIds, segmentIds);
      const logits = bertTokenTaggingLogits(sequenceOutput, head);
      const lossResult = labels
        ? bertTokenTaggingLoss(sequenceOutput, head, labels)
        : null;
      return res.json({
        logits: toArray(logits),
        numLabels,
        loss: lossResult,
        algorithm: "Dense(H → K) per T_i, mean CE over scored positions (Figure 4d)",
      });
    } catch (caught) {
      return res.status(400).json({
        error: "tag_failed",
        message: caught instanceof Error ? caught.message : String(caught),
      });
    }
  });

  // ── POST /pretrain-loss ───────────────────────────────────────────────
  //
  // Combined MLM + NSP pre-training loss (§A.2). Runs the forward pass
  // ONCE and feeds both heads.
  router.post("/pretrain-loss", (req: Request, res: Response) => {
    const parsed = pretrainLossRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_request", issues: parsed.error.issues });
    }
    const { tokenIds, segmentIds, maskedPositions, originalTokens, nspLabel } = parsed.data;
    const seed = parsed.data.model?.seed ?? 42;
    try {
      const { config, weights } = buildTinyBert(seed);
      const err = validateVocab(tokenIds, config.vocabSize, "tokenIds");
      if (err) return res.status(400).json({ error: "invalid_tokens", message: err });
      if (segmentIds.length !== tokenIds.length) {
        return res.status(400).json({
          error: "shape_mismatch",
          message: `segmentIds length ${segmentIds.length} != tokenIds length ${tokenIds.length}`,
        });
      }
      if (maskedPositions.length !== originalTokens.length) {
        return res.status(400).json({
          error: "shape_mismatch",
          message: `maskedPositions and originalTokens must have the same length`,
        });
      }
      const result = bertPreTrainingLoss(weights, {
        tokenIds,
        segmentIds,
        maskedPositions,
        originalTokens,
        nspLabel: nspLabel === 0 ? NSP_IS_NEXT : NSP_NOT_NEXT,
      });
      return res.json({
        mlmLoss: result.mlmLoss,
        nspLoss: result.nspLoss,
        total: result.total,
        nspPrediction: result.details.nsp.prediction,
        mlmTokenCount: result.details.mlm.tokenCount,
        algorithm:
          "total = mean(MLM NLL over masked) + NSP NLL on [CLS] (Devlin §A.2)",
      });
    } catch (caught) {
      return res.status(400).json({
        error: "pretrain_loss_failed",
        message: caught instanceof Error ? caught.message : String(caught),
      });
    }
  });

  // ── POST /span-v2 ─────────────────────────────────────────────────────
  //
  // SQuAD v2.0 span prediction with [CLS] null-answer handling and the
  // τ decision threshold (§4.3). Optionally computes the training loss
  // if gold (start, end) is provided — pass (0, 0) for "no answer".
  router.post("/span-v2", (req: Request, res: Response) => {
    const parsed = spanV2RequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_request", issues: parsed.error.issues });
    }
    const { tokenIds, segmentIds, goldStart, goldEnd, tau, headSeed } = parsed.data;
    const seed = parsed.data.model?.seed ?? 42;
    try {
      const { config, weights } = buildTinyBert(seed);
      const err = validateVocab(tokenIds, config.vocabSize, "tokenIds");
      if (err) return res.status(400).json({ error: "invalid_tokens", message: err });
      const head = initBertSpanHead(config, headSeed);
      const { sequenceOutput } = bertForward(weights, tokenIds, segmentIds);
      const prediction = bertSpanPredictV2(sequenceOutput, head, tau);
      let lossResult: ReturnType<typeof bertSpanLossV2> | null = null;
      if (goldStart !== undefined && goldEnd !== undefined) {
        if (goldStart >= tokenIds.length || goldEnd >= tokenIds.length) {
          return res.status(400).json({
            error: "invalid_gold_span",
            message: `gold positions out of sequence length ${tokenIds.length}`,
          });
        }
        lossResult = bertSpanLossV2(sequenceOutput, head, goldStart, goldEnd);
      }
      return res.json({
        prediction,
        loss: lossResult,
        tau,
        algorithm:
          "SQuAD v2.0: [CLS]-null answer + τ threshold (Devlin et al. §4.3)",
      });
    } catch (caught) {
      return res.status(400).json({
        error: "span_v2_failed",
        message: caught instanceof Error ? caught.message : String(caught),
      });
    }
  });

  // ── POST /multiple-choice ─────────────────────────────────────────────
  //
  // SWAG-style multiple-choice head (§4.4). For K candidate sequences,
  // runs BERT on each, pools the [CLS] output, scores via dot product
  // with a learned vector, and softmaxes over the K scores. Optionally
  // computes the cross-entropy loss against a gold choice index.
  router.post("/multiple-choice", (req: Request, res: Response) => {
    const parsed = multipleChoiceRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_request", issues: parsed.error.issues });
    }
    const { candidates, segmentIdsPerCandidate, goldIndex, headSeed } = parsed.data;
    const seed = parsed.data.model?.seed ?? 42;
    try {
      const { config, weights } = buildTinyBert(seed);
      for (let k = 0; k < candidates.length; k++) {
        const err = validateVocab(candidates[k], config.vocabSize, `candidates[${k}]`);
        if (err) return res.status(400).json({ error: "invalid_tokens", message: err });
      }
      const pooledPerCandidate = candidates.map((tok, k) =>
        bertForward(weights, tok, segmentIdsPerCandidate?.[k]).pooledOutput,
      );
      const head = initBertMultipleChoiceHead(config, headSeed);
      const scores = bertMultipleChoiceScores(pooledPerCandidate, head);
      const lossResult =
        goldIndex !== undefined
          ? bertMultipleChoiceLoss(pooledPerCandidate, head, goldIndex)
          : null;
      return res.json({
        scores,
        prediction: scores.indexOf(Math.max(...scores)),
        loss: lossResult,
        numCandidates: candidates.length,
        algorithm:
          "Per-candidate pooled [CLS] → dot(w) → softmax (SWAG, Devlin §4.4)",
      });
    } catch (caught) {
      return res.status(400).json({
        error: "multiple_choice_failed",
        message: caught instanceof Error ? caught.message : String(caught),
      });
    }
  });

  // ── POST /layer-combine ───────────────────────────────────────────────
  //
  // §5.3 feature-based approach: given an input sequence, run the full
  // encoder, then combine the hidden states via one of the paper's
  // Table 7 strategies. The winning recipe (concatenate last 4 layers,
  // 96.1 Dev F1) is available as `strategy: "concat-last-4"`.
  router.post("/layer-combine", (req: Request, res: Response) => {
    const parsed = layerCombineRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_request", issues: parsed.error.issues });
    }
    const { tokenIds, segmentIds, strategy, k, weights: combinationWeights } = parsed.data;
    const seed = parsed.data.model?.seed ?? 42;
    try {
      const { config, weights } = buildTinyBert(seed);
      const err = validateVocab(tokenIds, config.vocabSize, "tokenIds");
      if (err) return res.status(400).json({ error: "invalid_tokens", message: err });
      const { allHiddenStates } = bertForwardWithLayers(weights, tokenIds, segmentIds);

      let combined;
      switch (strategy) {
        case "concat-last-k":
          if (k === undefined) {
            return res.status(400).json({
              error: "missing_k",
              message: "strategy 'concat-last-k' requires a numeric `k`",
            });
          }
          combined = concatLastKLayers(allHiddenStates, k);
          break;
        case "concat-last-4":
          combined = concatLastFourHidden(allHiddenStates);
          break;
        case "sum-last-k":
          if (k === undefined) {
            return res.status(400).json({
              error: "missing_k",
              message: "strategy 'sum-last-k' requires a numeric `k`",
            });
          }
          combined = sumLastKLayers(allHiddenStates, k);
          break;
        case "weighted-sum":
          if (!combinationWeights) {
            return res.status(400).json({
              error: "missing_weights",
              message: "strategy 'weighted-sum' requires a `weights` array",
            });
          }
          combined = weightedSumLayers(allHiddenStates, combinationWeights);
          break;
        case "second-to-last":
          combined = secondToLastHidden(allHiddenStates);
          break;
        case "last":
          combined = allHiddenStates[allHiddenStates.length - 1];
          break;
      }
      return res.json({
        combined: toArray(combined),
        shape: [combined.rows, combined.cols],
        strategy,
        numLayers: allHiddenStates.length,
      });
    } catch (caught) {
      return res.status(400).json({
        error: "layer_combine_failed",
        message: caught instanceof Error ? caught.message : String(caught),
      });
    }
  });

  // ── GET /hypers ───────────────────────────────────────────────────────
  //
  // Documented hyperparameter constants from §A.2 (pre-training) and
  // §A.3 (fine-tuning), including the full 18-run fine-tuning grid.
  router.get("/hypers", (_req: Request, res: Response) => {
    return res.json({
      preTraining: BERT_PRE_TRAINING_HYPERS,
      fineTuning: BERT_FINE_TUNING_HYPERS,
      fineTuningGrid: bertFineTuningGrid(),
      citations: {
        preTraining: "Devlin et al. 2018, §A.2",
        fineTuning: "Devlin et al. 2018, §A.3",
      },
    });
  });

  // ── GET /configs ──────────────────────────────────────────────────────
  router.get("/configs", (req: Request, res: Response) => {
    const name = typeof req.query.name === "string" ? req.query.name : undefined;
    try {
      if (name) {
        const preset = bertPreset(name);
        return res.json({
          preset,
          approxParams: estimateBertParams(preset),
        });
      }
      const presets = allBertPresets();
      const summary = Object.entries(presets).map(([k, c]) => ({
        name: k,
        numLayers: c.numLayers,
        hiddenSize: c.hiddenSize,
        numHeads: c.numHeads,
        intermediateSize: c.intermediateSize,
        vocabSize: c.vocabSize,
        typeVocabSize: c.typeVocabSize,
        maxPositionEmbeddings: c.maxPositionEmbeddings,
        dropoutRate: c.dropoutRate,
        approxParams: estimateBertParams(c),
      }));
      return res.json({ presets: summary, count: summary.length });
    } catch (caught) {
      return res.status(400).json({
        error: "configs_failed",
        message: caught instanceof Error ? caught.message : String(caught),
      });
    }
  });

  return router;
}

/**
 * Strip `undefined` entries from a partial overrides object so that
 * spreading it into the default config does not overwrite keys with
 * `undefined` (which would break the probability-sum validation).
 */
function cleanOverrides<T extends Record<string, unknown>>(o: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v !== undefined) out[k] = v;
  }
  return out as Partial<T>;
}

// Suppress unused import warnings on types the compiler otherwise discards.
void (null as unknown as Matrix);
