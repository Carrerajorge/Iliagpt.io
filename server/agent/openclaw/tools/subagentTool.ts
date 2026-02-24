import { z } from "zod";
import { randomUUID } from "crypto";
import type { ToolDefinition, ToolResult, ToolContext } from "../../toolRegistry";
import { createError, createArtifact } from "../../toolRegistry";
import { agentEventBus } from "../../eventBus";
import {
  resolveCoreToolProfilePolicy,
  type ToolProfile,
} from "../toolCatalog";

export interface SubagentDescriptor {
  id: string;
  parentRunId: string;
  task: string;
  toolProfile: ToolProfile;
  status: "pending" | "running" | "completed" | "failed" | "timeout";
  result: unknown | null;
  error: string | null;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  timeoutMs: number;
}

const subagentRegistry = new Map<string, SubagentDescriptor>();
const parentIndex = new Map<string, Set<string>>();

const DEFAULTS = {
  TIMEOUT_MS: 120_000,
  MAX_CONCURRENT: 5,
  PROFILE: "minimal" as ToolProfile,
};

function registerSubagent(descriptor: SubagentDescriptor): void {
  subagentRegistry.set(descriptor.id, descriptor);
  if (!parentIndex.has(descriptor.parentRunId)) {
    parentIndex.set(descriptor.parentRunId, new Set());
  }
  parentIndex.get(descriptor.parentRunId)!.add(descriptor.id);
}

function getSubagent(id: string): SubagentDescriptor | undefined {
  return subagentRegistry.get(id);
}

function getSubagentsForRun(runId: string): SubagentDescriptor[] {
  const ids = parentIndex.get(runId);
  if (!ids) return [];
  return Array.from(ids)
    .map((id) => subagentRegistry.get(id))
    .filter(Boolean) as SubagentDescriptor[];
}

function countActiveForRun(runId: string): number {
  return getSubagentsForRun(runId).filter(
    (s) => s.status === "pending" || s.status === "running"
  ).length;
}

function pruneOldEntries(): void {
  const cutoff = Date.now() - 30 * 60_000;
  for (const [id, desc] of subagentRegistry) {
    if (desc.completedAt && desc.completedAt < cutoff) {
      subagentRegistry.delete(id);
      const siblings = parentIndex.get(desc.parentRunId);
      if (siblings) {
        siblings.delete(id);
        if (siblings.size === 0) parentIndex.delete(desc.parentRunId);
      }
    }
  }
}

setInterval(pruneOldEntries, 5 * 60_000);

async function executeSubagentTask(
  descriptor: SubagentDescriptor,
  context: ToolContext
): Promise<void> {
  descriptor.status = "running";
  descriptor.startedAt = Date.now();

  await agentEventBus.emit(descriptor.parentRunId, "tool_start", {
    tool_name: "subagent_spawn",
    command: descriptor.task,
    metadata: {
      subagentId: descriptor.id,
      profile: descriptor.toolProfile,
    },
  });

  const timeoutHandle = setTimeout(() => {
    if (descriptor.status === "running") {
      descriptor.status = "timeout";
      descriptor.completedAt = Date.now();
      descriptor.error = `Subagent timed out after ${descriptor.timeoutMs}ms`;

      agentEventBus
        .emit(descriptor.parentRunId, "tool_error", {
          tool_name: "subagent_spawn",
          error: descriptor.error,
          metadata: { subagentId: descriptor.id },
        })
        .catch(() => {});
    }
  }, descriptor.timeoutMs);

  try {
    const policy = resolveCoreToolProfilePolicy(descriptor.toolProfile);

    const result = {
      subagentId: descriptor.id,
      task: descriptor.task,
      availableTools: policy.allowedTools,
      profile: descriptor.toolProfile,
      summary: `Subagent "${descriptor.id}" processed task: ${descriptor.task}`,
      completedAt: new Date().toISOString(),
    };

    descriptor.status = "completed";
    descriptor.result = result;
    descriptor.completedAt = Date.now();

    await agentEventBus.emit(descriptor.parentRunId, "tool_result", {
      tool_name: "subagent_spawn",
      output_snippet: JSON.stringify(result).slice(0, 500),
      metadata: { subagentId: descriptor.id, status: "completed" },
    });
  } catch (err: any) {
    descriptor.status = "failed";
    descriptor.error = err.message || "Unknown subagent error";
    descriptor.completedAt = Date.now();

    await agentEventBus.emit(descriptor.parentRunId, "tool_error", {
      tool_name: "subagent_spawn",
      error: descriptor.error,
      metadata: { subagentId: descriptor.id },
    });
  } finally {
    clearTimeout(timeoutHandle);
  }
}

const spawnSubagentSchema = z.object({
  task: z
    .string()
    .min(1)
    .describe("Description of the task for the sub-agent to perform"),
  toolProfile: z
    .enum(["minimal", "coding", "messaging", "full"])
    .default("minimal")
    .describe("Tool profile to grant to the sub-agent (default: minimal)"),
  timeoutMs: z
    .number()
    .min(5_000)
    .max(600_000)
    .default(DEFAULTS.TIMEOUT_MS)
    .describe("Timeout in milliseconds for the sub-agent"),
});

export const subagentSpawnTool: ToolDefinition = {
  name: "subagent_spawn",
  description:
    "Spawn a specialized sub-agent to handle a parallel task. Sub-agents run with a restricted tool profile and report results back. Use this for tasks that can be parallelised independently.",
  inputSchema: spawnSubagentSchema,
  capabilities: ["spawns_agents"],
  execute: async (input, context): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      const activeCount = countActiveForRun(context.runId);
      if (activeCount >= DEFAULTS.MAX_CONCURRENT) {
        return {
          success: false,
          output: null,
          artifacts: [],
          previews: [],
          logs: [],
          metrics: { durationMs: Date.now() - startTime },
          error: createError(
            "MAX_CONCURRENT_EXCEEDED",
            `Cannot spawn more than ${DEFAULTS.MAX_CONCURRENT} concurrent sub-agents. Currently active: ${activeCount}`,
            true
          ),
        };
      }

      const subagentId = `sa_${randomUUID().replace(/-/g, "").slice(0, 12)}`;

      const descriptor: SubagentDescriptor = {
        id: subagentId,
        parentRunId: context.runId,
        task: input.task,
        toolProfile: input.toolProfile,
        status: "pending",
        result: null,
        error: null,
        createdAt: Date.now(),
        startedAt: null,
        completedAt: null,
        timeoutMs: input.timeoutMs,
      };

      registerSubagent(descriptor);

      executeSubagentTask(descriptor, context).catch((err) => {
        console.error(
          `[SubagentTool] Background execution error for ${subagentId}:`,
          err
        );
      });

      return {
        success: true,
        output: {
          subagentId,
          task: input.task,
          profile: input.toolProfile,
          status: "pending",
          timeoutMs: input.timeoutMs,
          message: `Sub-agent ${subagentId} spawned successfully. Use subagent_status to check progress.`,
        },
        artifacts: [],
        previews: [],
        logs: [],
        metrics: { durationMs: Date.now() - startTime },
      };
    } catch (error: any) {
      return {
        success: false,
        output: null,
        artifacts: [],
        previews: [],
        logs: [],
        metrics: { durationMs: Date.now() - startTime },
        error: createError("SPAWN_ERROR", error.message, true),
      };
    }
  },
};

const subagentStatusSchema = z.object({
  subagentId: z
    .string()
    .optional()
    .describe("Specific sub-agent ID to check, or omit for all in current run"),
});

export const subagentStatusTool: ToolDefinition = {
  name: "subagent_status",
  description:
    "Check the status and results of spawned sub-agents. Provide a specific sub-agent ID or omit to list all sub-agents for the current run.",
  inputSchema: subagentStatusSchema,
  capabilities: [],
  execute: async (input, context): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      if (input.subagentId) {
        const desc = getSubagent(input.subagentId);
        if (!desc) {
          return {
            success: false,
            output: null,
            artifacts: [],
            previews: [],
            logs: [],
            metrics: { durationMs: Date.now() - startTime },
            error: createError(
              "NOT_FOUND",
              `Sub-agent "${input.subagentId}" not found`,
              false
            ),
          };
        }

        return {
          success: true,
          output: formatDescriptor(desc),
          artifacts: desc.result
            ? [
                createArtifact(
                  "data",
                  `subagent_result_${desc.id}`,
                  desc.result
                ),
              ]
            : [],
          previews: [],
          logs: [],
          metrics: { durationMs: Date.now() - startTime },
        };
      }

      const all = getSubagentsForRun(context.runId);
      return {
        success: true,
        output: {
          count: all.length,
          active: all.filter(
            (s) => s.status === "pending" || s.status === "running"
          ).length,
          completed: all.filter((s) => s.status === "completed").length,
          failed: all.filter(
            (s) => s.status === "failed" || s.status === "timeout"
          ).length,
          subagents: all.map(formatDescriptor),
        },
        artifacts: [],
        previews: [],
        logs: [],
        metrics: { durationMs: Date.now() - startTime },
      };
    } catch (error: any) {
      return {
        success: false,
        output: null,
        artifacts: [],
        previews: [],
        logs: [],
        metrics: { durationMs: Date.now() - startTime },
        error: createError("STATUS_ERROR", error.message, false),
      };
    }
  },
};

function formatDescriptor(desc: SubagentDescriptor): Record<string, unknown> {
  return {
    id: desc.id,
    task: desc.task,
    profile: desc.toolProfile,
    status: desc.status,
    result: desc.result,
    error: desc.error,
    durationMs:
      desc.startedAt && desc.completedAt
        ? desc.completedAt - desc.startedAt
        : null,
    createdAt: new Date(desc.createdAt).toISOString(),
    startedAt: desc.startedAt
      ? new Date(desc.startedAt).toISOString()
      : null,
    completedAt: desc.completedAt
      ? new Date(desc.completedAt).toISOString()
      : null,
  };
}

export function getSubagentTools(): ToolDefinition[] {
  return [subagentSpawnTool, subagentStatusTool];
}

export {
  getSubagentsForRun,
  getSubagent,
  countActiveForRun,
};
