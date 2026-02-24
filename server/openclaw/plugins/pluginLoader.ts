import type { OpenClawConfig } from '../config';
import { pluginRegistry } from './pluginRegistry';
import { Logger } from '../../lib/logger';

export async function initPlugins(config: OpenClawConfig): Promise<void> {
  // Register built-in audit plugin
  await pluginRegistry.register({
    id: 'builtin-audit',
    title: 'Audit Logger',
    hooks: {
      before_tool_call: async (ctx) => {
        Logger.info(`[Audit] Tool call: ${ctx.toolName} by ${ctx.userId} (run: ${ctx.runId})`);
      },
      after_tool_call: async (ctx) => {
        Logger.info(`[Audit] Tool result: ${ctx.toolName} (run: ${ctx.runId})`);
      },
      error: async (ctx) => {
        Logger.error(`[Audit] Error in run ${ctx.runId}: ${ctx.error?.message}`);
      },
    },
  });

  Logger.info('[OpenClaw:Plugins] Plugin system initialized');
}
