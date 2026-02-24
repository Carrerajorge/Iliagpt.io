import { UIElement } from '../native/hal';

export interface PredictedAction {
    elementId: string;
    actionType: 'click' | 'type' | 'scroll';
    confidence: number;
    reasoning: string;
}

export class ActionPredictor {
    /**
     * Determina la próxima acción en base al ecosistema del SO fusionado.
     * En producción, empaqueta el context en un prompt para la API LLM.
     */
    async predictNextAction(context: string, uiElements: UIElement[]): Promise<PredictedAction | null> {
        console.log(`[Vision][ActionPredictor] Analyzing ${uiElements.length} elements for context: "${context}"`);

        // El candidato ideal se determina por similitud de String o inferencia del LLM local/remoto.
        const candidate = uiElements.find(el =>
            el.title?.toLowerCase().includes(context.toLowerCase()) ||
            el.attributes?.['vision_label']?.toLowerCase().includes(context.toLowerCase())
        );

        if (candidate) {
            return {
                elementId: candidate.id,
                actionType: candidate.role.toLowerCase().includes('text') ? 'type' : 'click',
                confidence: 0.85,
                reasoning: `Element title/vision_label matches requested context "${context}"`
            };
        }

        return null; // Fallback al nodo de exploración MCTS (MCTS Expand)
    }
}

export const actionPredictor = new ActionPredictor();
