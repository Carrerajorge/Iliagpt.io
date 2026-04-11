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
  bertMLMLogits,
  maskedLMLoss,
  bertMLMTopK,
  bertNSPProbabilities,
  applyMaskingProcedure,
  defaultMaskingConfig,
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
