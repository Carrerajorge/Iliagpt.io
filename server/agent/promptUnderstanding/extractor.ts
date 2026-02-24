/**
 * Extractor Module
 * 
 * Responsible for converting semantic text blocks into a structured UserSpec.
 * In a full production system, this would utilize an LLM.
 * Here, we implement a heuristic-based extraction for demonstration and speed.
 */

import { UserSpec, TaskSpec, ConstraintSpec, RiskSpec } from "./types";
import { TextBlock } from "./lexer";
import { randomUUID } from "crypto";

export class Extractor {
    private currentSpec: UserSpec;

    constructor() {
        this.currentSpec = this.createEmptySpec();
    }

    getSpec(): UserSpec {
        return this.currentSpec;
    }

    processBlocks(blocks: TextBlock[]): UserSpec {
        for (const block of blocks) {
            this.extractFromBlock(block);
        }
        return this.currentSpec;
    }

    private extractFromBlock(block: TextBlock) {
        const text = block.content.toLowerCase();

        // 1. Detect Constraints
        // Language
        if (text.includes("english") || text.includes("spanish") || text.includes("inglés") || text.includes("español")) {
            this.addConstraint({
                type: "language",
                value: text,
                isHardConstraint: true
            });
        }
        // Format
        if (text.includes("json") || text.includes("markdown") || text.includes("csv") || text.includes("pdf")) {
            this.addConstraint({
                type: "format",
                value: text,
                isHardConstraint: true
            });
        }

        // 2. Detect Goal (First substantial sentence usually)
        if (!this.currentSpec.goal && block.type === "sentence" && text.length > 10) {
            this.currentSpec.goal = block.content;
        }

        // 3. Detect Tasks/Actions
        // Verbs: create, update, delete, search, analyze
        const verbs = ["create", "generate", "write", "update", "delete", "remove", "search", "find", "analyze", "crear", "generar", "escribir", "actualizar", "borrar", "buscar", "analizar"];

        // Simple verb extraction
        for (const verb of verbs) {
            if (text.includes(verb)) {
                // Avoid adding duplicate tasks for same block
                const existingTask = this.currentSpec.tasks.find(t => t.id === block.id);
                if (!existingTask) {
                    this.addTask({
                        id: block.id,
                        verb: verb,
                        object: block.content, // Simplified: whole block as context
                        params: [],
                        dependencies: []
                    });
                }
            }
        }

        // 4. Detect Risks
        if (text.includes("delete") || text.includes("remove") || text.includes("borrar") || text.includes("eliminate")) {
            this.addRisk({
                type: "security",
                description: "Potential destructive action detected",
                severity: "high",
                requiresConfirmation: true
            });
        }

        // 5. Detect Success Criteria
        if (text.includes("must") || text.includes("should") || text.includes("debe") || text.includes("tienes que")) {
            this.currentSpec.success_criteria.push(block.content);
        }
    }

    private addTask(task: TaskSpec) {
        this.currentSpec.tasks.push(task);
    }

    private addConstraint(constraint: ConstraintSpec) {
        // Avoid duplicates
        const exists = this.currentSpec.constraints.some(c => c.type === constraint.type && c.value === constraint.value);
        if (!exists) {
            this.currentSpec.constraints.push(constraint);
        }
    }

    private addRisk(risk: RiskSpec) {
        const exists = this.currentSpec.risks.some(r => r.type === risk.type && r.description === risk.description);
        if (!exists) {
            this.currentSpec.risks.push(risk);
        }
    }

    private createEmptySpec(): UserSpec {
        return {
            goal: "",
            tasks: [],
            inputs_provided: {},
            missing_inputs: [],
            constraints: [],
            success_criteria: [],
            assumptions: [],
            risks: [],
            questions: [],
            confidence: 0
        };
    }

    reset() {
        this.currentSpec = this.createEmptySpec();
    }
}
