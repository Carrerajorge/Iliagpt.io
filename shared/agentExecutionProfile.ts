import { z } from "zod";

export const AGENT_EXECUTION_PROFILES = ["standard", "marathon_12h", "marathon_24h"] as const;

export const AgentExecutionProfileSchema = z.enum(AGENT_EXECUTION_PROFILES);
export type AgentExecutionProfile = z.infer<typeof AgentExecutionProfileSchema>;

export const DEFAULT_AGENT_EXECUTION_PROFILE: AgentExecutionProfile = "standard";

export function normalizeAgentExecutionProfile(value: unknown): AgentExecutionProfile {
  const parsed = AgentExecutionProfileSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_AGENT_EXECUTION_PROFILE;
}

export function isMarathonExecutionProfile(profile: AgentExecutionProfile): boolean {
  return profile === "marathon_12h" || profile === "marathon_24h";
}
