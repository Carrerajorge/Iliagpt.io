import { z } from "zod";

// ============================================
// Core Schema Definitions
// ============================================

export const ConstraintSpecSchema = z.object({
    type: z.enum(["format", "language", "style", "length", "source", "time", "security", "quantity", "other"]),
    value: z.string(),
    isHardConstraint: z.boolean().default(true)
});
export type ConstraintSpec = z.infer<typeof ConstraintSpecSchema>;

export const RiskSpecSchema = z.object({
    type: z.enum(["ambiguity", "contradiction", "security", "privacy", "resource", "ethical"]),
    description: z.string(),
    severity: z.enum(["low", "medium", "high", "critical"]),
    requiresConfirmation: z.boolean().default(false)
});
export type RiskSpec = z.infer<typeof RiskSpecSchema>;

export const TaskArgumentSchema = z.object({
    name: z.string(),
    value: z.any(),
    source: z.enum(["explicit", "inferred", "default"]).default("explicit")
});
export type TaskArgument = z.infer<typeof TaskArgumentSchema>;

export const TaskSpecSchema = z.object({
    id: z.string(),
    verb: z.string(),
    object: z.string().optional(),
    params: z.array(TaskArgumentSchema).default([]),
    dependencies: z.array(z.string()).default([]),
    tool_hints: z.array(z.string()).default([])
});
export type TaskSpec = z.infer<typeof TaskSpecSchema>;

export const UserSpecSchema = z.object({
    goal: z.string(),
    tasks: z.array(TaskSpecSchema).default([]),
    inputs_provided: z.record(z.any()).default({}),
    missing_inputs: z.array(z.string()).default([]),
    constraints: z.array(ConstraintSpecSchema).default([]),
    success_criteria: z.array(z.string()).default([]),
    assumptions: z.array(z.string()).default([]),
    risks: z.array(RiskSpecSchema).default([]),
    questions: z.array(z.string()).default([]),
    confidence: z.number().min(0).max(1).default(0)
});
export type UserSpec = z.infer<typeof UserSpecSchema>;

// ============================================
// Planner Interfaces
// ============================================

export const ActionTypeSchema = z.enum(["read", "compute", "write", "external_call", "ask_user"]);
export type ActionType = z.infer<typeof ActionTypeSchema>;

export interface ExecutionStep {
    id: string;
    actionType: ActionType;
    description: string;
    toolName?: string;
    toolParams?: Record<string, any>;
    inputs: string[];
    outputs: string[];
    preconditions: string[];
    validation?: string;
    requiresConfirmation: boolean;
    estimatedDurationMs?: number;
}

export interface ExecutionPlan {
    id: string;
    specId: string; // References the UserSpec
    steps: ExecutionStep[];
    totalEstimatedTimeMs: number;
    risksDetected: RiskSpec[];
    isValid: boolean;
    validationErrors: string[];
}

// ============================================
// Parsing Status
// ============================================

export interface ParserState {
    tokensProcessed: number;
    isComplete: boolean;
    currentSpec: UserSpec;
    lastUpdated: Date;
    buffer: string[]; // Unprocessed text buffer
}
