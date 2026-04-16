/**
 * Policy Engine
 * 
 * Configurable safety rules that validate UserSpecs and ExecutionPlans.
 * Supports per-user and per-organization policy overrides.
 */

import { UserSpec, ExecutionPlan, ExecutionStep, RiskSpec } from "./types";

export interface Policy {
    id: string;
    name: string;
    description: string;
    enabled: boolean;
    severity: "block" | "warn" | "require_confirmation";
    check: (spec: UserSpec, plan?: ExecutionPlan) => PolicyViolation | null;
}

export interface PolicyViolation {
    policyId: string;
    policyName: string;
    severity: "block" | "warn" | "require_confirmation";
    message: string;
    details?: Record<string, any>;
}

export interface PolicyConfig {
    userId?: string;
    orgId?: string;
    enabledPolicies?: string[];
    disabledPolicies?: string[];
    customPolicies?: Policy[];
}

// Default policies
const DEFAULT_POLICIES: Policy[] = [
    {
        id: "no_unconfirmed_delete",
        name: "Require Confirmation for Delete",
        description: "Destructive actions (delete, remove, drop) require user confirmation",
        enabled: true,
        severity: "require_confirmation",
        check: (spec) => {
            const hasDelete = spec.tasks.some(t =>
                ["delete", "remove", "drop", "truncate", "erase", "wipe"].some(v =>
                    t.verb.toLowerCase().includes(v) || (t.object || "").toLowerCase().includes(v)
                )
            );
            if (hasDelete) {
                return {
                    policyId: "no_unconfirmed_delete",
                    policyName: "Require Confirmation for Delete",
                    severity: "require_confirmation",
                    message: "This action includes destructive operations that require your confirmation."
                };
            }
            return null;
        }
    },
    {
        id: "no_external_api_without_approval",
        name: "External API Approval Required",
        description: "Calls to external APIs require approval",
        enabled: true,
        severity: "warn",
        check: (spec, plan) => {
            if (!plan) return null;
            const hasExternalCall = plan.steps.some(s => s.actionType === "external_call");
            if (hasExternalCall) {
                return {
                    policyId: "no_external_api_without_approval",
                    policyName: "External API Approval Required",
                    severity: "warn",
                    message: "This plan includes external API calls."
                };
            }
            return null;
        }
    },
    {
        id: "require_goal_clarity",
        name: "Goal Clarity Required",
        description: "Block execution if goal is empty or unclear",
        enabled: true,
        severity: "block",
        check: (spec) => {
            if (!spec.goal || spec.goal.length < 5) {
                return {
                    policyId: "require_goal_clarity",
                    policyName: "Goal Clarity Required",
                    severity: "block",
                    message: "Unable to determine the goal of this request. Please be more specific."
                };
            }
            return null;
        }
    },
    {
        id: "block_high_risk_low_confidence",
        name: "Block High Risk + Low Confidence",
        description: "Block if risky actions detected with low extraction confidence",
        enabled: true,
        severity: "block",
        check: (spec) => {
            const hasHighRisk = spec.risks.some(r => r.severity === "high" || r.severity === "critical");
            if (hasHighRisk && spec.confidence < 0.5) {
                return {
                    policyId: "block_high_risk_low_confidence",
                    policyName: "Block High Risk + Low Confidence",
                    severity: "block",
                    message: "High-risk action detected but extraction confidence is low. Please clarify your request."
                };
            }
            return null;
        }
    },
    {
        id: "require_missing_inputs",
        name: "Require Missing Inputs",
        description: "Block if critical inputs are missing",
        enabled: true,
        severity: "require_confirmation",
        check: (spec) => {
            if (spec.missing_inputs.length > 0) {
                return {
                    policyId: "require_missing_inputs",
                    policyName: "Require Missing Inputs",
                    severity: "require_confirmation",
                    message: `Missing information: ${spec.missing_inputs.join(", ")}`,
                    details: { missing: spec.missing_inputs }
                };
            }
            return null;
        }
    },
    {
        id: "block_contradictions",
        name: "Block Contradictions",
        description: "Block if contradictory instructions detected",
        enabled: true,
        severity: "block",
        check: (spec) => {
            const hasContradiction = spec.risks.some(r => r.type === "contradiction");
            if (hasContradiction) {
                return {
                    policyId: "block_contradictions",
                    policyName: "Block Contradictions",
                    severity: "block",
                    message: "Contradictory instructions detected. Please clarify your request."
                };
            }
            return null;
        }
    }
];

export class PolicyEngine {
    private policies: Map<string, Policy> = new Map();
    private config: PolicyConfig;

    constructor(config: PolicyConfig = {}) {
        this.config = config;

        // Load default policies
        for (const policy of DEFAULT_POLICIES) {
            this.policies.set(policy.id, policy);
        }

        // Apply custom policies
        if (config.customPolicies) {
            for (const policy of config.customPolicies) {
                this.policies.set(policy.id, policy);
            }
        }

        // Apply enabled/disabled overrides
        if (config.disabledPolicies) {
            for (const id of config.disabledPolicies) {
                const policy = this.policies.get(id);
                if (policy) policy.enabled = false;
            }
        }
        if (config.enabledPolicies) {
            for (const id of config.enabledPolicies) {
                const policy = this.policies.get(id);
                if (policy) policy.enabled = true;
            }
        }
    }

    evaluate(spec: UserSpec, plan?: ExecutionPlan): PolicyViolation[] {
        const violations: PolicyViolation[] = [];

        for (const policy of this.policies.values()) {
            if (!policy.enabled) continue;

            const violation = policy.check(spec, plan);
            if (violation) {
                violations.push(violation);
            }
        }

        return violations;
    }

    getBlockingViolations(violations: PolicyViolation[]): PolicyViolation[] {
        return violations.filter(v => v.severity === "block");
    }

    getConfirmationRequired(violations: PolicyViolation[]): PolicyViolation[] {
        return violations.filter(v => v.severity === "require_confirmation");
    }

    getWarnings(violations: PolicyViolation[]): PolicyViolation[] {
        return violations.filter(v => v.severity === "warn");
    }

    addPolicy(policy: Policy): void {
        this.policies.set(policy.id, policy);
    }

    removePolicy(policyId: string): boolean {
        return this.policies.delete(policyId);
    }

    enablePolicy(policyId: string): void {
        const policy = this.policies.get(policyId);
        if (policy) policy.enabled = true;
    }

    disablePolicy(policyId: string): void {
        const policy = this.policies.get(policyId);
        if (policy) policy.enabled = false;
    }

    listPolicies(): Policy[] {
        return Array.from(this.policies.values());
    }
}
