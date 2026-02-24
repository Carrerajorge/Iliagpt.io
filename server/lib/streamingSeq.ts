/**
 * Streaming Sequence Service - ILIAGPT PRO 3.0
 * 
 * Manages per-conversation lastSeq tracking for streaming reconnection.
 * Uses MemoryCache (Redis-backed with local fallback) for persistence.
 */

import { memoryCache } from "./memoryCache";

const SEQ_PREFIX = "stream:seq:";
const SEQ_TTL = 3600 * 24; // 24 hours in seconds

interface StreamingProgress {
    chatId: string;
    lastSeq: number;
    content: string;
    status: "streaming" | "completed" | "failed";
    updatedAt: number;
}

/**
 * Get the last processed sequence number for a chat
 */
export async function getLastSeq(chatId: string): Promise<number> {
    try {
        const key = SEQ_PREFIX + chatId;
        const data = await memoryCache.get<StreamingProgress>(key);

        if (!data) return 0;

        return data.lastSeq;
    } catch (error) {
        console.error("[StreamingSeq] Error getting lastSeq:", error);
        return 0;
    }
}

/**
 * Save the current streaming progress for a chat
 */
export async function saveStreamingProgress(
    chatId: string,
    lastSeq: number,
    content: string,
    status: "streaming" | "completed" | "failed"
): Promise<void> {
    try {
        const key = SEQ_PREFIX + chatId;
        const progress: StreamingProgress = {
            chatId,
            lastSeq,
            content,
            status,
            updatedAt: Date.now(),
        };

        await memoryCache.set(key, progress, { ttl: SEQ_TTL * 1000 });
        console.debug(`[StreamingSeq] Saved progress for ${chatId}: seq=${lastSeq}`);
    } catch (error) {
        console.error("[StreamingSeq] Error saving progress:", error);
    }
}

/**
 * Get the full streaming progress for a chat (for resume)
 */
export async function getStreamingProgress(chatId: string): Promise<StreamingProgress | null> {
    try {
        const key = SEQ_PREFIX + chatId;
        return await memoryCache.get<StreamingProgress>(key);
    } catch (error) {
        console.error("[StreamingSeq] Error getting progress:", error);
        return null;
    }
}

/**
 * Clear streaming progress when complete
 */
export async function clearStreamingProgress(chatId: string): Promise<void> {
    try {
        const key = SEQ_PREFIX + chatId;
        await memoryCache.delete(key);
        console.debug(`[StreamingSeq] Cleared progress for ${chatId}`);
    } catch (error) {
        console.error("[StreamingSeq] Error clearing progress:", error);
    }
}

/**
 * Get all active streaming sessions (for debugging/monitoring)
 */
export async function getActiveStreamingSessions(): Promise<string[]> {
    try {
        // Note: memoryCache doesn't expose keys() - return empty for now
        // In production, scan Redis directly or maintain a Set of active sessions
        return [];
    } catch (error) {
        console.error("[StreamingSeq] Error getting active sessions:", error);
        return [];
    }
}
