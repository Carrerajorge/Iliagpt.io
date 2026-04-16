import { z } from "zod";
import { DialogueActionSchema, ErrorCodeSchema, DialogueStateSchema } from "./dialogueManager";

export const ChatRequestSchema = z.object({
  request_id: z.string().uuid(),
  session_id: z.string(),
  user_id: z.string().optional(),
  message: z.string().min(1).max(50000),
  client_ts: z.number(),
  channel: z.enum(["web", "api", "mobile", "widget"]).default("web"),
  attachments: z.array(z.object({
    id: z.string(),
    name: z.string(),
    mimeType: z.string(),
    size: z.number().optional()
  })).optional(),
  context: z.object({
    chatId: z.string().optional(),
    gptId: z.string().optional(),
    model: z.string().optional(),
    temperature: z.number().min(0).max(2).optional()
  }).optional(),
  options: z.object({
    streaming: z.boolean().default(true),
    enableAgent: z.boolean().default(true),
    maxTokens: z.number().optional(),
    language: z.enum(["es", "en", "auto"]).default("auto")
  }).optional()
});
export type ChatRequest = z.infer<typeof ChatRequestSchema>;

export const EntitySchema = z.object({
  type: z.string(),
  value: z.string(),
  confidence: z.number().min(0).max(1),
  start: z.number().optional(),
  end: z.number().optional()
});
export type Entity = z.infer<typeof EntitySchema>;

export const SourceSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string().optional(),
  snippet: z.string().optional(),
  score: z.number().min(0).max(1),
  updated_at: z.string().optional(),
  type: z.enum(["kb", "web", "academic", "document"]).optional()
});
export type Source = z.infer<typeof SourceSchema>;

export const LatencyBreakdownSchema = z.object({
  preprocess: z.number().nullable(),
  nlu: z.number().nullable(),
  retrieval: z.number().nullable(),
  rerank: z.number().nullable(),
  generation: z.number().nullable(),
  postprocess: z.number().nullable(),
  total: z.number()
});
export type LatencyBreakdown = z.infer<typeof LatencyBreakdownSchema>;

export const ChatResponseSchema = z.object({
  request_id: z.string(),
  session_id: z.string(),
  state: DialogueStateSchema,
  message: z.string(),
  intent: z.string().optional(),
  intent_confidence: z.number().min(0).max(1).optional(),
  entities: z.array(EntitySchema).optional(),
  confidence: z.number().min(0).max(1),
  action: DialogueActionSchema,
  sources: z.array(SourceSchema).optional(),
  latency_ms: LatencyBreakdownSchema,
  model_version: z.string(),
  provider: z.enum(["xai", "gemini", "anthropic"]).optional(),
  error_code: ErrorCodeSchema,
  retryable: z.boolean(),
  metadata: z.object({
    tokens_used: z.object({
      prompt: z.number(),
      completion: z.number(),
      total: z.number()
    }).optional(),
    cached: z.boolean().optional(),
    from_fallback: z.boolean().optional(),
    clarification_attempt: z.number().optional(),
    degraded_mode: z.boolean().optional()
  }).optional()
});
export type ChatResponse = z.infer<typeof ChatResponseSchema>;

export const StreamChunkSchema = z.object({
  request_id: z.string(),
  sequence_id: z.number(),
  type: z.enum(["content", "status", "error", "done", "sources", "metadata"]),
  content: z.string().optional(),
  state: DialogueStateSchema.optional(),
  sources: z.array(SourceSchema).optional(),
  latency_ms: LatencyBreakdownSchema.optional(),
  error_code: ErrorCodeSchema.optional(),
  done: z.boolean().default(false)
});
export type StreamChunk = z.infer<typeof StreamChunkSchema>;

export class ChatResponseBuilder {
  private response: Partial<ChatResponse>;

  constructor(requestId: string, sessionId: string) {
    this.response = {
      request_id: requestId,
      session_id: sessionId,
      state: "idle",
      message: "",
      confidence: 0,
      action: "ANSWER",
      error_code: "NONE",
      retryable: false,
      latency_ms: {
        preprocess: null,
        nlu: null,
        retrieval: null,
        rerank: null,
        generation: null,
        postprocess: null,
        total: 0
      },
      model_version: "unknown"
    };
  }

  setState(state: z.infer<typeof DialogueStateSchema>): this {
    this.response.state = state;
    return this;
  }

  setMessage(message: string): this {
    this.response.message = message;
    return this;
  }

  setIntent(intent: string, confidence: number): this {
    this.response.intent = intent;
    this.response.intent_confidence = confidence;
    this.response.confidence = confidence;
    return this;
  }

  setEntities(entities: Entity[]): this {
    this.response.entities = entities;
    return this;
  }

  setAction(action: z.infer<typeof DialogueActionSchema>): this {
    this.response.action = action;
    return this;
  }

  setSources(sources: Source[]): this {
    this.response.sources = sources;
    return this;
  }

  setLatency(latency: LatencyBreakdown): this {
    this.response.latency_ms = latency;
    return this;
  }

  setModel(version: string, provider?: "xai" | "gemini" | "anthropic"): this {
    this.response.model_version = version;
    if (provider) this.response.provider = provider;
    return this;
  }

  setError(errorCode: z.infer<typeof ErrorCodeSchema>, retryable: boolean = false): this {
    this.response.error_code = errorCode;
    this.response.retryable = retryable;
    return this;
  }

  setMetadata(metadata: NonNullable<ChatResponse["metadata"]>): this {
    this.response.metadata = metadata;
    return this;
  }

  build(): ChatResponse {
    return ChatResponseSchema.parse(this.response);
  }

  buildPartial(): Partial<ChatResponse> {
    return { ...this.response };
  }
}

export function createErrorResponse(
  requestId: string,
  sessionId: string,
  errorCode: z.infer<typeof ErrorCodeSchema>,
  message: string,
  totalLatencyMs: number
): ChatResponse {
  const retryable = ["UPSTREAM_429", "UPSTREAM_5XX", "CIRCUIT_OPEN", "RATE_LIMITED"].includes(errorCode);
  
  const action: z.infer<typeof DialogueActionSchema> = retryable 
    ? "RETRY_SUGGESTION" 
    : errorCode === "LOW_CONFIDENCE" || errorCode === "GARBAGE_INPUT"
      ? "ASK_CLARIFICATION"
      : "FALLBACK_GENERIC";

  return new ChatResponseBuilder(requestId, sessionId)
    .setState("error_degraded")
    .setMessage(message)
    .setAction(action)
    .setError(errorCode, retryable)
    .setLatency({
      preprocess: null,
      nlu: null,
      retrieval: null,
      rerank: null,
      generation: null,
      postprocess: null,
      total: totalLatencyMs
    })
    .setModel("fallback")
    .build();
}

export function createTimeoutResponse(
  requestId: string,
  sessionId: string,
  stage: string,
  totalLatencyMs: number
): ChatResponse {
  const errorCode = `TIMEOUT_${stage.toUpperCase()}` as z.infer<typeof ErrorCodeSchema>;
  const validErrorCode = ErrorCodeSchema.safeParse(errorCode).success 
    ? errorCode 
    : "TIMEOUT_GENERATION";

  return new ChatResponseBuilder(requestId, sessionId)
    .setState("timeout")
    .setMessage("La solicitud tard\u00f3 demasiado. Por favor, intenta de nuevo con una pregunta m\u00e1s simple.")
    .setAction("DEGRADED_TIMEOUT")
    .setError(validErrorCode, true)
    .setLatency({
      preprocess: null,
      nlu: null,
      retrieval: null,
      rerank: null,
      generation: null,
      postprocess: null,
      total: totalLatencyMs
    })
    .setModel("timeout-fallback")
    .build();
}

export function createClarificationResponse(
  requestId: string,
  sessionId: string,
  question: string,
  confidence: number,
  attempt: number,
  totalLatencyMs: number
): ChatResponse {
  return new ChatResponseBuilder(requestId, sessionId)
    .setState("clarifying")
    .setMessage(question)
    .setIntent("clarification", confidence)
    .setAction("ASK_CLARIFICATION")
    .setError("NONE")
    .setLatency({
      preprocess: null,
      nlu: null,
      retrieval: null,
      rerank: null,
      generation: null,
      postprocess: null,
      total: totalLatencyMs
    })
    .setModel("clarification-engine")
    .setMetadata({ clarification_attempt: attempt })
    .build();
}

export function validateRequest(data: unknown): { valid: true; request: ChatRequest } | { valid: false; errors: string[] } {
  const result = ChatRequestSchema.safeParse(data);
  if (result.success) {
    return { valid: true, request: result.data };
  }
  return {
    valid: false,
    errors: result.error.errors.map(e => `${e.path.join(".")}: ${e.message}`)
  };
}
