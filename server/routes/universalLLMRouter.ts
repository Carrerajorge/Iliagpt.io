/**
 * UNIVERSAL LLM API ROUTER
 *
 * OpenAI-compatible REST API that works with ANY LLM provider.
 * Drop-in replacement for OpenAI API - any client library that
 * works with OpenAI will work with this endpoint.
 *
 * Endpoints:
 * - POST /api/v1/chat/completions      - Chat completion (streaming & non-streaming)
 * - GET  /api/v1/models                 - List all available models
 * - GET  /api/v1/models/:id             - Get model details
 * - POST /api/v1/embeddings             - Generate embeddings
 * - GET  /api/v1/providers              - List providers and health
 * - GET  /api/v1/providers/health       - Provider health dashboard
 * - GET  /api/v1/costs                  - Cost analytics
 * - GET  /api/v1/costs/suggestions      - Cost optimization suggestions
 * - POST /api/v1/orchestrate/chain      - Multi-model chain execution
 * - POST /api/v1/orchestrate/ensemble   - Ensemble voting
 * - POST /api/v1/orchestrate/analyze    - Task complexity analysis
 */

import { Router, type Request, type Response } from "express";
import { providerRegistry } from "../lib/providers/ProviderRegistry";
import type { LLMMessage, LLMRequestConfig, StreamEvent } from "../lib/providers/BaseProvider";
import { streamEngine } from "../services/llm/UnifiedStreamEngine";
import { costEngine } from "../services/llm/CostOptimizationEngine";
import { healthMonitor } from "../services/llm/ProviderHealthMonitor";
import { pipelineOptimizer } from "../services/llm/RequestPipelineOptimizer";
import { orchestrator } from "../services/llm/MultiModelOrchestrator";

const router = Router();

// ===== Chat Completions (OpenAI-compatible) =====

router.post("/v1/chat/completions", async (req: Request, res: Response) => {
  try {
    const { model, messages, stream, temperature, top_p, max_tokens, tools, tool_choice, response_format, stop, seed, frequency_penalty, presence_penalty, user } = req.body;

    if (!model || !messages?.length) {
      return res.status(400).json({ error: { message: "model and messages are required", type: "invalid_request_error" } });
    }

    const llmMessages: LLMMessage[] = messages.map((m: any) => ({
      role: m.role,
      content: m.content,
      name: m.name,
      toolCallId: m.tool_call_id,
      toolCalls: m.tool_calls,
    }));

    const config: LLMRequestConfig = {
      model,
      messages: llmMessages,
      temperature,
      topP: top_p,
      maxTokens: max_tokens,
      tools,
      toolChoice: tool_choice,
      responseFormat: response_format,
      stop,
      seed,
      frequencyPenalty: frequency_penalty,
      presencePenalty: presence_penalty,
      user,
    };

    // Optimize context
    const { optimizedConfig } = pipelineOptimizer.optimizeContext(config);

    if (stream) {
      // SSE Streaming
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });

      const streamGen = streamEngine.stream(optimizedConfig);
      const requestId = `chatcmpl-${Date.now()}`;

      for await (const event of streamGen) {
        const chunk = formatSSEChunk(event, model, requestId);
        if (chunk) {
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        }
        if (event.type === "done" || event.type === "error") break;
      }

      res.write("data: [DONE]\n\n");
      res.end();
    } else {
      // Non-streaming
      const cached = pipelineOptimizer.getCached(optimizedConfig);
      if (cached) {
        return res.json(formatCompletionResponse(cached, model));
      }

      const provider = providerRegistry.getProviderForModel(model);
      if (!provider) {
        return res.status(404).json({ error: { message: `No provider for model: ${model}`, type: "model_not_found" } });
      }

      if (!healthMonitor.canRequest(provider.name)) {
        // Try fallback
        const routing = await providerRegistry.route(model, "failover");
        const result = await routing.provider.complete(optimizedConfig);
        healthMonitor.recordSuccess(routing.provider.name, result.latencyMs, model, result.usage.totalTokens);
        pipelineOptimizer.setCached(optimizedConfig, result);

        const userId = (req as any).user?.id || user || "anonymous";
        await costEngine.trackUsage({ userId, provider: routing.provider.name, model, usage: result.usage, latencyMs: result.latencyMs });

        return res.json(formatCompletionResponse(result, model));
      }

      const start = Date.now();
      const result = await provider.complete(optimizedConfig);
      healthMonitor.recordSuccess(provider.name, result.latencyMs, model, result.usage.totalTokens);
      pipelineOptimizer.setCached(optimizedConfig, result);

      const userId = (req as any).user?.id || user || "anonymous";
      await costEngine.trackUsage({ userId, provider: provider.name, model, usage: result.usage, latencyMs: result.latencyMs });

      return res.json(formatCompletionResponse(result, model));
    }
  } catch (error: any) {
    console.error("[UniversalLLM] Error:", error.message);
    const status = (error as any).status || 500;
    return res.status(status).json({
      error: { message: error.message, type: "api_error", code: status },
    });
  }
});

// ===== Models =====

router.get("/v1/models", async (_req: Request, res: Response) => {
  try {
    const models = await providerRegistry.getAllModels();
    const data = models.map((m) => ({
      id: m.id,
      object: "model",
      created: Math.floor(Date.now() / 1000),
      owned_by: m.provider,
      permission: [],
      root: m.id,
      parent: null,
      // Extended fields
      _provider: m.provider,
      _name: m.name,
      _description: m.description,
      _context_window: m.contextWindow,
      _max_output_tokens: m.maxOutputTokens,
      _pricing: { input_per_million: m.inputPricePerMillion, output_per_million: m.outputPricePerMillion },
      _capabilities: m.capabilities,
      _category: m.category,
      _tier: m.tier,
      _tags: m.tags,
    }));
    res.json({ object: "list", data });
  } catch (error: any) {
    res.status(500).json({ error: { message: error.message } });
  }
});

router.get("/v1/models/:modelId", async (req: Request, res: Response) => {
  try {
    const models = await providerRegistry.getAllModels();
    const model = models.find((m) => m.id === req.params.modelId);
    if (!model) return res.status(404).json({ error: { message: "Model not found" } });
    res.json({
      id: model.id, object: "model", created: Math.floor(Date.now() / 1000),
      owned_by: model.provider,
      _details: model,
    });
  } catch (error: any) {
    res.status(500).json({ error: { message: error.message } });
  }
});

// ===== Embeddings =====

router.post("/v1/embeddings", async (req: Request, res: Response) => {
  try {
    const { input, model } = req.body;
    const provider = providerRegistry.getProviderForModel(model || "text-embedding-3-small");
    if (!provider) return res.status(404).json({ error: { message: "No embedding provider available" } });

    const texts = Array.isArray(input) ? input : [input];
    const embeddings = await provider.embed(texts, model);

    res.json({
      object: "list",
      data: embeddings.map((emb, idx) => ({ object: "embedding", index: idx, embedding: emb })),
      model: model || "text-embedding-3-small",
      usage: { prompt_tokens: texts.join("").length / 4, total_tokens: texts.join("").length / 4 },
    });
  } catch (error: any) {
    res.status(500).json({ error: { message: error.message } });
  }
});

// ===== Providers =====

router.get("/v1/providers", (_req: Request, res: Response) => {
  const stats = providerRegistry.getStats();
  const health = providerRegistry.getHealthSummary();
  res.json({ ...stats, providers: health });
});

router.get("/v1/providers/health", (_req: Request, res: Response) => {
  const dashboard = healthMonitor.getDashboard();
  res.json(dashboard);
});

// ===== Cost Analytics =====

router.get("/v1/costs", (req: Request, res: Response) => {
  const userId = req.query.userId as string;
  const periodMs = parseInt(req.query.period as string) || 86400000;
  const summary = costEngine.getSummary(userId, periodMs);
  res.json(summary);
});

router.get("/v1/costs/suggestions", async (req: Request, res: Response) => {
  const userId = req.query.userId as string;
  const suggestions = await costEngine.getOptimizationSuggestions(userId);
  res.json({ suggestions });
});

// ===== Orchestration =====

router.post("/v1/orchestrate/analyze", (req: Request, res: Response) => {
  const { messages } = req.body;
  if (!messages?.length) return res.status(400).json({ error: { message: "messages required" } });

  const analysis = orchestrator.analyzeTask(messages);
  res.json(analysis);
});

router.post("/v1/orchestrate/chain", async (req: Request, res: Response) => {
  try {
    const { steps, messages, userId } = req.body;
    if (!steps?.length || !messages?.length) {
      return res.status(400).json({ error: { message: "steps and messages required" } });
    }
    const result = await orchestrator.executeChain(steps, messages, userId);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: { message: error.message } });
  }
});

router.post("/v1/orchestrate/ensemble", async (req: Request, res: Response) => {
  try {
    const { config, messages, userId } = req.body;
    if (!config?.models?.length || !messages?.length) {
      return res.status(400).json({ error: { message: "config.models and messages required" } });
    }
    const result = await orchestrator.executeEnsemble(config, messages, userId);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: { message: error.message } });
  }
});

router.post("/v1/orchestrate/smart", async (req: Request, res: Response) => {
  try {
    const { messages, constraints } = req.body;
    if (!messages?.length) return res.status(400).json({ error: { message: "messages required" } });

    const bestModel = await orchestrator.selectBestModel(messages, constraints);
    const provider = providerRegistry.getProviderForModel(bestModel.model);
    if (!provider) return res.status(500).json({ error: { message: "No provider available" } });

    const result = await provider.complete({ model: bestModel.model, messages, temperature: 0.7, maxTokens: 4096 });
    res.json({ ...formatCompletionResponse(result, bestModel.model), _routing: bestModel });
  } catch (error: any) {
    res.status(500).json({ error: { message: error.message } });
  }
});

// ===== Pipeline Stats =====

router.get("/v1/pipeline/stats", (_req: Request, res: Response) => {
  res.json({
    pipeline: pipelineOptimizer.getStats(),
    streaming: streamEngine.getStats(),
  });
});

// ===== Helpers =====

function formatCompletionResponse(result: any, model: string): Record<string, unknown> {
  return {
    id: `chatcmpl-${result.id || Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: result.content,
        ...(result.toolCalls && { tool_calls: result.toolCalls }),
      },
      finish_reason: result.finishReason || "stop",
    }],
    usage: {
      prompt_tokens: result.usage?.promptTokens || 0,
      completion_tokens: result.usage?.completionTokens || 0,
      total_tokens: result.usage?.totalTokens || 0,
    },
    _provider: result.provider,
    _latency_ms: result.latencyMs,
    _cached: result.cached,
  };
}

function formatSSEChunk(event: StreamEvent, model: string, requestId: string): Record<string, unknown> | null {
  switch (event.type) {
    case "token":
      return {
        id: requestId, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model,
        choices: [{ index: 0, delta: { content: event.content }, finish_reason: null }],
      };
    case "tool_call":
      return {
        id: requestId, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model,
        choices: [{ index: 0, delta: { tool_calls: [event.toolCall] }, finish_reason: null }],
      };
    case "done":
      return {
        id: requestId, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model,
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        ...(event.usage && { usage: { prompt_tokens: event.usage.promptTokens, completion_tokens: event.usage.completionTokens, total_tokens: event.usage.totalTokens } }),
      };
    default:
      return null;
  }
}

export default router;
