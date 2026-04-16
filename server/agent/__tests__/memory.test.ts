import { describe, test, expect, beforeEach, vi } from 'vitest';

// Mock db before importing agentMemory
vi.mock('../../db', () => ({
    db: {
        insert: vi.fn().mockReturnValue({
            values: vi.fn().mockResolvedValue(true),
        }),
    }
}));

// Import after mock setup
const { agentMemory } = await import('../memory');
const { db } = await import('../../db');

describe('CognitiveMemorySystem (T09-003)', () => {

    beforeEach(() => {
        // Reset state internals using ts-ignore for private access during tests
        // @ts-ignore
        agentMemory.shortTermBuffer = [];
        vi.clearAllMocks();
    });

    test('Short Term Memory respects capacity and evicts properly', () => {
        // Fill beyond max capacity (10)
        for (let i = 0; i < 15; i++) {
            agentMemory.pushShortTerm(`Action Sequence ${i}`);
        }

        // Should keep only 10
        // @ts-ignore
        expect(agentMemory.shortTermBuffer.length).toBe(10);

        // The 5 evicted should have triggered 5 inserts to db (Episodic consign)
        expect((db as any).insert).toHaveBeenCalledTimes(5);
    });

    test('Short Term Context formats backwards chronologically', () => {
        agentMemory.pushShortTerm('Opened browser');
        agentMemory.pushShortTerm('Clicked Login');

        const context = agentMemory.getShortTermContext();
        expect(context).toContain('[T-2] Opened browser');
        expect(context).toContain('[T-1] Clicked Login');
    });

    test('Rules Engine exposes strict constants', () => {
        const rules = agentMemory.getLongTermRules();
        expect(rules).toContain('Never execute rm -rf');
    });
});
