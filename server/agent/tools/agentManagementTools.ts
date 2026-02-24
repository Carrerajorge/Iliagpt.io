/**
 * Agent Management Tools Registration
 * Tools for operation modes, checkpoints, and KPIs.
 */

import { z } from "zod";
import {
  setOperationMode,
  getOperationMode,
  getModeConfig,
  getAllModes,
  type OperationMode,
} from "../operationModes";
import {
  createCheckpoint,
  pauseCheckpoint,
  resumeCheckpoint,
  getCheckpoint,
  listCheckpoints,
  cancelCheckpoint,
} from "../checkpointManager";
import {
  getKPISummary,
  getRecentRuns,
  getRunKPI,
} from "../../services/agentKPIs";
import {
  setPermissionProfile,
  getPermissionProfile,
  getProfileConfig,
  getAllProfiles,
  type PermissionProfile,
} from "../permissionProfiles";

export interface ToolDefinition {
  name: string;
  description: string;
  category: string;
  schema: z.ZodObject<any>;
  execute: (params: any) => Promise<any>;
}

export const agentManagementTools: ToolDefinition[] = [
  // === Operation Modes ===
  {
    name: "agent_set_mode",
    description: "Set the agent operation mode (assisted, autonomous, supervised, safe, sandbox, production, testing, demo)",
    category: "agent",
    schema: z.object({
      mode: z.enum(["assisted", "autonomous", "supervised", "safe", "sandbox", "production", "testing", "demo"]),
    }),
    execute: async (params) => setOperationMode(params.mode as OperationMode),
  },
  {
    name: "agent_get_mode",
    description: "Get the current agent operation mode",
    category: "agent",
    schema: z.object({}),
    execute: async () => ({
      mode: getOperationMode(),
      config: getModeConfig(),
    }),
  },
  {
    name: "agent_list_modes",
    description: "List all available operation modes with descriptions",
    category: "agent",
    schema: z.object({}),
    execute: async () => ({
      modes: getAllModes(),
    }),
  },

  // === Checkpoints ===
  {
    name: "agent_checkpoint_create",
    description: "Create a checkpoint for a new agent run",
    category: "agent",
    schema: z.object({
      runId: z.string(),
      totalSteps: z.number(),
      stepNames: z.array(z.string()),
    }),
    execute: async (params) => createCheckpoint(params.runId, params.totalSteps, params.stepNames),
  },
  {
    name: "agent_checkpoint_pause",
    description: "Pause a running agent checkpoint",
    category: "agent",
    schema: z.object({ runId: z.string() }),
    execute: async (params) => pauseCheckpoint(params.runId),
  },
  {
    name: "agent_checkpoint_resume",
    description: "Resume a paused agent checkpoint",
    category: "agent",
    schema: z.object({ runId: z.string() }),
    execute: async (params) => resumeCheckpoint(params.runId),
  },
  {
    name: "agent_checkpoint_cancel",
    description: "Cancel an agent checkpoint",
    category: "agent",
    schema: z.object({ runId: z.string() }),
    execute: async (params) => cancelCheckpoint(params.runId),
  },
  {
    name: "agent_checkpoint_get",
    description: "Get the state of a checkpoint",
    category: "agent",
    schema: z.object({ runId: z.string() }),
    execute: async (params) => getCheckpoint(params.runId),
  },
  {
    name: "agent_checkpoint_list",
    description: "List all checkpoints, optionally filtered by status",
    category: "agent",
    schema: z.object({
      status: z.enum(["running", "paused", "completed", "failed", "cancelled"]).optional(),
    }),
    execute: async (params) => ({
      checkpoints: listCheckpoints(params.status),
    }),
  },

  // === KPIs ===
  {
    name: "agent_kpi_summary",
    description: "Get agent KPI summary (success rate, duration, cost, etc.)",
    category: "agent",
    schema: z.object({
      sinceHours: z.number().optional(),
    }),
    execute: async (params) => getKPISummary(params.sinceHours ? params.sinceHours * 3600000 : undefined),
  },
  {
    name: "agent_kpi_recent_runs",
    description: "Get recent agent runs with KPI data",
    category: "agent",
    schema: z.object({
      limit: z.number().default(20),
    }),
    execute: async (params) => ({
      runs: getRecentRuns(params.limit),
    }),
  },
  {
    name: "agent_kpi_run_detail",
    description: "Get KPI details for a specific agent run",
    category: "agent",
    schema: z.object({ runId: z.string() }),
    execute: async (params) => getRunKPI(params.runId),
  },

  // === Permission Profiles ===
  {
    name: "agent_set_profile",
    description: "Set the permission profile (minimal, coding, messaging, full)",
    category: "agent",
    schema: z.object({
      profile: z.enum(["minimal", "coding", "messaging", "full"]),
    }),
    execute: async (params) => setPermissionProfile(params.profile as PermissionProfile),
  },
  {
    name: "agent_get_profile",
    description: "Get the current permission profile",
    category: "agent",
    schema: z.object({}),
    execute: async () => ({
      profile: getPermissionProfile(),
      config: getProfileConfig(),
    }),
  },
  {
    name: "agent_list_profiles",
    description: "List all available permission profiles",
    category: "agent",
    schema: z.object({}),
    execute: async () => ({
      profiles: getAllProfiles(),
    }),
  },
];
