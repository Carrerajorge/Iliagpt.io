/**
 * Semantic Message Compressor
 * 
 * Uses LLM to intelligently compress older messages while preserving key information.
 * Maintains topic continuity and fact retention across compression boundaries.
 */

import { llmGateway } from "../lib/llmGateway";
import type { ChatMessage } from "../services/conversationMemory";

export interface CompressionConfig {
    /** Tokens to target for compressed output */
    targetTokens: number;

    /** Minimum messages before compression kicks in */
    minMessagesForCompression: number;

    /** Number of recent messages to always preserve uncompressed */
    preserveRecentCount: number;

    /** Model to use for compression */
    model: string;

    /** Whether to extract key facts separately */
    extractFacts: boolean;
}

export interface CompressionResult {
    /** Compressed messages array */
    messages: ChatMessage[];

    /** Extracted key facts */
    facts: ExtractedFact[];

    /** Original token count */
    originalTokens: number;

    /** Compressed token count */
    compressedTokens: number;

    /** Compression ratio achieved */
    ratio: number;

    /** Number of messages compressed into summary */
    messagesCompressed: number;
}

export interface ExtractedFact {
    type: "name" | "preference" | "task" | "decision" | "context";
    key: string;
    value: string;
    importance: number; // 0-1
    messageIndex: number;
}

const DEFAULT_CONFIG: CompressionConfig = {
    targetTokens: 4000,
    minMessagesForCompression: 15,
    preserveRecentCount: 8,
    model: "grok-4-1-fast-non-reasoning",
    extractFacts: true
};

/**
 * Estimate token count (4 chars ≈ 1 token)
 */
function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
}

function estimateMessagesTokens(messages: ChatMessage[]): number {
    return messages.reduce((sum, m) => sum + estimateTokens(m.content) + 4, 0);
}

/**
 * Extract key facts from messages using pattern matching
 */
function extractFactsFromMessages(messages: ChatMessage[]): ExtractedFact[] {
    const facts: ExtractedFact[] = [];

    for (let i = 0; i < messages.length; i++) {
        const content = messages[i].content;
        const role = messages[i].role;

        // User name extraction
        const nameMatch = content.match(/(?:me llamo|my name is|soy|i'm called)\s+(\w+)/i);
        if (nameMatch) {
            facts.push({
                type: "name",
                key: "user_name",
                value: nameMatch[1],
                importance: 1.0,
                messageIndex: i
            });
        }

        // Preference extraction
        const prefMatch = content.match(/(?:prefiero|i prefer|me gusta|i like|quiero que)\s+(.+?)(?:\.|,|$)/i);
        if (prefMatch) {
            facts.push({
                type: "preference",
                key: `preference_${i}`,
                value: prefMatch[1].trim().slice(0, 100),
                importance: 0.8,
                messageIndex: i
            });
        }

        // Task/request extraction
        const taskMatch = content.match(/(?:necesito|i need|quiero|i want|hazme|make me|crea|create)\s+(.+?)(?:\.|,|$)/i);
        if (taskMatch && role === "user") {
            facts.push({
                type: "task",
                key: `task_${i}`,
                value: taskMatch[1].trim().slice(0, 100),
                importance: 0.9,
                messageIndex: i
            });
        }

        // Decision extraction (from assistant)
        const decisionMatch = content.match(/(?:decidí|i decided|voy a|i will|he elegido|i chose)\s+(.+?)(?:\.|,|$)/i);
        if (decisionMatch && role === "assistant") {
            facts.push({
                type: "decision",
                key: `decision_${i}`,
                value: decisionMatch[1].trim().slice(0, 100),
                importance: 0.7,
                messageIndex: i
            });
        }
    }

    return facts;
}

/**
 * Generate LLM-based summary of old messages
 */
async function generateSummary(
    messages: ChatMessage[],
    config: CompressionConfig
): Promise<string> {
    if (messages.length === 0) return "";

    const conversationText = messages
        .map(m => `[${m.role.toUpperCase()}]: ${m.content}`)
        .join("\n");

    const systemPrompt = `Eres un experto en resumir conversaciones. Tu tarea es condensar la siguiente conversación en un resumen muy conciso que preserve:
1. El nombre del usuario (si se menciona)
2. El tema principal de la conversación
3. Cualquier preferencia o decisión importante
4. El contexto necesario para continuar la conversación

El resumen debe ser en español y en tercera persona. Máximo 150 palabras.`;

    const userPrompt = `Resume esta conversación preservando los hechos clave:\n\n${conversationText}`;

    try {
        const response = await llmGateway.chat([
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
        ], {
            model: config.model,
            temperature: 0.3,
            timeout: 10000
        });

        return response.content;
    } catch (error) {
        console.error("[SemanticCompressor] LLM summarization failed:", error);
        // Fallback to simple extraction
        return generateFallbackSummary(messages);
    }
}

/**
 * Fallback summary without LLM
 */
function generateFallbackSummary(messages: ChatMessage[]): string {
    const userMessages = messages.filter(m => m.role === "user");
    const topics = new Set<string>();

    for (const msg of userMessages.slice(0, 5)) {
        const words = msg.content.toLowerCase().split(/\s+/);
        const meaningfulWords = words.filter(w => w.length > 5).slice(0, 3);
        meaningfulWords.forEach(w => topics.add(w));
    }

    const topicsStr = Array.from(topics).slice(0, 5).join(", ");
    return `[Resumen de ${messages.length} mensajes] Temas: ${topicsStr || "conversación general"}.`;
}

/**
 * Main compression function
 */
export async function compressMessages(
    messages: ChatMessage[],
    config: Partial<CompressionConfig> = {}
): Promise<CompressionResult> {
    const opts = { ...DEFAULT_CONFIG, ...config };
    const originalTokens = estimateMessagesTokens(messages);

    // If under threshold, no compression needed
    if (messages.length < opts.minMessagesForCompression || originalTokens <= opts.targetTokens) {
        return {
            messages,
            facts: opts.extractFacts ? extractFactsFromMessages(messages) : [],
            originalTokens,
            compressedTokens: originalTokens,
            ratio: 1.0,
            messagesCompressed: 0
        };
    }

    console.log(`[SemanticCompressor] Compressing ${messages.length} messages (${originalTokens} tokens)`);

    // Split: system prompts | old messages to compress | recent messages to preserve
    const systemMessages = messages.filter(m => m.role === "system");
    const conversationMessages = messages.filter(m => m.role !== "system");

    const recentCount = Math.min(opts.preserveRecentCount, conversationMessages.length);
    const recentMessages = conversationMessages.slice(-recentCount);
    const oldMessages = conversationMessages.slice(0, -recentCount);

    // Extract facts before compression
    const facts = opts.extractFacts ? extractFactsFromMessages(messages) : [];

    // Generate summary of old messages
    const summary = await generateSummary(oldMessages, opts);

    // Build result
    const result: ChatMessage[] = [];

    // Add system messages first
    result.push(...systemMessages);

    // Add summary as context message
    if (summary && oldMessages.length > 0) {
        result.push({
            role: "system",
            content: `[Contexto de conversación anterior - ${oldMessages.length} mensajes resumidos]\n${summary}`
        });
    }

    // Add extracted high-importance facts
    const highImportanceFacts = facts.filter(f => f.importance >= 0.8);
    if (highImportanceFacts.length > 0) {
        const factsContent = highImportanceFacts
            .map(f => `• ${f.type}: ${f.value}`)
            .join("\n");
        result.push({
            role: "system",
            content: `[Hechos clave extraídos]\n${factsContent}`
        });
    }

    // Add recent messages
    result.push(...recentMessages);

    const compressedTokens = estimateMessagesTokens(result);
    const ratio = originalTokens / compressedTokens;

    console.log(`[SemanticCompressor] Compressed: ${originalTokens} -> ${compressedTokens} tokens (${ratio.toFixed(1)}x)`);

    return {
        messages: result,
        facts,
        originalTokens,
        compressedTokens,
        ratio,
        messagesCompressed: oldMessages.length
    };
}

/**
 * Check if messages should be compressed
 */
export function shouldCompress(messages: ChatMessage[], targetTokens = 8000): boolean {
    const tokens = estimateMessagesTokens(messages);
    return tokens > targetTokens || messages.length > 20;
}

export const semanticCompressor = {
    compressMessages,
    shouldCompress,
    extractFactsFromMessages,
    estimateTokens,
    estimateMessagesTokens
};

export default semanticCompressor;
