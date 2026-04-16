/**
 * OpenAI-Compatible API Endpoints
 *
 * Provides /v1/chat/completions, /v1/embeddings, and /v1/models so that any
 * application built against the OpenAI SDK can target IliaGPT by changing
 * `base_url`.
 */

import { Router, Request, Response } from "express";
import { nanoid } from "nanoid";
import { createLogger } from "../../utils/logger";
import { llmGateway } from "../../lib/llmGateway";
import { tokenCounter } from "../../lib/tokenCounter";
import { generateEmbeddingsBatch } from "../../embeddingService";
import { authenticateApiKey, apiRateLimit } from "./apiAuth";
import {
  XAI_MODELS,
  GEMINI_MODELS_REGISTRY,
  OPENROUTER_MODELS,
} from "../../lib/modelRegistry";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

const log = createLogger("openai-compat");

// ---------------------------------------------------------------------------
// Model catalogue – built from the central model registry
// ---------------------------------------------------------------------------

interface ModelEntry {
  id: string;
  provider: string;
}

function getAvailableModels(): ModelEntry[] {
  const models: ModelEntry[] = [];

  for (const id of Object.values(XAI_MODELS)) {
    models.push({ id, provider: "xai" });
  }
  for (const id of Object.values(GEMINI_MODELS_REGISTRY)) {
    models.push({ id, provider: "google" });
  }
  for (const id of Object.values(OPENROUTER_MODELS)) {
    models.push({ id, provider: "openrouter" });
  }

  // Well-known provider models (always advertised; the gateway will route)
  const wellKnown: ModelEntry[] = [
    { id: "gpt-4o", provider: "openai" },
    { id: "gpt-4o-mini", provider: "openai" },
    { id: "gpt-4-turbo", provider: "openai" },
    { id: "claude-sonnet-4-20250514", provider: "anthropic" },
    { id: "claude-3-5-haiku-20241022", provider: "anthropic" },
    { id: "deepseek-chat", provider: "deepseek" },
    { id: "deepseek-reasoner", provider: "deepseek" },
  ];

  for (const m of wellKnown) {
    if (!models.some((existing) => existing.id === m.id)) {
      models.push(m);
    }
  }

  return models;
}

// ---------------------------------------------------------------------------
// Router factory
// ---------------------------------------------------------------------------

export function createOpenAICompatRouter(): Router {
  const router = Router();

  // All routes require API key auth + rate limiting
  router.use(authenticateApiKey, apiRateLimit);

  // -----------------------------------------------------------------------
  // GET /v1/models
  // -----------------------------------------------------------------------
  router.get("/models", (_req: Request, res: Response) => {
    const models = getAvailableModels();
    res.json({
      object: "list",
      data: models.map((m) => ({
        id: m.id,
        object: "model",
        created: Math.floor(Date.now() / 1000),
        owned_by: m.provider,
      })),
    });
  });

  // -----------------------------------------------------------------------
  // POST /v1/chat/completions
  // -----------------------------------------------------------------------
  router.post("/chat/completions", async (req: Request, res: Response) => {
    const {
      model,
      messages,
      temperature,
      top_p,
      max_tokens,
      stream = false,
      stop: _stop,
      presence_penalty: _presencePenalty,
      frequency_penalty: _frequencyPenalty,
      user: _user,
    } = req.body ?? {};

    // --- Validation ---
    if (!model || typeof model !== "string") {
      return res.status(400).json({
        error: {
          message: "`model` is required and must be a string",
          type: "invalid_request_error",
          param: "model",
          code: "invalid_value",
        },
      });
    }

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({
        error: {
          message: "`messages` is required and must be a non-empty array",
          type: "invalid_request_error",
          param: "messages",
          code: "invalid_value",
        },
      });
    }

    // Normalise messages to ChatCompletionMessageParam[]
    const normalised: ChatCompletionMessageParam[] = messages.map((m: any) => ({
      role: m.role,
      content: m.content,
      ...(m.name ? { name: m.name } : {}),
    }));

    const completionId = "chatcmpl-" + nanoid();
    const created = Math.floor(Date.now() / 1000);
    const userId = req.apiKeyUser?.userId ?? "api";

    // --- Streaming ---
    if (stream) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();

      try {
        const gen = llmGateway.streamChat(normalised, {
          model,
          temperature,
          topP: top_p,
          maxTokens: max_tokens,
          userId,
          requestId: completionId,
        });

        // Send initial role chunk
        const roleChunk = {
          id: completionId,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [
            {
              index: 0,
              delta: { role: "assistant" },
              finish_reason: null,
            },
          ],
        };
        res.write(`data: ${JSON.stringify(roleChunk)}\n\n`);

        for await (const chunk of gen) {
          if (chunk.content) {
            const sseChunk = {
              id: completionId,
              object: "chat.completion.chunk",
              created,
              model,
              choices: [
                {
                  index: 0,
                  delta: { content: chunk.content },
                  finish_reason: null,
                },
              ],
            };
            res.write(`data: ${JSON.stringify(sseChunk)}\n\n`);
          }

          if (chunk.done) {
            const doneChunk = {
              id: completionId,
              object: "chat.completion.chunk",
              created,
              model,
              choices: [
                {
                  index: 0,
                  delta: {},
                  finish_reason: "stop",
                },
              ],
            };
            res.write(`data: ${JSON.stringify(doneChunk)}\n\n`);
          }
        }

        res.write("data: [DONE]\n\n");
        res.end();
      } catch (error: any) {
        log.error("Streaming error", { error, model, completionId });
        // If headers already sent we can only close the stream
        if (res.headersSent) {
          const errChunk = {
            id: completionId,
            object: "chat.completion.chunk",
            created,
            model,
            choices: [
              {
                index: 0,
                delta: {},
                finish_reason: "stop",
              },
            ],
          };
          res.write(`data: ${JSON.stringify(errChunk)}\n\n`);
          res.write("data: [DONE]\n\n");
          res.end();
        } else {
          res.status(500).json({
            error: {
              message: error.message || "Internal server error during streaming",
              type: "api_error",
              param: null,
              code: "internal_error",
            },
          });
        }
      }
      return;
    }

    // --- Non-streaming ---
    try {
      const response = await llmGateway.chat(normalised, {
        model,
        temperature,
        topP: top_p,
        maxTokens: max_tokens,
        userId,
        requestId: completionId,
      });

      // Count tokens
      const promptText = normalised
        .map((m) => (typeof m.content === "string" ? m.content : ""))
        .join("\n");
      const promptTokens = response.usage?.promptTokens ?? tokenCounter.countAccurate(promptText, model);
      const completionTokens = response.usage?.completionTokens ?? tokenCounter.countAccurate(response.content, model);

      res.json({
        id: completionId,
        object: "chat.completion",
        created,
        model: response.model || model,
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: response.content,
            },
            finish_reason: response.status === "incomplete" ? "length" : "stop",
          },
        ],
        usage: {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: promptTokens + completionTokens,
        },
      });
    } catch (error: any) {
      log.error("Chat completion error", { error, model, completionId });

      const status = error.message?.includes("Rate limit") ? 429 : 500;
      res.status(status).json({
        error: {
          message: error.message || "Internal server error",
          type: status === 429 ? "tokens_exceeded" : "api_error",
          param: null,
          code: status === 429 ? "rate_limit_exceeded" : "internal_error",
        },
      });
    }
  });

  // -----------------------------------------------------------------------
  // POST /v1/embeddings
  // -----------------------------------------------------------------------
  router.post("/embeddings", async (req: Request, res: Response) => {
    const { input, model: _model, encoding_format = "float" } = req.body ?? {};

    if (!input) {
      return res.status(400).json({
        error: {
          message: "`input` is required",
          type: "invalid_request_error",
          param: "input",
          code: "invalid_value",
        },
      });
    }

    const texts: string[] = Array.isArray(input) ? input : [input];

    if (texts.length === 0 || texts.some((t) => typeof t !== "string")) {
      return res.status(400).json({
        error: {
          message: "`input` must be a string or array of strings",
          type: "invalid_request_error",
          param: "input",
          code: "invalid_value",
        },
      });
    }

    try {
      const embeddings = await generateEmbeddingsBatch(texts);

      const totalTokens = texts.reduce(
        (sum, t) => sum + tokenCounter.countFast(t),
        0,
      );

      res.json({
        object: "list",
        data: embeddings.map((embedding, index) => ({
          object: "embedding",
          index,
          embedding:
            encoding_format === "base64"
              ? Buffer.from(new Float32Array(embedding).buffer).toString("base64")
              : embedding,
        })),
        model: "text-embedding-iliagpt-1536",
        usage: {
          prompt_tokens: totalTokens,
          total_tokens: totalTokens,
        },
      });
    } catch (error: any) {
      log.error("Embedding error", { error });
      res.status(500).json({
        error: {
          message: error.message || "Failed to generate embeddings",
          type: "api_error",
          param: null,
          code: "internal_error",
        },
      });
    }
  });

  return router;
}
