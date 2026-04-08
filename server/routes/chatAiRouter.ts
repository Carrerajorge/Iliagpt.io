import { Router } from "express";
import { storage } from "../storage";
import { chatService, AVAILABLE_MODELS, DEFAULT_PROVIDER, DEFAULT_MODEL } from "../services/ChatServiceV2";
import { llmGateway } from "../lib/llmGateway";
import { applySseSecurityHeaders } from "../lib/sseSecurityHeaders";
import { getOrCreateSession, getEnforcedModel, getSessionById, type GptSessionContract } from "../services/gptSessionService";
import { generateImage, detectImageRequest, extractImagePrompt } from "../services/imageGeneration";
import { generateVideo, detectVideoRequest, extractVideoPrompt } from "../services/videoGeneration";
import { runETLAgent, getAvailableCountries, getAvailableIndicators } from "../etl";
import { extractAllAttachmentsContent, extractAttachmentContent, formatAttachmentsAsContext, type Attachment } from "../services/attachmentService";
import { pareOrchestrator, type RobustRouteResult, type SimpleAttachment } from "../services/pare";
import { DocumentBatchProcessor, type BatchProcessingResult, type SimpleAttachment as BatchAttachment } from "../services/documentBatchProcessor";
import { pareRequestContract, pareRateLimiter, pareQuotaGuard, requirePareContext, pareIdempotencyGuard, pareAnalyzeSchemaValidator } from "../middleware";
import { completeIdempotencyKey, failIdempotencyKey } from "../lib/idempotencyStore";
import { createPareLogger, type PareLogger } from "../lib/pareLogger";
import { pareMetrics } from "../lib/pareMetrics";
import { AuditTrailCollector, type AuditBatchSummary } from "../lib/pareAuditTrail";
import { createChunkStore } from "../lib/pareChunkStore";
import { normalizeDocument } from "../services/structuredDocumentNormalizer";
import { ObjectStorageService } from "../replit_integrations/object_storage/objectStorage";
import type { DocumentSemanticModel, Table, Metric, Anomaly, Insight, SuggestedQuestion, SheetSummary } from "../../shared/schemas/documentSemanticModel";
import { agentEventBus } from "../agent/eventBus";
import { createUnifiedRun, hydrateSessionState, emitTraceEvent, SseBufferedWriter, resolveLatencyLane } from "../agent/unifiedChatHandler";
import type { UnifiedChatRequest, UnifiedChatContext, LatencyMode } from "../agent/unifiedChatHandler";
import { createRequestSpec, AttachmentSpecSchema } from "../agent/requestSpec";
import { streamAgentRuntime } from "../agent/runtime/agentRuntimeFacade";
import { routeIntent, type IntentResult } from "../services/intentRouter";
import { questionClassifier, type QuestionClassification } from "../services/questionClassifier";
import { answerFirstEnforcer } from "../services/answerFirstEnforcer";
import { academicSearchService } from "../services/academicSearchService";
import { isProductionIntent, handleProductionRequest, getDeliverables } from "../services/productionHandler";
import type { z } from "zod";
import { getUserId } from "../types/express";
import { semanticMemoryStore } from "../memory/SemanticMemoryStore";
import { type SkillScope } from "@shared/schema/skillPlatform";
import { MAX_CHAT_ATTACHMENT_SIZE_BYTES } from "@shared/chatLimits";
import { buildAssistantMessage, buildAssistantMessageMetadata } from "@shared/assistantMessage";
import { buildFollowUpSuggestions } from "@shared/followUpSuggestions";
import { handleEmailChatRequest } from "../services/gmailChatIntegration";
import { getOrCreateSecureUserId } from "../lib/anonUserHelper";
import { FREE_MODEL_ID, isModelFreeForAll } from "../lib/modelRegistry";
import { ensureUserRowExists } from "../lib/ensureUserRowExists";
import { buildSkillSystemPromptSection, drizzleSkillStore, resolveSkillContextFromRequest } from "../services/skillContextResolver";
import { getSkillPlatformService, type SkillExecutionResult } from "../services/skillPlatform";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { terminalController } from "../agent/terminalController";
import type { CommandRequest, CommandResult, ProcessInfo } from "../agent/terminalController";
import {
  validateLLMResponse,
  shouldTriggerRAG,
  createDeliveryAck,
  streamRecoveryManager,
  type RAGRelevanceDecision,
} from "../lib/streamReliability";
import { saveStreamingProgress } from "../lib/streamingSeq";
import { skillAutoDispatcher, type SkillDispatchResult } from "../services/skillAutoDispatcher";
import { trackLLMUsage, trackToolExecution, extractFactsInBackground, getMemoryContext, checkToolPermission } from "../lib/pipelineIntegrations";
import { buildAgenticSystemPrompt, type AgenticPromptContext } from "../agent/agenticPromptBuilder";
import { classifyIntent as enhancedClassifyIntent } from "../agent/enhancedIntentClassifier";
import { generateSmartSuggestions } from "../agent/smartSuggestions";
import { detectProactiveActions } from "../agent/proactiveBehaviors";
import { enrichContext } from "../agent/contextEnricher";

type AttachmentSpec = z.infer<typeof AttachmentSpecSchema>;
type StreamProviderSwitch = {
  fromProvider: string;
  toProvider: string;
};
type StreamResponseStatus = "completed" | "incomplete" | "failed";
type StreamIncompleteReason = "max_output_tokens" | "content_filter" | "stream_error" | "provider_error" | "timeout" | "truncated";

type StreamChunkEnvelope = {
  content: string;
  done?: boolean;
  provider?: string;
  providerSwitch?: StreamProviderSwitch;
  sequenceId?: number;
  requestId?: string;
  status?: StreamResponseStatus;
  incompleteDetails?: { reason: StreamIncompleteReason } | null;
};

type StreamSearchQueryLog = {
  query: string;
  resultCount: number;
  status: string;
};

type StreamSearchPreflightResult = {
  detectedWebSources: any[];
  webSearchContextForLLM: string;
  searchQueries: StreamSearchQueryLog[];
  totalSearches: number;
};

import { v4 as uuidv4 } from "uuid";
import type { Response } from "express";
import type { AuthenticatedRequest } from "../types/express";
import { auditLog } from "../services/auditLogger";
import { usageQuotaService, type UsageCheckResult } from "../services/usageQuotaService";
import {
  conversationMemoryManager,
  type ChatMessage as ConversationMemoryChatMessage,
  type ConversationContextResult,
  type MemoryCompressionDiagnostics,
} from "../services/conversationMemory";
import { conversationStateService } from "../services/conversationStateService";
import { generateAndPersistChatTitle } from "../lib/chatTitleGenerator";
import { validate } from "../lib/requestValidator";
import { streamChatRequestSchema } from "../schemas/chatSchemas";
import { checkPromptIntegrity } from "../lib/promptIntegrityService";
import { recordIntegrityCheck, recordTruncation, recordPromptTokens, recordDroppedChars, recordPreprocessDuration, recordAnalysisDuration, recordContextStrategy, recordMustKeepSpans, recordLanguageDetected, recordDuplicateDetected, recordNfcNormalization } from "../lib/promptMetrics";
import { promptPreProcessor } from "../lib/promptPreProcessor";
import { promptAuditStore } from "../lib/promptAuditStore";
import { promptAnalysisService } from "../services/promptAnalysisService";
import * as macos from "../lib/macos";

type ErrorCategory = 'network' | 'rate_limit' | 'api_error' | 'validation' | 'auth' | 'timeout' | 'unknown';
const isDebugLogEnabled = process.env.DEBUG === "true";
const MAX_STREAM_REQUEST_ID_LEN = 140;
const MAX_STREAM_EVENT_PAYLOAD_BYTES = 4600;
const MAX_STREAM_ATTACHMENT_NAME_LEN = 220;
const MAX_STREAM_ATTACHMENT_MIME_LEN = 120;
const MAX_STREAM_ATTACHMENT_SIZE = MAX_CHAT_ATTACHMENT_SIZE_BYTES;
const MAX_STREAM_SKILL_SCOPES = 12;

function isLoopbackHost(rawHost: string | undefined): boolean {
  const host = (rawHost || "").split(":")[0].trim().toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}

function isLoopbackIp(rawIp: string | undefined): boolean {
  const ip = (rawIp || "").trim().toLowerCase();
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

function canUseAnonymousLocalGemma(req: AuthenticatedRequest | Request, model: string | undefined): boolean {
  const normalizedModel = (model || "").trim().toLowerCase();
  if (process.env.NODE_ENV === "production") return false;
  if (!normalizedModel.startsWith("google/gemma-")) return false;
  return isLoopbackHost(req.headers.host) || isLoopbackIp(req.ip) || isLoopbackIp(req.socket.remoteAddress);
}
const MAX_STREAM_SKILL_ATTACHMENTS = 12;
const DEFAULT_STREAM_SKILL_SCOPES: SkillScope[] = ["storage.read", "files", "code_interpreter"];
const VALID_STREAM_SCOPE_SET = new Set<SkillScope>([
  "storage.read",
  "storage.write",
  "browser",
  "email",
  "database",
  "external_network",
  "code_interpreter",
  "files",
  "system",
]);
const STREAM_IDENTIFIER_RE = /^[a-zA-Z0-9._-]{1,140}$/;
const STREAM_ATTACHMENT_NAME_RE = /^[^<>:\"/\\|?*\u0000-\u001f]{1,220}$/;
const STREAM_MIME_RE = /^[a-zA-Z0-9][a-zA-Z0-9.+-\/]*/;
const STREAM_PROGRESS_FLUSH_MS = 250;

function isAsyncIterable<T>(value: unknown): value is AsyncIterable<T> {
  return value != null && typeof (value as AsyncIterable<T>)[Symbol.asyncIterator] === "function";
}

function detachAsyncTask(task: () => unknown, label: string): void {
  try {
    void Promise.resolve(task()).catch((error) => {
      console.warn(`[ChatRouter] ${label} failed:`, error);
    });
  } catch (error) {
    console.warn(`[ChatRouter] ${label} failed:`, error);
  }
}

async function* chunkStreamFromChatResponse(
  response: Awaited<ReturnType<typeof llmGateway.chat>>,
): AsyncGenerator<StreamChunkEnvelope, void, unknown> {
  const content = typeof response?.content === "string" ? response.content : "";
  const provider = typeof response?.provider === "string" ? response.provider : undefined;

  if (content) {
    yield {
      content,
      done: false,
      provider,
    };
  }

  yield {
    content: "",
    done: true,
    provider,
  };
}

async function* withStreamGuard(
  source: AsyncIterable<StreamChunkEnvelope>,
  requestId: string,
  promptLength: number = 0,
): AsyncGenerator<StreamChunkEnvelope, void, unknown> {
  let totalContent = "";
  let chunkCount = 0;
  let lastProvider: string | undefined;
  const MAX_CHUNK_BYTES = 64 * 1024;
  const CHECKPOINT_INTERVAL = 5;

  try {
    for await (const chunk of source) {
      chunkCount++;
      if (chunk.provider) lastProvider = chunk.provider;

      const chunkByteLen = chunk.content ? Buffer.byteLength(chunk.content, "utf8") : 0;
      if (chunkByteLen > MAX_CHUNK_BYTES) {
        console.warn(`[StreamGuard] Oversized chunk (${chunkByteLen} bytes), truncating`, { requestId });
        let truncated = chunk.content!;
        while (Buffer.byteLength(truncated, "utf8") > MAX_CHUNK_BYTES) {
          truncated = truncated.slice(0, Math.floor(truncated.length * MAX_CHUNK_BYTES / Buffer.byteLength(truncated, "utf8")));
        }
        yield { ...chunk, content: truncated };
        totalContent += truncated;
      } else {
        yield chunk;
        totalContent += chunk.content || "";
      }

      if (chunkCount % CHECKPOINT_INTERVAL === 0) {
        streamRecoveryManager.saveCheckpoint(requestId, {
          accumulatedContent: totalContent,
          lastSequenceId: chunk.sequenceId ?? chunkCount,
          chunkCount,
          provider: lastProvider,
          timestamp: Date.now(),
        });
      }

      if (chunk.done) {
        break;
      }
    }

    streamRecoveryManager.removeCheckpoint(requestId);

    if (chunkCount === 0 || totalContent.trim().length === 0) {
      console.warn("[StreamGuard] Stream completed with no content", { requestId, chunkCount });
      yield { content: "", done: true, provider: undefined, status: "incomplete", incompleteDetails: { reason: "stream_error" } };
      return;
    }

    const validation = validateLLMResponse(totalContent, promptLength);
    if (!validation.valid && validation.severity === "critical") {
      console.warn(`[StreamGuard] Response validation failed: ${validation.reason}`, { requestId, chunkCount, contentLen: totalContent.length });
      yield { content: "", done: true, provider: lastProvider, status: "incomplete", incompleteDetails: { reason: validation.reason || "validation_failed" } };
      return;
    }

    const hasUnclosedCode = (totalContent.match(/```/g) || []).length % 2 !== 0;
    const midSentenceEnd = /[,;:\-–—]$/.test(totalContent.trim()) && totalContent.trim().length > 20;
    if (hasUnclosedCode || midSentenceEnd) {
      yield { content: "", done: true, provider: lastProvider, status: "incomplete", incompleteDetails: { reason: "max_output_tokens" } };
    } else if (validation.severity === "warning") {
      yield { content: "", done: true, provider: lastProvider, status: "completed", incompleteDetails: null, _validationWarning: validation.reason };
    } else {
      yield { content: "", done: true, provider: lastProvider, status: "completed", incompleteDetails: null };
    }
  } catch (err) {
    console.error("[StreamGuard] Stream error caught", { requestId, error: (err as Error).message, chunkCount });
    streamRecoveryManager.saveCheckpoint(requestId, {
      accumulatedContent: totalContent,
      lastSequenceId: chunkCount,
      chunkCount,
      provider: lastProvider,
      timestamp: Date.now(),
    });
    yield { content: "", done: true, provider: lastProvider, status: "failed", incompleteDetails: { reason: "stream_error" } };
    throw err;
  }
}

async function resolveModelStream(
  messages: any[],
  options: Record<string, unknown>,
): Promise<AsyncIterable<StreamChunkEnvelope>> {
  const MAX_STREAM_ATTEMPTS = 3;
  let lastError: unknown;
  const gateway = llmGateway as any;
  const requestId = (options as any).requestId || `stream_${Date.now()}`;
  const promptLength = messages.reduce((acc: number, m: any) => acc + String(m?.content || "").length, 0);

  for (let attempt = 0; attempt < MAX_STREAM_ATTEMPTS; attempt++) {
    try {
      if (typeof gateway.streamChat !== "function") {
        if (typeof gateway.chat === "function") {
          console.warn("[Stream] llmGateway.streamChat unavailable; falling back to llmGateway.chat");
          const chatResponse = await gateway.chat(messages, options as any);
          return chunkStreamFromChatResponse(chatResponse);
        }
        throw new Error("llmGateway has no compatible stream or chat method");
      }

      const rawStream = gateway.streamChat(messages, options as any);

      if (isAsyncIterable<StreamChunkEnvelope>(rawStream)) {
        return withStreamGuard(rawStream, requestId, promptLength);
      }

      const resolved = await Promise.resolve(rawStream);
      if (isAsyncIterable<StreamChunkEnvelope>(resolved)) {
        return withStreamGuard(resolved, requestId, promptLength);
      }

      if (resolved && typeof resolved === "object" && "content" in resolved) {
        const chatResponse = resolved as Awaited<ReturnType<typeof llmGateway.chat>>;
        const responseContent = String((chatResponse as any)?.content || "");
        const validation = validateLLMResponse(responseContent, promptLength);
        if (!validation.valid && validation.severity === "critical" && attempt < MAX_STREAM_ATTEMPTS - 1) {
          console.warn(`[Stream] Non-stream response failed validation (${validation.reason}), retrying...`);
          const retryOpts = { ...options, enableFallback: true, skipCache: true };
          if ((options as any).provider) delete (retryOpts as any).provider;
          options = retryOpts;
          await new Promise(resolve => setTimeout(resolve, 200 * (attempt + 1)));
          continue;
        }
        console.warn("[Stream] llmGateway.streamChat returned a non-stream response; converting to single-response stream");
        return chunkStreamFromChatResponse(chatResponse);
      }
    } catch (streamError) {
      lastError = streamError;
      const errMsg = streamError instanceof Error ? streamError.message : String(streamError);
      console.warn(`[Stream] Attempt ${attempt + 1}/${MAX_STREAM_ATTEMPTS} failed: ${errMsg}`);

      if (attempt < MAX_STREAM_ATTEMPTS - 1) {
        const retryOpts = { ...options, enableFallback: true, skipCache: true };
        if ((options as any).provider) {
          delete (retryOpts as any).provider;
        }
        options = retryOpts;
        await new Promise(resolve => setTimeout(resolve, 200 * (attempt + 1)));
        continue;
      }
    }
  }

  try {
    if (typeof gateway.guaranteeResponse === "function") {
      console.warn("[Stream] All stream attempts failed; falling back to llmGateway.guaranteeResponse");
      const fallbackResponse = await gateway.guaranteeResponse(messages, { ...(options as any), skipCache: true, enableFallback: true });
      return chunkStreamFromChatResponse(fallbackResponse);
    }

    if (typeof gateway.chat === "function") {
      console.warn("[Stream] All stream attempts failed; guaranteeResponse unavailable, falling back to llmGateway.chat");
      const fallbackResponse = await gateway.chat(messages, { ...(options as any), skipCache: true, enableFallback: true });
      return chunkStreamFromChatResponse(fallbackResponse);
    }

    throw new Error("llmGateway has no compatible fallback method");
  } catch (chatError) {
    console.error("[Stream] Final guaranteeResponse fallback also failed", chatError);
    throw lastError || chatError;
  }
}

function estimateMemoryTokens(messages: ConversationMemoryChatMessage[]): number {
  if (typeof conversationMemoryManager.estimateMessagesTokens === "function") {
    return conversationMemoryManager.estimateMessagesTokens(messages);
  }

  return messages.reduce((total, message) => total + Math.ceil(String(message?.content || "").length / 4) + 4, 0);
}

const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  "gpt-4o": 128000,
  "gpt-4o-mini": 128000,
  "gpt-4-turbo": 128000,
  "gpt-4": 8192,
  "gpt-3.5-turbo": 16385,
  "gemini-2.0-flash": 1048576,
  "gemini-1.5-pro": 1048576,
  "grok-beta": 131072,
  "grok-3": 131072,
  [FREE_MODEL_ID]: 131072,
  "google/gemma-4-31b-it": 262144,
  "moonshotai/kimi-k2.5": 131072,
};
const DEFAULT_CONTEXT_LIMIT = 128000;
const CONTEXT_RESERVE_RATIO = 0.15;

function autoTruncateMessages(
  messages: Array<{ role: string; content: string | any }>,
  modelId?: string,
): { messages: Array<{ role: string; content: string | any }>; truncated: boolean; droppedCount: number } {
  const contextLimit = MODEL_CONTEXT_LIMITS[modelId || ""] || DEFAULT_CONTEXT_LIMIT;
  const maxInputTokens = Math.floor(contextLimit * (1 - CONTEXT_RESERVE_RATIO));

  const estimateTokens = (msg: { content: string | any }) => {
    const text = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content || "");
    return Math.ceil(text.length / 4) + 4;
  };

  let totalTokens = messages.reduce((sum, m) => sum + estimateTokens(m), 0);
  if (totalTokens <= maxInputTokens) {
    return { messages, truncated: false, droppedCount: 0 };
  }

  const systemMessages = messages.filter(m => m.role === "system");
  const nonSystemMessages = messages.filter(m => m.role !== "system");

  const systemTokens = systemMessages.reduce((sum, m) => sum + estimateTokens(m), 0);
  let budget = maxInputTokens - systemTokens;

  let startIdx = 0;
  let currentTokens = nonSystemMessages.reduce((sum, m) => sum + estimateTokens(m), 0);

  while (currentTokens > budget && startIdx < nonSystemMessages.length - 2) {
    currentTokens -= estimateTokens(nonSystemMessages[startIdx]);
    startIdx++;
  }

  const keptMessages = [...systemMessages, ...nonSystemMessages.slice(startIdx)];
  const droppedCount = startIdx;

  if (droppedCount > 0) {
    console.log(`[AutoTruncate] Dropped ${droppedCount} oldest messages to fit context window (${modelId || "default"}, limit: ${contextLimit})`);
  }

  return { messages: keptMessages, truncated: droppedCount > 0, droppedCount };
}

function createMemoryDiagnosticsFallback(
  messages: ConversationMemoryChatMessage[],
): MemoryCompressionDiagnostics {
  const totalTokens = estimateMemoryTokens(messages);
  const nonSystemMessageCount = messages.filter((message) => message.role !== "system").length;

  return {
    compressionApplied: false,
    originalTokens: totalTokens,
    finalTokens: totalTokens,
    originalMessageCount: messages.length,
    finalMessageCount: messages.length,
    recentMessagesKept: nonSystemMessageCount,
    relevantMessagesKept: 0,
    summarizedMessages: 0,
    summaryApplied: false,
  };
}

async function augmentHistoryWithCompatibility(
  chatId: string | undefined,
  clientMessages: ConversationMemoryChatMessage[],
  maxTokens = 8000,
): Promise<ConversationContextResult> {
  if (typeof conversationMemoryManager.augmentWithHistoryWithDiagnostics === "function") {
    return conversationMemoryManager.augmentWithHistoryWithDiagnostics(chatId, clientMessages, maxTokens);
  }

  if (typeof conversationMemoryManager.augmentWithHistory === "function") {
    const messages = await conversationMemoryManager.augmentWithHistory(chatId, clientMessages, maxTokens);
    return {
      messages,
      diagnostics: createMemoryDiagnosticsFallback(messages),
    };
  }

  return {
    messages: clientMessages,
    diagnostics: createMemoryDiagnosticsFallback(clientMessages),
  };
}

function createEmptySearchPreflightResult(): StreamSearchPreflightResult {
  return {
    detectedWebSources: [],
    webSearchContextForLLM: "",
    searchQueries: [],
    totalSearches: 0,
  };
}

async function runStreamSearchPreflight({
  shouldSearch,
  userQuery,
  requestedWebSearch,
  requestId,
  res,
  isConnectionClosed,
}: {
  shouldSearch: boolean;
  userQuery: string;
  requestedWebSearch: boolean;
  requestId: string;
  res: Response;
  isConnectionClosed: () => boolean;
}): Promise<StreamSearchPreflightResult> {
  const result = createEmptySearchPreflightResult();
  const trimmedQuery = userQuery.trim();

  if (!shouldSearch || !trimmedQuery || isConnectionClosed()) {
    return result;
  }

  if (!isConnectionClosed()) {
    writeSse(res, "thinking", {
      step: "searching",
      message: "Buscando fuentes relevantes...",
      requestId,
      timestamp: Date.now(),
    });
  }

  try {
    const { needsAcademicSearch, needsWebSearch, searchWeb } = await import("../services/webSearch");
    const { academicEngineV3, generateAPACitation } = await import("../services/academicResearchEngineV3");

    const doAcademic = needsAcademicSearch(trimmedQuery);
    const doWeb = requestedWebSearch ? !doAcademic : needsWebSearch(trimmedQuery);

    if (doAcademic) {
      console.log("[Stream] Academic search", {
        mode: requestedWebSearch ? "requested" : "auto",
        queryPreview: trimmedQuery.slice(0, 60),
      });
      try {
        const engineResult = await academicEngineV3.search({
          query: trimmedQuery,
          maxResults: 15,
          yearFrom: 2020,
          yearTo: new Date().getFullYear(),
          sources: ["scielo", "openalex", "semantic_scholar", "crossref", "core", "pubmed", "arxiv", "doaj"],
        });

        if (engineResult.papers.length > 0) {
          const academicContext = engineResult.papers
            .slice(0, 10)
            .map((paper, index) =>
              `[${index + 1}] ${paper.title}\nAutores: ${paper.authors.map((author) => author.name).join(", ") || "No disponible"}\nAño: ${paper.year || "N/A"}\nJournal: ${paper.journal || "N/A"}\nDOI: ${paper.doi || "N/A"}\nURL: ${paper.url || (paper.doi ? `https://doi.org/${paper.doi}` : "N/A")}\nResumen: ${(paper.abstract || "").substring(0, 300)}...\nCita APA: ${generateAPACitation(paper)}`
            )
            .join("\n\n");

          result.webSearchContextForLLM =
            `\n\n---\nARTÍCULOS ACADÉMICOS ENCONTRADOS (${engineResult.papers.length} resultados de ${engineResult.sources.map((source) => source.name).join(", ")}):\n\n${academicContext}\n\nINSTRUCCIÓN CRÍTICA SOBRE LA BÚSQUEDA ACADÉMICA:\n- Usa estos artículos para responder con detalle y precisión.\n- Incluye citas APA y URLs siempre que sea posible.\n- Apoya las afirmaciones importantes con referencias explícitas [número].`;

          result.detectedWebSources = engineResult.papers.slice(0, 10).map((paper) => ({
            url: paper.url || (paper.doi ? `https://doi.org/${paper.doi}` : ""),
            title: paper.title,
            snippet: paper.abstract?.substring(0, 200) || "",
            domain: paper.journal || "Academic",
            favicon: null,
            imageUrl: null,
            siteName: paper.journal || engineResult.sources[0]?.name || "Academic Source",
            publishedDate: paper.year ? `${paper.year}` : null,
          }));

          console.log("[Stream] Academic search complete", { papers: engineResult.papers.length });
          result.searchQueries.push({ query: trimmedQuery, resultCount: engineResult.papers.length, status: "completed" });
          result.totalSearches = 1;
        }
      } catch (academicError) {
        console.error("[Stream] Academic search error:", academicError);
        result.searchQueries.push({ query: trimmedQuery, resultCount: 0, status: "failed" });
        result.totalSearches = 1;
      }
    } else if (doWeb) {
      console.log("[Stream] Web search", {
        mode: requestedWebSearch ? "requested" : "auto",
        queryPreview: trimmedQuery.slice(0, 60),
      });
      try {
        const searchResults = await searchWeb(trimmedQuery, 50);

        if (searchResults.results.length > 0) {
          let searchContext: string;
          if (searchResults.contents && searchResults.contents.length > 0) {
            searchContext = searchResults.contents
              .map((content: any, index: number) => `[${index + 1}] ${content.title} (${content.url}):\n${content.content}`)
              .join("\n\n");

            const contentUrls = new Set(searchResults.contents.map((content: any) => content.url));
            const extraResults = searchResults.results
              .filter((entry: any) => !contentUrls.has(entry.url))
              .slice(0, 5);
            if (extraResults.length > 0) {
              const startIndex = searchResults.contents.length + 1;
              searchContext += "\n\n" + extraResults
                .map((entry: any, index: number) => `[${startIndex + index}] ${entry.title}: ${entry.snippet} (${entry.url})`)
                .join("\n");
            }
          } else {
            searchContext = searchResults.results
              .map((entry: any, index: number) => `[${index + 1}] ${entry.title}\n${entry.snippet}\nFuente: ${entry.url}`)
              .join("\n\n");
          }

          result.webSearchContextForLLM =
            `\n\n---\nBÚSQUEDA WEB REALIZADA - RESULTADOS ACTUALIZADOS:\n${searchContext}\n\nINSTRUCCIÓN CRÍTICA SOBRE LA BÚSQUEDA WEB:\n- Usa TODA la información de los resultados de búsqueda anteriores para dar una respuesta COMPLETA y DETALLADA.\n- NO digas que no tienes acceso a internet, noticias o información actualizada.\n- Los datos anteriores son reales y actuales, obtenidos en tiempo real.\n- Cita las fuentes con [número] al final de cada punto.\n- IGNORA cualquier límite de caracteres o instrucción de brevedad anterior: esta respuesta debe ser EXTENSA y cubrir todos los resultados relevantes.\n- Presenta la información en formato de lista con bullets o numerada, con detalles de cada noticia/resultado.`;

          result.detectedWebSources = searchResults.results.map((entry: any) => ({
            url: entry.url,
            title: entry.title,
            snippet: entry.snippet,
            domain: new URL(entry.url).hostname.replace("www.", ""),
            favicon: entry.favicon || null,
            imageUrl: entry.imageUrl || null,
            siteName: entry.siteName || new URL(entry.url).hostname.replace("www.", ""),
            publishedDate: entry.publishedDate || null,
            query: entry.query || null,
            metadata: entry.metadata || null,
          }));

          console.log("[Stream] Web search complete", {
            results: searchResults.results.length,
            contentsCount: searchResults.contents?.length || 0,
          });
          result.searchQueries.push({ query: trimmedQuery, resultCount: searchResults.results.length, status: "completed" });
          result.totalSearches = 1;
        }
      } catch (webError) {
        console.error("[Stream] Web search error:", webError);
        result.searchQueries.push({ query: trimmedQuery, resultCount: 0, status: "failed" });
        result.totalSearches = 1;
      }
    }
  } catch (importError) {
    console.error("[Stream] Failed to import search modules:", importError);
    result.searchQueries.push({ query: trimmedQuery, resultCount: 0, status: "failed" });
    result.totalSearches = 1;
  }

  return result;
}

function extractUserText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part: any) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object") {
          if (typeof part.text === "string") return part.text;
          if (typeof part.content === "string") return part.content;
        }
        return "";
      })
      .filter(Boolean)
      .join(" ")
      .trim();
  }
  if (content && typeof content === "object") {
    const maybeText = (content as any).text ?? (content as any).content;
    if (typeof maybeText === "string") return maybeText;
  }
  return String(content || "").trim();
}
const LOCAL_DESKTOP_ACTIONS_ENABLED =
  process.env.ILIAGPT_ENABLE_LOCAL_DESKTOP_ACTIONS === "true" ||
  process.env.NODE_ENV !== "production";

// ── PER-USER SSE CONNECTION LIMITER ────────────────────────────
const MAX_SSE_CONNECTIONS_PER_USER = 5;
const SSE_CONNECTION_TRACKER = new Map<string, Set<string>>();

type ConversationStreamLock = {
  requestId: string;
  startedAt: number;
  lastActivityAt: number;
  cancel: (reason?: string) => void;
  reserved?: boolean;
};

type ConversationQueueAcquireResult = {
  queued: boolean;
  waitMs: number;
  initialPosition: number;
};

type ConversationStreamWaiter = {
  requestId: string;
  queuedAt: number;
  initialPosition: number;
  resolve: (result: ConversationQueueAcquireResult) => void;
  reject: (error: ConversationQueueError) => void;
  timeoutId: ReturnType<typeof setTimeout>;
  removeAbortListener: () => void;
};

class ConversationQueueError extends Error {
  code: "QUEUE_FULL" | "QUEUE_TIMEOUT" | "QUEUE_ABORTED";
  retryAfterSeconds?: number;

  constructor(
    code: "QUEUE_FULL" | "QUEUE_TIMEOUT" | "QUEUE_ABORTED",
    message: string,
    retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "ConversationQueueError";
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

const CONVERSATION_STREAM_LOCK_TTL_MS = 60_000;
const CONVERSATION_STREAM_QUEUE_TIMEOUT_MS = Math.max(
  5_000,
  Number(process.env.CHAT_STREAM_QUEUE_TIMEOUT_MS) || 45_000,
);
const MAX_CONVERSATION_STREAM_QUEUE_LENGTH = Math.max(
  1,
  Number(process.env.CHAT_STREAM_QUEUE_MAX) || 100,
);
const CONVERSATION_STREAM_LOCKS = new Map<string, ConversationStreamLock>();
const CONVERSATION_STREAM_WAITERS = new Map<string, ConversationStreamWaiter[]>();
const INTERACTIVE_STALE_RUN_THRESHOLD_MS = 60_000;

function refreshConversationStreamLock(conversationId: string | null | undefined, requestId: string): void {
  if (!conversationId) return;
  const current = CONVERSATION_STREAM_LOCKS.get(conversationId);
  if (!current || current.requestId !== requestId) return;
  current.lastActivityAt = Date.now();
}

function cleanConversationStreamLocks(): void {
  const now = Date.now();
  for (const [key, value] of CONVERSATION_STREAM_LOCKS.entries()) {
    const lastSeenAt = value.lastActivityAt || value.startedAt;
    if (now - lastSeenAt > CONVERSATION_STREAM_LOCK_TTL_MS) {
      CONVERSATION_STREAM_LOCKS.delete(key);
      promoteConversationStreamWaiter(key);
    }
  }
}

function cleanConversationStreamWaiters(): void {
  for (const [key, waiters] of CONVERSATION_STREAM_WAITERS.entries()) {
    if (waiters.length === 0) {
      CONVERSATION_STREAM_WAITERS.delete(key);
    }
  }
}

function removeConversationStreamWaiter(
  conversationId: string,
  requestId: string,
): ConversationStreamWaiter | null {
  const waiters = CONVERSATION_STREAM_WAITERS.get(conversationId);
  if (!waiters?.length) {
    return null;
  }

  const index = waiters.findIndex((waiter) => waiter.requestId === requestId);
  if (index < 0) {
    return null;
  }

  const [waiter] = waiters.splice(index, 1);
  if (waiters.length === 0) {
    CONVERSATION_STREAM_WAITERS.delete(conversationId);
  }
  return waiter || null;
}

function settleConversationStreamWaiter(
  waiter: ConversationStreamWaiter,
  outcome: { error?: ConversationQueueError; result?: ConversationQueueAcquireResult },
): void {
  clearTimeout(waiter.timeoutId);
  waiter.removeAbortListener();
  if (outcome.error) {
    waiter.reject(outcome.error);
    return;
  }
  waiter.resolve(outcome.result || {
    queued: true,
    waitMs: Date.now() - waiter.queuedAt,
    initialPosition: waiter.initialPosition,
  });
}

function promoteConversationStreamWaiter(conversationId: string): void {
  const waiters = CONVERSATION_STREAM_WAITERS.get(conversationId);
  if (!waiters?.length) {
    return;
  }

  const waiter = waiters.shift();
  if (!waiter) {
    if (waiters.length === 0) {
      CONVERSATION_STREAM_WAITERS.delete(conversationId);
    }
    return;
  }

  if (waiters.length === 0) {
    CONVERSATION_STREAM_WAITERS.delete(conversationId);
  }

  CONVERSATION_STREAM_LOCKS.set(conversationId, {
    requestId: waiter.requestId,
    startedAt: Date.now(),
    lastActivityAt: Date.now(),
    cancel: () => {},
    reserved: true,
  });

  settleConversationStreamWaiter(waiter, {
    result: {
      queued: true,
      waitMs: Date.now() - waiter.queuedAt,
      initialPosition: waiter.initialPosition,
    },
  });
}

async function waitForConversationStreamTurn(
  conversationId: string,
  requestId: string,
  req: any,
): Promise<ConversationQueueAcquireResult> {
  const existingWaiters = CONVERSATION_STREAM_WAITERS.get(conversationId) || [];
  if (existingWaiters.length >= MAX_CONVERSATION_STREAM_QUEUE_LENGTH) {
    throw new ConversationQueueError(
      "QUEUE_FULL",
      `Conversation queue is full (max ${MAX_CONVERSATION_STREAM_QUEUE_LENGTH})`,
      1,
    );
  }

  const queuedAt = Date.now();
  const initialPosition = existingWaiters.length + 1;

  return await new Promise<ConversationQueueAcquireResult>((resolve, reject) => {
    let settled = false;
    const rejectOnce = (error: ConversationQueueError) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const resolveOnce = (result: ConversationQueueAcquireResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const abortHandler = () => {
      const waiter = removeConversationStreamWaiter(conversationId, requestId);
      if (waiter) {
        settleConversationStreamWaiter(waiter, {
          error: new ConversationQueueError("QUEUE_ABORTED", "Request aborted while waiting in queue"),
        });
      } else {
        rejectOnce(new ConversationQueueError("QUEUE_ABORTED", "Request aborted while waiting in queue"));
      }
    };

    const removeAbortListener = () => {
      req.off?.("aborted", abortHandler);
    };

    req.on?.("aborted", abortHandler);

    const timeoutId = setTimeout(() => {
      const waiter = removeConversationStreamWaiter(conversationId, requestId);
      const retryAfterSeconds = Math.max(1, Math.ceil(CONVERSATION_STREAM_QUEUE_TIMEOUT_MS / 1000));
      if (waiter) {
        settleConversationStreamWaiter(waiter, {
          error: new ConversationQueueError(
            "QUEUE_TIMEOUT",
            `Conversation queue wait exceeded ${CONVERSATION_STREAM_QUEUE_TIMEOUT_MS}ms`,
            retryAfterSeconds,
          ),
        });
      } else {
        rejectOnce(
          new ConversationQueueError(
            "QUEUE_TIMEOUT",
            `Conversation queue wait exceeded ${CONVERSATION_STREAM_QUEUE_TIMEOUT_MS}ms`,
            retryAfterSeconds,
          ),
        );
      }
    }, CONVERSATION_STREAM_QUEUE_TIMEOUT_MS);

    const waiter: ConversationStreamWaiter = {
      requestId,
      queuedAt,
      initialPosition,
      resolve: resolveOnce,
      reject: rejectOnce,
      timeoutId,
      removeAbortListener,
    };

    existingWaiters.push(waiter);
    CONVERSATION_STREAM_WAITERS.set(conversationId, existingWaiters);
  });
}

function acquireSseSlot(userId: string, requestId: string): boolean {
  let connections = SSE_CONNECTION_TRACKER.get(userId);
  if (!connections) {
    connections = new Set();
    SSE_CONNECTION_TRACKER.set(userId, connections);
  }
  if (connections.size >= MAX_SSE_CONNECTIONS_PER_USER) return false;
  connections.add(requestId);
  return true;
}

function releaseSseSlot(userId: string, requestId: string): void {
  const connections = SSE_CONNECTION_TRACKER.get(userId);
  if (connections) {
    connections.delete(requestId);
    if (connections.size === 0) SSE_CONNECTION_TRACKER.delete(userId);
  }
}

function extractDesktopFolderNameFromPrompt(input: string): string | null {
  const prompt = String(input || "").trim();
  if (!prompt) return null;

  const cleanCandidate = (candidate: string): string => {
    let cleaned = candidate.trim();
    cleaned = cleaned
      .replace(/^[\s("'`[{]+/, "")
      .replace(/[\s)"'`\]}]+$/g, "")
      .replace(/\s+(?:en\s+(?:mi|el)\s+mac|en\s+mac)\b.*$/i, "")
      .replace(/\s+on\s+(?:my|the)\s+mac\b.*$/i, "")
      .replace(/\s+en\s+(?:(?:mi|el|la|tu|su)\s+)?(?:escritorio|excritorio|desktop)\b.*$/i, "")
      .replace(/\s+on\s+(?:(?:my|the)\s+)?desktop\b.*$/i, "")
      .replace(/\s+(?:por\s+favor|gracias)\b.*$/i, "")
      .replace(/[.,;:!?]+$/g, "")
      .trim();
    return cleaned;
  };

  const folderNamePatterns = [
    // Priority 1: Explicit name markers (llamada, con nombre, named, que se llame) + desktop context
    /(?:crea|crear|creame|creá|crees|haz|hazme|genera|generar|make|create)\s+(?:otra\s+|una\s+)?(?:carpeta|caroeta|carepta|carptea|careta|folder|directorio|directory)\s+(?:llamada|con\s+nombre|named)\s+["'“”]?([^"'“”\n]{1,160}?)["'“”]?\s+(?:en\s+)?(?:(?:mi|el|la|tu|su)\s+)?(?:mac|escritorio|excritorio|desktop)\b/i,
    // Priority 2: "carpeta que se llame X" / "carpeta con el nombre X" / "carpeta llamada X"
    /(?:carpeta|caroeta|carepta|carptea|careta|folder|directorio|directory)\s+(?:con\s+(?:el\s+)?nombre|llamada|named|que\s+se\s+llame)\s+["'“”]?([^"'“”\n]{1,160})["'“”]?/i,
    // Priority 3: "crea carpeta [en desktop] llamada/named X" (desktop in middle, name at end)
    /(?:crea|crear|creame|creá|crees|haz|hazme|genera|generar|make|create)\s+(?:otra\s+|una\s+)?(?:carpeta|caroeta|carepta|carptea|careta|folder|directorio|directory)(?:\s+en\s+(?:(?:mi|el)\s+)?(?:escritorio|excritorio|desktop))?\s+(?:llamada|llame|con\s+nombre|named)\s+["'“”]?([^"'“”\n]{1,160})["'“”]?\s*$/i,
    // Priority 4: "crea carpeta X en escritorio" (relies on ending bounds to prevent capturing "en escritorio" as name)
    /(?:crea|crear|creame|creá|crees|haz|hazme|genera|generar|make|create)\s+(?:otra\s+|una\s+)?(?:carpeta|caroeta|carepta|carptea|careta|folder|directorio|directory)\s+["'“”]?([^"'“”\n]{1,160}?)["'“”]?\s+(?:en\s+)?(?:(?:mi|el|la|tu|su)\s+)?(?:mac|escritorio|excritorio|desktop)\b/i,
    // Priority 5: /mkdir command
    /^(?:\/?mkdir|local:\s*mkdir)\s+["'“”]?([^"'“”\n]{1,120})["'“”]?\s*$/i,
  ];

  for (const pattern of folderNamePatterns) {
    const match = prompt.match(pattern);
    const candidate = match?.[1]?.trim();
    if (!candidate) continue;
    const cleaned = cleanCandidate(candidate);
    // Explicitly reject if candidate is a common stop word due to regex overreach
    if (cleaned && !/^(?:en|mi|el|la|una|un|de|del|con)$/i.test(cleaned)) {
      return cleaned;
    }
  }

  // Fallback heuristic: if phrase clearly asks to create a desktop folder,
  // extract token after "nombre/llamada/named" until first connector.
  const hasCreateVerb = /\b(?:crea|crear|creame|creá|crees|haz|hazme|genera|generar|make|create)\b/i.test(prompt);
  const hasFolderWord = /\b(?:carpeta|caroeta|carepta|carptea|careta|folder|directorio|directory)\b/i.test(prompt);
  const intent = hasCreateVerb && hasFolderWord;

  if (intent) {
    // Strategy A: explicit name markers
    const byNameMatch = prompt.match(/(?:nombre|llamada|named|que\s+se\s+llame)\s+["'“”]?([^"'“”\n]{1,180})["'“”]?/i);
    const candidate = byNameMatch?.[1] ? cleanCandidate(byNameMatch[1]) : "";
    if (candidate) return candidate;

    // Strategy B: quoted string anywhere in the phrase
    const quotedMatch = prompt.match(/["'“”]([^"'“”\n]{1,120})["'“”]/);
    if (quotedMatch?.[1]) {
      const qCandidate = cleanCandidate(quotedMatch[1]);
      if (qCandidate) return qCandidate;
    }

    // Strategy C: extract the last meaningful word at the end of the phrase, skipping generic stop words
    const stopWords = new Set([
      "en", "mi", "una", "un", "la", "el", "de", "del", "con", "que", "se", "por",
      "tu", "su", "al", "es", "lo", "le", "crear", "crea", "creame", "haz", "hazme",
      "genera", "make", "create", "carpeta", "caroeta", "carepta", "folder", "directorio",
      "escritorio", "excritorio", "desktop", "mac", "nombre", "llamada", "puedes",
      "podrias", "porfavor", "favor", "gracias", "please", "otra", "nueva", "nuevo",
      "quiero", "necesito", "me", "los", "las", "the", "on", "a", "my", "llamado",
    ]);

    const words = prompt.split(/\s+/);
    let nameCandidate = "";

    // Scan backwards for the first word not in stopWords
    for (let i = words.length - 1; i >= 0; i--) {
      const w = words[i].replace(/^["'`([{]+/, "").replace(/["'`)\]},.:;!?]+$/, "");
      if (!w) continue;

      const lower = w.toLowerCase();
      // If the word isn't a stopword, assume it's the target name
      if (!stopWords.has(lower)) {
        nameCandidate = w;
        break;
      }
    }

    if (nameCandidate) {
      const qCandidate = cleanCandidate(nameCandidate);
      if (qCandidate) return qCandidate;
    }
  }

  return null;
}

function looksLikeDesktopFolderIntent(input: string): boolean {
  const prompt = String(input || "").trim();
  if (!prompt) return false;
  const hasCreateVerb = /\b(?:crea|crear|creame|creá|crees|haz|hazme|genera|generar|make|create)\b/i.test(prompt);
  const hasFolderWord = /\b(?:carpeta|caroeta|carepta|carptea|careta|folder|directorio|directory)\b/i.test(prompt);
  const hasDesktopContext = /\b(?:escritorio|excritorio|desktop|mi\s+mac|my\s+mac)\b/i.test(prompt);
  return hasCreateVerb && hasFolderWord && hasDesktopContext;
}

// ── Natural language intent extractors for all local control commands ──

function extractNaturalRmIntent(input: string): string | null {
  const prompt = String(input || "").trim();
  const patterns = [
    // "elimina/borra/delete la carpeta/archivo X (de mi escritorio)"
    /\b(?:elimina|eliminar|borra|borrar|delete|remove|quita|quitar)\s+(?:la\s+|el\s+|the\s+)?(?:carpeta|archivo|folder|file|directorio|directory)\s+["']?([^"'\n]{1,160})["']?/i,
    // "elimina X de mi escritorio" / "delete X from my desktop"
    /\b(?:elimina|eliminar|borra|borrar|delete|remove)\s+["']?([^"'\n]{1,120})["']?\s+(?:de|del|from)\s+(?:(?:mi|my)\s+)?(?:escritorio|desktop)/i,
  ];
  for (const re of patterns) {
    const m = prompt.match(re);
    if (m?.[1]) {
      let name = m[1].trim()
        .replace(/\s+(?:de|del|from)\s+(?:(?:mi|my)\s+)?(?:escritorio|desktop)\b.*$/i, "")
        .replace(/\s+(?:por\s+favor|please)\b.*$/i, "")
        .replace(/[.,;:!?]+$/, "")
        .trim();
      if (name) return name;
    }
  }
  return null;
}

function extractNaturalReadIntent(input: string): string | null {
  const prompt = String(input || "").trim();
  const patterns = [
    // "lee/muéstrame/abre el archivo X"
    /\b(?:lee|leer|muestra|muéstrame|mostrar|abre|abrir|show|read|open|display|cat)\s+(?:el\s+)?(?:archivo|file|contenido\s+de(?:l)?)\s+["']?([^"'\n]{1,160})["']?/i,
    // "qué contiene/tiene el archivo X" — require "archivo/file" to avoid matching "qué hay en mi escritorio" (which is ls)
    /\b(?:qué|que|what)\s+(?:contiene|tiene|contains)\s+(?:el\s+)?(?:archivo\s+)?["']?([^"'\n]{1,160})["']?/i,
    /\b(?:qué|que|what)\s+(?:hay\s+en)\s+(?:el\s+)?(?:archivo|file)\s+["']?([^"'\n]{1,160})["']?/i,
    // "lee X" (short form when it looks like a file path)
    /\b(?:lee|leer|read|cat)\s+["']?([^\s"']{2,}\.[\w]{1,10})["']?\s*$/i,
  ];
  for (const re of patterns) {
    const m = prompt.match(re);
    if (m?.[1]) {
      let name = m[1].trim().replace(/[.,;:!?]+$/, "").trim();
      if (name) return name;
    }
  }
  return null;
}

function extractNaturalShellIntent(input: string): string | null {
  const prompt = String(input || "").trim();
  const patterns = [
    // "ejecuta/corre/run el comando X"
    /\b(?:ejecuta|ejecutar|corre|correr|run|lanza|lanzar|execute)\s+(?:el\s+)?(?:comando|command)?\s*[:\-]?\s*[`"']?(.+?)[`"']?\s*$/i,
    // "en la terminal haz/ejecuta X"
    /\b(?:en\s+(?:la\s+)?terminal|in\s+(?:the\s+)?terminal)\s*[,:]?\s*(?:ejecuta|haz|run|do|type)\s+[`"']?(.+?)[`"']?\s*$/i,
    // "corre en bash: X"
    /\b(?:en\s+)?(?:bash|shell|terminal|consola)\s*[:\-]\s*[`"']?(.+?)[`"']?\s*$/i,
  ];
  for (const re of patterns) {
    const m = prompt.match(re);
    if (m?.[1]?.trim()) return m[1].trim();
  }
  return null;
}

function extractNaturalSysinfoIntent(input: string): boolean {
  const prompt = String(input || "").trim().toLowerCase();
  const keywords = [
    /\b(?:info(?:rmacion)?|información)\s+(?:del?\s+)?(?:sistema|equipo|computadora|mac|pc)\b/i,
    /\b(?:cuanta|cuánta|how\s+much)\s+(?:memoria|ram|memory)\b/i,
    /\b(?:espacio|space)\s+(?:en\s+)?(?:disco|disk)\b/i,
    /\b(?:que|qué|which)\s+(?:version|versión)\s+(?:de\s+)?(?:mac|macos|os)\b/i,
    /\b(?:cuantos|cuántos|how\s+many)\s+(?:cores?|núcleos|procesadores?|cpus?)\b/i,
    /\b(?:datos|detalles|specs|especificaciones)\s+(?:del?\s+)?(?:sistema|equipo|computadora|hardware)\b/i,
  ];
  return keywords.some(re => re.test(prompt));
}

function extractNaturalWriteIntent(input: string): { path: string; content: string } | null {
  const prompt = String(input || "").trim();
  const patterns = [
    // "crea un archivo X con el contenido Y"
    /\b(?:crea|crear|make|create|genera)\s+(?:un\s+)?(?:archivo|file)\s+["']?([^"'\n]{1,120})["']?\s+(?:con\s+(?:el\s+)?(?:contenido|texto|content)|que\s+(?:contenga|diga|tenga))\s+["']?(.+?)["']?\s*$/i,
    // "escribe/guarda en el archivo X: contenido"
    /\b(?:escribe|escribir|guarda|guardar|write|save)\s+(?:en\s+)?(?:el\s+)?(?:archivo\s+)?["']?([^"'\n]{1,120})["']?\s*[:\-]\s*["']?(.+?)["']?\s*$/i,
  ];
  for (const re of patterns) {
    const m = prompt.match(re);
    if (m?.[1]?.trim() && m?.[2]?.trim()) {
      return { path: m[1].trim(), content: m[2].trim() };
    }
  }
  return null;
}

function extractNaturalLsIntent(input: string): string | null {
  const prompt = String(input || "").trim();
  const normalizeTarget = (rawTarget: string): string => {
    const cleaned = String(rawTarget || "")
      .trim()
      .replace(/[.,;:!?]+$/g, "")
      .trim();
    if (!cleaned) return "";
    if (/^(?:mi\s+)?(?:escritorio|excritorio|desktop|mac|computadora|pc|laptop|home)$/i.test(cleaned)) {
      return "desktop:";
    }
    return cleaned;
  };

  const patterns = [
    // "muéstrame los archivos de mi escritorio" / "lista las carpetas de mi escritorio"
    /\b(?:muestra|muéstrame|lista|listar|show|list)\s+(?:los\s+|las\s+)?(?:archivos|carpetas|files|folders|contenido)\s+(?:de|del|en|in|from)\s+(?:mi\s+)?["']?([^"'\n]{1,120})["']?\s*$/i,
    // "qué hay en mi escritorio" / "qué archivos tengo en Desktop"
    /\b(?:qué|que|what)\s+(?:hay|archivos|carpetas|files|folders)\s+(?:en|in|tengo\s+en)\s+(?:mi\s+)?["']?([^"'\n]{1,120})["']?\s*$/i,
    // "cuántas carpetas tengo en mi escritorio" (tolerates common typo "caprteas")
    /\b(?:cu[aá]ntas?|how\s+many|cantidad(?:\s+de)?|n[uú]mero(?:\s+de)?)\s+(?:carpetas?|caprteas?|careptas?|carpteas?|folders?|directorios?|directories?|archivos?|files?)\b(?:.*?\b(?:en|in|de|del|from)\s+(?:mi\s+)?["']?([^"'\n]{1,120})["']?)?/i,
  ];
  for (const re of patterns) {
    const m = prompt.match(re);
    if (m?.[1]?.trim()) {
      const target = normalizeTarget(m[1]);
      if (target) return target;
    }
  }

  // Fallback: if the user asks for counts in desktop/mac context, default to Desktop.
  const asksForCount = /\b(?:cu[aá]ntas?|how\s+many|cantidad|n[uú]mero)\b/i.test(prompt);
  const asksAboutFoldersOrFiles = /\b(?:carpetas?|caprteas?|careptas?|carpteas?|folders?|directorios?|directories?|archivos?|files?)\b/i.test(prompt);
  const hasDesktopContext = /\b(?:escritorio|excritorio|desktop|mi\s+mac|my\s+mac|computadora|pc|laptop)\b/i.test(prompt);
  if (asksForCount && asksAboutFoldersOrFiles && hasDesktopContext) {
    return "desktop:";
  }

  return null;
}

// ── New natural language extractors for expanded commands ──

function extractNaturalPsIntent(input: string): boolean {
  const prompt = String(input || "").trim();
  const patterns = [
    /\b(?:muestra|muéstrame|show|list|lista)\s+(?:los\s+)?(?:procesos|processes)\b/i,
    /\b(?:qué|que|what)\s+(?:procesos|processes)\s+(?:están|estan|are)\s+(?:corriendo|running|activos|active)\b/i,
    /\b(?:procesos|processes)\s+(?:activos|running|corriendo|en\s+ejecución)\b/i,
    /\b(?:running|active)\s+(?:procesos|processes)\b/i,
  ];
  return patterns.some(re => re.test(prompt));
}

function extractNaturalKillIntent(input: string): { pid?: string; name?: string } | null {
  const prompt = String(input || "").trim();
  const patterns = [
    // "mata/kill/termina el proceso X" or "mata el proceso con PID 1234"
    /\b(?:mata|matar|kill|termina|terminar|detén|deten|para|stop)\s+(?:el\s+)?(?:proceso|process)\s+(?:con\s+)?(?:PID\s+)?["']?(\S+)["']?/i,
    // "kill PID 1234" / "kill 1234"
    /\b(?:kill|mata|matar|termina)\s+(?:PID\s+)?(\d+)\b/i,
  ];
  for (const re of patterns) {
    const m = prompt.match(re);
    if (m?.[1]?.trim()) {
      const val = m[1].trim();
      if (/^\d+$/.test(val)) return { pid: val };
      return { name: val };
    }
  }
  return null;
}

function extractNaturalPortsIntent(input: string): boolean {
  const prompt = String(input || "").trim();
  const patterns = [
    /\b(?:qué|que|which|what)\s+(?:puertos|ports)\s+(?:están|estan|are)\s+(?:abiertos|open|en\s+uso|in\s+use|listening|escuchando)\b/i,
    /\b(?:puertos|ports)\s+(?:abiertos|open|en\s+uso|in\s+use|listening|activos)\b/i,
    /\b(?:muestra|muéstrame|show|list|lista)\s+(?:los\s+)?(?:puertos|ports)\b/i,
    /\b(?:listening)\s+(?:puertos|ports)\b/i,
  ];
  return patterns.some(re => re.test(prompt));
}

function extractNaturalGitIntent(input: string): string | null {
  const prompt = String(input || "").trim();
  const patterns = [
    // "git status" / "git add ." / "git commit -m ..."
    /^git\s+(.+)$/i,
    // "haz un commit con mensaje X"
    /\b(?:haz|hacer|make|do)\s+(?:un\s+)?commit\s+(?:con\s+(?:el\s+)?(?:mensaje|message)\s+)?["']?(.+?)["']?\s*$/i,
    // "estado del repositorio" / "repository status"
    /\b(?:estado|status)\s+(?:del?\s+)?(?:repositorio|repo|repository)\b/i,
    // "push to remote" / "sube los cambios"
    /\b(?:push|sube|subir)\s+(?:(?:los|the)\s+)?(?:cambios|changes|commits?)\b/i,
    // "pull / jala los cambios"
    /\b(?:pull|jala|bajar|download)\s+(?:(?:los|the)\s+)?(?:cambios|changes|commits?)\b/i,
  ];
  for (const re of patterns) {
    const m = prompt.match(re);
    if (m) {
      // For the "git <subcommand>" form, return the subcommand
      if (/^git\s+/i.test(prompt)) return prompt.replace(/^git\s+/i, "").trim();
      // For "haz un commit con mensaje X"
      if (m[1] && /commit/i.test(prompt)) return `commit -m "${m[1].trim()}"`;
      // Status
      if (/(?:estado|status)/i.test(prompt)) return "status";
      if (/(?:push|sube|subir)/i.test(prompt)) return "push";
      if (/(?:pull|jala|bajar)/i.test(prompt)) return "pull";
      return m[1]?.trim() || "status";
    }
  }
  return null;
}

function extractNaturalDockerIntent(input: string): string | null {
  const prompt = String(input || "").trim();
  const patterns = [
    /^docker\s+(.+)$/i,
    /\b(?:contenedores|containers)\s+(?:activos|running|corriendo)\b/i,
    /\b(?:muestra|muéstrame|show|list|lista)\s+(?:los\s+)?(?:contenedores|containers|dockers?)\b/i,
    /\b(?:imágenes|imagenes|images)\s+(?:de\s+)?docker\b/i,
  ];
  for (const re of patterns) {
    const m = prompt.match(re);
    if (m) {
      if (/^docker\s+/i.test(prompt)) return prompt.replace(/^docker\s+/i, "").trim();
      if (/(?:contenedores|containers)/i.test(prompt)) return "ps";
      if (/(?:imágenes|imagenes|images)/i.test(prompt)) return "images";
      return m[1]?.trim() || "ps";
    }
  }
  return null;
}

function extractNaturalInstallIntent(input: string): { manager: string; packages: string[] } | null {
  const prompt = String(input || "").trim();
  const patterns = [
    // "instala express con npm" / "npm install express"
    /\b(?:instala|instalar|install)\s+(.+?)\s+(?:con|with|using|via)\s+(npm|pip|brew|pip3)\b/i,
    /\b(npm|pip|pip3|brew)\s+install\s+(.+?)\s*$/i,
    // "instala X usando npm"
    /\b(?:instala|instalar|install)\s+(.+?)\s+(?:usando|con)\s+(npm|pip|brew|pip3)\b/i,
  ];
  for (const re of patterns) {
    const m = prompt.match(re);
    if (m) {
      let manager: string;
      let pkgStr: string;
      if (/^(?:npm|pip|pip3|brew)\s+install/i.test(prompt)) {
        manager = m[1].toLowerCase().replace("pip3", "pip");
        pkgStr = m[2];
      } else {
        pkgStr = m[1];
        manager = m[2].toLowerCase().replace("pip3", "pip");
      }
      const packages = pkgStr.split(/[\s,]+/).filter(Boolean);
      if (packages.length > 0) return { manager, packages };
    }
  }
  return null;
}

function extractNaturalScriptIntent(input: string): { file: string; language?: string } | null {
  const prompt = String(input || "").trim();
  const patterns = [
    // "ejecuta el script test.py" / "corre main.js" / "run script.sh"
    /\b(?:ejecuta|ejecutar|corre|correr|run)\s+(?:el\s+)?(?:script|archivo|file)\s+["']?([^\s"']{2,}\.\w{1,10})["']?/i,
    // "python test.py" / "node main.js"
    /^(?:python3?|node|bash|sh)\s+["']?([^\s"']{2,}\.\w{1,10})["']?/i,
  ];
  for (const re of patterns) {
    const m = prompt.match(re);
    if (m?.[1]?.trim()) {
      const file = m[1].trim();
      const ext = path.extname(file).toLowerCase();
      let language: string | undefined;
      if ([".py", ".python"].includes(ext)) language = "python";
      else if ([".js", ".mjs", ".cjs"].includes(ext)) language = "node";
      else if ([".sh", ".bash", ".zsh"].includes(ext)) language = "bash";
      else if ([".ts", ".tsx"].includes(ext)) language = "node";
      return { file, language };
    }
  }
  return null;
}

function extractNaturalFindIntent(input: string): { pattern: string; dir?: string } | null {
  const prompt = String(input || "").trim();
  const patterns = [
    // "busca archivos .txt en mi escritorio" / "find all json files"
    /\b(?:busca|buscar|find|search)\s+(?:todos?\s+(?:los\s+)?)?(?:archivos|files)\s+(?:con\s+extensión\s+)?["']?(\.\w+|\*\.\w+)["']?\s*(?:en|in)\s+(?:mi\s+)?["']?([^"'\n]{1,120})["']?/i,
    // "busca archivos .txt" (no dir)
    /\b(?:busca|buscar|find|search)\s+(?:todos?\s+(?:los\s+)?)?(?:archivos|files)\s+(?:con\s+extensión\s+)?["']?(\.\w+|\*\.\w+)["']?\s*$/i,
    // "busca *.ts" / "find *.json"
    /\b(?:busca|buscar|find|search)\s+["']?(\*?\.\w+)["']?\s*(?:(?:en|in)\s+(?:mi\s+)?["']?([^"'\n]{1,120})["']?)?\s*$/i,
  ];
  for (const re of patterns) {
    const m = prompt.match(re);
    if (m?.[1]?.trim()) {
      let pattern = m[1].trim();
      if (!pattern.startsWith("*")) pattern = `*${pattern}`;
      let dir = m[2]?.trim();
      if (dir && /^(?:escritorio|desktop)$/i.test(dir)) dir = "desktop:";
      return { pattern, dir };
    }
  }
  return null;
}

function extractNaturalCdIntent(input: string): string | null {
  const prompt = String(input || "").trim();
  const patterns = [
    // "ve a la carpeta X" / "entra en el directorio X" / "cd al proyecto"
    /\b(?:ve|ir|entra|entrar|cambia|cambiar|go|move|switch)\s+(?:a\s+(?:la\s+)?|en\s+(?:el\s+)?|al?\s+|to\s+)(?:carpeta|directorio|folder|directory|dir)?\s*["']?([^"'\n]{1,160})["']?\s*$/i,
    // "cd /tmp" / "cd ~/Desktop"
    /^cd\s+["']?([^"'\n]{1,160})["']?\s*$/i,
  ];
  for (const re of patterns) {
    const m = prompt.match(re);
    if (m?.[1]?.trim()) return m[1].trim();
  }
  return null;
}

function extractNaturalPythonIntent(input: string): string | null {
  const prompt = String(input || "").trim();
  // "python: print('hola')" / "py: 2+2" / "ejecuta en python: ..."
  const patterns = [
    /^(?:python3?|py)\s*[:\-]\s*(.+)$/i,
    /\b(?:ejecuta|run|corre)\s+(?:en\s+)?(?:python3?|py)\s*[:\-]\s*(.+)$/i,
    /^(?:python3?|py)\s+(?![\w/\\~.])(.+)$/i,
  ];
  for (const re of patterns) {
    const m = prompt.match(re);
    if (m?.[1]?.trim()) return m[1].trim();
  }
  return null;
}

function extractNaturalNodeIntent(input: string): string | null {
  const prompt = String(input || "").trim();
  const patterns = [
    /^(?:node|js)\s*[:\-]\s*(.+)$/i,
    /\b(?:ejecuta|run|corre)\s+(?:en\s+)?(?:node|javascript|js)\s*[:\-]\s*(.+)$/i,
  ];
  for (const re of patterns) {
    const m = prompt.match(re);
    if (m?.[1]?.trim()) return m[1].trim();
  }
  return null;
}

/**
 * Detects when the user asks about ILIAGPT's local control capabilities.
 * E.g.: "tienes acceso a mi terminal?", "puedes crear archivos?", "qué puedes hacer en mi computadora?"
 */
function isCapabilityQuery(input: string): boolean {
  const prompt = String(input || "").trim().toLowerCase();
  const patterns = [
    // "tienes acceso a mi terminal/computadora/archivos/sistema"
    /\b(?:tienes|tiene|tenés|tengo|hay)\s+(?:acceso|conexión|conexion)\s+(?:a\s+)?(?:mi|la|el|al)?\s*(?:terminal|computadora|computador|pc|mac|sistema|archivos|files|shell|consola|equipo|ordenador|laptop|maquina|máquina)\b/i,
    // "puedes acceder/ver/controlar/ejecutar/usar mi terminal"
    /\b(?:puedes|puede|podés|podrías|podrias|pueden|se\s+puede|es\s+posible|eres\s+capaz)\s+(?:acceder|ver|controlar|ejecutar|usar|manejar|gestionar|administrar|operar|correr|abrir|tocar)\s+(?:a\s+|en\s+)?(?:mi|la|el|al)?\s*(?:terminal|computadora|computador|pc|mac|sistema|archivos|files|shell|consola|equipo|carpetas|folders|disco|disk)\b/i,
    // "tienes acceso a la terminal" / "tienes acceso al sistema"
    /\b(?:tienes|tiene)\s+acceso\b/i,
    // "puedes ejecutar comandos" / "puedes correr scripts"
    /\b(?:puedes|puede|podés)\s+(?:ejecutar|correr|run|crear|eliminar|borrar|leer|escribir|abrir|instalar|desinstalar)\s+(?:comandos|scripts|archivos|carpetas|programas|paquetes|apps|aplicaciones)\b/i,
    // "qué puedes hacer en mi computadora/con mi terminal"
    /\b(?:qué|que|what)\s+(?:puedes|puede|podés|can\s+you)\s+(?:hacer|do)\s+(?:en|con|with|in|on)\s+(?:mi|la|el|al)?\s*(?:terminal|computadora|computador|pc|mac|sistema|equipo)\b/i,
    // "qué capacidades tienes" / "cuáles son tus capacidades"
    /\b(?:qué|que|cuáles|cuales|what)\s+(?:capacidades|habilidades|abilities|capabilities|poderes|funciones|features|powers)\s+(?:tienes|tiene|tenés|do\s+you\s+have)\b/i,
    // "can you access my terminal" / "do you have access to my computer"
    /\b(?:can\s+you|do\s+you)\s+(?:access|control|use|run|execute|manage)\s+(?:my|the)\s+(?:terminal|computer|system|files|shell|machine)\b/i,
    // "do you have access" / "have access to"
    /\b(?:do\s+you\s+have|have\s+you\s+got)\s+access\b/i,
    // Direct: "acceso a mi terminal" / "controlar mi computadora"
    /\b(?:acceso|control|acceder)\s+(?:a\s+)?(?:mi|la|el)?\s*(?:terminal|computadora|equipo|sistema|consola|pc|mac)\b/i,
  ];
  return patterns.some(re => re.test(prompt));
}

function buildCapabilityResponse(): string {
  return `**Sí, tengo acceso completo a tu computadora.** Aquí están mis capacidades:

🖥️ **Terminal**: Puedo ejecutar cualquier comando en tu terminal (bash, zsh, etc.)
📂 **Archivos**: Crear, leer, escribir, copiar, mover, eliminar archivos y carpetas
🔍 **Búsqueda**: Buscar archivos por nombre, buscar texto dentro de archivos (+ Spotlight)
💻 **Código**: Ejecutar Python, Node.js, scripts de cualquier lenguaje
📊 **Sistema**: Ver procesos, puertos, CPU, RAM, disco, info del sistema
📦 **Paquetes**: npm, pip, brew — instalar, listar, actualizar
🔧 **Git**: status, commit, push, pull, diff, log, branch
🐳 **Docker**: containers, images, run, stop
📱 **Apps**: Abrir, cerrar, enfocar aplicaciones — gestión de ventanas
🍎 **macOS Nativo**:
  - 🔊 Volumen y brillo
  - 📶 WiFi y Bluetooth
  - 🌙 Dark mode y No Molestar
  - 🔒 Bloquear pantalla / suspender
  - 📸 Screenshots nativos
  - 📋 Clipboard (copiar/pegar)
  - 🔔 Notificaciones del sistema
  - 🗣️ Text-to-Speech (decir texto en voz alta)
  - 📅 Calendario, Contactos, Recordatorios
  - 🎵 Control de Music/Spotify
  - 🔎 Búsqueda Spotlight
  - ⚡ Ejecutar Shortcuts de macOS
  - 📁 Control de Finder
  - 🪟 Gestión de ventanas (mover, redimensionar, minimizar)
  - 🍏 AppleScript/JXA directo

**Pruébame:** Dime qué necesitas y lo ejecuto directamente.`;
}

type LocalControlCommand =
  | "help"
  | "status"
  | "deteneroff"
  | "deteneron"
  | "mkdir"
  | "ls"
  | "mv"
  | "rename"
  | "rm"
  | "touch"
  | "read"
  | "write"
  | "append"
  | "replace"
  | "stat"
  | "sysinfo"
  | "shell"
  | "cp"
  // ── New commands (Phase 1 expansion) ──
  | "ps"
  | "kill"
  | "ports"
  | "find"
  | "grep"
  | "tree"
  | "chmod"
  | "diff"
  | "python"
  | "node"
  | "script"
  | "npm"
  | "pip"
  | "brew"
  | "git"
  | "docker"
  | "cd"
  | "pwd"
  | "history"
  | "monitor"
  | "open"
  | "env"
  | "top"
  | "du"
  | "which"
  | "capabilities"
  // ── macOS native commands ──
  | "volume"
  | "brightness"
  | "darkmode"
  | "wifi"
  | "bluetooth"
  | "battery"
  | "lock"
  | "screenshot"
  | "clipboard"
  | "notify"
  | "say"
  | "calendar"
  | "contacts"
  | "reminders"
  | "spotlight"
  | "shortcut"
  | "music"
  | "apps"
  | "windows"
  | "finder"
  | "osascript";

type LocalControlRequest = {
  command: LocalControlCommand;
  args: string[];
  token: string | null;
  confirm: boolean;
  raw: string;
  source: "prefixed" | "natural" | "kill_switch";
};

type LocalControlState = {
  disabled: boolean;
  updatedAt: string;
  updatedBy?: string;
  reason?: string;
};

export type LocalControlResult =
  | { handled: false }
  | {
    handled: true;
    ok: boolean;
    statusCode: number;
    code: string;
    message: string;
    payload?: Record<string, unknown>;
  };

const LOCAL_ACTION_AUDIT_LOG_PATH = path.join(os.homedir(), ".iliagpt-control-audit.log");
const LOCAL_ACTION_STATE_PATH = path.join(os.homedir(), ".iliagpt-local-actions-state.json");
const LOCAL_ACTIONS_DEFAULT_ROOT = path.resolve(path.join(os.homedir(), "Desktop"));
const LOCAL_ACTIONS_PROJECT_ROOT = path.resolve(process.cwd());
const LOCAL_ACTION_ADMIN_TOKEN = (process.env.ILIAGPT_LOCAL_ACTION_TOKEN || "").trim();
const LOCAL_MAX_CONTROL_ENABLED =
  process.env.ILIAGPT_LOCAL_FULL_SHELL === "true" ||
  process.env.ILIAGPT_LOCAL_FULL_ACCESS === "true";
const LOCAL_FULL_SHELL_ENABLED =
  process.env.ILIAGPT_LOCAL_FULL_SHELL === "true" ||
  process.env.ILIAGPT_LOCAL_FULL_ACCESS === "true" ||
  process.env.NODE_ENV !== "production";
const LOCAL_CONFIRM_RE = /\b(?:confirmar|confirm|--confirm)\b/i;
const LOCAL_TOKEN_RE = /(?:^|\s)token=([^\s]+)/i;
const LOCAL_SHELL_TIMEOUT_MS = 45_000;
const LOCAL_SHELL_MAX_STDOUT_CHARS = 24_000;
const LOCAL_SHELL_MAX_STDERR_CHARS = 8_000;
const LOCAL_SHELL_MAX_BUFFER_BYTES = 8 * 1024 * 1024;

// ── TerminalController Session Manager ──
// Module-level to avoid bundler try/catch variable renaming bug
let _localTerminalSessionId: string | null = null;
let _localTerminalSessionCwd: string = LOCAL_ACTIONS_DEFAULT_ROOT;
let _localCommandHistory: Array<{ ts: string; command: string; exitCode: number | null }> = [];

function getOrCreateLocalTerminalSession(): string {
  if (_localTerminalSessionId) {
    try {
      terminalController.getCwd(_localTerminalSessionId);
      return _localTerminalSessionId;
    } catch {
      _localTerminalSessionId = null;
    }
  }
  _localTerminalSessionId = terminalController.createSession(os.homedir(), { ...process.env as Record<string, string> });
  _localTerminalSessionCwd = LOCAL_ACTIONS_DEFAULT_ROOT;
  return _localTerminalSessionId;
}

function pushLocalCommandHistory(command: string, exitCode: number | null): void {
  _localCommandHistory.push({ ts: new Date().toISOString(), command, exitCode });
  if (_localCommandHistory.length > 200) _localCommandHistory = _localCommandHistory.slice(-200);
}

type LocalShellExecutionResult = {
  commandLine: string;
  cwd: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
  timedOut: boolean;
};

function shellQuoteArg(value: string): string {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function normalizeLocalSignal(rawSignal?: string): string {
  const cleaned = String(rawSignal || "SIGTERM").trim().toUpperCase();
  if (!cleaned) return "SIGTERM";
  const normalized = cleaned.startsWith("SIG") ? cleaned : `SIG${cleaned}`;
  if (!/^SIG[A-Z0-9]+$/.test(normalized)) return "SIGTERM";
  return normalized;
}

function ensureLocalCwd(allowedRoots: string[]): string {
  const current = path.resolve(_localTerminalSessionCwd || LOCAL_ACTIONS_DEFAULT_ROOT);
  if (isAllowedLocalPath(current, allowedRoots)) {
    return current;
  }
  const fallback = isAllowedLocalPath(LOCAL_ACTIONS_DEFAULT_ROOT, allowedRoots)
    ? LOCAL_ACTIONS_DEFAULT_ROOT
    : allowedRoots[0] || path.resolve("/");
  _localTerminalSessionCwd = path.resolve(fallback);
  return _localTerminalSessionCwd;
}

function formatLocalShellMessage(result: LocalShellExecutionResult): string {
  const header = `$ ${result.commandLine}`;
  const stdoutBlock = result.stdout || "(sin salida)";
  const truncatedInfo = result.truncated ? "\n[...salida truncada...]" : "";
  const pieces = [
    `cwd: ${result.cwd}`,
    `\`\`\`\n${header}\n${stdoutBlock}${truncatedInfo}\n\`\`\``,
  ];
  if (result.stderr) {
    pieces.push(`STDERR:\n\`\`\`\n${result.stderr}\n\`\`\``);
  }
  pieces.push(`exit_code=${result.exitCode}${result.timedOut ? " (timeout)" : ""}`);
  return pieces.join("\n");
}

async function runLocalShellCommand(
  commandLine: string,
  options: {
    allowedRoots: string[];
    cwd?: string;
    timeoutMs?: number;
    stdoutMaxChars?: number;
    stderrMaxChars?: number;
  }
): Promise<LocalShellExecutionResult> {
  const trimmedCommand = String(commandLine || "").trim();
  const cwd = path.resolve(options.cwd || ensureLocalCwd(options.allowedRoots));
  const timeoutMs = Math.max(1000, options.timeoutMs ?? LOCAL_SHELL_TIMEOUT_MS);
  const stdoutMaxChars = Math.max(500, options.stdoutMaxChars ?? LOCAL_SHELL_MAX_STDOUT_CHARS);
  const stderrMaxChars = Math.max(500, options.stderrMaxChars ?? LOCAL_SHELL_MAX_STDERR_CHARS);

  if (!trimmedCommand) {
    return {
      commandLine: "",
      cwd,
      exitCode: 1,
      stdout: "",
      stderr: "Comando vacio.",
      truncated: false,
      timedOut: false,
    };
  }

  const BLOCKED_SHELL_PATTERNS = [
    /:\(\)\s*\{.*\}\s*;/i, // fork bomb
    /\bdd\s+if=\/dev\/(zero|random)/i, // disk destroyer
    /\bmkfs\b/i, // filesystem formatting
    />\s*\/dev\/(sd[a-z]\d*|disk\d+)/i, // writes to raw disks
  ];
  for (const pattern of BLOCKED_SHELL_PATTERNS) {
    if (pattern.test(trimmedCommand)) {
      return {
        commandLine: trimmedCommand,
        cwd,
        exitCode: 1,
        stdout: "",
        stderr: "Comando bloqueado por filtro de seguridad.",
        truncated: false,
        timedOut: false,
      };
    }
  }

  const { execFile } = await import("child_process");
  const { promisify } = await import("util");
  const execFileAsync = promisify(execFile);

  try {
    const runResult = await execFileAsync("/bin/bash", ["-lc", `set -o pipefail; ${trimmedCommand}`], {
      timeout: timeoutMs,
      maxBuffer: LOCAL_SHELL_MAX_BUFFER_BYTES,
      cwd,
      env: { ...process.env, HOME: os.homedir(), PWD: cwd },
    });
    const rawStdout = String(runResult.stdout || "");
    const rawStderr = String(runResult.stderr || "");
    const stdout = rawStdout.slice(0, stdoutMaxChars);
    const stderr = rawStderr.slice(0, stderrMaxChars);
    const truncated = rawStdout.length > stdout.length || rawStderr.length > stderr.length;
    pushLocalCommandHistory(trimmedCommand, 0);
    return {
      commandLine: trimmedCommand,
      cwd,
      exitCode: 0,
      stdout,
      stderr,
      truncated,
      timedOut: false,
    };
  } catch (error: any) {
    const rawStdout = String(error?.stdout || "");
    const stderrFromProcess = String(error?.stderr || "");
    const rawExitCandidate = error?.code ?? error?.status;
    const parsedExitCandidate = typeof rawExitCandidate === "number"
      ? rawExitCandidate
      : Number.parseInt(String(rawExitCandidate ?? ""), 10);
    const hasKnownExitCode = Number.isFinite(parsedExitCandidate);
    const exitCode = hasKnownExitCode ? Number(parsedExitCandidate) : 1;
    const fallbackMessage = String(error?.message || "");
    const shouldUseFallbackMessage =
      !stderrFromProcess &&
      !rawStdout &&
      !hasKnownExitCode;
    const rawStderr = stderrFromProcess || (shouldUseFallbackMessage ? fallbackMessage : "");
    const stdout = rawStdout.slice(0, stdoutMaxChars);
    const stderr = rawStderr.slice(0, stderrMaxChars);
    const timedOut = Boolean(error?.killed);
    const truncated = rawStdout.length > stdout.length || rawStderr.length > stderr.length;
    pushLocalCommandHistory(trimmedCommand, exitCode);
    return {
      commandLine: trimmedCommand,
      cwd,
      exitCode,
      stdout,
      stderr,
      truncated,
      timedOut,
    };
  }
}

function tokenizeLocalCommand(input: string): string[] {
  const tokens: string[] = [];
  const tokenRegex = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null = null;
  while ((match = tokenRegex.exec(input)) !== null) {
    const token = (match[1] ?? match[2] ?? match[3] ?? "").trim();
    if (token) tokens.push(token);
  }
  return tokens;
}

function extractLocalToken(input: string): string | null {
  const match = String(input || "").match(LOCAL_TOKEN_RE);
  return match?.[1]?.trim() || null;
}

function parseConfiguredLocalRoot(rawRoot: string): string | null {
  const trimmed = rawRoot.trim();
  if (!trimmed) return null;
  if (/^desktop$/i.test(trimmed)) return LOCAL_ACTIONS_DEFAULT_ROOT;
  if (/^project$/i.test(trimmed)) return LOCAL_ACTIONS_PROJECT_ROOT;
  if (trimmed.startsWith("~/")) return path.resolve(path.join(os.homedir(), trimmed.slice(2)));
  return path.isAbsolute(trimmed)
    ? path.resolve(trimmed)
    : path.resolve(LOCAL_ACTIONS_PROJECT_ROOT, trimmed);
}

function getAllowedLocalRoots(): string[] {
  const roots = new Set<string>([LOCAL_ACTIONS_DEFAULT_ROOT, LOCAL_ACTIONS_PROJECT_ROOT]);
  if (LOCAL_MAX_CONTROL_ENABLED) {
    roots.add(path.resolve("/"));
  }
  const rawRoots = process.env.ILIAGPT_LOCAL_ALLOWED_ROOTS;
  if (rawRoots) {
    for (const segment of rawRoots.split(",")) {
      const parsed = parseConfiguredLocalRoot(segment);
      if (parsed) roots.add(parsed);
    }
  }
  return Array.from(roots);
}

function isPathInsideRoot(targetPath: string, rootPath: string): boolean {
  const resolvedTarget = path.resolve(targetPath);
  const resolvedRoot = path.resolve(rootPath);
  // Special-case filesystem root ("/" on macOS/Linux): every absolute path is inside it.
  if (resolvedRoot === path.parse(resolvedRoot).root) {
    return path.isAbsolute(resolvedTarget);
  }
  return resolvedTarget === resolvedRoot || resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`);
}

function isAllowedLocalPath(targetPath: string, allowedRoots: string[]): boolean {
  return allowedRoots.some((rootPath) => isPathInsideRoot(targetPath, rootPath));
}

function resolveLocalPath(rawPath: string | undefined, basePath: string = LOCAL_ACTIONS_DEFAULT_ROOT): string {
  const trimmed = String(rawPath || "").trim();
  if (!trimmed) return path.resolve(basePath);

  if (trimmed.startsWith("~/")) {
    return path.resolve(path.join(os.homedir(), trimmed.slice(2)));
  }

  const desktopAlias = trimmed.match(/^desktop:(.*)$/i);
  if (desktopAlias) {
    const relative = (desktopAlias[1] || "").trim().replace(/^[/\\]+/, "");
    return path.resolve(LOCAL_ACTIONS_DEFAULT_ROOT, relative);
  }

  const projectAlias = trimmed.match(/^project:(.*)$/i);
  if (projectAlias) {
    const relative = (projectAlias[1] || "").trim().replace(/^[/\\]+/, "");
    return path.resolve(LOCAL_ACTIONS_PROJECT_ROOT, relative);
  }

  if (path.isAbsolute(trimmed)) {
    return path.resolve(trimmed);
  }

  return path.resolve(basePath, trimmed);
}

const LOCAL_FILE_READ_MAX_BYTES = 120_000;
const LOCAL_FILE_READ_MAX_CHARS = 16_000;
const LOCAL_FILE_WRITE_MAX_CHARS = 200_000;

function formatLocalBytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unitIdx = 0;
  while (size >= 1024 && unitIdx < units.length - 1) {
    size /= 1024;
    unitIdx += 1;
  }
  const rounded = size >= 10 || unitIdx === 0 ? size.toFixed(0) : size.toFixed(1);
  return `${rounded} ${units[unitIdx]}`;
}

function isLikelyTextBuffer(buffer: Buffer): boolean {
  if (!buffer.length) return true;
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  let suspiciousBytes = 0;
  for (const byte of sample) {
    if (byte === 0) return false;
    const isControl = byte < 32 && byte !== 9 && byte !== 10 && byte !== 13;
    if (isControl) suspiciousBytes += 1;
  }
  return suspiciousBytes / sample.length < 0.12;
}

function isProtectedLocalRootPath(targetPath: string, allowedRoots: string[]): boolean {
  const resolvedTarget = path.resolve(targetPath);
  return allowedRoots.some((rootPath) => path.resolve(rootPath) === resolvedTarget);
}

async function readLocalControlState(): Promise<LocalControlState> {
  try {
    const raw = await fs.readFile(LOCAL_ACTION_STATE_PATH, "utf-8");
    const parsed = JSON.parse(raw) as Partial<LocalControlState>;
    if (typeof parsed.disabled === "boolean") {
      return {
        disabled: parsed.disabled,
        updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date(0).toISOString(),
        updatedBy: typeof parsed.updatedBy === "string" ? parsed.updatedBy : undefined,
        reason: typeof parsed.reason === "string" ? parsed.reason : undefined,
      };
    }
  } catch {
    // File not found/invalid: treat as enabled.
  }
  return {
    disabled: false,
    updatedAt: new Date(0).toISOString(),
  };
}

async function writeLocalControlState(disabled: boolean, updatedBy: string, reason: string): Promise<LocalControlState> {
  const nextState: LocalControlState = {
    disabled,
    updatedAt: new Date().toISOString(),
    updatedBy,
    reason,
  };
  await fs.writeFile(LOCAL_ACTION_STATE_PATH, JSON.stringify(nextState, null, 2), "utf-8");
  return nextState;
}

async function appendLocalControlAudit(event: string, payload: Record<string, unknown>): Promise<void> {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    event,
    ...payload,
  });
  try {
    await fs.appendFile(LOCAL_ACTION_AUDIT_LOG_PATH, `${line}\n`, "utf-8");
  } catch (error) {
    console.warn("[LocalControl] audit append failed:", (error as Error)?.message || error);
  }
}

function buildLocalHelpText(): string {
  const tokenHint = LOCAL_ACTION_ADMIN_TOKEN
    ? "Incluye token=<tu_token> en comandos de ejecucion."
    : "Tip: configura ILIAGPT_LOCAL_ACTION_TOKEN para requerir token admin.";
  return [
    "=== Control Local ILIAGPT — 42 Comandos ===\n",
    "📂 Archivos:",
    "  ls [ruta] • mkdir <ruta> • touch <archivo> • read <archivo>",
    "  write <archivo> \"contenido\" • append <archivo> \"contenido\"",
    "  replace <archivo> \"buscar\" \"reemplazo\" confirmar",
    "  mv <origen> <destino> • rename <origen> <nuevo> • rm <ruta> confirmar",
    "  cp <origen> <destino> • stat <ruta> • find <patron> [ruta]",
    "  grep <patron> <archivo|ruta> • tree [ruta] • chmod <permisos> <ruta>",
    "  diff <archivo1> <archivo2>\n",
    "💻 Terminal:",
    "  shell <comando> • cd <ruta> • pwd • history",
    "  python <codigo|archivo> • node <codigo|archivo> • script <archivo>",
    "  open <app|archivo> • env [VAR=valor] • which <programa>\n",
    "📊 Sistema:",
    "  sysinfo • ps • kill <PID> • ports • top • du <ruta> • monitor\n",
    "📦 Paquetes:",
    "  npm <subcomando> • pip <subcomando> • brew <subcomando>\n",
    "🔧 Git:",
    "  git status • git add . • git commit -m \"msg\" • git push",
    "  git pull • git diff • git log • git branch\n",
    "🐳 Docker:",
    "  docker ps • docker images • docker run <image> <cmd>",
    "  docker stop <id> • docker rm <id>\n",
    "⚙️ Control:",
    "  help • status • DETENEROFF • DETENERON token=<token> confirmar\n",
    "Lenguaje natural soportado:",
    '  "muéstrame los procesos" • "qué puertos están abiertos"',
    '  "mata el proceso 1234" • "busca archivos .txt en mi escritorio"',
    '  "git status" • "instala express con npm"',
    '  "ejecuta en python: print(2+2)" • "ve a la carpeta /tmp"',
    "",
    LOCAL_MAX_CONTROL_ENABLED
      ? "🟢 Modo max-control activo: rutas de sistema permitidas."
      : "🔴 Modo restringido: limita rutas con ILIAGPT_LOCAL_ALLOWED_ROOTS.",
    tokenHint,
  ].join("\n");
}

function parseLocalControlRequest(input: string): LocalControlRequest | null {
  const raw = String(input || "").trim();
  if (!raw) return null;

  const tokenFromRaw = extractLocalToken(raw);
  const confirmFromRaw = LOCAL_CONFIRM_RE.test(raw);

  if (/^(?:deteneroff|deterneroff)\b/i.test(raw)) {
    return {
      command: "deteneroff",
      args: [],
      token: tokenFromRaw,
      confirm: confirmFromRaw,
      raw,
      source: "kill_switch",
    };
  }

  if (/^(?:deteneron|deterneron)\b/i.test(raw)) {
    return {
      command: "deteneron",
      args: [],
      token: tokenFromRaw,
      confirm: confirmFromRaw,
      raw,
      source: "kill_switch",
    };
  }

  const prefixedMatch = raw.match(/^(?:\/local|local:)\s*(.*)$/i);
  if (!prefixedMatch) {
    // ── Natural language detection for ALL local commands ──

    // 1. mkdir — "crea una carpeta llamada X en mi escritorio"
    const folderName = extractDesktopFolderNameFromPrompt(raw);
    if (folderName) {
      return { command: "mkdir", args: [folderName], token: tokenFromRaw, confirm: confirmFromRaw, raw, source: "natural" };
    }

    // 2. rm — "elimina/borra/delete la carpeta/archivo X"
    const rmIntent = extractNaturalRmIntent(raw);
    if (rmIntent) {
      return { command: "rm", args: [rmIntent], token: tokenFromRaw, confirm: true, raw, source: "natural" };
    }

    // 3. read — "lee/muéstrame/abre el archivo X" / "qué contiene X"
    const readIntent = extractNaturalReadIntent(raw);
    if (readIntent) {
      return { command: "read", args: [readIntent], token: tokenFromRaw, confirm: confirmFromRaw, raw, source: "natural" };
    }

    // 3.5 Capability query — MUST be checked BEFORE shell intent to avoid "puedes ejecutar comandos" matching shell
    if (isCapabilityQuery(raw)) {
      return { command: "capabilities" as LocalControlCommand, args: [], token: tokenFromRaw, confirm: confirmFromRaw, raw, source: "natural" };
    }

    // 4. shell — "ejecuta/corre/run el comando X" / "en la terminal haz X"
    const shellIntent = extractNaturalShellIntent(raw);
    if (shellIntent) {
      return { command: "shell", args: [shellIntent], token: tokenFromRaw, confirm: confirmFromRaw, raw, source: "natural" };
    }

    // 5. sysinfo — "info del sistema" / "cuanta memoria" / "espacio en disco"
    const sysinfoIntent = extractNaturalSysinfoIntent(raw);
    if (sysinfoIntent) {
      return { command: "sysinfo", args: [], token: tokenFromRaw, confirm: confirmFromRaw, raw, source: "natural" };
    }

    // 6. write — "crea un archivo X con el contenido Y"
    const writeIntent = extractNaturalWriteIntent(raw);
    if (writeIntent) {
      return { command: "write", args: [writeIntent.path, writeIntent.content], token: tokenFromRaw, confirm: confirmFromRaw, raw, source: "natural" };
    }

    // 7. ls — "muéstrame los archivos de mi escritorio" / "lista las carpetas"
    const lsIntent = extractNaturalLsIntent(raw);
    if (lsIntent) {
      return { command: "ls", args: lsIntent ? [lsIntent] : [], token: tokenFromRaw, confirm: confirmFromRaw, raw, source: "natural" };
    }

    // 8. ps — "muéstrame los procesos" / "qué procesos están corriendo"
    if (extractNaturalPsIntent(raw)) {
      return { command: "ps", args: [], token: tokenFromRaw, confirm: confirmFromRaw, raw, source: "natural" };
    }

    // 9. kill — "mata el proceso X" / "kill 1234"
    const killIntent = extractNaturalKillIntent(raw);
    if (killIntent) {
      return { command: "kill", args: [killIntent.pid || killIntent.name || ""], token: tokenFromRaw, confirm: true, raw, source: "natural" };
    }

    // 10. ports — "qué puertos están abiertos"
    if (extractNaturalPortsIntent(raw)) {
      return { command: "ports", args: [], token: tokenFromRaw, confirm: confirmFromRaw, raw, source: "natural" };
    }

    // 11. git — "git status" / "haz un commit con mensaje X"
    const gitIntent = extractNaturalGitIntent(raw);
    if (gitIntent) {
      return { command: "git", args: [gitIntent], token: tokenFromRaw, confirm: confirmFromRaw, raw, source: "natural" };
    }

    // 12. docker — "docker ps" / "contenedores activos"
    const dockerIntent = extractNaturalDockerIntent(raw);
    if (dockerIntent) {
      return { command: "docker", args: [dockerIntent], token: tokenFromRaw, confirm: confirmFromRaw, raw, source: "natural" };
    }

    // 13. install — "instala express con npm" / "pip install numpy"
    const installIntent = extractNaturalInstallIntent(raw);
    if (installIntent) {
      const cmd = installIntent.manager === "pip" ? "pip" : installIntent.manager === "brew" ? "brew" : "npm";
      return { command: cmd as LocalControlCommand, args: ["install", ...installIntent.packages], token: tokenFromRaw, confirm: confirmFromRaw, raw, source: "natural" };
    }

    // 14. script — "ejecuta el script test.py" / "corre main.js"
    const scriptIntent = extractNaturalScriptIntent(raw);
    if (scriptIntent) {
      return { command: "script", args: [scriptIntent.file], token: tokenFromRaw, confirm: confirmFromRaw, raw, source: "natural" };
    }

    // 15. find — "busca archivos .txt en mi escritorio"
    const findIntent = extractNaturalFindIntent(raw);
    if (findIntent) {
      const findArgs = [findIntent.pattern];
      if (findIntent.dir) findArgs.push(findIntent.dir);
      return { command: "find", args: findArgs, token: tokenFromRaw, confirm: confirmFromRaw, raw, source: "natural" };
    }

    // 16. cd — "ve a la carpeta X" / "cd /tmp"
    const cdIntent = extractNaturalCdIntent(raw);
    if (cdIntent) {
      return { command: "cd", args: [cdIntent], token: tokenFromRaw, confirm: confirmFromRaw, raw, source: "natural" };
    }

    // 17. python inline — "python: print(2+2)"
    const pythonIntent = extractNaturalPythonIntent(raw);
    if (pythonIntent) {
      return { command: "python", args: [pythonIntent], token: tokenFromRaw, confirm: confirmFromRaw, raw, source: "natural" };
    }

    // 18. node inline — "node: console.log('hello')"
    const nodeIntent = extractNaturalNodeIntent(raw);
    if (nodeIntent) {
      return { command: "node", args: [nodeIntent], token: tokenFromRaw, confirm: confirmFromRaw, raw, source: "natural" };
    }

    // 19. direct terminal line — "git status", "npm run dev", "docker ps", etc.
    // Route to dedicated handlers when possible
    const directCmdMatch = raw.match(/^(git|npm|pip|pip3|brew|docker)\s+(.*)/i);
    if (directCmdMatch) {
      const tool = directCmdMatch[1].toLowerCase().replace("pip3", "pip") as LocalControlCommand;
      const subArgs = directCmdMatch[2]?.trim() || "";
      return { command: tool, args: subArgs ? [subArgs] : [], token: tokenFromRaw, confirm: confirmFromRaw, raw, source: "natural" };
    }
    // Other direct commands route to shell
    if (/^(?:python3?|node|bash|sh|ps|top|du|which|find|grep|tree|open|kill|ports|lsof)\b/i.test(raw)) {
      return { command: "shell", args: [raw], token: tokenFromRaw, confirm: confirmFromRaw, raw, source: "natural" };
    }

    return null;
  }

  let commandBody = String(prefixedMatch[1] || "").trim();
  const token = extractLocalToken(commandBody);
  const confirm = LOCAL_CONFIRM_RE.test(commandBody);
  commandBody = commandBody
    .replace(/\btoken=[^\s]+\b/gi, " ")
    .replace(/\b(?:confirmar|confirm|--confirm)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  const tokens = tokenizeLocalCommand(commandBody);
  if (!tokens.length) {
    return {
      command: "help",
      args: [],
      token,
      confirm,
      raw,
      source: "prefixed",
    };
  }

  const operation = tokens[0].toLowerCase();
  const args = tokens.slice(1);
  const commandAliasMap: Record<string, LocalControlCommand> = {
    help: "help",
    ayuda: "help",
    status: "status",
    estado: "status",
    ls: "ls",
    dir: "ls",
    listar: "ls",
    mkdir: "mkdir",
    carpeta: "mkdir",
    "crear-carpeta": "mkdir",
    touch: "touch",
    mkfile: "touch",
    archivo: "touch",
    "crear-archivo": "touch",
    cat: "read",
    read: "read",
    leer: "read",
    write: "write",
    escribir: "write",
    guardar: "write",
    append: "append",
    anexar: "append",
    agregar: "append",
    replace: "replace",
    reemplazar: "replace",
    sustituir: "replace",
    stat: "stat",
    detalle: "stat",
    metadata: "stat",
    mv: "mv",
    mover: "mv",
    rename: "rename",
    renombrar: "rename",
    rm: "rm",
    del: "rm",
    delete: "rm",
    borrar: "rm",
    eliminar: "rm",
    sysinfo: "sysinfo",
    sistema: "sysinfo",
    infoequipo: "sysinfo",
    info_pc: "sysinfo",
    info: "sysinfo",
    shell: "shell",
    sh: "shell",
    bash: "shell",
    exec: "shell",
    ejecutar: "shell",
    comando: "shell",
    terminal: "shell",
    cp: "cp",
    copy: "cp",
    copiar: "cp",
    copia: "cp",
    // ── New commands ──
    ps: "ps",
    procesos: "ps",
    processes: "ps",
    kill: "kill",
    matar: "kill",
    terminar: "kill",
    ports: "ports",
    puertos: "ports",
    listening: "ports",
    find: "find",
    buscar: "find",
    search: "find",
    grep: "grep",
    "buscar-contenido": "grep",
    tree: "tree",
    arbol: "tree",
    árbol: "tree",
    chmod: "chmod",
    permisos: "chmod",
    diff: "diff",
    comparar: "diff",
    compare: "diff",
    python: "python",
    py: "python",
    python3: "python",
    node: "node",
    js: "node",
    script: "script",
    "ejecutar-script": "script",
    run: "script",
    correr: "script",
    npm: "npm",
    pip: "pip",
    pip3: "pip",
    brew: "brew",
    homebrew: "brew",
    git: "git",
    docker: "docker",
    contenedor: "docker",
    container: "docker",
    cd: "cd",
    ir: "cd",
    cambiar: "cd",
    pwd: "pwd",
    donde: "pwd",
    "directorio-actual": "pwd",
    history: "history",
    historial: "history",
    monitor: "monitor",
    monitorear: "monitor",
    open: "open",
    abrir: "open",
    "abrir-app": "open",
    env: "env",
    variables: "env",
    entorno: "env",
    top: "top",
    du: "du",
    tamano: "du",
    tamaño: "du",
    which: "which",
    "donde-esta": "which",
    "donde-está": "which",
    df: "shell",
    disco: "shell",
    deteneroff: "deteneroff",
    deterneroff: "deteneroff",
    deteneron: "deteneron",
    deterneron: "deteneron",
    // ── macOS native aliases ──
    volume: "volume",
    volumen: "volume",
    "set-volume": "volume",
    "subir-volumen": "volume",
    "bajar-volumen": "volume",
    mute: "volume",
    unmute: "volume",
    brightness: "brightness",
    brillo: "brightness",
    darkmode: "darkmode",
    "dark-mode": "darkmode",
    "modo-oscuro": "darkmode",
    oscuro: "darkmode",
    wifi: "wifi",
    bluetooth: "bluetooth",
    bt: "bluetooth",
    battery: "battery",
    bateria: "battery",
    batería: "battery",
    lock: "lock",
    bloquear: "lock",
    "bloquear-pantalla": "lock",
    screenshot: "screenshot",
    captura: "screenshot",
    "captura-pantalla": "screenshot",
    pantallazo: "screenshot",
    clipboard: "clipboard",
    portapapeles: "clipboard",
    copiar_clipboard: "clipboard",
    pegar: "clipboard",
    notify: "notify",
    notificar: "notify",
    notificacion: "notify",
    notificación: "notify",
    alerta: "notify",
    say: "say",
    decir: "say",
    hablar: "say",
    calendar: "calendar",
    calendario: "calendar",
    eventos: "calendar",
    contacts: "contacts",
    contactos: "contacts",
    reminders: "reminders",
    recordatorios: "reminders",
    spotlight: "spotlight",
    buscar_spotlight: "spotlight",
    search_spotlight: "spotlight",
    shortcut: "shortcut",
    shortcuts: "shortcut",
    atajo: "shortcut",
    atajos: "shortcut",
    music: "music",
    musica: "music",
    música: "music",
    spotify: "music",
    apps: "apps",
    aplicaciones: "apps",
    windows: "windows",
    ventanas: "windows",
    finder: "finder",
    osascript: "osascript",
    applescript: "osascript",
  };
  const command: LocalControlCommand = commandAliasMap[operation] || "help";

  return {
    command,
    args,
    token,
    confirm,
    raw,
    source: "prefixed",
  };
}

function localErrorResult(statusCode: number, code: string, message: string, payload?: Record<string, unknown>): LocalControlResult {
  return {
    handled: true,
    ok: false,
    statusCode,
    code,
    message,
    payload,
  };
}

function localSuccessResult(code: string, message: string, payload?: Record<string, unknown>): LocalControlResult {
  return {
    handled: true,
    ok: true,
    statusCode: 200,
    code,
    message,
    payload,
  };
}

export async function executeLocalControlRequest(
  input: string,
  context: { requestId: string; userId?: string | null }
): Promise<LocalControlResult> {
  const parsed = parseLocalControlRequest(input);
  if (!parsed) {
    if (looksLikeDesktopFolderIntent(input)) {
      return localErrorResult(
        400,
        "LOCAL_FOLDER_NAME_NOT_DETECTED",
        "Detecte una orden de crear carpeta, pero no pude leer el nombre. Usa: crea una carpeta con nombre <nombre> en mi escritorio."
      );
    }
    return { handled: false };
  }

  if (!LOCAL_DESKTOP_ACTIONS_ENABLED) {
    return localErrorResult(
      403,
      "LOCAL_ACTIONS_DISABLED",
      "Las acciones locales estan desactivadas. Activa ILIAGPT_ENABLE_LOCAL_DESKTOP_ACTIONS=true."
    );
  }

  const actor = (context.userId || "anonymous").slice(0, 120);
  const allowedRoots = getAllowedLocalRoots();
  const tokenRequired = LOCAL_ACTION_ADMIN_TOKEN.length > 0;
  const requiresAdminToken = !["help", "status", "deteneroff"].includes(parsed.command);

  if (tokenRequired && requiresAdminToken && parsed.token !== LOCAL_ACTION_ADMIN_TOKEN) {
    await appendLocalControlAudit("local_control_denied", {
      requestId: context.requestId,
      userId: actor,
      command: parsed.command,
      reason: "invalid_token",
    });
    return localErrorResult(
      401,
      "LOCAL_ACTION_INVALID_TOKEN",
      "Token admin inválido. Usa token=<tu_token>."
    );
  }

  if (parsed.command === "help") {
    return localSuccessResult("LOCAL_HELP", buildLocalHelpText(), {
      command: parsed.command,
      allowedRoots,
      tokenRequired,
    });
  }

  if (parsed.command === "capabilities") {
    return localSuccessResult("LOCAL_CAPABILITIES", buildCapabilityResponse(), {
      command: "capabilities",
    });
  }

  if (parsed.command === "deteneroff") {
    const next = await writeLocalControlState(true, actor, "manual_deteneroff");
    await appendLocalControlAudit("local_control_disabled", {
      requestId: context.requestId,
      userId: actor,
      command: parsed.command,
      state: next,
    });
    return localSuccessResult(
      "LOCAL_ACTIONS_DISABLED_BY_KILL_SWITCH",
      "Kill switch activado (DETENEROFF). Las acciones locales quedaron deshabilitadas."
    );
  }

  const controlState = await readLocalControlState();
  if (parsed.command === "status") {
    const statusText = controlState.disabled ? "DESHABILITADAS" : "HABILITADAS";
    return localSuccessResult(
      "LOCAL_STATUS",
      `Estado actual: ${statusText}.`,
      {
        command: parsed.command,
        state: controlState,
        allowedRoots,
        tokenRequired,
      }
    );
  }

  if (controlState.disabled && parsed.command !== "deteneron") {
    return localErrorResult(
      423,
      "LOCAL_ACTIONS_KILL_SWITCH_ACTIVE",
      "Las acciones locales estan bloqueadas por DETENEROFF. Usa DETENERON token=<token> confirmar para reactivarlas."
    );
  }

  if (parsed.command === "deteneron") {
    if (!parsed.confirm) {
      return localErrorResult(
        400,
        "LOCAL_CONFIRM_REQUIRED",
        "Confirma la reapertura con: DETENERON token=<token> confirmar"
      );
    }
    const next = await writeLocalControlState(false, actor, "manual_deteneron");
    await appendLocalControlAudit("local_control_enabled", {
      requestId: context.requestId,
      userId: actor,
      command: parsed.command,
      state: next,
    });
    return localSuccessResult(
      "LOCAL_ACTIONS_ENABLED",
      "Kill switch desactivado (DETENERON). Las acciones locales volvieron a habilitarse."
    );
  }

  const commandRequiresConfirm = ["mv", "rename", "rm", "replace", "kill", "chmod"].includes(parsed.command);
  if (commandRequiresConfirm && !parsed.confirm) {
    return localErrorResult(
      400,
      "LOCAL_CONFIRM_REQUIRED",
      "Esta accion requiere confirmacion. Repite con la palabra confirmar."
    );
  }

  try {
    if (parsed.command === "mkdir") {
      const targetRaw = parsed.args[0];
      if (!targetRaw) {
        return localErrorResult(400, "LOCAL_MISSING_ARG", "Uso: /local mkdir <ruta>");
      }
      const normalizedTargetRaw = targetRaw.trim();
      const targetForValidation = normalizedTargetRaw.replace(/^(desktop|project):/i, "");
      const targetPath = resolveLocalPath(targetRaw, LOCAL_ACTIONS_DEFAULT_ROOT);
      if (!isAllowedLocalPath(targetPath, allowedRoots)) {
        return localErrorResult(403, "LOCAL_PATH_NOT_ALLOWED", "Ruta fuera de las carpetas permitidas.");
      }
      if (
        /[\\*?"<>|]/.test(targetForValidation) ||
        targetForValidation.includes("..") ||
        /:[^/\\]/.test(targetForValidation)
      ) {
        return localErrorResult(400, "LOCAL_INVALID_FOLDER_NAME", "Nombre o ruta de carpeta inválida.");
      }

      await fs.mkdir(targetPath, { recursive: true });
      await appendLocalControlAudit("local_control_mkdir", {
        requestId: context.requestId,
        userId: actor,
        targetPath,
      });
      return localSuccessResult("LOCAL_MKDIR_OK", `Carpeta creada: ${targetPath}`, {
        command: parsed.command,
        path: targetPath,
      });
    }

    if (parsed.command === "ls") {
      const targetRaw = parsed.args[0] || "desktop:";
      const targetPath = resolveLocalPath(targetRaw, LOCAL_ACTIONS_DEFAULT_ROOT);
      if (!isAllowedLocalPath(targetPath, allowedRoots)) {
        return localErrorResult(403, "LOCAL_PATH_NOT_ALLOWED", "Ruta fuera de las carpetas permitidas.");
      }
      const stat = await fs.stat(targetPath);
      if (!stat.isDirectory()) {
        return localErrorResult(400, "LOCAL_NOT_DIRECTORY", "La ruta indicada no es un directorio.");
      }
      const entries = await fs.readdir(targetPath, { withFileTypes: true });
      const sorted = entries
        .map((entry) => `${entry.isDirectory() ? "[DIR]" : "[FILE]"} ${entry.name}`)
        .sort((a, b) => a.localeCompare(b, "es"));
      const maxItems = 80;
      const shown = sorted.slice(0, maxItems);
      const remainder = sorted.length > shown.length ? `\n... y ${sorted.length - shown.length} elemento(s) mas.` : "";
      const listingText = shown.join("\n") || "(directorio vacio)";
      const message = `Contenido de ${targetPath}:\n${listingText}${remainder}`;
      await appendLocalControlAudit("local_control_ls", {
        requestId: context.requestId,
        userId: actor,
        targetPath,
        total: sorted.length,
      });
      return localSuccessResult("LOCAL_LS_OK", message, {
        command: parsed.command,
        path: targetPath,
        total: sorted.length,
      });
    }

    if (parsed.command === "sysinfo") {
      const cpus = os.cpus();
      const cpuModel = cpus[0]?.model || "unknown";
      const message = [
        `Sistema: ${os.type()} ${os.release()} (${os.platform()}/${os.arch()})`,
        `Host: ${os.hostname()}`,
        `Node: ${process.version}`,
        `CPU: ${cpuModel} x${cpus.length}`,
        `Memoria libre: ${formatLocalBytes(os.freemem())} / Total: ${formatLocalBytes(os.totalmem())}`,
        `Uptime (s): ${Math.floor(os.uptime())}`,
        `Home: ${os.homedir()}`,
        `Proyecto: ${LOCAL_ACTIONS_PROJECT_ROOT}`,
        `Roots permitidos: ${allowedRoots.join(", ")}`,
      ].join("\n");
      await appendLocalControlAudit("local_control_sysinfo", {
        requestId: context.requestId,
        userId: actor,
      });
      return localSuccessResult("LOCAL_SYSINFO_OK", message, {
        command: parsed.command,
        platform: os.platform(),
        arch: os.arch(),
        hostname: os.hostname(),
        nodeVersion: process.version,
      });
    }

    if (parsed.command === "stat") {
      const targetRaw = parsed.args[0];
      if (!targetRaw) {
        return localErrorResult(400, "LOCAL_MISSING_ARG", "Uso: /local stat <ruta>");
      }
      const targetPath = resolveLocalPath(targetRaw, LOCAL_ACTIONS_DEFAULT_ROOT);
      if (!isAllowedLocalPath(targetPath, allowedRoots)) {
        return localErrorResult(403, "LOCAL_PATH_NOT_ALLOWED", "Ruta fuera de las carpetas permitidas.");
      }
      let targetStat;
      try {
        targetStat = await fs.stat(targetPath);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException)?.code;
        if (code === "ENOENT") {
          return localErrorResult(404, "LOCAL_NOT_FOUND", "La ruta no existe.");
        }
        throw error;
      }
      const type = targetStat.isDirectory() ? "directory" : targetStat.isFile() ? "file" : "other";
      const details = [
        `Ruta: ${targetPath}`,
        `Tipo: ${type}`,
        `Tamano: ${formatLocalBytes(targetStat.size)} (${targetStat.size} bytes)`,
        `Creado: ${targetStat.birthtime.toISOString()}`,
        `Modificado: ${targetStat.mtime.toISOString()}`,
      ];
      if (targetStat.isDirectory()) {
        try {
          const entries = await fs.readdir(targetPath);
          details.push(`Elementos: ${entries.length}`);
        } catch {
          details.push("Elementos: no disponible");
        }
      }
      await appendLocalControlAudit("local_control_stat", {
        requestId: context.requestId,
        userId: actor,
        targetPath,
      });
      return localSuccessResult("LOCAL_STAT_OK", details.join("\n"), {
        command: parsed.command,
        path: targetPath,
        type,
        size: targetStat.size,
      });
    }

    if (parsed.command === "touch") {
      const targetRaw = parsed.args[0];
      if (!targetRaw) {
        return localErrorResult(400, "LOCAL_MISSING_ARG", "Uso: /local touch <ruta_archivo>");
      }
      const targetPath = resolveLocalPath(targetRaw, LOCAL_ACTIONS_DEFAULT_ROOT);
      if (!isAllowedLocalPath(targetPath, allowedRoots)) {
        return localErrorResult(403, "LOCAL_PATH_NOT_ALLOWED", "Ruta fuera de las carpetas permitidas.");
      }
      let existed = false;
      try {
        const beforeStat = await fs.stat(targetPath);
        if (beforeStat.isDirectory()) {
          return localErrorResult(400, "LOCAL_IS_DIRECTORY", "La ruta apunta a un directorio. Usa una ruta de archivo.");
        }
        existed = true;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException)?.code;
        if (code !== "ENOENT") throw error;
      }

      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      const handle = await fs.open(targetPath, "a");
      await handle.close();
      const now = new Date();
      await fs.utimes(targetPath, now, now).catch(() => undefined);

      await appendLocalControlAudit("local_control_touch", {
        requestId: context.requestId,
        userId: actor,
        targetPath,
        existed,
      });
      return localSuccessResult(
        "LOCAL_TOUCH_OK",
        existed ? `Archivo actualizado: ${targetPath}` : `Archivo creado: ${targetPath}`,
        {
          command: parsed.command,
          path: targetPath,
          existed,
        }
      );
    }

    if (parsed.command === "read") {
      const targetRaw = parsed.args[0];
      if (!targetRaw) {
        return localErrorResult(400, "LOCAL_MISSING_ARG", "Uso: /local read <ruta_archivo>");
      }
      const targetPath = resolveLocalPath(targetRaw, LOCAL_ACTIONS_DEFAULT_ROOT);
      if (!isAllowedLocalPath(targetPath, allowedRoots)) {
        return localErrorResult(403, "LOCAL_PATH_NOT_ALLOWED", "Ruta fuera de las carpetas permitidas.");
      }
      let targetStat;
      try {
        targetStat = await fs.stat(targetPath);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException)?.code;
        if (code === "ENOENT") {
          return localErrorResult(404, "LOCAL_NOT_FOUND", "El archivo no existe.");
        }
        throw error;
      }
      if (!targetStat.isFile()) {
        return localErrorResult(400, "LOCAL_NOT_FILE", "La ruta indicada no es un archivo.");
      }

      const bytesToRead = Math.min(Number(targetStat.size) || 0, LOCAL_FILE_READ_MAX_BYTES);
      let chunk = Buffer.alloc(0);
      if (bytesToRead > 0) {
        const handle = await fs.open(targetPath, "r");
        try {
          const buffer = Buffer.alloc(bytesToRead);
          const { bytesRead } = await handle.read(buffer, 0, bytesToRead, 0);
          chunk = buffer.subarray(0, bytesRead);
        } finally {
          await handle.close();
        }
      }

      if (!isLikelyTextBuffer(chunk)) {
        return localSuccessResult(
          "LOCAL_READ_BINARY",
          `El archivo parece binario: ${targetPath} (${formatLocalBytes(targetStat.size)}).`,
          {
            command: parsed.command,
            path: targetPath,
            size: targetStat.size,
            binary: true,
          }
        );
      }

      let text = chunk.toString("utf-8");
      const wasByteTruncated = targetStat.size > bytesToRead;
      let wasCharTruncated = false;
      if (text.length > LOCAL_FILE_READ_MAX_CHARS) {
        text = text.slice(0, LOCAL_FILE_READ_MAX_CHARS);
        wasCharTruncated = true;
      }
      const suffix = wasByteTruncated || wasCharTruncated
        ? `\n\n[Salida truncada. Tamano total: ${formatLocalBytes(targetStat.size)}]`
        : "";

      await appendLocalControlAudit("local_control_read", {
        requestId: context.requestId,
        userId: actor,
        targetPath,
        size: targetStat.size,
        truncated: wasByteTruncated || wasCharTruncated,
      });
      return localSuccessResult(
        "LOCAL_READ_OK",
        `Contenido de ${targetPath}:\n${text || "(archivo vacio)"}${suffix}`,
        {
          command: parsed.command,
          path: targetPath,
          size: targetStat.size,
          truncated: wasByteTruncated || wasCharTruncated,
        }
      );
    }

    if (parsed.command === "write") {
      const targetRaw = parsed.args[0];
      const content = parsed.args.slice(1).join(" ");
      if (!targetRaw || parsed.args.length < 2) {
        return localErrorResult(400, "LOCAL_MISSING_ARG", "Uso: /local write <ruta_archivo> \"contenido\"");
      }
      if (content.length > LOCAL_FILE_WRITE_MAX_CHARS) {
        return localErrorResult(
          400,
          "LOCAL_CONTENT_TOO_LARGE",
          `Contenido demasiado grande. Maximo permitido: ${LOCAL_FILE_WRITE_MAX_CHARS} caracteres.`
        );
      }

      const targetPath = resolveLocalPath(targetRaw, LOCAL_ACTIONS_DEFAULT_ROOT);
      if (!isAllowedLocalPath(targetPath, allowedRoots)) {
        return localErrorResult(403, "LOCAL_PATH_NOT_ALLOWED", "Ruta fuera de las carpetas permitidas.");
      }

      let existed = false;
      try {
        const current = await fs.stat(targetPath);
        if (current.isDirectory()) {
          return localErrorResult(400, "LOCAL_IS_DIRECTORY", "La ruta apunta a un directorio. Usa una ruta de archivo.");
        }
        existed = true;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException)?.code;
        if (code !== "ENOENT") throw error;
      }

      if (existed && !parsed.confirm) {
        return localErrorResult(
          400,
          "LOCAL_CONFIRM_REQUIRED",
          "El archivo ya existe. Repite con confirmar para sobrescribir."
        );
      }

      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.writeFile(targetPath, content, "utf-8");
      await appendLocalControlAudit("local_control_write", {
        requestId: context.requestId,
        userId: actor,
        targetPath,
        existed,
        contentLength: content.length,
      });
      return localSuccessResult(
        "LOCAL_WRITE_OK",
        existed ? `Archivo sobrescrito: ${targetPath}` : `Archivo creado: ${targetPath}`,
        {
          command: parsed.command,
          path: targetPath,
          existed,
          contentLength: content.length,
        }
      );
    }

    if (parsed.command === "append") {
      const targetRaw = parsed.args[0];
      const content = parsed.args.slice(1).join(" ");
      if (!targetRaw || parsed.args.length < 2) {
        return localErrorResult(400, "LOCAL_MISSING_ARG", "Uso: /local append <ruta_archivo> \"contenido\"");
      }
      if (content.length > LOCAL_FILE_WRITE_MAX_CHARS) {
        return localErrorResult(
          400,
          "LOCAL_CONTENT_TOO_LARGE",
          `Contenido demasiado grande. Maximo permitido: ${LOCAL_FILE_WRITE_MAX_CHARS} caracteres.`
        );
      }
      const targetPath = resolveLocalPath(targetRaw, LOCAL_ACTIONS_DEFAULT_ROOT);
      if (!isAllowedLocalPath(targetPath, allowedRoots)) {
        return localErrorResult(403, "LOCAL_PATH_NOT_ALLOWED", "Ruta fuera de las carpetas permitidas.");
      }

      try {
        const current = await fs.stat(targetPath);
        if (current.isDirectory()) {
          return localErrorResult(400, "LOCAL_IS_DIRECTORY", "La ruta apunta a un directorio. Usa una ruta de archivo.");
        }
      } catch (error) {
        const code = (error as NodeJS.ErrnoException)?.code;
        if (code !== "ENOENT") throw error;
      }

      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.appendFile(targetPath, content, "utf-8");
      await appendLocalControlAudit("local_control_append", {
        requestId: context.requestId,
        userId: actor,
        targetPath,
        contentLength: content.length,
      });
      return localSuccessResult("LOCAL_APPEND_OK", `Contenido agregado en: ${targetPath}`, {
        command: parsed.command,
        path: targetPath,
        contentLength: content.length,
      });
    }

    if (parsed.command === "replace") {
      const targetRaw = parsed.args[0];
      const searchText = parsed.args[1];
      const replaceText = parsed.args.slice(2).join(" ");
      if (!targetRaw || typeof searchText !== "string" || parsed.args.length < 3) {
        return localErrorResult(
          400,
          "LOCAL_MISSING_ARG",
          "Uso: /local replace <ruta_archivo> \"buscar\" \"reemplazo\" confirmar"
        );
      }
      const targetPath = resolveLocalPath(targetRaw, LOCAL_ACTIONS_DEFAULT_ROOT);
      if (!isAllowedLocalPath(targetPath, allowedRoots)) {
        return localErrorResult(403, "LOCAL_PATH_NOT_ALLOWED", "Ruta fuera de las carpetas permitidas.");
      }

      let targetStat;
      try {
        targetStat = await fs.stat(targetPath);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException)?.code;
        if (code === "ENOENT") {
          return localErrorResult(404, "LOCAL_NOT_FOUND", "El archivo no existe.");
        }
        throw error;
      }
      if (!targetStat.isFile()) {
        return localErrorResult(400, "LOCAL_NOT_FILE", "La ruta indicada no es un archivo.");
      }
      if (targetStat.size > 3_000_000) {
        return localErrorResult(400, "LOCAL_FILE_TOO_LARGE", "Archivo demasiado grande para replace (>3MB).");
      }

      const rawBuffer = await fs.readFile(targetPath);
      if (!isLikelyTextBuffer(rawBuffer)) {
        return localErrorResult(400, "LOCAL_NOT_TEXT_FILE", "El archivo parece binario y no se puede reemplazar texto.");
      }

      const currentContent = rawBuffer.toString("utf-8");
      if (!currentContent.includes(searchText)) {
        return localErrorResult(404, "LOCAL_TEXT_NOT_FOUND", "No se encontro el texto a reemplazar.");
      }

      const nextContent = currentContent.replace(searchText, replaceText);
      await fs.writeFile(targetPath, nextContent, "utf-8");
      await appendLocalControlAudit("local_control_replace", {
        requestId: context.requestId,
        userId: actor,
        targetPath,
        searchLength: searchText.length,
        replaceLength: replaceText.length,
      });
      return localSuccessResult("LOCAL_REPLACE_OK", `Reemplazo aplicado en: ${targetPath}`, {
        command: parsed.command,
        path: targetPath,
      });
    }

    if (parsed.command === "rm") {
      const targetRaw = parsed.args[0];
      if (!targetRaw) {
        return localErrorResult(400, "LOCAL_MISSING_ARG", "Uso: /local rm <ruta> confirmar");
      }
      const targetPath = resolveLocalPath(targetRaw, LOCAL_ACTIONS_DEFAULT_ROOT);
      if (!isAllowedLocalPath(targetPath, allowedRoots)) {
        return localErrorResult(403, "LOCAL_PATH_NOT_ALLOWED", "Ruta fuera de las carpetas permitidas.");
      }
      if (isProtectedLocalRootPath(targetPath, allowedRoots)) {
        return localErrorResult(403, "LOCAL_PROTECTED_PATH", "No se puede eliminar una carpeta root permitida.");
      }

      let targetStat;
      try {
        targetStat = await fs.stat(targetPath);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException)?.code;
        if (code === "ENOENT") {
          return localErrorResult(404, "LOCAL_NOT_FOUND", "La ruta no existe.");
        }
        throw error;
      }

      await fs.rm(targetPath, { recursive: true, force: false });
      await appendLocalControlAudit("local_control_rm", {
        requestId: context.requestId,
        userId: actor,
        targetPath,
        targetType: targetStat.isDirectory() ? "directory" : targetStat.isFile() ? "file" : "other",
      });
      return localSuccessResult("LOCAL_RM_OK", `Eliminado: ${targetPath}`, {
        command: parsed.command,
        path: targetPath,
      });
    }

    if (parsed.command === "mv" || parsed.command === "rename") {
      const sourceRaw = parsed.args[0];
      const destinationRaw = parsed.args[1];
      if (!sourceRaw || !destinationRaw) {
        return localErrorResult(
          400,
          "LOCAL_MISSING_ARG",
          parsed.command === "mv"
            ? "Uso: /local mv <origen> <destino> confirmar"
            : "Uso: /local rename <origen> <nuevo_nombre> confirmar"
        );
      }

      const sourcePath = resolveLocalPath(sourceRaw, LOCAL_ACTIONS_DEFAULT_ROOT);
      if (!isAllowedLocalPath(sourcePath, allowedRoots)) {
        return localErrorResult(403, "LOCAL_PATH_NOT_ALLOWED", "Ruta de origen fuera de las carpetas permitidas.");
      }

      const destinationPath =
        parsed.command === "rename" && !/[\\/]/.test(destinationRaw)
          ? path.resolve(path.dirname(sourcePath), destinationRaw)
          : resolveLocalPath(destinationRaw, LOCAL_ACTIONS_DEFAULT_ROOT);

      if (!isAllowedLocalPath(destinationPath, allowedRoots)) {
        return localErrorResult(403, "LOCAL_PATH_NOT_ALLOWED", "Ruta de destino fuera de las carpetas permitidas.");
      }

      if (destinationPath === sourcePath) {
        return localErrorResult(400, "LOCAL_SAME_PATH", "Origen y destino no pueden ser iguales.");
      }

      await fs.stat(sourcePath);
      const destinationParent = path.dirname(destinationPath);
      await fs.mkdir(destinationParent, { recursive: true });
      await fs.rename(sourcePath, destinationPath);
      await appendLocalControlAudit("local_control_move", {
        requestId: context.requestId,
        userId: actor,
        sourcePath,
        destinationPath,
        mode: parsed.command,
      });
      return localSuccessResult(
        "LOCAL_MOVE_OK",
        `Movimiento completado: ${sourcePath} -> ${destinationPath}`,
        {
          command: parsed.command,
          sourcePath,
          destinationPath,
        }
      );
    }

    if (parsed.command === "cd") {
      const targetRaw = parsed.args[0];
      if (!targetRaw) {
        return localErrorResult(400, "LOCAL_MISSING_ARG", "Uso: /local cd <ruta>");
      }
      const currentCwd = ensureLocalCwd(allowedRoots);
      const targetPath = resolveLocalPath(targetRaw, currentCwd);
      if (!isAllowedLocalPath(targetPath, allowedRoots)) {
        return localErrorResult(403, "LOCAL_PATH_NOT_ALLOWED", "Ruta fuera de las carpetas permitidas.");
      }
      let targetStat;
      try {
        targetStat = await fs.stat(targetPath);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException)?.code;
        if (code === "ENOENT") {
          return localErrorResult(404, "LOCAL_NOT_FOUND", "La ruta indicada no existe.");
        }
        throw error;
      }
      if (!targetStat.isDirectory()) {
        return localErrorResult(400, "LOCAL_NOT_DIRECTORY", "La ruta indicada no es un directorio.");
      }
      _localTerminalSessionCwd = targetPath;
      await appendLocalControlAudit("local_control_cd", {
        requestId: context.requestId,
        userId: actor,
        cwd: _localTerminalSessionCwd,
      });
      return localSuccessResult("LOCAL_CD_OK", `Directorio actual: ${_localTerminalSessionCwd}`, {
        command: "cd",
        cwd: _localTerminalSessionCwd,
      });
    }

    if (parsed.command === "pwd") {
      const cwd = ensureLocalCwd(allowedRoots);
      return localSuccessResult("LOCAL_PWD_OK", cwd, { command: "pwd", cwd });
    }

    if (parsed.command === "history") {
      const requestedLimit = Number.parseInt(parsed.args[0] || "20", 10);
      const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(100, requestedLimit)) : 20;
      const recent = _localCommandHistory.slice(-limit);
      const lines = recent.length
        ? recent.map((entry, idx) => `${idx + 1}. [${entry.ts}] (${entry.exitCode ?? "?"}) ${entry.command}`)
        : ["(sin historial todavia)"];
      return localSuccessResult("LOCAL_HISTORY_OK", lines.join("\n"), {
        command: "history",
        total: _localCommandHistory.length,
        shown: recent.length,
      });
    }

    if (parsed.command === "env") {
      if (!parsed.args.length) {
        const entries = Object.entries(process.env)
          .sort(([a], [b]) => a.localeCompare(b, "en"))
          .slice(0, 120)
          .map(([key, value]) => `${key}=${String(value || "")}`);
        return localSuccessResult("LOCAL_ENV_OK", entries.join("\n"), {
          command: "env",
          shown: entries.length,
        });
      }
      const firstArg = parsed.args[0];
      if (firstArg.includes("=")) {
        const eqIdx = firstArg.indexOf("=");
        const varName = firstArg.slice(0, eqIdx).trim();
        const varValue = [firstArg.slice(eqIdx + 1), ...parsed.args.slice(1)].join(" ").trim();
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(varName)) {
          return localErrorResult(400, "LOCAL_INVALID_ENV_NAME", "Nombre de variable invalido.");
        }
        process.env[varName] = varValue;
        return localSuccessResult("LOCAL_ENV_SET_OK", `Variable asignada: ${varName}=${varValue}`, {
          command: "env",
          key: varName,
          valueLength: varValue.length,
        });
      }
      const key = firstArg.trim();
      if (!key) {
        return localErrorResult(400, "LOCAL_MISSING_ARG", "Uso: /local env [VAR] o /local env VAR=valor");
      }
      return localSuccessResult("LOCAL_ENV_VALUE_OK", `${key}=${String(process.env[key] || "")}`, {
        command: "env",
        key,
      });
    }

    // ── shell: execute arbitrary shell commands with persistent cwd ──
    if (parsed.command === "shell") {
      if (!LOCAL_FULL_SHELL_ENABLED) {
        return localErrorResult(
          403,
          "LOCAL_SHELL_DISABLED",
          "Ejecucion de shell deshabilitada. Establece ILIAGPT_LOCAL_FULL_SHELL=true en .env"
        );
      }
      const commandLine = parsed.args.join(" ").trim();
      if (!commandLine) {
        return localErrorResult(400, "LOCAL_MISSING_ARG", "Uso: /local shell <comando>");
      }

      const cdOnlyMatch = commandLine.match(/^cd\s+(.+)$/i);
      if (cdOnlyMatch?.[1]) {
        const targetRaw = cdOnlyMatch[1].trim().replace(/^["']|["']$/g, "");
        const currentCwd = ensureLocalCwd(allowedRoots);
        const targetPath = resolveLocalPath(targetRaw, currentCwd);
        if (!isAllowedLocalPath(targetPath, allowedRoots)) {
          return localErrorResult(403, "LOCAL_PATH_NOT_ALLOWED", "Ruta fuera de las carpetas permitidas.");
        }
        const targetStat = await fs.stat(targetPath);
        if (!targetStat.isDirectory()) {
          return localErrorResult(400, "LOCAL_NOT_DIRECTORY", "La ruta indicada no es un directorio.");
        }
        _localTerminalSessionCwd = targetPath;
        await appendLocalControlAudit("local_control_shell_cd", {
          requestId: context.requestId,
          userId: actor,
          command: commandLine,
          cwd: _localTerminalSessionCwd,
        });
        return localSuccessResult("LOCAL_SHELL_CD_OK", `Directorio actualizado: ${_localTerminalSessionCwd}`, {
          command: "shell",
          shellCommand: commandLine,
          cwd: _localTerminalSessionCwd,
        });
      }

      const shellResult = await runLocalShellCommand(commandLine, {
        allowedRoots,
        cwd: ensureLocalCwd(allowedRoots),
      });
      await appendLocalControlAudit(
        shellResult.exitCode === 0 ? "local_control_shell" : "local_control_shell_error",
        {
          requestId: context.requestId,
          userId: actor,
          command: shellResult.commandLine,
          cwd: shellResult.cwd,
          exitCode: shellResult.exitCode,
          timedOut: shellResult.timedOut,
        }
      );

      if (shellResult.timedOut) {
        return localErrorResult(408, "LOCAL_SHELL_TIMEOUT", `Comando excedio el timeout de ${LOCAL_SHELL_TIMEOUT_MS / 1000}s.`);
      }
      return localSuccessResult(
        shellResult.exitCode === 0 ? "LOCAL_SHELL_OK" : "LOCAL_SHELL_ERROR",
        formatLocalShellMessage(shellResult),
        {
          command: "shell",
          shellCommand: shellResult.commandLine,
          cwd: shellResult.cwd,
          exitCode: shellResult.exitCode,
          truncated: shellResult.truncated,
        }
      );
    }

    if (parsed.command === "ps") {
      const filter = parsed.args.join(" ").trim();
      const commandLine = filter
        ? `ps aux | grep -i -- ${shellQuoteArg(filter)} | grep -v grep | head -n 180`
        : "ps aux | head -n 180";
      const result = await runLocalShellCommand(commandLine, { allowedRoots });
      await appendLocalControlAudit("local_control_ps", {
        requestId: context.requestId,
        userId: actor,
        filter,
        exitCode: result.exitCode,
      });
      if (result.exitCode !== 0 && !result.stdout.trim()) {
        return localErrorResult(404, "LOCAL_PS_EMPTY", filter ? `No hay procesos que coincidan con "${filter}".` : "No se pudieron obtener procesos.");
      }
      return localSuccessResult("LOCAL_PS_OK", formatLocalShellMessage(result), {
        command: "ps",
        filter: filter || null,
      });
    }

    if (parsed.command === "kill") {
      const target = String(parsed.args[0] || "").trim();
      if (!target) {
        return localErrorResult(400, "LOCAL_MISSING_ARG", "Uso: /local kill <pid|nombre_proceso> [signal] confirmar");
      }
      const signal = normalizeLocalSignal(parsed.args[1]);
      const signalShort = signal.replace(/^SIG/, "");
      const commandLine = /^\d+$/.test(target)
        ? `kill -s ${signalShort} ${shellQuoteArg(target)}`
        : `pkill -${signalShort} -f -- ${shellQuoteArg(target)}`;
      const result = await runLocalShellCommand(commandLine, { allowedRoots });
      await appendLocalControlAudit("local_control_kill", {
        requestId: context.requestId,
        userId: actor,
        target,
        signal,
        exitCode: result.exitCode,
      });
      if (result.exitCode !== 0) {
        return localErrorResult(400, "LOCAL_KILL_FAILED", formatLocalShellMessage(result));
      }
      return localSuccessResult("LOCAL_KILL_OK", formatLocalShellMessage(result), {
        command: "kill",
        target,
        signal,
      });
    }

    if (parsed.command === "ports") {
      const commandLine = "lsof -nP -iTCP -sTCP:LISTEN | head -n 200";
      const result = await runLocalShellCommand(commandLine, { allowedRoots });
      await appendLocalControlAudit("local_control_ports", {
        requestId: context.requestId,
        userId: actor,
        exitCode: result.exitCode,
      });
      return localSuccessResult("LOCAL_PORTS_OK", formatLocalShellMessage(result), {
        command: "ports",
      });
    }

    if (parsed.command === "find") {
      if (!parsed.args.length) {
        return localErrorResult(400, "LOCAL_MISSING_ARG", "Uso: /local find <ruta> <patron> (o /local find <patron> [ruta])");
      }
      const first = parsed.args[0];
      const second = parsed.args[1];
      const firstLooksPath = /^(?:desktop:|project:|~\/|\/|\.{1,2}\/)/i.test(first || "");
      const secondLooksPath = /^(?:desktop:|project:|~\/|\/|\.{1,2}\/)/i.test(second || "");
      let patternRaw = "";
      let searchPathRaw = ".";
      if (parsed.args.length === 1) {
        patternRaw = first;
      } else if (firstLooksPath && !secondLooksPath) {
        searchPathRaw = first;
        patternRaw = parsed.args.slice(1).join(" ").trim();
      } else {
        patternRaw = first;
        searchPathRaw = second || ".";
      }
      if (!patternRaw) {
        return localErrorResult(400, "LOCAL_MISSING_ARG", "Debes indicar el patron de busqueda.");
      }
      const searchBase = ensureLocalCwd(allowedRoots);
      const searchPath = resolveLocalPath(searchPathRaw, searchBase);
      if (!isAllowedLocalPath(searchPath, allowedRoots)) {
        return localErrorResult(403, "LOCAL_PATH_NOT_ALLOWED", "Ruta de busqueda fuera de las carpetas permitidas.");
      }
      const commandLine = `find ${shellQuoteArg(searchPath)} -iname ${shellQuoteArg(patternRaw)} -print | head -n 250`;
      const result = await runLocalShellCommand(commandLine, { allowedRoots, cwd: searchPath });
      await appendLocalControlAudit("local_control_find", {
        requestId: context.requestId,
        userId: actor,
        searchPath,
        pattern: patternRaw,
        exitCode: result.exitCode,
      });
      return localSuccessResult("LOCAL_FIND_OK", formatLocalShellMessage(result), {
        command: "find",
        searchPath,
        pattern: patternRaw,
      });
    }

    if (parsed.command === "grep") {
      if (parsed.args.length < 2) {
        return localErrorResult(400, "LOCAL_MISSING_ARG", "Uso: /local grep <ruta> <texto> (o /local grep <texto> [ruta])");
      }
      const first = parsed.args[0];
      const second = parsed.args[1];
      const firstLooksPath = /^(?:desktop:|project:|~\/|\/|\.{1,2}\/)/i.test(first || "");
      let targetRaw = ".";
      let patternRaw = "";
      if (firstLooksPath) {
        targetRaw = first;
        patternRaw = parsed.args.slice(1).join(" ").trim();
      } else {
        patternRaw = first;
        targetRaw = second || ".";
      }
      if (!patternRaw) {
        return localErrorResult(400, "LOCAL_MISSING_ARG", "Debes indicar el texto/patron a buscar.");
      }
      const searchBase = ensureLocalCwd(allowedRoots);
      const targetPath = resolveLocalPath(targetRaw, searchBase);
      if (!isAllowedLocalPath(targetPath, allowedRoots)) {
        return localErrorResult(403, "LOCAL_PATH_NOT_ALLOWED", "Ruta fuera de las carpetas permitidas.");
      }
      const commandLine = `grep -RIn --binary-files=without-match -- ${shellQuoteArg(patternRaw)} ${shellQuoteArg(targetPath)} | head -n 250`;
      const result = await runLocalShellCommand(commandLine, { allowedRoots, cwd: path.dirname(targetPath) });
      await appendLocalControlAudit("local_control_grep", {
        requestId: context.requestId,
        userId: actor,
        targetPath,
        pattern: patternRaw,
        exitCode: result.exitCode,
      });
      if (result.exitCode !== 0 && !result.stderr.trim()) {
        return localSuccessResult("LOCAL_GREP_EMPTY", `Sin coincidencias para "${patternRaw}" en ${targetPath}.`, {
          command: "grep",
          targetPath,
          pattern: patternRaw,
        });
      }
      return localSuccessResult("LOCAL_GREP_OK", formatLocalShellMessage(result), {
        command: "grep",
        targetPath,
        pattern: patternRaw,
      });
    }

    if (parsed.command === "tree") {
      const depthArg = parsed.args.at(-1) || "";
      const parsedDepth = Number.parseInt(depthArg, 10);
      const depth = Number.isFinite(parsedDepth) ? Math.max(1, Math.min(8, parsedDepth)) : 3;
      const pathArgs = Number.isFinite(parsedDepth) ? parsed.args.slice(0, -1) : parsed.args;
      const targetRaw = pathArgs[0] || ".";
      const targetPath = resolveLocalPath(targetRaw, ensureLocalCwd(allowedRoots));
      if (!isAllowedLocalPath(targetPath, allowedRoots)) {
        return localErrorResult(403, "LOCAL_PATH_NOT_ALLOWED", "Ruta fuera de las carpetas permitidas.");
      }
      const commandLine = `if command -v tree >/dev/null 2>&1; then tree -a -L ${depth} ${shellQuoteArg(targetPath)}; else find ${shellQuoteArg(targetPath)} -maxdepth ${depth} -print; fi`;
      const result = await runLocalShellCommand(commandLine, { allowedRoots });
      await appendLocalControlAudit("local_control_tree", {
        requestId: context.requestId,
        userId: actor,
        targetPath,
        depth,
        exitCode: result.exitCode,
      });
      return localSuccessResult("LOCAL_TREE_OK", formatLocalShellMessage(result), {
        command: "tree",
        targetPath,
        depth,
      });
    }

    if (parsed.command === "chmod") {
      const mode = String(parsed.args[0] || "").trim();
      const targetRaw = parsed.args[1];
      if (!mode || !targetRaw) {
        return localErrorResult(400, "LOCAL_MISSING_ARG", "Uso: /local chmod <modo> <ruta> confirmar");
      }
      if (!/^(?:[0-7]{3,4}|[ugoa]+[+\-=][rwxXst]+)$/.test(mode)) {
        return localErrorResult(400, "LOCAL_INVALID_CHMOD_MODE", "Modo chmod invalido.");
      }
      const targetPath = resolveLocalPath(targetRaw, ensureLocalCwd(allowedRoots));
      if (!isAllowedLocalPath(targetPath, allowedRoots)) {
        return localErrorResult(403, "LOCAL_PATH_NOT_ALLOWED", "Ruta fuera de las carpetas permitidas.");
      }
      const result = await runLocalShellCommand(`chmod ${shellQuoteArg(mode)} ${shellQuoteArg(targetPath)}`, { allowedRoots });
      await appendLocalControlAudit("local_control_chmod", {
        requestId: context.requestId,
        userId: actor,
        targetPath,
        mode,
        exitCode: result.exitCode,
      });
      if (result.exitCode !== 0) {
        return localErrorResult(400, "LOCAL_CHMOD_FAILED", formatLocalShellMessage(result));
      }
      return localSuccessResult("LOCAL_CHMOD_OK", formatLocalShellMessage(result), {
        command: "chmod",
        targetPath,
        mode,
      });
    }

    if (parsed.command === "diff") {
      const leftRaw = parsed.args[0];
      const rightRaw = parsed.args[1];
      if (!leftRaw || !rightRaw) {
        return localErrorResult(400, "LOCAL_MISSING_ARG", "Uso: /local diff <archivo_a> <archivo_b>");
      }
      const baseCwd = ensureLocalCwd(allowedRoots);
      const leftPath = resolveLocalPath(leftRaw, baseCwd);
      const rightPath = resolveLocalPath(rightRaw, baseCwd);
      if (!isAllowedLocalPath(leftPath, allowedRoots) || !isAllowedLocalPath(rightPath, allowedRoots)) {
        return localErrorResult(403, "LOCAL_PATH_NOT_ALLOWED", "Alguna ruta esta fuera de las carpetas permitidas.");
      }
      const result = await runLocalShellCommand(
        `diff -u -- ${shellQuoteArg(leftPath)} ${shellQuoteArg(rightPath)} | head -n 500`,
        { allowedRoots }
      );
      await appendLocalControlAudit("local_control_diff", {
        requestId: context.requestId,
        userId: actor,
        leftPath,
        rightPath,
        exitCode: result.exitCode,
      });
      if (result.exitCode > 1) {
        return localErrorResult(400, "LOCAL_DIFF_FAILED", formatLocalShellMessage(result));
      }
      if (result.exitCode === 0) {
        return localSuccessResult("LOCAL_DIFF_IDENTICAL", `Sin diferencias entre:\n${leftPath}\n${rightPath}`, {
          command: "diff",
          leftPath,
          rightPath,
        });
      }
      return localSuccessResult("LOCAL_DIFF_DIFFERENT", formatLocalShellMessage(result), {
        command: "diff",
        leftPath,
        rightPath,
      });
    }

    if (parsed.command === "python" || parsed.command === "node" || parsed.command === "script") {
      if (!LOCAL_FULL_SHELL_ENABLED) {
        return localErrorResult(
          403,
          "LOCAL_SHELL_DISABLED",
          "Ejecucion de scripts deshabilitada. Establece ILIAGPT_LOCAL_FULL_SHELL=true en .env"
        );
      }
      let language: string = parsed.command;
      let scriptArgs = [...parsed.args];
      if (parsed.command === "script") {
        const maybeLanguage = (scriptArgs[0] || "").toLowerCase();
        if (["python", "python3", "node", "js", "bash", "sh"].includes(maybeLanguage)) {
          language = maybeLanguage.startsWith("py")
            ? "python"
            : maybeLanguage === "js"
              ? "node"
              : maybeLanguage.startsWith("sh")
                ? "bash"
                : maybeLanguage;
          scriptArgs = scriptArgs.slice(1);
        } else if (scriptArgs[0]) {
          const ext = path.extname(scriptArgs[0]).toLowerCase();
          if (ext === ".py") language = "python";
          else if (ext === ".js" || ext === ".mjs" || ext === ".cjs") language = "node";
          else language = "bash";
        }
      }
      if (!scriptArgs.length) {
        return localErrorResult(
          400,
          "LOCAL_MISSING_ARG",
          parsed.command === "script"
            ? "Uso: /local script <python|node|bash> <codigo|archivo>"
            : parsed.command === "python"
              ? "Uso: /local python <codigo|archivo.py>"
              : "Uso: /local node <codigo|archivo.js>"
        );
      }

      const currentCwd = ensureLocalCwd(allowedRoots);
      const maybePath = resolveLocalPath(scriptArgs[0], currentCwd);
      let commandLine = "";
      let executionMode: "file" | "inline" = "inline";
      try {
        const st = await fs.stat(maybePath);
        if (st.isFile() && isAllowedLocalPath(maybePath, allowedRoots)) {
          executionMode = "file";
          const tailArgs = scriptArgs.slice(1).map((arg) => shellQuoteArg(arg)).join(" ");
          if (language === "python") commandLine = `python3 ${shellQuoteArg(maybePath)}${tailArgs ? ` ${tailArgs}` : ""}`;
          else if (language === "node") commandLine = `node ${shellQuoteArg(maybePath)}${tailArgs ? ` ${tailArgs}` : ""}`;
          else commandLine = `bash ${shellQuoteArg(maybePath)}${tailArgs ? ` ${tailArgs}` : ""}`;
        }
      } catch {
        executionMode = "inline";
      }
      if (!commandLine) {
        const inlineCode = scriptArgs.join(" ").trim();
        if (!inlineCode) {
          return localErrorResult(400, "LOCAL_MISSING_ARG", "No hay codigo para ejecutar.");
        }
        if (language === "python") commandLine = `python3 -c ${shellQuoteArg(inlineCode)}`;
        else if (language === "node") commandLine = `node -e ${shellQuoteArg(inlineCode)}`;
        else commandLine = inlineCode;
      }
      const result = await runLocalShellCommand(commandLine, { allowedRoots, cwd: currentCwd });
      await appendLocalControlAudit("local_control_script", {
        requestId: context.requestId,
        userId: actor,
        language,
        mode: executionMode,
        exitCode: result.exitCode,
      });
      return localSuccessResult(
        result.exitCode === 0 ? "LOCAL_SCRIPT_OK" : "LOCAL_SCRIPT_ERROR",
        formatLocalShellMessage(result),
        {
          command: parsed.command,
          language,
          mode: executionMode,
          exitCode: result.exitCode,
        }
      );
    }

    if (parsed.command === "npm" || parsed.command === "pip" || parsed.command === "brew" || parsed.command === "git" || parsed.command === "docker") {
      if (!LOCAL_FULL_SHELL_ENABLED) {
        return localErrorResult(
          403,
          "LOCAL_SHELL_DISABLED",
          "Ejecucion de comandos de terminal deshabilitada. Establece ILIAGPT_LOCAL_FULL_SHELL=true en .env"
        );
      }
      const normalizedArgs =
        parsed.source === "natural" && parsed.args.length === 1 && /\s/.test(parsed.args[0] || "")
          ? tokenizeLocalCommand(parsed.args[0])
          : parsed.args;
      if (!normalizedArgs.length) {
        return localErrorResult(400, "LOCAL_MISSING_ARG", `Uso: /local ${parsed.command} <args>`);
      }
      const executable = parsed.command === "pip" ? "pip3" : parsed.command;
      const joinedArgs = normalizedArgs.map((arg) => shellQuoteArg(arg)).join(" ");
      const commandLine = `${executable}${joinedArgs ? ` ${joinedArgs}` : ""}`;
      const result = await runLocalShellCommand(commandLine, { allowedRoots, cwd: ensureLocalCwd(allowedRoots) });
      await appendLocalControlAudit("local_control_package_or_tool", {
        requestId: context.requestId,
        userId: actor,
        tool: parsed.command,
        commandLine,
        exitCode: result.exitCode,
      });
      return localSuccessResult(
        result.exitCode === 0 ? "LOCAL_TOOL_OK" : "LOCAL_TOOL_ERROR",
        formatLocalShellMessage(result),
        {
          command: parsed.command,
          shellCommand: commandLine,
          exitCode: result.exitCode,
        }
      );
    }

    if (parsed.command === "open") {
      const targetRaw = parsed.args.join(" ").trim();
      if (!targetRaw) {
        return localErrorResult(400, "LOCAL_MISSING_ARG", "Uso: /local open <ruta|url|app>");
      }
      const isUrl = /^https?:\/\//i.test(targetRaw);
      let commandLine = "";
      let resolvedPath: string | null = null;
      if (isUrl) {
        commandLine = `open ${shellQuoteArg(targetRaw)}`;
      } else {
        const candidate = resolveLocalPath(targetRaw, ensureLocalCwd(allowedRoots));
        try {
          const st = await fs.stat(candidate);
          if (st && isAllowedLocalPath(candidate, allowedRoots)) {
            resolvedPath = candidate;
            commandLine = `open ${shellQuoteArg(candidate)}`;
          }
        } catch {
          resolvedPath = null;
        }
        if (!commandLine) {
          commandLine = `open -a ${shellQuoteArg(targetRaw)}`;
        }
      }
      const result = await runLocalShellCommand(commandLine, { allowedRoots });
      await appendLocalControlAudit("local_control_open", {
        requestId: context.requestId,
        userId: actor,
        targetRaw,
        resolvedPath,
        exitCode: result.exitCode,
      });
      if (result.exitCode !== 0) {
        return localErrorResult(400, "LOCAL_OPEN_FAILED", formatLocalShellMessage(result));
      }
      return localSuccessResult("LOCAL_OPEN_OK", formatLocalShellMessage(result), {
        command: "open",
        target: resolvedPath || targetRaw,
      });
    }

    if (parsed.command === "top") {
      const result = await runLocalShellCommand("top -l 1 | head -n 60", { allowedRoots });
      await appendLocalControlAudit("local_control_top", {
        requestId: context.requestId,
        userId: actor,
        exitCode: result.exitCode,
      });
      return localSuccessResult("LOCAL_TOP_OK", formatLocalShellMessage(result), {
        command: "top",
      });
    }

    if (parsed.command === "du") {
      const targetRaw = parsed.args[0] || ".";
      const targetPath = resolveLocalPath(targetRaw, ensureLocalCwd(allowedRoots));
      if (!isAllowedLocalPath(targetPath, allowedRoots)) {
        return localErrorResult(403, "LOCAL_PATH_NOT_ALLOWED", "Ruta fuera de las carpetas permitidas.");
      }
      const commandLine = `du -sh ${shellQuoteArg(targetPath)} 2>/dev/null; du -sh ${shellQuoteArg(targetPath)}/* 2>/dev/null | sort -hr | head -n 40`;
      const result = await runLocalShellCommand(commandLine, { allowedRoots });
      await appendLocalControlAudit("local_control_du", {
        requestId: context.requestId,
        userId: actor,
        targetPath,
        exitCode: result.exitCode,
      });
      return localSuccessResult("LOCAL_DU_OK", formatLocalShellMessage(result), {
        command: "du",
        targetPath,
      });
    }

    if (parsed.command === "which") {
      const binary = String(parsed.args[0] || "").trim();
      if (!binary) {
        return localErrorResult(400, "LOCAL_MISSING_ARG", "Uso: /local which <binario>");
      }
      const result = await runLocalShellCommand(`which ${shellQuoteArg(binary)} || command -v ${shellQuoteArg(binary)}`, { allowedRoots });
      await appendLocalControlAudit("local_control_which", {
        requestId: context.requestId,
        userId: actor,
        binary,
        exitCode: result.exitCode,
      });
      if (result.exitCode !== 0) {
        return localErrorResult(404, "LOCAL_WHICH_NOT_FOUND", `No se encontro el binario: ${binary}`);
      }
      return localSuccessResult("LOCAL_WHICH_OK", formatLocalShellMessage(result), {
        command: "which",
        binary,
      });
    }

    if (parsed.command === "monitor") {
      const sampleSecondsRaw = Number.parseInt(parsed.args[0] || "1", 10);
      const sampleSeconds = Number.isFinite(sampleSecondsRaw) ? Math.max(1, Math.min(5, sampleSecondsRaw)) : 1;
      const commandLine = [
        "echo '=== UPTIME ==='",
        "uptime",
        "echo '\n=== MEMORIA ==='",
        "vm_stat | head -n 10",
        "echo '\n=== DISCO ==='",
        "df -h | head -n 20",
        "echo '\n=== PROCESOS TOP ==='",
        "top -l 1 | head -n 35",
        "echo '\n=== PUERTOS LISTEN ==='",
        "lsof -nP -iTCP -sTCP:LISTEN | head -n 40",
        sampleSeconds > 1 ? `echo '\n=== MUESTRA EXTRA (${sampleSeconds}s) ==='; sleep ${sampleSeconds}; top -l 1 | head -n 20` : "",
      ].filter(Boolean).join("; ");
      const result = await runLocalShellCommand(commandLine, {
        allowedRoots,
        timeoutMs: LOCAL_SHELL_TIMEOUT_MS + (sampleSeconds * 2000),
        stdoutMaxChars: 32_000,
      });
      await appendLocalControlAudit("local_control_monitor", {
        requestId: context.requestId,
        userId: actor,
        sampleSeconds,
        exitCode: result.exitCode,
      });
      return localSuccessResult("LOCAL_MONITOR_OK", formatLocalShellMessage(result), {
        command: "monitor",
        sampleSeconds,
      });
    }

    // ── cp: copy file or directory ──
    if (parsed.command === "cp") {
      const sourceRaw = parsed.args[0];
      const destinationRaw = parsed.args[1];
      if (!sourceRaw || !destinationRaw) {
        return localErrorResult(400, "LOCAL_MISSING_ARG",
          "Uso: /local cp <origen> <destino>\nEjemplo: /local cp desktop:archivo.txt desktop:copia.txt");
      }
      const sourcePath = resolveLocalPath(sourceRaw, LOCAL_ACTIONS_DEFAULT_ROOT);
      const destinationPath = resolveLocalPath(destinationRaw, LOCAL_ACTIONS_DEFAULT_ROOT);

      if (!isAllowedLocalPath(sourcePath, allowedRoots)) {
        return localErrorResult(403, "LOCAL_PATH_NOT_ALLOWED", "Ruta de origen fuera de las carpetas permitidas.");
      }
      if (!isAllowedLocalPath(destinationPath, allowedRoots)) {
        return localErrorResult(403, "LOCAL_PATH_NOT_ALLOWED", "Ruta de destino fuera de las carpetas permitidas.");
      }

      await fs.stat(sourcePath); // throws if not exists
      const destParent = path.dirname(destinationPath);
      await fs.mkdir(destParent, { recursive: true });
      await fs.cp(sourcePath, destinationPath, { recursive: true });

      await appendLocalControlAudit("local_control_cp", {
        requestId: context.requestId,
        userId: actor,
        sourcePath,
        destinationPath,
      });
      return localSuccessResult("LOCAL_CP_OK", `Copiado: ${sourcePath} -> ${destinationPath}`, {
        command: "cp",
        sourcePath,
        destinationPath,
      });
    }

    // ═══════════════════════════════════════════════════════════════════
    //  macOS Native Commands
    // ═══════════════════════════════════════════════════════════════════

    if (parsed.command === "volume") {
      const arg0 = (parsed.args[0] || "").toLowerCase();
      if (!arg0 || arg0 === "get" || arg0 === "status") {
        const vol = await macos.getVolume();
        const muted = await macos.isMuted();
        return localSuccessResult("MACOS_VOLUME", `🔊 Volumen: ${vol}%${muted ? " (silenciado)" : ""}`, { volume: vol, muted });
      }
      if (arg0 === "mute") {
        await macos.muteVolume(true);
        return localSuccessResult("MACOS_VOLUME_MUTED", "🔇 Volumen silenciado.");
      }
      if (arg0 === "unmute") {
        await macos.muteVolume(false);
        return localSuccessResult("MACOS_VOLUME_UNMUTED", "🔊 Volumen desilenciado.");
      }
      const level = parseInt(arg0, 10);
      if (!isNaN(level)) {
        await macos.setVolume(level);
        return localSuccessResult("MACOS_VOLUME_SET", `🔊 Volumen ajustado a ${Math.min(100, Math.max(0, level))}%.`);
      }
      return localErrorResult(400, "MACOS_VOLUME_USAGE", "Uso: volume [get|mute|unmute|0-100]");
    }

    if (parsed.command === "brightness") {
      const arg0 = (parsed.args[0] || "").toLowerCase();
      if (!arg0 || arg0 === "get") {
        const b = await macos.getBrightness();
        return localSuccessResult("MACOS_BRIGHTNESS", `🔆 Brillo: ${Math.round(b * 100)}%`, { brightness: b });
      }
      const level = parseFloat(arg0);
      if (!isNaN(level)) {
        const normalized = level > 1 ? level / 100 : level;
        await macos.setBrightness(normalized);
        return localSuccessResult("MACOS_BRIGHTNESS_SET", `🔆 Brillo ajustado a ${Math.round(normalized * 100)}%.`);
      }
      return localErrorResult(400, "MACOS_BRIGHTNESS_USAGE", "Uso: brightness [get|0-100|0.0-1.0]");
    }

    if (parsed.command === "darkmode") {
      const arg0 = (parsed.args[0] || "").toLowerCase();
      if (!arg0 || arg0 === "get" || arg0 === "status") {
        const dark = await macos.isDarkMode();
        return localSuccessResult("MACOS_DARKMODE", `${dark ? "🌙 Dark mode activado" : "☀️ Light mode activado"}`, { darkMode: dark });
      }
      if (["on", "true", "dark", "activar", "enable"].includes(arg0)) {
        await macos.setDarkMode(true);
        return localSuccessResult("MACOS_DARKMODE_ON", "🌙 Dark mode activado.");
      }
      if (["off", "false", "light", "desactivar", "disable"].includes(arg0)) {
        await macos.setDarkMode(false);
        return localSuccessResult("MACOS_DARKMODE_OFF", "☀️ Light mode activado.");
      }
      const current = await macos.isDarkMode();
      await macos.setDarkMode(!current);
      return localSuccessResult("MACOS_DARKMODE_TOGGLE", `${!current ? "🌙 Dark mode" : "☀️ Light mode"} activado.`);
    }

    if (parsed.command === "wifi") {
      const arg0 = (parsed.args[0] || "").toLowerCase();
      if (!arg0 || arg0 === "status" || arg0 === "get") {
        const status = await macos.getWiFiStatus();
        return localSuccessResult("MACOS_WIFI", `📶 WiFi: ${status.power ? "encendido" : "apagado"}${status.ssid ? ` — Red: ${status.ssid}` : ""}`, status);
      }
      if (["on", "enable", "encender"].includes(arg0)) {
        await macos.setWiFi(true);
        return localSuccessResult("MACOS_WIFI_ON", "📶 WiFi encendido.");
      }
      if (["off", "disable", "apagar"].includes(arg0)) {
        await macos.setWiFi(false);
        return localSuccessResult("MACOS_WIFI_OFF", "📶 WiFi apagado.");
      }
      return localErrorResult(400, "MACOS_WIFI_USAGE", "Uso: wifi [status|on|off]");
    }

    if (parsed.command === "bluetooth") {
      const arg0 = (parsed.args[0] || "").toLowerCase();
      if (!arg0 || arg0 === "status") {
        const on = await macos.getBluetoothStatus();
        return localSuccessResult("MACOS_BT", `${on ? "🔵 Bluetooth encendido" : "⚪ Bluetooth apagado"}`, { power: on });
      }
      if (["on", "enable"].includes(arg0)) {
        const r = await macos.setBluetooth(true);
        return localSuccessResult("MACOS_BT_ON", r.success ? "🔵 Bluetooth encendido." : `Error: ${r.error}`);
      }
      if (["off", "disable"].includes(arg0)) {
        const r = await macos.setBluetooth(false);
        return localSuccessResult("MACOS_BT_OFF", r.success ? "⚪ Bluetooth apagado." : `Error: ${r.error}`);
      }
      return localErrorResult(400, "MACOS_BT_USAGE", "Uso: bluetooth [status|on|off]");
    }

    if (parsed.command === "battery") {
      const info = await macos.getBatteryInfo();
      return localSuccessResult("MACOS_BATTERY",
        `🔋 Batería: ${info.percent}%${info.charging ? " ⚡ Cargando" : ""} — ${info.timeRemaining}`,
        info
      );
    }

    if (parsed.command === "lock") {
      await macos.lockScreen();
      return localSuccessResult("MACOS_LOCK", "🔒 Pantalla bloqueada.");
    }

    if (parsed.command === "screenshot") {
      const r = await macos.takeScreenshot({ shadow: false });
      if (!r.success) return localErrorResult(500, "MACOS_SCREENSHOT_FAIL", r.error || "Error al tomar screenshot");
      return localSuccessResult("MACOS_SCREENSHOT", `📸 Screenshot guardado: ${r.path}`, {
        path: r.path,
        hasBase64: !!r.base64,
      });
    }

    if (parsed.command === "clipboard") {
      const arg0 = (parsed.args[0] || "").toLowerCase();
      if (!arg0 || arg0 === "get" || arg0 === "read" || arg0 === "paste") {
        const content = await macos.getClipboard();
        return localSuccessResult("MACOS_CLIPBOARD", `📋 Clipboard (${content.length} chars):\n${content.slice(0, 2000)}${content.length > 2000 ? "\n...[truncado]" : ""}`, { length: content.length });
      }
      if (arg0 === "set" || arg0 === "copy") {
        const text = parsed.args.slice(1).join(" ");
        if (!text) return localErrorResult(400, "MACOS_CLIPBOARD_USAGE", "Uso: clipboard copy <texto>");
        await macos.setClipboard(text);
        return localSuccessResult("MACOS_CLIPBOARD_SET", `📋 Texto copiado al clipboard (${text.length} chars).`);
      }
      if (arg0 === "clear") {
        await macos.clearClipboard();
        return localSuccessResult("MACOS_CLIPBOARD_CLEAR", "📋 Clipboard limpiado.");
      }
      return localErrorResult(400, "MACOS_CLIPBOARD_USAGE", "Uso: clipboard [get|copy <texto>|clear]");
    }

    if (parsed.command === "notify") {
      const message = parsed.args.join(" ");
      if (!message) return localErrorResult(400, "MACOS_NOTIFY_USAGE", "Uso: notify <mensaje>");
      await macos.showNotification(message, { title: "ILIAGPT" });
      return localSuccessResult("MACOS_NOTIFY", `🔔 Notificación enviada: "${message}"`);
    }

    if (parsed.command === "say") {
      const text = parsed.args.join(" ");
      if (!text) return localErrorResult(400, "MACOS_SAY_USAGE", "Uso: say <texto>");
      await macos.sayText(text);
      return localSuccessResult("MACOS_SAY", `🗣️ Dicho: "${text}"`);
    }

    if (parsed.command === "calendar") {
      const arg0 = (parsed.args[0] || "").toLowerCase();
      if (!arg0 || arg0 === "events" || arg0 === "list") {
        const days = parseInt(parsed.args[1] || "7", 10);
        const events = await macos.getCalendarEvents(days);
        if (events.length === 0) return localSuccessResult("MACOS_CALENDAR", `📅 No hay eventos en los próximos ${days} días.`);
        const formatted = events.map(e =>
          `• ${e.title} — ${new Date(e.startDate).toLocaleString("es")}${e.location ? ` 📍 ${e.location}` : ""}`
        ).join("\n");
        return localSuccessResult("MACOS_CALENDAR", `📅 Próximos eventos (${events.length}):\n${formatted}`, { events });
      }
      if (arg0 === "calendars") {
        const cals = await macos.listCalendars();
        return localSuccessResult("MACOS_CALENDARS", `📅 Calendarios: ${cals.join(", ")}`, { calendars: cals });
      }
      return localErrorResult(400, "MACOS_CALENDAR_USAGE", "Uso: calendar [events [días]|calendars]");
    }

    if (parsed.command === "contacts") {
      const query = parsed.args.join(" ");
      if (!query) return localErrorResult(400, "MACOS_CONTACTS_USAGE", "Uso: contacts <nombre>");
      const contacts = await macos.searchContacts(query);
      if (contacts.length === 0) return localSuccessResult("MACOS_CONTACTS", `👤 No se encontraron contactos para "${query}".`);
      const formatted = contacts.map(c =>
        `• ${c.name}${c.organization ? ` (${c.organization})` : ""}${c.email.length ? ` ✉️ ${c.email[0]}` : ""}${c.phone.length ? ` 📱 ${c.phone[0]}` : ""}`
      ).join("\n");
      return localSuccessResult("MACOS_CONTACTS", `👤 Contactos encontrados (${contacts.length}):\n${formatted}`, { contacts });
    }

    if (parsed.command === "reminders") {
      const arg0 = (parsed.args[0] || "").toLowerCase();
      if (!arg0 || arg0 === "list" || arg0 === "get") {
        const listName = parsed.args[1] || undefined;
        const reminders = await macos.getReminders(listName);
        if (reminders.length === 0) return localSuccessResult("MACOS_REMINDERS", "✅ No hay recordatorios pendientes.");
        const formatted = reminders.map(r =>
          `• ${r.name}${r.dueDate ? ` — ${new Date(r.dueDate).toLocaleString("es")}` : ""}${r.list ? ` [${r.list}]` : ""}`
        ).join("\n");
        return localSuccessResult("MACOS_REMINDERS", `📝 Recordatorios (${reminders.length}):\n${formatted}`, { reminders });
      }
      if (arg0 === "add" || arg0 === "create" || arg0 === "new") {
        const name = parsed.args.slice(1).join(" ");
        if (!name) return localErrorResult(400, "MACOS_REMINDER_USAGE", "Uso: reminders add <nombre>");
        await macos.createReminder(name);
        return localSuccessResult("MACOS_REMINDER_CREATED", `✅ Recordatorio creado: "${name}"`);
      }
      if (arg0 === "complete" || arg0 === "done") {
        const name = parsed.args.slice(1).join(" ");
        if (!name) return localErrorResult(400, "MACOS_REMINDER_USAGE", "Uso: reminders complete <nombre>");
        await macos.completeReminder(name);
        return localSuccessResult("MACOS_REMINDER_COMPLETED", `✅ Recordatorio completado: "${name}"`);
      }
      return localErrorResult(400, "MACOS_REMINDERS_USAGE", "Uso: reminders [list|add <nombre>|complete <nombre>]");
    }

    if (parsed.command === "spotlight") {
      const query = parsed.args.join(" ");
      if (!query) return localErrorResult(400, "MACOS_SPOTLIGHT_USAGE", "Uso: spotlight <búsqueda>");
      const results = await macos.spotlightSearch(query, { limit: 15 });
      if (results.length === 0) return localSuccessResult("MACOS_SPOTLIGHT", `🔎 Sin resultados para "${query}".`);
      const formatted = results.map(r => `• [${r.kind}] ${r.name}\n  ${r.path}`).join("\n");
      return localSuccessResult("MACOS_SPOTLIGHT", `🔎 Resultados (${results.length}):\n${formatted}`, { results });
    }

    if (parsed.command === "shortcut") {
      const arg0 = (parsed.args[0] || "").toLowerCase();
      if (!arg0 || arg0 === "list") {
        const shortcuts = await macos.listShortcuts();
        return localSuccessResult("MACOS_SHORTCUTS", `⚡ Shortcuts (${shortcuts.length}):\n${shortcuts.map(s => `• ${s}`).join("\n")}`, { shortcuts });
      }
      if (arg0 === "run") {
        const name = parsed.args.slice(1).join(" ");
        if (!name) return localErrorResult(400, "MACOS_SHORTCUT_USAGE", "Uso: shortcut run <nombre>");
        const r = await macos.runShortcut(name);
        return localSuccessResult("MACOS_SHORTCUT_RUN", r.success ? `⚡ Shortcut "${name}" ejecutado: ${r.output}` : `Error: ${r.error}`);
      }
      return localErrorResult(400, "MACOS_SHORTCUT_USAGE", "Uso: shortcut [list|run <nombre>]");
    }

    if (parsed.command === "music") {
      const action = (parsed.args[0] || "status").toLowerCase() as "play" | "pause" | "next" | "previous" | "status";
      const app = (parsed.args[1] || "Music") as "Music" | "Spotify";
      const r = await macos.musicControl(action, app);
      const emoji = { play: "▶️", pause: "⏸️", next: "⏭️", previous: "⏮️", status: "🎵" }[action] || "🎵";
      return localSuccessResult("MACOS_MUSIC", r.success ? `${emoji} ${r.output || action}` : `Error: ${r.error}`);
    }

    if (parsed.command === "apps") {
      const arg0 = (parsed.args[0] || "").toLowerCase();
      if (!arg0 || arg0 === "list" || arg0 === "running") {
        const apps = await macos.listRunningApps();
        const formatted = apps.map(a => `• ${a.name}${a.isFrontmost ? " ★" : ""}${a.isHidden ? " (oculto)" : ""}`).join("\n");
        return localSuccessResult("MACOS_APPS", `📱 Apps en ejecución (${apps.length}):\n${formatted}`, { apps });
      }
      if (arg0 === "front" || arg0 === "active") {
        const app = await macos.getFrontmostApp();
        return localSuccessResult("MACOS_APP_FRONT", app ? `📱 App activa: ${app.name}` : "No se pudo determinar.", { app });
      }
      return localErrorResult(400, "MACOS_APPS_USAGE", "Uso: apps [list|front]");
    }

    if (parsed.command === "windows") {
      const arg0 = (parsed.args[0] || "").toLowerCase();
      if (!arg0 || arg0 === "list") {
        const appFilter = parsed.args[1] || undefined;
        const windows = await macos.listWindows(appFilter);
        const formatted = windows.map(w =>
          `• [${w.appName}] "${w.windowName}" — ${w.size.width}x${w.size.height} @ (${w.position.x},${w.position.y})${w.minimized ? " 📥" : ""}`
        ).join("\n");
        return localSuccessResult("MACOS_WINDOWS", `🪟 Ventanas (${windows.length}):\n${formatted}`, { windows });
      }
      return localErrorResult(400, "MACOS_WINDOWS_USAGE", "Uso: windows [list [app]]");
    }

    if (parsed.command === "finder") {
      const arg0 = (parsed.args[0] || "").toLowerCase();
      if (arg0 === "reveal" || arg0 === "show") {
        const filePath = parsed.args.slice(1).join(" ");
        if (!filePath) return localErrorResult(400, "MACOS_FINDER_USAGE", "Uso: finder reveal <ruta>");
        await macos.revealInFinder(filePath);
        return localSuccessResult("MACOS_FINDER_REVEAL", `📁 Mostrando en Finder: ${filePath}`);
      }
      if (arg0 === "selection") {
        const files = await macos.getFinderSelection();
        return localSuccessResult("MACOS_FINDER_SEL", files.length ? `📁 Seleccionado:\n${files.map(f => `• ${f}`).join("\n")}` : "📁 Nada seleccionado en Finder.", { files });
      }
      return localErrorResult(400, "MACOS_FINDER_USAGE", "Uso: finder [reveal <ruta>|selection]");
    }

    if (parsed.command === "osascript") {
      const script = parsed.args.join(" ");
      if (!script) return localErrorResult(400, "MACOS_OSASCRIPT_USAGE", "Uso: osascript <script AppleScript>");
      const r = await macos.runOsascript(script);
      return localSuccessResult("MACOS_OSASCRIPT", r.success ? `🍏 Resultado: ${r.output}` : `Error: ${r.error}`, { duration: r.duration });
    }

    return localErrorResult(400, "LOCAL_UNSUPPORTED_COMMAND", "Comando no soportado. Usa /local help.");
  } catch (error) {
    const errorMessage = (error as Error)?.message || "Fallo al ejecutar accion local.";
    await appendLocalControlAudit("local_control_failed", {
      requestId: context.requestId,
      userId: actor,
      command: parsed.command,
      error: errorMessage,
    });
    return localErrorResult(500, "LOCAL_ACTION_FAILED", errorMessage);
  }
}

/**
 * Sanitize external web content before injecting into system prompt.
 * Strips patterns that could be interpreted as LLM instructions/prompt injection.
 */
function sanitizeWebSearchContent(text: string, maxLen = 50_000): string {
  if (!text) return "";
  const repeatedPromptPattern = /<script\b[^>]*>[\s\S]*?<\/script>/gi;
  return text
    .replace(/\b(?:ignore\s+(?:all\s+)?(?:previous|above|prior)\s+instructions?)/gi, "[filtered]")
    .replace(/\b(?:you\s+are\s+now|act\s+as\s+if|pretend\s+(?:you|that)|system\s*:\s*)/gi, "[filtered]")
    .replace(/\b(?:disregard|forget|override)\s+(?:all\s+)?(?:previous|above|prior|your)\s+(?:instructions?|rules?|guidelines?|prompt)/gi, "[filtered]")
    .replace(/\b(?:new\s+instructions?|updated?\s+instructions?|real\s+instructions?):/gi, "[filtered]")
    .replace(repeatedPromptPattern, "[filtered]")
    .replace(/\[(?:system|SYSTEM)\]/g, "[filtered]")
    .replace(/<\/?(?:system|prompt|instruction|rules?|override)>/gi, "[filtered]")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\[\/\/\]:\s*#\s*\([\s\S]*?\)/g, "")
    .replace(/\b(?:javascript|vbscript|data)\s*:/gi, "[filtered]:")
    .slice(0, maxLen);
}

function sanitizeStreamIdentifier(raw: unknown, fallbackPrefix = "stream_req"): string {
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed && STREAM_IDENTIFIER_RE.test(trimmed)) return trimmed;
  }
  return `${fallbackPrefix}_${uuidv4().replace(/-/g, "").slice(0, 16)}`;
}

function sanitizeStreamText(value: unknown, maxLen: number): string {
  if (typeof value !== "string") return "";
  const safe = value.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim();
  return safe.length > maxLen ? safe.slice(0, maxLen) : safe;
}

function sanitizeStreamAttachment(raw: unknown): {
  id?: string;
  name?: string;
  mimeType?: string;
  size?: number;
  storagePath?: string;
  fileId?: string;
  type?: string;
} | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Record<string, unknown>;
  const name = sanitizeStreamText(source.name, MAX_STREAM_ATTACHMENT_NAME_LEN);
  if (!name || !STREAM_ATTACHMENT_NAME_RE.test(name)) return null;
  const mimeType = sanitizeStreamText(
    source.mimeType || source.type,
    MAX_STREAM_ATTACHMENT_MIME_LEN
  );
  if (mimeType && !STREAM_MIME_RE.test(mimeType)) return null;
  const sizeValue = Number(source.size);
  const size = Number.isFinite(sizeValue) && sizeValue >= 0 && sizeValue <= MAX_STREAM_ATTACHMENT_SIZE
    ? Math.floor(sizeValue)
    : undefined;
  const type = sanitizeStreamText(source.type, MAX_STREAM_ATTACHMENT_MIME_LEN);
  const id = sanitizeStreamText(source.id || source.fileId, 160);
  const storagePath = sanitizeStreamText(source.storagePath, 255);
  const fileId = sanitizeStreamText(source.fileId, 160);
  return {
    id: id || fileId || undefined,
    name,
    mimeType: mimeType || type || undefined,
    size,
    storagePath: storagePath || undefined,
    fileId: fileId || undefined,
    type: type || undefined,
  };
}

function clampSsePayload<T>(payload: T, maxBytes: number = MAX_STREAM_EVENT_PAYLOAD_BYTES): T {
  const text = JSON.stringify(payload);
  if (text.length <= maxBytes) return payload;
  const candidate: Record<string, unknown> = { ...(payload as Record<string, unknown>), truncated: true };
  if (candidate.content && typeof candidate.content === "string") {
    candidate.content = sanitizeStreamText(candidate.content, Math.max(256, maxBytes - 120));
  }
  if (candidate.message && typeof candidate.message === "string") {
    candidate.message = sanitizeStreamText(candidate.message, 512);
  }
  if (candidate.details && typeof candidate.details === "string") {
    candidate.details = sanitizeStreamText(candidate.details, 512);
  }
  if (candidate.error && typeof candidate.error === "string") {
    candidate.error = sanitizeStreamText(candidate.error, 512);
  }
  return candidate as T;
}

function normalizeStreamSkillScopes(rawScopes: unknown): SkillScope[] {
  if (!Array.isArray(rawScopes)) return [...DEFAULT_STREAM_SKILL_SCOPES];
  const seen = new Set<SkillScope>();
  for (const scope of rawScopes) {
    if (typeof scope !== "string") continue;
    if (!VALID_STREAM_SCOPE_SET.has(scope as SkillScope)) continue;
    seen.add(scope as SkillScope);
    if (seen.size >= MAX_STREAM_SKILL_SCOPES) break;
  }
  return seen.size ? Array.from(seen) : [...DEFAULT_STREAM_SKILL_SCOPES];
}

type StreamResumeStatus = "streaming" | "completed" | "failed";

type StreamMetaRecord = {
  conversationId?: string;
  requestId?: string;
  assistantMessageId?: string | null;
  getAssistantMessageId?: () => string | null | undefined;
  onWrite?: () => void;
  enableResumePersistence?: boolean;
  resumeStatus?: StreamResumeStatus;
  resumeContent?: string;
  resumeLastSeq?: number;
  resumeFlushTimer?: NodeJS.Timeout | null;
  resumePersistPromise?: Promise<void> | null;
};

function getStreamMeta(res: Response): StreamMetaRecord | undefined {
  return (res as any)?.locals?.streamMeta as StreamMetaRecord | undefined;
}

function getResumeStatusForEvent(event: string, payload: Record<string, unknown>): StreamResumeStatus | null {
  if (event === "error" || event === "production_error") {
    return "failed";
  }

  if (event === "done" || event === "finish" || event === "complete") {
    return payload.error === true ? "failed" : "completed";
  }

  if (
    event === "start" ||
    event === "thinking" ||
    event === "context" ||
    event === "chunk" ||
    event === "text" ||
    event === "skill_chunk"
  ) {
    return "streaming";
  }

  return null;
}

function getSequenceIdFromPayload(payload: Record<string, unknown>): number | null {
  const rawValue = payload.sequenceId;
  const numericValue =
    typeof rawValue === "number"
      ? rawValue
      : typeof rawValue === "string" && rawValue.trim()
        ? Number(rawValue)
        : NaN;

  if (!Number.isFinite(numericValue) || numericValue < 0) {
    return null;
  }

  return Math.floor(numericValue);
}

async function persistStreamResumeProgress(
  streamMeta: StreamMetaRecord | undefined,
  preferredStatus?: StreamResumeStatus,
): Promise<void> {
  if (!streamMeta?.enableResumePersistence || !streamMeta.conversationId) {
    return;
  }

  const status = streamMeta.resumeStatus ?? preferredStatus ?? "streaming";
  const lastSeq = Number.isFinite(streamMeta.resumeLastSeq) && (streamMeta.resumeLastSeq as number) >= 0
    ? Math.floor(streamMeta.resumeLastSeq as number)
    : 0;
  const assistantMessageId =
    streamMeta.assistantMessageId ||
    (typeof streamMeta.getAssistantMessageId === "function"
      ? streamMeta.getAssistantMessageId() ?? null
      : null);

  await saveStreamingProgress(
    streamMeta.conversationId,
    lastSeq,
    typeof streamMeta.resumeContent === "string" ? streamMeta.resumeContent : "",
    status,
    {
      assistantMessageId,
      requestId: streamMeta.requestId ?? null,
    },
  );
}

function trackStreamResumeProgress(
  streamMeta: StreamMetaRecord | undefined,
  event: string,
  payload: Record<string, unknown>,
): void {
  if (!streamMeta?.enableResumePersistence || !streamMeta.conversationId) {
    return;
  }

  const nextStatus = getResumeStatusForEvent(event, payload);
  if (!nextStatus) {
    return;
  }

  if (typeof payload.assistantMessageId === "string" && payload.assistantMessageId.trim()) {
    streamMeta.assistantMessageId = payload.assistantMessageId.trim();
  }

  const nextSequenceId = getSequenceIdFromPayload(payload);
  if (nextSequenceId !== null) {
    streamMeta.resumeLastSeq = Math.max(streamMeta.resumeLastSeq ?? 0, nextSequenceId);
  }

  if ((event === "chunk" || event === "text" || event === "skill_chunk") && typeof payload.content === "string") {
    streamMeta.resumeContent = `${streamMeta.resumeContent || ""}${payload.content}`;
  }

  streamMeta.resumeStatus = nextStatus;
}

function scheduleStreamResumeProgressPersist(
  streamMeta: StreamMetaRecord | undefined,
  preferredStatus?: StreamResumeStatus,
): void {
  if (!streamMeta?.enableResumePersistence || !streamMeta.conversationId) {
    return;
  }

  const persist = () => {
    const operation = persistStreamResumeProgress(streamMeta, preferredStatus).finally(() => {
      if (streamMeta.resumePersistPromise === operation) {
        streamMeta.resumePersistPromise = null;
      }
    });
    streamMeta.resumePersistPromise = operation;
  };

  const targetStatus = streamMeta.resumeStatus ?? preferredStatus ?? "streaming";
  if (targetStatus !== "streaming") {
    if (streamMeta.resumeFlushTimer) {
      clearTimeout(streamMeta.resumeFlushTimer);
      streamMeta.resumeFlushTimer = null;
    }
    persist();
    return;
  }

  if (streamMeta.resumeFlushTimer) {
    return;
  }

  streamMeta.resumeFlushTimer = setTimeout(() => {
    streamMeta.resumeFlushTimer = null;
    persist();
  }, STREAM_PROGRESS_FLUSH_MS);
  streamMeta.resumeFlushTimer.unref?.();
}

async function flushStreamResumeProgress(
  streamMeta: StreamMetaRecord | undefined,
  preferredStatus?: StreamResumeStatus,
): Promise<void> {
  if (!streamMeta?.enableResumePersistence || !streamMeta.conversationId) {
    return;
  }

  if (streamMeta.resumeFlushTimer) {
    clearTimeout(streamMeta.resumeFlushTimer);
    streamMeta.resumeFlushTimer = null;
  }

  const operation = persistStreamResumeProgress(streamMeta, preferredStatus).finally(() => {
    if (streamMeta.resumePersistPromise === operation) {
      streamMeta.resumePersistPromise = null;
    }
  });
  streamMeta.resumePersistPromise = operation;
  await operation;
}

function writeSse(res: Response, event: string, data: object): boolean {
  try {
    // Guard: don't write to a destroyed or finished response
    const r = res as any;
    if (r.writableEnded || r.destroyed) return false;

    const streamMeta = getStreamMeta(res);
    const assistantMessageId =
      streamMeta?.assistantMessageId ||
      (typeof streamMeta?.getAssistantMessageId === "function"
        ? streamMeta.getAssistantMessageId()
        : undefined);

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

    const payload = clampSsePayload(enrichedPayload);
    trackStreamResumeProgress(streamMeta, event, payload as Record<string, unknown>);
    let serialized: string;
    try {
      serialized = JSON.stringify(payload);
    } catch (serializationError) {
      serialized = JSON.stringify(
        clampSsePayload({
          ...(payload as Record<string, unknown>),
          serializationError: sanitizeStreamText(String(serializationError), 120),
          truncated: true,
        }, MAX_STREAM_EVENT_PAYLOAD_BYTES)
      );
    }
    const chunk = `event: ${sanitizeStreamText(event, 120)}\ndata: ${serialized.length > MAX_STREAM_EVENT_PAYLOAD_BYTES
      ? JSON.stringify(clampSsePayload(payload, MAX_STREAM_EVENT_PAYLOAD_BYTES))
      : serialized}\n\n`;
    res.write(chunk);
    if (typeof (res as unknown as { flush: Function }).flush === 'function') {
      (res as unknown as { flush: Function }).flush();
    } else if (res.socket && typeof res.socket.write === 'function') {
      res.socket.write('');
    }
    if (typeof streamMeta?.onWrite === "function") {
      try {
        streamMeta.onWrite();
      } catch (observerError) {
        console.warn("[SSE] streamMeta.onWrite failed:", observerError);
      }
    }
    scheduleStreamResumeProgressPersist(streamMeta);
    return true;
  } catch (err) {
    console.error('[SSE] Write failed:', err);
    return false;
  }
}

function emitDoneEvent(res: Response, data: Record<string, unknown>): boolean {
  const response = res as any;
  if (response.__doneSent) {
    return false;
  }
  response.__doneSent = true;
  return writeSse(res, "done", {
    ...data,
    timestamp: data.timestamp ?? Date.now(),
  });
}

function emitCompleteEvent(res: Response, data: Record<string, unknown>): boolean {
  return writeSse(res, "complete", {
    ...data,
    timestamp: data.timestamp ?? Date.now(),
  });
}

interface CategorizedError {
  category: ErrorCategory;
  userMessage: string;
  technicalDetails: string;
  requestId: string;
  retryable: boolean;
  statusCode: number;
}

function categorizeError(error: any, requestId: string): CategorizedError {
  const errorMessage = error?.message?.toLowerCase() || '';
  const errorCode = error?.code || error?.statusCode;

  if (errorMessage.includes('rate limit') || errorMessage.includes('too many requests') || errorCode === 429) {
    return {
      category: 'rate_limit',
      userMessage: 'Has excedido el límite de solicitudes. Por favor espera unos segundos e intenta de nuevo.',
      technicalDetails: error.message,
      requestId,
      retryable: true,
      statusCode: 429
    };
  }

  if (errorMessage.includes('timeout') || errorMessage.includes('timed out') || errorCode === 'ETIMEDOUT') {
    return {
      category: 'timeout',
      userMessage: 'La solicitud tardó demasiado tiempo. Por favor intenta de nuevo.',
      technicalDetails: error.message,
      requestId,
      retryable: true,
      statusCode: 504
    };
  }

  if (errorMessage.includes('network') || errorMessage.includes('econnrefused') ||
    errorMessage.includes('enotfound') || errorCode === 'ECONNREFUSED') {
    return {
      category: 'network',
      userMessage: 'Error de conexión. Verifica tu conexión a internet e intenta de nuevo.',
      technicalDetails: error.message,
      requestId,
      retryable: true,
      statusCode: 503
    };
  }

  if (errorMessage.includes('unauthorized') || errorMessage.includes('authentication') ||
    errorCode === 401 || errorCode === 403) {
    return {
      category: 'auth',
      userMessage: 'Error de autenticación. Por favor inicia sesión de nuevo.',
      technicalDetails: error.message,
      requestId,
      retryable: false,
      statusCode: 401
    };
  }

  if (errorMessage.includes('invalid') || errorMessage.includes('validation') || errorCode === 400) {
    return {
      category: 'validation',
      userMessage: 'Los datos enviados no son válidos. Por favor verifica tu solicitud.',
      technicalDetails: error.message,
      requestId,
      retryable: false,
      statusCode: 400
    };
  }

  if (error?.response?.status >= 500 || errorMessage.includes('internal') || errorMessage.includes('server error')) {
    return {
      category: 'api_error',
      userMessage: 'El servicio de IA está experimentando problemas. Por favor intenta de nuevo en unos minutos.',
      technicalDetails: error.message,
      requestId,
      retryable: true,
      statusCode: 502
    };
  }

  return {
    category: 'unknown',
    userMessage: 'Ocurrió un error inesperado. Por favor intenta de nuevo.',
    technicalDetails: error.message || 'Unknown error',
    requestId,
    retryable: true,
    statusCode: 500
  };
}

export function createChatAiRouter(broadcastAgentUpdate: (runId: string, update: any) => void) {
  const router = Router();

  router.get("/models", (req, res) => {
    res.json(AVAILABLE_MODELS);
  });

  // ── Admin: Prompt Integrity Stats ──
  router.get("/admin/prompt-integrity/stats", async (req, res) => {
    try {
      const stats = await promptAuditStore.getStats();
      res.json(stats);
    } catch (err: any) {
      console.error("[Admin] Prompt integrity stats error:", err?.message);
      res.status(500).json({ error: "Failed to retrieve stats" });
    }
  });

  // Helper function to detect if a file is a document (not an image)
  // Uses mimeType AND file extension for reliable detection
  const isDocumentAttachment = (mimeType: string, fileName: string, type?: string): boolean => {
    const lowerMime = (mimeType || "").toLowerCase();
    const lowerName = (fileName || "").toLowerCase();
    const lowerType = (type || "").toLowerCase();

    // Check for explicit image type/MIME first
    if (lowerType === "image" || lowerMime.startsWith("image/")) return false;

    // Document MIME patterns
    const docMimePatterns = [
      "pdf", "word", "document", "sheet", "excel",
      "spreadsheet", "presentation", "powerpoint", "csv",
      "text/plain", "text/csv", "application/json"
    ];
    if (docMimePatterns.some(p => lowerMime.includes(p))) return true;

    // Document file extensions
    const docExtensions = [
      ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
      ".csv", ".txt", ".json", ".rtf", ".odt", ".ods", ".odp"
    ];
    if (docExtensions.some(ext => lowerName.endsWith(ext))) return true;

    // If type is explicitly a document type
    if (["pdf", "word", "excel", "ppt", "document"].includes(lowerType)) return true;

    // If mimeType is empty/unknown, check extension before treating as document
    if (!lowerMime || lowerMime === "application/octet-stream") {
      const hasImageExt = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".bmp"].some(ext => lowerName.endsWith(ext));
      return !hasImageExt; // If not an image extension, treat as document
    }

    return false;
  };

  router.post("/chat", async (req, res) => {
    try {
      const { messages: clientMessages, useRag = true, conversationId, images, gptConfig, gptId, documentMode, figmaMode, provider = DEFAULT_PROVIDER, model = DEFAULT_MODEL, attachments, lastImageBase64, lastImageId, session_id, skillId, skill } = req.body;

      if (!clientMessages || !Array.isArray(clientMessages)) {
        return res.status(400).json({ error: "Messages array is required" });
      }

      const authenticatedUserId = getUserId(req);
      const effectiveUserId = authenticatedUserId || getOrCreateSecureUserId(req);
      const userId = effectiveUserId;

      const isRequestedModelFree = !model || model === FREE_MODEL_ID || isModelFreeForAll(model);
      if (!authenticatedUserId && userId.startsWith("anon_") && !isRequestedModelFree && !canUseAnonymousLocalGemma(req, model)) {
        console.warn(`[Chat] Blocked anonymous chat attempt from IP=${req.ip}, UA=${(req.headers["user-agent"] || "").slice(0, 80)}`);
        return res.status(401).json({
          error: "Authentication required. Please sign in with Google to use the chat.",
          code: "AUTH_REQUIRED"
        });
      }

      // Local control commands (safe mode): /local ..., DETENEROFF/DETENERON, and desktop-folder shortcut.
      const latestUserMessage = [...clientMessages].reverse().find((m: any) => m?.role === "user");
      const latestUserText = extractUserText(latestUserMessage?.content);
      const localControlResult = await executeLocalControlRequest(latestUserText, {
        requestId: `chat_${uuidv4().replace(/-/g, "").slice(0, 16)}`,
        userId,
      });
      if (localControlResult.handled) {
        if (!localControlResult.ok) {
          return res.status(localControlResult.statusCode).json({
            error: localControlResult.message,
            code: localControlResult.code,
            localAction: localControlResult.payload || null,
          });
        }
        return res.status(200).json({
          content: localControlResult.message,
          provider: "local-system",
          model: "local-system",
          usage: null,
          files: [],
          localAction: {
            code: localControlResult.code,
            ...(localControlResult.payload || {}),
          },
        });
      }

      // CONTEXT FIX: Augment client messages with server-side history
      const { messages, diagnostics: memoryDiagnostics } = await augmentHistoryWithCompatibility(
        conversationId,
        clientMessages,
        8000 // token budget
      );
      console.log(`[Chat API] Context augmented: ${clientMessages.length} client msgs -> ${messages.length} total`, memoryDiagnostics);

      // userId already extracted above

      if (userId) {
        // Anonymous users (anon_*) won't have a `users` row yet. Ensure one exists so
        // quota checks and FK-backed features work instead of hard-failing.
        await ensureUserRowExists(userId, req);

        // 1. Token Quota Check (Read-only)
        const hasTokenQuota = await usageQuotaService.hasTokenQuota(userId);
        if (!hasTokenQuota) {
          return res.status(402).json({
            error: "Has excedido tu límite de tokens. Actualiza tu plan o agrega créditos para continuar.",
            code: "TOKEN_QUOTA_EXCEEDED"
          });
        }
      }

      // GPT Session Contract Resolution
      // Priority: session_id (reuse existing) > gptId (create new) > gptConfig (legacy)
      let gptSessionContract: GptSessionContract | null = null;
      let effectiveModel = model;
      let serverSessionId: string | null = null;

      // Helper to determine if conversationId is valid for session lookup
      const isValidConversationId = (id?: string): boolean => {
        if (!id) return false;
        if (id.startsWith('pending-')) return false;
        if (id.trim() === '') return false;
        return true;
      };

      // First, try to retrieve existing session by session_id
      if (session_id) {
        try {
          gptSessionContract = await getSessionById(session_id);
          if (gptSessionContract) {
            serverSessionId = gptSessionContract.sessionId;
            effectiveModel = getEnforcedModel(gptSessionContract, model);
            console.log(`[Chat API] Reusing existing session: session_id=${session_id}, gptId=${gptSessionContract.gptId}, configVersion=${gptSessionContract.configVersion}`);
          } else {
            console.log(`[Chat API] Session not found: session_id=${session_id}, will create new if gptId provided`);
          }
        } catch (sessionError) {
          console.error(`[Chat API] Error retrieving session ${session_id}:`, sessionError);
        }
      }

      // If no session from session_id, try to create/get one via gptId
      if (!gptSessionContract && gptId) {
        try {
          if (isValidConversationId(conversationId)) {
            // Valid conversationId - use it for session lookup
            gptSessionContract = await getOrCreateSession(conversationId, gptId);
            console.log(`[Chat API] GPT Session created/retrieved: gptId=${gptId}, configVersion=${gptSessionContract.configVersion}`);
          } else {
            // No valid conversationId - create session with null chatId (still persisted)
            gptSessionContract = await getOrCreateSession("", gptId);
            console.log(`[Chat API] New GPT Session created: gptId=${gptId}, sessionId=${gptSessionContract.sessionId}, configVersion=${gptSessionContract.configVersion}`);
          }
          serverSessionId = gptSessionContract.sessionId;
          effectiveModel = getEnforcedModel(gptSessionContract, model);
        } catch (sessionError) {
          console.error(`[Chat API] Error creating GPT session for gptId=${gptId}:`, sessionError);
          // Fall back to legacy gptConfig if session creation fails
        }
      }

      // Track GPT Usage (Fire-and-forget)
      const usageGptId = gptSessionContract?.gptId || gptId;
      if (usageGptId) {
        storage.incrementGptUsage(usageGptId).catch(e => console.error(`[Chat API] Failed to increment GPT usage for ${usageGptId}:`, e));
      }

      // DATA_MODE ENFORCEMENT: Reject document attachments - must use /analyze endpoint
      const normalizedChatAttachments = Array.isArray(attachments)
        ? attachments
          .slice(0, MAX_STREAM_SKILL_ATTACHMENTS)
          .map(sanitizeStreamAttachment)
          .filter((att): att is NonNullable<ReturnType<typeof sanitizeStreamAttachment>> => !!att)
        : [];
      const hasDocumentAttachments = normalizedChatAttachments.length > 0
        ? normalizedChatAttachments.some((a) => isDocumentAttachment(a.mimeType || a.type || "", a.name || "", a.type || a.mimeType || ""))
        : false;

      if (hasDocumentAttachments) {
        console.log(`[Chat API] DATA_MODE: Rejecting document attachments - must use /analyze endpoint`);
        return res.status(400).json({
          error: "Document attachments must be processed via /api/analyze endpoint for proper analysis",
          code: "USE_ANALYZE_ENDPOINT"
        });
      }

      let attachmentContext = "";
      const hasAttachments = normalizedChatAttachments.length > 0;

      if (hasAttachments) {
        console.log(`[Chat API] Processing ${normalizedChatAttachments.length} attachment(s)`);
        try {
          const extractedContents: { extracted: Awaited<ReturnType<typeof extractAttachmentContent>>; attachment: Attachment }[] = [];
          for (const attachment of normalizedChatAttachments as Attachment[]) {
            const extracted = await extractAttachmentContent(attachment);
            extractedContents.push({ extracted, attachment });
          }

          const failedExtractions = extractedContents.filter(e => e.extracted === null);
          if (failedExtractions.length > 0) {
            console.warn(`[Chat API] Failed to extract content from ${failedExtractions.length} attachment(s):`,
              failedExtractions.map(e => e.attachment.name).join(', '));
          }
          const successfulExtractions = extractedContents.filter(e => e.extracted !== null).map(e => e.extracted!);
          if (successfulExtractions.length > 0) {
            attachmentContext = formatAttachmentsAsContext(successfulExtractions);
            console.log(`[Chat API] Extracted content from ${successfulExtractions.length} attachment(s), context length: ${attachmentContext.length}`);
          }

          if (conversationId) {
            for (const { extracted, attachment } of extractedContents) {
              if (extracted) {
                try {
                  await storage.createConversationDocument({
                    chatId: conversationId,
                    fileName: extracted.fileName,
                    storagePath: attachment.storagePath || null,
                    mimeType: extracted.mimeType || "application/octet-stream",
                    fileSize: (attachment as any).size || null,
                    extractedText: extracted.content,
                    metadata: { fileId: attachment.fileId }
                  });
                  console.log(`[Chat API] Persisted document: ${extracted.fileName} to conversation ${conversationId}`);
                } catch (persistError) {
                  console.error(`[Chat API] Error persisting document ${extracted.fileName}:`, persistError);
                }
              }
            }
          }
        } catch (attachmentError) {
          console.error("[Chat API] Error extracting attachment content:", attachmentError);
        }
      }

      const resolvedSkillContext = await resolveSkillContextFromRequest(drizzleSkillStore, {
        userId,
        skillId,
        skill,
      });
      const skillSystemSection = buildSkillSystemPromptSection(resolvedSkillContext);
      if (skillSystemSection) {
        console.info("[SkillContext] Applied to /api/chat", {
          userId,
          source: resolvedSkillContext?.source,
          skillId: resolvedSkillContext?.id || null,
          skillName: resolvedSkillContext?.name,
        });
      }

      const formattedMessages = messages.map((msg: { role: string; content: string }) => ({
        role: msg.role as "user" | "assistant" | "system",
        content: msg.content
      }));

      const messagesWithSkill = skillSystemSection
        ? [{ role: "system" as const, content: skillSystemSection }, ...formattedMessages]
        : formattedMessages;

      if (userId) {
        const estimatedInputTokens = messagesWithSkill.reduce((sum, msg) => {
          const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content ?? "");
          return sum + Math.ceil(content.length / 4);
        }, 0);

        const dailyTokenQuota = await usageQuotaService.getDailyTokenQuotaStatus(userId, estimatedInputTokens);
        if (!dailyTokenQuota.allowed) {
          return res.status(402).json({
            error: dailyTokenQuota.message || "Límite diario de tokens alcanzado",
            code: "DAILY_TOKEN_LIMIT_EXCEEDED",
            quota: {
              inputUsed: dailyTokenQuota.inputUsed,
              outputUsed: dailyTokenQuota.outputUsed,
              inputLimit: dailyTokenQuota.inputLimit,
              outputLimit: dailyTokenQuota.outputLimit,
              inputRemaining: dailyTokenQuota.inputRemaining,
              outputRemaining: dailyTokenQuota.outputRemaining,
              resetAt: dailyTokenQuota.resetAt,
            }
          });
        }

        const usageCheck = await usageQuotaService.checkAndIncrementUsage(userId);
        if (!usageCheck.allowed) {
          return res.status(402).json({
            error: usageCheck.message || "Límite de solicitudes alcanzado",
            code: "QUOTA_EXCEEDED",
            quota: {
              remaining: usageCheck.remaining,
              limit: usageCheck.limit,
              resetAt: usageCheck.resetAt,
              plan: usageCheck.plan
            }
          });
        }
      }

      // Build gptSession info - prefer contract-based session over legacy gptConfig
      const gptSession = gptSessionContract ? {
        contract: gptSessionContract,
      } : gptConfig ? {
        contract: null,
        legacyConfig: gptConfig
      } : undefined;

      const response = await chatService.chat(messagesWithSkill, {
        useRag,
        conversationId,
        userId,
        images,
        gptSession,
        gptConfig, // Keep for backward compatibility
        documentMode,
        figmaMode,
        provider,
        model: effectiveModel,
        attachmentContext,
        forceDirectResponse: hasAttachments && attachmentContext.length > 0,
        hasRawAttachments: hasAttachments,
        lastImageBase64,
        lastImageId,
        onAgentProgress: (update) => broadcastAgentUpdate(update.runId, update)
      });

      // Token Usage Accounting
      if (userId && response.usage && (response.usage.promptTokens || response.usage.completionTokens)) {
        usageQuotaService.recordTokenUsageDetailed(
          userId,
          response.usage.promptTokens || 0,
          response.usage.completionTokens || 0
        ).catch(err => {
          console.error(`[Chat API] Failed to record token usage for user ${userId}:`, err);
        });
        // Pipeline: track usage in analytics module
        trackLLMUsage(userId, "default", effectiveModel || "unknown", response.usage.promptTokens || 0, response.usage.completionTokens || 0);
      }

      if (userId) {
        try {
          await storage.createAuditLog({
            userId,
            action: "chat_query",
            resource: "chats",
            resourceId: conversationId || null,
            details: {
              messageCount: messages.length,
              useRag,
              documentMode: documentMode || false,
              hasImages: !!images && images.length > 0,
              gptId: gptSessionContract?.gptId || gptConfig?.id || null,
              configVersion: gptSessionContract?.configVersion || null,
              tokens: response.usage?.totalTokens || 0,
              promptTokens: response.usage?.promptTokens || 0,
              completionTokens: response.usage?.completionTokens || 0,
            }
          });
        } catch (auditError) {
          console.error("Failed to create audit log:", auditError);
        }
      }

      // Pipeline: extract facts from conversation in background (non-blocking)
      if (userId && messages.length > 0) {
        const recentMessages = messages.slice(-6).map((m: any) => ({
          role: m.role || "user",
          content: typeof m.content === "string" ? m.content : "",
        }));
        extractFactsInBackground(recentMessages, userId);
      }

      // Add GPT session metadata to response if contract-based session is active
      const responseWithMetadata = gptSessionContract ? {
        ...response,
        gpt_id: gptSessionContract.gptId,
        config_version: gptSessionContract.configVersion,
        tool_permissions: gptSessionContract.toolPermissions,
        session_id: serverSessionId || gptSessionContract.sessionId
      } : response;

      res.json({
        ...responseWithMetadata,
        memoryCompression: memoryDiagnostics.compressionApplied
          ? {
              originalTokens: memoryDiagnostics.originalTokens,
              finalTokens: memoryDiagnostics.finalTokens,
              originalMessageCount: memoryDiagnostics.originalMessageCount,
              finalMessageCount: memoryDiagnostics.finalMessageCount,
              summarizedMessages: memoryDiagnostics.summarizedMessages,
              relevantMessagesKept: memoryDiagnostics.relevantMessagesKept,
              recentMessagesKept: memoryDiagnostics.recentMessagesKept,
            }
          : undefined,
      });
    } catch (error: any) {
      const requestId = `chat_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      console.error(`[Chat API Error] requestId=${requestId}:`, error);

      const categorized = categorizeError(error, requestId);
      res.status(categorized.statusCode).json({
        error: categorized.userMessage,
        category: categorized.category,
        details: categorized.technicalDetails,
        requestId: categorized.requestId,
        retryable: categorized.retryable
      });
    }
  });

  router.post("/voice-chat", async (req, res) => {
    try {
      const { message } = req.body;

      if (!message || typeof message !== "string") {
        return res.status(400).json({ error: "Message is required" });
      }

      console.log("[VoiceChat] Processing voice input:", message);

      const authenticatedVoiceUser = getUserId(req);
      const userId = authenticatedVoiceUser || getOrCreateSecureUserId(req);
      if (!authenticatedVoiceUser && userId.startsWith("anon_")) {
        return res.status(401).json({
          error: "Authentication required. Please sign in to use voice chat.",
          code: "AUTH_REQUIRED"
        });
      }
      let featureFlags = {
        voiceEnabled: true,
        voiceAdvanced: false,
        memoryEnabled: false,
        recordingHistoryEnabled: false,
      };
      let responseStyle: string = "default";
      let customInstructions: string = "";
      let userProfile: any = null;

      try {
        const userSettings = await storage.getUserSettings(userId);
        featureFlags = {
          voiceEnabled: userSettings?.featureFlags?.voiceEnabled ?? true,
          voiceAdvanced: userSettings?.featureFlags?.voiceAdvanced ?? false,
          memoryEnabled: userSettings?.featureFlags?.memoryEnabled ?? false,
          recordingHistoryEnabled: userSettings?.featureFlags?.recordingHistoryEnabled ?? false,
        };
        responseStyle = userSettings?.responsePreferences?.responseStyle || "default";
        customInstructions = userSettings?.responsePreferences?.customInstructions || "";
        userProfile = userSettings?.userProfile || null;
      } catch (e) {
        console.warn("[VoiceChat] Failed to load user settings:", (e as any)?.message || e);
      }

      if (!featureFlags.voiceEnabled) {
        return res.status(403).json({
          error: "Voice mode is disabled in your settings",
          code: "VOICE_DISABLED",
        });
      }

      const voiceStyleLine =
        responseStyle === "formal"
          ? "Usa un tono formal y profesional."
          : responseStyle === "casual"
            ? "Usa un tono casual y amigable."
            : responseStyle === "concise"
              ? "Sé muy conciso y ve directo al punto."
              : "Usa un tono neutro y claro.";

      const userProfileLine =
        userProfile && (userProfile.nickname || userProfile.occupation)
          ? `Usuario: ${userProfile.nickname ? userProfile.nickname : "N/A"}${userProfile.occupation ? ` (${userProfile.occupation})` : ""}.`
          : "";

      const result = await llmGateway.chat([
        {
          role: "system",
          content: `Eres iliagpt, un asistente de voz amigable y conversacional. 
Responde de manera natural y concisa, como si estuvieras hablando directamente con el usuario.
${featureFlags.voiceAdvanced ? "Puedes dar respuestas un poco más completas (hasta 5 oraciones) cuando haga falta." : "Mantén las respuestas cortas (2-3 oraciones máximo) para que sean fáciles de escuchar."}
Usa un tono cálido y conversacional en español. ${voiceStyleLine}
No uses markdown, emojis ni formatos especiales ya que tu respuesta será leída en voz alta.${userProfileLine ? `\n${userProfileLine}` : ""}${customInstructions ? `\n\nInstrucciones personalizadas del usuario:\n${customInstructions}` : ""}`
        },
        {
          role: "user",
          content: message
        }
      ], {
        model: featureFlags.voiceAdvanced ? "grok-4-fast-non-reasoning" : "grok-3-fast",
        temperature: 0.7,
        maxTokens: featureFlags.voiceAdvanced ? 250 : 150,
      });

      // Best-effort: store voice interactions depending on user settings.
      if (userId && (featureFlags.memoryEnabled || featureFlags.recordingHistoryEnabled)) {
        void (async () => {
          try {
            await ensureUserRowExists(userId);
            await semanticMemoryStore.initialize();

            if (featureFlags.recordingHistoryEnabled) {
              const stamp = new Date().toISOString();
              const convo = `(${stamp}) Voz: Usuario dijo: "${message}". Asistente respondió: "${result.content}".`;
              await semanticMemoryStore.remember(userId, convo, "conversation", {
                source: "voice_chat",
                confidence: 0.7,
              });
            }

            if (featureFlags.memoryEnabled) {
              await semanticMemoryStore.extractFromConversation(userId, [
                { role: "user", content: message },
              ]);
            }
          } catch (e) {
            console.warn("[VoiceChat] Failed to store memory:", (e as any)?.message || e);
          }
        })();
      }

      res.json({
        success: true,
        response: result.content,
        latencyMs: result.latencyMs
      });
    } catch (error: any) {
      console.error("Voice chat error:", error);
      res.status(500).json({
        error: "Failed to process voice message",
        details: error.message
      });
    }
  });

  router.post("/image/generate", async (req, res) => {
    try {
      const { prompt } = req.body;

      if (!prompt || typeof prompt !== "string") {
        return res.status(400).json({ error: "Prompt is required" });
      }

      console.log("[ImageGen] Generating image for prompt:", prompt);

      const result = await generateImage(prompt);

      res.json({
        success: true,
        imageData: `data:${result.mimeType};base64,${result.imageBase64}`,
        prompt: result.prompt
      });
    } catch (error: any) {
      console.error("Image generation error:", error);
      res.status(500).json({
        error: "Failed to generate image",
        details: error.message
      });
    }
  });

  router.post("/image/detect", (req, res) => {
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ error: "Message is required" });
    }

    const isImageRequest = detectImageRequest(message);
    const extractedPrompt = isImageRequest ? extractImagePrompt(message) : null;

    res.json({ isImageRequest, extractedPrompt });
  });

  router.post("/video/generate", async (req, res) => {
    try {
      const { prompt, duration, style, aspectRatio } = req.body;
      if (!prompt) return res.status(400).json({ error: "Prompt is required" });
      console.log(`[API] Video generation request: "${prompt.slice(0, 60)}..."`);
      const result = await generateVideo(prompt, { duration, style, aspectRatio });
      res.json(result);
    } catch (error: any) {
      console.error("[API] Video generation error:", error);
      res.status(500).json({ error: "Failed to generate video", details: error.message });
    }
  });

  router.post("/video/detect", (req, res) => {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: "Message is required" });
    const isVideoRequest = detectVideoRequest(message);
    const extractedPrompt = isVideoRequest ? extractVideoPrompt(message) : null;
    res.json({ isVideoRequest, extractedPrompt });
  });

  router.post("/media/detect", (req, res) => {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: "Message is required" });
    const isImageReq = detectImageRequest(message);
    const isVideoReq = detectVideoRequest(message);
    res.json({
      isImageRequest: isImageReq,
      isVideoRequest: isVideoReq,
      mediaType: isVideoReq ? "video" : isImageReq ? "image" : "none",
      extractedPrompt: isVideoReq ? extractVideoPrompt(message) : isImageReq ? extractImagePrompt(message) : null,
    });
  });

  router.get("/etl/config", async (req, res) => {
    try {
      res.json({
        countries: getAvailableCountries(),
        indicators: getAvailableIndicators()
      });
    } catch (error: any) {
      console.error("ETL config error:", error);
      res.status(500).json({ error: "Failed to get ETL config" });
    }
  });

  router.post("/etl/run", async (req, res) => {
    try {
      const { countries, indicators, startDate, endDate } = req.body;

      if (!countries || !Array.isArray(countries) || countries.length === 0) {
        return res.status(400).json({ error: "Countries array is required" });
      }

      console.log("[ETL API] Starting ETL for countries:", countries);

      const result = await runETLAgent({
        countries,
        indicators,
        startDate,
        endDate
      });

      if (result.success && result.workbookBuffer) {
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
        res.send(result.workbookBuffer);
      } else {
        res.status(result.success ? 200 : 500).json({
          success: result.success,
          message: result.message,
          summary: result.summary,
          errors: result.errors
        });
      }
    } catch (error: any) {
      console.error("ETL API error:", error);
      res.status(500).json({
        error: "ETL pipeline failed",
        details: error.message
      });
    }
  });

  // Get run status - for polling
  router.get("/chat/runs/:runId", async (req, res) => {
    try {
      const run = await storage.getChatRun(req.params.runId);
      if (!run) {
        return res.status(404).json({ error: "Run not found" });
      }
      res.json(run);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/chat/stream", validate({ body: streamChatRequestSchema }), async (req, res) => {
    const requestId = sanitizeStreamIdentifier(req.headers["x-request-id"], `stream_${Date.now()}`);
    const streamStartMs = performance.now();
    const stageTimings: Record<string, number> = {};
    let firstTokenAtMs: number | null = null;
    let timingReported = false;
    const roundMs = (value: number): number => Number(Math.max(0, value).toFixed(1));
    const recordStage = (stage: string, stageStartMs: number): void => {
      stageTimings[stage] = roundMs(performance.now() - stageStartMs);
    };
    const markFirstToken = (): void => {
      if (firstTokenAtMs === null) {
        firstTokenAtMs = performance.now();
      }
    };
    const buildTimingPayload = (): Record<string, number | null> => {
      const now = performance.now();
      const totalMs = roundMs(now - streamStartMs);
      const processingMs =
        firstTokenAtMs === null
          ? totalMs
          : roundMs(firstTokenAtMs - streamStartMs);
      const streamingMs =
        firstTokenAtMs === null
          ? 0
          : roundMs(now - firstTokenAtMs);

      return {
        ...stageTimings,
        totalMs,
        processingMs,
        firstTokenMs: firstTokenAtMs === null ? null : roundMs(firstTokenAtMs - streamStartMs),
        streamingMs,
      };
    };
    const reportTimings = (status: string): Record<string, number | null> => {
      const timings = buildTimingPayload();
      if (!timingReported) {
        timingReported = true;
        console.log("[Perf][chat_stream]", {
          traceId: requestId,
          status,
          ...timings,
        });
      }
      return timings;
    };

    let heartbeatInterval: NodeJS.Timeout | null = null;
    let isConnectionClosed = false;
    let claimedRun: any = null;
    let runFinalized = false; // true once run status has been set to done/failed
    let assistantMessageId: string | null = null;
    let activeStreamProvider: string | null = null;
    let streamHardTimeout: NodeJS.Timeout | null = null;
    let streamIdleTimeout: NodeJS.Timeout | null = null;
    let fullContent = "";
    let lastAckSequence = -1;
    let agentLoopHandled = false;
    let shouldRunModel = true;
    let skillSeedForModel = "";
    let skillExecutionResult: SkillExecutionResult | null = null;
    let latencyMode: LatencyMode = "auto";
    let capturedSearchQueries: Array<{ query: string; resultCount: number; status: string }> = [];
    let capturedTotalSearches = 0;
    let streamConversationId = "";

    const STREAM_HARD_TIMEOUT_MS = 180_000;
    const STREAM_IDLE_TIMEOUT_MS = 90_000; // must exceed llmGateway idle timeout (60s)

    const clearStreamTimeouts = (): void => {
      if (streamHardTimeout) {
        clearTimeout(streamHardTimeout);
        streamHardTimeout = null;
      }
      if (streamIdleTimeout) {
        clearTimeout(streamIdleTimeout);
        streamIdleTimeout = null;
      }
    };

    const endStreamByTimeout = (code: string, message: string): void => {
      if (isConnectionClosed) return;
      isConnectionClosed = true;
      clearStreamTimeouts();
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
      }
      const streamMeta = (res as any)?.locals?.streamMeta;
      if (streamMeta) {
        streamMeta.onWrite = undefined;
      }
      writeSse(res, "error", {
        code,
        error: message,
        timeout: true,
        timestamp: Date.now(),
      });
      emitDoneEvent(res, {
        requestId,
        runId: claimedRun?.id || requestId,
        assistantMessageId,
        latencyMode,
        totalSequences: fullContent.trim() && lastAckSequence < 0 ? 1 : Math.max(0, lastAckSequence + 1),
        contentLength: fullContent.length,
        provider: activeStreamProvider || undefined,
        completionReason: code,
        timeout: true,
        error: true,
        traceId: requestId,
        timings: reportTimings(code),
      });
      if (!(res as any).writableEnded) {
        res.end();
      }
    };

    const resetIdleTimeout = (): void => {
      if (isConnectionClosed) return;
      refreshConversationStreamLock(streamConversationId, requestId);
      if (streamIdleTimeout) {
        clearTimeout(streamIdleTimeout);
      }
      streamIdleTimeout = setTimeout(() => {
        endStreamByTimeout(
          "stream_inactivity_timeout",
          `Stream closed after ${STREAM_IDLE_TIMEOUT_MS}ms without SSE activity`
        );
      }, STREAM_IDLE_TIMEOUT_MS);
    };

    const cleanupClaimedRunIfOrphaned = async (reason: string): Promise<void> => {
      if (!claimedRun || runFinalized) return;
      try {
        const currentRun = await storage.getChatRun(claimedRun.id);
        const ourStartedAt = claimedRun.startedAt ? new Date(claimedRun.startedAt).getTime() : 0;
        const currentStartedAt = currentRun?.startedAt ? new Date(currentRun.startedAt).getTime() : 0;
        if (currentRun?.status === "processing" && currentStartedAt <= ourStartedAt) {
          console.log(`[Run] Cleaning up orphaned run ${claimedRun.id} (${reason})`);
          await storage.updateChatRunStatus(claimedRun.id, "failed", reason);
          runFinalized = true;
        }
      } catch (cleanupErr) {
        console.warn("[Run] Failed to cleanup orphaned run:", cleanupErr);
      }
    };

    const skipRunStreamDedup = new Map<string, { requestId: string; startedAt: number }>();
    const SKIPRUN_STREAM_DEDUP_TTL_MS = 20_000;

    const buildSkipRunStreamKey = (chatId: string | undefined, clientRequestId?: string, userRequestId?: string): string | null => {
      if (!chatId || !clientRequestId) {
        return null;
      }
      return `skipRunStream:${chatId}:${clientRequestId}:${userRequestId || ""}`;
    };

    const cleanSkipRunStreamDedup = (): void => {
      const now = Date.now();
      for (const [key, value] of skipRunStreamDedup.entries()) {
        if (now - value.startedAt > SKIPRUN_STREAM_DEDUP_TTL_MS) {
          skipRunStreamDedup.delete(key);
        }
      }
    };

    try {
      const {
        messages: clientMessages,
        conversationId,
        runId,
        chatId,
        clientRequestId: rawClientRequestId,
        userRequestId: rawUserRequestId,
        attachments,
        gptId,
        model,
        provider: rawProvider,
        session_id,
        docTool,
        forceWebSearch,
        webSearchAuto,
        latencyMode: rawLatencyMode,
        lastImageBase64,
        lastImageId,
        skillId,
        skill,
        skillScopes
      } = req.body;
      latencyMode = ['fast', 'deep', 'auto'].includes(rawLatencyMode) ? rawLatencyMode : 'auto';
      const authenticatedStreamUser = getUserId(req);
      const effectiveUserId = authenticatedStreamUser || getOrCreateSecureUserId(req);
      const requestedModel = typeof model === "string" ? model.trim() : "";
      const isUsingFreeModel = !requestedModel || requestedModel === FREE_MODEL_ID || isModelFreeForAll(requestedModel);
      const allowAnonymousLocalGemma = canUseAnonymousLocalGemma(req, requestedModel);
      if (!authenticatedStreamUser && effectiveUserId.startsWith("anon_") && !isUsingFreeModel && !allowAnonymousLocalGemma) {
        console.warn(`[Stream] Blocked anonymous stream attempt from IP=${req.ip}, model=${requestedModel}`);
        res.setHeader("Content-Type", "text/event-stream");
        applySseSecurityHeaders(res);
        res.write(`data: ${JSON.stringify({ type: "error", error: "Authentication required. Please sign in with Google to use this model.", code: "AUTH_REQUIRED" })}\n\n`);
        return res.end();
      }
      if (!authenticatedStreamUser && effectiveUserId.startsWith("anon_") && allowAnonymousLocalGemma) {
        console.log(`[Stream] Anonymous localhost Gemma allowed in development from IP=${req.ip}, model=${requestedModel}`);
      }
      if (!authenticatedStreamUser && effectiveUserId.startsWith("anon_") && isUsingFreeModel) {
        console.log(`[Stream] Anonymous user allowed with free model (${FREE_MODEL_ID}) from IP=${req.ip}`);
      }
      streamConversationId = sanitizeStreamIdentifier(
        typeof conversationId === "string" && conversationId.trim().length > 0
          ? conversationId
          : (typeof chatId === "string" && chatId.trim().length > 0
            ? chatId
            : `chat_${requestId}`),
        "chat_stream"
      );

      cleanConversationStreamLocks();
      cleanConversationStreamWaiters();
      const queueMode =
        (req.body as any)?.queueMode === "reject"
          ? "reject"
          : (req.body as any)?.queueMode === "replace"
            ? "replace"
            : "queue";
      const existingConversationLock = CONVERSATION_STREAM_LOCKS.get(streamConversationId);
      if (existingConversationLock && existingConversationLock.requestId !== requestId) {
        if (queueMode === "reject") {
          return res.status(409).json({
            status: "already_processing",
            conversationId: streamConversationId,
            requestId: existingConversationLock.requestId,
          });
        }
        if (queueMode === "replace") {
          existingConversationLock.cancel("stream_replaced");
          CONVERSATION_STREAM_LOCKS.delete(streamConversationId);
        } else {
          const queueWaitStart = performance.now();
          try {
            const queueResult = await waitForConversationStreamTurn(streamConversationId, requestId, req);
            recordStage("conversation_queue_wait_ms", queueWaitStart);
            res.setHeader("X-Chat-Queue-Position", String(queueResult.initialPosition));
            res.setHeader("X-Chat-Queue-Wait-Ms", String(Math.round(queueResult.waitMs)));
          } catch (error: any) {
            if (error instanceof ConversationQueueError) {
              if (error.code === "QUEUE_ABORTED") {
                return;
              }

              const retryAfter = error.retryAfterSeconds || 1;
              res.setHeader("Retry-After", String(retryAfter));
              return res.status(429).json({
                status: error.code === "QUEUE_FULL" ? "conversation_queue_full" : "conversation_queue_timeout",
                conversationId: streamConversationId,
                retryable: true,
                retryAfter,
                error: error.message,
              });
            }
            throw error;
          }
        }
      }

      (res as any).locals = (res as any).locals || {};
      (res as any).locals.streamMeta = {
        conversationId: streamConversationId,
        requestId,
        getAssistantMessageId: () => assistantMessageId,
        enableResumePersistence: true,
        resumeStatus: "streaming",
        resumeContent: "",
        resumeLastSeq: 0,
        resumeFlushTimer: null,
        resumePersistPromise: null,
        onWrite: () => {
          refreshConversationStreamLock(streamConversationId, requestId);
          resetIdleTimeout();
        },
      };

      let conversationLockReleased = false;
      const releaseConversationLock = () => {
        if (conversationLockReleased) return;
        conversationLockReleased = true;
        const current = CONVERSATION_STREAM_LOCKS.get(streamConversationId);
        if (current?.requestId === requestId) {
          CONVERSATION_STREAM_LOCKS.delete(streamConversationId);
          promoteConversationStreamWaiter(streamConversationId);
        }
        detachAsyncTask(
          () => cleanupClaimedRunIfOrphaned("connection_closed"),
          "cleanup orphaned run on connection close",
        );
      };
      req.on("aborted", releaseConversationLock);
      res.on("close", releaseConversationLock);
      res.on("finish", releaseConversationLock);

      const cancelThisStream = (reason: string = "stream_replaced") => {
        endStreamByTimeout("stream_replaced", `Stream replaced (${reason})`);
      };
      CONVERSATION_STREAM_LOCKS.set(streamConversationId, {
        requestId,
        startedAt: Date.now(),
        lastActivityAt: Date.now(),
        cancel: cancelThisStream,
      });

      if (!streamHardTimeout) {
        streamHardTimeout = setTimeout(() => {
          endStreamByTimeout(
            "stream_hard_timeout",
            `Stream exceeded maximum duration of ${STREAM_HARD_TIMEOUT_MS}ms`
          );
        }, STREAM_HARD_TIMEOUT_MS);
      }
      resetIdleTimeout();

      const parsedSkillScopes = normalizeStreamSkillScopes(skillScopes);

      if (isDebugLogEnabled) {
        // DEBUG: Log attachments received from frontend
        if (attachments && Array.isArray(attachments) && attachments.length > 0) {
          console.log(`[Stream] INCOMING ATTACHMENTS (${attachments.length}):`, JSON.stringify(attachments.map((a: any) => ({
            type: a.type, name: a.name, mimeType: a.mimeType, storagePath: a.storagePath,
            fileId: a.fileId, hasContent: !!a.content,
          }))));
        } else {
          console.log(`[Stream] NO ATTACHMENTS in request body. Keys: ${Object.keys(req.body).join(', ')}`);
        }
        if (lastImageBase64) {
          console.log(`[Stream] lastImageBase64 present: ${typeof lastImageBase64 === 'string' ? `${lastImageBase64.substring(0, 50)}... (${lastImageBase64.length} chars)` : typeof lastImageBase64}`);
        }

        // DEBUG: Log all incoming request parameters for docTool verification
        // Avoid externally-controlled format strings: don't interpolate user-controlled values into
        // the first console argument (console uses util.format semantics).
        console.log("[Stream] REQUEST RECEIVED", { docTool, chatId, runId, forceWebSearch });
      }

      if (!clientMessages || !Array.isArray(clientMessages)) {
        return res.status(400).json({ error: "Messages array is required" });
      }

      // ── Prompt Integrity Check ──
      // Verify the latest user message was not altered/truncated in transit.
      const clientPromptLen = (req.body as any).clientPromptLen;
      const clientPromptHash = (req.body as any).clientPromptHash;
      if (clientPromptLen != null || clientPromptHash != null) {
        const latestUserForIntegrity = [...clientMessages].reverse().find((m: any) => m?.role === "user");
        if (latestUserForIntegrity?.content) {
          const integrityResult = checkPromptIntegrity(
            latestUserForIntegrity.content,
            clientPromptLen,
            clientPromptHash,
          );

          // Record prompt token estimate
          const promptTokenEst = Math.ceil(latestUserForIntegrity.content.length / 4);
          recordPromptTokens(promptTokenEst);
          recordDroppedChars(0); // Invariant: no chars dropped at this stage

          if (!integrityResult.valid) {
            recordIntegrityCheck("fail");
            console.error("[PromptIntegrity] MISMATCH detected", {
              requestId,
              mismatchType: integrityResult.mismatchType,
              clientLen: integrityResult.clientPromptLen,
              serverLen: integrityResult.serverPromptLen,
              lenDelta: integrityResult.lenDelta,
            });
            return res.status(422).json({
              error: "PROMPT_INTEGRITY_MISMATCH",
              message: "The prompt content was altered during transmission. Please retry.",
              details: {
                mismatchType: integrityResult.mismatchType,
                serverLen: integrityResult.serverPromptLen,
                clientLen: integrityResult.clientPromptLen,
                lenDelta: integrityResult.lenDelta,
              },
            });
          }
          recordIntegrityCheck("pass");
          // Attach integrity metadata to res.locals for downstream logging
          (res as any).locals.promptIntegrity = {
            serverPromptLen: integrityResult.serverPromptLen,
            serverPromptHash: integrityResult.serverPromptHash,
            verified: true,
          };
        }
      } else {
        recordIntegrityCheck("skipped");
      }

      // ── Prompt Pre-Processing Pipeline ──
      // NFC normalization, language detection, structure analysis, dedup, whitespace cleanup.
      const latestUserForPreProcess = [...clientMessages].reverse().find((m: any) => m?.role === "user");
      if (latestUserForPreProcess?.content && typeof latestUserForPreProcess.content === "string") {
        try {
          const preProcessResult = promptPreProcessor.process(latestUserForPreProcess.content);
          recordPreprocessDuration(preProcessResult.processingTimeMs);
          if (preProcessResult.nfcApplied) recordNfcNormalization();
          if (preProcessResult.isDuplicate) recordDuplicateDetected();
          recordLanguageDetected(preProcessResult.language.primaryLanguage);

          // Attach to res.locals for downstream use
          (res as any).locals.preProcessResult = preProcessResult;

          // Persist pre-processing transformation to audit trail
          promptAuditStore.logTransformation({
            chatId: chatId || undefined,
            runId: runId || undefined,
            requestId,
            stage: "normalize",
            inputTokens: Math.ceil(preProcessResult.originalText.length / 4),
            outputTokens: Math.ceil(preProcessResult.text.length / 4),
            droppedChars: preProcessResult.whitespace.originalLen - preProcessResult.whitespace.normalizedLen,
            transformationDetails: {
              nfcApplied: preProcessResult.nfcApplied,
              language: preProcessResult.language.primaryLanguage,
              isMultiLingual: preProcessResult.language.isMultiLingual,
              structureType: preProcessResult.structure.type,
              isDuplicate: preProcessResult.isDuplicate,
              whitespace: preProcessResult.whitespace,
            },
          });
        } catch (ppErr) {
          // Pre-processing is non-critical — log and continue
          console.warn("[PromptPreProcessor] Failed (non-blocking):", ppErr);
        }
      }

      // ── Persist integrity check to audit trail ──
      if (clientPromptLen != null || clientPromptHash != null) {
        const integrityForAudit = (res as any).locals.promptIntegrity;
        if (integrityForAudit) {
          promptAuditStore.saveIntegrityCheck({
            chatId: chatId || undefined,
            runId: runId || undefined,
            messageRole: "user",
            clientPromptLen,
            clientPromptHash,
            serverPromptLen: integrityForAudit.serverPromptLen,
            serverPromptHash: integrityForAudit.serverPromptHash,
            valid: integrityForAudit.verified,
            requestId,
          });
        }
      }

      // Fast local-control path: avoid expensive run-claim/skill-resolution before emitting SSE.
      const latestUserForLocalControl = [...clientMessages].reverse().find((m: any) => m?.role === "user");
      const latestUserTextForLocalControl = extractUserText(latestUserForLocalControl?.content);
      console.log("[LocalControl] Stream interception check:", JSON.stringify(latestUserTextForLocalControl?.slice(0, 120)));
      const earlyLocalControlResult = await executeLocalControlRequest(latestUserTextForLocalControl, {
        requestId,
        userId: effectiveUserId,
      });
      console.log("[LocalControl] Stream interception result:", earlyLocalControlResult.handled ? `HANDLED (${(earlyLocalControlResult as any).code})` : "NOT handled — passing to LLM");
      if (earlyLocalControlResult.handled) {
        if (!res.headersSent) {
          res.setHeader("Content-Type", "text/event-stream");
          applySseSecurityHeaders(res);
          res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
          res.setHeader("Connection", "keep-alive");
          res.setHeader("Transfer-Encoding", "chunked");
          res.setHeader("X-Accel-Buffering", "no");
          res.setHeader("X-Request-Id", requestId);
          res.setHeader("X-Trace-Id", requestId);
          res.flushHeaders();
          writeSse(res, "start", { requestId, latencyMode, timestamp: Date.now() });
        }

        if (earlyLocalControlResult.ok) {
          writeSse(res, "chunk", {
            content: earlyLocalControlResult.message,
            requestId,
            timestamp: Date.now(),
            localAction: {
              code: earlyLocalControlResult.code,
              ...(earlyLocalControlResult.payload || {}),
            },
          });
          writeSse(res, "done", { requestId, timestamp: Date.now() });
          return res.end();
        }

        writeSse(res, "error", {
          code: earlyLocalControlResult.code,
          error: earlyLocalControlResult.message,
          requestId,
          timestamp: Date.now(),
          localAction: earlyLocalControlResult.payload || null,
        });
        writeSse(res, "done", { requestId, timestamp: Date.now() });
        return res.end();
      }

      const resolvedSkillContext = await resolveSkillContextFromRequest(drizzleSkillStore, {
        userId: effectiveUserId,
        skillId,
        skill,
      });
      const skillSystemSection = buildSkillSystemPromptSection(resolvedSkillContext);
      if (skillSystemSection) {
        console.info("[SkillContext] Applied to /api/chat/stream", {
          requestId,
          userId: effectiveUserId,
          source: resolvedSkillContext?.source,
          skillId: resolvedSkillContext?.id || null,
          skillName: resolvedSkillContext?.name,
        });
      }

      const clientRequestId =
        typeof rawClientRequestId === "string" && rawClientRequestId.trim().length > 0
          ? sanitizeStreamText(rawClientRequestId, MAX_STREAM_REQUEST_ID_LEN)
          : undefined;
      const userRequestId =
        typeof rawUserRequestId === "string" && rawUserRequestId.trim().length > 0
          ? sanitizeStreamText(rawUserRequestId, MAX_STREAM_REQUEST_ID_LEN)
          : undefined;
      const latestUserForRun = [...clientMessages].reverse().find((m: any) => m?.role === "user");
      const latestUserTextForRun = extractUserText(latestUserForRun?.content);
      const sanitizedRunAttachments =
        attachments && Array.isArray(attachments)
          ? attachments
            .slice(0, MAX_STREAM_SKILL_ATTACHMENTS)
            .map(sanitizeStreamAttachment)
            .filter((att): att is NonNullable<ReturnType<typeof sanitizeStreamAttachment>> => !!att?.name)
          : null;

      // Claim run as early as possible (before any expensive routing/search work).
      // This avoids duplicate processing and ensures idempotency responses are true JSON
      // (before SSE headers are sent).
      if (chatId && !claimedRun && (runId || clientRequestId)) {
        const claimStageStart = performance.now();
        const resolveExistingRun = async () =>
          runId
            ? await storage.getChatRun(runId)
            : (clientRequestId ? await storage.getChatRunByClientRequestId(chatId, clientRequestId) : null);

        let existingRun = await resolveExistingRun();

        if (!existingRun) {
          const runWaitStart = performance.now();
          for (const waitMs of [40, 80, 160, 320, 500]) {
            await new Promise((resolve) => setTimeout(resolve, waitMs));
            existingRun = await resolveExistingRun();
            if (existingRun) break;
          }
          recordStage("run_wait_ms", runWaitStart);
        }

        if (!existingRun) {
          recordStage("run_claim_ms", claimStageStart);
          if (runId) {
            return res.status(404).json({
              error: "Run not found",
              traceId: requestId,
              timings: reportTimings("run_not_found"),
            });
          }
          if (clientRequestId) {
            return res.status(503).json({
              status: "run_not_ready",
              error: "Run not ready yet",
              retryable: true,
              traceId: requestId,
              timings: reportTimings("run_not_ready"),
            });
          }
        } else {
          if (existingRun.status === "processing") {
            const runStartedAt = existingRun.startedAt ? new Date(existingRun.startedAt).getTime() : 0;
            const runAge = Date.now() - runStartedAt;

            // Allow run replacement in two cases:
            // 1. queueMode "replace" — client explicitly wants to supersede
            // 2. Stale run (processing > 60s) — abandoned connection safety net
            if (queueMode === "replace" || runAge > INTERACTIVE_STALE_RUN_THRESHOLD_MS) {
              const reason = runAge > INTERACTIVE_STALE_RUN_THRESHOLD_MS ? "stale_run_recovered" : "run_replaced";
              console.log(`[Run] Resetting run ${existingRun.id} to pending (${reason}, age=${Math.round(runAge / 1000)}s)`);
              await storage.updateChatRunStatus(existingRun.id, "pending", reason);
              existingRun = { ...existingRun, status: "pending" };
              // Fall through to claim the reset run below
            } else {
              recordStage("run_claim_ms", claimStageStart);
              console.log(`[Run] Run ${existingRun.id} is already being processed (${Math.round(runAge / 1000)}s), returning status`);
              return res.json({
                status: "already_processing",
                run: existingRun,
                traceId: requestId,
                timings: reportTimings("already_processing"),
              });
            }
          }
          if (existingRun.status === "done") {
            recordStage("run_claim_ms", claimStageStart);
            console.log(`[Run] Run ${existingRun.id} already completed`);
            return res.json({
              status: "already_done",
              run: existingRun,
              traceId: requestId,
              timings: reportTimings("already_done"),
            });
          }
          if (existingRun.status === "failed") {
            console.log(`[Run] Run ${existingRun.id} previously failed — resetting to pending for retry`);
            await storage.updateChatRunStatus(existingRun.id, "pending");
            existingRun = { ...existingRun, status: "pending" };
          }

          const claimKey = existingRun.clientRequestId || clientRequestId;
          claimedRun = await storage.claimPendingRun(chatId, claimKey || undefined);
          recordStage("run_claim_ms", claimStageStart);
          if (!claimedRun) {
            const refreshedRun =
              runId
                ? await storage.getChatRun(runId)
                : (claimKey ? await storage.getChatRunByClientRequestId(chatId, claimKey) : null);
            if (refreshedRun?.status === "processing") {
              return res.json({
                status: "already_processing",
                run: refreshedRun,
                traceId: requestId,
                timings: reportTimings("already_processing"),
              });
            }
            if (refreshedRun?.status === "done") {
              return res.json({
                status: "already_done",
                run: refreshedRun,
                traceId: requestId,
                timings: reportTimings("already_done"),
              });
            }
            console.log(`[Run] Failed to claim run ${existingRun.id} - may have been claimed by another request`);
            return res.json({
              status: "claim_failed",
              message: "Run already claimed or not pending",
              traceId: requestId,
              timings: reportTimings("claim_failed"),
            });
          }
          console.log(`[Run] Successfully claimed run ${claimedRun.id}`);
        }
      }

      const provider = (
        rawProvider && ['xai', 'gemini', 'openai', 'anthropic', 'deepseek', 'auto'].includes(rawProvider)
          ? rawProvider
          : undefined
      ) as any;

      const hasAnyAttachments = sanitizedRunAttachments && sanitizedRunAttachments.length > 0;
      const lastUserMsg = [...clientMessages].reverse().find((m: any) => m.role === 'user');
      const userQuery = extractUserText(lastUserMsg?.content);
      const earlyQuestionClassification = questionClassifier.classifyQuestion(userQuery || "");

      const { hasNativeAgenticSignal: checkAgenticSignal } = await import("../agent/nativeAgenticFusion");
      const hasActionSignal = checkAgenticSignal(userQuery || "");

      if (latencyMode === 'auto') {
        if (
          !hasActionSignal && (
            earlyQuestionClassification.type === 'greeting' ||
            earlyQuestionClassification.type === 'factual_simple' ||
            earlyQuestionClassification.type === 'yes_no'
          )
        ) {
          latencyMode = 'fast';
        } else if (
          earlyQuestionClassification.type === 'analysis' ||
          earlyQuestionClassification.type === 'summary' ||
          earlyQuestionClassification.type === 'comparison' ||
          earlyQuestionClassification.type === 'extraction' ||
          earlyQuestionClassification.type === 'action'
        ) {
          latencyMode = 'deep';
        }
      }

      // ── EARLY SSE SETUP ────────────────────────────────────────────
      // Open SSE *before* any heavy I/O (web search, academic search,
      // history augmentation) to minimize TTFT (Time-To-First-Token).
      const sseAlreadyOpen = res.headersSent;
      if (!sseAlreadyOpen) {
        res.setHeader("Content-Type", "text/event-stream");
        applySseSecurityHeaders(res);
        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("Transfer-Encoding", "chunked");
        res.setHeader("X-Accel-Buffering", "no");
        res.setHeader("X-Request-Id", requestId);
        res.setHeader("X-Trace-Id", requestId);
        res.setHeader("X-Latency-Mode", latencyMode);
        res.flushHeaders();

        // Immediately send a start-handshake + delivery ACK so the client knows the stream is alive
        // and the message was received intact (open-webui pattern: immediate feedback)
        const deliveryAck = createDeliveryAck(
          requestId,
          (lastUserMsg as any)?.id || requestId,
          userQuery || "",
          "processing",
        );
        writeSse(res, 'start', {
          requestId,
          latencyMode,
          timestamp: Date.now(),
          ack: deliveryAck,
        });

        // Register connection-close handler as early as possible so every
        // subsequent writeSse can be guarded by isConnectionClosed.
        req.on("close", () => {
          isConnectionClosed = true;
          if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
          }
          clearStreamTimeouts();
          detachAsyncTask(
            () => cleanupClaimedRunIfOrphaned("client_disconnect"),
            "cleanup orphaned run on early close",
          );
          detachAsyncTask(
            () => flushStreamResumeProgress(getStreamMeta(res)),
            "stream resume flush on early close",
          );
          console.log("[SSE] Connection closed (early handler)", { requestId });
        });
      }

      // NOTE: doneSent is attached to `res` so that the bundler cannot
      // rename or tree-shake it across try/catch/finally boundaries.
      // Previous attempts with local variables (`let doneSent`, `const streamFlags`)
      // were broken by the bundler renaming the variable in try but not catch/finally.
      (res as any).__doneSent = false;

      let intentResult: IntentResult | null = null;
      let messages: ConversationMemoryChatMessage[] = clientMessages;
      let memoryDiagnostics: MemoryCompressionDiagnostics = createMemoryDiagnosticsFallback(clientMessages);
      const userMessageText = userQuery || "";
      const effectiveChatIdForMemory = chatId || conversationId || streamConversationId;
      const userSettingsPromise = (async () => {
        const userSettingsStageStart = performance.now();
        try {
          return await storage.getUserSettings(effectiveUserId);
        } catch (error) {
          console.warn("[Stream] Failed to load user settings:", (error as any)?.message || error);
          return null;
        } finally {
          recordStage("user_settings_ms", userSettingsStageStart);
        }
      })();

      const effectiveSkillRunId = claimedRun?.id || sanitizeStreamText(runId, MAX_STREAM_REQUEST_ID_LEN) || requestId;
      const emitSkillTrace = (trace: { stage: string; status: string; message: string; details?: Record<string, unknown> }) => {
        if (isConnectionClosed) {
          return;
        }
        writeSse(res, 'skill_trace', {
          requestId,
          runId: effectiveSkillRunId,
          ...trace,
          timestamp: new Date().toISOString(),
        });
      };

      const emitSkillChunk = (payload: {
        stage: string;
        status: string;
        source: string;
        skill?: string | null;
        content: string;
        isFallback?: boolean;
      }) => {
        if (isConnectionClosed) {
          return;
        }
        const safePayload = {
          ...payload,
          content: sanitizeStreamText(payload.content, MAX_STREAM_EVENT_PAYLOAD_BYTES - 1200),
        };
        lastAckSequence += 1;
        writeSse(res, 'skill_chunk', {
          requestId,
          runId: effectiveSkillRunId,
          sequenceId: lastAckSequence,
          timestamp: Date.now(),
          ...safePayload,
        });
      };

      const skillTimeoutMs = 12000;
      const normalizedUserQuery = typeof userQuery === "string" ? userQuery.trim() : "";
      if (normalizedUserQuery && !isConnectionClosed) {
        emitSkillTrace({ stage: 'planner', status: 'ok', message: 'skill_router_started', details: { hasAttachments: hasAnyAttachments } });
        try {
          const executeSkillPromise = getSkillPlatformService().executeFromMessage({
            requestId,
            conversationId: streamConversationId,
            runId: effectiveSkillRunId,
            userId: effectiveUserId,
            userMessage: normalizedUserQuery,
            attachments: Array.isArray(sanitizedRunAttachments) ? sanitizedRunAttachments : [],
            allowedScopes: parsedSkillScopes,
            intentHint: intentResult
              ? {
                intent: intentResult.intent,
                confidence: intentResult.confidence,
                output_format: intentResult.output_format,
                language_detected: intentResult.language_detected,
              }
              : undefined,
            autoCreate: true,
            maxRetries: 1,
            emitTrace: emitSkillTrace,
            now: new Date(),
          });
          let skillTimeoutId: NodeJS.Timeout | null = null;
          const timeoutPromise = new Promise<never>((_, reject) => {
            skillTimeoutId = setTimeout(() => reject(new Error(`Skill execution timeout after ${skillTimeoutMs}ms`)), skillTimeoutMs);
          });

          try {
            skillExecutionResult = await Promise.race([executeSkillPromise, timeoutPromise]);
          } finally {
            if (skillTimeoutId) {
              clearTimeout(skillTimeoutId);
            }
          }
          emitSkillTrace({ stage: 'planner', status: 'ok', message: 'skill_router_finished', details: { status: skillExecutionResult.status, continueWithModel: skillExecutionResult.continueWithModel } });

          const seed = typeof skillExecutionResult.outputText === "string" ? skillExecutionResult.outputText.trim() : "";
          if (seed) {
            fullContent = seed;
            markFirstToken();
            emitSkillChunk({
              stage: 'execution',
              status: skillExecutionResult.status,
              source: skillExecutionResult.autoCreated ? 'auto' : 'catalog',
              skill: skillExecutionResult.selectedSkill?.slug || null,
              content: seed,
            });
          }

          if (skillExecutionResult.status === "partial" && skillExecutionResult.continueWithModel) {
            shouldRunModel = true;
            skillSeedForModel = seed;
          } else {
            shouldRunModel = skillExecutionResult.continueWithModel !== false;
          }

          if (skillExecutionResult.status === 'blocked' || skillExecutionResult.status === 'failed') {
            writeSse(res, 'skill_blocked', {
              requestId,
              runId: effectiveSkillRunId,
              status: skillExecutionResult.status,
              code: skillExecutionResult.error?.code || 'SKILL_BLOCKED',
              message: skillExecutionResult.error?.message || skillExecutionResult.fallbackText || 'Skill no disponible en este momento',
              requiresConfirmation: skillExecutionResult.requiresConfirmation,
              blockedScopes: skillExecutionResult.policyBreached?.blockedScopes || [],
              timestamp: Date.now(),
            });
          }

          if (!seed && skillExecutionResult.fallbackText) {
            fullContent = skillExecutionResult.fallbackText;
            emitSkillChunk({
              stage: 'fallback',
              status: skillExecutionResult.status,
              source: 'fallback',
              content: skillExecutionResult.fallbackText,
              isFallback: true,
            });
            if (skillExecutionResult.continueWithModel) {
              skillSeedForModel = skillExecutionResult.fallbackText;
            }
            markFirstToken();
          }
        } catch (skillError: any) {
          emitSkillTrace({ stage: 'factory', status: 'error', message: 'skill_router_error', details: { error: skillError?.message || String(skillError) } });
          writeSse(res, 'skill_blocked', {
            requestId,
            runId: effectiveSkillRunId,
            status: 'failed',
            code: 'SKILL_ROUTER_ERROR',
            message: 'No fue posible usar el enrutador de Skills, se usa fallback al modelo.',
            timestamp: Date.now(),
          });
          skillExecutionResult = {
            status: 'failed',
            continueWithModel: true,
            outputText: '',
            autoCreated: false,
            requiresConfirmation: false,
            traces: [],
            fallbackText: 'No fue posible usar el enrutador de Skills, se usa fallback al modelo.',
            error: {
              code: 'SKILL_ROUTER_ERROR',
              message: skillError?.message || 'No se pudo ejecutar el router de Skills',
              retryable: true,
            },
            output: undefined,
            policyBreached: undefined,
            selectedSkill: undefined,
          };
        }
      }

      const skipSkillShortcuts = !!skillExecutionResult && skillExecutionResult.status !== 'skipped';

      if (
        earlyQuestionClassification.type === 'greeting' &&
        !hasAnyAttachments &&
        !docTool &&
        !forceWebSearch &&
        !webSearchAuto &&
        !isConnectionClosed &&
        !skipSkillShortcuts &&
        !hasActionSignal
      ) {
        const isThanks = /\b(gracias|muchas\s+gracias|te\s+agradezco)\b/i.test(userQuery);
        const content = isThanks
          ? "De nada. ¿Necesitas algo más?"
          : "Hola. ¿En qué puedo ayudarte?";

        markFirstToken();
        writeSse(res, 'chunk', {
          content,
          sequence: 1,
          runId: runId || requestId,
          timestamp: Date.now(),
        });
        const greetingTimings = reportTimings("greeting_fast_path");
        emitDoneEvent(res, {
          sequenceId: 1,
          requestId,
          runId: runId || requestId,
          latencyMode,
          latencyLane: resolveLatencyLane(latencyMode),
          totalSequences: 1,
          contentLength: content.length,
          completionReason: "greeting_fast_path",
          traceId: requestId,
          timings: greetingTimings,
        });
        emitCompleteEvent(res, {
          requestId,
          runId: runId || requestId,
          latencyMode,
          latencyLane: resolveLatencyLane(latencyMode),
          totalSequences: 1,
          contentLength: content.length,
          durationMs: 0,
          status: "completed",
          completionReason: "greeting_fast_path",
          traceId: requestId,
          timings: greetingTimings,
        });
        return res.end();
      }

      if (
        latencyMode === 'fast' &&
        !hasActionSignal &&
        (earlyQuestionClassification.type === 'factual_simple' || earlyQuestionClassification.type === 'yes_no') &&
        !hasAnyAttachments &&
        !docTool &&
        !forceWebSearch &&
        !webSearchAuto &&
        !runId &&
        !gptId &&
        !session_id &&
        clientMessages.length <= 2 &&
        !isConnectionClosed &&
        !skipSkillShortcuts
      ) {
        try {
          const answerFirstPrompt = answerFirstEnforcer.generateAnswerFirstSystemPrompt(userQuery, false);
          const fastPathSystemPrompt = `${answerFirstPrompt.fullPrompt}${skillSystemSection}`;
          const llmMessages = [
            { role: "system" as const, content: fastPathSystemPrompt },
            ...clientMessages.map((m: any) => ({
              role: m.role as "user" | "assistant" | "system",
              content: String(m.content ?? "")
            }))
          ];

          const quickStream = await resolveModelStream(llmMessages as any, {
            userId: effectiveUserId || streamConversationId || "anonymous",
            requestId,
            model: model || DEFAULT_MODEL,
            provider,
            maxTokens: Math.min(answerFirstPrompt.maxTokens || 300, 600), // Was 200 cap — caused mid-sentence truncation on simple questions
            temperature: 0.2,
            timeout: 12000,
            enableFallback: true,
          });

          let fastPathSequence = 0;
          let fastPathDone = false;
          for await (const chunk of quickStream) {
            if (isConnectionClosed) break;

            const chunkSequenceId = Number.isFinite(chunk.sequenceId)
              ? Number(chunk.sequenceId)
              : fastPathSequence + 1;
            fastPathSequence = Math.max(fastPathSequence, chunkSequenceId);

            if (chunk.providerSwitch) {
              writeSse(res, "notice", {
                type: "provider_fallback",
                fromProvider: chunk.providerSwitch.fromProvider,
                toProvider: chunk.providerSwitch.toProvider,
                requestId,
                timestamp: Date.now(),
              });
            }

            if (chunk.provider) {
              activeStreamProvider = chunk.provider;
            }

            if (chunk.content) {
              markFirstToken();
              fullContent += chunk.content;
              writeSse(res, "chunk", {
                content: chunk.content,
                sequence: chunkSequenceId,
                sequenceId: chunkSequenceId,
                requestId,
                runId: runId || requestId,
                timestamp: Date.now(),
                provider: chunk.provider,
              });
            }

            if (chunk.done) {
              const fastPathTimings = reportTimings("simple_fast_path");
              const totalSequences = Math.max(
                fastPathSequence,
                fullContent.trim() ? 1 : 0,
              );
              if (!fastPathDone) {
                emitDoneEvent(res, {
                  sequenceId: chunkSequenceId,
                  requestId,
                  runId: runId || requestId,
                  latencyMode,
                  latencyLane: resolveLatencyLane(latencyMode),
                  totalSequences,
                  contentLength: fullContent.length,
                  completionReason: "simple_fast_path",
                  traceId: requestId,
                  timings: fastPathTimings,
                  provider: activeStreamProvider || undefined,
                });
                fastPathDone = true;
              }
            }
          }

          if (!isConnectionClosed) {
            const fastPathTimings = reportTimings("simple_fast_path");
            const totalSequences = Math.max(
              fastPathSequence,
              fullContent.trim() ? 1 : 0,
            );
            if (!fastPathDone) {
              emitDoneEvent(res, {
                requestId,
                runId: runId || requestId,
                latencyMode,
                latencyLane: resolveLatencyLane(latencyMode),
                totalSequences,
                contentLength: fullContent.length,
                completionReason: "simple_fast_path",
                traceId: requestId,
                timings: fastPathTimings,
                provider: activeStreamProvider || undefined,
              });
            }
            emitCompleteEvent(res, {
              requestId,
              runId: runId || requestId,
              latencyMode,
              latencyLane: resolveLatencyLane(latencyMode),
              totalSequences,
              contentLength: fullContent.length,
              durationMs: fastPathTimings.totalMs ?? 0,
              status: "completed",
              completionReason: "simple_fast_path",
              traceId: requestId,
              timings: fastPathTimings,
              provider: activeStreamProvider || undefined,
            });
          }
          return res.end();
        } catch (e: any) {
          console.warn("[Stream] Simple fast-path failed:", e?.message || e);
          throw e;
        }
      }

      if (!isConnectionClosed && userMessageText) {
        writeSse(res, "thinking", {
          step: "analyzing",
          message: "Analizando tu mensaje...",
          requestId,
          timestamp: Date.now(),
        });
      }
      const intentPromise = userMessageText
        ? (async () => {
            const intentStageStart = performance.now();
            try {
              return await routeIntent(userMessageText);
            } catch (intentError) {
              console.error("[Stream] IntentRouter error:", intentError);
              return null;
            } finally {
              recordStage("intent_router_ms", intentStageStart);
            }
          })()
        : Promise.resolve<IntentResult | null>(null);

      if (!isConnectionClosed && clientMessages.length > 0) {
        writeSse(res, "thinking", {
          step: "context",
          message: "Recuperando contexto...",
          requestId,
          timestamp: Date.now(),
        });
      }
      const memoryPromise = (async () => {
        const memoryStageStart = performance.now();
        try {
          return await augmentHistoryWithCompatibility(
            effectiveChatIdForMemory,
            clientMessages,
            8000,
          );
        } catch (memoryError) {
          console.warn("[Stream] Failed to augment conversation history:", (memoryError as any)?.message || memoryError);
          return {
            messages: clientMessages,
            diagnostics: createMemoryDiagnosticsFallback(clientMessages),
          };
        } finally {
          recordStage("memory_history_ms", memoryStageStart);
        }
      })();

      const userSettings = await userSettingsPromise;

      const featureFlags = {
        memoryEnabled: userSettings?.featureFlags?.memoryEnabled ?? false,
        recordingHistoryEnabled: userSettings?.featureFlags?.recordingHistoryEnabled ?? false,
        webSearchAuto: userSettings?.featureFlags?.webSearchAuto ?? true,
        codeInterpreterEnabled: userSettings?.featureFlags?.codeInterpreterEnabled ?? true,
        canvasEnabled: userSettings?.featureFlags?.canvasEnabled ?? true,
        voiceEnabled: userSettings?.featureFlags?.voiceEnabled ?? true,
        voiceAdvanced: userSettings?.featureFlags?.voiceAdvanced ?? false,
        connectorSearchAuto: userSettings?.featureFlags?.connectorSearchAuto ?? false,
      };

      const responseStyle = userSettings?.responsePreferences?.responseStyle || "default";
      const customInstructions = userSettings?.responsePreferences?.customInstructions || "";
      const userProfile = userSettings?.userProfile || null;

      let detectedWebSources: any[] = [];
      let webSearchContextForLLM = ""; // Will be injected into system prompt

      const requestedWebSearch = !!forceWebSearch || !!webSearchAuto;
      const allowAutoSearch = featureFlags.webSearchAuto && !requestedWebSearch && !hasAnyAttachments;
      // Allow web search in ALL latency lanes when auto-search is enabled
      // Previously fast lane blocked auto-search, but this prevented news/current-event queries from working
      const rawShouldSearch = requestedWebSearch || allowAutoSearch;

      // RAG relevance gate (open-webui pattern): skip expensive search for greetings,
      // simple follow-ups, and meta-queries that don't need external context.
      // Only gate auto-search; never suppress explicit user-requested search.
      const ragDecision = shouldTriggerRAG(userQuery || "", false, hasAnyAttachments);
      const shouldSearch = requestedWebSearch || (rawShouldSearch && ragDecision.shouldSearch);
      if (!requestedWebSearch && rawShouldSearch && !ragDecision.shouldSearch) {
        console.info("[RAGGate] Skipping auto-search — not needed", { requestId, reason: ragDecision.reason, confidence: ragDecision.confidence, query: (userQuery || "").slice(0, 60) });
      }
      const searchPromise = (async () => {
        const searchStageStart = performance.now();
        try {
          return await runStreamSearchPreflight({
            shouldSearch,
            userQuery,
            requestedWebSearch,
            requestId,
            res,
            isConnectionClosed: () => isConnectionClosed,
          });
        } finally {
          recordStage("web_search_ms", searchStageStart);
        }
      })();

      // DOC TOOL: Stream content directly to client editor (real-time rendering)
      // Previously this routed through handleProductionRequest which generates binary files.
      // Now we let the normal streaming path handle it — content streams to TipTap/Handsontable/PPT editors.
      if (docTool && ['word', 'excel', 'ppt'].includes(docTool)) {
        console.log(`[Stream] 📝 DOC TOOL STREAMING: docTool=${docTool} - using real-time editor streaming`);
      }

      // DATA_MODE ENFORCEMENT: Reject document attachments - must use /analyze endpoint
      const hasDocumentAttachments = sanitizedRunAttachments && sanitizedRunAttachments.length > 0
        ? sanitizedRunAttachments.some((a) => a && isDocumentAttachment(a.mimeType || a.type || "", a.name || "", a.type || a.mimeType || ""))
        : false;

      if (hasDocumentAttachments) {
        console.log(`[Stream API] DATA_MODE: Rejecting document attachments - must use /analyze endpoint`);
        return res.status(400).json({
          error: "Document attachments must be processed via /api/analyze endpoint for proper analysis",
          code: "USE_ANALYZE_ENDPOINT"
        });
      }

      const userId = effectiveUserId;

      // GPT Session Contract Resolution for streaming
      // Priority: session_id (reuse existing) > gptId (create new)
      let gptSessionContract: GptSessionContract | null = null;
      let effectiveModel = model || DEFAULT_MODEL;
      let serverSessionId: string | null = null;
      const effectiveProvider = provider || DEFAULT_PROVIDER;

      const isValidConversationIdForStream = (id?: string): boolean => {
        if (!id) return false;
        if (id.startsWith('pending-')) return false;
        if (id.trim() === '') return false;
        return true;
      };

      // First, try to retrieve existing session by session_id
      if (session_id) {
        try {
          gptSessionContract = await getSessionById(session_id);
          if (gptSessionContract) {
            serverSessionId = gptSessionContract.sessionId;
            effectiveModel = getEnforcedModel(gptSessionContract, model);
            console.log(`[Stream] Reusing existing session: session_id=${session_id}, gptId=${gptSessionContract.gptId}, configVersion=${gptSessionContract.configVersion}`);
          } else {
            console.log(`[Stream] Session not found: session_id=${session_id}, will create new if gptId provided`);
          }
        } catch (sessionError) {
          console.error(`[Stream] Error retrieving session ${session_id}:`, sessionError);
        }
      }

      // If no session from session_id, try to create/get one via gptId
      if (!gptSessionContract && gptId) {
        try {
          const effectiveChatIdForSession = chatId || conversationId || streamConversationId;
          if (isValidConversationIdForStream(effectiveChatIdForSession)) {
            gptSessionContract = await getOrCreateSession(effectiveChatIdForSession, gptId);
            console.log(`[Stream] GPT Session created/retrieved: gptId=${gptId}, configVersion=${gptSessionContract.configVersion}`);
          } else {
            gptSessionContract = await getOrCreateSession("", gptId);
            console.log(`[Stream] New GPT Session created: gptId=${gptId}, sessionId=${gptSessionContract.sessionId}`);
          }
          serverSessionId = gptSessionContract.sessionId;
          effectiveModel = getEnforcedModel(gptSessionContract, model);
        } catch (sessionError) {
          console.error(`[Stream] Error creating GPT session for gptId=${gptId}:`, sessionError);
        }
      }

      // Track GPT Usage (Fire-and-forget)
      const streamUsageGptId = gptSessionContract?.gptId || gptId;
      if (streamUsageGptId) {
        storage.incrementGptUsage(streamUsageGptId).catch(e => console.error(`[Stream] Failed to increment GPT usage for ${streamUsageGptId}:`, e));
      }

      // Session metadata for SSE events
      const sessionMetadata = gptSessionContract ? {
        gpt_id: gptSessionContract.gptId,
        config_version: gptSessionContract.configVersion,
        tool_permissions: gptSessionContract.toolPermissions,
        session_id: serverSessionId || gptSessionContract.sessionId,
      } : null;

      intentResult = await intentPromise;

      // Override: visual content (diagrams, flowcharts, org charts) must render inline, not as files
      if (intentResult) {
        const visualKw = ["diagrama","flowchart","organigrama","mapa mental","mindmap","diagrama de flujo","diagrama de secuencia","diagrama de clases","timeline","linea de tiempo","wireframe","mockup","infografia","kanban","esquema","flujograma","mermaid","diagram","flow chart","org chart","mind map","sequence diagram","class diagram","er diagram","architecture diagram","process map","gantt"];
        const msgLower = (userMessageText || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        if (visualKw.some(kw => msgLower.includes(kw))) {
          console.log(`[Stream] 🎨 RENDER_VISUAL override: "${userMessageText.slice(0, 60)}..." — forcing inline rendering (was: ${intentResult.intent})`);
          intentResult = { ...intentResult, intent: "CHAT_GENERAL" as any, confidence: 0.95 };
        }
      }

      if (intentResult) {
        console.log(`[Stream] IntentRouter: intent=${intentResult.intent}, confidence=${intentResult.confidence.toFixed(2)}, format=${intentResult.output_format || 'none'}`);

        const isImageGenRequest = detectImageRequest(userMessageText);
        if (isImageGenRequest) {
          console.log(`[Stream] 🖼️ IMAGE GENERATION DETECTED: "${userMessageText.slice(0, 60)}..." - bypassing production pipeline`);
          const imagePrompt = extractImagePrompt(userMessageText);
          try {
            const imageResult = await generateImage(imagePrompt);
            if (imageResult && imageResult.imageBase64) {
              const imageDataUrl = `data:${imageResult.mimeType || 'image/png'};base64,${imageResult.imageBase64}`;
              const markdownResponse = `![${imagePrompt}](${imageDataUrl})\n\n*Imagen generada: "${imagePrompt}"*`;

              res.setHeader("Content-Type", "text/event-stream");
              applySseSecurityHeaders(res);
              res.setHeader("Cache-Control", "no-cache");
              res.setHeader("Connection", "keep-alive");
              res.setHeader("X-Accel-Buffering", "no");

              res.write(`data: ${JSON.stringify({ type: "token", content: markdownResponse })}\n\n`);
              if (sessionMetadata) {
                res.write(`data: ${JSON.stringify({ type: "session_metadata", ...sessionMetadata })}\n\n`);
              }
              res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
              res.end();
              return;
            }
          } catch (imgError: any) {
            console.error("[Stream] Image generation failed, falling back to chat:", imgError?.message);
          }
        }

        if (featureFlags.canvasEnabled && isProductionIntent(intentResult, userMessageText) && intentResult.confidence >= 0.5) {
          console.log(`[Stream] 🚀 PRODUCTION MODE ACTIVATED: intent=${intentResult.intent}, topic=${intentResult.slots.topic}`);

          try {
            const effectiveChatId = chatId || conversationId || streamConversationId;

            await handleProductionRequest(
              {
                message: userMessageText,
                userId: userId,
                chatId: effectiveChatId,
                conversationId: streamConversationId,
                requestId,
                assistantMessageId,
                intentResult,
                locale: intentResult.language_detected || "es",
              },
              res,
            );

            return;
          } catch (productionError: any) {
            console.error("[Stream] ❌ Production handler error (first intercept), falling back to chat:", productionError?.message || productionError);
            console.error("[Stream] ❌ Production error stack:", productionError?.stack);
          }
        }

        // ── SKILL AUTO-DISPATCHER: handle non-production intents (code, search, media, integrations) ──
        if (intentResult && intentResult.intent !== "CHAT_GENERAL" && intentResult.intent !== "NEED_CLARIFICATION") {
          try {
            const effectiveChatId = chatId || conversationId || streamConversationId;
            // Prepare SSE step emitter for agentic visualization
            const emitAgentStep = (step: Record<string, any>) => {
              if (!res.headersSent) {
                res.setHeader("Content-Type", "text/event-stream");
                applySseSecurityHeaders(res);
                res.setHeader("Cache-Control", "no-cache");
                res.setHeader("Connection", "keep-alive");
                res.setHeader("X-Accel-Buffering", "no");
              }
              try {
                res.write(`data: ${JSON.stringify({ type: "step", step })}\n\n`);
              } catch { /* connection closed */ }
            };

            const skillResult: SkillDispatchResult = await skillAutoDispatcher.dispatch({
              message: userMessageText,
              intentResult,
              userId,
              chatId: effectiveChatId,
              conversationId: streamConversationId,
              requestId,
              assistantMessageId,
              locale: intentResult.language_detected || "es",
              onStep: emitAgentStep,
            });

            if (skillResult.handled && (skillResult.artifacts.length > 0 || skillResult.textResponse)) {
              console.log(`[Stream] 🎯 SKILL DISPATCHED: ${skillResult.skillId} (${skillResult.skillName}) - ${skillResult.artifacts.length} artifacts`);

              // Ensure SSE headers are set
              if (!res.headersSent) {
                res.setHeader("Content-Type", "text/event-stream");
                applySseSecurityHeaders(res);
                res.setHeader("Cache-Control", "no-cache");
                res.setHeader("Connection", "keep-alive");
                res.setHeader("X-Accel-Buffering", "no");
              }

              // Stream skill text response as tokens
              if (skillResult.textResponse) {
                res.write(`data: ${JSON.stringify({ type: "token", content: skillResult.textResponse })}\n\n`);
              }

              // Emit artifacts for download
              for (const artifact of skillResult.artifacts) {
                res.write(`data: ${JSON.stringify({
                  type: "artifact",
                  artifact: {
                    filename: artifact.filename,
                    mimeType: artifact.mimeType,
                    size: artifact.size,
                    downloadUrl: artifact.downloadUrl,
                    metadata: artifact.metadata,
                    library: artifact.library,
                  },
                  skillId: skillResult.skillId,
                  skillName: skillResult.skillName,
                })}\n\n`);
              }

              // Emit suggestions if available
              if (skillResult.suggestions?.length) {
                res.write(`data: ${JSON.stringify({ type: "suggestions", suggestions: skillResult.suggestions })}\n\n`);
              }

              // Emit skill metadata
              res.write(`data: ${JSON.stringify({
                type: "skill_execution",
                skillId: skillResult.skillId,
                skillName: skillResult.skillName,
                category: skillResult.category,
                artifactCount: skillResult.artifacts.length,
                metrics: skillResult.metrics,
              })}\n\n`);

              res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
              res.end();
              return;
            }
          } catch (skillError: any) {
            console.warn("[Stream] Skill auto-dispatch failed (non-blocking), falling back to chat:", skillError?.message);
          }
        }
      }

      const [, memoryResult, searchResult] = await Promise.allSettled([
        Promise.resolve(intentResult),
        memoryPromise,
        searchPromise,
      ]);

      if (memoryResult.status === "fulfilled") {
        messages = memoryResult.value.messages;
        memoryDiagnostics = memoryResult.value.diagnostics;
      } else {
        console.warn("[Stream] Memory preflight failed, using client messages:", memoryResult.reason);
        messages = clientMessages;
        memoryDiagnostics = createMemoryDiagnosticsFallback(clientMessages);
      }
      console.log(`[Stream API] Context augmented: ${clientMessages.length} client msgs -> ${messages.length} total`, memoryDiagnostics);

      if (searchResult.status === "fulfilled") {
        detectedWebSources = searchResult.value.detectedWebSources;
        webSearchContextForLLM = searchResult.value.webSearchContextForLLM;
        if (searchResult.value.searchQueries.length > 0) {
          capturedSearchQueries = searchResult.value.searchQueries;
        }
        if (searchResult.value.totalSearches > 0) {
          capturedTotalSearches = searchResult.value.totalSearches;
        }
      } else {
        console.warn("[Stream] Search preflight failed:", searchResult.reason);
      }

      if (memoryDiagnostics.compressionApplied && !isConnectionClosed) {
        writeSse(res, "notice", {
          type: "memory_compacted",
          originalTokens: memoryDiagnostics.originalTokens,
          finalTokens: memoryDiagnostics.finalTokens,
          originalMessageCount: memoryDiagnostics.originalMessageCount,
          finalMessageCount: memoryDiagnostics.finalMessageCount,
          summarizedMessages: memoryDiagnostics.summarizedMessages,
          relevantMessagesKept: memoryDiagnostics.relevantMessagesKept,
          recentMessagesKept: memoryDiagnostics.recentMessagesKept,
          requestId,
          timestamp: Date.now(),
        });

        promptAuditStore.logTransformation({
          chatId: effectiveChatIdForMemory || undefined,
          runId: runId || undefined,
          requestId,
          stage: "compress",
          inputTokens: memoryDiagnostics.originalTokens,
          outputTokens: memoryDiagnostics.finalTokens,
          droppedMessages: Math.max(
            0,
            memoryDiagnostics.originalMessageCount - memoryDiagnostics.finalMessageCount,
          ),
          droppedChars: 0,
          transformationDetails: {
            originalMessageCount: memoryDiagnostics.originalMessageCount,
            finalMessageCount: memoryDiagnostics.finalMessageCount,
            summarizedMessages: memoryDiagnostics.summarizedMessages,
            relevantMessagesKept: memoryDiagnostics.relevantMessagesKept,
            recentMessagesKept: memoryDiagnostics.recentMessagesKept,
          },
        });
      }

      // Resolve storagePaths for all attachments first (before PARE routing)
      // This ensures PARE has valid paths for routing decisions
      const resolvedAttachments: any[] = [];
      if (sanitizedRunAttachments && sanitizedRunAttachments.length > 0) {
        for (const att of sanitizedRunAttachments) {
          const resolved = { ...att } as Record<string, unknown>;
          if (!resolved.storagePath && resolved.fileId) {
            const fileRecord = await storage.getFile(String(resolved.fileId));
            if (fileRecord && fileRecord.storagePath) {
              resolved.storagePath = fileRecord.storagePath;
              console.log(`[Stream] Pre-resolved storagePath for ${String(resolved.name || "unknown")}: ${resolved.storagePath}`);
            }
          }
          resolvedAttachments.push(resolved);
        }
      } else if (attachments && Array.isArray(attachments)) {
        for (const att of attachments.slice(0, MAX_STREAM_SKILL_ATTACHMENTS)) {
          const normalized = sanitizeStreamAttachment(att);
          if (!normalized || !normalized.name) continue;
          const resolved = { ...normalized } as Record<string, unknown>;
          if (!resolved.storagePath && resolved.fileId) {
            const fileRecord = await storage.getFile(String(resolved.fileId));
            if (fileRecord && fileRecord.storagePath) {
              resolved.storagePath = fileRecord.storagePath;
              console.log(`[Stream] Pre-resolved storagePath for ${String(resolved.name || "unknown")}: ${resolved.storagePath}`);
            }
          }
          resolvedAttachments.push(resolved);
        }
      }

      // Convert attachments to PARE format using resolved paths
      const pareAttachments: SimpleAttachment[] = resolvedAttachments.map((att: any) => ({
        name: att.name,
        type: att.type || att.mimeType,
        path: att.storagePath || '',
      }));

      // Use PARE for intelligent routing when attachments are present
      let routeDecision: RobustRouteResult | null = null;
      if (pareOrchestrator.isEnabled() && userMessageText) {
        try {
          routeDecision = pareOrchestrator.robustRoute(userMessageText, pareAttachments);
          console.log(`[Stream] PARE routing: route=${routeDecision.route}, intent=${routeDecision.intent}, confidence=${routeDecision.confidence.toFixed(2)}, tools=${routeDecision.tools.slice(0, 3).join(',')}`);
        } catch (routeError) {
          console.error('[Stream] PARE routing error, falling back to chat:', routeError);
        }
      }

      // Create UnifiedChatContext for RequestSpec-driven execution
      const attachmentSpecs: AttachmentSpec[] = resolvedAttachments.map((att: any) => ({
        id: att.fileId || `att_${Date.now()}`,
        name: att.name || 'document',
        mimeType: att.mimeType || att.type || 'application/octet-stream',
        size: att.size || 0,
        storagePath: att.storagePath,
      }));

      let unifiedContext: UnifiedChatContext | null = null;
      try {
        const effectiveChatId = chatId || conversationId || streamConversationId;
        unifiedContext = await createUnifiedRun({
          messages: messages as Array<{ role: string; content: string }>,
          chatId: effectiveChatId,
          userId: userId || 'anonymous',
          runId: runId,
          messageId: `msg_${Date.now()}`,
          attachments: attachmentSpecs,
          latencyMode,
        });
        console.log(`[Stream] UnifiedContext created - intent: ${unifiedContext.requestSpec.intent}, confidence: ${unifiedContext.requestSpec.intentConfidence.toFixed(2)}, lane: ${unifiedContext.resolvedLane}, primaryAgent: ${unifiedContext.requestSpec.primaryAgent}`);
      } catch (contextError) {
        console.error('[Stream] Failed to create unified context:', contextError);
      }

      // If runId provided, claim the pending run (idempotent processing)
      if (runId && chatId && !claimedRun) {
        const existingRun = await storage.getChatRun(runId);
        if (!existingRun) {
          return res.status(404).json({ error: "Run not found" });
        }

        // If run is already processing or done, don't re-process
        if (existingRun.status === 'processing') {
          const runStartedAt = existingRun.startedAt ? new Date(existingRun.startedAt).getTime() : 0;
          const runAge = Date.now() - runStartedAt;
          if (queueMode === "replace" || runAge > INTERACTIVE_STALE_RUN_THRESHOLD_MS) {
            const reason = runAge > INTERACTIVE_STALE_RUN_THRESHOLD_MS ? "stale_run_recovered" : "run_replaced";
            console.log(`[Run] Resetting run ${runId} to pending (${reason}, age=${Math.round(runAge / 1000)}s)`);
            await storage.updateChatRunStatus(existingRun.id, "pending", reason);
            // Fall through to claim below
          } else {
            console.log(`[Run] Run ${runId} is already being processed, returning status`);
            return res.json({ status: 'already_processing', run: existingRun });
          }
        }
        if (existingRun.status === 'done') {
          console.log(`[Run] Run ${runId} already completed`);
          return res.json({ status: 'already_done', run: existingRun });
        }
        if (existingRun.status === 'failed') {
          console.log(`[Run] Run ${runId} previously failed — resetting to pending for retry`);
          await storage.updateChatRunStatus(existingRun.id, "pending");
        }

        // Atomically claim the pending run using clientRequestId for specificity
        claimedRun = await storage.claimPendingRun(chatId, existingRun.clientRequestId);
        if (!claimedRun || claimedRun.id !== runId) {
          console.log(`[Run] Failed to claim run ${runId} - may have been claimed by another request`);
          return res.json({ status: 'claim_failed', message: 'Run already claimed or not pending' });
        }
        console.log(`[Run] Successfully claimed run ${runId}`);
      }

      // SSE headers were already set early (before search). This block only
      // runs if we somehow got here without the early setup (e.g. production
      // mode intercepted and then fell through). In normal flow, headers are
      // already sent and these calls become no-ops.
      if (!res.headersSent) {
        res.setHeader("Content-Type", "text/event-stream");
        applySseSecurityHeaders(res);
        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("Transfer-Encoding", "chunked");
        res.setHeader("X-Accel-Buffering", "no");
        res.setHeader("X-Request-Id", requestId);
        res.setHeader("X-Trace-Id", requestId);
        res.setHeader("X-Latency-Mode", latencyMode);
        res.flushHeaders();
      }

      // Emit NLU intent result as SSE event for frontend visibility
      if (intentResult) {
        writeSse(res, "intent", {
          intent: intentResult.intent,
          confidence: intentResult.confidence,
          output_format: intentResult.output_format,
          slots: intentResult.slots,
          matched_patterns: intentResult.matched_patterns
        });

        // If clarification needed, emit immediately so UI can prompt user
        if (intentResult.intent === 'NEED_CLARIFICATION' && intentResult.clarification_question) {
          writeSse(res, "clarification", {
            question: intentResult.clarification_question,
            confidence: intentResult.confidence
          });
          console.log(`[Stream] Emitted clarification request: "${intentResult.clarification_question}"`);
        }

        // ── Prompt Understanding (sync/heuristic + async deep analysis) ──
        // Extract structured spec from the user's prompt for observability.
        // Sync analysis: always for non-fast mode and prompts > 50 chars.
        // Async analysis: for deep mode or prompts > 500 chars.
        if (latencyMode !== "fast" && latestUserTextForRun && latestUserTextForRun.length > 50) {
          try {
            // Sync analysis (< 5ms)
            const syncResult = promptAnalysisService.analyzeSync(latestUserTextForRun);
            recordAnalysisDuration(syncResult.processingTimeMs, "sync");

            console.log("[PromptUnderstanding] Sync extraction complete", {
              requestId,
              confidence: syncResult.confidence,
              needsClarification: syncResult.needsClarification,
              processingTimeMs: syncResult.processingTimeMs,
            });

            // Persist sync analysis to audit trail
            promptAuditStore.saveAnalysisResult({
              chatId: chatId || undefined,
              runId: runId || undefined,
              requestId,
              confidence: syncResult.confidence,
              needsClarification: syncResult.needsClarification,
              clarificationQuestions: syncResult.clarificationQuestions,
              extractedSpec: syncResult.spec,
              usedLLM: false,
              processingTimeMs: syncResult.processingTimeMs,
            });

            // Emit spec_extracted notice with analysis results
            if (syncResult.confidence > 0) {
              writeSse(res, "notice", {
                type: "spec_extracted",
                spec: syncResult.spec,
                confidence: syncResult.confidence,
                requestId,
                timestamp: Date.now(),
              });
            }

            // Emit low-confidence notice so frontend can display clarification suggestions
            if (syncResult.needsClarification && syncResult.confidence < 0.5 && syncResult.clarificationQuestions.length > 0) {
              writeSse(res, "notice", {
                type: "clarification_needed",
                confidence: syncResult.confidence,
                questions: syncResult.clarificationQuestions.slice(0, 5),
                spec: syncResult.spec,
                requestId,
                timestamp: Date.now(),
              });
            }

            // Async deep analysis for complex prompts (non-blocking)
            if ((latencyMode === "deep" || latestUserTextForRun.length > 500) && !syncResult.cached) {
              writeSse(res, "notice", {
                type: "analysis_started",
                requestId,
                timestamp: Date.now(),
              });
              // Fire-and-forget: results will be available via cache for future requests
              promptAnalysisService.analyzeAsync(
                latestUserTextForRun,
                chatId || undefined,
                runId || undefined,
                requestId,
              ).catch((asyncErr) => {
                console.warn("[PromptAnalysis] Async analysis failed (non-blocking):", asyncErr);
              });
            }
          } catch (puErr) {
            // PromptUnderstanding is non-critical — log and continue
            console.warn("[PromptUnderstanding] Failed (non-blocking):", puErr);
          }
        }

        // PRODUCTION MODE INTERCEPT: Handle document creation requests
        // Debug log to trace production mode evaluation
        console.log(`\n\n🔥🔥🔥 [Stream] PRODUCTION CHECK START 🔥🔥🔥`);
        console.log(`[Stream] PRODUCTION CHECK: intent=${intentResult.intent}, confidence=${intentResult.confidence.toFixed(2)}, isProductionIntent=${isProductionIntent(intentResult, userMessageText)}`);
        console.log(`🔥🔥🔥 [Stream] PRODUCTION CHECK END 🔥🔥🔥\n\n`);

        // Pass userMessageText to detect if user wants to search for articles first
        // Skip production mode if this is an image generation request
        if (featureFlags.canvasEnabled && !detectImageRequest(userMessageText) && isProductionIntent(intentResult, userMessageText) && intentResult.confidence >= 0.5) {
          const effectiveChatId = chatId || conversationId || streamConversationId;

          console.log(`[Stream] 🚀 PRODUCTION MODE ACTIVATED: intent=${intentResult.intent}, topic=${intentResult.slots.topic}`);

          try {
            await handleProductionRequest(
              {
                message: userMessageText,
                userId: userId,
                chatId: effectiveChatId,
                conversationId: streamConversationId,
                requestId,
                assistantMessageId,
                intentResult,
                locale: intentResult.language_detected || 'es',
              },
              res
            );

            // Production handler takes over response, we're done
            if (heartbeatInterval) clearInterval(heartbeatInterval);
            return;
          } catch (productionError: any) {
            console.error('[Stream] ❌ Production handler error (second intercept), falling back to chat:', productionError?.message || productionError);
            console.error('[Stream] ❌ Production error stack:', productionError?.stack);
            // Continue to normal chat flow if production fails
          }
        }

        // ── SKILL AUTO-DISPATCHER (second intercept): non-production skills ──
        if (intentResult && intentResult.intent !== "CHAT_GENERAL" && intentResult.intent !== "NEED_CLARIFICATION") {
          try {
            const effectiveChatId = chatId || conversationId || streamConversationId;
            const emitAgentStep2 = (step: Record<string, any>) => {
              if (!res.headersSent) {
                res.setHeader("Content-Type", "text/event-stream");
                applySseSecurityHeaders(res);
                res.setHeader("Cache-Control", "no-cache");
                res.setHeader("Connection", "keep-alive");
              }
              try { res.write(`data: ${JSON.stringify({ type: "step", step })}\n\n`); } catch { /* closed */ }
            };
            const skillResult: SkillDispatchResult = await skillAutoDispatcher.dispatch({
              message: userMessageText,
              intentResult,
              userId,
              chatId: effectiveChatId,
              conversationId: streamConversationId,
              requestId,
              assistantMessageId,
              locale: intentResult.language_detected || "es",
              onStep: emitAgentStep2,
            });

            if (skillResult.handled && (skillResult.artifacts.length > 0 || skillResult.textResponse)) {
              console.log(`[Stream] 🎯 SKILL DISPATCHED (2nd): ${skillResult.skillId} (${skillResult.skillName})`);

              if (skillResult.textResponse) {
                writeSse(res, "token", { type: "token", content: skillResult.textResponse });
              }

              for (const artifact of skillResult.artifacts) {
                writeSse(res, "artifact", {
                  type: "artifact",
                  artifact: {
                    filename: artifact.filename,
                    mimeType: artifact.mimeType,
                    size: artifact.size,
                    downloadUrl: artifact.downloadUrl,
                    metadata: artifact.metadata,
                    library: artifact.library,
                  },
                  skillId: skillResult.skillId,
                  skillName: skillResult.skillName,
                });
              }

              if (skillResult.suggestions?.length) {
                writeSse(res, "suggestions", { type: "suggestions", suggestions: skillResult.suggestions });
              }

              writeSse(res, "skill_execution", {
                type: "skill_execution",
                skillId: skillResult.skillId,
                skillName: skillResult.skillName,
                category: skillResult.category,
                artifactCount: skillResult.artifacts.length,
                metrics: skillResult.metrics,
              });

              writeSse(res, "done", { type: "done" });
              if (heartbeatInterval) clearInterval(heartbeatInterval);
              res.end();
              return;
            }
          } catch (skillError: any) {
            console.warn("[Stream] Skill auto-dispatch (2nd) failed, falling back:", skillError?.message);
          }
        }
      }

      // Idempotent close handler: the early SSE handler above may already
      // have registered one; this ensures coverage for the non-early path.
      if (!res.headersSent) {
        req.on("close", () => {
          isConnectionClosed = true;
          if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
          }
          clearStreamTimeouts();
          detachAsyncTask(
            () => cleanupClaimedRunIfOrphaned("client_disconnect"),
            "cleanup orphaned run on late close",
          );
          detachAsyncTask(
            () => flushStreamResumeProgress(getStreamMeta(res)),
            "stream resume flush on late close",
          );
          console.log(`[SSE] Connection closed (late handler): ${requestId}`);
        });
      }

      heartbeatInterval = setInterval(() => {
        const r = res as any;
        if (!isConnectionClosed && !r.writableEnded && !r.destroyed) {
          try {
            res.write(`:heartbeat\n\n`);
            if (typeof (res as unknown as { flush?: Function }).flush === "function") {
              (res as unknown as { flush: Function }).flush();
            } else if (res.socket && typeof res.socket.write === "function") {
              res.socket.write("");
            }

            // Heartbeats count as stream activity; keep the server-side idle timer from firing.
            resetIdleTimeout();
          } catch {
            // Connection gone — stop heartbeat
            isConnectionClosed = true;
            if (heartbeatInterval) clearInterval(heartbeatInterval);
            detachAsyncTask(
              () => cleanupClaimedRunIfOrphaned("heartbeat_write_failed"),
              "cleanup orphaned run after heartbeat failure",
            );
          }
        }
      }, 5000);

      // Process attachments using DocumentBatchProcessor for atomic batch handling
      let attachmentContext = "";
      let batchResult: BatchProcessingResult | null = null;
      const hasAttachments = resolvedAttachments.length > 0;
      const attachmentsCount = hasAttachments ? resolvedAttachments.length : 0;

      // GUARD: Detect if user requests "analyze all" - requires full coverage
      const userMessage = messages[messages.length - 1]?.content || "";
      const requiresFullCoverage = /\b(todos|all|completo|complete|cada|every)\b/i.test(userMessage);

      if (hasAttachments) {
        console.log(`[Stream] Processing ${attachmentsCount} attachment(s) as atomic batch:`,
          resolvedAttachments.map((a: any) => ({
            name: a.name,
            type: a.type,
            storagePath: a.storagePath,
            fileId: a.fileId
          }))
        );

        try {
          const batchProcessor = new DocumentBatchProcessor();

          // Convert resolved attachments to BatchAttachment format
          // storagePaths were already resolved earlier
          const batchAttachments: BatchAttachment[] = resolvedAttachments
            .filter((att: any) => {
              if (!(att.storagePath || att.content)) return false;
              // Exclude image attachments — they are handled by the Vision pipeline below
              const mime = (att.mimeType || att.type || "").toLowerCase();
              if (mime.startsWith("image/")) return false;
              return true;
            })
            .map((att: any) => ({
              name: att.name || 'document',
              mimeType: att.mimeType || att.type || 'application/octet-stream',
              storagePath: att.storagePath || '',
              content: att.content
            }));

          // Skip batch processing if all attachments were images (handled by Vision pipeline)
          if (batchAttachments.length === 0) {
            console.log(`[Stream] All attachments are images — skipping DocumentBatchProcessor`);
          } else {
            batchResult = await batchProcessor.processBatch(batchAttachments);
          }

          if (batchResult) {
            // Log observability metrics per file
            console.log(`[Stream] Batch processing complete:`, {
              attachmentsCount: batchResult.attachmentsCount,
              processedFiles: batchResult.processedFiles,
              failedFiles: batchResult.failedFiles.length,
              totalChunks: batchResult.chunks.length,
              totalTokens: batchResult.totalTokens
            });

            // Log per-file stats
            for (const stat of batchResult.stats) {
              console.log(`[Stream] File stats: ${stat.filename}`, {
                bytesRead: stat.bytesRead,
                pagesProcessed: stat.pagesProcessed,
                tokensExtracted: stat.tokensExtracted,
                parseTimeMs: stat.parseTimeMs,
                chunkCount: stat.chunkCount,
                status: stat.status
              });
            }

            // COVERAGE CHECK: If user asked to analyze "all" files, verify complete coverage
            if (requiresFullCoverage && batchResult.processedFiles !== batchResult.attachmentsCount) {
              const failedList = batchResult.failedFiles.map(f => `${f.filename}: ${f.error}`).join(', ');
              const errorMsg = `Coverage check failed: processed ${batchResult.processedFiles}/${batchResult.attachmentsCount} files. Failed: ${failedList}`;
              console.error(`[Stream] ${errorMsg}`);

              writeSse(res, "error", {
                type: 'coverage_failure',
                message: 'No se pudieron procesar todos los archivos solicitados',
                details: {
                  requested: batchResult.attachmentsCount,
                  processed: batchResult.processedFiles,
                  failedFiles: batchResult.failedFiles
                },
                requestId,
                timestamp: Date.now()
              });

              clearInterval(heartbeatInterval);
              clearStreamTimeouts();
              return res.end();
            }

            // Use unified context from batch processor
            if (batchResult.unifiedContext) {
              attachmentContext = batchResult.unifiedContext;
              console.log(`[Stream] Unified context from ${batchResult.processedFiles} files, length: ${attachmentContext.length} chars`);
            }
          }

        } catch (batchError: any) {
          console.error("[Stream] Batch processing error:", batchError);

          writeSse(res, "error", {
            type: 'batch_processing_error',
            message: 'Error al procesar los archivos adjuntos',
            details: batchError.message,
            requestId,
            timestamp: Date.now()
          });

          clearInterval(heartbeatInterval);
          clearStreamTimeouts();
          return res.end();
        }
      }

      const formattedMessages = messages.map((msg: { role: string; content: string }) => ({
        role: msg.role as "user" | "assistant" | "system",
        content: msg.content
      }));

      // ── IMAGE VISION SUPPORT ──────────────────────────────────────
      // Collect image data to inject as multimodal content into the last user message.
      // Sources: (1) lastImageBase64 from image-edit flow, (2) image attachments uploaded by user.
      const imagePartsForVision: Array<{ type: "image_url"; image_url: { url: string } }> = [];

      console.log(`[Stream] Vision pipeline: resolvedAttachments=${resolvedAttachments.length}, lastImageBase64=${!!lastImageBase64}, lastImageId=${lastImageId || 'none'}`);
      if (resolvedAttachments.length > 0) {
        console.log(`[Stream] Vision pipeline: attachments detail:`, resolvedAttachments.map((a: any) => ({
          name: a.name, type: a.type, mimeType: a.mimeType, storagePath: a.storagePath, fileId: a.fileId,
          hasContent: !!a.content,
        })));
      }

      // Source 1: Image edit context (lastImageBase64 from frontend)
      if (lastImageBase64 && typeof lastImageBase64 === "string") {
        const dataUrl = lastImageBase64.startsWith("data:")
          ? lastImageBase64
          : `data:image/png;base64,${lastImageBase64}`;
        imagePartsForVision.push({ type: "image_url", image_url: { url: dataUrl } });
        console.log(`[Stream] Vision: injecting lastImageBase64 (${Math.round(lastImageBase64.length / 1024)}KB)`);
      }

      // Source 2: Image attachments (uploaded files with image/* mimeType)
      if (resolvedAttachments.length > 0) {
        for (const att of resolvedAttachments) {
          const mime = (att.mimeType || att.type || "").toLowerCase();
          console.log(`[Stream] Vision: checking att "${att.name}" mime="${mime}" isImage=${mime.startsWith("image/")}`);
          if (!mime.startsWith("image/")) continue;

          const storagePath = att.storagePath || "";
          let imageBuffer: Buffer | null = null;

          // Try GCS (object storage) first — production stores files there
          try {
            const objStore = new ObjectStorageService();
            imageBuffer = await objStore.getObjectEntityBuffer(storagePath);
            console.log(`[Stream] Vision: loaded image from GCS "${att.name}" (${imageBuffer.length} bytes)`);
          } catch (gcsErr: any) {
            console.log(`[Stream] Vision: GCS failed for "${att.name}": ${gcsErr?.message || gcsErr}`);
          }

          // Local file fallback
          if (!imageBuffer) {
            try {
              const fs = await import("fs/promises");
              const path = await import("path");
              let filePath = storagePath;
              const cwd = process.cwd();
              console.log(`[Stream] Vision: local fallback for "${att.name}", storagePath="${storagePath}", cwd="${cwd}"`);
              if (filePath.startsWith("/objects/uploads/")) {
                filePath = path.default.join(cwd, filePath.replace("/objects/", ""));
              } else if (filePath.startsWith("/objects/")) {
                filePath = path.default.join(cwd, filePath.replace("/objects/", ""));
              } else if (!path.default.isAbsolute(filePath)) {
                filePath = path.default.join(cwd, "uploads", filePath);
              }
              console.log(`[Stream] Vision: resolved filePath="${filePath}"`);
              // Check if file exists before reading
              try {
                const stat = await fs.stat(filePath);
                console.log(`[Stream] Vision: file exists, size=${stat.size} bytes`);
              } catch {
                console.warn(`[Stream] Vision: file NOT found at "${filePath}"`);
                // Try listing the uploads directory to see what's there
                try {
                  const uploadsDir = path.default.join(cwd, "uploads");
                  const files = await fs.readdir(uploadsDir);
                  console.log(`[Stream] Vision: uploads dir has ${files.length} files: ${files.slice(0, 10).join(', ')}${files.length > 10 ? '...' : ''}`);
                } catch (dirErr: any) {
                  console.warn(`[Stream] Vision: cannot list uploads dir: ${dirErr?.message}`);
                }
              }
              imageBuffer = await fs.readFile(filePath);
              console.log(`[Stream] Vision: loaded image from local "${att.name}" (${imageBuffer.length} bytes)`);
            } catch (localErr: any) {
              console.warn(`[Stream] Vision: failed to load image "${att.name}":`, localErr?.message);
            }
          }

          if (imageBuffer) {
            const base64 = imageBuffer.toString("base64");
            const dataUrl = `data:${mime};base64,${base64}`;
            imagePartsForVision.push({ type: "image_url", image_url: { url: dataUrl } });
            console.log(`[Stream] Vision: added image "${att.name}" to multimodal parts (${Math.round(base64.length / 1024)}KB base64)`);
          } else {
            console.error(`[Stream] Vision: FAILED to load image "${att.name}" from ANY source — image will NOT be sent to LLM`);
          }
        }
      }

      console.log(`[Stream] Vision: total imagePartsForVision=${imagePartsForVision.length}`);

      const isModelVisionCapable = !effectiveModel?.includes("gpt-oss") && !effectiveModel?.includes("gemma");

      if (imagePartsForVision.length > 0 && !isModelVisionCapable) {
        const { batchOCR } = await import("../services/ocrService");
        const imageBuffers: Array<{ buffer: Buffer; id?: string }> = [];
        for (let idx = 0; idx < imagePartsForVision.length; idx++) {
          const url = imagePartsForVision[idx].image_url.url;
          const base64Match = url.match(/^data:image\/\w+;base64,(.+)$/);
          if (base64Match) {
            imageBuffers.push({ buffer: Buffer.from(base64Match[1], "base64"), id: `stream_img_${idx}` });
          }
        }

        let ocrTexts: string[] = [];
        if (imageBuffers.length > 0) {
          try {
            const results = await batchOCR(imageBuffers);
            ocrTexts = results.filter(r => r.text.trim().length > 0).map(r => r.text.trim());
            const avgConf = results.reduce((s, r) => s + r.confidence, 0) / Math.max(results.length, 1);
            console.log(`[Stream] OCR batch: ${results.length} images → ${ocrTexts.length} with text, avg confidence=${avgConf.toFixed(1)}%, passes=${results.map(r => r.passUsed || 'default').join(',')}`);
          } catch (e: any) {
            console.warn(`[Stream] OCR batch failed:`, e?.message);
          }
        }

        const ocrContext = ocrTexts.length > 0
          ? `\n\n[TEXTO EXTRAÍDO DE IMAGEN(ES) VÍA OCR]\n${ocrTexts.join("\n---\n")}\n[FIN DEL TEXTO EXTRAÍDO]`
          : "\n\n[Se adjuntó una imagen pero no se pudo extraer texto. El modelo actual no soporta visión directa.]";

        for (let i = formattedMessages.length - 1; i >= 0; i--) {
          if (formattedMessages[i].role === "user") {
            const textContent = typeof formattedMessages[i].content === "string"
              ? formattedMessages[i].content
              : JSON.stringify(formattedMessages[i].content);
            formattedMessages[i] = {
              role: "user",
              content: textContent + ocrContext,
            };
            console.log(`[Stream] OCR: injected OCR text into user message[${i}] (${ocrTexts.length} images processed)`);
            break;
          }
        }
        imagePartsForVision.length = 0;
        console.log(`[Stream] OCR: cleared imagePartsForVision — using text-only path for non-vision model`);
      }

      if (imagePartsForVision.length > 0) {
        for (let i = formattedMessages.length - 1; i >= 0; i--) {
          if (formattedMessages[i].role === "user") {
            const textContent = typeof formattedMessages[i].content === "string"
              ? formattedMessages[i].content
              : JSON.stringify(formattedMessages[i].content);
            formattedMessages[i] = {
              role: "user",
              content: [
                ...imagePartsForVision,
                { type: "text", text: textContent },
              ] as any,
            };
            console.log(`[Stream] Vision: converted user message[${i}] to multimodal (${imagePartsForVision.length} images, text="${textContent.substring(0, 100)}")`);
            break;
          }
        }

        // Force deep lane for vision requests (images need more tokens)
        if (latencyMode === 'fast') {
          latencyMode = 'deep' as LatencyMode;
          console.log(`[Stream] Vision: upgraded latency mode to 'deep' for image analysis`);
        }
      } else {
        console.log(`[Stream] Vision: NO images found — proceeding with text-only`);
      }

      // GUARD: Block image generation when attachments are present
      if (hasAttachments && attachmentsCount > 0) {
        console.log(`[Stream] GUARD: Image generation BLOCKED - ${attachmentsCount} attachments present`);
        // Ensure route decision does not include image generation tools
        if (routeDecision) {
          routeDecision.tools = routeDecision.tools.filter(t => !['generate_image', 'image_gen', 'dall_e'].includes(t));
          // Force agent mode for document analysis when attachments present
          if (routeDecision.route === 'chat') {
            routeDecision.route = 'agent';
            routeDecision.intent = 'analysis';
          }
        }
      }


      // Classify the question to set token limits (simple vs complex).
      const questionClassification = questionClassifier.classifyQuestion(userMessageText || "");



      // Build Answer-First system prompt based on question type
      const answerFirstPrompt = answerFirstEnforcer.generateAnswerFirstSystemPrompt(
        userMessageText,
        hasAttachments,
        attachmentContext
      );

      let systemContent = answerFirstPrompt.fullPrompt;

      // Agentic system prompt enhancement — adds tool awareness, thinking instructions, and memory
      try {
        const memoryContext = await getMemoryContext(userId, userMessageText || "");
        const enhancedIntent = enhancedClassifyIntent(
          userMessageText || "",
          messages.slice(-4).map((m: any) => ({ role: m.role, content: typeof m.content === "string" ? m.content : "" })),
        );
        const agenticCtx: AgenticPromptContext = {
          userId,
          locale: enhancedIntent.language || "es",
          intent: enhancedIntent.primary.intent,
          intentConfidence: enhancedIntent.confidence,
          hasAttachments,
          conversationLength: messages.length,
          userFacts: memoryContext ? memoryContext.split("\n").filter(Boolean) : undefined,
          model: effectiveModel,
          latencyMode: latencyMode || "auto",
        };
        const agenticPrompt = buildAgenticSystemPrompt(agenticCtx);
        systemContent += `\n\n${agenticPrompt}`;

        // Universal auto-render instruction
        systemContent += `\n\nREGLA DE RENDERIZADO VISUAL: Cuando el usuario pida crear algo visual (diagrama, organigrama, gráfico, tabla, timeline, mapa mental, wireframe, logo, infografía, dashboard, calendario, kanban, certificado, poster, tarjeta), SIEMPRE genera código auto-contenido y renderizable:
- Organigrama/diagrama de flujo → \`\`\`mermaid con flowchart/graph TD
- Gráfico (barras/líneas/pastel) → \`\`\`html con Chart.js via CDN
- SVG (logo, icono, ilustración) → \`\`\`svg con viewBox, colores profesionales
- Tabla comparativa → \`\`\`html con table y estilos inline profesionales
- Timeline/línea de tiempo → \`\`\`mermaid timeline o \`\`\`svg
- Mapa mental → \`\`\`mermaid mindmap
- Wireframe/mockup/dashboard → \`\`\`html con CSS Grid y estilos inline
- Fórmula matemática → usa notación LaTeX entre $$ $$
Usa colores profesionales, bordes redondeados, fuentes legibles. NO uses dependencias externas excepto CDNs (Chart.js, Google Fonts). El código debe ser correcto y completo.`;

        // Add enriched context (time, conversation summary, topics)
        const enriched = enrichContext({
          messages: messages.slice(-10).map((m: any) => ({ role: m.role || "user", content: typeof m.content === "string" ? m.content : "" })),
          userFacts: memoryContext ? memoryContext.split("\n").filter(Boolean) : undefined,
          locale: enhancedIntent.language || "es",
        });
        if (enriched.timeContext) {
          systemContent += `\n\n## CONTEXTO ACTUAL\n${enriched.timeContext}`;
        }
        if (enriched.conversationSummary) {
          systemContent += `\n${enriched.conversationSummary}`;
        }
      } catch (agenticErr) {
        console.warn("[Stream] Agentic prompt enhancement failed (non-blocking):", (agenticErr as Error)?.message);
      }

      try {
        const { AgentIdentity } = await import("../agent/soul/agentIdentity");
        const soul = new AgentIdentity();
        const soulFragment = soul.getSystemPromptFragment();
        if (soulFragment) {
          systemContent += `\n\n## PERSONALIDAD\n${soulFragment}`;
        }
      } catch {}

      if (shouldRunModel && skillSeedForModel) {
        systemContent += `\n\n[CONTEXTO SKILL] Ya existe una respuesta parcial: "${skillSeedForModel.slice(0, 2200)}".\n` +
          "Continúa desde ese punto, evitando repetir contenido ya emitido por la Skill, y completa sólo lo faltante con precisión.";
      }

      if (hasAttachments && attachmentContext && batchResult) {
        // Build citation format instructions based on document types
        const citationFormats = batchResult.stats
          .filter(s => s.status === 'success')
          .map(s => {
            const ext = s.filename.split('.').pop()?.toLowerCase();
            switch (ext) {
              case 'pdf': return `- ${s.filename}: [doc:${s.filename} p#]`;
              case 'xlsx': case 'xls': return `- ${s.filename}: [doc:${s.filename} sheet:NombreHoja cell:A1]`;
              case 'docx': case 'doc': return `- ${s.filename}: [doc:${s.filename} p#]`;
              case 'pptx': case 'ppt': return `- ${s.filename}: [doc:${s.filename} slide:#]`;
              case 'csv': return `- ${s.filename}: [doc:${s.filename} row:#]`;
              default: return `- ${s.filename}: [doc:${s.filename}]`;
            }
          })
          .join('\n');

        // Add document context to Answer-First prompt
        systemContent += `\n\nDOCUMENTOS PROCESADOS (${batchResult.processedFiles}/${batchResult.attachmentsCount}):
${batchResult.stats.map(s => `- ${s.filename}: ${s.status === 'success' ? `${s.tokensExtracted} tokens` : `ERROR: ${s.error}`}`).join('\n')}

FORMATO DE CITAS REQUERIDO:
${citationFormats}

CONTENIDO DE LOS DOCUMENTOS:
${attachmentContext}`;
      }

      // Apply user personalization (style, custom instructions, profile) and semantic memory.
      const userProfileContext = userProfile && (userProfile.nickname || userProfile.occupation || userProfile.bio)
        ? `\n\nInformación del usuario:${userProfile.nickname ? `\n- Nombre/Apodo: ${userProfile.nickname}` : ''}${userProfile.occupation ? `\n- Ocupación: ${userProfile.occupation}` : ''}${userProfile.bio ? `\n- Bio: ${userProfile.bio}` : ''}`
        : '';

      const customInstructionsSection = customInstructions
        ? `\n\nInstrucciones personalizadas del usuario:\n${customInstructions}`
        : '';

      const responseStyleModifier = responseStyle !== 'default'
        ? `\n\nEstilo de respuesta preferido: ${responseStyle === 'formal' ? 'formal y profesional' :
          responseStyle === 'casual' ? 'casual y amigable' :
            responseStyle === 'concise' ? 'muy conciso y breve' : ''
        }`
        : '';

      let semanticMemoryContext: string | null = null;
      if ((featureFlags.memoryEnabled || featureFlags.recordingHistoryEnabled) && userId && userMessageText) {
        try {
          await semanticMemoryStore.initialize();
          const types: Array<"fact" | "preference" | "conversation" | "instruction" | "note"> = [];
          if (featureFlags.memoryEnabled) {
            types.push("fact", "preference", "instruction", "note");
          }
          if (featureFlags.recordingHistoryEnabled) {
            types.push("conversation");
          }

          if (types.length > 0) {
            const results = await semanticMemoryStore.search(userId, userMessageText, {
              limit: 10,
              minScore: 0.4,
              types,
              hybridSearch: true,
            });

            if (results.length > 0) {
              const lines: string[] = ["[Memoria relevante]"];
              let tokenBudget = 350;
              for (const r of results) {
                const line = `• [${r.chunk.type}] ${r.chunk.content}`;
                const estTokens = Math.ceil(line.length / 4);
                if (tokenBudget - estTokens < 0) break;
                tokenBudget -= estTokens;
                lines.push(line);
              }
              semanticMemoryContext = lines.length > 1 ? lines.join("\n") : null;
            }
          }
        } catch (e) {
          console.warn("[Stream] Failed to load semantic memory:", (e as any)?.message || e);
        }
      }

      // If code interpreter is enabled and the user is asking for a chart, force python output.
      const wantsChart = /\b(gr[aá]fic[oa]|chart|plot|visualiz|histograma|diagrama de barras|pie chart|scatter|l[ií]nea|barras)\b/i.test(userMessageText || "");
      const codeInterpreterPrompt = (wantsChart && featureFlags.codeInterpreterEnabled)
        ? `\n\n⚠️ CODE INTERPRETER ACTIVO ⚠️\nEl usuario ha solicitado una gráfica/visualización. Responde con un bloque \`\`\`python\`\`\` ejecutable (matplotlib) y NO con una descripción en texto.`
        : '';

      // Current date/time context for real-time awareness
      const now = new Date();
      const currentDateTimeContext = `\n\nFECHA Y HORA ACTUAL:\n- ISO: ${now.toISOString()}`;

      // ── LOCAL CONTROL: Inform the LLM about its local system capabilities ──
      const localControlSystemPrompt = LOCAL_DESKTOP_ACTIONS_ENABLED ? `

[CAPACIDADES DE CONTROL LOCAL — IMPORTANTES]
Tienes acceso COMPLETO a la computadora del usuario a través del sistema de control local. Esto incluye:

🖥️ TERMINAL Y SHELL:
- Ejecutar cualquier comando en la terminal (bash, zsh)
- Persistencia de directorio de trabajo entre comandos
- Historial de comandos ejecutados

📂 ARCHIVOS Y CARPETAS:
- Crear, leer, escribir, editar, copiar, mover, eliminar archivos y carpetas
- Buscar archivos por patrón (find), buscar contenido dentro de archivos (grep)
- Ver árbol de directorios (tree), permisos (chmod), tamaño (du)
- Comparar archivos (diff), ver metadata (stat)

💻 CÓDIGO Y SCRIPTS:
- Ejecutar código Python en línea o archivos .py
- Ejecutar código Node.js/JavaScript en línea o archivos .js
- Ejecutar cualquier script (bash, ruby, etc.) detectando el lenguaje por extensión

📊 SISTEMA:
- Ver procesos activos (ps), matar procesos (kill), ver puertos en uso (ports)
- Monitor del sistema: CPU, RAM, disco, uptime
- Información detallada del sistema (sysinfo)

📦 PAQUETES Y HERRAMIENTAS:
- npm, pip, brew: instalar, listar, actualizar paquetes
- git: status, add, commit, push, pull, diff, log, branch
- docker: ps, images, run, stop, rm

🔧 OTROS:
- Abrir apps o archivos (open), ver variables de entorno (env)
- Buscar ubicación de binarios (which)

CÓMO FUNCIONA: Cuando el usuario pide algo relacionado con su computadora, archivos, terminal, o sistema — TÚ PUEDES HACERLO.
El sistema puede ejecutar acciones locales internamente cuando corresponda.
Responde con resultados concretos (salida, rutas, conteos o estado).
NUNCA le pidas al usuario ejecutar comandos y NUNCA respondas con instrucciones del tipo "/local ...".

IMPORTANTE: NUNCA digas que no tienes acceso a la terminal, archivos, o sistema del usuario. SÍ tienes acceso completo. Siempre intenta ejecutar lo que pide.
Si el usuario pregunta si tienes acceso a su terminal/computadora/archivos, confirma que SÍ y explica brevemente tus capacidades.
` : '';

      systemContent += `${currentDateTimeContext}${localControlSystemPrompt}${userProfileContext}${customInstructionsSection}${responseStyleModifier}${semanticMemoryContext ? `\n\n${semanticMemoryContext}` : ''}${codeInterpreterPrompt}${webSearchContextForLLM}${skillSystemSection}`;

      // DOC TOOL: Add format-specific system prompt so the LLM outputs structured content
      // that the client-side editors can render (markdown for Word, CSV for Excel, JSON for PPT)
      if (docTool && ['word', 'excel', 'ppt'].includes(docTool)) {
        const docSystemPrompts: Record<string, string> = {
          word: '\n\nMODO DOCUMENTO WORD:\nGenera el contenido del documento en formato Markdown bien estructurado con títulos (#, ##, ###), párrafos, listas, tablas y formato de texto (negrita, cursiva). Escribe contenido completo y profesional. No incluyas bloques de código, instrucciones meta ni explicaciones sobre lo que estás haciendo — solo el contenido del documento.',
          excel: '\n\nMODO HOJA DE CÁLCULO:\nGenera los datos en formato CSV con cabeceras en la primera fila. Usa comas como separador de columnas y saltos de línea como separador de filas. No incluyas explicaciones ni texto adicional, solo los datos tabulares puros.',
          ppt: '\n\nMODO PRESENTACIÓN:\nGenera una presentación como JSON array de slides con esta estructura: [{"title":"Título de slide", "bullets":["Punto 1","Punto 2"]}, ...]. No incluyas explicaciones ni bloques de código, solo el JSON puro.',
        };
        systemContent += docSystemPrompts[docTool] || '';
        console.log(`[Stream] 📝 Added docTool system prompt for: ${docTool}`);
      }

      // Debug: uncomment to trace web search injection
      // console.log(`[Stream:Debug] webSearchContextForLLM length: ${webSearchContextForLLM.length}, systemContent length: ${systemContent.length}`);

      const systemMessage = {
        role: "system" as const,
        content: systemContent
      };

      // Ensure chat exists so we can persist messages (critical for memory)
      const effectiveChatIdForPersistence = chatId || conversationId || streamConversationId;
      const ensureChatStageStart = performance.now();
      try {
        const existingChat = await storage.getChat(effectiveChatIdForPersistence);
        if (!existingChat) {
          await storage.createChat({
            id: effectiveChatIdForPersistence,
            title: "New Chat",
            userId: userId || undefined,
          });
        }
      } catch (e) {
        // Best-effort: if chat creation fails, streaming can still proceed, but memory will degrade.
        console.warn('[Stream] Failed to ensure chat exists for persistence:', e);
      } finally {
        recordStage("ensure_chat_ms", ensureChatStageStart);
      }

      // Persist the latest user message (best-effort). Without this, server-side memory is empty.
      // Skip if a run was claimed - the user message was already created atomically with the run
      // via createUserMessageAndRun in the /chats/:id/messages endpoint.
      let persistedUserMessageId: string | null = claimedRun?.userMessageId || null;
      const persistUserStageStart = performance.now();
      if (!claimedRun) {
        try {
          if (userMessageText && effectiveChatIdForPersistence) {
            // Sanitize attachments: strip large binary/text data, keep only metadata for JSONB storage.
            // The actual file content lives in object storage (storagePath) and conversationDocuments.
            const sanitizedAttachments = resolvedAttachments.length > 0
              ? resolvedAttachments.map((att: any) => {
                // Only keep lightweight metadata fields — strip content, imageUrl, thumbnail, dataUrl
                return {
                  id: att.id || att.fileId,
                  fileId: att.fileId,
                  name: att.name,
                  type: att.type,
                  mimeType: att.mimeType || att.type,
                  size: att.size,
                  storagePath: att.storagePath,
                };
              }).filter((att: any) => att.name)
              : (attachments && Array.isArray(attachments) && attachments.length > 0
                ? attachments.map((att: any) => ({
                  id: att.id || att.fileId,
                  fileId: att.fileId,
                  name: att.name,
                  type: att.type,
                  mimeType: att.mimeType || att.type,
                  size: att.size,
                  storagePath: att.storagePath,
                })).filter((att: any) => att.name)
                : null);

            const userMsg = await storage.createChatMessage({
              chatId: effectiveChatIdForPersistence,
              role: 'user',
              content: userMessageText,
              status: 'done',
              requestId,
              attachments: sanitizedAttachments,
            });
            persistedUserMessageId = userMsg.id;

            // Persist each attachment as a conversationDocument for durable cross-session retrieval.
            // This was previously only done in the legacy /chat endpoint, causing attachments sent
            // via /chat/stream to be lost on reload.
            if (resolvedAttachments.length > 0) {
              for (const att of resolvedAttachments) {
                try {
                  // Determine extracted text: use batch result if available, else attachment content
                  let extractedText = att.content || null;
                  if (batchResult && batchResult.stats) {
                    const fileStat = batchResult.stats.find(
                      (s: any) => s.filename === att.name && s.status === 'success'
                    );
                    if (fileStat) {
                      // Find the matching chunk from batch result for this file's content
                      const fileChunks = batchResult.chunks.filter(
                        (c: any) => c.source === att.name
                      );
                      if (fileChunks.length > 0) {
                        extractedText = fileChunks.map((c: any) => c.content).join('\n');
                      }
                    }
                  }

                  await storage.createConversationDocument({
                    chatId: effectiveChatIdForPersistence,
                    messageId: userMsg.id,
                    fileName: att.name || 'document',
                    storagePath: att.storagePath || null,
                    mimeType: att.mimeType || att.type || 'application/octet-stream',
                    fileSize: att.size || null,
                    extractedText,
                    metadata: { fileId: att.fileId || att.id },
                  });
                  console.log("[Stream] Persisted conversationDocument", {
                    fileName: att.name,
                    chatId: effectiveChatIdForPersistence,
                    messageId: userMsg.id,
                  });
                } catch (docError) {
                  console.error("[Stream] Failed to persist conversationDocument", {
                    fileName: att.name,
                    chatId: effectiveChatIdForPersistence,
                    docError,
                  });
                }
              }
            }

            // Also persist into Conversation State (separate store used by /api/memory/chats/:id/state)
            // Best-effort + idempotent (per-request) to avoid UI retry loops duplicating messages.
            await conversationStateService.appendMessage(
              effectiveChatIdForPersistence,
              'user',
              userMessageText,
              {
                chatMessageId: userMsg.id,
                requestId: `${requestId}:state:user`,
              }
            );
          }
        } catch (e) {
          console.warn('[Stream] Failed to persist user message (best-effort):', e);
        }
      }
      recordStage("persist_user_ms", persistUserStageStart);

      // For claimed runs (run-based flow), the user message was already persisted
      // via createUserMessageAndRun, but conversationDocuments were not created.
      // Persist them now so attachments survive reload.
      if (claimedRun && resolvedAttachments.length > 0 && effectiveChatIdForPersistence) {
        for (const att of resolvedAttachments) {
          try {
            let extractedText = att.content || null;
            if (batchResult && batchResult.stats) {
              const fileStat = batchResult.stats.find(
                (s: any) => s.filename === att.name && s.status === 'success'
              );
              if (fileStat) {
                const fileChunks = batchResult.chunks.filter(
                  (c: any) => c.source === att.name
                );
                if (fileChunks.length > 0) {
                  extractedText = fileChunks.map((c: any) => c.content).join('\n');
                }
              }
            }
            await storage.createConversationDocument({
              chatId: effectiveChatIdForPersistence,
              messageId: claimedRun.userMessageId || null,
              fileName: att.name || 'document',
              storagePath: att.storagePath || null,
              mimeType: att.mimeType || att.type || 'application/octet-stream',
              fileSize: att.size || null,
              extractedText,
              metadata: { fileId: att.fileId || att.id },
            });
            console.log("[Stream] Persisted conversationDocument (run)", {
              fileName: att.name,
              chatId: effectiveChatIdForPersistence,
            });
          } catch (docError) {
            console.error("[Stream] Failed to persist conversationDocument (run)", {
              fileName: att.name,
              chatId: effectiveChatIdForPersistence,
              docError,
            });
          }
        }
      }

      // Best-effort: extract semantic memories from the user's latest message.
      // This is gated by the user's "allowMemories" setting (featureFlags.memoryEnabled).
      if (userId && featureFlags.memoryEnabled && userMessageText) {
        void (async () => {
          try {
            await ensureUserRowExists(userId);
            await semanticMemoryStore.initialize();
            await semanticMemoryStore.extractFromConversation(userId, [
              { role: "user", content: userMessageText }
            ]);
          } catch (e) {
            console.warn("[Stream] Failed to extract/store semantic memory:", (e as any)?.message || e);
          }
        })();
      }

      // Create an assistant message placeholder at the start (so we can stream-update and persist)
      const assistantPlaceholderStageStart = performance.now();
      try {
        const assistantMessage = await storage.createChatMessage({
          chatId: effectiveChatIdForPersistence,
          role: 'assistant',
          content: '', // Will be updated during streaming
          status: 'pending',
          runId: claimedRun?.id,
          userMessageId: claimedRun?.userMessageId || persistedUserMessageId || undefined,
          // chat_messages has a global UNIQUE(request_id). The user message above uses requestId,
          // so the assistant placeholder must NOT reuse it.
          requestId: claimedRun ? undefined : `${requestId}:assistant`,
        });
        assistantMessageId = assistantMessage.id;

        if (claimedRun) {
          await storage.updateChatRunAssistantMessage(claimedRun.id, assistantMessageId);
        }
      } catch (e) {
        console.warn('[Stream] Failed to create assistant placeholder message (best-effort):', e);
      } finally {
        recordStage("assistant_placeholder_ms", assistantPlaceholderStageStart);
      }

      const effectiveRunId = claimedRun?.id || unifiedContext?.runId || requestId;

      // Enriched context event — only emit when connection is alive.
      // Use nullish fallbacks so the frontend receives valid metadata even
      // if unifiedContext creation failed.
      if (!isConnectionClosed) {
        writeSse(res, 'context', {
          requestId,
          runId: effectiveRunId,
          assistantMessageId,
          latencyMode,
          latencyLane: unifiedContext?.resolvedLane || 'fast',
          intent: unifiedContext?.requestSpec?.intent ?? 'chat',
          intentConfidence: unifiedContext?.requestSpec?.intentConfidence ?? 0,
          deliverableType: unifiedContext?.requestSpec?.deliverableType ?? null,
          primaryAgent: unifiedContext?.requestSpec?.primaryAgent ?? null,
          targetAgents: unifiedContext?.requestSpec?.targetAgents ?? [],
          isAgenticMode: unifiedContext?.isAgenticMode ?? false,
          webSources: detectedWebSources.length > 0 ? detectedWebSources : undefined,
          timestamp: Date.now(),
          ...sessionMetadata
        });
      }

      detachAsyncTask(() =>
        emitTraceEvent(effectiveRunId, 'task_start', {
          metadata: {
            chatId,
            userId,
            message: messages[messages.length - 1]?.content?.slice(0, 200) || '',
            intent: unifiedContext?.requestSpec.intent,
            intentConfidence: unifiedContext?.requestSpec.intentConfidence,
            deliverableType: unifiedContext?.requestSpec.deliverableType,
            attachmentsCount: attachmentsCount,
            isAgenticMode: unifiedContext?.isAgenticMode,
            executionMode: unifiedContext?.executionMode,
          }
        }),
      "trace task_start");

      if (unifiedContext?.requestSpec.sessionState) {
        detachAsyncTask(() =>
          emitTraceEvent(effectiveRunId, 'memory_loaded', {
            memory: {
              keys: unifiedContext.requestSpec.sessionState.memoryKeys,
              loaded: unifiedContext.requestSpec.sessionState.turnNumber
            }
          }),
        "trace memory_loaded");
      }

      if (unifiedContext?.isAgenticMode) {
        detachAsyncTask(() =>
          emitTraceEvent(effectiveRunId, 'agent_delegated', {
            agent: {
              name: unifiedContext.requestSpec.primaryAgent,
              role: 'primary',
              status: 'active'
            }
          }),
        "trace agent_delegated");
      }

      detachAsyncTask(() =>
        emitTraceEvent(effectiveRunId, 'thinking', {
          content: `Analyzing request: ${unifiedContext?.requestSpec.intent || 'chat'}`,
          phase: 'planning'
        }),
      "trace thinking");

      // Apply dynamic token limit based on question type (Answer-First)
      const hasWebSearchContext = webSearchContextForLLM.length > 0;
      const effectiveMaxTokens = hasWebSearchContext
        ? 4000 // Web search responses need room to summarize results with citations
        : questionClassification.type === 'summary' ||
          questionClassification.type === 'analysis' ||
          questionClassification.type === 'open_ended' ||
          questionClassification.type === 'explanation'
          ? 4000 // Allow full responses for complex/open-ended questions
          : Math.max(questionClassification.maxTokens * 4, 2000); // Minimum 2000 for any question type

      console.log(`[Stream] Answer-First: type=${questionClassification.type}, maxTokens=${effectiveMaxTokens}, hasWebSearch=${hasWebSearchContext}`);

      // Apply latency-lane-aware token limit:
      //  fast → hard cap to keep response short & snappy (but not when web search is active)
      //  deep → use the question-classification-derived limit
      const resolvedLane = unifiedContext?.resolvedLane || 'fast';
      const safeMaxTokens = Number.isFinite(effectiveMaxTokens) && effectiveMaxTokens > 0
        ? effectiveMaxTokens
        : 1000; // safety floor
      const laneMaxTokens = hasWebSearchContext
        ? safeMaxTokens // Web search results need full token budget regardless of lane
        : resolvedLane === 'fast'
          ? Math.min(safeMaxTokens, 4000) // Allow complete responses even in fast lane
          : safeMaxTokens;

      // Emit thinking event so user sees we're about to generate
      if (!isConnectionClosed) {
        writeSse(res, 'thinking', {
          step: 'generating',
          message: resolvedLane === 'fast' ? 'Generando respuesta...' : 'Generando respuesta detallada...',
          requestId,
          timestamp: Date.now(),
        });
      }

      const shouldRouteThroughAgentRuntime =
        shouldRunModel &&
        !!unifiedContext?.requestSpec &&
        !!unifiedContext?.isAgenticMode &&
        unifiedContext.executionMode !== "conversation";

      if (shouldRouteThroughAgentRuntime) {
        const activeIntent = unifiedContext?.requestSpec?.intent || "unknown";
        const activeExecutionMode = unifiedContext?.executionMode || "direct_agent_loop";
        console.log(`[Stream] 🤖 AGENT RUNTIME: routing intent=${activeIntent} through ${activeExecutionMode}`);
        const origSseWrite = (res as any).sseWrite;
        if (origSseWrite) {
          (res as any).sseWrite = (event: string, data: any) => {
            if (event === "search_progress") {
              capturedTotalSearches = data?.total || capturedTotalSearches;
              if (data?.completed && Array.isArray(data?.queryLog)) {
                capturedSearchQueries = data.queryLog;
              }
            }
            return origSseWrite.call(res, event, data);
          };
        }
        try {
          const agentMessages = [
            { role: "system", content: typeof systemMessage.content === "string" ? systemMessage.content : "" },
            ...formattedMessages.map((m: any) => ({ role: m.role as string, content: typeof m.content === "string" ? m.content : JSON.stringify(m.content) }))
          ];

          const agentRun = await streamAgentRuntime({
            res,
            runId: effectiveRunId,
            userId: userId || streamConversationId || "anonymous",
            chatId: effectiveChatIdForPersistence,
            requestSpec: unifiedContext.requestSpec,
            executionMode: unifiedContext.executionMode === "conversation"
              ? "direct_agent_loop"
              : unifiedContext.executionMode,
            initialMessages: agentMessages,
            maxIterations: 25,
            accessLevel: unifiedContext.accessLevel,
            transport: "native_sse",
          });

          fullContent = agentRun.finalAnswer || "He procesado tu solicitud.";
          if (fullContent.trim()) {
            markFirstToken();
          }
          agentLoopHandled = true;
          if (capturedSearchQueries.length > 0) {
            detectedWebSources.forEach((ws: any) => {
              if (!ws.query) {
                const matchingQuery = capturedSearchQueries.find(q => q.status === "completed");
                if (matchingQuery) ws.query = matchingQuery.query;
              }
            });
          }
          console.log(`[Stream] Agent runtime completed, fullContent length: ${fullContent.length}`);
        } catch (agentError: any) {
          console.error(`[Stream] Agent runtime error:`, agentError?.message || agentError);
          // If the agent already sent some chunks (e.g. browse_and_act ran but
          // the follow-up LLM failed), use whatever was sent as the final content
          // rather than falling back to a completely different LLM stream.
          if (fullContent.trim()) {
            agentLoopHandled = true;
          } else {
            // Provide a direct fallback message instead of falling through to
            // normal streaming which would ignore agentic execution context.
            const failedIntent = unifiedContext?.requestSpec?.intent || "agentic_task";
            fullContent = `Intenté ejecutar la solicitud (${failedIntent}) pero encontré un problema. ` +
              "Inténtalo de nuevo o reformula la petición.";
            agentLoopHandled = true;
            if (!isConnectionClosed) {
              writeSse(res, 'chunk', {
                content: fullContent,
                sequenceId: lastAckSequence + 1,
                requestId,
                runId: effectiveRunId,
                timestamp: Date.now(),
              });
              lastAckSequence++;
            }
          }
        }
      }

      if (shouldRunModel && !agentLoopHandled) {
        const modelStreamStageStart = performance.now();
        let modelMessages = [systemMessage, ...formattedMessages] as any[];
        if (skillSeedForModel) {
          modelMessages.push({ role: "assistant", content: skillSeedForModel });
        }

        const truncation = autoTruncateMessages(modelMessages, effectiveModel);
        if (truncation.truncated) {
          modelMessages = truncation.messages as any[];
        }

        const streamLlmOptions = {
          userId: userId || streamConversationId || "anonymous",
          requestId,
          model: effectiveModel,
          provider: effectiveProvider,
          disableImageGeneration: hasAttachments,
          maxTokens: laneMaxTokens,
        };
        const streamGenerator = await resolveModelStream(
          modelMessages,
          streamLlmOptions,
        );

        // Emit SSE notice if context was truncated (non-blocking, before streaming tokens)
        const truncationInfo = (streamLlmOptions as any).__truncationResult;
        if (truncationInfo?.truncationApplied) {
          recordTruncation(truncationInfo.originalTokens, truncationInfo.finalTokens, truncationInfo.droppedMessages);
          recordContextStrategy(truncationInfo.metadata?.strategy || "sliding_window");
          if (truncationInfo.metadata?.mustKeepPreserved) {
            recordMustKeepSpans(truncationInfo.metadata.mustKeepPreserved);
          }
          writeSse(res, "notice", {
            type: "context_truncated",
            originalTokens: truncationInfo.originalTokens,
            finalTokens: truncationInfo.finalTokens,
            droppedMessages: truncationInfo.droppedMessages,
            truncatedMessageCount: truncationInfo.truncatedMessageCount,
            strategy: truncationInfo.metadata?.strategy,
            requestId,
            timestamp: Date.now(),
          });

          // Persist truncation to audit trail
          promptAuditStore.logTransformation({
            chatId: chatId || undefined,
            runId: runId || undefined,
            requestId,
            stage: "truncate",
            inputTokens: truncationInfo.originalTokens,
            outputTokens: truncationInfo.finalTokens,
            droppedMessages: truncationInfo.droppedMessages,
            droppedChars: 0,
            transformationDetails: {
              strategy: truncationInfo.metadata?.strategy,
              mustKeepPreserved: truncationInfo.metadata?.mustKeepPreserved,
              originalMessageCount: truncationInfo.metadata?.originalMessageCount,
              keptMessageCount: truncationInfo.metadata?.keptMessageCount,
            },
          });
        }

        // ── BUFFERED WRITER ────────────────────────────────────────
        // Batch small deltas into ~30ms flushes to reduce res.write()
        // overhead. The frontend already does RAF throttling, so this
        // matches perfectly.
        const writer = new SseBufferedWriter(res, effectiveRunId, 30, 512);

        // Cleanup writer timer if the client disconnects mid-stream
        const onClose = () => writer.destroy();
        req.once("close", onClose);

        for await (const chunk of streamGenerator) {
          if (isConnectionClosed) break;
          const chunkSequenceId = Number.isFinite(chunk.sequenceId)
            ? Number(chunk.sequenceId)
            : lastAckSequence + 1;
          const chunkRequestId = chunk.requestId || requestId;

          if (chunk.providerSwitch && !isConnectionClosed) {
            writeSse(res, "notice", {
              type: "provider_fallback",
              fromProvider: chunk.providerSwitch.fromProvider,
              toProvider: chunk.providerSwitch.toProvider,
              requestId,
              timestamp: Date.now(),
            });
          }

          if (chunk.provider) {
            activeStreamProvider = chunk.provider;
          }

          if (chunk.content) {
            markFirstToken();
          }
          fullContent += chunk.content;
          lastAckSequence = Math.max(lastAckSequence, chunkSequenceId);

          // Update run's lastSeq for deduplication on reconnect
          if (claimedRun && chunkSequenceId > (claimedRun.lastSeq || 0)) {
            await storage.updateChatRunLastSeq(claimedRun.id, chunkSequenceId);
          }

          if (chunk.done) {
            // Flush remaining buffered content before done event
            writer.finalize();

            console.log(`[Stream] Sending 'done' event with ${detectedWebSources.length} webSources`);
            emitDoneEvent(res, {
              sequenceId: chunkSequenceId,
              requestId: chunkRequestId,
              runId: effectiveRunId,
              intent: unifiedContext?.requestSpec.intent,
              latencyLane: resolvedLane,
              latencyMode,
              totalSequences: Math.max(0, lastAckSequence + 1),
              contentLength: fullContent.length,
              completionReason: "model_stream_done",
              webSources: detectedWebSources.length > 0 ? detectedWebSources : undefined,
              searchQueries: capturedSearchQueries.length > 0 ? capturedSearchQueries : undefined,
              totalSearches: capturedTotalSearches > 0 ? capturedTotalSearches : undefined,
              provider: activeStreamProvider || undefined,
              traceId: requestId,
              timings: buildTimingPayload(),
              ...sessionMetadata
            });
          } else {
            // Push delta into buffer — will be flushed on interval/size threshold
            writer.pushDelta(chunk.content);
          }
        }

        // Ensure buffer is fully flushed after loop and clean up listener
        writer.finalize();
        req.removeListener("close", onClose);
        recordStage("model_stream_ms", modelStreamStageStart);
      } // end if (!agentLoopHandled)

      // If upstream agentic pipeline produced no content, don't leave the UI hanging.
      // Last-resort: attempt a single guaranteeResponse fallback before showing error (open-webui reliability pattern).
      if (!fullContent.trim()) {
        let fallbackContent = "";
        if (!isConnectionClosed && shouldRunModel && modelMessages?.length > 0) {
          try {
            console.warn("[Stream] Empty content detected — attempting guaranteeResponse last-resort fallback", { requestId });
            writeSse(res, 'notice', { type: "retry_empty_response", requestId, timestamp: Date.now() });
            const lastResortResponse = await llmGateway.guaranteeResponse(modelMessages, {
              ...(streamLlmOptions as any),
              skipCache: true,
              enableFallback: true,
              maxTokens: Math.min((streamLlmOptions as any).maxTokens || 2048, 2048),
            });
            const lastResortContent = String((lastResortResponse as any)?.content || "").trim();
            const lastResortValidation = validateLLMResponse(lastResortContent, userQuery?.length || 0);
            if (lastResortContent && lastResortValidation.valid) {
              fallbackContent = lastResortContent;
              console.info("[Stream] guaranteeResponse last-resort succeeded", { requestId, len: fallbackContent.length });
            }
          } catch (lastResortErr) {
            console.warn("[Stream] guaranteeResponse last-resort also failed", { requestId, err: (lastResortErr as Error).message });
          }
        }

        if (!fallbackContent) {
          fallbackContent = shouldRunModel
            ? "Lo siento, el modo agente no pudo generar una respuesta esta vez. Intenta de nuevo o desactiva el modo agente para esta pregunta."
            : "No se pudo completar la respuesta con skills. Reintenta o reformula la consulta.";
        }
        fullContent = fallbackContent;

        if (!isConnectionClosed) {
          markFirstToken();
          const nextSeq = lastAckSequence + 1;
          lastAckSequence = nextSeq;
          writeSse(res, 'chunk', {
            content: fallbackContent,
            sequenceId: nextSeq,
            requestId,
            runId: effectiveRunId,
            timestamp: Date.now(),
            isFallback: true,
          });
        }
      }

      // Smart context-aware suggestions (enhanced) with fallback to generic
      let followUpSuggestions: string[] = [];
      try {
        followUpSuggestions = generateSmartSuggestions({
          aiResponse: fullContent,
          userMessage: userMessageText || messages[messages.length - 1]?.content || "",
          intent: intentResult?.intent || "chat_general",
          hasArtifact: productionArtifacts.length > 0,
          artifactType: productionArtifacts[0]?.type,
          conversationLength: messages.length,
          locale: intentResult?.language_detected || "es",
        });
      } catch {
        followUpSuggestions = buildFollowUpSuggestions({
          assistantContent: fullContent,
          userMessage: userMessageText || messages[messages.length - 1]?.content || "",
          hasWebSources: detectedWebSources.length > 0 || capturedSearchQueries.length > 0,
        });
      }

      // Update assistant message with full content + webSources
      const finalizePersistenceStageStart = performance.now();
      if (assistantMessageId) {
        try {
          // --- Persistent CoT Integration ---
          const traceHistory = agentEventBus.getHistory(effectiveRunId);
          const cotSteps = traceHistory
            .filter(e => e.event_type === 'thinking' || e.event_type === 'tool_call_started')
            .map(e => ({
              title: e.event_type === 'thinking'
                ? ((e as any).message || (e as any).payload?.content || 'Analizando contexto...')
                : `Sistema: ${(e as any).payload?.toolCall?.name || 'Iniciando skill'}`,
              status: "complete"
            }));

          const assistantPayload = buildAssistantMessage({
            content: fullContent,
            webSources: detectedWebSources,
            steps: cotSteps,
            searchQueries: capturedSearchQueries,
            totalSearches: capturedTotalSearches,
            followUpSuggestions,
          });
          const finalMetadata = buildAssistantMessageMetadata(assistantPayload);

          await storage.updateChatMessageContent(
            assistantMessageId,
            assistantPayload.content,
            'done',
            finalMetadata,
          );

          // Also persist assistant into Conversation State so /api/memory/chats/:id/state reflects reality.
          // Best-effort + idempotent.
          await conversationStateService.appendMessage(
            effectiveChatIdForPersistence,
            'assistant',
            fullContent,
            {
              chatMessageId: assistantMessageId,
              requestId: `${requestId}:state:assistant`,
              metadata: finalMetadata || undefined,
            }
          );
        } catch (e) {
          console.warn('[Stream] Failed to finalize assistant message (best-effort):', e);
        }
      }
      recordStage("finalize_persistence_ms", finalizePersistenceStageStart);

      // Mark run as done if we claimed one
      if (claimedRun) {
        await storage.updateChatRunStatus(claimedRun.id, 'done');
        runFinalized = true;
      }

      // Fire-and-forget: Generate an AI-powered descriptive title for this chat
      // based on the user's message and the assistant's response.
      if (effectiveChatIdForPersistence && userMessageText && fullContent.trim()) {
        detachAsyncTask(() =>
          generateAndPersistChatTitle(
            effectiveChatIdForPersistence,
            userMessageText,
            fullContent,
          ),
        "stream title generation");
      }

      const durationMs = unifiedContext ? Date.now() - unifiedContext.startTime : 0;
      const finalTimings = reportTimings("completed");
      const finalSequenceCount = fullContent.trim() && lastAckSequence < 0 ? 1 : Math.max(0, lastAckSequence + 1);

      if (!isConnectionClosed) {
        if (unifiedContext?.isAgenticMode) {
          detachAsyncTask(() =>
            emitTraceEvent(effectiveRunId, 'agent_completed', {
              agent: {
                name: unifiedContext.requestSpec.primaryAgent,
                role: 'primary',
                status: 'completed'
              },
              durationMs
            }),
          "trace agent_completed");
        }

        // Send done event with webSources for frontend NewsCards
        if (!(res as any).__doneSent) {
          const assistantPayload = buildAssistantMessage({
            content: fullContent,
            webSources: detectedWebSources,
            searchQueries: capturedSearchQueries,
            totalSearches: capturedTotalSearches,
            followUpSuggestions,
          });
          emitDoneEvent(res, {
            requestId,
            runId: effectiveRunId,
            assistantMessageId,
            latencyMode,
            latencyLane: resolvedLane,
            totalSequences: finalSequenceCount,
            contentLength: fullContent.length,
            completionReason: "finalized",
            webSources: assistantPayload.webSources,
            searchQueries: assistantPayload.searchQueries,
            totalSearches: assistantPayload.totalSearches,
            followUpSuggestions: assistantPayload.followUpSuggestions,
            provider: activeStreamProvider || undefined,
            traceId: requestId,
            timings: finalTimings,
          });
        }

        emitCompleteEvent(res, {
          requestId,
          runId: effectiveRunId,
          assistantMessageId,
          latencyMode,
          latencyLane: resolvedLane,
          totalSequences: finalSequenceCount,
          contentLength: fullContent.length,
          intent: unifiedContext?.requestSpec.intent,
          deliverableType: unifiedContext?.requestSpec.deliverableType,
          durationMs,
          status: "completed",
          completionReason: "finalized",
          traceId: requestId,
          provider: activeStreamProvider || undefined,
          timings: finalTimings,
          ...sessionMetadata
        });

        detachAsyncTask(() =>
          emitTraceEvent(effectiveRunId, 'done', {
            summary: fullContent.slice(0, 200),
            durationMs,
            phase: 'completed',
            metadata: { contentLength: fullContent.length, sequences: finalSequenceCount }
          }),
        "trace done");
      }

      try {
        await auditLog(req, {
          action: "chat_stream",
          resource: "chats",
          resourceId: streamConversationId || undefined,
          details: {
            messageCount: messages.length,
            requestId,
            runId: claimedRun?.id,
            streaming: true,
          },
          category: "user",
          severity: "info",
        });
      } catch (auditError) {
        console.error("Failed to create audit log:", auditError);
      }

    } catch (error: any) {
      console.error(`[SSE] Stream error ${requestId}:`, error);

      // Mark run as failed if we claimed one
      if (claimedRun) {
        try {
          await storage.updateChatRunStatus(claimedRun.id, 'failed', error.message);
          runFinalized = true;
        } catch (updateError) {
          console.error(`[SSE] Failed to update run status:`, updateError);
        }
      }

      const errorRunId = claimedRun?.id || requestId;
      const errorTimings = reportTimings("error");
      const errorSequenceCount = fullContent.trim() && lastAckSequence < 0 ? 1 : Math.max(0, lastAckSequence + 1);
      if (!isConnectionClosed) {
        // If SSE headers were never established, send a proper JSON error so the
        // client receives a clear error message instead of "failed to fetch".
        if (!res.headersSent) {
          try {
            res.status(500).json({
              error: error.message || "Internal server error",
              code: "STREAM_INIT_ERROR",
              requestId,
              traceId: requestId,
              timings: errorTimings,
            });
          } catch { /* response may already be in an unusable state */ }
          return;
        }
        writeSse(res, 'error', {
          error: error.message,
          requestId,
          runId: errorRunId,
          provider: activeStreamProvider || undefined,
          traceId: requestId,
          timings: errorTimings,
          timestamp: Date.now()
        });

        // Always send a done event after error so the client can finalize.
        // Without this, the client relies on its own timeout to detect the stream
        // ended, which can leave the UI spinner stuck for up to 45s.
        emitDoneEvent(res, {
          requestId,
          runId: errorRunId,
          latencyMode,
          totalSequences: errorSequenceCount,
          contentLength: fullContent.length,
          searchQueries: capturedSearchQueries.length > 0 ? capturedSearchQueries : undefined,
          totalSearches: capturedTotalSearches > 0 ? capturedTotalSearches : undefined,
          provider: activeStreamProvider || undefined,
          traceId: requestId,
          timings: errorTimings,
          completionReason: "error",
          error: true,
        });
        emitCompleteEvent(res, {
          requestId,
          runId: errorRunId,
          assistantMessageId,
          latencyMode,
          totalSequences: errorSequenceCount,
          contentLength: fullContent.length,
          durationMs: errorTimings.totalMs ?? 0,
          status: "error",
          provider: activeStreamProvider || undefined,
          traceId: requestId,
          timings: errorTimings,
          completionReason: "error",
          error: true,
        });


        detachAsyncTask(() =>
          emitTraceEvent(errorRunId, 'error', {
            error: { message: error.message, code: String(error.code || 'UNKNOWN') }
          }),
        "trace error");
      }
    } finally {
      await flushStreamResumeProgress(getStreamMeta(res));

      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
      }
      clearStreamTimeouts();

      // Safety net: if we claimed a run but neither the try nor catch block
      // updated its status (e.g. client disconnected mid-stream and the code
      // fell through), mark it failed so it doesn't stay "processing" forever.
      // We check startedAt to avoid clobbering a run that was re-claimed by a
      // replacement request (queueMode=replace resets startedAt).
      await cleanupClaimedRunIfOrphaned("stream_cleanup");

      if (!timingReported) {
        reportTimings(isConnectionClosed ? "connection_closed" : "ended");
      }
      // Safety net: if no done event was sent and the connection is still open,
      // emit one now so the client can finalize its UI state (spinner, etc.).
      if (!(res as any).__doneSent && !isConnectionClosed && !(res as any).writableEnded) {
        try {
          const safetyNetTimings = buildTimingPayload();
          const safetyNetSequenceCount = fullContent.trim() && lastAckSequence < 0 ? 1 : Math.max(0, lastAckSequence + 1);
          emitDoneEvent(res, {
            requestId,
            runId: claimedRun?.id || requestId,
            latencyMode,
            totalSequences: safetyNetSequenceCount,
            contentLength: fullContent.length,
            traceId: requestId,
            timings: safetyNetTimings,
            completionReason: "safety_net",
            safety_net: true,
          });
          emitCompleteEvent(res, {
            requestId,
            runId: claimedRun?.id || requestId,
            assistantMessageId,
            latencyMode,
            totalSequences: safetyNetSequenceCount,
            contentLength: fullContent.length,
            durationMs: safetyNetTimings.totalMs ?? 0,
            status: "safety_net",
            traceId: requestId,
            timings: safetyNetTimings,
            completionReason: "safety_net",
            safety_net: true,
          });
        } catch { /* connection may have closed between our check and this write */ }
      }

      if (!isConnectionClosed && !(res as any).writableEnded) {
        res.end();
      }
    }
  });



  // 3. Handle DOCUMENT_ANALYSIS intent- POST /analyze
  // ============================================================================================
  // UNIVERSAL DOCUMENT ANALYZER - POST /analyze
  // DATA_MODE enforced: NO image generation, NO artifact creation, NO web search
  // Only deterministic text extraction and LLM analysis with per-document citations
  // PARE Phase 1: Request contract, rate limiting, and quota guard middlewares applied
  // ============================================================================================
  router.post("/analyze",
    pareRequestContract,
    pareAnalyzeSchemaValidator,
    pareRateLimiter(),
    pareQuotaGuard(),
    pareIdempotencyGuard,
    async (req, res) => {
      const pareContext = requirePareContext(req);
      const { requestId, isDataMode, attachmentsCount: pareAttachmentsCount, startTime } = pareContext;
      const timestamp = new Date(startTime).toISOString();

      // Initialize observability infrastructure
      const logger = createPareLogger(requestId);
      logger.setContext({
        userId: pareContext.userId || undefined,
        clientIp: pareContext.clientIp
      });
      const auditCollector = new AuditTrailCollector(requestId);
      const chunkStore = createChunkStore({ maxChunksPerDoc: 50 });

      // SERVER-SIDE isDocumentMode flag - computed from PARE context (attachments.length > 0)
      // PARE enforces DATA_MODE when attachments are present, regardless of frontend flag
      const isDocumentMode = isDataMode; // Derived from PARE context (server-side enforcement)
      const productionWorkflowBlocked = isDataMode; // ProductionWorkflowRunner is NEVER called in DATA_MODE

      // Log request start using structured logger
      logger.logRequest({
        method: req.method,
        path: req.path,
        attachmentsCount: pareAttachmentsCount,
        clientIp: pareContext.clientIp,
        userAgent: req.headers['user-agent']
      });

      try {
        const { messages, attachments, conversationId } = req.body;

        // GUARD: attachments are REQUIRED for /analyze endpoint
        if (!attachments || !Array.isArray(attachments) || attachments.length === 0) {
          console.log(`[Analyze] REJECTED: No attachments provided (requestId: ${requestId})`);
          return res.status(400).json({
            error: "ATTACHMENTS_REQUIRED",
            message: "El endpoint /analyze requiere al menos un documento adjunto.",
            requestId,
            isDocumentMode,
            productionWorkflowBlocked
          });
        }

        const attachmentsCount = attachments.length;

        // Log detailed attachment metadata
        const attachmentMetadata = attachments.map((att: any, idx: number) => ({
          index: idx,
          filename: att.name || 'unknown',
          mimeType: att.mimeType || att.type || 'unknown',
          type: att.type || 'unknown',
          hasStoragePath: !!att.storagePath,
          hasContent: !!att.content,
          fileId: att.fileId || null
        }));

        console.log(`[Analyze] attachments_count: ${attachmentsCount}`);
        console.log(`[Analyze] filenames: ${attachmentMetadata.map(a => a.filename).join(', ')}`);
        console.log(`[Analyze] attachment_metadata:`, JSON.stringify(attachmentMetadata, null, 2));
        console.log(`[Analyze] DATA_MODE ACTIVATED - image_generation: BLOCKED, artifact_creation: BLOCKED`);

        // Get user message
        const lastUserMessage = messages && Array.isArray(messages)
          ? [...messages].reverse().find((m: any) => m.role === 'user')
          : null;
        const userQuery = lastUserMessage?.content || "Analiza el contenido de los documentos.";

        // --- SSE STREAMING: Set up early so ALL paths (including clarification) use SSE ---
        res.setHeader("Content-Type", "text/event-stream");
        applySseSecurityHeaders(res);
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no");
        res.flushHeaders();

        (res as any).locals = (res as any).locals || {};
        const clientRequestId = typeof req.body?.requestId === 'string' && req.body.requestId.trim()
          ? req.body.requestId.trim()
          : requestId;
        (res as any).locals.streamMeta = {
          conversationId,
          requestId: clientRequestId,
          getAssistantMessageId: () => `analyze-${requestId}`,
        };

        // ===================================================================================
        // AGENTIC IMPROVEMENT #1: Use Intent Router to understand user's request
        // ===================================================================================
        let intentResult: IntentResult | null = null;
        try {
          intentResult = await routeIntent(userQuery);
          console.log(`[Analyze] INTENT DETECTED:`, {
            intent: intentResult.intent,
            confidence: intentResult.confidence?.toFixed(2),
            output_format: intentResult.output_format,
            slots: intentResult.slots,
            language: intentResult.language_detected,
            fallback_used: intentResult.fallback_used,
            clarification: intentResult.clarification_question
          });

          // AGENTIC IMPROVEMENT #3: Clarification Loop when confidence is low
          if (intentResult.confidence < 0.7 && intentResult.clarification_question) {
            console.log(`[Analyze] LOW CONFIDENCE (${intentResult.confidence?.toFixed(2)}) - Returning clarification question`);
            writeSse(res, "done", {
              needs_clarification: true,
              answer_text: intentResult.clarification_question,
              detected_intent: intentResult.intent,
              confidence: intentResult.confidence,
              suggested_actions: [
                { label: "Resumir el documento", action: "dame un resumen" },
                { label: "Analizar datos", action: "analiza los datos" },
                { label: "Extraer información", action: "extrae la información principal" }
              ],
              requestId,
            });
            res.end();
            return;
          }
        } catch (intentError: any) {
          console.warn(`[Analyze] Intent routing failed, continuing with default analysis:`, intentError.message);
          // Continue with default behavior if intent routing fails
        }

        // Detect coverage requirement
        const requiresFullCoverage = /\b(todos|all|completo|complete|cada|every|analiza\s+todos)\b/i.test(userQuery);

        // Detect if user explicitly requests enrichment (summary/insights/questions)
        // AGENTIC: Also use intent result to determine enrichment
        const enrichmentPatterns = /\b(resumen|summary|insights|analiza|análisis|analisis|preguntas sugeridas|sugerencias|key findings|hallazgos|overview|resúmen|conclusiones)\b/i;
        const enrichmentFromIntent = intentResult?.intent === 'SUMMARIZE' || intentResult?.intent === 'ANALYZE_DOCUMENT';
        const enrichmentEnabled = enrichmentPatterns.test(userQuery) || enrichmentFromIntent;
        console.log(`[Analyze] enrichmentEnabled: ${enrichmentEnabled} (query: "${userQuery.substring(0, 50)}...", intent: ${intentResult?.intent || 'unknown'})`);

        // Resolve storagePaths for all attachments
        const resolvedAttachments: any[] = [];
        for (const att of attachments) {
          const resolved = { ...att };
          if (!resolved.storagePath && resolved.fileId) {
            const fileRecord = await storage.getFile(resolved.fileId);
            if (fileRecord && fileRecord.storagePath) {
              resolved.storagePath = fileRecord.storagePath;
            }
          }
          resolvedAttachments.push(resolved);
        }

        // Initialize ObjectStorageService for downloading files
        const objectStorageService = new ObjectStorageService();

        const sseActive = true;

        writeSse(res, "thinking", { step: "download", message: `Procesando ${resolvedAttachments.length === 1 ? 'documento' : resolvedAttachments.length + ' documentos'}…` });

        // Process each attachment using normalizeDocument for structured extraction
        const documentModels: DocumentSemanticModel[] = [];
        const processingStats: Array<{
          filename: string;
          status: 'success' | 'error';
          bytesRead: number;
          pagesProcessed: number;
          tokensExtracted: number;
          parseTimeMs: number;
          chunkCount: number;
          error?: string;
        }> = [];
        const failedFiles: Array<{ filename: string; error: string }> = [];

        for (const att of resolvedAttachments) {
          const filename = att.name || 'document';
          const parseStartTime = Date.now();

          try {
            let buffer: Buffer;

            // Download file from object storage using storagePath
            if (att.storagePath) {
              try {
                buffer = await objectStorageService.getObjectEntityBuffer(att.storagePath);
                console.log(`[Analyze] Downloaded ${filename} from storage: ${buffer.length} bytes`);
              } catch (downloadError: any) {
                // LOCAL FALLBACK: Try reading from local uploads/ directory
                // This handles development environments where Replit sidecar is unavailable
                if (att.storagePath.startsWith('/objects/uploads/')) {
                  const objectId = att.storagePath.replace('/objects/uploads/', '');
                  const fs = await import("fs");
                  const path = await import("path");
                  const localFilePath = path.default.join(process.cwd(), "uploads", objectId);

                  if (fs.default.existsSync(localFilePath)) {
                    buffer = await fs.promises.readFile(localFilePath);
                    console.log(`[Analyze] LOCAL FALLBACK: Read ${filename} from ${localFilePath}: ${buffer.length} bytes`);
                  } else {
                    console.error(`[Analyze] LOCAL FALLBACK: File not found at ${localFilePath}`);
                    throw new Error(`Failed to download file from storage and local fallback also failed: ${downloadError.message}`);
                  }
                } else {
                  console.error(`[Analyze] Failed to download ${filename} from ${att.storagePath}:`, downloadError);
                  throw new Error(`Failed to download file from storage: ${downloadError.message}`);
                }
              }
            } else if (att.content) {
              // Use inline content if provided (base64 or string)
              buffer = Buffer.isBuffer(att.content) ? att.content : Buffer.from(att.content, 'base64');
            } else {
              throw new Error('No storagePath or content provided for attachment');
            }

            // Call normalizeDocument with a 30s timeout to prevent hanging on malformed documents
            const PARSE_TIMEOUT_MS = 30_000;
            const docModel = await Promise.race([
              normalizeDocument(buffer, filename, att.storagePath),
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error(`Document parsing timed out after ${PARSE_TIMEOUT_MS / 1000}s for ${filename}`)), PARSE_TIMEOUT_MS)
              ),
            ]);
            documentModels.push(docModel);

            const parseTimeMs = Date.now() - parseStartTime;
            const tokensEstimate = Math.ceil(buffer.length / 4); // Rough token estimate

            const docType = docModel.documentMeta.documentType;
            const rows = docModel.sheets?.[0]?.rowCount;
            const cols = docModel.sheets?.[0]?.columnCount;
            const tables = docModel.tables.length;
            const parseLabel = docType === 'csv' || docType === 'excel'
              ? `Documento procesado${rows ? ` (${rows} filas` : ''}${cols ? ` × ${cols} columnas)` : rows ? ')' : ''}`
              : `Documento procesado (${docType}${docModel.documentMeta.pageCount ? `, ${docModel.documentMeta.pageCount} páginas` : ''})`;
            writeSse(res, "thinking", { step: "parse_done", message: parseLabel });

            processingStats.push({
              filename,
              status: 'success',
              bytesRead: buffer.length,
              pagesProcessed: docModel.documentMeta.pageCount || docModel.documentMeta.sheetCount || 1,
              tokensExtracted: tokensEstimate,
              parseTimeMs,
              chunkCount: docModel.sections.length + docModel.tables.length
            });

            console.log(`[Analyze] Processed ${filename}: ${docModel.documentMeta.documentType}, ${docModel.tables.length} tables, ${docModel.metrics.length} metrics, ${docModel.anomalies.length} anomalies`);

          } catch (error: any) {
            const parseTimeMs = Date.now() - parseStartTime;
            const errorMessage = error.message || 'Unknown error during document processing';

            processingStats.push({
              filename,
              status: 'error',
              bytesRead: 0,
              pagesProcessed: 0,
              tokensExtracted: 0,
              parseTimeMs,
              chunkCount: 0,
              error: errorMessage
            });

            failedFiles.push({ filename, error: errorMessage });
            console.error(`[Analyze] Failed to process ${filename}:`, errorMessage);
          }
        }

        // Create combined batch-like result for compatibility
        const batchResult = {
          attachmentsCount: resolvedAttachments.length,
          processedFiles: documentModels.length,
          failedFiles,
          totalTokens: processingStats.reduce((sum, s) => sum + s.tokensExtracted, 0),
          chunks: documentModels.flatMap(doc =>
            doc.sections.map(section => ({
              docId: doc.documentMeta.fileName,
              filename: doc.documentMeta.fileName,
              content: section.content || '',
              location: section.sourceRef,
              offsets: { start: 0, end: section.content?.length || 0 },
              metadata: { sectionType: section.type }
            }))
          ),
          stats: processingStats,
          documentModels
        };

        // Determine parser used based on mimeType/extension
        const getParserInfo = (mimeType: string, filename: string): { mime_detect: string; parser_used: string } => {
          const ext = filename.split('.').pop()?.toLowerCase() || '';
          const mime = mimeType.toLowerCase();

          if (mime.includes('pdf') || ext === 'pdf') return { mime_detect: 'application/pdf', parser_used: 'PdfParser' };
          if (mime.includes('word') || mime.includes('document') || ext === 'docx' || ext === 'doc') return { mime_detect: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', parser_used: 'DocxParser' };
          if (mime.includes('sheet') || mime.includes('excel') || ext === 'xlsx' || ext === 'xls') return { mime_detect: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', parser_used: 'XlsxParser' };
          if (mime.includes('presentation') || mime.includes('powerpoint') || ext === 'pptx' || ext === 'ppt') return { mime_detect: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', parser_used: 'PptxParser' };
          if (mime.includes('csv') || ext === 'csv') return { mime_detect: 'text/csv', parser_used: 'CsvParser' };
          if (mime.includes('text') || ext === 'txt') return { mime_detect: 'text/plain', parser_used: 'TextParser' };
          return { mime_detect: mimeType || 'application/octet-stream', parser_used: 'TextParser' };
        };

        // Build progress report (per-file metrics) with mime_detect and parser_used
        const progressReport = {
          requestId,
          isDocumentMode,
          productionWorkflowBlocked,
          attachments_count: batchResult.attachmentsCount,
          processedFiles: batchResult.processedFiles,
          failedFiles: batchResult.failedFiles.length,
          tokens_extracted_total: batchResult.totalTokens,
          totalChunks: batchResult.chunks.length,
          perFileStats: batchResult.stats.map((stat, idx) => {
            const originalAtt = resolvedAttachments[idx] || {};
            const parserInfo = getParserInfo(originalAtt.mimeType || originalAtt.type || '', stat.filename);
            return {
              filename: stat.filename,
              status: stat.status,
              bytesRead: stat.bytesRead,
              pagesProcessed: stat.pagesProcessed,
              tokensExtracted: stat.tokensExtracted,
              parseTimeMs: stat.parseTimeMs,
              chunkCount: stat.chunkCount,
              mime_detect: parserInfo.mime_detect,
              parser_used: parserInfo.parser_used,
              error: stat.error || null
            };
          }),
          coverageCheck: {
            required: requiresFullCoverage,
            passed: !requiresFullCoverage || (batchResult.processedFiles === batchResult.attachmentsCount)
          }
        };

        // Record metrics and create audit records for each processed file
        for (const stat of batchResult.stats) {
          const originalAtt = resolvedAttachments.find((a: any) => a.name === stat.filename) || {};
          const parserInfo = getParserInfo(originalAtt.mimeType || originalAtt.type || '', stat.filename);

          // Record parse duration metrics
          pareMetrics.recordParseDuration(stat.parseTimeMs);
          pareMetrics.recordFileProcessed(stat.status === 'success');
          pareMetrics.recordParserExecution(parserInfo.parser_used, stat.parseTimeMs, stat.status === 'success');

          if (stat.status === 'success') {
            pareMetrics.recordTokensExtracted(stat.tokensExtracted);
          }

          // Log parsing result
          logger.logParsing({
            filename: stat.filename,
            mimeType: parserInfo.mime_detect,
            sizeBytes: stat.bytesRead,
            parserUsed: parserInfo.parser_used,
            durationMs: stat.parseTimeMs,
            tokensExtracted: stat.tokensExtracted,
            chunksGenerated: stat.chunkCount,
            success: stat.status === 'success',
            error: stat.error
          });

          // Create audit record
          auditCollector.addRecord(
            {
              filename: stat.filename,
              mimeType: parserInfo.mime_detect,
              sizeBytes: stat.bytesRead,
              content: '' // Content hash computed from buffer in real scenario
            },
            {
              success: stat.status === 'success',
              parserUsed: parserInfo.parser_used,
              tokensExtracted: stat.tokensExtracted,
              chunksGenerated: stat.chunkCount,
              parseTimeMs: stat.parseTimeMs,
              error: stat.error
            }
          );
        }

        // Store chunks with deduplication
        for (const chunk of batchResult.chunks) {
          chunkStore.addChunks(chunk.docId, chunk.filename, [{
            content: chunk.content,
            location: chunk.location,
            offsets: chunk.offsets
          }]);
        }

        // Get audit summary and coverage report
        const auditSummary = auditCollector.getSummary();
        const coverageReport = chunkStore.getCoverageReport();

        // Log observability summary
        logger.info("PARE_BATCH_COMPLETE", {
          attachments_count: progressReport.attachments_count,
          processedFiles: progressReport.processedFiles,
          failedFiles: progressReport.failedFiles,
          tokens_extracted_total: progressReport.tokens_extracted_total,
          totalChunks: progressReport.totalChunks,
          auditBatchId: auditSummary.batchId,
          coverageRate: coverageReport.coverageRate
        });

        // COVERAGE CHECK: If user asked to analyze "all", verify complete coverage
        if (requiresFullCoverage && batchResult.processedFiles !== batchResult.attachmentsCount) {
          const failedList = batchResult.failedFiles.map(f => `${f.filename}: ${f.error}`).join('; ');
          writeSse(res, "error", {
            error: "COVERAGE_CHECK_FAILED",
            message: `No se pudieron procesar todos los archivos. Procesados: ${batchResult.processedFiles}/${batchResult.attachmentsCount}`,
            requestId,
          });
          res.end();
          return;
        }

        // TOKENS CHECK: Ensure we extracted something
        if (batchResult.totalTokens === 0) {
          writeSse(res, "error", {
            error: "PARSE_FAILED",
            message: "No se pudo extraer texto de los documentos adjuntos.",
            requestId,
          });
          res.end();
          return;
        }

        // Build rich document context from DocumentSemanticModel
        // NOTE: Do NOT include fileName in LLM context to prevent model from repeating it
        const buildDocumentStructureSummary = (doc: DocumentSemanticModel, docIndex: number): string => {
          const meta = doc.documentMeta;
          const parts: string[] = [];
          const docLabel = documentModels.length === 1 ? 'El documento' : `Documento ${docIndex + 1}`;
          parts.push(`📄 ${docLabel} (${meta.documentType})`);
          if (doc.sheets && doc.sheets.length > 0) {
            parts.push(`  Sheets: ${doc.sheets.length} (${doc.sheets.map(s => s.name).join(', ')})`);
          }
          parts.push(`  Sections: ${doc.sections.length}, Tables: ${doc.tables.length}`);
          if (meta.pageCount) parts.push(`  Pages: ${meta.pageCount}`);
          if (meta.wordCount) parts.push(`  Words: ${meta.wordCount}`);
          return parts.join('\n');
        };

        const buildMetricsSummary = (doc: DocumentSemanticModel): string => {
          if (doc.metrics.length === 0) return '';
          const metricsText = doc.metrics.slice(0, 10).map(m => {
            const trend = m.trend ? ` (${m.trend === 'up' ? '↑' : m.trend === 'down' ? '↓' : '→'})` : '';
            return `  • ${m.name}: ${m.value}${m.unit ? ' ' + m.unit : ''}${trend} [${m.sourceRef}]`;
          }).join('\n');
          return `\n📊 Key Metrics (${doc.metrics.length} total):\n${metricsText}`;
        };

        const buildAnomaliesSummary = (doc: DocumentSemanticModel): string => {
          if (doc.anomalies.length === 0) return '';
          const anomaliesText = doc.anomalies.slice(0, 5).map(a =>
            `  ⚠️ [${a.severity.toUpperCase()}] ${a.type}: ${a.description} [${a.sourceRef}]`
          ).join('\n');
          return `\n🔍 Detected Anomalies (${doc.anomalies.length} total):\n${anomaliesText}`;
        };

        const buildTablePreview = (table: Table, maxRows: number = 3): string => {
          const header = table.headers.join(' | ');
          const separator = table.headers.map(() => '---').join(' | ');
          const previewRows = (table.previewRows || table.rows.slice(0, maxRows))
            .map(row => row.map(cell => String(cell.value ?? '')).join(' | '))
            .join('\n');
          return `${table.title || 'Table'} [${table.sourceRef}]:\n| ${header} |\n| ${separator} |\n| ${previewRows.split('\n').join(' |\n| ')} |`;
        };

        const buildTablesSummary = (doc: DocumentSemanticModel): string => {
          if (doc.tables.length === 0) return '';
          const tablesPreview = doc.tables.slice(0, 3).map(t => buildTablePreview(t)).join('\n\n');
          return `\n📋 Tables Preview (${doc.tables.length} total):\n${tablesPreview}`;
        };

        const buildSheetsSummary = (doc: DocumentSemanticModel): string => {
          if (!doc.sheets || doc.sheets.length === 0) return '';
          const sheetsText = doc.sheets.map(s =>
            `  📑 ${s.name}: ${s.rowCount} rows × ${s.columnCount} cols, range: ${s.usedRange}\n` +
            `     Headers: ${s.headers.slice(0, 5).join(', ')}${s.headers.length > 5 ? '...' : ''}`
          ).join('\n');
          return `\n📊 Sheets Overview:\n${sheetsText}`;
        };

        // Build comprehensive context for each document
        const documentContexts = documentModels.map((doc, idx) => {
          return [
            buildDocumentStructureSummary(doc, idx),
            buildSheetsSummary(doc),
            buildMetricsSummary(doc),
            buildAnomaliesSummary(doc),
            buildTablesSummary(doc)
          ].filter(Boolean).join('\n');
        });

        // Build citation format examples - use generic labels instead of filenames
        const citationFormats = documentModels.map((doc, idx) => {
          const meta = doc.documentMeta;
          const docRef = documentModels.length === 1 ? 'documento' : `doc${idx + 1}`;
          switch (meta.documentType) {
            case 'excel':
            case 'csv':
              return `[${docRef} sheet:NombreHoja!A1:Z100]`;
            case 'pdf':
              return `[${docRef} p:1]`;
            case 'word':
              return `[${docRef} section:Título]`;
            default:
              return `[${docRef}]`;
          }
        });

        // Build the combined document text from sections - NO filename in LLM context
        const documentText = documentModels.map((doc, idx) => {
          const sectionContent = doc.sections.map(section => {
            const content = section.content || '';
            return `[${section.type}${section.title ? ': ' + section.title : ''}] ${content}`;
          }).join('\n');
          const docLabel = documentModels.length === 1 ? 'DOCUMENTO' : `DOCUMENTO ${idx + 1}`;
          return `--- ${docLabel} ---\n${sectionContent}`;
        }).join('\n\n');

        // ===================================================================================
        // AGENTIC IMPROVEMENT #2: Dynamic System Prompt based on detected intent
        // ===================================================================================
        const getIntentSpecificInstructions = (): string => {
          const detectedIntent = intentResult?.intent || 'ANALYZE_DOCUMENT';
          const slots = intentResult?.slots || {};

          switch (detectedIntent) {
            case 'SUMMARIZE':
              return `
OBJETIVO PRINCIPAL: CREAR UN RESUMEN EJECUTIVO

TU RESPUESTA DEBE INCLUIR:
1. **RESUMEN EJECUTIVO** (obligatorio): Síntesis concisa de 2-3 párrafos del contenido principal
2. **PUNTOS CLAVE**: Lista de 5-7 puntos más importantes
3. **CONCLUSIONES**: Principales conclusiones del documento
${slots.style ? `\nEstilo solicitado: ${slots.style}` : ''}`;

            case 'TRANSLATE':
              const targetLang = slots.target_language || 'inglés';
              return `
OBJETIVO PRINCIPAL: TRADUCIR EL CONTENIDO

Traduce todo el contenido del documento al ${targetLang}.
- Mantén el formato original
- Preserva tecnicismos cuando sea apropiado
- Incluye notas de traducción para términos ambiguos`;

            case 'CREATE_DOCUMENT':
            case 'CREATE_PRESENTATION':
            case 'CREATE_SPREADSHEET':
              return `
OBJETIVO PRINCIPAL: CREAR CONTENIDO NUEVO BASADO EN EL DOCUMENTO

Genera contenido nuevo basándote en la información del documento.
- Organiza la información de manera estructurada
- Crea secciones claras y bien definidas
- Incluye citas del documento original para respaldar cada punto`;

            case 'SEARCH_WEB':
              return `
OBJETIVO PRINCIPAL: EXTRAER INFORMACIÓN ESPECÍFICA

Busca y extrae la información específica solicitada:
${slots.topic ? `- Búsqueda: "${slots.topic}"` : ''}
- Indica claramente si la información no se encuentra en el documento`;

            case 'ANALYZE_DOCUMENT':
            default:
              return `
OBJETIVO PRINCIPAL: ANÁLISIS DETALLADO

TU RESPUESTA DEBE INCLUIR:
1. **RESUMEN EJECUTIVO**: Síntesis de 2-3 párrafos del contenido principal
2. **HALLAZGOS CLAVE**: Lista de los descubrimientos más importantes con citas específicas
3. **DATOS Y MÉTRICAS**: Números, estadísticas y datos cuantitativos encontrados
4. **RIESGOS IDENTIFICADOS**: Problemas, anomalías o áreas de preocupación detectadas
5. **PREGUNTAS RECOMENDADAS**: 3-5 preguntas para profundizar en el análisis`;
          }
        };

        // Build system prompt for document analysis with structured output request
        const systemPrompt = `Eres un asistente experto en análisis de documentos empresariales.

MODO: DATA_MODE (análisis de documentos)
PROHIBIDO: Generar imágenes, crear artefactos, inventar datos, usar fuentes externas

REGLA IMPORTANTE SOBRE NOMBRES DE ARCHIVOS:
- NUNCA menciones nombres de archivos, extensiones (.pdf, .docx, .xlsx, .png, etc.) ni rutas
- Refiérete siempre como "el documento", "este documento" o "los documentos"
- NO uses encabezados como "RESPUESTA AL ANÁLISIS DEL DOCUMENTO X" o "Análisis de archivo.pdf"
- Comienza directamente con el análisis sin mencionar el nombre del archivo

INSTRUCCIONES CRÍTICAS:
1. ANALIZA exclusivamente el contenido de los documentos adjuntos
2. Responde basándote SOLO en el contenido real extraído
3. Para cada afirmación, INCLUYE la cita del documento fuente usando referencias genéricas
4. Si algo no está en los documentos, indica que "no se encontró en los documentos"

INTENT DETECTADO: ${intentResult?.intent || 'ANALYZE_DOCUMENT'} (confianza: ${intentResult?.confidence?.toFixed(2) || 'N/A'})
${getIntentSpecificInstructions()}

FORMATOS DE CITAS (usa estos exactamente):
${citationFormats.join('\n')}

DOCUMENTOS PROCESADOS: ${documentModels.length}

ESTRUCTURA DE LOS DOCUMENTOS:
${documentContexts.join('\n\n')}

CONTENIDO DETALLADO:
${documentText}`;


        // Build messages for LLM
        const llmMessages = [
          { role: "system" as const, content: systemPrompt },
          { role: "user" as const, content: userQuery }
        ];

        // Call LLM with strict DATA_MODE (no tools, no image generation)
        const user = (req as AuthenticatedRequest).user;
        const userId = user?.claims?.sub;

        writeSse(res, "thinking", { step: "llm", message: "Generando análisis…" });

        const streamGenerator = llmGateway.streamChat(llmMessages, {
          userId: userId || conversationId || "anonymous",
          requestId,
          disableImageGeneration: true,  // HARD BLOCK
        });

        let answerText = "";
        for await (const chunk of streamGenerator) {
          answerText += chunk.content;
          if (chunk.content) {
            writeSse(res, "chunk", { content: chunk.content });
          }
        }

        // POST-PROCESS: Remove any filename references the model might have included
        // Collect all filenames from processed documents
        const allFilenames = batchResult.stats
          .filter(s => s.status === 'success')
          .map(s => s.filename);

        // Build regex patterns for filename sanitization
        const sanitizeFilenameReferences = (text: string, filenames: string[]): string => {
          let sanitized = text;

          // For each filename, replace occurrences with "el documento"
          for (const filename of filenames) {
            // Escape special regex characters in filename
            const escapedFilename = filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

            // Match filename with or without quotes, with various prefixes
            const patterns = [
              // "filename.pdf" or 'filename.pdf'
              new RegExp(`["']${escapedFilename}["']`, 'gi'),
              // Análisis del documento "filename.pdf":
              new RegExp(`(Análisis|Análisis del documento|Document analysis|RESPUESTA AL ANÁLISIS DEL DOCUMENTO)\\s*["']?${escapedFilename}["']?:?`, 'gi'),
              // [doc:filename.pdf] style citations
              new RegExp(`\\[doc:${escapedFilename}[^\\]]*\\]`, 'gi'),
              // Just the filename
              new RegExp(`\\b${escapedFilename}\\b`, 'gi'),
            ];

            for (const pattern of patterns) {
              sanitized = sanitized.replace(pattern, (match) => {
                // For citation-style matches, use generic citation
                if (match.startsWith('[doc:')) {
                  return documentModels.length === 1 ? '[documento]' : '[doc1]';
                }
                // For header-style matches, remove entirely
                if (match.match(/^(Análisis|Document|RESPUESTA)/i)) {
                  return '';
                }
                // Otherwise replace with "el documento"
                return 'el documento';
              });
            }
          }

          // Also sanitize any remaining file extension patterns
          // Match patterns like ".pdf", ".docx", ".xlsx" not part of citations
          sanitized = sanitized.replace(/(?<![[\w])(\w+)\.(pdf|docx|xlsx|pptx|csv|txt|png|jpg|jpeg)(?![)\]])/gi, 'el documento');

          // Clean up any double spaces or trailing colons left after removal
          sanitized = sanitized.replace(/\s{2,}/g, ' ').replace(/^\s*:\s*/gm, '');

          return sanitized;
        };

        // Apply sanitization unless user explicitly asked for filename
        const userAskedForFilename = /\b(nombre|filename|archivo|file)\b.*\b(cual|cuál|which|what)\b|\b(cual|cuál|which|what)\b.*\b(nombre|filename|archivo|file)\b/i.test(userQuery);
        if (!userAskedForFilename) {
          answerText = sanitizeFilenameReferences(answerText, allFilenames);
        }

        // Parse response for per-doc findings and citations
        const citations: string[] = [];
        const citationRegex = /\[doc:([^\]]+)\]/g;
        let match;
        while ((match = citationRegex.exec(answerText)) !== null) {
          if (!citations.includes(match[0])) {
            citations.push(match[0]);
          }
        }

        // Build per-doc findings (basic extraction)
        const perDocFindings: Record<string, string[]> = {};
        for (const stat of batchResult.stats.filter(s => s.status === 'success')) {
          const docName = stat.filename;
          const findings: string[] = [];
          // Find sentences that reference this document
          const sentences = answerText.split(/[.!?]\s+/);
          for (const sentence of sentences) {
            if (sentence.toLowerCase().includes(docName.toLowerCase()) ||
              sentence.includes(`[doc:${docName}`)) {
              findings.push(sentence.trim());
            }
          }
          if (findings.length > 0) {
            perDocFindings[docName] = findings;
          }
        }

        // Calculate total request duration
        const requestDurationMs = Date.now() - startTime;
        pareMetrics.recordRequestDuration(requestDurationMs);

        // Only generate enrichment UI components when explicitly requested
        let actionableInsights: Array<{
          id: string;
          type: 'finding' | 'risk' | 'opportunity' | 'recommendation';
          title: string;
          description: string;
          confidence: 'low' | 'medium' | 'high';
          sourceRefs: string[];
        }> = [];

        let suggestedQuestionsOutput: Array<{
          id: string;
          question: string;
          category: 'analysis' | 'clarification' | 'action' | 'deep-dive';
          relatedSources: string[];
        }> = [];

        // Aggregate insights and questions only when enrichment is enabled
        let allInsights: Insight[] = [];
        let allSuggestedQuestions: SuggestedQuestion[] = [];

        if (enrichmentEnabled) {
          console.log(`[Analyze] Enrichment ENABLED - generating insights and suggested questions`);

          // Aggregate insights from all document models
          allInsights = documentModels.flatMap(doc => doc.insights || []);

          // Aggregate suggested questions from all document models  
          allSuggestedQuestions = documentModels.flatMap(doc => doc.suggestedQuestions || []);

          // Extract risks from anomalies
          documentModels.forEach(doc => {
            doc.anomalies.forEach(anomaly => {
              actionableInsights.push({
                id: anomaly.id,
                type: 'risk',
                title: `${anomaly.type} detected`,
                description: anomaly.description,
                confidence: anomaly.severity === 'high' ? 'high' : anomaly.severity === 'medium' ? 'medium' : 'low',
                sourceRefs: [anomaly.sourceRef]
              });
            });
          });

          // Add insights from document models
          allInsights.forEach(insight => {
            actionableInsights.push({
              id: insight.id,
              type: insight.type as 'finding' | 'risk' | 'opportunity' | 'recommendation',
              title: insight.title,
              description: insight.description,
              confidence: insight.confidence,
              sourceRefs: insight.sourceRefs
            });
          });

          // Generate suggested questions for further analysis
          suggestedQuestionsOutput = allSuggestedQuestions.map(q => ({
            id: q.id,
            question: q.question,
            category: q.category,
            relatedSources: q.relatedSources
          }));

          // Add default questions if none were extracted
          if (suggestedQuestionsOutput.length === 0) {
            const defaultQuestions = [
              { id: 'q1', question: '¿Cuáles son las tendencias principales en los datos?', category: 'analysis' as const, relatedSources: documentModels.map(d => d.documentMeta.fileName) },
              { id: 'q2', question: '¿Existen valores atípicos o anomalías importantes?', category: 'deep-dive' as const, relatedSources: documentModels.map(d => d.documentMeta.fileName) },
              { id: 'q3', question: '¿Qué acciones se recomiendan basándose en estos datos?', category: 'action' as const, relatedSources: documentModels.map(d => d.documentMeta.fileName) },
            ];
            suggestedQuestionsOutput.push(...defaultQuestions);
          }
        } else {
          console.log(`[Analyze] Enrichment DISABLED - returning direct answer only`);
        }

        // Build response payload with full DocumentSemanticModel and enhanced fields
        const responsePayload = {
          success: true,
          requestId,
          mode: "DATA_MODE",
          answer_text: answerText,
          documentModel: documentModels.length === 1 ? documentModels[0] : {
            version: "1.0" as const,
            documentMeta: {
              id: `batch_${requestId}`,
              fileName: documentModels.map(d => d.documentMeta.fileName).join(', '),
              fileSize: documentModels.reduce((sum, d) => sum + d.documentMeta.fileSize, 0),
              mimeType: 'application/batch',
              documentType: 'unknown' as const,
              title: `Batch Analysis: ${documentModels.length} documents`
            },
            sections: documentModels.flatMap(d => d.sections),
            tables: documentModels.flatMap(d => d.tables),
            metrics: documentModels.flatMap(d => d.metrics),
            anomalies: documentModels.flatMap(d => d.anomalies),
            insights: allInsights,
            sources: documentModels.flatMap(d => d.sources),
            sheets: documentModels.flatMap(d => d.sheets || []),
            suggestedQuestions: allSuggestedQuestions,
            extractionDiagnostics: {
              extractedAt: new Date().toISOString(),
              durationMs: requestDurationMs,
              parserUsed: 'normalizeDocument',
              mimeTypeDetected: 'batch',
              bytesProcessed: documentModels.reduce((sum, d) => sum + d.documentMeta.fileSize, 0)
            }
          },
          documentModels: documentModels,
          insights: actionableInsights,
          suggestedQuestions: suggestedQuestionsOutput,
          ui_components: enrichmentEnabled ? ['executive_summary', 'suggested_questions', 'insights_panel'] : [],
          enrichmentEnabled,
          per_doc_findings: perDocFindings,
          citations,
          progressReport: {
            ...progressReport,
            auditSummary: {
              batchId: auditSummary.batchId,
              totalFiles: auditSummary.totalFiles,
              successCount: auditSummary.successCount,
              failureCount: auditSummary.failureCount,
              totalTokens: auditSummary.totalTokens,
              totalParseTimeMs: auditSummary.totalParseTimeMs
            },
            chunkCoverage: {
              totalDocuments: coverageReport.totalDocuments,
              uniqueChunks: coverageReport.uniqueChunks,
              duplicatesRemoved: coverageReport.duplicatesRemoved,
              coverageRate: coverageReport.coverageRate
            }
          },
          metadata: {
            totalTokensExtracted: batchResult.totalTokens,
            totalChunks: batchResult.chunks.length,
            processingTimeMs: requestDurationMs,
            documentsProcessed: documentModels.length,
            totalTables: documentModels.reduce((sum, d) => sum + d.tables.length, 0),
            totalMetrics: documentModels.reduce((sum, d) => sum + d.metrics.length, 0),
            totalAnomalies: documentModels.reduce((sum, d) => sum + d.anomalies.length, 0)
          }
        };

        // Log response
        logger.logResponse({
          statusCode: 200,
          durationMs: requestDurationMs,
          chunksReturned: batchResult.chunks.length,
          totalTokens: batchResult.totalTokens,
          filesProcessed: batchResult.processedFiles,
          filesFailed: batchResult.failedFiles.length
        });

        // Log audit trail
        logger.logAudit({
          action: "document_analysis",
          resource: "batch",
          resourceId: auditSummary.batchId,
          details: {
            filesCount: auditSummary.totalFiles,
            successCount: auditSummary.successCount,
            failureCount: auditSummary.failureCount
          },
          outcome: auditSummary.failureCount === 0 ? "success" : "failure"
        });

        // KILL-SWITCH: Validate DATA_MODE response before sending
        // Phase 2: Enhanced validation with response contract
        const { validateDataModeResponseEnhanced, DataModeOutputViolationError } = await import('../lib/dataModeValidator');
        const { validateResponseContract } = await import('../lib/pareResponseContract');

        // Extract attachment names for coverage validation
        const attachmentNames = batchResult.stats
          .filter(s => s.status === 'success')
          .map(s => s.filename);

        // Phase 2: Response contract validation with coverage check
        const contractValidation = validateResponseContract(
          responsePayload,
          attachmentNames,
          {
            contentType: 'application/json',
            requireFullCoverage: requiresFullCoverage
          }
        );

        // Log contract validation results
        console.log(`[Analyze] RESPONSE_CONTRACT validation:`, {
          valid: contractValidation.valid,
          hasValidContentType: contractValidation.hasValidContentType,
          hasNoBlobs: contractValidation.hasNoBlobs,
          hasNoBase64Data: contractValidation.hasNoBase64Data,
          hasNoImageUrls: contractValidation.hasNoImageUrls,
          coverageRatio: contractValidation.coverageRatio.toFixed(2),
          meetsCoverageRequirement: contractValidation.meetsCoverageRequirement,
          documentsWithCitations: contractValidation.documentsWithCitations,
          documentsWithoutCitations: contractValidation.documentsWithoutCitations,
          violationCount: contractValidation.violations.length
        });

        if (!contractValidation.valid) {
          console.error(`[Analyze] ========== RESPONSE_CONTRACT_VIOLATION ${requestId} ==========`);
          contractValidation.violations.forEach((v, i) => {
            console.error(`[Analyze] [${i + 1}] ${v.code}: ${v.message}`);
          });
          writeSse(res, "error", {
            error: "RESPONSE_CONTRACT_VIOLATION",
            message: "La respuesta no cumple con el contrato de respuesta PARE Phase 2",
            requestId,
          });
          res.end();
          return;
        }

        // Enhanced DATA_MODE validation with all checks
        const validationResult = validateDataModeResponseEnhanced(responsePayload, requestId, {
          contentType: 'application/json',
          attachmentNames,
          requireFullCoverage: requiresFullCoverage,
          userQuery
        });

        if (!validationResult.valid) {
          console.error(`[Analyze] ========== DATA_MODE_OUTPUT_VIOLATION ${requestId} ==========`);
          console.error(`[Analyze] Violations: ${validationResult.violations.join('; ')}`);
          console.error(`[Analyze] Stack: ${validationResult.stack}`);
          writeSse(res, "error", {
            error: "DATA_MODE_OUTPUT_VIOLATION",
            message: "La respuesta contiene elementos prohibidos en DATA_MODE",
            requestId,
          });
          res.end();
          return;
        }

        // Return structured response (progressReport key matches test expectations)
        console.log(`[Analyze] ========== SUCCESS ${requestId} ==========`);
        console.log(`[Analyze] Response includes isDocumentMode: ${progressReport.isDocumentMode}, productionWorkflowBlocked: ${progressReport.productionWorkflowBlocked}`);
        console.log(`[Analyze] KILL-SWITCH: Payload validated, no image/artifact violations`);
        console.log(`[Analyze] RESPONSE_CONTRACT: All ${attachmentNames.length} documents have citations`);

        if (pareContext.idempotencyKey) {
          try {
            await completeIdempotencyKey(pareContext.idempotencyKey, responsePayload);
          } catch (idempotencyError) {
            console.error(`[Analyze] Failed to complete idempotency key: ${idempotencyError}`);
          }
        }

        writeSse(res, "done", {
          answer_text: responsePayload.answer_text,
          ui_components: responsePayload.ui_components,
          enrichmentEnabled: responsePayload.enrichmentEnabled,
          insights: responsePayload.insights,
          suggestedQuestions: responsePayload.suggestedQuestions,
          metadata: responsePayload.metadata,
        });
        res.end();

      } catch (error: any) {
        // Mark idempotency key as failed
        if (pareContext.idempotencyKey) {
          try {
            await failIdempotencyKey(pareContext.idempotencyKey, error.message || 'Unknown error');
          } catch (idempotencyError) {
            console.error(`[Analyze] Failed to mark idempotency key as failed: ${idempotencyError}`);
          }
        }

        // Log error using structured logger
        logger.logError({
          error,
          phase: "unknown",
          stack: error.stack
        });

        // Record failed request in metrics
        pareMetrics.recordRequestDuration(Date.now() - startTime);

        // Check if it's a DATA_MODE violation error
        if (error.name === 'DataModeOutputViolationError') {
          logger.logAudit({
            action: "document_analysis",
            resource: "batch",
            details: { errorType: "DATA_MODE_OUTPUT_VIOLATION" },
            outcome: "failure"
          });
        }

        logger.logAudit({
          action: "document_analysis",
          resource: "batch",
          details: { errorType: "ANALYSIS_FAILED", errorMessage: error.message },
          outcome: "failure"
        });

        if (res.headersSent) {
          writeSse(res, "error", {
            error: error.name === 'DataModeOutputViolationError' ? "DATA_MODE_OUTPUT_VIOLATION" : "ANALYSIS_FAILED",
            message: error.message || "Error durante el análisis de documentos",
            requestId,
          });
          res.end();
        } else {
          res.status(500).json({
            error: "ANALYSIS_FAILED",
            message: error.message || "Error durante el análisis de documentos",
            requestId
          });
        }
      }
    });

  return router;
}
