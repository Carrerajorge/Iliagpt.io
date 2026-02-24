import { db } from '../db';
import { agentEpisodicMemory } from '@shared/schema/agent';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';

export interface MemoryEntry {
    content: string;
    timestamp: number;
    metadata?: any;
}

export class CognitiveMemorySystem {
    // 1. Short-Term Memory (Working Memory buffer in RAM)
    private shortTermBuffer: MemoryEntry[] = [];
    private MAX_STM_CAPACITY = 10; // Holds context of recent N actions

    pushShortTerm(content: string, metadata?: any) {
        this.shortTermBuffer.push({ content, timestamp: Date.now(), metadata });
        if (this.shortTermBuffer.length > this.MAX_STM_CAPACITY) {
            // Evict oldest out of Working Memory, possibly consign to Episodic
            const oldest = this.shortTermBuffer.shift();
            if (oldest) this.consignToEpisodic(oldest);
        }
    }

    getShortTermContext(): string {
        return this.shortTermBuffer.map((m, i) => `[T-${this.shortTermBuffer.length - i}] ${m.content}`).join('\\n');
    }

    // 2. Episodic Memory (Experience Replay via Vector DB)
    private async consignToEpisodic(entry: MemoryEntry) {
        try {
            if (!(db as any).insert) return;
            // In a real flow, call text-embedding-ada-002 here for `entry.content`
            const mockEmbedding = Array(1536).fill(0).map(() => Math.random());

            await (db as any).insert(agentEpisodicMemory).values({
                runId: entry.metadata?.runId || 'system',
                embedding: mockEmbedding,
                content: entry.content,
                metadata: entry.metadata
            });
        } catch (e) {
            console.warn(`[Memory] Failed episodic consign. Missing pgvector table?`, e);
        }
    }

    async recallEpisodic(query: string, limit = 3): Promise<string[]> {
        try {
            if (!(db as any).select) return [];
            // Real implementation would embed the 'query' first
            const mockQueryObj = Array(1536).fill(0).map(() => Math.random());
            const queryLiteral = `[${mockQueryObj.join(',')}]`;

            // pgvector cosine distance `<=>` operator
            const matches = await (db as any).select()
                .from(agentEpisodicMemory)
                .orderBy(sql`${agentEpisodicMemory.embedding} <=> ${queryLiteral}::vector`)
                .limit(limit);

            return matches.map((m: any) => m.content);
        } catch (e) {
            return ["(No memory context accessible)"];
        }
    }

    // 3. Long-Term Memory (Semantic Base Knowledge)
    getLongTermRules(): string {
        return `
            1. Never execute rm -rf or terminal wipers.
            2. If UI is opaque, prioritize 'exploration' by random hovering.
            3. Obey User instructions above implicitly inferred rewards.
        `;
    }
}

export const agentMemory = new CognitiveMemorySystem();
