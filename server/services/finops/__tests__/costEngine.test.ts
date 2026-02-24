import { describe, it, expect, beforeEach, vi } from 'vitest';
import { costEngine } from "../costEngine";
import { db } from "../../../db";

// Mock Drizzle DB calls using Vitest
vi.mock("../../../db", () => ({
    db: {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn(),
        insert: vi.fn().mockReturnThis(),
        values: vi.fn().mockResolvedValue([{ id: 'mocked-insert' }])
    }
}));

describe("FinOps CostEngine - Contract Tests", () => {

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("Debe calcular exactamente $0.075 USD por 1 millón de Input Tokens (Flash)", async () => {

        // Mock Catalog Response
        vi.mocked(db.limit).mockResolvedValueOnce([{
            id: 'mock-model-id',
            provider: 'gemini',
            model: 'gemini-1.5-flash',
            inputCostPerMillion: 0.075,
            outputCostPerMillion: 0.30
        }] as any);

        const totalCost = await costEngine.recordTokensAndCost({
            requestId: "req_123",
            userId: "user_1",
            workspaceId: "ws_1",
            modelName: "gemini-1.5-flash",
            inputTokens: 1_000_000,
            outputTokens: 0
        });

        expect(totalCost).toBe(0.075);
        expect(db.insert).toHaveBeenCalled();
    });

    it("Debe calcular fracciones precisas de Output Tokens", async () => {
        // Mock Catalog Response
        vi.mocked(db.limit).mockResolvedValueOnce([{
            id: 'mock-model-id-2',
            provider: 'openai',
            model: 'gpt-4o',
            inputCostPerMillion: 5.0,
            outputCostPerMillion: 15.0
        }] as any);

        const totalCost = await costEngine.recordTokensAndCost({
            requestId: "req_124",
            userId: "user_2",
            workspaceId: "ws_1",
            modelName: "gpt-4o",
            inputTokens: 100_000,     // 0.5 USD
            outputTokens: 500_000,    // 7.5 USD
        });

        expect(totalCost).toBe(8.0);
    });

    it("Debe bloquear peticiones superando el Guardrail del 100%", async () => {
        // Enforce guardrails con un mock que simule que el budget ya está en 5.0 y pedimos 6.0 = 11.0 > 10.0
        vi.mocked(db.where).mockResolvedValueOnce([{ totalConsumed: 5.0 }] as any);
        await expect(costEngine.enforceGuardrails("ws_1", 6.0)).rejects.toThrow(/Hard Limit Exceeded/);
    });

    it("Debe permitir peticiones dentro del límite pero emitir Warn al 85%", async () => {
        const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });

        // Simular que llevamos gastados 8.0 USD. Pedimos 1.0 USD => Total 9.0 USD (90% de 10.0).
        // Debería pasar, pero registrar Throttle Alert
        vi.mocked(db.where).mockResolvedValueOnce([{ totalConsumed: 8.0 }] as any);
        const result = await costEngine.enforceGuardrails("ws_1", 1.0);

        expect(result).toBe(true);
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Throttle Alert"));

        consoleSpy.mockRestore();
    });
});
