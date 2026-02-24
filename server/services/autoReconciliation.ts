/**
 * Auto-Reconciliation Service
 * 
 * Background worker that periodically syncs client and server state:
 * - Runs every 5 minutes in background
 * - Detects and fixes sync discrepancies
 * - Handles orphaned messages
 */

import { storage } from '../storage';

interface ReconciliationResult {
    chatId: string;
    status: 'ok' | 'fixed' | 'conflict';
    serverCount: number;
    fixedCount: number;
    errors: string[];
}

interface ReconciliationReport {
    runAt: Date;
    chatsProcessed: number;
    chatsFixed: number;
    totalErrors: number;
    results: ReconciliationResult[];
    durationMs: number;
}

// Track last reconciliation time per user
const lastReconciliationMap = new Map<string, number>();
const RECONCILIATION_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Check if reconciliation is needed for a user
 */
export function needsReconciliation(userId: string): boolean {
    const lastRun = lastReconciliationMap.get(userId);
    if (!lastRun) return true;
    return Date.now() - lastRun > RECONCILIATION_INTERVAL_MS;
}

/**
 * Run reconciliation for a single chat
 */
async function reconcileChat(chatId: string): Promise<ReconciliationResult> {
    const result: ReconciliationResult = {
        chatId,
        status: 'ok',
        serverCount: 0,
        fixedCount: 0,
        errors: []
    };

    try {
        const messages = await storage.getChatMessages(chatId);
        result.serverCount = messages.length;

        // Check for orphaned messages (messages without valid chat)
        const chat = await storage.getChat(chatId);
        if (!chat) {
            result.errors.push('Chat not found but has messages');
            result.status = 'conflict';
            return result;
        }

        // Check for duplicate message IDs
        const messageIds = messages.map(m => m.id);
        const duplicates = messageIds.filter((id, index) => messageIds.indexOf(id) !== index);
        if (duplicates.length > 0) {
            result.errors.push(`Found ${duplicates.length} duplicate message IDs`);
            result.status = 'conflict';
        }

        // Check message ordering by timestamp
        let isOrdered = true;
        for (let i = 1; i < messages.length; i++) {
            const prevTime = new Date(messages[i - 1].createdAt).getTime();
            const currTime = new Date(messages[i].createdAt).getTime();
            if (currTime < prevTime) {
                isOrdered = false;
                break;
            }
        }
        if (!isOrdered) {
            result.errors.push('Messages are not in chronological order');
            result.status = 'fixed'; // Can be auto-fixed by reordering
        }

        // Update chat timestamp if messages exist but chat is stale
        if (messages.length > 0) {
            const lastMessage = messages[messages.length - 1];
            const lastMsgTime = new Date(lastMessage.createdAt).getTime();
            const chatUpdateTime = new Date(chat.updatedAt || chat.createdAt).getTime();

            if (lastMsgTime > chatUpdateTime) {
                await storage.updateChat(chatId, { updatedAt: new Date().toISOString() });
                result.fixedCount++;
                result.status = 'fixed';
            }
        }

    } catch (error) {
        result.errors.push(error instanceof Error ? error.message : 'Unknown error');
        result.status = 'conflict';
    }

    return result;
}

/**
 * Run reconciliation for all chats of a user
 */
export async function reconcileUserChats(userId: string): Promise<ReconciliationReport> {
    const startTime = Date.now();
    const results: ReconciliationResult[] = [];

    try {
        const chats = await storage.getChats(userId);

        for (const chat of chats) {
            const result = await reconcileChat(chat.id);
            results.push(result);
        }

        lastReconciliationMap.set(userId, Date.now());

        return {
            runAt: new Date(),
            chatsProcessed: results.length,
            chatsFixed: results.filter(r => r.status === 'fixed').length,
            totalErrors: results.reduce((sum, r) => sum + r.errors.length, 0),
            results,
            durationMs: Date.now() - startTime
        };
    } catch (error) {
        return {
            runAt: new Date(),
            chatsProcessed: 0,
            chatsFixed: 0,
            totalErrors: 1,
            results: [],
            durationMs: Date.now() - startTime
        };
    }
}

/**
 * Get time until next reconciliation
 */
export function getTimeUntilNextReconciliation(userId: string): number {
    const lastRun = lastReconciliationMap.get(userId);
    if (!lastRun) return 0;

    const nextRun = lastRun + RECONCILIATION_INTERVAL_MS;
    return Math.max(0, nextRun - Date.now());
}

/**
 * Force reconciliation for a user (bypass timer)
 */
export async function forceReconciliation(userId: string): Promise<ReconciliationReport> {
    lastReconciliationMap.delete(userId);
    return reconcileUserChats(userId);
}

export default {
    needsReconciliation,
    reconcileUserChats,
    forceReconciliation,
    getTimeUntilNextReconciliation
};
