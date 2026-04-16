/**
 * Planner Module
 * 
 * Responsible for converting a high-level UserSpec into a concrete ExecutionPlan.
 * Translates abstract tasks into executable steps.
 */

import { UserSpec, ExecutionPlan, ExecutionStep, ActionType } from "./types";
import { randomUUID } from "crypto";

export class Planner {
    constructor() { }

    createPlan(spec: UserSpec): ExecutionPlan {
        const steps: ExecutionStep[] = [];
        let totalEstimatedTimeMs = 0;

        // 1. Convert Tasks to Steps
        for (const task of spec.tasks) {
            const actionType = this.determineActionType(task.verb);
            const requiresConfirmation = this.checkRequiresConfirmation(task.verb, spec);

            const step: ExecutionStep = {
                id: randomUUID(),
                actionType,
                description: `Execute ${task.verb} on ${task.object || "target"}`,
                toolName: this.mapVerbToTool(task.verb),
                toolParams: {
                    action: task.verb,
                    target: task.object,
                    ...task.params.reduce((acc, p) => ({ ...acc, [p.name]: p.value }), {})
                },
                inputs: [],
                outputs: [],
                preconditions: [],
                requiresConfirmation,
                estimatedDurationMs: 1000 // Placeholder
            };

            steps.push(step);
            totalEstimatedTimeMs += (step.estimatedDurationMs || 0);
        }

        // 2. Add Validation Steps if Success Criteria exist
        if (spec.success_criteria.length > 0) {
            steps.push({
                id: randomUUID(),
                actionType: "compute",
                description: "Verify success criteria",
                toolName: "verifier",
                toolParams: { criteria: spec.success_criteria },
                inputs: steps.map(s => s.id), // Depends on all previous steps
                outputs: ["verification_result"],
                preconditions: [],
                requiresConfirmation: false,
                estimatedDurationMs: 500
            });
        }

        return {
            id: randomUUID(),
            specId: "generated_from_spec", // In real system, link to spec ID
            steps,
            totalEstimatedTimeMs,
            risksDetected: spec.risks,
            isValid: true, // Verification happens later
            validationErrors: []
        };
    }

    private determineActionType(verb: string): ActionType {
        const v = verb.toLowerCase();
        // Aggressive mapping for new specialized verbs
        if (["search_web", "search_academic", "search", "find", "read", "fetch", "research"].includes(v)) return "read";
        if (["analyze", "compute", "calculate", "compare", "evaluate"].includes(v)) return "compute";
        if (["create_document", "create_spreadsheet", "create", "write", "update", "delete", "remove", "generate", "build"].includes(v)) return "write";
        if (["ask", "question", "clarify"].includes(v)) return "ask_user";
        if (["translate", "transform"].includes(v)) return "compute";
        return "external_call"; // Default
    }

    private mapVerbToTool(verb: string): string {
        const v = verb.toLowerCase();

        // Detailed specialized tool mapping
        if (v === "search_academic") return "academic_search_tool";
        if (v === "create_spreadsheet") return "excel_generator_tool";
        if (v === "create_document") return "word_generator_tool";
        if (v === "translate") return "translation_tool";

        // Fallback robust mapping
        if (v.includes("search") || v.includes("research")) return "search_web";
        if (v.includes("excel") || v.includes("spreadsheet") || v.includes("hoja")) return "excel_generator_tool";
        if (v.includes("word") || v.includes("document") || v.includes("doc")) return "word_generator_tool";
        if (v.includes("write") || v.includes("create")) return "write_file";
        if (v.includes("delete")) return "delete_file";
        if (v.includes("analyze")) return "analyze_content";

        return "generic_tool";
    }

    private checkRequiresConfirmation(verb: string, spec: UserSpec): boolean {
        // Check if verb is in known risky list or if spec has high severity risks
        const v = verb.toLowerCase();
        const isRiskyVerb = ["delete", "remove", "overwrite"].some(r => v.includes(r));

        // Also check if any extracted risks flagged confirmation
        const specRequiresConfirmation = spec.risks.some(r => r.requiresConfirmation);

        return isRiskyVerb || specRequiresConfirmation;
    }
}
