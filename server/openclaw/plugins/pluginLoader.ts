import type { OpenClawConfig } from '../config';
import type { HookPoint } from '../types';
import { pluginRegistry } from './pluginRegistry';
import type { PluginInstance } from './sdk';
import { Logger } from '../../lib/logger';

/**
 * Adapt a PluginInstance (created via `definePlugin()` in the SDK) into the
 * OpenClawPlugin shape expected by the plugin registry.
 */
function adaptSdkPlugin(instance: PluginInstance) {
  const hookEntries: Partial<Record<HookPoint, (ctx: any) => Promise<void>>> = {};
  for (const hookName of instance.manifest.hooks) {
    hookEntries[hookName as HookPoint] = (ctx) => instance.onHook(hookName, ctx);
  }

  return {
    id: instance.manifest.id,
    version: instance.manifest.version,
    title: instance.manifest.name,
    hooks: hookEntries,
    setup: instance.onInit ? async () => { await instance.onInit!(); } : undefined,
    shutdown: instance.onShutdown ? async () => { await instance.onShutdown!(); } : undefined,
  };
}

/**
 * Register a plugin created with the `definePlugin()` SDK helper.
 */
export async function registerSdkPlugin(instance: PluginInstance): Promise<void> {
  const adapted = adaptSdkPlugin(instance);
  await pluginRegistry.register(adapted);
  Logger.info(`[OpenClaw:Plugins] SDK plugin registered: ${instance.manifest.id}`);
}

export async function initPlugins(_config: OpenClawConfig): Promise<void> {
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
