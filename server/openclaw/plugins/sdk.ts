import { createLogger } from "../../utils/logger";
import type { HookContext } from "../types";

const log = createLogger("openclaw-plugin-sdk");

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author?: string;
  hooks: string[];
  config?: Record<string, { type: string; default?: unknown; description: string }>;
}

export interface PluginInstance {
  manifest: PluginManifest;
  onHook: (hookName: string, context: HookContext) => Promise<void>;
  onInit?: () => Promise<void>;
  onShutdown?: () => Promise<void>;
}

export function definePlugin(
  manifest: PluginManifest,
  handlers: {
    hooks: Partial<Record<string, (context: HookContext) => Promise<void>>>;
    init?: () => Promise<void>;
    shutdown?: () => Promise<void>;
  },
): PluginInstance {
  return {
    manifest,
    onHook: async (hookName: string, context: HookContext) => {
      const handler = handlers.hooks[hookName];
      if (handler) {
        try {
          await handler(context);
        } catch (e) {
          log.error("Plugin hook error", {
            plugin: manifest.id,
            hook: hookName,
            error: (e as Error).message,
          });
        }
      }
    },
    onInit: handlers.init,
    onShutdown: handlers.shutdown,
  };
}

// Example usage exported for documentation:
export const EXAMPLE_PLUGIN = `
import { definePlugin } from "./sdk";

export default definePlugin(
  {
    id: "my-plugin",
    name: "My Plugin",
    version: "1.0.0",
    description: "Example plugin",
    hooks: ["before_tool_call", "after_tool_call"],
  },
  {
    hooks: {
      before_tool_call: async (ctx) => {
        console.log("Tool call:", ctx.toolName);
      },
      after_tool_call: async (ctx) => {
        console.log("Tool result:", ctx.toolResult);
      },
    },
    init: async () => {
      console.log("Plugin initialized");
    },
  }
);
`;
