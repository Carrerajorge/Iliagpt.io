/**
 * REST surface for the in-house GPT-3 implementation.
 *
 * Brown et al. 2020 (arXiv:2005.14165) — decoder-only autoregressive
 * language model with in-context learning. Every endpoint below is a
 * pure Float64 computation, same as our BERT and Transformer routers,
 * and builds a fresh tiny deterministic model per request so responses
 * are bounded in cost.
 *
 * Endpoints (mounted at /api/gpt3):
 *
 *   POST /forward        — one forward pass, returns full logits
 *   POST /next-token     — next-token distribution (for step-by-step UIs)
 *   POST /generate       — autoregressive generation with sampling
 *   POST /sample         — sampleFromLogits on a caller-provided logits vector
 *   POST /prompt         — render an in-context learning prompt
 *   POST /schedule       — gpt3CosineSchedule curve
 *   POST /sparse-mask    — build a sparse attention mask (debugging / UI)
 *   GET  /configs        — list every Table 2.1 preset + tiny
 */

import express, { type Request, type Response, Router } from "express";
import { z } from "zod";
import {
  type Matrix,
  toArray,
  // GPT-3
  gptTinyConfig,
  gptPreset,
  allGptPresets,
  initGptWeights,
  gptForward,
  gptNextTokenLogits,
  gptGenerate,
  sampleFromLogits,
  buildInContextPrompt,
  validateInContextPrompt,
  inContextModeOf,
  gpt3CosineSchedule,
  localBandMask,
  stridedSparseMask,
  fullCausalMask,
  maskDensity,
  // GPT-4 additions
  type ChatMessage,
  buildChatPrompt,
  validateChatStructure,
  fitScalingLaw,
  predictLoss,
  extrapolationError,
  bradleyTerryLoss,
  batchBradleyTerryLoss,
  reinforceStep,
  expectedCalibrationError,
  withChainOfThought,
  CHAIN_OF_THOUGHT_PREAMBLE,
} from "../lib/transformer";

// ---------------------------------------------------------------------------
// Shared schemas
// ---------------------------------------------------------------------------

/**
 * Only `gpt3-tiny` can be materialized per-request. The bigger presets
 * would OOM the server — we surface them via `GET /configs` for
 * inspection but never actually build their weights in this router.
 */
const modelParamsSchema = z.object({
  preset: z.enum(["gpt3-tiny"]).default("gpt3-tiny"),
  seed: z.number().int().default(42),
});

const tokenIdsSchema = z.array(z.number().int().nonnegative()).min(1).max(64);

const samplingSchema = z
  .object({
    temperature: z.number().min(0).max(5).optional(),
    topK: z.number().int().min(1).max(256).optional(),
    topP: z.number().min(0).max(1).optional(),
    seed: z.number().int().optional(),
    greedy: z.boolean().optional(),
  })
  .optional();

const forwardRequestSchema = z.object({
  tokenIds: tokenIdsSchema,
  model: modelParamsSchema.optional(),
});

const generateRequestSchema = z.object({
  promptTokenIds: tokenIdsSchema,
  maxNewTokens: z.number().int().min(1).max(16).default(4),
  stopToken: z.number().int().nonnegative().optional(),
  sampling: samplingSchema,
  model: modelParamsSchema.optional(),
});

const sampleRequestSchema = z.object({
  logits: z.array(z.number()).min(1).max(2048),
  sampling: samplingSchema,
});

const promptRequestSchema = z.object({
  taskDescription: z.array(z.number().int().nonnegative()).default([]),
  taskDescriptionSeparator: z.array(z.number().int().nonnegative()).optional(),
  examples: z
    .array(
      z.object({
        input: z.array(z.number().int().nonnegative()),
        output: z.array(z.number().int().nonnegative()),
      }),
    )
    .default([]),
  query: z.array(z.number().int().nonnegative()).min(1),
  inputOutputSeparator: z.array(z.number().int().nonnegative()).min(1),
  exampleSeparator: z.array(z.number().int().nonnegative()).min(1),
  /** Cap prompts to the tiny model's context window. */
  vocabSize: z.number().int().min(2).max(1024).optional(),
});

const scheduleRequestSchema = z.object({
  step: z.number().int().min(0).max(2_000_000),
  peakLR: z.number().positive().default(6e-4),
  warmupSteps: z.number().int().min(1).max(1_000_000).default(1_000),
  totalSteps: z.number().int().min(2).max(5_000_000).default(10_000),
  minLRFraction: z.number().min(0).max(1).default(0.1),
  curve: z.boolean().optional(),
});

const sparseMaskRequestSchema = z.object({
  seqLen: z.number().int().min(1).max(512),
  kind: z.enum(["dense", "local-band", "strided"]).default("strided"),
  bandSize: z.number().int().min(1).max(128).optional(),
  stride: z.number().int().min(1).max(128).optional(),
});

// ── GPT-4 schemas (chat, scaling laws, RLHF, calibration) ─────────────────

const chatMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string().min(1).max(4096),
});

const chatRequestSchema = z.object({
  messages: z.array(chatMessageSchema).min(1).max(32),
  addAssistantPrimer: z.boolean().default(true),
});

const scalingLawFitSchema = z.object({
  observations: z
    .array(
      z.object({
        compute: z.number().positive().finite(),
        loss: z.number().finite(),
      }),
    )
    .min(2)
    .max(200),
  asymptote: z.number().optional(),
});

const scalingLawPredictSchema = z.object({
  params: z.object({
    a: z.number().finite(),
    b: z.number().finite(),
    c: z.number().finite(),
  }),
  compute: z.number().positive().finite(),
});

const preferenceLossSchema = z.object({
  rChosen: z.union([z.number().finite(), z.array(z.number().finite()).min(1).max(256)]),
  rRejected: z.union([z.number().finite(), z.array(z.number().finite()).min(1).max(256)]),
});

const reinforceStepSchema = z.object({
  logProbs: z.array(z.number().finite()).min(1).max(512),
  reward: z.number().finite(),
  baseline: z.number().finite().optional(),
  klDivergencePerToken: z.array(z.number().finite()).optional(),
  klCoefficient: z.number().min(0).optional(),
});

const calibrationSchema = z.object({
  predictions: z
    .array(
      z.object({
        probability: z.number().min(0).max(1),
        correct: z.boolean(),
      }),
    )
    .min(1)
    .max(10_000),
  numBins: z.number().int().min(1).max(100).default(10),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildTinyGpt(seed: number) {
  const config = gptTinyConfig();
  const weights = initGptWeights(config, seed);
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

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export function createGpt3Router(): Router {
  const router: Router = express.Router();
  router.use(express.json({ limit: "2mb" }));

  // ── POST /forward ─────────────────────────────────────────────────────
  router.post("/forward", (req: Request, res: Response) => {
    const parsed = forwardRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_request", issues: parsed.error.issues });
    }
    const { tokenIds } = parsed.data;
    const seed = parsed.data.model?.seed ?? 42;
    try {
      const { config, weights } = buildTinyGpt(seed);
      const err = validateVocab(tokenIds, config.vocabSize, "tokenIds");
      if (err) return res.status(400).json({ error: "invalid_tokens", message: err });
      if (tokenIds.length > config.contextWindow) {
        return res.status(400).json({
          error: "context_overflow",
          message: `tokenIds length ${tokenIds.length} > contextWindow ${config.contextWindow}`,
        });
      }
      const { sequenceOutput, logits } = gptForward(weights, tokenIds);
      return res.json({
        sequenceOutput: toArray(sequenceOutput),
        logits: toArray(logits),
        shape: {
          sequenceOutput: [sequenceOutput.rows, sequenceOutput.cols],
          logits: [logits.rows, logits.cols],
        },
        model: {
          preset: "gpt3-tiny",
          seed,
          numLayers: config.numLayers,
          hiddenSize: config.hiddenSize,
          numHeads: config.numHeads,
        },
      });
    } catch (caught) {
      return res.status(400).json({
        error: "forward_failed",
        message: caught instanceof Error ? caught.message : String(caught),
      });
    }
  });

  // ── POST /next-token ──────────────────────────────────────────────────
  router.post("/next-token", (req: Request, res: Response) => {
    const parsed = forwardRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_request", issues: parsed.error.issues });
    }
    const { tokenIds } = parsed.data;
    const seed = parsed.data.model?.seed ?? 42;
    try {
      const { config, weights } = buildTinyGpt(seed);
      const err = validateVocab(tokenIds, config.vocabSize, "tokenIds");
      if (err) return res.status(400).json({ error: "invalid_tokens", message: err });
      const logits = gptNextTokenLogits(weights, tokenIds);
      return res.json({
        logits: Array.from(logits),
        vocabSize: config.vocabSize,
      });
    } catch (caught) {
      return res.status(400).json({
        error: "next_token_failed",
        message: caught instanceof Error ? caught.message : String(caught),
      });
    }
  });

  // ── POST /generate ────────────────────────────────────────────────────
  router.post("/generate", (req: Request, res: Response) => {
    const parsed = generateRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_request", issues: parsed.error.issues });
    }
    const { promptTokenIds, maxNewTokens, stopToken, sampling } = parsed.data;
    const seed = parsed.data.model?.seed ?? 42;
    try {
      const { config, weights } = buildTinyGpt(seed);
      const err = validateVocab(promptTokenIds, config.vocabSize, "promptTokenIds");
      if (err) return res.status(400).json({ error: "invalid_tokens", message: err });
      if (stopToken !== undefined && stopToken >= config.vocabSize) {
        return res.status(400).json({
          error: "invalid_stop_token",
          message: `stopToken ${stopToken} exceeds vocabSize ${config.vocabSize}`,
        });
      }
      const result = gptGenerate(weights, promptTokenIds, {
        maxNewTokens,
        stopToken,
        sampling,
      });
      return res.json({
        tokens: result.tokens,
        generated: result.generated,
        steps: result.steps,
        stopReason: result.stopReason,
        model: { preset: "gpt3-tiny", seed },
      });
    } catch (caught) {
      return res.status(400).json({
        error: "generate_failed",
        message: caught instanceof Error ? caught.message : String(caught),
      });
    }
  });

  // ── POST /sample ──────────────────────────────────────────────────────
  //
  // Pure sampler — no model involvement. Caller passes raw logits and
  // gets a single token id back. Handy for testing top-k/top-p
  // behavior from external clients.
  router.post("/sample", (req: Request, res: Response) => {
    const parsed = sampleRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_request", issues: parsed.error.issues });
    }
    const { logits, sampling } = parsed.data;
    try {
      const token = sampleFromLogits(logits, sampling ?? {});
      return res.json({ token, vocabSize: logits.length });
    } catch (caught) {
      return res.status(400).json({
        error: "sample_failed",
        message: caught instanceof Error ? caught.message : String(caught),
      });
    }
  });

  // ── POST /prompt ──────────────────────────────────────────────────────
  //
  // Render an in-context learning prompt (zero / one / few-shot) into
  // a flat token id sequence that can be fed to /generate.
  router.post("/prompt", (req: Request, res: Response) => {
    const parsed = promptRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_request", issues: parsed.error.issues });
    }
    const { taskDescription, taskDescriptionSeparator, examples, query, inputOutputSeparator, exampleSeparator, vocabSize } = parsed.data;
    try {
      const spec = {
        taskDescription,
        taskDescriptionSeparator,
        examples,
        query,
        inputOutputSeparator,
        exampleSeparator,
      };
      if (vocabSize !== undefined) validateInContextPrompt(spec, vocabSize);
      const built = buildInContextPrompt(spec);
      return res.json({
        tokenIds: built.tokenIds,
        mode: built.mode,
        numExamples: built.numExamples,
        modeFromCount: inContextModeOf(examples.length),
      });
    } catch (caught) {
      return res.status(400).json({
        error: "prompt_failed",
        message: caught instanceof Error ? caught.message : String(caught),
      });
    }
  });

  // ── POST /schedule ────────────────────────────────────────────────────
  router.post("/schedule", (req: Request, res: Response) => {
    const parsed = scheduleRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_request", issues: parsed.error.issues });
    }
    const { step, peakLR, warmupSteps, totalSteps, minLRFraction, curve } = parsed.data;
    try {
      const lr = gpt3CosineSchedule(step, { peakLR, warmupSteps, totalSteps, minLRFraction });
      let curveData: number[] | undefined;
      if (curve) {
        curveData = new Array(step + 1);
        for (let s = 0; s <= step; s++) {
          curveData[s] = gpt3CosineSchedule(s, {
            peakLR,
            warmupSteps,
            totalSteps,
            minLRFraction,
          });
        }
      }
      return res.json({
        step,
        learningRate: lr,
        peakLR,
        warmupSteps,
        totalSteps,
        minLRFraction,
        curve: curveData,
        formula:
          "linear warmup → cosine decay to minLR = peakLR × minLRFraction (Brown et al. §C)",
      });
    } catch (caught) {
      return res.status(400).json({
        error: "schedule_failed",
        message: caught instanceof Error ? caught.message : String(caught),
      });
    }
  });

  // ── POST /sparse-mask ─────────────────────────────────────────────────
  router.post("/sparse-mask", (req: Request, res: Response) => {
    const parsed = sparseMaskRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_request", issues: parsed.error.issues });
    }
    const { seqLen, kind, bandSize, stride } = parsed.data;
    try {
      let mask: boolean[][];
      switch (kind) {
        case "dense":
          mask = fullCausalMask(seqLen);
          break;
        case "local-band":
          if (bandSize === undefined) {
            return res.status(400).json({
              error: "missing_band_size",
              message: 'kind "local-band" requires `bandSize`',
            });
          }
          mask = localBandMask(seqLen, bandSize);
          break;
        case "strided":
          if (bandSize === undefined || stride === undefined) {
            return res.status(400).json({
              error: "missing_params",
              message: 'kind "strided" requires `bandSize` and `stride`',
            });
          }
          mask = stridedSparseMask(seqLen, bandSize, stride);
          break;
      }
      return res.json({
        mask,
        density: maskDensity(mask),
        seqLen,
        kind,
      });
    } catch (caught) {
      return res.status(400).json({
        error: "sparse_mask_failed",
        message: caught instanceof Error ? caught.message : String(caught),
      });
    }
  });

  // ─── GPT-4 Technical Report endpoints (arXiv:2303.08774) ───────────────

  // ── POST /chat ────────────────────────────────────────────────────────
  //
  // §2 canonical ChatML-style transcript builder. Accepts a list of
  // {role, content} messages and renders a flat token id sequence
  // that can be fed straight into /generate.
  router.post("/chat", (req: Request, res: Response) => {
    const parsed = chatRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_request", issues: parsed.error.issues });
    }
    const { messages, addAssistantPrimer } = parsed.data;
    try {
      // Validate structural invariants first — gives better errors
      validateChatStructure(messages as ChatMessage[], { addAssistantPrimer });
      // Per-char stand-in tokenizer — production callers would plug in
      // a real BPE. The key artifact is the structure (role markers +
      // ordering), which is tokenizer-agnostic.
      const tokenize = (s: string): number[] => {
        const out: number[] = [];
        for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i));
        return out;
      };
      const built = buildChatPrompt(messages as ChatMessage[], {
        tokenize,
        addAssistantPrimer,
      });
      return res.json({
        tokenIds: built.tokenIds,
        roles: built.roles,
        numTurns: built.numTurns,
        mode: built.mode,
        algorithm: "ChatML-style transcript (GPT-4 §2)",
      });
    } catch (caught) {
      return res.status(400).json({
        error: "chat_failed",
        message: caught instanceof Error ? caught.message : String(caught),
      });
    }
  });

  // ── POST /scaling-law-fit ─────────────────────────────────────────────
  router.post("/scaling-law-fit", (req: Request, res: Response) => {
    const parsed = scalingLawFitSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_request", issues: parsed.error.issues });
    }
    const { observations, asymptote } = parsed.data;
    try {
      const fit = fitScalingLaw(observations, { asymptote });
      return res.json({
        params: fit.params,
        rmseTrain: fit.rmseTrain,
        r2Train: fit.r2Train,
        formula: "L(C) = a · C^b + c (Brown 2020 / Hoffmann 2022 / GPT-4 §2.1)",
      });
    } catch (caught) {
      return res.status(400).json({
        error: "scaling_law_fit_failed",
        message: caught instanceof Error ? caught.message : String(caught),
      });
    }
  });

  // ── POST /scaling-law-predict ─────────────────────────────────────────
  router.post("/scaling-law-predict", (req: Request, res: Response) => {
    const parsed = scalingLawPredictSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_request", issues: parsed.error.issues });
    }
    const { params, compute } = parsed.data;
    try {
      const predictedLoss = predictLoss(compute, params);
      return res.json({
        compute,
        params,
        predictedLoss,
      });
    } catch (caught) {
      return res.status(400).json({
        error: "scaling_law_predict_failed",
        message: caught instanceof Error ? caught.message : String(caught),
      });
    }
  });

  // ── POST /preference-loss ─────────────────────────────────────────────
  //
  // Bradley-Terry preference loss for reward model training (§2.3).
  // Accepts either scalar rewards (single pair) or arrays (minibatch).
  router.post("/preference-loss", (req: Request, res: Response) => {
    const parsed = preferenceLossSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_request", issues: parsed.error.issues });
    }
    const { rChosen, rRejected } = parsed.data;
    try {
      if (Array.isArray(rChosen) !== Array.isArray(rRejected)) {
        return res.status(400).json({
          error: "shape_mismatch",
          message: "rChosen and rRejected must be both scalars or both arrays",
        });
      }
      if (Array.isArray(rChosen) && Array.isArray(rRejected)) {
        const result = batchBradleyTerryLoss(rChosen, rRejected);
        return res.json({
          meanLoss: result.meanLoss,
          perPair: result.perPair,
          algorithm: "batched Bradley-Terry (InstructGPT / GPT-4 §2.3)",
        });
      }
      const result = bradleyTerryLoss(rChosen as number, rRejected as number);
      return res.json({
        loss: result.loss,
        probChosenWins: result.probChosenWins,
        rewardGap: result.rewardGap,
        algorithm: "Bradley-Terry preference loss (InstructGPT / GPT-4 §2.3)",
      });
    } catch (caught) {
      return res.status(400).json({
        error: "preference_loss_failed",
        message: caught instanceof Error ? caught.message : String(caught),
      });
    }
  });

  // ── POST /reinforce-step ──────────────────────────────────────────────
  router.post("/reinforce-step", (req: Request, res: Response) => {
    const parsed = reinforceStepSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_request", issues: parsed.error.issues });
    }
    try {
      const result = reinforceStep(parsed.data);
      return res.json({
        loss: result.loss,
        advantage: result.advantage,
        klPenalty: result.klPenalty,
        perTokenGradient: result.perTokenGradient,
        algorithm: "REINFORCE policy gradient with optional KL penalty (§2.3)",
      });
    } catch (caught) {
      return res.status(400).json({
        error: "reinforce_step_failed",
        message: caught instanceof Error ? caught.message : String(caught),
      });
    }
  });

  // ── POST /calibration ─────────────────────────────────────────────────
  //
  // Expected Calibration Error (Naeini et al. 2015, used in Figure 8 of
  // the GPT-4 technical report to track how RLHF affects calibration).
  router.post("/calibration", (req: Request, res: Response) => {
    const parsed = calibrationSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_request", issues: parsed.error.issues });
    }
    const { predictions, numBins } = parsed.data;
    try {
      const result = expectedCalibrationError(predictions, numBins);
      return res.json({
        ece: result.ece,
        bins: result.bins,
        numPredictions: predictions.length,
      });
    } catch (caught) {
      return res.status(400).json({
        error: "calibration_failed",
        message: caught instanceof Error ? caught.message : String(caught),
      });
    }
  });

  // ── POST /chain-of-thought ────────────────────────────────────────────
  //
  // Wraps a question with "Let's think step by step." (Wei et al. 2022),
  // the preamble the GPT-4 paper uses for multi-step reasoning benchmarks.
  router.post("/chain-of-thought", (req: Request, res: Response) => {
    const schema = z.object({ question: z.string().min(1).max(4096) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_request", issues: parsed.error.issues });
    }
    return res.json({
      wrapped: withChainOfThought(parsed.data.question),
      preamble: CHAIN_OF_THOUGHT_PREAMBLE,
    });
  });

  // ── GET /configs ──────────────────────────────────────────────────────
  router.get("/configs", (req: Request, res: Response) => {
    const name = typeof req.query.name === "string" ? req.query.name : undefined;
    try {
      if (name) {
        const preset = gptPreset(name);
        return res.json({ preset });
      }
      const presets = allGptPresets();
      const summary = Object.entries(presets).map(([k, c]) => ({
        name: k,
        numLayers: c.numLayers,
        hiddenSize: c.hiddenSize,
        numHeads: c.numHeads,
        headSize: c.headSize,
        intermediateSize: c.intermediateSize,
        contextWindow: c.contextWindow,
        vocabSize: c.vocabSize,
        approxParamsMillions: c.approxParamsMillions,
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

// Prevent unused-type warning (Matrix is imported only to strongly type
// the toArray call signature across the file).
void (null as unknown as Matrix);
