import { toolRegistry } from '../../agent/toolRegistry';
import type { ToolDefinition, ToolContext } from '../../agent/toolRegistry';
import type { OpenClawConfig } from '../config';
import { createExecTool } from './execTool';
import { createFsTools } from './fsTool';
import { createAgenticTools } from './agenticTools';
import { registerExtendedTools } from './extendedTools';
import { ToolPolicyEngine } from './toolPolicies';
import { Logger } from '../../lib/logger';
import { openclawMetrics } from '../lib/metrics';
import { auditLog } from '../lib/auditLog';
import { toolRateLimiter } from '../lib/rateLimiter';
import { skillRegistry } from '../skills/skillRegistry';

/** Per-tool timeout overrides (ms). Falls back to config.tools.execTimeout. */
export const TOOL_TIMEOUTS: Record<string, number> = {
  openclaw_exec: 120_000,
  openclaw_read: 10_000,
  openclaw_write: 10_000,
  openclaw_list: 5_000,
};

/**
 * Wraps a tool's execute function with metrics recording, audit logging,
 * and rate-limit enforcement.
 */
function instrumentTool(tool: ToolDefinition): ToolDefinition {
  const originalExecute = tool.execute;

  tool.execute = async (input: any, context: ToolContext) => {
    const userId = context.userId || 'system';

    // Rate-limit check
    if (!toolRateLimiter.consume(tool.name, userId)) {
      const check = toolRateLimiter.check(tool.name, userId);
      return {
        success: false,
        output: null,
        error: {
          code: 'RATE_LIMITED',
          message: `Rate limit exceeded for ${tool.name}. Try again in ${Math.ceil(check.resetIn / 1000)}s.`,
          retryable: true,
        },
      };
    }

    const start = performance.now();
    try {
      const result = await originalExecute(input, context);
      const duration = performance.now() - start;

      openclawMetrics.recordToolCall(tool.name, duration, result.success);
      auditLog.record({
        userId,
        toolId: tool.name,
        input: typeof input === 'object' && input !== null ? input : { raw: input },
        output: { success: result.success },
        durationMs: duration,
      });

      return result;
    } catch (error: any) {
      const duration = performance.now() - start;

      openclawMetrics.recordToolCall(tool.name, duration, false);
      openclawMetrics.recordError();
      auditLog.record({
        userId,
        toolId: tool.name,
        input: typeof input === 'object' && input !== null ? input : { raw: input },
        output: { success: false, error: error?.message || 'Unknown error' },
        durationMs: duration,
      });

      throw error;
    }
  };

  return tool;
}

export function registerOpenClawTools(config: OpenClawConfig): void {
  const policy = new ToolPolicyEngine({
    safeBins: config.tools.safeBins,
    security: config.tools.execSecurity,
    timeout: config.tools.execTimeout,
  });

  // Register exec tool (instrumented)
  const execTool = instrumentTool(createExecTool(policy, config.tools.workspaceRoot));
  toolRegistry.register(execTool);
  Logger.info(`[OpenClaw:Tools] Registered tool: ${execTool.name}`);

  // Register FS tools (instrumented)
  const fsTools = createFsTools(config.tools.workspaceRoot, true);
  for (const tool of fsTools) {
    toolRegistry.register(instrumentTool(tool));
    Logger.info(`[OpenClaw:Tools] Registered tool: ${tool.name}`);
  }

  // Register agentic tools (subagents + RAG bridge, instrumented)
  const agenticTools = createAgenticTools();
  for (const tool of agenticTools) {
    toolRegistry.register(instrumentTool(tool));
    Logger.info(`[OpenClaw:Tools] Registered tool: ${tool.name}`);
  }

  // Register extended tools (screenshot, pdf, code eval, chart, math, diagram)
  const extendedCount = registerExtendedTools(toolRegistry);
  Logger.info(`[OpenClaw:Tools] Extended tools registered: ${extendedCount}`);

  Logger.info(`[OpenClaw:Tools] ${1 + fsTools.length + agenticTools.length + extendedCount} tools registered (instrumented)`);
}

/**
 * Returns the list of tool names that a given skill declares.
 * If the skill is not found or declares no tools, returns an empty array.
 */
export function getToolsForSkill(skillId: string): string[] {
  const skill = skillRegistry.get(skillId);
  return skill?.tools || [];
}

/**
 * Returns the per-tool timeout in ms, falling back to the provided default.
 */
export function getToolTimeout(toolName: string, defaultTimeout?: number): number {
  return TOOL_TIMEOUTS[toolName] ?? defaultTimeout ?? 120_000;
}
