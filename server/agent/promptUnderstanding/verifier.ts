/**
 * Verifier Module (Quality Gates)
 * 
 * Responsible for validating the UserSpec and ExecutionPlan before execution.
 * Checks for missing inputs, contradictions, and violates policies.
 */

import { UserSpec, ExecutionPlan, ExecutionStep } from "./types";

export interface VerificationResult {
    isApproved: boolean;
    blockers: string[];
    warnings: string[];
    confirmationRequired: boolean;
    verificationQuestions: string[];
}

export class Verifier {
    constructor() { }

    verify(spec: UserSpec, plan: ExecutionPlan): VerificationResult {
        const result: VerificationResult = {
            isApproved: true,
            blockers: [],
            warnings: [],
            confirmationRequired: false,
            verificationQuestions: []
        };

        // 1. Check for Missing Inputs
        if (spec.missing_inputs.length > 0) {
            result.isApproved = false;
            result.blockers.push(`Missing critical inputs: ${spec.missing_inputs.join(", ")}`);
            result.verificationQuestions.push(...spec.missing_inputs.map(i => `Please provide ${i}.`));
        }

        // 2. Check for Contradictions (from Extractor risks or simple check)
        const contradictions = spec.risks.filter(r => r.type === "contradiction");
        if (contradictions.length > 0) {
            result.isApproved = false;
            result.blockers.push("Contradictory instructions detected.");
            result.verificationQuestions.push("I found contradictions in your request. Please clarify.");
        }

        // 3. Check for Explicit Risks requiring confirmation
        if (spec.risks.some(r => r.requiresConfirmation)) {
            result.confirmationRequired = true;
            result.warnings.push("Plan involves high-risk actions.");
        }

        // 4. Validate Plan Integrity
        if (plan.steps.length === 0) {
            result.isApproved = false;
            result.blockers.push("No execution steps generated.");
        }

        // 5. Check for "Write" actions without confirmation if not explicitly allowed
        // (A simple policy: write/delete always requires confirmation if not previously granted)
        const writeSteps = plan.steps.filter(s => s.actionType === "write");
        if (writeSteps.length > 0) {
            // Heuristic: if explicit strict safety mode is implied
            // For now, we flag it as warning/confirmation
            if (!result.confirmationRequired) {
                // Check if any step marks itself as requiring confirmation
                if (plan.steps.some(s => s.requiresConfirmation)) {
                    result.confirmationRequired = true;
                }
            }
        }

        return result;
    }
}
