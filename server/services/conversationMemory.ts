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
import { knowledgeGraph } from "./knowledgeGraph";

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
    relevantHistoryCount?: number;
    relevantCandidateWindow?: number;
    userId?: string;
}

export interface MemoryCompressionDiagnostics {
    compressionApplied: boolean;
    originalTokens: number;
    finalTokens: number;
    originalMessageCount: number;
    finalMessageCount: number;
    recentMessagesKept: number;
    relevantMessagesKept: number;
    summarizedMessages: number;
    summaryApplied: boolean;
}

export interface ConversationContextResult {
    messages: ChatMessage[];
    diagnostics: MemoryCompressionDiagnostics;
}

const DEFAULT_OPTIONS: Required<MemoryOptions> = {
    maxTokens: 8000,
    maxMessages: 100,
    preserveSystemPrompts: true,
    preserveRecentCount: 10,
    relevantHistoryCount: 4,
    relevantCandidateWindow: 40,
    userId: "",
};

const RELEVANCE_STOP_WORDS = new Set([
    "a", "al", "algo", "algun", "alguna", "alguno", "and", "ante", "are", "como",
    "con", "cual", "cuando", "de", "del", "desde", "donde", "el", "ella", "ellas",
    "ellos", "en", "entre", "era", "eramos", "es", "esa", "esas", "ese", "eso",
    "esos", "esta", "estaba", "estado", "estamos", "estan", "estar", "este", "esto",
    "estos", "fue", "fueron", "ha", "han", "hasta", "hay", "he", "i", "in", "is",
    "la", "las", "lo", "los", "me", "mi", "mis", "mucho", "muy", "no", "nos",
    "o", "of", "para", "pero", "por", "que", "se", "ser", "si", "sin", "sobre",
    "son", "su", "sus", "te", "the", "their", "them", "they", "this", "to", "tu",
    "tus", "un", "una", "uno", "was", "we", "were", "what", "when", "where", "which",
    "who", "will", "with", "y", "yo",
]);

// Approximate token count (4 chars ≈ 1 token)
function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
}

function estimateMessagesTokens(messages: ChatMessage[]): number {
    return messages.reduce((sum, m) => sum + estimateTokens(m.content) + 4, 0);
}

// Generate content hash for deduplication
function hashContent(content: string): string {
    const normalized = content.trim().toLowerCase().replace(/\s+/g, " ");
    return crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

function buildMessageFingerprint(message: ChatMessage): string {
    if (message.id) {
        return `id:${message.id}`;
    }

    return `${message.role}:${hashContent(message.content)}`;
}

function buildComparableHistoryKey(message: ChatMessage): string {
    return `${message.role}:${hashContent(message.content)}`;
}

function normalizeTextForRelevance(text: string): string {
    return text
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function tokenizeForRelevance(text: string): string[] {
    return normalizeTextForRelevance(text)
        .split(" ")
        .filter((token) => token.length >= 3 && !RELEVANCE_STOP_WORDS.has(token));
}

function computeLexicalRelevanceScore(
    queryTerms: Set<string>,
    queryNormalized: string,
    message: ChatMessage,
    index: number,
    total: number
): number {
    const messageTerms = tokenizeForRelevance(message.content);
    if (messageTerms.length === 0) {
        return 0;
    }

    let overlapCount = 0;
    const uniqueMessageTerms = new Set(messageTerms);
    for (const term of uniqueMessageTerms) {
        if (queryTerms.has(term)) {
            overlapCount += 1;
        }
    }

    const overlapRatio = overlapCount / Math.max(1, Math.min(queryTerms.size, 6));
    const recencyBoost = total > 1 ? ((index + 1) / total) * 0.25 : 0.25;
    const roleBoost = message.role === "user" ? 0.12 : 0.06;
    const exactPhraseBoost = queryNormalized.length >= 12 && normalizeTextForRelevance(message.content).includes(queryNormalized)
        ? 0.2
        : 0;

    return overlapCount * 1.25 + overlapRatio + recencyBoost + roleBoost + exactPhraseBoost;
}

function findConversationPairIndex(messages: ChatMessage[], index: number): number | null {
    if (index < 0 || index >= messages.length) {
        return null;
    }

    const current = messages[index];
    if (current.role === "user" && index + 1 < messages.length && messages[index + 1].role === "assistant") {
        return index + 1;
    }

    if (current.role === "assistant" && index > 0 && messages[index - 1].role === "user") {
        return index - 1;
    }

    return null;
}

function trimRecentMessagesToBudget(
    systemMessages: ChatMessage[],
    recentMessages: ChatMessage[],
    maxTokens: number
): ChatMessage[] {
    const kept = [...recentMessages];

    while (kept.length > 1 && estimateMessagesTokens([...systemMessages, ...kept]) > maxTokens) {
        kept.shift();
    }

    return kept;
}

function selectMessagesWithinBudget(
    baseMessages: ChatMessage[],
    candidates: ChatMessage[],
    maxTokens: number
): ChatMessage[] {
    const selected: ChatMessage[] = [];
    let currentTokens = estimateMessagesTokens(baseMessages);

    for (const candidate of candidates) {
        const candidateTokens = estimateMessagesTokens([candidate]);
        if (currentTokens + candidateTokens > maxTokens) {
            continue;
        }

        selected.push(candidate);
        currentTokens += candidateTokens;
    }

    return selected;
}

function createNoCompressionDiagnostics(messages: ChatMessage[]): MemoryCompressionDiagnostics {
    const tokens = estimateMessagesTokens(messages);
    return {
        compressionApplied: false,
        originalTokens: tokens,
        finalTokens: tokens,
        originalMessageCount: messages.length,
        finalMessageCount: messages.length,
        recentMessagesKept: messages.filter((message) => message.role !== "system").length,
        relevantMessagesKept: 0,
        summarizedMessages: 0,
        summaryApplied: false,
    };
}

// Merge messages chronologically, detecting duplicates
function mergeMessages(
    dbMessages: ChatMessage[],
    clientMessages: ChatMessage[]
): ChatMessage[] {
    const dbFingerprints = new Set(dbMessages.map(buildMessageFingerprint));
    const dbComparableKeys = new Set(dbMessages.map(buildComparableHistoryKey));

    // Start with DB messages
    const merged: ChatMessage[] = [...dbMessages];

    // Add client messages that aren't duplicates
    for (const clientMsg of clientMessages) {
        const fingerprint = buildMessageFingerprint(clientMsg);
        const comparableKey = buildComparableHistoryKey(clientMsg);

        // Skip if already in DB
        if (dbFingerprints.has(fingerprint) || dbComparableKeys.has(comparableKey)) {
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

// Summarize old messages to save tokens and build knowledge
async function summarizeMessages(messages: ChatMessage[]): Promise<string> {
    if (messages.length === 0) return "";

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

// Find relevant older messages using lightweight lexical relevance so
// compression preserves topic-specific turns without expensive embedding calls.
async function findRelevantHistory(
    queryMessage: string,
    historyMessages: ChatMessage[],
    limit: number = 3,
    candidateWindow: number = DEFAULT_OPTIONS.relevantCandidateWindow
): Promise<ChatMessage[]> {
    if (historyMessages.length === 0) return [];

    try {
        const queryTerms = new Set(tokenizeForRelevance(queryMessage));
        if (queryTerms.size === 0) {
            return [];
        }

        const queryNormalized = normalizeTextForRelevance(queryMessage);
        const windowSize = Math.max(limit, Math.min(candidateWindow, historyMessages.length));
        const windowStart = Math.max(0, historyMessages.length - windowSize);
        const candidateMessages = historyMessages.slice(windowStart);

        const scored = candidateMessages
            .map((msg, idx) => ({
                index: windowStart + idx,
                msg,
                score: computeLexicalRelevanceScore(queryTerms, queryNormalized, msg, idx, candidateMessages.length),
            }))
            .filter((entry) => entry.score > 0.5)
            .sort((a, b) => b.score - a.score);

        const selectedIndices = new Set<number>();
        for (const entry of scored) {
            if (selectedIndices.size >= limit) {
                break;
            }

            selectedIndices.add(entry.index);

            const pairIndex = findConversationPairIndex(historyMessages, entry.index);
            if (pairIndex !== null && selectedIndices.size < limit) {
                selectedIndices.add(pairIndex);
            }
        }

        return Array.from(selectedIndices)
            .sort((a, b) => a - b)
            .map((index) => historyMessages[index]);
    } catch (e) {
        console.warn("[Memory] Relevant history scoring failed", e);
        return [];
    }
}

// Enforce token budget by compressing old messages
async function enforceTokenBudget(
    messages: ChatMessage[],
    options: Required<MemoryOptions>
): Promise<ConversationContextResult> {
    const totalTokens = estimateMessagesTokens(messages);

    if (totalTokens <= options.maxTokens) {
        return {
            messages,
            diagnostics: createNoCompressionDiagnostics(messages),
        };
    }

    console.log(`[ConversationMemory] Token budget exceeded: ${totalTokens} > ${options.maxTokens}, compressing...`);

    // Separate system prompts and conversation
    const systemMessages = messages.filter(m => m.role === "system");
    const conversationMessages = messages.filter(m => m.role !== "system");

    // Preserve recent messages
    const recentCount = Math.min(options.preserveRecentCount, conversationMessages.length);
    const rawRecentMessages = recentCount > 0 ? conversationMessages.slice(-recentCount) : [];
    const recentMessages = trimRecentMessagesToBudget(
        options.preserveSystemPrompts ? systemMessages : [],
        rawRecentMessages,
        options.maxTokens
    );
    const oldMessages = recentCount > 0
        ? conversationMessages.slice(0, -recentCount)
        : [...conversationMessages];
    const latestUserMessage = [...recentMessages].reverse().find((msg) => msg.role === "user")
        || [...conversationMessages].reverse().find((msg) => msg.role === "user");
    const relevantHistory = latestUserMessage
        ? await findRelevantHistory(
            latestUserMessage.content,
            oldMessages,
            Math.min(options.relevantHistoryCount, oldMessages.length),
            options.relevantCandidateWindow
        )
        : [];
    const relevantFingerprints = new Set(relevantHistory.map(buildMessageFingerprint));
    const summarizedMessages = oldMessages.filter((message) => !relevantFingerprints.has(buildMessageFingerprint(message)));

    // If still too many tokens after keeping recent, summarize old
    const result: ChatMessage[] = [];

    if (options.preserveSystemPrompts && systemMessages.length > 0) {
        result.push(...systemMessages);
    }

    const reservedRecentTokens = estimateMessagesTokens(recentMessages);
    const maxTokensBeforeRecent = Math.max(options.maxTokens - reservedRecentTokens, 0);
    const selectedRelevantHistory = selectMessagesWithinBudget(result, relevantHistory, maxTokensBeforeRecent);
    let summaryApplied = false;
    let summarizedMessagesCount = 0;

    // Summarize old messages
    if (summarizedMessages.length > 0) {
        const summary = await summarizeMessages(summarizedMessages);
        if (summary) {
            const summaryMessage: ChatMessage = {
                role: "system",
                content: summary,
            };
            const selectedSummary = selectMessagesWithinBudget(
                [...result, ...selectedRelevantHistory],
                [summaryMessage],
                maxTokensBeforeRecent
            );
            result.push(...selectedSummary);
            summaryApplied = selectedSummary.length > 0;
            if (summaryApplied) {
                summarizedMessagesCount = summarizedMessages.length;
            }
        }
    }

    if (selectedRelevantHistory.length > 0) {
        result.push(...selectedRelevantHistory);
    }

    // Add recent messages
    result.push(...recentMessages);

    const newTokens = estimateMessagesTokens(result);
    console.log(
        `[ConversationMemory] Compressed: ${totalTokens} -> ${newTokens} tokens (${messages.length} -> ${result.length} messages, relevant=${selectedRelevantHistory.length}, recent=${recentMessages.length})`
    );

    return {
        messages: result,
        diagnostics: {
            compressionApplied: true,
            originalTokens: totalTokens,
            finalTokens: newTokens,
            originalMessageCount: messages.length,
            finalMessageCount: result.length,
            recentMessagesKept: recentMessages.length,
            relevantMessagesKept: selectedRelevantHistory.length,
            summarizedMessages: summarizedMessagesCount,
            summaryApplied,
        },
    };
}

/**
 * Main function: Get full conversation context
 * 
 * Fetches server history, merges with client messages,
 * deduplicates, and enforces token budget
 */
export async function getConversationContextWithDiagnostics(
    chatId: string | undefined,
    clientMessages: ChatMessage[],
    options: MemoryOptions = {}
): Promise<ConversationContextResult> {
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

export async function getConversationContext(
    chatId: string | undefined,
    clientMessages: ChatMessage[],
    options: MemoryOptions = {}
): Promise<ChatMessage[]> {
    const result = await getConversationContextWithDiagnostics(chatId, clientMessages, options);
    return result.messages;
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

export async function augmentWithHistoryWithDiagnostics(
    chatId: string | undefined,
    clientMessages: ChatMessage[],
    maxTokens = 8000
): Promise<ConversationContextResult> {
    return getConversationContextWithDiagnostics(chatId, clientMessages, { maxTokens });
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

        const dbHashes = new Set(dbMessages.map((m) => buildComparableHistoryKey({
            role: m.role as ChatMessage["role"],
            content: m.content,
            id: m.id,
        })));
        const clientHashes = new Set(
            clientMessages
                .filter(m => m.role !== "system")
                .map((m) => buildComparableHistoryKey(m))
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
    getConversationContextWithDiagnostics,
    getConversationContext,
    augmentWithHistoryWithDiagnostics,
    augmentWithHistory,
    getRecentMessages,
    validateClientHistory,
    estimateTokens,
    estimateMessagesTokens,
};

export default conversationMemoryManager;
