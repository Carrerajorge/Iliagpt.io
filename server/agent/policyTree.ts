import { UIElement } from '../native/hal';

export class PolicyNode {
    children: PolicyNode[] = [];
    visits: number = 0;
    value: number = 0;

    constructor(
        public state: string,
        public parent: PolicyNode | null = null,
        public action: any = null,
        public observation: { uiElements?: UIElement[], screenshot?: string } = {}
    ) { }

    /**
     * T09-001: MCTS expand() con UI Elements Reales
     */
    expand(action: any): PolicyNode {
        const child = new PolicyNode(`State_After_${action.tool}`, this, action);
        this.children.push(child);
        return child;
    }

    getBestAction(explorationParam = 1.41) {
        if (!this.observation.uiElements || this.observation.uiElements.length === 0) {
            // EXPLORATION: Generar acciones random si estamos ciegos
            const acts = [
                { tool: 'scroll', params: { direction: 'down' }, description: 'Scroll down' },
                { tool: 'screenshot', params: {}, description: 'Take screenshot' },
            ];
            return acts[Math.floor(Math.random() * acts.length)];
        }

        // EXPLOITATION: Extraer del DOM / A11y
        const possibleActions: any[] = [];
        this.observation.uiElements.forEach(el => {
            if (el.role === 'button' || el.role === 'link' || el.role === 'menuitem') {
                possibleActions.push({
                    tool: 'click',
                    params: { x: el.position.x + el.size.width / 2, y: el.position.y + el.size.height / 2 },
                    description: `Click ${el.role}: "${el.title || el.id}"`
                });
            } else if (el.role === 'textfield' || el.role === 'textarea') {
                possibleActions.push({
                    tool: 'type',
                    params: { elementId: el.id, text: '' }, // Rellenado luego por LLM / Contexto
                    description: `Type in ${el.role}: "${el.title || el.id}"`
                });
            }
        });

        // UCB1 formula para seleccionar acciones inexploradas en el nodo MCTS
        const unexplored = possibleActions.filter(a =>
            !this.children.some(c => c.action?.description === a.description)
        );

        if (unexplored.length > 0) {
            return unexplored[Math.floor(Math.random() * unexplored.length)];
        }

        return possibleActions[Math.floor(Math.random() * possibleActions.length)] || null;
    }
}
