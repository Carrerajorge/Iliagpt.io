/**
 * Task Decomposition Engine - ILIAGPT PRO 3.0
 * 
 * Automatically decomposes complex tasks into manageable sub-tasks
 * with dependency detection and optimal execution ordering via LLM.
 */

import OpenAI from "openai";
import { AgentGoal } from "./autonomousAgentBrain";
import { globalRegistry } from "./capabilities/registry";

export interface TaskStep {
    id: string;
    description: string;
    expectedOutcome: string;
    dependencies: string[]; // IDs of tasks that must complete first
}

export class TaskDecomposer {
    private llm: OpenAI;

    constructor() {
        this.llm = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY || "missing",
        });
    }

    async decomposeGoal(goal: AgentGoal): Promise<TaskStep[]> {
        const activeCapabilities = globalRegistry.getAllRaw().map((c: any) => c.name).join(', ');

        const prompt = `
Eres el Orquestador Ejecutivo del Sistema MICHAT.
Tu tarea es descomponer el siguiente objetivo en una secuencia lineal de pasos accionables de muy alto nivel.
Los pasos serán evaluados por un árbol Monte Carlo Tree Search (MCTS) que ejecutará las sub-acciones.

OBJETIVO: "${goal.description}"
RESTRICCIONES: Máximo ${goal.constraints.maxActions} acciones.
CAPACIDADES DISPONIBLES EN EL SISTEMA: [${activeCapabilities}]

REGLAS:
- Genera entre 2 y ${goal.constraints.maxActions} pasos concretos.
- Responde ÚNICAMENTE con un JSON Array exacto de objetos con este formato:
[
  {
    "id": "step_1",
    "description": "Qué hacer",
    "expectedOutcome": "Qué debe ser cierto al terminar",
    "dependencies": [] 
  }
]
No incluyas markdown, solo el JSON puro.
`;

        try {
            const response = await this.llm.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [{ role: "system", content: prompt }],
                temperature: 0.1
            });

            let contentStr = response.choices[0]?.message?.content || "[]";
            if (contentStr.startsWith('\`\`\`json')) contentStr = contentStr.replace(/\`\`\`json\n?/, '').replace(/\`\`\`\n?$/, '');
            else if (contentStr.startsWith('\`\`\`')) contentStr = contentStr.replace(/\`\`\`\n?/, '').replace(/\`\`\`\n?$/, '');

            return JSON.parse(contentStr.trim()) as TaskStep[];
        } catch (e) {
            console.error("[TaskDecomposer] Error al descomponer goal:", e);
            // Fallback gracefully
            return [{
                id: "step_1",
                description: goal.description,
                expectedOutcome: "Goal achieved.",
                dependencies: []
            }];
        }
    }
}

export const taskDecomposer = new TaskDecomposer();
