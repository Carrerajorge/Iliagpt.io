import {
  ROUTER_VERSION,
  type IntentResult,
  type IntentType,
  type OutputFormat,
  type Slots,
} from "../../shared/schemas/intent";
import type { MemoryRecord, MemoryStore, ContextBundle } from "./context";
import type { CognitiveIntent, IntentClassification, ProviderAdapter } from "./types";
import { enrichContext, renderContextBundle } from "./contextEnricher";
import { selectProvider } from "./cognitiveMiddleware";
import { classifyIntent } from "./intentRouter";
import { SmartRouterAdapter } from "./providerAdapters/smartRouterAdapter";
import { InHouseGptAdapter } from "./providerAdapters/inHouseGptAdapter";
import { semanticMemoryStore } from "../memory/SemanticMemoryStore";

export type ChatCognitiveWorkflow =
  | "artifact_generation"
  | "skill_dispatch"
  | "agent_execution"
  | "conversation";

export interface ChatCognitiveKernelOptions {
  userId: string;
  message: string;
  intentResult?: IntentResult | null;
  intentHint?: CognitiveIntent;
  preferredProvider?: string;
  enableMemory?: boolean;
  memoryLimit?: number;
  conversationLength?: number;
  allowIntentPromotion?: boolean;
  signal?: AbortSignal;
  adapters?: readonly ProviderAdapter[];
  memoryStore?: MemoryStore;
}

export interface ChatCognitiveKernelDecision {
  workflow: ChatCognitiveWorkflow;
  cognitiveIntent: IntentClassification;
  sharedIntent: IntentResult | null;
  authoritativeIntentResult: IntentResult | null;
  provider: {
    name: string | null;
    reason: string;
    capabilities: CognitiveIntent[];
  };
  context: {
    retrievedCount: number;
    includedCount: number;
    totalChars: number;
    errors: string[];
    renderedContext: string | null;
    telemetry: ContextBundle["telemetry"];
  };
  corrected: boolean;
  correctionReason: string | null;
  metadata: Record<string, unknown>;
}

const DEFAULT_KERNEL_ADAPTERS: readonly ProviderAdapter[] = [
  new SmartRouterAdapter(),
  new InHouseGptAdapter(),
];

const EMPTY_CONTEXT: ChatCognitiveKernelDecision["context"] = {
  retrievedCount: 0,
  includedCount: 0,
  totalChars: 0,
  errors: [],
  renderedContext: null,
  telemetry: {
    memoryLookupMs: 0,
    documentLookupMs: 0,
    totalMs: 0,
  },
};

class SemanticKernelMemoryStore implements MemoryStore {
  readonly name = "semantic-kernel-memory";

  async recall(
    userId: string,
    query: string,
    limit: number,
    signal?: AbortSignal,
  ): Promise<MemoryRecord[]> {
    if (signal?.aborted) return [];

    try {
      await semanticMemoryStore.initialize();
      const results = await semanticMemoryStore.search(userId, query, {
        limit,
        minScore: 0.35,
        hybridSearch: true,
      });

      return results.map((result) => ({
        id: result.chunk.id,
        userId: result.chunk.userId,
        text: result.chunk.content,
        importance: Math.max(
          0,
          Math.min(
            1,
            result.score * 0.7 + (result.chunk.metadata.confidence ?? 0.5) * 0.3,
          ),
        ),
        createdAt: result.chunk.metadata.createdAt.getTime(),
        metadata: {
          type: result.chunk.type,
          score: result.score,
          source: result.chunk.metadata.source,
          matchType: result.matchType,
          accessCount: result.chunk.metadata.accessCount,
          confidence: result.chunk.metadata.confidence,
        },
      }));
    } catch {
      return [];
    }
  }

  async remember(record: Omit<MemoryRecord, "id" | "createdAt">): Promise<MemoryRecord> {
    await semanticMemoryStore.initialize();
    const stored = await semanticMemoryStore.remember(
      record.userId,
      record.text,
      "note",
      {
        source: String(record.metadata?.source ?? "cognitive-kernel"),
        confidence: record.importance,
      },
    );

    return {
      id: stored.id,
      userId: stored.userId,
      text: stored.content,
      importance: stored.metadata.confidence,
      createdAt: stored.metadata.createdAt.getTime(),
      metadata: {
        type: stored.type,
        source: stored.metadata.source,
        confidence: stored.metadata.confidence,
      },
    };
  }
}

export async function createChatCognitiveKernelDecision(
  options: ChatCognitiveKernelOptions,
): Promise<ChatCognitiveKernelDecision> {
  const sharedIntent = options.intentResult ?? null;
  const cognitiveIntent = classifyIntent(options.message, options.intentHint);
  const authoritativeIntentResult = reconcileIntentResult(
    options.message,
    cognitiveIntent,
    sharedIntent,
    options.allowIntentPromotion !== false,
  );
  const workflow = decideWorkflow(authoritativeIntentResult, cognitiveIntent);
  const adapters = options.adapters ?? DEFAULT_KERNEL_ADAPTERS;
  const providerSelection = selectProvider(
    adapters,
    cognitiveIntent.intent,
    normalizePreferredAdapterName(options.preferredProvider),
  );
  const context = options.enableMemory
    ? await buildKernelContext(
        options.userId,
        options.message,
        options.memoryLimit ?? 4,
        options.signal,
        options.memoryStore ?? new SemanticKernelMemoryStore(),
      )
    : EMPTY_CONTEXT;

  const corrected =
    sharedIntent?.intent !== authoritativeIntentResult?.intent ||
    sharedIntent?.output_format !== authoritativeIntentResult?.output_format;
  const correctionReason =
    corrected && authoritativeIntentResult
      ? `corrected ${sharedIntent?.intent ?? "null"} -> ${authoritativeIntentResult.intent}`
      : null;

  const metadata: Record<string, unknown> = {
    routerVersion: ROUTER_VERSION,
    workflow,
    sharedIntent: sharedIntent?.intent ?? null,
    sharedConfidence: sharedIntent?.confidence ?? null,
    authoritativeIntent: authoritativeIntentResult?.intent ?? null,
    authoritativeFormat: authoritativeIntentResult?.output_format ?? null,
    cognitiveIntent: cognitiveIntent.intent,
    cognitiveConfidence: cognitiveIntent.confidence,
    cognitiveReasoning: cognitiveIntent.reasoning,
    corrected,
    correctionReason,
    provider: providerSelection.adapter?.name ?? null,
    providerReason: providerSelection.reason,
    memoryHits: context.includedCount,
    memoryRetrieved: context.retrievedCount,
    memoryErrors: context.errors,
    contextChars: context.totalChars,
    conversationLength: options.conversationLength ?? 0,
  };

  return {
    workflow,
    cognitiveIntent,
    sharedIntent,
    authoritativeIntentResult,
    provider: {
      name: providerSelection.adapter?.name ?? null,
      reason: providerSelection.reason,
      capabilities: Array.from(
        (providerSelection.adapter?.capabilities ?? new Set()) as ReadonlySet<CognitiveIntent>,
      ),
    },
    context,
    corrected,
    correctionReason,
    metadata,
  };
}

async function buildKernelContext(
  userId: string,
  message: string,
  memoryLimit: number,
  signal: AbortSignal | undefined,
  memoryStore: MemoryStore,
): Promise<ChatCognitiveKernelDecision["context"]> {
  const bundle = await enrichContext(
    userId,
    message,
    {
      memoryStore,
      maxMemoryChunks: memoryLimit,
      maxDocumentChunks: 0,
      maxTotalChars: 2400,
    },
    signal,
  );

  return {
    retrievedCount: bundle.retrievedCount,
    includedCount: bundle.includedCount,
    totalChars: bundle.totalChars,
    errors: bundle.errors,
    renderedContext:
      bundle.includedCount > 0 ? renderContextBundle(bundle) : null,
    telemetry: bundle.telemetry,
  };
}

function decideWorkflow(
  authoritativeIntentResult: IntentResult | null,
  cognitiveIntent: IntentClassification,
): ChatCognitiveWorkflow {
  const authoritativeIntent = authoritativeIntentResult?.intent;
  if (
    authoritativeIntent === "CREATE_DOCUMENT" ||
    authoritativeIntent === "CREATE_PRESENTATION" ||
    authoritativeIntent === "CREATE_SPREADSHEET"
  ) {
    return "artifact_generation";
  }

  if (
    authoritativeIntent &&
    authoritativeIntent !== "CHAT_GENERAL" &&
    authoritativeIntent !== "NEED_CLARIFICATION"
  ) {
    return "skill_dispatch";
  }

  if (
    cognitiveIntent.intent === "tool_call" ||
    cognitiveIntent.intent === "agent_task"
  ) {
    return "agent_execution";
  }

  return "conversation";
}

function reconcileIntentResult(
  message: string,
  cognitiveIntent: IntentClassification,
  sharedIntent: IntentResult | null,
  allowIntentPromotion: boolean,
): IntentResult | null {
  if (!allowIntentPromotion) {
    return sharedIntent;
  }

  if (sharedIntent && sharedIntent.confidence >= 0.75) {
    return sharedIntent;
  }

  const synthesized = synthesizeIntentResult(message, cognitiveIntent, sharedIntent);
  if (!synthesized) {
    return sharedIntent;
  }

  if (!sharedIntent) {
    return synthesized;
  }

  if (
    sharedIntent.intent === "CHAT_GENERAL" ||
    sharedIntent.intent === "NEED_CLARIFICATION" ||
    sharedIntent.confidence < synthesized.confidence
  ) {
    return synthesized;
  }

  return sharedIntent;
}

function synthesizeIntentResult(
  message: string,
  cognitiveIntent: IntentClassification,
  sharedIntent: IntentResult | null,
): IntentResult | null {
  switch (cognitiveIntent.intent) {
    case "doc_generation":
      return buildDocumentIntentResult(message, cognitiveIntent, sharedIntent);
    case "data_analysis":
      return buildIntentResult(
        "ANALYZE_DATA",
        sharedIntent?.output_format ?? "xlsx",
        message,
        cognitiveIntent,
        sharedIntent,
      );
    default:
      return null;
  }
}

function buildDocumentIntentResult(
  message: string,
  cognitiveIntent: IntentClassification,
  sharedIntent: IntentResult | null,
): IntentResult {
  const format = inferOutputFormat(message, sharedIntent);
  const mappedIntent: IntentType =
    format === "pptx"
      ? "CREATE_PRESENTATION"
      : format === "xlsx" || format === "csv"
        ? "CREATE_SPREADSHEET"
        : "CREATE_DOCUMENT";

  return buildIntentResult(
    mappedIntent,
    format,
    message,
    cognitiveIntent,
    sharedIntent,
  );
}

function buildIntentResult(
  intent: IntentType,
  outputFormat: OutputFormat,
  message: string,
  cognitiveIntent: IntentClassification,
  sharedIntent: IntentResult | null,
): IntentResult {
  const slots: Slots = {
    ...(sharedIntent?.slots ?? {}),
  };
  if (!slots.topic) {
    slots.topic = deriveTopic(message);
  }

  return {
    type: "single",
    intent,
    output_format: outputFormat,
    slots,
    confidence: Math.max(0.76, cognitiveIntent.confidence),
    raw_confidence: cognitiveIntent.confidence,
    normalized_text: normalizeText(message),
    matched_patterns: [cognitiveIntent.intent],
    reasoning: `cognitive-kernel: ${cognitiveIntent.reasoning}`,
    fallback_used: "none",
    language_detected: sharedIntent?.language_detected ?? detectKernelLanguage(message),
    router_version: ROUTER_VERSION,
    processing_time_ms: 0,
    cache_hit: false,
  };
}

function inferOutputFormat(
  message: string,
  sharedIntent: IntentResult | null,
): OutputFormat {
  const normalized = normalizeText(message);
  if (/\bpdf\b/.test(normalized)) return "pdf";
  if (
    /\b(pptx|ppt|powerpoint|presentacion|presentaciones|diapositivas|slides?)\b/.test(
      normalized,
    )
  ) {
    return "pptx";
  }
  if (
    /\b(xlsx|excel|spreadsheet|hoja de calculo|hoja de calculos|planilla)\b/.test(
      normalized,
    )
  ) {
    return "xlsx";
  }
  if (/\b(docx|word|documento|informe|reporte|report)\b/.test(normalized)) {
    return "docx";
  }
  return sharedIntent?.output_format ?? "docx";
}

function deriveTopic(message: string): string {
  const normalized = message
    .replace(
      /\b(crea|crear|genera|generar|haz|hacer|escribe|write|build|generate|create|make)\b/gi,
      " ",
    )
    .replace(
      /\b(word|docx|excel|xlsx|pdf|powerpoint|ppt|pptx|presentaci[oó]n|documento|informe|reporte|spreadsheet)\b/gi,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();

  return normalized.length > 0 ? normalized.slice(0, 160) : message.slice(0, 160);
}

function normalizePreferredAdapterName(
  preferredProvider: string | undefined,
): string | undefined {
  if (!preferredProvider) return undefined;
  const normalized = preferredProvider.trim().toLowerCase();
  if (normalized === "smart-router" || normalized === "auto" || normalized === "router") {
    return "smart-router";
  }
  if (
    normalized === "in-house-gpt3" ||
    normalized === "inhouse" ||
    normalized === "local"
  ) {
    return "in-house-gpt3";
  }
  return undefined;
}

function normalizeText(message: string): string {
  return String(message || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function detectKernelLanguage(message: string): string {
  const normalized = normalizeText(message);
  return /[¿¡]|\b(una|documento|informe|resumen|mercado|analisis|crea)\b/.test(normalized)
    ? "es"
    : "en";
}
