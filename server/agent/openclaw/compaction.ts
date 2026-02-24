import { GoogleGenAI } from "@google/genai";
import { estimateTokens } from "../../lib/largeDocumentProcessor";

export interface CompactionConfig {
  baseRatio: number;
  minRatio: number;
  safetyMargin: number;
  contextWindowSize: number;
  preserveRecentCount: number;
  modelId: string;
  maxConcurrentSummarizations: number;
}

const DEFAULT_CONFIG: CompactionConfig = {
  baseRatio: 0.4,
  minRatio: 0.15,
  safetyMargin: 1.2,
  contextWindowSize: 128_000,
  preserveRecentCount: 4,
  modelId: "gemini-2.0-flash",
  maxConcurrentSummarizations: 3,
};

export interface ConversationMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  timestamp?: number;
}

export interface CompactionResult {
  messages: ConversationMessage[];
  originalTokenCount: number;
  compactedTokenCount: number;
  compressionRatio: number;
  chunksCompacted: number;
  preservedCount: number;
  durationMs: number;
}

export interface CompactionChunk {
  messages: ConversationMessage[];
  tokenCount: number;
  shareRatio: number;
}

function countTokens(text: string): number {
  return estimateTokens(text);
}

function countMessagesTokens(msgs: ConversationMessage[]): number {
  return msgs.reduce((sum, m) => sum + countTokens(m.content || "") + 4, 0);
}

function effectiveLimit(config: CompactionConfig): number {
  return Math.floor(config.contextWindowSize / config.safetyMargin);
}

function needsCompaction(messages: ConversationMessage[], config: CompactionConfig): boolean {
  const totalTokens = countMessagesTokens(messages);
  const limit = effectiveLimit(config);
  return totalTokens > limit;
}

function splitByTokenShare(
  messages: ConversationMessage[],
  maxChunks: number,
  config: CompactionConfig,
): CompactionChunk[] {
  const totalTokens = countMessagesTokens(messages);
  if (totalTokens === 0) return [];

  const targetChunkTokens = Math.ceil(totalTokens / maxChunks);
  const chunks: CompactionChunk[] = [];
  let current: ConversationMessage[] = [];
  let currentTokens = 0;

  for (const msg of messages) {
    const msgTokens = countTokens(msg.content || "") + 4;
    if (currentTokens + msgTokens > targetChunkTokens && current.length > 0) {
      chunks.push({
        messages: current,
        tokenCount: currentTokens,
        shareRatio: currentTokens / totalTokens,
      });
      current = [];
      currentTokens = 0;
    }
    current.push(msg);
    currentTokens += msgTokens;
  }

  if (current.length > 0) {
    chunks.push({
      messages: current,
      tokenCount: currentTokens,
      shareRatio: currentTokens / totalTokens,
    });
  }

  return chunks;
}

async function summarizeChunk(
  chunk: CompactionChunk,
  targetRatio: number,
  config: CompactionConfig,
): Promise<string> {
  const targetTokens = Math.max(
    Math.floor(chunk.tokenCount * targetRatio),
    50,
  );

  const transcript = chunk.messages
    .map((m) => `[${m.role}]: ${m.content}`)
    .join("\n\n");

  const prompt = `You are a conversation compactor. Summarize the following conversation segment into approximately ${targetTokens} tokens.

RULES:
- Preserve ALL key decisions, action items, and TODOs
- Preserve any code snippets, file paths, or technical details that were agreed upon
- Preserve user preferences and constraints mentioned
- Use bullet points for clarity
- Prefix with [COMPACTED CONTEXT] so downstream agents know this is a summary
- Do NOT add information that wasn't in the original conversation
- Keep the summary in the same language as the original conversation

CONVERSATION SEGMENT:
${transcript}

COMPACTED SUMMARY:`;

  try {
    const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const response = await genAI.models.generateContent({
      model: config.modelId,
      contents: prompt,
      config: {
        maxOutputTokens: targetTokens * 2,
        temperature: 0.2,
      },
    });

    const text =
      typeof response.text === "string"
        ? response.text
        : (response as any).text?.() || "";

    return text || "[COMPACTED CONTEXT]\n(Summary generation returned empty)";
  } catch (err: any) {
    console.error("[Compaction] Summarization error:", err.message);
    const fallback = chunk.messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .slice(0, 3)
      .map((m) => `[${m.role}]: ${m.content.slice(0, 200)}`)
      .join("\n");
    return `[COMPACTED CONTEXT - fallback]\n${fallback}`;
  }
}

export async function compactConversation(
  messages: ConversationMessage[],
  overrides: Partial<CompactionConfig> = {},
): Promise<CompactionResult> {
  const startTime = Date.now();
  const config: CompactionConfig = { ...DEFAULT_CONFIG, ...overrides };

  const originalTokenCount = countMessagesTokens(messages);

  if (!needsCompaction(messages, config)) {
    return {
      messages,
      originalTokenCount,
      compactedTokenCount: originalTokenCount,
      compressionRatio: 1,
      chunksCompacted: 0,
      preservedCount: messages.length,
      durationMs: Date.now() - startTime,
    };
  }

  const systemMessages = messages.filter((m) => m.role === "system");
  const nonSystemMessages = messages.filter((m) => m.role !== "system");

  const preserveCount = Math.min(
    config.preserveRecentCount,
    nonSystemMessages.length,
  );
  const preserved = nonSystemMessages.slice(-preserveCount);
  const toCompact = nonSystemMessages.slice(0, -preserveCount || undefined);

  if (toCompact.length === 0) {
    return {
      messages,
      originalTokenCount,
      compactedTokenCount: originalTokenCount,
      compressionRatio: 1,
      chunksCompacted: 0,
      preservedCount: messages.length,
      durationMs: Date.now() - startTime,
    };
  }

  const limit = effectiveLimit(config);
  const systemTokens = countMessagesTokens(systemMessages);
  const preservedTokens = countMessagesTokens(preserved);
  const budgetForCompacted = Math.max(
    limit - systemTokens - preservedTokens,
    Math.floor(countMessagesTokens(toCompact) * config.minRatio),
  );
  const targetRatio = Math.max(
    Math.min(
      budgetForCompacted / countMessagesTokens(toCompact),
      config.baseRatio,
    ),
    config.minRatio,
  );

  const chunks = splitByTokenShare(
    toCompact,
    config.maxConcurrentSummarizations,
    config,
  );

  const summaries: string[] = [];
  for (let i = 0; i < chunks.length; i += config.maxConcurrentSummarizations) {
    const batch = chunks.slice(i, i + config.maxConcurrentSummarizations);
    const batchResults = await Promise.all(
      batch.map((chunk) => summarizeChunk(chunk, targetRatio, config)),
    );
    summaries.push(...batchResults);
  }

  const compactedContent = summaries.join("\n\n---\n\n");

  const compactedMessage: ConversationMessage = {
    role: "assistant",
    content: compactedContent,
    timestamp: Date.now(),
  };

  const resultMessages: ConversationMessage[] = [
    ...systemMessages,
    compactedMessage,
    ...preserved,
  ];

  const compactedTokenCount = countMessagesTokens(resultMessages);

  return {
    messages: resultMessages,
    originalTokenCount,
    compactedTokenCount,
    compressionRatio: compactedTokenCount / originalTokenCount,
    chunksCompacted: chunks.length,
    preservedCount: preserved.length + systemMessages.length,
    durationMs: Date.now() - startTime,
  };
}

export function guardContextWindow(
  messages: ConversationMessage[],
  overrides: Partial<CompactionConfig> = {},
): { safe: boolean; tokenCount: number; limit: number; overflowTokens: number } {
  const config: CompactionConfig = { ...DEFAULT_CONFIG, ...overrides };
  const tokenCount = countMessagesTokens(messages);
  const limit = effectiveLimit(config);
  return {
    safe: tokenCount <= limit,
    tokenCount,
    limit,
    overflowTokens: Math.max(0, tokenCount - limit),
  };
}

export { needsCompaction, countMessagesTokens, effectiveLimit, DEFAULT_CONFIG };
