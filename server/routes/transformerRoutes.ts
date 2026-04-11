/**
 * REST surface for the Transformer primitives.
 *
 * Three endpoints:
 *
 *   POST /api/transformer/attention
 *     Raw scaled dot-product attention. Accepts Q/K/V as 2D arrays and
 *     returns output + weights + pre-softmax scores. Useful for the
 *     /transformer-demo page and for external tooling.
 *
 *   POST /api/transformer/rerank
 *     Attention-based reranker over embedding candidates. Takes a query
 *     vector + a list of candidate vectors (e.g. from pgvector cosine
 *     search) and returns them re-sorted by attention weight. This is
 *     the production integration point — the existing RAG pipeline can
 *     call it as a post-retrieval reranker.
 *
 *   POST /api/transformer/forward
 *     Runs a full tiny-config Transformer encoder/decoder forward pass
 *     over a sequence of input token embeddings. Used by the demo page
 *     to show the pipeline end-to-end.
 *
 * All endpoints are deterministic (seeded weights) and live under the
 * existing `/api/` mount. Rate limiting and auth are inherited from the
 * platform middleware (no special gates).
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

  return router;
}
