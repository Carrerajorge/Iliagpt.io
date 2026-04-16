/**
 * Persistent User Memory Service
 * Long-term memory storage for user preferences and facts
 */

import { db } from '../db';
import { sql } from 'drizzle-orm';

// Memory types
export type MemoryCategory = 'preferences' | 'facts' | 'style' | 'context' | 'instructions';

export interface UserMemory {
    id: number;
    userId: number;
    category: MemoryCategory;
    key: string;
    value: string;
    confidence: number;
    source: 'extracted' | 'stated' | 'inferred';
    lastAccessed: Date;
    createdAt: Date;
}

interface MemoryInput {
    category: MemoryCategory;
    key: string;
    value: string;
    confidence?: number;
    source?: 'extracted' | 'stated' | 'inferred';
}

// In-memory cache for fast access (with TTL tracking)
const memoryCache = new Map<number, Map<string, UserMemory>>();
const cacheTTL = new Map<number, number>(); // userId -> timestamp of last DB sync
const CACHE_MAX_AGE_MS = 30_000; // 30 seconds

function isCacheFresh(userId: number): boolean {
    const lastSync = cacheTTL.get(userId);
    if (!lastSync) return false;
    return (Date.now() - lastSync) < CACHE_MAX_AGE_MS;
}

function invalidateCache(userId: number): void {
    memoryCache.delete(userId);
    cacheTTL.delete(userId);
}

function mapRowToMemory(row: any): UserMemory {
    return {
        id: row.id,
        userId: row.user_id,
        category: row.category,
        key: row.key,
        value: row.value,
        confidence: parseFloat(row.confidence) || 1.0,
        source: row.source || 'extracted',
        lastAccessed: row.last_accessed ? new Date(row.last_accessed) : new Date(),
        createdAt: row.created_at ? new Date(row.created_at) : new Date(),
    };
}

/**
 * Save or update a memory for a user
 */
export async function saveMemory(
    userId: number,
    input: MemoryInput
): Promise<UserMemory> {
    const { category, key, value, confidence = 1.0, source = 'extracted' } = input;
    const memoryKey = `${category}:${key}`;

    try {
        // Check if memory exists using raw SQL (correct Drizzle pattern)
        const existing = await db.execute(sql`
            SELECT * FROM user_memories
            WHERE user_id = ${userId} AND category = ${category} AND key = ${key}
            LIMIT 1
        `);

        if (existing.rows && existing.rows.length > 0) {
            const existingRow = existing.rows[0] as any;
            // Update existing memory
            const updated = await db.execute(sql`
                UPDATE user_memories SET
                    value = ${value},
                    confidence = GREATEST(confidence, ${confidence}),
                    last_accessed = NOW()
                WHERE id = ${existingRow.id}
                RETURNING *
            `);

            // Invalidate cache so next read picks up fresh data
            invalidateCache(userId);

            if (updated.rows && updated.rows.length > 0) {
                return mapRowToMemory(updated.rows[0]);
            }
        }

        // Insert new memory
        const inserted = await db.execute(sql`
            INSERT INTO user_memories (user_id, category, key, value, confidence, source, last_accessed, created_at)
            VALUES (${userId}, ${category}, ${key}, ${value}, ${confidence}, ${source}, NOW(), NOW())
            RETURNING *
        `);

        // Invalidate cache so next read picks up fresh data
        invalidateCache(userId);

        if (inserted.rows && inserted.rows.length > 0) {
            return mapRowToMemory(inserted.rows[0]);
        }

        throw new Error('Insert returned no rows');
    } catch (error) {
        console.error('Error saving memory:', error);
        // Fallback to in-memory only
        const memory: UserMemory = {
            id: Date.now(),
            userId,
            category,
            key,
            value,
            confidence,
            source,
            lastAccessed: new Date(),
            createdAt: new Date(),
        };

        const userCache = memoryCache.get(userId) || new Map();
        userCache.set(memoryKey, memory);
        memoryCache.set(userId, userCache);

        return memory;
    }
}

/**
 * Get all memories for a user
 */
export async function getMemories(
    userId: number,
    category?: MemoryCategory
): Promise<UserMemory[]> {
    // Check cache first (only if fresh)
    const userCache = memoryCache.get(userId);
    if (userCache && userCache.size > 0 && isCacheFresh(userId)) {
        const memories = Array.from(userCache.values());
        if (category) {
            return memories.filter(m => m.category === category);
        }
        return memories;
    }

    try {
        // Fetch from database using raw SQL (correct Drizzle pattern)
        let result;
        if (category) {
            result = await db.execute(sql`
                SELECT * FROM user_memories
                WHERE user_id = ${userId} AND category = ${category}
                ORDER BY last_accessed DESC
            `);
        } else {
            result = await db.execute(sql`
                SELECT * FROM user_memories
                WHERE user_id = ${userId}
                ORDER BY last_accessed DESC
            `);
        }

        const memories: UserMemory[] = (result.rows || []).map(mapRowToMemory);

        // Populate cache with ALL user memories (not filtered)
        if (!category) {
            const newCache = new Map<string, UserMemory>();
            for (const memory of memories) {
                newCache.set(`${memory.category}:${memory.key}`, memory);
            }
            memoryCache.set(userId, newCache);
            cacheTTL.set(userId, Date.now());
        }

        return memories;
    } catch (error) {
        console.error('Error fetching memories:', error);
        // Return whatever is in cache as fallback
        if (userCache && userCache.size > 0) {
            const memories = Array.from(userCache.values());
            if (category) {
                return memories.filter(m => m.category === category);
            }
            return memories;
        }
        return [];
    }
}

/**
 * Get relevant memories for a topic
 */
export async function getRelevantMemories(
    userId: number,
    topic: string,
    limit: number = 10
): Promise<UserMemory[]> {
    const allMemories = await getMemories(userId);

    // Simple keyword matching (could be enhanced with embeddings)
    const topicWords = topic.toLowerCase().split(/\s+/);

    const scored = allMemories.map(memory => {
        let score = 0;
        const memoryText = `${memory.key} ${memory.value}`.toLowerCase();

        for (const word of topicWords) {
            if (memoryText.includes(word)) {
                score += 1;
            }
        }

        // Boost by recency and confidence
        const daysSinceAccess = (Date.now() - memory.lastAccessed.getTime()) / (1000 * 60 * 60 * 24);
        score *= memory.confidence;
        score *= Math.exp(-daysSinceAccess / 30); // Decay over 30 days

        return { memory, score };
    });

    return scored
        .filter(s => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(s => s.memory);
}

/**
 * Build context string from memories
 */
export async function buildMemoryContext(
    userId: number,
    currentTopic?: string
): Promise<string> {
    const [preferences, facts, instructions] = await Promise.all([
        getMemories(userId, 'preferences'),
        getMemories(userId, 'facts'),
        getMemories(userId, 'instructions'),
    ]);

    const relevantContext = currentTopic
        ? await getRelevantMemories(userId, currentTopic, 5)
        : [];

    const sections: string[] = [];

    if (preferences.length > 0) {
        sections.push(`## Preferencias del Usuario\n${preferences.map(p => `- ${p.key}: ${p.value}`).join('\n')}`);
    }

    if (facts.length > 0) {
        sections.push(`## Hechos Conocidos\n${facts.map(f => `- ${f.key}: ${f.value}`).join('\n')}`);
    }

    if (instructions.length > 0) {
        sections.push(`## Instrucciones Personalizadas\n${instructions.map(i => `- ${i.value}`).join('\n')}`);
    }

    if (relevantContext.length > 0 && currentTopic) {
        sections.push(`## Contexto Relevante para "${currentTopic}"\n${relevantContext.map(c => `- ${c.value}`).join('\n')}`);
    }

    return sections.join('\n\n');
}

/**
 * Extract memories from conversation
 */
export async function extractMemoriesFromMessage(
    userId: number,
    message: string,
    role: 'user' | 'assistant'
): Promise<void> {
    // Patterns to detect
    const patterns = [
        { regex: /(?:me llamo|mi nombre es|soy)\s+([A-Z][a-zA-Z]+)/i, category: 'facts' as MemoryCategory, key: 'nombre' },
        { regex: /(?:trabajo en|soy)\s+([^,.]+)(?:como|de)\s+(\w+)/i, category: 'facts' as MemoryCategory, key: 'trabajo' },
        { regex: /(?:prefiero|me gusta más)\s+(.+?)(?:\.|,|$)/i, category: 'preferences' as MemoryCategory, key: 'preference' },
        { regex: /(?:siempre|nunca)\s+(.+?)(?:\.|,|$)/i, category: 'instructions' as MemoryCategory, key: 'instruction' },
        { regex: /(?:mi empresa|nuestra empresa)\s+(.+?)(?:\.|,|$)/i, category: 'facts' as MemoryCategory, key: 'empresa' },
        { regex: /(?:mi correo|email)\s*(?:es)?\s*([^\s,]+@[^\s,]+)/i, category: 'facts' as MemoryCategory, key: 'email' },
    ];

    for (const pattern of patterns) {
        const match = message.match(pattern.regex);
        if (match) {
            const value = match[1].trim();
            if (value.length > 2 && value.length < 100) {
                await saveMemory(userId, {
                    category: pattern.category,
                    key: pattern.key,
                    value,
                    confidence: role === 'user' ? 0.9 : 0.7,
                    source: 'extracted',
                });
            }
        }
    }
}

/**
 * Delete a memory
 */
export async function deleteMemory(userId: number, memoryId: number): Promise<boolean> {
    try {
        await db.execute(sql`
            DELETE FROM user_memories WHERE id = ${memoryId} AND user_id = ${userId}
        `);

        // Invalidate cache for user
        invalidateCache(userId);

        return true;
    } catch (error) {
        console.error('Error deleting memory:', error);
        return false;
    }
}

/**
 * Clear all memories for a user
 */
export async function clearMemories(userId: number): Promise<void> {
    try {
        await db.execute(sql`
            DELETE FROM user_memories WHERE user_id = ${userId}
        `);

        invalidateCache(userId);
    } catch (error) {
        console.error('Error clearing memories:', error);
    }
}
