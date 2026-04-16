import {
  DEFAULT_AGENT_EXECUTION_PROFILE,
  type AgentExecutionProfile,
  normalizeAgentExecutionProfile,
} from "@shared/agentExecutionProfile";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

export interface AgentExecutionProfileConfig {
  profile: AgentExecutionProfile;
  label: string;
  minPlanSteps: number;
  maxPlanSteps: number;
  maxReplanAttempts: number;
  maxRunDurationMs: number;
  completedRunRetentionMs: number;
  subagent: {
    maxSteps: number;
    stepTimeoutMs: number;
    maxConsecutiveFailures: number;
  };
}

const PROFILE_CONFIGS: Record<AgentExecutionProfile, AgentExecutionProfileConfig> = {
  standard: {
    profile: "standard",
    label: "Standard",
    minPlanSteps: 3,
    maxPlanSteps: 8,
    maxReplanAttempts: 2,
    maxRunDurationMs: 2 * HOUR_MS,
    completedRunRetentionMs: 2 * HOUR_MS,
    subagent: {
      maxSteps: 8,
      stepTimeoutMs: 10 * MINUTE_MS,
      maxConsecutiveFailures: 2,
    },
  },
  marathon_12h: {
    profile: "marathon_12h",
    label: "Marathon 12h",
    minPlanSteps: 6,
    maxPlanSteps: 24,
    maxReplanAttempts: 6,
    maxRunDurationMs: 12 * HOUR_MS,
    completedRunRetentionMs: 12 * HOUR_MS,
    subagent: {
      maxSteps: 96,
      stepTimeoutMs: 30 * MINUTE_MS,
      maxConsecutiveFailures: 6,
    },
  },
  marathon_24h: {
    profile: "marathon_24h",
    label: "Marathon 24h",
    minPlanSteps: 8,
    maxPlanSteps: 40,
    maxReplanAttempts: 10,
    maxRunDurationMs: 24 * HOUR_MS,
    completedRunRetentionMs: 24 * HOUR_MS,
    subagent: {
      maxSteps: 160,
      stepTimeoutMs: 45 * MINUTE_MS,
      maxConsecutiveFailures: 8,
    },
  },
};

export function getAgentExecutionProfileConfig(profile: AgentExecutionProfile): AgentExecutionProfileConfig {
  return PROFILE_CONFIGS[normalizeAgentExecutionProfile(profile)];
}

export function resolveAgentExecutionProfile(profile: unknown): AgentExecutionProfile {
  return normalizeAgentExecutionProfile(profile);
}

export function resolveAgentExecutionProfileFromHints(planHint: string[] | undefined): AgentExecutionProfile {
  if (!Array.isArray(planHint)) {
    return DEFAULT_AGENT_EXECUTION_PROFILE;
  }

  for (const hint of planHint) {
    if (typeof hint !== "string") continue;
    const match = hint.match(/^profile:(.+)$/i);
    if (match?.[1]) {
      return normalizeAgentExecutionProfile(match[1].trim());
    }
  }

  return DEFAULT_AGENT_EXECUTION_PROFILE;
}
