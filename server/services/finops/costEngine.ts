import { db } from '../../db';
import { pricingCatalog, tokenLedgerUsage } from '@shared/schema/finops';
import { eq, and, sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';

export interface TokenUsagePayload {
    requestId: string;
    sessionId?: string;
    userId: string;
    workspaceId: string;
    modelName: string; // e.g., 'gpt-4o'
    inputTokens: number;
    outputTokens: number;
    cacheTokens?: number;
    latencyMs?: number;
    metadata?: any;
}

export class CostEngine {

    /**
     * T100-2.1: Evalúa Budget / Guardrails *ANTES* de la petición al Proveedor LLM.
     * Si supera Hard Limit (100%), lanza Excepción.
     */
    async enforceGuardrails(workspaceId: string, estimatedCost: number) {
        // T100-8.1: Multi-tenant Isolation (Quotas por Tenant probadas).
        // Fetch consumed budget from Ledger sum.

        const result = await db.select({
            totalConsumed: sql<number>`COALESCE(SUM(${tokenLedgerUsage.totalCalculatedCost}), 0)`
        })
            .from(tokenLedgerUsage)
            .where(eq(tokenLedgerUsage.workspaceId, workspaceId));

        const currentConsumption = result[0]?.totalConsumed || 0;

        // Fetch soft/hard limits from workspace config (En un futuro desde workspaces table)
        // Por ahora, Hard Limit = $10.00 USD global por tenant en Fase Beta
        const hardLimit = 10.0;
        const throttleLimit = hardLimit * 0.85;

        if (currentConsumption + estimatedCost >= hardLimit) {
            throw new Error(`[FinOps] Hard Limit Exceeded for workspace ${workspaceId}.Consumption $${currentConsumption}. Limit $${hardLimit}.`);
        }
        if (currentConsumption + estimatedCost >= throttleLimit) {
            console.warn(`[FinOps][Telemetry] Throttle Alert: Workspace ${workspaceId} consumed 85 % of budget.`);
        }
        return true;
    }

    /**
     * T100-2.3: Registra, normaliza y persiste el costo técnico exacto de un Request
     * Debe llamarse *DESPUÉS* de recibir el stream del LLM.
     */
    async recordTokensAndCost(payload: TokenUsagePayload): Promise<number> {
        try {
            // 1. Obtener Modelo desde el Catálogo
            const [modelDef] = await db.select()
                .from(pricingCatalog)
                .where(and(eq(pricingCatalog.model, payload.modelName), eq(pricingCatalog.status, 'enabled')))
                .limit(1);

            let inputCost = 0;
            let outputCost = 0;
            let modelId = null;

            if (modelDef) {
                modelId = modelDef.id;
                // Calculo: (tokens / 1,000,000) * precio_millon
                inputCost = (payload.inputTokens / 1_000_000) * modelDef.inputCostPerMillion;
                outputCost = (payload.outputTokens / 1_000_000) * modelDef.outputCostPerMillion;
            } else {
                console.warn(`[FinOps] Modelo no hallado en catálogo ${payload.modelName}. Costo registrado como USD $0.`);
            }

            const totalTokens = payload.inputTokens + payload.outputTokens;
            const totalCost = inputCost + outputCost;

            // 2. Inmutar Token Usage Ledger (T100-2.2 Auditable)
            await db.insert(tokenLedgerUsage).values({
                requestId: payload.requestId || randomUUID(),
                sessionId: payload.sessionId,
                userId: payload.userId,
                workspaceId: payload.workspaceId,
                modelId: modelId as string | null,
                modelName: payload.modelName,
                inputTokens: payload.inputTokens,
                outputTokens: payload.outputTokens,
                cacheTokens: payload.cacheTokens || 0,
                totalTokens,
                calculatedInputCost: inputCost,
                calculatedOutputCost: outputCost,
                totalCalculatedCost: totalCost,
                latencyMs: payload.latencyMs,
                metadata: payload.metadata
            });

            console.log(`[FinOps] Ledger Persisted: Request ${payload.requestId} - Total $${totalCost.toFixed(6)} `);
            return totalCost;

        } catch (e) {
            console.error(`[FinOps] Error Crítico insertando Cost Ledger: `, e);
            return 0;
        }
    }
}

export const costEngine = new CostEngine();
