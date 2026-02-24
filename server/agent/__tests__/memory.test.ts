import { agentMemory } from '../memory';
import { db } from '../../db';

// Mocks para evitar I/O real contra PostgreSQL durante TDD
jest.mock('../../db', () => ({
    db: {
        insert: jest.fn().mockReturnThis(),
        values: jest.fn().mockResolvedValue(true)
    }
}));

describe('CognitiveMemorySystem (T09-003)', () => {

    beforeEach(() => {
        // Reset state internals using ts-ignore for private access during tests
        // @ts-ignore
        agentMemory.shortTermBuffer = [];
        jest.clearAllMocks();
    });

    test('Short Term Memory respects capacity and evicts properly', () => {
        // Llenar más de la capacidad max (10)
        for (let i = 0; i < 15; i++) {
            agentMemory.pushShortTerm(`Action Sequence ${i}`);
        }

        // Debe de quedarse sólo con 10
        // @ts-ignore
        expect(agentMemory.shortTermBuffer.length).toBe(10);

        // Las 5 superadas deben haber accionado 5 inserts a db (Episodic consign)
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
