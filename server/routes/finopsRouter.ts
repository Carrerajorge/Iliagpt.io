import { Router } from "express";
import { db } from "../db";
import { pricingCatalog, tokenLedgerUsage } from "@shared/schema/finops";
import { sum, eq, sql } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";

export const finopsRouter = Router();

// T100-2.5: Dashboard Ejecutivo - Obtener consumo global y márgenes
finopsRouter.get("/dashboard/summary", requireAuth, async (req, res) => {
    try {
        // En un entorno multi-tenant, aquí filtraríamos por `workspaceId` del admin.
        // Para este MVP FinOps asimilamos el contexto global.

        const metrics = await db.select({
            modelName: tokenLedgerUsage.modelName,
            totalRequests: sql<number>`count(${tokenLedgerUsage.id})`,
            totalTokens: sum(tokenLedgerUsage.totalTokens),
            totalCost: sum(tokenLedgerUsage.totalCalculatedCost),
        })
            .from(tokenLedgerUsage)
            .groupBy(tokenLedgerUsage.modelName);

        const globalCost = metrics.reduce((acc: number, row: any) => acc + (Number(row.totalCost) || 0), 0);
        const globalTokens = metrics.reduce((acc: number, row: any) => acc + (Number(row.totalTokens) || 0), 0);

        res.json({
            status: "ok",
            data: {
                globalStats: {
                    totalCostUsd: globalCost,
                    totalTokens: globalTokens,
                    efficiencyAvg: globalTokens > 0 ? (globalCost / globalTokens) * 1000 : 0 // Cost per 1K tokens
                },
                breakdownByModel: metrics
            }
        });
    } catch (e: any) {
        console.error("[FinOps] Error querying dashboard summary:", e);
        res.status(500).json({ error: "FinOps Aggregation Failed" });
    }
});

// Seed Initial Catalog Tool (Internal)
finopsRouter.post("/setup-catalog", requireAuth, async (req, res) => {
    try {
        await db.insert(pricingCatalog).values([
            { provider: 'openai', model: 'gpt-4o', inputCostPerMillion: 5.0, outputCostPerMillion: 15.0, contextWindow: 128000 },
            { provider: 'openai', model: 'gpt-4o-mini', inputCostPerMillion: 0.150, outputCostPerMillion: 0.60, contextWindow: 128000 },
            { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022', inputCostPerMillion: 3.0, outputCostPerMillion: 15.0, contextWindow: 200000 },
            { provider: 'gemini', model: 'gemini-1.5-flash', inputCostPerMillion: 0.075, outputCostPerMillion: 0.30, contextWindow: 1000000 }
        ]).onConflictDoNothing();

        res.json({ status: "Catalog Seeded Successfully" });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});
