/**
 * REST surface for the Transformer primitives.
 *
 * Pedagogical + production endpoints exposing every major piece of the
 * paper's architecture. All endpoints are deterministic (seeded weights)
 * and live under `/api/transformer`. Rate limiting and auth are inherited
 * from the platform middleware (no special gates).
 *
 *   Core math:
 *     POST /attention       — raw scaled dot-product attention
 *     POST /rerank          — attention-based reranker for RAG
 *     POST /forward         — full tiny-config encoder/decoder forward pass
 *
 *   Decoding + training (section 5 + 6):
 *     POST /generate        — greedy auto-regressive decoding
 *     POST /beam-search     — beam search with length penalty
 *     POST /loss            — cross-entropy with optional label smoothing
 *     POST /schedule        — Noam LR schedule (Equation 3) at step N
 *     POST /train-step      — one forward + FD-grad + Adam update on copy task
 *
 *   Checkpoints + presets:
 *     POST /save            — serialize a tiny model to JSON checkpoint
 *     POST /load            — load + forward-check a JSON checkpoint
 *     GET  /configs         — list every Table 3 preset (base/big/tiny + A/B/C/D/E)
 */

import express, { type Request, type Response, Router } from "express";
import { z } from "zod";
import {
  fromArray,
  toArray,
  type Matrix,
  scaledDotProductAttention,
  transformerForward,
  initTransformerWeights,
  tinyTransformerConfig,
  positionalEncoding,
  addPositional,
  // Output projection
  tiedOutputLogits,
  // Decoding
  greedyDecode,
  beamSearchDecode,
  type DecodeContext,
  // Loss
  crossEntropyLoss,
  // Optimizer / schedule
  noamLearningRate,
  AdamOptimizer,
  PAPER_ADAM,
  // Embedding
  initEmbeddingTable,
  embedTokens,
  // Training
  registerSetupWithOptimizer,
  trainingStep,
  generateCopyTaskBatch,
  BOS_ID,
  EOS_ID,
  // Configs
  allPresets,
  preset,
  // Serialization
  checkpointToJSON,
  checkpointFromJSON,
  type TransformerCheckpointJSON,
  // Encoder/decoder runners (for building a decode context)
  runEncoder,
  runDecoder,
} from "../lib/transformer";

// ── Validation schemas ────────────────────────────────────────────────────

const matrix2dSchema = z
  .array(z.array(z.number()))
  .refine((m) => m.length > 0 && m.every((r) => r.length > 0 && r.length === m[0].length), {
    message: "matrix must be a non-empty 2D array with uniform row length",
  });

const attentionRequestSchema = z.object({
  Q: matrix2dSchema,
  K: matrix2dSchema,
  V: matrix2dSchema,
  mask: z.array(z.array(z.boolean())).optional(),
});

const rerankRequestSchema = z.object({
  /** Query vector (d_model length). */
  query: z.array(z.number()).min(1),
  /**
   * Candidate objects with an embedding (same length as query) and an
   * arbitrary payload (doc id, title, snippet, etc.) that's echoed back
   * alongside the attention-rerank score.
   */
  candidates: z
    .array(
      z.object({
        embedding: z.array(z.number()).min(1),
        payload: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .min(1)
    .max(256),
  /**
   * When provided, the weighted combination `alpha * cosine + (1-alpha) * attention`
   * is used for the final ranking (classic hybrid). Default 0.5.
   */
  alpha: z.number().min(0).max(1).optional(),
});

const forwardRequestSchema = z.object({
  /** Source sequence as a list of d_model-dim vectors. */
  src: matrix2dSchema,
  /** Target sequence as a list of d_model-dim vectors. */
  tgt: matrix2dSchema,
});

// ── Generation / loss / training schemas ──────────────────────────────────

/**
 * A minimal "tiny model" spec: token-id inputs are embedded and encoded
 * with a fresh seeded weight collection so the endpoint is deterministic
 * and completes in milliseconds.
 */
const tinyModelParamsSchema = z.object({
  vocabSize: z.number().int().min(3).max(256).default(16),
  /** Random seed for the deterministic weight init. */
  seed: z.number().int().default(42),
});

const generateRequestSchema = z.object({
  srcTokens: z.array(z.number().int().nonnegative()).min(1).max(128),
  maxLength: z.number().int().min(1).max(64).default(16),
  model: tinyModelParamsSchema.optional(),
});

const beamSearchRequestSchema = z.object({
  srcTokens: z.array(z.number().int().nonnegative()).min(1).max(128),
  maxLength: z.number().int().min(1).max(64).default(16),
  beamSize: z.number().int().min(1).max(8).default(4),
  lengthPenalty: z.number().min(0).max(2).default(0.6),
  model: tinyModelParamsSchema.optional(),
});

const lossRequestSchema = z.object({
  logits: matrix2dSchema,
  targets: z.array(z.number().int().nonnegative()),
  epsilon: z.number().min(0).max(0.99).default(0.1),
  paddingId: z.number().int().optional(),
});

const scheduleRequestSchema = z.object({
  /** Absolute training step (1-indexed per the paper). */
  step: z.number().int().min(0).max(1_000_000),
  dModel: z.number().int().min(1).max(4096).default(512),
  warmupSteps: z.number().int().min(1).max(100_000).default(4000),
  /** If set, return a curve `[0..step]` instead of a scalar. */
  curve: z.boolean().optional(),
});

const trainStepRequestSchema = z.object({
  steps: z.number().int().min(1).max(20).default(3),
  vocabSize: z.number().int().min(3).max(16).default(6),
  sequenceLength: z.number().int().min(1).max(8).default(3),
  dModel: z.number().int().min(4).max(32).default(8),
  heads: z.number().int().min(1).max(4).default(2),
  dFF: z.number().int().min(4).max(64).default(16),
  warmupSteps: z.number().int().min(1).max(100).default(5),
  labelSmoothing: z.number().min(0).max(0.5).default(0.1),
  fdStep: z.number().min(1e-6).max(1e-2).default(1e-3),
  /** Maximum FD parameter probes per training step (caps runtime). */
  maxParams: z.number().int().min(4).max(200).default(40),
  seed: z.number().int().default(7),
});

const checkpointSaveSchema = z.object({
  /** Same params used to construct a tiny deterministic model. */
  model: tinyModelParamsSchema.default({ vocabSize: 16, seed: 42 }),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const checkpointLoadSchema = z.object({
  checkpoint: z.object({
    version: z.literal(1),
    config: z.unknown(),
    encoder: z.array(z.unknown()),
    decoder: z.array(z.unknown()),
    embeddingTable: z.unknown().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }),
  /** Optional token ids to run a sanity-check forward pass on after load. */
  probeSrcTokens: z.array(z.number().int().nonnegative()).max(32).optional(),
  probeTgtTokens: z.array(z.number().int().nonnegative()).max(32).optional(),
});

// ── Helpers ───────────────────────────────────────────────────────────────

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Build a deterministic tiny Transformer setup suitable for the
 * `/generate`, `/beam-search`, `/train-step`, and `/save|/load` endpoints.
 *
 * The shared-embedding tying in `tiedOutputLogits` requires the embedding
 * table's `dModel` to match the transformer config's `attention.dModel`.
 */
function buildTinySetup(vocabSize: number, seed: number) {
  const config = tinyTransformerConfig();
  const dModel = config.attention.dModel;
  const embeddingTable = initEmbeddingTable(vocabSize, dModel, seed);
  const weights = initTransformerWeights(config, seed + 1);
  return { config, dModel, embeddingTable, weights };
}

/**
 * Build a `DecodeContext` from a tiny setup and a source token sequence.
 * Encodes the source once; callers then pass this to `greedyDecode` or
 * `beamSearchDecode` which re-run only the decoder per step.
 */
function buildDecodeContext(
  setup: ReturnType<typeof buildTinySetup>,
  srcTokens: number[],
): DecodeContext {
  const { config, dModel, embeddingTable, weights } = setup;
  const srcEmb = addPositional(
    embedTokens(embeddingTable, srcTokens),
    positionalEncoding(srcTokens.length, dModel),
  );
  const encoderOutput = runEncoder(srcEmb, weights.encoder, config.attention);
  return {
    encoderOutput,
    embeddingTable,
    decoderWeights: weights.decoder,
    attentionConfig: config.attention,
  };
}

function validateTokens(tokens: number[], vocabSize: number, label: string): string | null {
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (!Number.isInteger(t) || t < 0 || t >= vocabSize) {
      return `${label}[${i}] = ${t} out of vocab range [0, ${vocabSize})`;
    }
  }
  return null;
}

// ── Router ────────────────────────────────────────────────────────────────

export function createTransformerRouter(): Router {
  const router: Router = express.Router();
  router.use(express.json({ limit: "2mb" }));

  // ── POST /attention ────────────────────────────────────────────────────
  router.post("/attention", (req: Request, res: Response) => {
    const parsed = attentionRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_request", issues: parsed.error.issues });
    }
    const { Q, K, V, mask } = parsed.data;
    try {
      const result = scaledDotProductAttention(fromArray(Q), fromArray(K), fromArray(V), mask);
      return res.json({
        output: toArray(result.output),
        weights: toArray(result.weights),
        scaledScores: toArray(result.scaledScores),
        d_k: K[0].length,
      });
    } catch (err) {
      return res.status(400).json({
        error: "attention_failed",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // ── POST /rerank ───────────────────────────────────────────────────────
  //
  // Attention-based post-retrieval reranker. The query vector becomes Q,
  // the candidate embeddings become both K and V, and the attention
  // weights are used as a scoring signal alongside cosine similarity.
  //
  // This mirrors a common pattern in modern retrieval: cosine gives a
  // cheap initial ranking, cross-attention provides a finer "the query
  // actually aligns with THIS candidate" signal.
  router.post("/rerank", (req: Request, res: Response) => {
    const parsed = rerankRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_request", issues: parsed.error.issues });
    }
    const { query, candidates, alpha = 0.5 } = parsed.data;
    const d = query.length;
    for (let i = 0; i < candidates.length; i++) {
      if (candidates[i].embedding.length !== d) {
        return res.status(400).json({
          error: "dimension_mismatch",
          message: `candidate[${i}].embedding length (${candidates[i].embedding.length}) must equal query length (${d})`,
        });
      }
    }

    // Build Q (1×d), K and V ((N×d), reuse the candidate embeddings).
    const Q: Matrix = fromArray([query]);
    const K: Matrix = fromArray(candidates.map((c) => c.embedding));
    const V: Matrix = K; // identity-style values: attention weights act as direct scores

    const result = scaledDotProductAttention(Q, K, V);
    // weights is (1 × N) — one row of attention scores per query
    const attentionScores: number[] = [];
    for (let i = 0; i < candidates.length; i++) {
      attentionScores.push(result.weights.data[i]);
    }

    // Cosine similarity (the classic baseline)
    const cosineScores = candidates.map((c) => cosineSimilarity(query, c.embedding));

    // Normalize cosine to [0, 1] for fair blending (cosine is in [-1, 1])
    const cosineNorm = cosineScores.map((s) => (s + 1) / 2);

    // Hybrid final score
    const finalScores = candidates.map((_, i) => alpha * cosineNorm[i] + (1 - alpha) * attentionScores[i]);

    // Sort by final score desc
    const ranked = candidates
      .map((c, i) => ({
        index: i,
        payload: c.payload ?? {},
        attention: attentionScores[i],
        cosine: cosineScores[i],
        finalScore: finalScores[i],
      }))
      .sort((a, b) => b.finalScore - a.finalScore);

    return res.json({
      d_model: d,
      alpha,
      ranked,
      algorithm: "scaled-dot-product-attention + cosine (hybrid)",
    });
  });

  // ── POST /forward ──────────────────────────────────────────────────────
  //
  // End-to-end tiny Transformer forward pass for pedagogical purposes.
  // Uses the "tiny" config (d_model=32, h=4, N=2) so it returns quickly.
  router.post("/forward", (req: Request, res: Response) => {
    const parsed = forwardRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_request", issues: parsed.error.issues });
    }
    const { src, tgt } = parsed.data;
    try {
      const config = tinyTransformerConfig();
      const dModel = config.attention.dModel;
      if (src[0].length !== dModel || tgt[0].length !== dModel) {
        return res.status(400).json({
          error: "dimension_mismatch",
          message: `src and tgt rows must have length ${dModel} (tiny config d_model)`,
        });
      }
      const weights = initTransformerWeights(config, 42);
      const srcMat = addPositional(fromArray(src), positionalEncoding(src.length, dModel));
      const tgtMat = addPositional(fromArray(tgt), positionalEncoding(tgt.length, dModel));
      const { encoderOutput, decoderOutput } = transformerForward(srcMat, tgtMat, weights, config);
      return res.json({
        encoderOutput: toArray(encoderOutput),
        decoderOutput: toArray(decoderOutput),
        config: {
          d_model: dModel,
          heads: config.attention.heads,
          encoder_layers: config.encoderLayers,
          decoder_layers: config.decoderLayers,
          d_ff: config.dFF,
        },
      });
    } catch (err) {
      return res.status(400).json({
        error: "forward_failed",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // ── POST /generate ─────────────────────────────────────────────────────
  //
  // Greedy auto-regressive decoding on a tiny deterministic model. Given a
  // source token sequence the server encodes it once, then emits tokens
  // one by one using argmax over the tied-embedding projection.
  router.post("/generate", (req: Request, res: Response) => {
    const parsed = generateRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_request", issues: parsed.error.issues });
    }
    const { srcTokens, maxLength, model } = parsed.data;
    const vocabSize = model?.vocabSize ?? 16;
    const seed = model?.seed ?? 42;

    const err = validateTokens(srcTokens, vocabSize, "srcTokens");
    if (err) return res.status(400).json({ error: "invalid_tokens", message: err });

    try {
      const setup = buildTinySetup(vocabSize, seed);
      const ctx = buildDecodeContext(setup, srcTokens);
      const result = greedyDecode(ctx, { bosId: BOS_ID, eosId: EOS_ID, maxLength });
      return res.json({
        tokens: result.tokens,
        hitEOS: result.hitEOS,
        steps: result.steps,
        model: { vocabSize, seed, dModel: setup.dModel },
        algorithm: "greedy (argmax) with tied-embedding projection",
      });
    } catch (caught) {
      return res.status(400).json({
        error: "generate_failed",
        message: caught instanceof Error ? caught.message : String(caught),
      });
    }
  });

  // ── POST /beam-search ──────────────────────────────────────────────────
  //
  // Beam search with length penalty lp(Y) = ((5+|Y|)/6)^α (paper section 6.1,
  // default α=0.6, beam_size=4). Returns the top-k finished hypotheses.
  router.post("/beam-search", (req: Request, res: Response) => {
    const parsed = beamSearchRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_request", issues: parsed.error.issues });
    }
    const { srcTokens, maxLength, beamSize, lengthPenalty, model } = parsed.data;
    const vocabSize = model?.vocabSize ?? 16;
    const seed = model?.seed ?? 42;

    const err = validateTokens(srcTokens, vocabSize, "srcTokens");
    if (err) return res.status(400).json({ error: "invalid_tokens", message: err });

    try {
      const setup = buildTinySetup(vocabSize, seed);
      const ctx = buildDecodeContext(setup, srcTokens);
      const result = beamSearchDecode(ctx, {
        bosId: BOS_ID,
        eosId: EOS_ID,
        maxLength,
        beamSize,
        lengthPenalty,
      });
      return res.json({
        hypotheses: result.hypotheses.map((h) => ({
          tokens: h.tokens,
          logProbSum: h.logProbSum,
          score: h.score,
          finished: h.finished,
        })),
        best: {
          tokens: result.best.tokens,
          score: result.best.score,
          finished: result.best.finished,
        },
        steps: result.steps,
        params: { beamSize, lengthPenalty, maxLength },
        algorithm: "beam-search with length penalty (Wu et al. 2016)",
      });
    } catch (caught) {
      return res.status(400).json({
        error: "beam_search_failed",
        message: caught instanceof Error ? caught.message : String(caught),
      });
    }
  });

  // ── POST /loss ─────────────────────────────────────────────────────────
  //
  // Cross-entropy with optional label smoothing and padding mask. The
  // request body carries raw logits (not probabilities) so the server can
  // do the full numerically-stable log-softmax internally.
  router.post("/loss", (req: Request, res: Response) => {
    const parsed = lossRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_request", issues: parsed.error.issues });
    }
    const { logits, targets, epsilon, paddingId } = parsed.data;
    const logitsMat = fromArray(logits);
    const vocabSize = logitsMat.cols;
    if (targets.length !== logitsMat.rows) {
      return res.status(400).json({
        error: "shape_mismatch",
        message: `targets length ${targets.length} != logits rows ${logitsMat.rows}`,
      });
    }
    try {
      const result = crossEntropyLoss(logitsMat, targets, {
        epsilon,
        vocabSize,
        paddingId,
      });
      return res.json({
        loss: result.loss,
        tokenCount: result.tokenCount,
        perToken: result.perToken,
        params: { epsilon, vocabSize, paddingId: paddingId ?? null },
      });
    } catch (caught) {
      return res.status(400).json({
        error: "loss_failed",
        message: caught instanceof Error ? caught.message : String(caught),
      });
    }
  });

  // ── POST /schedule ─────────────────────────────────────────────────────
  //
  // Noam LR schedule (Equation 3 of the paper):
  //   lrate = d_model^(-0.5) · min(step^(-0.5), step · warmup^(-1.5))
  //
  // Returns the scalar LR at step N, plus (optionally) the full [0..N]
  // curve for plotting.
  router.post("/schedule", (req: Request, res: Response) => {
    const parsed = scheduleRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_request", issues: parsed.error.issues });
    }
    const { step, dModel, warmupSteps, curve } = parsed.data;
    const config = { dModel, warmupSteps };
    const lr = noamLearningRate(step, config);
    const peak = noamLearningRate(warmupSteps, config);
    let curveData: number[] | undefined;
    if (curve) {
      curveData = new Array(step + 1);
      for (let s = 0; s <= step; s++) curveData[s] = noamLearningRate(s, config);
    }
    return res.json({
      step,
      learningRate: lr,
      peakLearningRate: peak,
      peakAtStep: warmupSteps,
      dModel,
      warmupSteps,
      curve: curveData,
      formula:
        "lrate = d_model^(-0.5) * min(step^(-0.5), step * warmup^(-1.5))",
    });
  });

  // ── POST /train-step ───────────────────────────────────────────────────
  //
  // Forward pass + finite-difference gradient + Adam update on the copy
  // task. The endpoint builds a tiny deterministic setup, runs `steps`
  // training iterations, and returns the per-step loss trajectory so the
  // demo page can plot a live training curve.
  //
  // Intentionally bounded (`maxParams`, tiny dims, tiny batch) so no
  // request can hold the event loop for more than a second or two.
  router.post("/train-step", (req: Request, res: Response) => {
    const parsed = trainStepRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_request", issues: parsed.error.issues });
    }
    const p = parsed.data;
    try {
      const attention = {
        dModel: p.dModel,
        heads: p.heads,
        dK: Math.floor(p.dModel / p.heads),
        dV: Math.floor(p.dModel / p.heads),
      };
      const config = {
        encoderLayers: 1,
        decoderLayers: 1,
        attention,
        dFF: p.dFF,
      };
      const embeddingTable = initEmbeddingTable(p.vocabSize, p.dModel, p.seed);
      const weights = initTransformerWeights(config, p.seed + 1);
      const setup = {
        config,
        embeddingTable,
        encoder: weights.encoder,
        decoder: weights.decoder,
      };
      const [example] = generateCopyTaskBatch(1, {
        vocabSize: p.vocabSize,
        sequenceLength: p.sequenceLength,
        seed: p.seed,
      });
      const batch = { src: example.src, tgtIn: example.tgtIn, tgtOut: example.tgtOut };
      const lsConfig = { epsilon: p.labelSmoothing, vocabSize: p.vocabSize };

      const optimizer = new AdamOptimizer(
        { dModel: p.dModel, warmupSteps: p.warmupSteps },
        PAPER_ADAM,
      );
      registerSetupWithOptimizer(setup, optimizer);

      const fdConfig = { h: p.fdStep, maxParams: p.maxParams };
      const trajectory: Array<{
        step: number;
        loss: number;
        learningRate: number;
        gradientNorm: number;
      }> = [];
      for (let s = 0; s < p.steps; s++) {
        const r = trainingStep(batch, setup, lsConfig, optimizer, fdConfig);
        trajectory.push({
          step: r.step,
          loss: r.loss,
          learningRate: r.learningRate,
          gradientNorm: r.gradientNorm,
        });
      }
      // Final loss after last update (not reported by trainingStep)
      const finalLoss = trajectory.length
        ? trajectory[trajectory.length - 1].loss
        : NaN;
      return res.json({
        trajectory,
        initialLoss: trajectory[0]?.loss ?? NaN,
        finalLoss,
        improved: finalLoss < (trajectory[0]?.loss ?? Infinity),
        batch: {
          src: batch.src,
          tgtIn: batch.tgtIn,
          tgtOut: batch.tgtOut,
        },
        config: {
          dModel: p.dModel,
          heads: p.heads,
          dFF: p.dFF,
          encoderLayers: 1,
          decoderLayers: 1,
          vocabSize: p.vocabSize,
          sequenceLength: p.sequenceLength,
          labelSmoothing: p.labelSmoothing,
          warmupSteps: p.warmupSteps,
        },
      });
    } catch (caught) {
      return res.status(400).json({
        error: "train_step_failed",
        message: caught instanceof Error ? caught.message : String(caught),
      });
    }
  });

  // ── POST /save ─────────────────────────────────────────────────────────
  //
  // Serialize a deterministic tiny model to the JSON checkpoint format.
  // The checkpoint is self-describing (config + weights + optional
  // embedding table) and can be round-tripped through /load without
  // losing Float64 precision.
  router.post("/save", (req: Request, res: Response) => {
    const parsed = checkpointSaveSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_request", issues: parsed.error.issues });
    }
    const { model, metadata } = parsed.data;
    try {
      const setup = buildTinySetup(model.vocabSize, model.seed);
      const checkpoint = checkpointToJSON({
        config: setup.config,
        weights: setup.weights,
        embeddingTable: setup.embeddingTable,
        metadata: {
          ...metadata,
          createdAt: new Date().toISOString(),
          source: "tinyTransformerConfig",
          seed: model.seed,
          vocabSize: model.vocabSize,
        },
      });
      return res.json({
        checkpoint,
        sizeBytes: JSON.stringify(checkpoint).length,
      });
    } catch (caught) {
      return res.status(400).json({
        error: "save_failed",
        message: caught instanceof Error ? caught.message : String(caught),
      });
    }
  });

  // ── POST /load ─────────────────────────────────────────────────────────
  //
  // Parse a JSON checkpoint and optionally run a sanity-check forward pass
  // to verify the loaded weights produce valid logits for probe tokens.
  router.post("/load", (req: Request, res: Response) => {
    const parsed = checkpointLoadSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_request", issues: parsed.error.issues });
    }
    const { checkpoint, probeSrcTokens, probeTgtTokens } = parsed.data;
    try {
      const loaded = checkpointFromJSON(checkpoint as TransformerCheckpointJSON);
      const report: Record<string, unknown> = {
        version: 1,
        config: loaded.config,
        encoderLayers: loaded.weights.encoder.length,
        decoderLayers: loaded.weights.decoder.length,
        hasEmbeddingTable: Boolean(loaded.embeddingTable),
        metadata: loaded.metadata ?? null,
      };

      if (probeSrcTokens && probeTgtTokens && loaded.embeddingTable) {
        const dModel = loaded.embeddingTable.dModel;
        const vocabSize = loaded.embeddingTable.vocabSize;
        const srcErr = validateTokens(probeSrcTokens, vocabSize, "probeSrcTokens");
        const tgtErr = validateTokens(probeTgtTokens, vocabSize, "probeTgtTokens");
        if (srcErr || tgtErr) {
          return res.status(400).json({ error: "invalid_probe_tokens", message: srcErr ?? tgtErr });
        }
        const srcEmb = addPositional(
          embedTokens(loaded.embeddingTable, probeSrcTokens),
          positionalEncoding(probeSrcTokens.length, dModel),
        );
        const encoderOutput = runEncoder(
          srcEmb,
          loaded.weights.encoder,
          loaded.config.attention,
        );
        // One-step forward: embed tgt tokens, run decoder, tied logits
        const tgtEmb = addPositional(
          embedTokens(loaded.embeddingTable, probeTgtTokens),
          positionalEncoding(probeTgtTokens.length, dModel),
        );
        const decoderOutput = runDecoder(
          tgtEmb,
          encoderOutput,
          loaded.weights.decoder,
          loaded.config.attention,
        );
        const logits = tiedOutputLogits(decoderOutput, loaded.embeddingTable);
        report["probe"] = {
          srcLen: probeSrcTokens.length,
          tgtLen: probeTgtTokens.length,
          logitsShape: [logits.rows, logits.cols],
          lastLogits: toArray({
            rows: 1,
            cols: logits.cols,
            data: logits.data.slice((logits.rows - 1) * logits.cols, logits.rows * logits.cols),
          })[0],
        };
      }

      return res.json({ ok: true, report });
    } catch (caught) {
      return res.status(400).json({
        error: "load_failed",
        message: caught instanceof Error ? caught.message : String(caught),
      });
    }
  });

  // ── GET /configs ───────────────────────────────────────────────────────
  //
  // Return every Table 3 preset (base, big, tiny + A1..A4, B1..B2, C1..C7,
  // D1..D4, E). Optional query param `?name=base` returns a single preset.
  router.get("/configs", (req: Request, res: Response) => {
    const name = typeof req.query.name === "string" ? req.query.name : undefined;
    try {
      if (name) {
        const single = preset(name);
        return res.json({ preset: single });
      }
      const all = allPresets();
      const summary = Object.entries(all).map(([key, cfg]) => ({
        name: key,
        description: cfg.description,
        dModel: cfg.attention.dModel,
        heads: cfg.attention.heads,
        dK: cfg.attention.dK,
        dV: cfg.attention.dV,
        encoderLayers: cfg.encoderLayers,
        decoderLayers: cfg.decoderLayers,
        dFF: cfg.dFF,
        dropout: cfg.dropout,
        labelSmoothing: cfg.labelSmoothing,
        learnedPositionalEmbeddings: cfg.learnedPositionalEmbeddings,
        approxParamsMillions: cfg.approxParamsMillions,
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
