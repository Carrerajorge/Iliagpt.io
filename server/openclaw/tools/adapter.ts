import { toolRegistry } from '../../agent/toolRegistry';
import type { OpenClawConfig } from '../config';
import { createExecTool } from './execTool';
import { createFsTools } from './fsTool';
import { createAgenticTools } from './agenticTools';
import { ToolPolicyEngine } from './toolPolicies';
import { Logger } from '../../lib/logger';

export function registerOpenClawTools(config: OpenClawConfig): void {
  const policy = new ToolPolicyEngine({
    safeBins: config.tools.safeBins,
    security: config.tools.execSecurity,
    timeout: config.tools.execTimeout,
  });

  // Register exec tool
  const execTool = createExecTool(policy, config.tools.workspaceRoot);
  toolRegistry.register(execTool);
  Logger.info(`[OpenClaw:Tools] Registered tool: ${execTool.name}`);

  // Register FS tools
  const fsTools = createFsTools(config.tools.workspaceRoot, true);
  for (const tool of fsTools) {
    toolRegistry.register(tool);
    Logger.info(`[OpenClaw:Tools] Registered tool: ${tool.name}`);
  }

  // Register agentic tools (subagents + RAG bridge)
  const agenticTools = createAgenticTools();
  for (const tool of agenticTools) {
    toolRegistry.register(tool);
    Logger.info(`[OpenClaw:Tools] Registered tool: ${tool.name}`);
  }

  Logger.info(`[OpenClaw:Tools] ${1 + fsTools.length + agenticTools.length} tools registered`);
}
