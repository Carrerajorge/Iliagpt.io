import type { OpenClawPlugin } from '../types';
import { hookSystem } from './hookSystem';
import { Logger } from '../../lib/logger';

class PluginRegistry {
  private plugins = new Map<string, OpenClawPlugin>();

  async register(plugin: OpenClawPlugin): Promise<void> {
    if (this.plugins.has(plugin.id)) {
      Logger.warn(`[OpenClaw:Plugins] Plugin ${plugin.id} already registered, skipping`);
      return;
    }

    // Register hooks
    if (plugin.hooks) {
      for (const [point, handler] of Object.entries(plugin.hooks)) {
        if (handler) {
          hookSystem.register(point as any, handler);
        }
      }
    }

    // Run setup
    if (plugin.setup) {
      await plugin.setup({});
    }

    this.plugins.set(plugin.id, plugin);
    Logger.info(`[OpenClaw:Plugins] Plugin registered: ${plugin.id} (${plugin.title || 'untitled'})`);
  }

  async unregister(pluginId: string): Promise<void> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return;

    if (plugin.shutdown) {
      await plugin.shutdown({});
    }

    this.plugins.delete(pluginId);
    Logger.info(`[OpenClaw:Plugins] Plugin unregistered: ${pluginId}`);
  }

  get(id: string): OpenClawPlugin | undefined {
    return this.plugins.get(id);
  }

  list(): OpenClawPlugin[] {
    return Array.from(this.plugins.values());
  }

  async shutdownAll(): Promise<void> {
    for (const plugin of this.plugins.values()) {
      try {
        await plugin.shutdown?.({});
      } catch (err: any) {
        Logger.error(`[OpenClaw:Plugins] Plugin ${plugin.id} shutdown error: ${err.message}`);
      }
    }
    this.plugins.clear();
    hookSystem.clear();
  }
}

export const pluginRegistry = new PluginRegistry();
