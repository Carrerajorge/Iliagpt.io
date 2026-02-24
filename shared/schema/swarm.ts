import { z } from "zod";

export const SwarmAgentConfigSchema = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    capabilities: z.array(z.string()),
    tools: z.array(z.string()),
    status: z.enum(["idle", "busy", "offline", "error"]).default("idle"),
});

export const SwarmTaskSchema = z.object({
    id: z.string(),
    description: z.string(),
    originalPrompt: z.string(),
    assignedAgent: z.string().optional(),
    dependencies: z.array(z.string()).default([]),
    status: z.enum(["pending", "in_progress", "completed", "failed", "verifying"]).default("pending"),
    result: z.any().optional(),
    error: z.string().optional(),
});

export const SwarmPlanSchema = z.object({
    planId: z.string(),
    objective: z.string(),
    tasks: z.array(SwarmTaskSchema),
    createdAt: z.string().datetime(),
    completedAt: z.string().datetime().optional(),
});

export type SwarmAgentConfig = z.infer<typeof SwarmAgentConfigSchema>;
export type SwarmTask = z.infer<typeof SwarmTaskSchema>;
export type SwarmPlan = z.infer<typeof SwarmPlanSchema>;
