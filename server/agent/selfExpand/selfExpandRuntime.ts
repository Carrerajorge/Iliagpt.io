import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { z } from "zod";
import type { FunctionDeclaration } from "../../config/agentTools";
import type { ToolContext, ToolDefinition } from "../toolRegistry";
import { zodToJsonSchema } from "zod-to-json-schema";

export type SelfExpandSource = {
  provider: "github" | "gitlab" | "npm" | "pypi" | "local" | "unknown";
  name: string;
  url?: string;
  path?: string;
  commit?: string;
};

export type SelfExpandRegistryEntry = {
  toolName: string;
  capability: string;
  description?: string;
  entryPath: string;
  exportName?: string;
  status: "active" | "needs_port" | "failed";
  createdAt: string;
  updatedAt: string;
  source?: SelfExpandSource;
  notes?: string[];
};

export type SelfExpandRegistry = {
  version: number;
  updatedAt: string;
  capabilities: Record<string, SelfExpandRegistryEntry>;
};

const DEFAULT_INPUT_SCHEMA = z.record(z.any()).optional();
const DEFAULT_JSON_SCHEMA = { type: "object", properties: {} };

export function resolveSelfExpandRoot(cwd = process.cwd()): string {
  return path.resolve(cwd, "external", "self_expand");
}

export function resolveSelfExpandRegistryPath(cwd = process.cwd()): string {
  return path.join(resolveSelfExpandRoot(cwd), "registry.json");
}

function isPathInside(rootPath: string, candidatePath: string): boolean {
  const rel = path.relative(rootPath, candidatePath);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export function loadSelfExpandRegistrySync(cwd = process.cwd()): SelfExpandRegistry {
  const registryPath = resolveSelfExpandRegistryPath(cwd);
  try {
    const raw = fs.readFileSync(registryPath, "utf8");
    const parsed = JSON.parse(raw) as SelfExpandRegistry;
    if (parsed && parsed.capabilities) {
      return parsed;
    }
  } catch {
    // ignore
  }
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    capabilities: {},
  };
}

export function saveSelfExpandRegistrySync(registry: SelfExpandRegistry, cwd = process.cwd()): void {
  const registryPath = resolveSelfExpandRegistryPath(cwd);
  const root = path.dirname(registryPath);
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2));
}

export function upsertSelfExpandRegistryEntrySync(
  entry: SelfExpandRegistryEntry,
  cwd = process.cwd(),
): SelfExpandRegistry {
  const registry = loadSelfExpandRegistrySync(cwd);
  registry.capabilities[entry.toolName] = entry;
  registry.updatedAt = new Date().toISOString();
  saveSelfExpandRegistrySync(registry, cwd);
  return registry;
}

function resolveEntryPath(entry: SelfExpandRegistryEntry, cwd = process.cwd()): string {
  const root = resolveSelfExpandRoot(cwd);
  const abs = path.resolve(cwd, entry.entryPath);
  if (!isPathInside(root, abs)) {
    throw new Error(`SelfExpand entryPath escapes root: ${entry.entryPath}`);
  }
  return abs;
}

function pickHandler(mod: Record<string, any>, exportName?: string): any {
  if (exportName && mod && typeof mod[exportName] !== "undefined") return mod[exportName];
  if (mod?.default) return mod.default;
  if (typeof mod?.handler === "function") return mod.handler;
  if (typeof mod?.execute === "function") return mod.execute;
  return undefined;
}

async function invokeHandler(handler: any, input: any, context: ToolContext): Promise<any> {
  if (typeof handler === "function") {
    if (handler.length >= 2) {
      const maybe = handler(input, context);
      return await Promise.resolve(maybe);
    }
    if (input && typeof input === "object") {
      const keys = Object.keys(input);
      if (keys.length === 1 && typeof input[keys[0]] !== "object") {
        const maybe = handler(input[keys[0]]);
        return await Promise.resolve(maybe);
      }
      if (typeof input.text === "string") {
        const maybe = handler(input.text);
        return await Promise.resolve(maybe);
      }
      if (typeof input.value === "string") {
        const maybe = handler(input.value);
        return await Promise.resolve(maybe);
      }
    }
    const maybe = handler(input);
    return await Promise.resolve(maybe);
  }
  if (handler && typeof handler.execute === "function") {
    return await handler.execute(input, context);
  }
  if (handler && typeof handler.run === "function") {
    return await handler.run(input, context);
  }
  if (typeof handler === "object") {
    return handler;
  }
  throw new Error("No invocable handler found in fused module");
}

export function createFusedToolDefinition(
  entry: SelfExpandRegistryEntry,
  cwd = process.cwd(),
): ToolDefinition {
  return {
    name: entry.toolName,
    description: entry.description || `Fused capability: ${entry.toolName}`,
    inputSchema: DEFAULT_INPUT_SCHEMA,
    capabilities: ["executes_code"],
    timeoutMs: 120000,
    execute: async (input: any, context: ToolContext): Promise<ToolResult> => {
      const startTime = Date.now();
      try {
        const entryPath = resolveEntryPath(entry, cwd);
        const mod = await import(pathToFileURL(entryPath).href);
        const handler = pickHandler(mod, entry.exportName);
        const output = await invokeHandler(handler, input, context);
        return {
          success: true,
          output,
          metrics: { durationMs: Date.now() - startTime },
        };
      } catch (error: any) {
        return {
          success: false,
          output: null,
          error: {
            code: "SELF_EXPAND_EXEC_ERROR",
            message: error?.message || "Failed to execute fused capability",
            retryable: false,
          },
          metrics: { durationMs: Date.now() - startTime },
        };
      }
    },
  };
}

export function getSelfExpandToolDefinitions(cwd = process.cwd()): ToolDefinition[] {
  const registry = loadSelfExpandRegistrySync(cwd);
  return Object.values(registry.capabilities)
    .filter((entry) => entry.status === "active")
    .map((entry) => createFusedToolDefinition(entry, cwd));
}

export function getSelfExpandToolDeclarations(cwd = process.cwd()): FunctionDeclaration[] {
  const registry = loadSelfExpandRegistrySync(cwd);
  const schema = zodToJsonSchema(DEFAULT_INPUT_SCHEMA, { target: "jsonSchema7" }) as any;
  if (schema.$schema) delete schema.$schema;
  if (schema.additionalProperties !== undefined) delete schema.additionalProperties;
  const parameters = schema || DEFAULT_JSON_SCHEMA;
  return Object.values(registry.capabilities)
    .filter((entry) => entry.status === "active")
    .map((entry) => ({
      name: entry.toolName,
      description: entry.description || `Fused capability: ${entry.toolName}`,
      parameters,
    }));
}
