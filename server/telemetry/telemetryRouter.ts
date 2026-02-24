import { Router } from "express";
import { stateTracker } from "../vision/stateTracker";

export function createTelemetryRouter() {
    const router = Router();

    router.get("/metrics", async (req, res) => {
        try {
            // En fase 5.1 inicial expondremos la memoria dinámica de StateTracker 
            // como fallback si ClickHouse no está online.
            const rawHistory = stateTracker.getHistoryDump();

            // Map a formato ECharts esperado por la UI
            const actions = rawHistory.map(h => ({
                timestamp: h.timestamp,
                action_type: h.trigger,
                success: h.to !== 'ERROR_DETECTED',
                duration_ms: 1000 // Placeholder hasta métricas finas
            }));

            // Generar un Surprise Index sintético en base al historial de estados
            // (La divergencia MCTS idealmente poblará esto a futuro)
            const surprise = rawHistory.map((h, i) => {
                const isError = h.to === 'ERROR_DETECTED';
                const isWait = h.to === 'WAITING_RESPONSE';
                const baseSurprise = isError ? 0.9 : isWait ? 0.5 : 0.1;
                return {
                    timestamp: h.timestamp,
                    surprise_before: i === 0 ? 0.1 : (rawHistory[i - 1].to === 'ERROR_DETECTED' ? 0.9 : 0.1),
                    surprise_after: baseSurprise
                };
            });

            res.json({
                ok: true,
                surprise,
                actions
            });
        } catch (error) {
            console.error("[TelemetryRouter] Error fetch metrics:", error);
            res.status(500).json({ ok: false, error: "Internal Server Error" });
        }
    });

    return router;
}
