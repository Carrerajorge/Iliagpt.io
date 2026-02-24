import { Response } from "express";
import { randomUUID } from "crypto";
import { eq, and, desc } from "drizzle-orm";
import { agentEventBus } from "./eventBus";
import { createRequestSpec, detectIntent, AttachmentSpecSchema, SessionStateSchema, RequestSpecSchema } from "./requestSpec";
import type { z } from "zod";
import { AgentTask } from "./contracts";

type RequestSpec = z.infer<typeof RequestSpecSchema>;
type AttachmentSpec = z.infer<typeof AttachmentSpecSchema>;
type SessionState = z.infer<typeof SessionStateSchema>;
import { storage } from "../storage";
import { db } from "../db";
import { agentModeRuns, agentModeSteps, agentMemoryStore, requestSpecHistory, chats } from "@shared/schema";
import { llmGateway } from "../lib/llmGateway";
import type { TraceEventType } from "@shared/schema";
import { executeAgentLoop } from "./agentExecutor";
import { agentManager } from "./agentOrchestrator";
import { routeAgentRequest } from "./agentRouter";
import { buildNativeAgenticFusion, hasNativeAgenticSignal } from "./nativeAgenticFusion";

// ============================================================================
// Latency Mode types
// ============================================================================
export type LatencyMode = 'fast' | 'deep' | 'auto';

export interface UnifiedChatRequest {
  messages: Array<{ role: string; content: string }>;
  chatId: string;
  userId: string;
  runId?: string;
  messageId?: string;
  attachments?: AttachmentSpec[];
  sessionState?: SessionState;
  latencyMode?: LatencyMode;
  accessLevel?: 'owner' | 'trusted' | 'unknown';
  agentTask?: AgentTask; // Opcional: inyección estricta del contrato de tarea
}

export interface UnifiedChatContext {
  requestSpec: RequestSpec;
  runId: string;
  startTime: number;
  isAgenticMode: boolean;
  latencyMode: LatencyMode;
  resolvedLane: 'fast' | 'deep';
  accessLevel: 'owner' | 'trusted' | 'unknown';
  agentTask?: AgentTask;
}

// ============================================================================
// SSE Buffered Writer — batches small deltas into ~30ms flushes
// ============================================================================
export class SseBufferedWriter {
  private buffer = '';
  private timer: ReturnType<typeof setTimeout> | null = null;
  private seq = 0;
  private closed = false;

  constructor(
    private res: Response,
    private runId: string,
    private flushIntervalMs = 30,
    private maxBufferBytes = 512,
  ) { }

  /** True when the underlying response can no longer accept writes. */
  private get isWritable(): boolean {
    if (this.closed) return false;
    // Express/Node responses expose `writableEnded` or `destroyed`
    const r = this.res as any;
    if (r.writableEnded || r.destroyed || r.closed) return false;
    return true;
  }

  /** Write a chunk delta. Batched and flushed on interval or size threshold. */
  pushDelta(content: string): void {
    if (!this.isWritable) return;
    this.buffer += content;

    // Approximate byte length (UTF-8: most chars are 1 byte, some up to 4)
    if (this.buffer.length >= this.maxBufferBytes) {
      this.flush();
      return;
    }

    if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.flush();
      }, this.flushIntervalMs);
    }
  }

  /** Force-flush any buffered content immediately. */
  flush(): void {
    this.clearTimer();
    if (this.buffer.length === 0 || !this.isWritable) return;

    this.seq++;

    const streamMeta = (this.res as any)?.locals?.streamMeta;
    const requestId = typeof streamMeta?.requestId === "string" ? streamMeta.requestId : undefined;
    const conversationId = typeof streamMeta?.conversationId === "string" ? streamMeta.conversationId : undefined;

    writeSse(this.res, 'chunk', {
      content: this.buffer,
      sequence: this.seq,
      runId: this.runId,
      timestamp: Date.now(),
      ...(requestId ? { requestId } : {}),
      ...(conversationId ? { conversationId } : {}),
    });

    if (typeof streamMeta?.onWrite === "function") {
      try {
        streamMeta.onWrite();
      } catch (observerError) {
        console.warn("[UnifiedChat] streamMeta.onWrite failed:", observerError);
      }
    }

    this.buffer = '';
  }

  /** Flush remaining buffer and return total chunks written. */
  finalize(): number {
    this.flush();
    this.closed = true;
    this.clearTimer(); // safety: ensure no dangling timer
    return this.seq;
  }

  /** Cancel any pending flush timer (idempotent). */
  destroy(): void {
    this.closed = true;
    this.clearTimer();
    this.buffer = '';
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  get sequenceCount(): number {
    return this.seq;
  }
}

// ============================================================================
// Resolve which lane (fast/deep) a request should use
// ============================================================================
export function resolveLatencyLane(
  latencyMode: LatencyMode,
  requestSpec: RequestSpec,
  hasAttachments: boolean,
): 'fast' | 'deep' {
  if (latencyMode === 'fast') return 'fast';
  if (latencyMode === 'deep') return 'deep';

  // auto: decide based on intent & complexity signals
  const heavyIntents = ['research', 'document_generation', 'data_analysis', 'code_generation',
    'presentation_creation', 'spreadsheet_creation', 'multi_step_task', 'web_automation'];

  if (heavyIntents.includes(requestSpec.intent)) return 'deep';
  if (hasAttachments) return 'deep';
  if (requestSpec.intentConfidence > 0.7 && requestSpec.intent !== 'chat') return 'deep';

  return 'fast';
}

function writeSse(res: Response, event: string, data: object): boolean {
  try {
    // Guard: don't write to a destroyed or finished response
    const r = res as any;
    if (r.writableEnded || r.destroyed) return false;

    const streamMeta = r?.locals?.streamMeta;
    const assistantMessageId = streamMeta?.assistantMessageId ||
      (typeof streamMeta?.getAssistantMessageId === "function" ? streamMeta.getAssistantMessageId() : undefined);

    const enrichedPayload: Record<string, unknown> = {
      ...(data as Record<string, unknown>),
    };

    if (!enrichedPayload.conversationId && streamMeta?.conversationId) {
      enrichedPayload.conversationId = streamMeta.conversationId;
    }
    if (!enrichedPayload.requestId && streamMeta?.requestId) {
      enrichedPayload.requestId = streamMeta.requestId;
    }
    if (!enrichedPayload.assistantMessageId && assistantMessageId) {
      enrichedPayload.assistantMessageId = assistantMessageId;
    }

    const chunk = `event: ${event}\ndata: ${JSON.stringify(enrichedPayload)}\n\n`;
    res.write(chunk);
    if (typeof (r).flush === 'function') {
      (r).flush();
    }
    return true;
  } catch (err) {
    console.error('[UnifiedChat] SSE write failed:', err);
    return false;
  }
}

export async function hydrateSessionState(chatId: string, userId: string): Promise<SessionState | undefined> {
  try {
    const [allMessages, memoryRecords, previousSpecs] = await Promise.all([
      storage.getChatMessages(chatId).then(msgs => msgs.slice(-50)), // Increased from 10 to 50
      db.select().from(agentMemoryStore)
        .where(and(
          eq(agentMemoryStore.chatId, chatId),
          eq(agentMemoryStore.userId, userId)
        ))
        .orderBy(desc(agentMemoryStore.updatedAt))
        .limit(20),
      db.select().from(requestSpecHistory)
        .where(eq(requestSpecHistory.chatId, chatId))
        .orderBy(desc(requestSpecHistory.createdAt))
        .limit(5)
    ]);

    if (allMessages.length === 0 && memoryRecords.length === 0) {
      return undefined;
    }

    const previousIntents = previousSpecs.length > 0
      ? previousSpecs.map(spec => spec.intent as NonNullable<SessionState["previousIntents"]>[number])
      : allMessages
        .filter(m => m.role === 'user')
        .slice(0, 5)
        .map(m => detectIntent(m.content).intent as NonNullable<SessionState["previousIntents"]>[number]);

    const previousDeliverables = previousSpecs
      .filter(spec => spec.deliverableType && spec.status === 'completed')
      .map(spec => spec.deliverableType as string);

    const workingContext: Record<string, unknown> = {};
    const memoryKeys: string[] = [];

    for (const record of memoryRecords) {
      memoryKeys.push(record.memoryKey);
      if (record.memoryType === 'context' || record.memoryType === 'fact') {
        workingContext[record.memoryKey] = record.memoryValue;
      }
    }

    console.log(`[UnifiedChat] Hydrated session: ${memoryRecords.length} memory keys, ${previousSpecs.length} previous specs`);

    return {
      conversationId: chatId,
      turnNumber: allMessages.length,
      previousIntents,
      previousDeliverables,
      workingContext,
      memoryKeys,
      lastUpdated: new Date()
    };
  } catch (error) {
    console.error('[UnifiedChat] Failed to hydrate session state:', error);
    return undefined;
  }
}

export async function persistRequestSpec(
  context: UnifiedChatContext,
  status: 'pending' | 'completed' | 'failed',
  durationMs?: number
): Promise<void> {
  try {
    await db.insert(requestSpecHistory).values({
      chatId: context.requestSpec.chatId,
      runId: context.runId,
      messageId: context.requestSpec.messageId,
      intent: context.requestSpec.intent,
      intentConfidence: context.requestSpec.intentConfidence,
      deliverableType: context.requestSpec.deliverableType,
      primaryAgent: context.requestSpec.primaryAgent,
      targetAgents: context.requestSpec.targetAgents,
      attachmentsCount: context.requestSpec.attachments.length,
      executionDurationMs: durationMs,
      status
    });
    console.log(`[UnifiedChat] Persisted RequestSpec for run ${context.runId}`);
  } catch (error) {
    console.error('[UnifiedChat] Failed to persist RequestSpec:', error);
  }
}

export async function storeMemory(
  chatId: string,
  userId: string,
  key: string,
  value: unknown,
  type: 'context' | 'fact' | 'preference' | 'artifact_ref' = 'context'
): Promise<void> {
  try {
    const existing = await db.select()
      .from(agentMemoryStore)
      .where(and(
        eq(agentMemoryStore.chatId, chatId),
        eq(agentMemoryStore.userId, userId),
        eq(agentMemoryStore.memoryKey, key)
      ))
      .limit(1);

    if (existing.length > 0) {
      await db.update(agentMemoryStore)
        .set({
          memoryValue: value,
          memoryType: type,
          updatedAt: new Date()
        })
        .where(and(
          eq(agentMemoryStore.id, existing[0].id),
          eq(agentMemoryStore.userId, userId)
        ));
    } else {
      await db.insert(agentMemoryStore).values({
        chatId,
        userId,
        memoryKey: key,
        memoryValue: value,
        memoryType: type,
      });
    }
  } catch (error) {
    console.error(`[UnifiedChat] Failed to store memory key ${key}:`, error);
  }
}

export async function createUnifiedRun(
  request: UnifiedChatRequest
): Promise<UnifiedChatContext> {
  const startTime = Date.now();

  const sessionState = request.sessionState ||
    await hydrateSessionState(request.chatId, request.userId);

  const lastUserMessage = [...request.messages]
    .reverse()
    .find(m => m.role === 'user')?.content || '';

  // agent_mode_runs.message_id + request_spec_history.message_id both FK to chat_messages.id (UUID).
  // Some callers historically passed provisional ids like "msg_<timestamp>".
  // Normalize to avoid FK violations (best-effort logging only; chat should still work).
  const isUuid = (value?: string) => !!value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  const normalizedMessageId = isUuid(request.messageId) ? request.messageId : undefined;

  const requestSpec = await routeAgentRequest({
    rawMessage: lastUserMessage,
    attachments: request.attachments,
    sessionState,
    conversationHistory: request.messages,
    userId: request.userId,
    chatId: request.chatId,
    messageId: normalizedMessageId,
  });

  const runId = request.runId || randomUUID();

  const latencyMode: LatencyMode = request.latencyMode || 'auto';

  const hasAttachments = !!(request.attachments && request.attachments.length > 0);
  const hasAgenticSignal = hasNativeAgenticSignal(lastUserMessage);
  const isAgenticMode: boolean =
    latencyMode !== 'fast' && (
      requestSpec.intent !== 'chat' ||
      requestSpec.intentConfidence > 0.7 ||
      hasAttachments ||
      hasAgenticSignal
    );

  let resolvedLane = resolveLatencyLane(
    latencyMode,
    requestSpec,
    hasAttachments,
  );
  if (latencyMode === "auto" && hasAgenticSignal) {
    resolvedLane = "deep";
  }

  try {
    // Ensure the chat exists before persisting agent runs (FK: agent_mode_runs.chat_id -> chats.id).
    // The UI sometimes generates provisional chat ids (e.g. "chat_<timestamp>") before it has
    // created the chat via POST /api/chats. We upsert a minimal chat row to avoid FK violations.
    await db.insert(chats).values({
      id: request.chatId,
      userId: request.userId,
      title: 'New Chat',
    }).onConflictDoNothing();

    await db.insert(agentModeRuns).values({
      id: runId,
      chatId: request.chatId,
      messageId: normalizedMessageId,
      userId: request.userId,
      status: 'planning',
      idempotencyKey: requestSpec.id,
    }).onConflictDoNothing();
  } catch (error) {
    console.error('[UnifiedChat] Failed to persist run:', error);
  }

  console.log(
    `[UnifiedChat] Created run ${runId} - intent: ${requestSpec.intent}, agentic: ${isAgenticMode}, lane: ${resolvedLane}, nativeSignal: ${hasAgenticSignal}`,
  );

  return {
    requestSpec,
    runId,
    startTime,
    isAgenticMode,
    latencyMode: resolvedLane,
    resolvedLane,
    accessLevel: request.accessLevel || 'owner',
    agentTask: request.agentTask,
  };
}

export async function emitTraceEvent(
  runId: string,
  eventType: TraceEventType,
  data: Record<string, any> = {}
): Promise<void> {
  try {
    await agentEventBus.emit(runId, eventType, data);
  } catch (error) {
    console.error(`[UnifiedChat] Failed to emit ${eventType}:`, error);
  }
}

export async function executeUnifiedChat(
  context: UnifiedChatContext,
  request: UnifiedChatRequest,
  res: Response,
  options: {
    onChunk?: (chunk: string) => void;
    disableImageGeneration?: boolean;
    systemPrompt?: string;
  } = {}
): Promise<void> {
  const { requestSpec, runId, isAgenticMode, resolvedLane } = context;

  // Guard: chatAiRouter already opens SSE early for low-TTFT.
  // Only set headers if they haven't been sent yet.
  if (!res.headersSent) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Transfer-Encoding", "chunked");
    res.setHeader("X-Accel-Buffering", "no");
    res.setHeader("X-Run-Id", runId);
    res.setHeader("X-Intent", requestSpec.intent);
    res.setHeader("X-Agentic-Mode", String(isAgenticMode));
    res.setHeader("X-Latency-Lane", resolvedLane);
    res.flushHeaders();
  }

  // Handle WhatsApp-style confirmations: user replies with CONFIRM or CANCEL
  const lastUserMessage = [...request.messages].reverse().find(m => m.role === 'user')?.content || '';
  const decision = lastUserMessage.trim().toUpperCase();
  if (decision === 'CONFIRM' || decision === 'CANCEL') {
    const [pendingRun] = await db.select()
      .from(agentModeRuns)
      .where(and(eq(agentModeRuns.chatId, request.chatId), eq(agentModeRuns.status, 'awaiting_confirmation')))
      .orderBy(desc(agentModeRuns.createdAt))
      .limit(1);

    if (pendingRun) {
      if (decision === 'CANCEL') {
        await (agentManager as any).cancelPendingConfirmation?.(pendingRun.id);
        writeSse(res, 'confirmation', { runId: pendingRun.id, decision: 'CANCEL', status: 'cancelled' });
      } else {
        await (agentManager as any).confirmRun?.(pendingRun.id);
        writeSse(res, 'confirmation', { runId: pendingRun.id, decision: 'CONFIRM', status: 'running' });
      }
      res.end();
      return;
    }
  }

  await emitTraceEvent(runId, 'task_start', {
    metadata: {
      intent: requestSpec.intent,
      intentConfidence: requestSpec.intentConfidence,
      deliverableType: requestSpec.deliverableType,
      targetAgents: requestSpec.targetAgents,
      attachmentsCount: requestSpec.attachments.length,
      isAgenticMode
    }
  });

  if (requestSpec.sessionState) {
    await emitTraceEvent(runId, 'memory_loaded', {
      memory: {
        keys: requestSpec.sessionState.memoryKeys,
        loaded: requestSpec.sessionState.turnNumber
      }
    });
  }

  // Helper: true when the response socket is no longer usable
  const isResponseDead = () => {
    const r = res as any;
    return !!(r.writableEnded || r.destroyed);
  };

  writeSse(res, 'start', {
    runId,
    intent: requestSpec.intent,
    deliverableType: requestSpec.deliverableType,
    isAgenticMode,
    latencyLane: resolvedLane,
    timestamp: Date.now()
  });

  if (isAgenticMode && !isResponseDead()) {
    // Emit thinking event immediately so TTFT is low even for heavy pipelines
    writeSse(res, 'thinking', {
      step: 'planning',
      message: 'Analizando solicitud...',
      runId,
      timestamp: Date.now(),
    });

    await emitTraceEvent(runId, 'thinking', {
      content: `Analyzing request: ${requestSpec.intent}`,
      phase: 'planning'
    });

    await emitTraceEvent(runId, 'agent_delegated', {
      agent: {
        name: requestSpec.primaryAgent,
        role: 'primary',
        status: 'active'
      }
    });
  }

  // Hoisted so the catch block can destroy it on error
  let activeWriter: SseBufferedWriter | null = null;

  try {
    const nativeFusion = await buildNativeAgenticFusion({
      userId: request.userId,
      chatId: request.chatId,
      message: lastUserMessage,
    });
    if (nativeFusion.appliedModules.length > 0) {
      writeSse(res, "thinking", {
        step: "native_agentic_fusion",
        message: `Fusion nativa activa: ${nativeFusion.appliedModules.join(", ")}`,
        runId,
        timestamp: Date.now(),
      });

      await emitTraceEvent(runId, "thinking", {
        content: "Native agentic fusion context attached",
        phase: "fusion",
        modules: nativeFusion.appliedModules,
      });
    }

    const systemContent =
      (options.systemPrompt || buildSystemPrompt(requestSpec)) + nativeFusion.promptAddendum;

    // In fast lane, cap maxTokens for quick responses
    const fastLaneMaxTokens = resolvedLane === 'fast' ? 400 : undefined;

    const formattedMessages = [
      { role: "system" as const, content: systemContent },
      ...request.messages.map(m => ({
        role: m.role as "user" | "assistant" | "system",
        content: m.content
      }))
    ];

    let fullResponse = '';
    let chunkCount = 0;

    if (isAgenticMode) {
      await executeAgentLoop(formattedMessages, res, {
        runId,
        userId: request.userId,
        chatId: request.chatId,
        requestSpec,
        maxIterations: 10,
        accessLevel: context.accessLevel
      });

      await emitTraceEvent(runId, 'done', {
        summary: 'Agent execution completed',
        durationMs: Date.now() - context.startTime,
        phase: 'completed'
      });

      writeSse(res, 'done', {
        runId,
        totalChunks: 0,
        durationMs: Date.now() - context.startTime,
        intent: requestSpec.intent,
        isAgenticMode: true,
        latencyLane: resolvedLane,
        timestamp: Date.now()
      });
    } else {
      // Use buffered writer to batch small deltas (~30ms intervals)
      const writer = new SseBufferedWriter(res, runId);
      activeWriter = writer;

      const streamGenerator = llmGateway.streamChat(formattedMessages, {
        userId: request.userId,
        requestId: runId,
        disableImageGeneration: options.disableImageGeneration,
        ...(fastLaneMaxTokens ? { maxTokens: fastLaneMaxTokens } : {}),
      });

      for await (const chunk of streamGenerator) {
        if (chunk.content) {
          fullResponse += chunk.content;
          chunkCount++;

          writer.pushDelta(chunk.content);

          if (options.onChunk) {
            options.onChunk(chunk.content);
          }

          if (chunkCount % 50 === 0) {
            await emitTraceEvent(runId, 'progress_update', {
              progress: {
                current: chunkCount,
                total: 0,
                message: 'Generating response...'
              }
            });
          }
        }
        if (chunk.done) {
          break;
        }
      }

      // Flush any remaining buffered content
      writer.finalize();

      await emitTraceEvent(runId, 'done', {
        summary: fullResponse.slice(0, 200),
        durationMs: Date.now() - context.startTime,
        phase: 'completed'
      });

      writeSse(res, 'done', {
        runId,
        totalChunks: writer.sequenceCount,
        durationMs: Date.now() - context.startTime,
        intent: requestSpec.intent,
        latencyLane: resolvedLane,
        timestamp: Date.now()
      });
    }

    const memoryKeys = ['last_intent', 'last_deliverable'];
    const finalDurationMs = Date.now() - context.startTime;
    await Promise.all([
      db.update(agentModeRuns)
        .set({ status: 'completed' })
        .where(eq(agentModeRuns.id, runId))
        .catch(err => console.error('[UnifiedChat] Failed to update run status:', err)),
      persistRequestSpec(context, 'completed', finalDurationMs),
      storeMemory(request.chatId, request.userId, 'last_intent', requestSpec.intent, 'context'),
      storeMemory(request.chatId, request.userId, 'last_deliverable', requestSpec.deliverableType || 'none', 'context'),
    ]).catch(() => { });

    await emitTraceEvent(runId, 'memory_saved', {
      memory: {
        keys: memoryKeys,
        saved: memoryKeys.length,
        chatId: request.chatId
      }
    }).catch(() => { });

  } catch (error: any) {
    // Destroy any active buffered writer to cancel pending timers
    activeWriter?.destroy();

    console.error(`[UnifiedChat] Execution error:`, error);

    await emitTraceEvent(runId, 'error', {
      error: {
        code: 'EXECUTION_ERROR',
        message: error.message,
        retryable: true
      }
    });

    writeSse(res, 'error', {
      runId,
      message: error.message,
      code: 'EXECUTION_ERROR',
      timestamp: Date.now()
    });

    const durationMs = Date.now() - context.startTime;
    await Promise.all([
      db.update(agentModeRuns)
        .set({ status: 'failed' })
        .where(eq(agentModeRuns.id, runId))
        .catch(err => console.error('[UnifiedChat] Failed to update run status:', err)),
      persistRequestSpec(context, 'failed', durationMs),
    ]).catch(() => { });
  }

  // Guard: don't call end() if the response is already finished
  if (!(res as any).writableEnded) {
    res.end();
  }
}

function buildSystemPrompt(requestSpec: RequestSpec): string {
  let prompt = `Eres un asistente de IA avanzado. `;

  switch (requestSpec.intent) {
    case 'research':
      prompt += `Tu tarea es investigar y proporcionar información precisa y bien fundamentada. Incluye fuentes cuando sea posible.`;
      break;
    case 'document_analysis':
      prompt += `Analiza los documentos adjuntos de forma exhaustiva. Extrae información clave, identifica patrones y proporciona insights.`;
      break;
    case 'document_generation':
      prompt += `Genera documentos profesionales y bien estructurados según las instrucciones del usuario.`;
      break;
    case 'data_analysis':
      prompt += `Analiza datos de forma rigurosa. Proporciona estadísticas, tendencias y visualizaciones cuando sea apropiado.`;
      break;
    case 'code_generation':
      prompt += `Escribe código limpio, eficiente y bien documentado. Sigue las mejores prácticas del lenguaje.`;
      break;
    case 'presentation_creation':
      prompt += `Crea presentaciones profesionales con estructura clara, puntos clave concisos y diseño visual atractivo.`;
      break;
    case 'spreadsheet_creation':
      prompt += `Crea hojas de cálculo bien organizadas con fórmulas apropiadas y formato profesional.`;
      break;
    default:
      prompt += `Responde de manera útil y profesional en el idioma del usuario.`;
  }

  if (requestSpec.attachments.length > 0) {
    prompt += `\n\nEl usuario ha proporcionado ${requestSpec.attachments.length} archivo(s). Analiza su contenido cuidadosamente.`;
  }

  if (requestSpec.sessionState && requestSpec.sessionState.turnNumber > 1) {
    prompt += `\n\nEsta es una conversación en curso (turno ${requestSpec.sessionState.turnNumber}). Mantén coherencia con el contexto previo.`;
  }

  return prompt;
}

export { RequestSpec, AttachmentSpec, SessionState };
