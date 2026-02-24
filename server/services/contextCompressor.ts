/**
 * Context Window Management Service
 * 
 * Features:
 * - Automatic summarization when context exceeds threshold
 * - Semantic deduplication of repeated information
 * - Key entity preservation
 * - Token counting and budget management
 */

import crypto from "crypto";

// Approximate tokens per character (varies by language)
const CHARS_PER_TOKEN = 4;

// Model context limits (in tokens)
export const MODEL_CONTEXT_LIMITS: Record<string, number> = {
    "gpt-4": 8192,
    "gpt-4-turbo": 128000,
    "gpt-4o": 128000,
    "gpt-3.5-turbo": 16384,
    "claude-3-opus": 200000,
    "claude-3-sonnet": 200000,
    "claude-3-haiku": 200000,
    "grok-3": 131072,
    "grok-3-fast": 131072,
};

export interface Message {
    role: "system" | "user" | "assistant";
    content: string;
    timestamp?: number;
    importance?: number; // 0-1 scale
}

export interface CompressionResult {
    messages: Message[];
    originalTokens: number;
    compressedTokens: number;
    compressionRatio: number;
    summarizedCount: number;
    droppedCount: number;
}

export interface CompressionConfig {
    model: string;
    thresholdPercent: number;      // Trigger compression at this % of limit
    targetPercent: number;         // Compress down to this % of limit
    preserveRecentCount: number;   // Always keep N most recent messages
    preserveSystemPrompt: boolean; // Never compress system prompts
    minImportance: number;         // Drop messages below this importance
}

const DEFAULT_CONFIG: CompressionConfig = {
    model: "gpt-4-turbo",
    thresholdPercent: 0.8,
    targetPercent: 0.6,
    preserveRecentCount: 5,
    preserveSystemPrompt: true,
    minImportance: 0.2,
};

// Estimate token count for text
export function estimateTokens(text: string): number {
    return Math.ceil(text.length / CHARS_PER_TOKEN);
}

// Estimate tokens for a message array
export function estimateMessagesTokens(messages: Message[]): number {
    return messages.reduce((sum, msg) => {
        // Add overhead for role and formatting
        const overhead = 4; // ~4 tokens per message for formatting
        return sum + estimateTokens(msg.content) + overhead;
    }, 0);
}

// Extract key entities from text
function extractKeyEntities(text: string): string[] {
    const entities: Set<string> = new Set();

    // Extract quoted strings
    const quotes = text.match(/"[^"]+"/g) || [];
    quotes.forEach(q => entities.add(q.replace(/"/g, "")));

    // Extract capitalized words (likely proper nouns)
    const proper = text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g) || [];
    proper.forEach(p => entities.add(p));

    // Extract URLs
    const urls = text.match(/https?:\/\/[^\s]+/g) || [];
    urls.forEach(u => entities.add(u));

    // Extract numbers with context
    const numbers = text.match(/\d+(?:\.\d+)?(?:\s*(?:articles?|papers?|results?|items?|%|percent))?/gi) || [];
    numbers.forEach(n => entities.add(n));

    return Array.from(entities);
}

// Calculate semantic similarity (simplified)
function calculateSimilarity(text1: string, text2: string): number {
    const words1 = new Set(text1.toLowerCase().split(/\s+/));
    const words2 = new Set(text2.toLowerCase().split(/\s+/));

    const intersection = new Set([...words1].filter(x => words2.has(x)));
    const union = new Set([...words1, ...words2]);

    return union.size > 0 ? intersection.size / union.size : 0;
}

// Summarize a group of messages (simplified - would ideally use LLM)
function summarizeMessages(messages: Message[]): Message {
    const combined = messages.map(m => m.content).join("\n\n");
    const entities = extractKeyEntities(combined);

    // Create a summary maintaining key points
    const summary = [
        `[Summary of ${messages.length} messages]`,
        `Key topics: ${entities.slice(0, 10).join(", ")}`,
        `Time range: ${new Date(messages[0].timestamp || 0).toISOString()} to ${new Date(messages[messages.length - 1].timestamp || 0).toISOString()}`,
    ].join("\n");

    return {
        role: "assistant",
        content: summary,
        timestamp: messages[messages.length - 1].timestamp,
        importance: 0.5,
    };
}

// Remove duplicate or highly similar messages
function deduplicateMessages(messages: Message[], threshold = 0.8): Message[] {
    const result: Message[] = [];
    const seen: string[] = [];

    for (const msg of messages) {
        const isDuplicate = seen.some(prev =>
            calculateSimilarity(prev, msg.content) >= threshold
        );

        if (!isDuplicate) {
            result.push(msg);
            seen.push(msg.content);
        }
    }

    return result;
}

// Main compression function
export function compressContext(
    messages: Message[],
    config: Partial<CompressionConfig> = {}
): CompressionResult {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    const contextLimit = MODEL_CONTEXT_LIMITS[cfg.model] || 8192;
    const thresholdTokens = contextLimit * cfg.thresholdPercent;
    const targetTokens = contextLimit * cfg.targetPercent;

    const originalTokens = estimateMessagesTokens(messages);

    // Check if compression needed
    if (originalTokens <= thresholdTokens) {
        return {
            messages,
            originalTokens,
            compressedTokens: originalTokens,
            compressionRatio: 1,
            summarizedCount: 0,
            droppedCount: 0,
        };
    }

    console.log(`[ContextCompressor] Compressing ${originalTokens} tokens (limit: ${contextLimit})`);

    let result = [...messages];
    let summarizedCount = 0;
    let droppedCount = 0;

    // Step 1: Separate system prompts and recent messages
    const systemMessages = cfg.preserveSystemPrompt
        ? result.filter(m => m.role === "system")
        : [];
    const recentMessages = result.slice(-cfg.preserveRecentCount);
    const middleMessages = result.filter(
        m => !systemMessages.includes(m) && !recentMessages.includes(m)
    );

    // Step 2: Deduplicate middle messages
    const dedupedMiddle = deduplicateMessages(middleMessages);
    droppedCount += middleMessages.length - dedupedMiddle.length;

    // Step 3: Drop low-importance messages
    const importantMiddle = dedupedMiddle.filter(
        m => (m.importance ?? 0.5) >= cfg.minImportance
    );
    droppedCount += dedupedMiddle.length - importantMiddle.length;

    // Step 4: Check if we're under target
    let current = [...systemMessages, ...importantMiddle, ...recentMessages];
    let currentTokens = estimateMessagesTokens(current);

    if (currentTokens <= targetTokens) {
        return {
            messages: current,
            originalTokens,
            compressedTokens: currentTokens,
            compressionRatio: originalTokens / currentTokens,
            summarizedCount,
            droppedCount,
        };
    }

    // Step 5: Summarize older messages in batches
    const batchSize = 5;
    const summarized: Message[] = [];

    for (let i = 0; i < importantMiddle.length; i += batchSize) {
        const batch = importantMiddle.slice(i, i + batchSize);
        if (batch.length > 1) {
            summarized.push(summarizeMessages(batch));
            summarizedCount += batch.length;
        } else {
            summarized.push(...batch);
        }
    }

    current = [...systemMessages, ...summarized, ...recentMessages];
    currentTokens = estimateMessagesTokens(current);

    // Step 6: If still over, aggressively drop summarized messages
    while (currentTokens > targetTokens && summarized.length > 2) {
        summarized.shift();
        droppedCount++;
        current = [...systemMessages, ...summarized, ...recentMessages];
        currentTokens = estimateMessagesTokens(current);
    }

    console.log(`[ContextCompressor] Compressed to ${currentTokens} tokens (${((currentTokens / originalTokens) * 100).toFixed(1)}%)`);

    return {
        messages: current,
        originalTokens,
        compressedTokens: currentTokens,
        compressionRatio: originalTokens / currentTokens,
        summarizedCount,
        droppedCount,
    };
}

// Check if context needs compression
export function needsCompression(
    messages: Message[],
    model = "gpt-4-turbo",
    thresholdPercent = 0.8
): boolean {
    const contextLimit = MODEL_CONTEXT_LIMITS[model] || 8192;
    const currentTokens = estimateMessagesTokens(messages);
    return currentTokens > contextLimit * thresholdPercent;
}

// Get remaining token budget
export function getRemainingBudget(
    messages: Message[],
    model = "gpt-4-turbo"
): { used: number; remaining: number; limit: number; percentUsed: number } {
    const limit = MODEL_CONTEXT_LIMITS[model] || 8192;
    const used = estimateMessagesTokens(messages);
    const remaining = Math.max(0, limit - used);

    return {
        used,
        remaining,
        limit,
        percentUsed: (used / limit) * 100,
    };
}

export default {
    compressContext,
    needsCompression,
    getRemainingBudget,
    estimateTokens,
    estimateMessagesTokens,
    MODEL_CONTEXT_LIMITS,
};
