/**
 * Message Integrity and Checksum Validation
 * 
 * Ensures message content integrity through:
 * - MD5 hash generation for content
 * - Validation on sync
 * - Corruption detection
 */

import crypto from 'crypto';

/**
 * Generate MD5 hash of content for integrity verification
 */
export function generateContentHash(content: string): string {
    return crypto.createHash('md5').update(content).digest('hex');
}

/**
 * Validate message content against stored hash
 */
export function validateContentHash(content: string, expectedHash: string): boolean {
    const actualHash = generateContentHash(content);
    return actualHash === expectedHash;
}

/**
 * Message with integrity data
 */
export interface MessageWithIntegrity {
    id: string;
    content: string;
    contentHash: string;
    createdAt: number;
    version: number;
}

/**
 * Create message with integrity data
 */
export function createMessageWithIntegrity(
    id: string,
    content: string,
    version = 0
): MessageWithIntegrity {
    return {
        id,
        content,
        contentHash: generateContentHash(content),
        createdAt: Date.now(),
        version
    };
}

/**
 * Validate an array of messages and return validation results
 */
export function validateMessages(
    messages: Array<{ id: string; content: string; contentHash?: string }>
): Array<{ id: string; valid: boolean; hash: string }> {
    return messages.map(msg => {
        const currentHash = generateContentHash(msg.content);
        return {
            id: msg.id,
            valid: !msg.contentHash || msg.contentHash === currentHash,
            hash: currentHash
        };
    });
}

/**
 * Batch validation result
 */
export interface IntegrityCheckResult {
    totalMessages: number;
    validMessages: number;
    invalidMessages: number;
    corruptedIds: string[];
    integrityScore: number; // 0-100
}

/**
 * Check integrity of all messages in a conversation
 */
export function checkConversationIntegrity(
    messages: Array<{ id: string; content: string; contentHash?: string }>
): IntegrityCheckResult {
    const results = validateMessages(messages);
    const validCount = results.filter(r => r.valid).length;
    const invalidCount = results.filter(r => !r.valid).length;
    const corruptedIds = results.filter(r => !r.valid).map(r => r.id);

    return {
        totalMessages: messages.length,
        validMessages: validCount,
        invalidMessages: invalidCount,
        corruptedIds,
        integrityScore: messages.length > 0
            ? Math.round((validCount / messages.length) * 100)
            : 100
    };
}

export default {
    generateContentHash,
    validateContentHash,
    createMessageWithIntegrity,
    validateMessages,
    checkConversationIntegrity
};
