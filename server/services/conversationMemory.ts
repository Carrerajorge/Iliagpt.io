/**
 * Conversation Memory Manager
 * 
 * Solves context loss by:
 * - Fetching full conversation history from database
 * - Merging with client-provided messages
 * - Deduplicating to prevent repetition
 * - Enforcing token budget with smart compression
 */

import { storage } from "../storage";
import * as crypto from "crypto";

export interface ChatMessage {
    role: "user" | "assistant" | "system";
    content: string;
    id?: string;
    createdAt?: Date;
}

export interface MemoryOptions {
    maxTokens?: number;
    maxMessages?: number;
    preserveSystemPrompts?: boolean;
    preserveRecentCount?: number;
    userId?: string;
}

const DEFAULT_OPTIONS: Required<MemoryOptions> = {
    maxTokens: 8000,
    maxMessages: 100,
    preserveSystemPrompts: true,
    preserveRecentCount: 10,
    userId: "",
};

// Approximate token count (4 chars ≈ 1 token)
function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
}

function estimateMessagesTokens(messages: ChatMessage[]): number {
    return messages.reduce((sum, m) => sum + estimateTokens(m.content) + 4, 0);
}

// Generate content hash for deduplication
function hashContent(content: string): string {
    return crypto.createHash("md5").update(content.trim().toLowerCase()).digest("hex").slice(0, 12);
}

// Merge messages chronologically, detecting duplicates
function mergeMessages(
    dbMessages: ChatMessage[],
    clientMessages: ChatMessage[]
): ChatMessage[] {
    // Create map of DB messages by content hash
    const dbContentHashes = new Map<string, ChatMessage>();
    for (const msg of dbMessages) {
        const hash = hashContent(msg.content);
        dbContentHashes.set(hash, msg);
    }

    // Start with DB messages
    const merged: ChatMessage[] = [...dbMessages];

    // Add client messages that aren't duplicates
    for (const clientMsg of clientMessages) {
        const hash = hashContent(clientMsg.content);

        // Skip if already in DB
        if (dbContentHashes.has(hash)) {
            continue;
        }

        // Skip system prompts from client (server controls these)
        if (clientMsg.role === "system") {
            continue;
        }

        merged.push(clientMsg);
    }

    return merged;
}

// Deduplicate consecutive identical messages
function deduplicateConsecutive(messages: ChatMessage[]): ChatMessage[] {
    if (messages.length === 0) return [];

    const result: ChatMessage[] = [messages[0]];

    for (let i = 1; i < messages.length; i++) {
        const prev = result[result.length - 1];
        const curr = messages[i];

        // Skip if same role and very similar content
        if (prev.role === curr.role) {
            const prevHash = hashContent(prev.content);
            const currHash = hashContent(curr.content);
            if (prevHash === currHash) {
                continue;
            }
        }

        result.push(curr);
    }

    return result;
}

import { getEmbedding, cosineSimilarity } from "./embeddings";
import { knowledgeGraph } from "./knowledgeGraph";

// Summarize old messages to save tokens and build knowledge
async function summarizeMessages(messages: ChatMessage[]): Promise<string> {
    if (messages.length === 0) return "";

    const topics = new Set<string>();

    // Ingest into knowledge graph
    for (const msg of messages) {
        if (msg.role === "user" || msg.role === "assistant") {
            // Async ingestion to not block too much, or await? Await for consistency.
            // Feature #2: Grafo de Conocimiento Dinámico
            // Improvement #6: Async Ingestion (Fire & Forget)
            knowledgeGraph.ingest(msg.content)
                .catch(e => console.warn("[Memory] KG Ingest failed", e));
        }
    }

    // Use refined KG summary if available
    const kgSummary = knowledgeGraph.getSnapshotSummary();

    return `[Resumen de ${messages.length} mensajes anteriores. ${kgSummary}]`;
}

// Find relevant older messages using vector similarity
// Feature #1: Unificación de Memoria Vectorial
async function findRelevantHistory(
    queryMessage: string,
    historyMessages: ChatMessage[],
    limit: number = 3
): Promise<ChatMessage[]> {
    if (historyMessages.length === 0) return [];

    try {
        const queryEmbedding = await getEmbedding(queryMessage);

        // We need embeddings for history. In a real DB we'd query vector index.
        // Here we'll do it in-memory but only for a subset to avoid latency spike.
        // Or assume we only check the last 50 messages that are being dropped?

        const candidateMessages = historyMessages.map(async (msg) => {
            const embedding = await getEmbedding(msg.content);
            return {
                msg,
                score: cosineSimilarity(queryEmbedding, embedding)
            };
        });

        const scored = await Promise.all(candidateMessages);
        scored.sort((a, b) => b.score - a.score);

        return scored.slice(0, limit).map(s => s.msg);
    } catch (e) {
        console.warn("[Memory] Vector search failed", e);
        return [];
    }
}

// Enforce token budget by compressing old messages
async function enforceTokenBudget(
    messages: ChatMessage[],
    options: Required<MemoryOptions>
): Promise<ChatMessage[]> {
    const totalTokens = estimateMessagesTokens(messages);

    if (totalTokens <= options.maxTokens) {
        return messages;
    }

    console.log(`[ConversationMemory] Token budget exceeded: ${totalTokens} > ${options.maxTokens}, compressing...`);

    // Separate system prompts and conversation
    const systemMessages = messages.filter(m => m.role === "system");
    const conversationMessages = messages.filter(m => m.role !== "system");

    // Preserve recent messages
    const recentCount = Math.min(options.preserveRecentCount, conversationMessages.length);
    const recentMessages = conversationMessages.slice(-recentCount);
    const oldMessages = conversationMessages.slice(0, -recentCount);

    // If still too many tokens after keeping recent, summarize old
    let result: ChatMessage[] = [];

    if (options.preserveSystemPrompts && systemMessages.length > 0) {
        result.push(...systemMessages);
    }

    // Summarize old messages
    if (oldMessages.length > 0) {
        const summary = await summarizeMessages(oldMessages);
        if (summary) {
            result.push({
                role: "system",
                content: summary,
            });
        }
    }

    // Add recent messages
    result.push(...recentMessages);

    const newTokens = estimateMessagesTokens(result);
    console.log(`[ConversationMemory] Compressed: ${totalTokens} -> ${newTokens} tokens (${messages.length} -> ${result.length} messages)`);

    return result;
}

/**
 * Main function: Get full conversation context
 * 
 * Fetches server history, merges with client messages,
 * deduplicates, and enforces token budget
 */
export async function getConversationContext(
    chatId: string | undefined,
    clientMessages: ChatMessage[],
    options: MemoryOptions = {}
): Promise<ChatMessage[]> {
    const opts = { ...DEFAULT_OPTIONS, ...options };

    // If no chatId, just use client messages
    if (!chatId) {
        console.log(`[ConversationMemory] No chatId, using client messages only (${clientMessages.length})`);
        return enforceTokenBudget(clientMessages, opts);
    }

    try {
        // Fetch server-side history optimized
        const dbMessagesRaw = await storage.getChatMessages(chatId, {
            limit: opts.maxMessages,
            orderBy: "desc"
        });
        // Since we fetched descending (newest first), reverse to restore chronological order
        const limitedMessages = dbMessagesRaw.reverse();

        // Convert to our format
        const dbMessages: ChatMessage[] = limitedMessages.map(m => ({
            role: m.role as ChatMessage["role"],
            content: m.content,
            id: m.id,
            createdAt: m.createdAt,
        }));

        console.log(`[ConversationMemory] Fetched ${dbMessages.length} messages from DB for chat ${chatId}`);

        // Merge with client messages
        const merged = mergeMessages(dbMessages, clientMessages);
        console.log(`[ConversationMemory] Merged: ${dbMessages.length} DB + ${clientMessages.length} client = ${merged.length} total`);

        // Deduplicate consecutive
        const deduped = deduplicateConsecutive(merged);
        if (deduped.length !== merged.length) {
            console.log(`[ConversationMemory] Deduplicated: ${merged.length} -> ${deduped.length}`);
        }

        // Enforce token budget
        return enforceTokenBudget(deduped, opts);

    } catch (error) {
        // Avoid externally-controlled format string: do not interpolate user-controlled values
        // into the first console argument (console uses util.format semantics).
        console.error("[ConversationMemory] Error fetching history", { chatId, error });
        // Fallback to client messages only
        return enforceTokenBudget(clientMessages, opts);
    }
}

/**
 * Augment client messages with server history
 * Simpler API for existing code integration
 */
export async function augmentWithHistory(
    chatId: string | undefined,
    clientMessages: ChatMessage[],
    maxTokens = 8000
): Promise<ChatMessage[]> {
    return getConversationContext(chatId, clientMessages, { maxTokens });
}

/**
 * Get last N messages for a conversation
 */
export async function getRecentMessages(
    chatId: string,
    count = 10
): Promise<ChatMessage[]> {
    try {
        const messages = await storage.getChatMessages(chatId, {
            limit: count,
            orderBy: "desc"
        });
        const limitedMessages = messages.reverse();
        return limitedMessages.map(m => ({
            role: m.role as ChatMessage["role"],
            content: m.content,
            id: m.id,
            createdAt: m.createdAt,
        }));
    } catch (error) {
        console.error(`[ConversationMemory] Error fetching recent messages:`, error);
        return [];
    }
}

/**
 * Check if client history matches server
 */
export async function validateClientHistory(
    chatId: string,
    clientMessages: ChatMessage[]
): Promise<{
    valid: boolean;
    missingFromClient: number;
    extraInClient: number;
}> {
    try {
        const dbMessages = await storage.getChatMessages(chatId);

        const dbHashes = new Set(dbMessages.map(m => hashContent(m.content)));
        const clientHashes = new Set(
            clientMessages.filter(m => m.role !== "system").map(m => hashContent(m.content))
        );

        let missingFromClient = 0;
        const dbHashArray = Array.from(dbHashes);
        for (const hash of dbHashArray) {
            if (!clientHashes.has(hash)) missingFromClient++;
        }

        let extraInClient = 0;
        const clientHashArray = Array.from(clientHashes);
        for (const hash of clientHashArray) {
            if (!dbHashes.has(hash)) extraInClient++;
        }

        return {
            valid: missingFromClient === 0 && extraInClient <= 1, // Allow 1 new message
            missingFromClient,
            extraInClient,
        };
    } catch {
        return { valid: true, missingFromClient: 0, extraInClient: 0 };
    }
}

export const conversationMemoryManager = {
    getConversationContext,
    augmentWithHistory,
    getRecentMessages,
    validateClientHistory,
    estimateTokens,
    estimateMessagesTokens,
};

export default conversationMemoryManager;
