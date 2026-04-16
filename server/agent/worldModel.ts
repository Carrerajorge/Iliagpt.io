import { db } from '../db';
import { agentTransitions } from '@shared/schema/agent'; // Make sure this exists
import { eq, and, sql } from 'drizzle-orm';

export class WorldModel {
    /**
     * T09-002: Aprendizaje por Refuerzo Offline. Guarda el estado antes y después de una acción.
     */
    async recordTransition(stateBefore: string, action: any, stateAfter: string, reward: number, appContext?: string) {
        await (db as any).insert(agentTransitions).values({
            stateBefore, action, stateAfter, reward, appContext
        });
    }

    /**
     * T09-002: Motor de Inferencia Ponderado. Similitud de texto usando PG similarity() 
     */
    async predictOutcome(currentState: string, proposedAction: any): Promise<{ predictedState: string; confidence: number } | null> {
        try {
            if (!(db as any).select) return null;

            const similar = await (db as any).select()
                .from(agentTransitions)
                .where(and(
                    // Require pg_trgm extension on Postgres for real similarity
                    sql`similarity(${agentTransitions.stateBefore}, ${currentState}) > 0.5`,
                    sql`${agentTransitions.action}->>'tool' = ${proposedAction.tool || proposedAction.actionType}`
                ))
                .orderBy(sql`similarity(${agentTransitions.stateBefore}, ${currentState}) DESC`)
                .limit(5);

            if (!similar || similar.length === 0) return null;

            const avgReward = similar.reduce((s: number, t: any) => s + t.reward, 0) / similar.length;
            return {
                predictedState: similar[0].stateAfter,
                confidence: avgReward
            };
        } catch (e) {
            console.warn(`[WorldModel] Prediction query failed/skipped (requires DB text similarity setup).`);
            return null;
        }
    }
}

export const worldModel = new WorldModel();
