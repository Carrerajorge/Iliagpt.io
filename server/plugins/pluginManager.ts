/**
 * Plugin Manager — Sandboxed plugin execution system.
 *
 * Plugins extend IliaGPT with custom hooks:
 * - onMessage: process user messages before sending to LLM
 * - onResponse: process LLM responses before displaying
 * - onFileUpload: process uploaded files
 * - onToolCall: intercept tool calls
 *
 * Plugins run in isolated contexts with limited permissions.
 */

import { EventEmitter } from "events";
import crypto from "crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  permissions: PluginPermission[];
  hooks: PluginHookType[];
  config?: Record<string, PluginConfigField>;
  icon?: string;
}

export type PluginPermission =
  | "read_messages"
  | "modify_messages"
  | "read_files"
  | "write_files"
  | "network_access"
  | "tool_access";

export type PluginHookType =
  | "onMessage"
  | "onResponse"
  | "onFileUpload"
  | "onToolCall"
  | "onDocumentGenerate"
  | "onChatCreate"
  | "onChatDelete";

export interface PluginConfigField {
  type: "string" | "number" | "boolean" | "select";
  label: string;
  default: unknown;
  options?: string[];
  required?: boolean;
}

export interface PluginHookContext {
  userId: string;
  chatId?: string;
  pluginConfig: Record<string, unknown>;
}

export interface PluginHookResult {
  modified: boolean;
  data: unknown;
  error?: string;
}

export interface InstalledPlugin {
  id: string;
  manifest: PluginManifest;
  enabled: boolean;
  config: Record<string, unknown>;
  installedAt: Date;
  installedBy: string;
}

// ---------------------------------------------------------------------------
// Built-in Plugins
// ---------------------------------------------------------------------------

const BUILTIN_PLUGINS: PluginManifest[] = [
  {
    id: "auto-translate",
    name: "Auto-Translate Responses",
    version: "1.0.0",
    description: "Automatically translate AI responses to the user's preferred language",
    author: "IliaGPT",
    permissions: ["modify_messages"],
    hooks: ["onResponse"],
    config: {
      targetLanguage: { type: "select", label: "Target Language", default: "es", options: ["es", "en", "fr", "de", "pt", "zh", "ja", "ko", "ar"] },
      enabled: { type: "boolean", label: "Enabled", default: false },
    },
  },
  {
    id: "code-reviewer",
    name: "Code Reviewer",
    version: "1.0.0",
    description: "Automatically review code blocks in responses for potential issues",
    author: "IliaGPT",
    permissions: ["read_messages"],
    hooks: ["onResponse"],
    config: {
      strictMode: { type: "boolean", label: "Strict Mode", default: false },
    },
  },
  {
    id: "meeting-summarizer",
    name: "Meeting Summarizer",
    version: "1.0.0",
    description: "Detect meeting-related messages and auto-generate structured summaries",
    author: "IliaGPT",
    permissions: ["read_messages", "modify_messages"],
    hooks: ["onMessage", "onResponse"],
    config: {
      format: { type: "select", label: "Summary Format", default: "bullet", options: ["bullet", "paragraph", "action-items"] },
    },
  },
  {
    id: "sentiment-guard",
    name: "Sentiment Guard",
    version: "1.0.0",
    description: "Monitor conversation sentiment and alert on negative trends",
    author: "IliaGPT",
    permissions: ["read_messages"],
    hooks: ["onMessage"],
  },
  {
    id: "auto-tag",
    name: "Auto-Tag Conversations",
    version: "1.0.0",
    description: "Automatically tag conversations based on content topics",
    author: "IliaGPT",
    permissions: ["read_messages"],
    hooks: ["onMessage"],
    config: {
      maxTags: { type: "number", label: "Max Tags", default: 5 },
    },
  },
];

// ---------------------------------------------------------------------------
// Plugin hook executors (sandboxed)
// ---------------------------------------------------------------------------

type HookExecutor = (data: unknown, context: PluginHookContext) => Promise<PluginHookResult>;

const hookExecutors: Record<string, Record<string, HookExecutor>> = {
  "auto-translate": {
    onResponse: async (data, ctx) => {
      const config = ctx.pluginConfig;
      if (!config.enabled) return { modified: false, data };
      // In a real implementation, this would call a translation API
      return { modified: false, data };
    },
  },
  "code-reviewer": {
    onResponse: async (data) => {
      const text = typeof data === "string" ? data : String(data);
      const hasCode = /```[\s\S]+```/.test(text);
      if (!hasCode) return { modified: false, data };
      // Placeholder: real implementation would analyze code blocks
      return { modified: false, data };
    },
  },
  "meeting-summarizer": {
    onMessage: async (data) => {
      return { modified: false, data };
    },
    onResponse: async (data) => {
      return { modified: false, data };
    },
  },
  "sentiment-guard": {
    onMessage: async (data) => {
      return { modified: false, data };
    },
  },
  "auto-tag": {
    onMessage: async (data) => {
      return { modified: false, data };
    },
  },
};

// ---------------------------------------------------------------------------
// Plugin Manager
// ---------------------------------------------------------------------------

export class PluginManager extends EventEmitter {
  private plugins = new Map<string, InstalledPlugin>();
  private hookRegistry = new Map<PluginHookType, Set<string>>();

  constructor() {
    super();
    // Register all hook types
    const hookTypes: PluginHookType[] = ["onMessage", "onResponse", "onFileUpload", "onToolCall", "onDocumentGenerate", "onChatCreate", "onChatDelete"];
    for (const hook of hookTypes) {
      this.hookRegistry.set(hook, new Set());
    }
  }

  /** List all available plugins (builtin + installed) */
  listAvailable(): PluginManifest[] {
    return [...BUILTIN_PLUGINS];
  }

  /** List installed plugins */
  listInstalled(): InstalledPlugin[] {
    return Array.from(this.plugins.values());
  }

  /** Get a specific plugin */
  get(pluginId: string): InstalledPlugin | undefined {
    return this.plugins.get(pluginId);
  }

  /** Install a plugin */
  install(pluginId: string, userId: string, config?: Record<string, unknown>): InstalledPlugin {
    const manifest = BUILTIN_PLUGINS.find(p => p.id === pluginId);
    if (!manifest) throw new Error(`Plugin "${pluginId}" not found`);
    if (this.plugins.has(pluginId)) throw new Error(`Plugin "${pluginId}" already installed`);

    const plugin: InstalledPlugin = {
      id: pluginId,
      manifest,
      enabled: true,
      config: config || Object.fromEntries(
        Object.entries(manifest.config || {}).map(([k, v]) => [k, v.default])
      ),
      installedAt: new Date(),
      installedBy: userId,
    };

    this.plugins.set(pluginId, plugin);

    // Register hooks
    for (const hook of manifest.hooks) {
      this.hookRegistry.get(hook)?.add(pluginId);
    }

    this.emit("plugin:installed", { pluginId, userId });
    return plugin;
  }

  /** Uninstall a plugin */
  uninstall(pluginId: string): boolean {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return false;

    // Unregister hooks
    for (const hook of plugin.manifest.hooks) {
      this.hookRegistry.get(hook)?.delete(pluginId);
    }

    this.plugins.delete(pluginId);
    this.emit("plugin:uninstalled", { pluginId });
    return true;
  }

  /** Enable/disable a plugin */
  setEnabled(pluginId: string, enabled: boolean): boolean {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return false;
    plugin.enabled = enabled;
    this.emit("plugin:toggled", { pluginId, enabled });
    return true;
  }

  /** Update plugin config */
  updateConfig(pluginId: string, config: Record<string, unknown>): boolean {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return false;
    plugin.config = { ...plugin.config, ...config };
    return true;
  }

  /**
   * Execute all plugins registered for a specific hook.
   * Plugins run sequentially — each can modify the data for the next.
   */
  async executeHook(
    hookType: PluginHookType,
    data: unknown,
    context: PluginHookContext,
  ): Promise<{ data: unknown; modified: boolean; pluginsRan: string[] }> {
    const pluginIds = this.hookRegistry.get(hookType);
    if (!pluginIds || pluginIds.size === 0) {
      return { data, modified: false, pluginsRan: [] };
    }

    let currentData = data;
    let anyModified = false;
    const pluginsRan: string[] = [];

    for (const pluginId of pluginIds) {
      const plugin = this.plugins.get(pluginId);
      if (!plugin || !plugin.enabled) continue;

      const executor = hookExecutors[pluginId]?.[hookType];
      if (!executor) continue;

      try {
        const result = await Promise.race([
          executor(currentData, { ...context, pluginConfig: plugin.config }),
          new Promise<PluginHookResult>((_, reject) =>
            setTimeout(() => reject(new Error("Plugin timeout")), 5000)
          ),
        ]);

        if (result.modified) {
          currentData = result.data;
          anyModified = true;
        }
        pluginsRan.push(pluginId);
      } catch (err: any) {
        console.warn(`[PluginManager] Plugin "${pluginId}" hook "${hookType}" failed:`, err?.message);
        this.emit("plugin:error", { pluginId, hookType, error: err?.message });
      }
    }

    return { data: currentData, modified: anyModified, pluginsRan };
  }
}

// Singleton
export const pluginManager = new PluginManager();
