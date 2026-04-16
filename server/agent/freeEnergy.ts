import { worldModel } from './worldModel';

export class FreeEnergyEngine {

    /**
     * Calcula la "Sorpresa" (Surprise / Free Energy).
     * Distancia entre lo que el agente predijo que pasaría y lo que observó (A11Y / GUI tree actual).
     */
    public async evaluateSurprise(
        previousState: string,
        action: any,
        actualObservation: string
    ): Promise<number> {

        // El World Model intentará adivinar qué debió pasar
        const prediction = await worldModel.predictOutcome(previousState, action);

        if (!prediction) {
            // Alta energía si no tenemos idea de qué pasa en este estado (Total Surprise = 1.0)
            return 1.0;
        }

        // Simplificación: similitud de cadenas entre predicción y observación real
        const similarityScore = this.cosineTextSimilarity(prediction.predictedState, actualObservation);

        // Sorpresa es inversa a la similitud (1 = idénticos, sorpresa de 0)
        return 1.0 - similarityScore;
    }

    /**
     * T09-004: MCTS Exploration Parameter adjustment
     * Modulates Upper Confidence Bound weight dynamically via Surprise
     */
    public deriveMctsExplorationConstant(freeEnergy: number): number {
        const baseConst = 1.41;
        // Si hay mucha sorpresa, explota la exploración masiva en el policy tree
        return baseConst + (freeEnergy * 2.0);
    }

    // Función determinista base de similitud lexico-cosenoidal (Mock)
    private cosineTextSimilarity(a: string, b: string): number {
        const wordsA = new Set(a.split(/\s+/));
        const wordsB = new Set(b.split(/\s+/));
        let intersection = 0;
        for (const w of wordsA) if (wordsB.has(w)) intersection++;
        const union = wordsA.size + wordsB.size - intersection;
        return union === 0 ? 0 : intersection / union;
    }
}

export const freeEnergy = new FreeEnergyEngine();
