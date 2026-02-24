/**
 * ConnectorRegistry — Runtime registry for connector manifests.
 *
 * Responsibilities:
 *  1. Store and retrieve ConnectorManifest instances
 *  2. Convert capabilities → Gemini FunctionDeclaration[]
 *  3. Convert capabilities → ToolDefinition[] for the main ToolRegistry
 *  4. Filter capabilities per-user based on IntegrationPolicy
 */

import type {
  ConnectorManifest,
  ConnectorCapability,
  GeminiFunctionDeclaration,
  ResolvedCredential,
  ConnectorOperationResult,
  JSONSchema7,
} from "./types";

// ─── Interfaces for dependency injection (no circular imports) ──────

export interface CredentialResolver {
  resolve(userId: string, providerId: string): Promise<ResolvedCredential | null>;
}

export interface ConnectorExecutorInterface {
  execute(
    connectorId: string,
    operationId: string,
    input: Record<string, unknown>,
    context: { userId: string; chatId: string; runId: string; isConfirmed?: boolean; signal?: AbortSignal }
  ): Promise<ConnectorOperationResult>;
}

export interface UserPolicy {
  enabledApps?: string[] | null;
  enabledTools?: string[] | null;
  disabledTools?: string[] | null;
}

// ─── JSON Schema → Gemini Parameters ───────────────────────────────

function jsonSchemaToGeminiParams(schema: JSONSchema7): GeminiFunctionDeclaration["parameters"] {
  // Gemini expects a flat { type: "object", properties: {...}, required: [...] }
  // with NO $ref — we must inline/flatten everything.
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  if (schema.type !== "object" || !schema.properties) {
    // Fallback: wrap non-object schemas as a single "input" property
    return {
      type: "object",
      properties: { input: flattenSchema(schema) },
      required: ["input"],
    };
  }

  for (const [key, prop] of Object.entries(schema.properties)) {
    if (typeof prop === "boolean") continue;
    properties[key] = flattenSchema(prop);
  }

  if (Array.isArray(schema.required)) {
    required.push(...schema.required);
  }

  return { type: "object", properties, required: required.length > 0 ? required : undefined };
}

/** Recursively flatten a JSON Schema node, removing $ref and unsupported keywords */
function flattenSchema(schema: JSONSchema7 | boolean): Record<string, unknown> {
  if (typeof schema === "boolean") return { type: "string" };

  const result: Record<string, unknown> = {};

  if (schema.type) result.type = schema.type;
  if (schema.description) result.description = schema.description;
  if (schema.enum) result.enum = schema.enum;
  if (schema.default !== undefined) result.default = schema.default;

  // Handle arrays
  if (schema.type === "array" && schema.items) {
    if (typeof schema.items === "boolean") {
      result.items = { type: "string" };
    } else if (Array.isArray(schema.items)) {
      // tuple — just take the first item schema
      const first = schema.items[0];
      result.items = typeof first === "boolean" || !first ? { type: "string" } : flattenSchema(first);
    } else {
      result.items = flattenSchema(schema.items);
    }
  }

  // Handle nested objects
  if (schema.type === "object" && schema.properties) {
    const props: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(schema.properties)) {
      props[k] = typeof v === "boolean" ? { type: "string" } : flattenSchema(v);
    }
    result.properties = props;
    if (Array.isArray(schema.required) && schema.required.length > 0) {
      result.required = schema.required;
    }
  }

  // Gemini doesn't support these — strip them
  // ($ref, allOf, anyOf, oneOf, if/then/else, etc.)

  return result;
}

// ─── ConnectorRegistry ──────────────────────────────────────────────

export class ConnectorRegistry {
  private manifests = new Map<string, ConnectorManifest>();
  private handlers = new Map<string, ConnectorHandlerFactory>();

  /** Register a connector manifest */
  register(manifest: ConnectorManifest): void {
    // Validate operation IDs are unique and ≤64 chars
    for (const cap of manifest.capabilities) {
      if (cap.operationId.length > 64) {
        console.warn(
          `[ConnectorRegistry] operationId "${cap.operationId}" exceeds 64 chars — ` +
          `Gemini will reject this. Truncating.`
        );
      }
    }

    this.manifests.set(manifest.connectorId, manifest);
    console.log(
      `[ConnectorRegistry] Registered: ${manifest.connectorId} v${manifest.version} ` +
      `(${manifest.capabilities.length} capabilities)`
    );
  }

  /** Register the handler factory for a connector */
  registerHandler(connectorId: string, factory: ConnectorHandlerFactory): void {
    this.handlers.set(connectorId, factory);
  }

  /** Get a manifest by ID */
  get(connectorId: string): ConnectorManifest | undefined {
    return this.manifests.get(connectorId);
  }

  /** Get handler factory by connector ID */
  getHandler(connectorId: string): ConnectorHandlerFactory | undefined {
    return this.handlers.get(connectorId);
  }

  /** Check if a tool name belongs to any registered connector */
  isConnectorTool(toolName: string): boolean {
    for (const manifest of Array.from(this.manifests.values())) {
      for (const cap of manifest.capabilities) {
        if (cap.operationId === toolName) return true;
      }
    }
    return false;
  }

  /** Resolve connectorId from a tool name */
  resolveConnectorId(toolName: string): string | undefined {
    for (const [connectorId, manifest] of Array.from(this.manifests.entries())) {
      for (const cap of manifest.capabilities) {
        if (cap.operationId === toolName) return connectorId;
      }
    }
    return undefined;
  }

  /** List all enabled connectors */
  listEnabled(): ConnectorManifest[] {
    return Array.from(this.manifests.values());
  }

  /** List all connector IDs */
  listIds(): string[] {
    return Array.from(this.manifests.keys());
  }

  /** Get total count */
  get size(): number {
    return this.manifests.size;
  }

  // ─── Gemini FunctionDeclaration conversion ──────────────────────

  /** Convert a connector's capabilities to Gemini FunctionDeclaration format.
   *  Optionally filter by a whitelist of operation IDs. */
  toGeminiFunctionDeclarations(
    connectorId: string,
    enabledOperations?: string[] | null
  ): GeminiFunctionDeclaration[] {
    const manifest = this.manifests.get(connectorId);
    if (!manifest) return [];

    return manifest.capabilities
      .filter((cap) => !enabledOperations || enabledOperations.includes(cap.operationId))
      .map((cap) => ({
        name: cap.operationId.slice(0, 64),
        description: cap.description.slice(0, 200),
        parameters: jsonSchemaToGeminiParams(cap.inputSchema),
      }));
  }

  /** Get all Gemini FunctionDeclarations for a user, respecting their policy */
  getAllDeclarationsForUser(userPolicy: UserPolicy): GeminiFunctionDeclaration[] {
    const decls: GeminiFunctionDeclaration[] = [];
    const enabledApps = userPolicy.enabledApps;
    const disabledTools = new Set(userPolicy.disabledTools || []);

    for (const manifest of Array.from(this.manifests.values())) {
      // If user has an enabledApps whitelist, skip connectors not in it
      if (enabledApps && enabledApps.length > 0 && !enabledApps.includes(manifest.connectorId)) {
        continue;
      }

      for (const cap of manifest.capabilities) {
        if (disabledTools.has(cap.operationId)) continue;

        decls.push({
          name: cap.operationId.slice(0, 64),
          description: cap.description.slice(0, 200),
          parameters: jsonSchemaToGeminiParams(cap.inputSchema),
        });
      }
    }

    return decls;
  }

  // ─── ToolDefinition conversion ──────────────────────────────────

  /** Convert a connector's capabilities to ToolDefinition[] for the main ToolRegistry.
   *  Each ToolDefinition.execute() delegates to the ConnectorExecutor. */
  toToolDefinitions(
    connectorId: string,
    credentialResolver: CredentialResolver,
    executor: ConnectorExecutorInterface
  ): ToolDefinition[] {
    const manifest = this.manifests.get(connectorId);
    if (!manifest) return [];

    return manifest.capabilities.map((cap) => {
      const zodSchema = jsonSchemaToZodLazy(cap.inputSchema);

      return {
        name: cap.operationId,
        description: cap.description,
        inputSchema: zodSchema,
        capabilities: buildToolCapabilities(cap),
        execute: async (input: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult> => {
          const startTime = Date.now();

          // Check confirmation for write ops
          if (cap.confirmationRequired && context.isConfirmed !== true) {
            return {
              success: false,
              output: null,
              error: {
                code: "REQUIRES_CONFIRMATION",
                message: `Operation "${cap.name}" requires confirmation before execution.`,
                retryable: false,
                details: { connectorId, operationId: cap.operationId },
              },
              metrics: { durationMs: Date.now() - startTime },
            };
          }

          try {
            const result = await executor.execute(
              connectorId,
              cap.operationId,
              input as Record<string, unknown>,
              {
                userId: context.userId,
                chatId: context.chatId,
                runId: context.runId,
                isConfirmed: context.isConfirmed,
                signal: context.signal,
              }
            );

            return {
              success: result.success,
              output: result.data ?? null,
              error: result.error
                ? { code: result.error.code, message: result.error.message, retryable: result.error.retryable }
                : undefined,
              metrics: {
                durationMs: Date.now() - startTime,
                ...(result.metadata?.latencyMs ? { apiCalls: 1 } : {}),
              },
            };
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            return {
              success: false,
              output: null,
              error: { code: "CONNECTOR_ERROR", message: msg, retryable: true },
              metrics: { durationMs: Date.now() - startTime },
            };
          }
        },
      } satisfies ToolDefinition;
    });
  }

  /** Get capabilities filtered by user's policy */
  getCapabilitiesForUser(
    connectorId: string,
    userPolicy: UserPolicy
  ): ConnectorCapability[] {
    const manifest = this.manifests.get(connectorId);
    if (!manifest) return [];

    const enabledTools = userPolicy.enabledTools;
    const disabledTools = new Set(userPolicy.disabledTools || []);

    return manifest.capabilities.filter((cap) => {
      if (disabledTools.has(cap.operationId)) return false;
      if (enabledTools && enabledTools.length > 0 && !enabledTools.includes(cap.operationId)) return false;
      return true;
    });
  }
}

// ─── Helpers ────────────────────────────────────────────────────────

/** Lazy Zod schema from JSON Schema — produces a z.any() with passthrough.
 *  The real validation happens at the Gemini/connector layer via JSON Schema. */
function jsonSchemaToZodLazy(schema: JSONSchema7): import("zod").ZodSchema {
  // We import zod lazily to avoid circular dep issues at module load time
  const { z } = require("zod");

  // For the ToolRegistry, we use a permissive schema — the connector handler
  // does its own validation against the JSON Schema.  This avoids maintaining
  // two sets of schemas (Zod + JSON Schema) for every operation.
  if (schema.type === "object" && schema.properties) {
    const shape: Record<string, unknown> = {};
    for (const key of Object.keys(schema.properties)) {
      shape[key] = z.any().optional();
    }
    if (schema.required && Array.isArray(schema.required)) {
      for (const req of schema.required) {
        shape[req] = z.any();
      }
    }
    return z.object(shape).passthrough();
  }

  return z.any();
}

function buildToolCapabilities(cap: ConnectorCapability): string[] {
  // IMPORTANT: These values must match server/agent/contracts ToolCapabilitySchema.
  // Keep this list minimal and map connector semantics into existing agent capabilities.
  const caps: string[] = ["requires_network", "accesses_external_api"];

  // Treat write/admin access (or explicit confirmation requirement) as high-risk.
  if (
    cap.dataAccessLevel === "write" ||
    cap.dataAccessLevel === "admin" ||
    cap.confirmationRequired
  ) {
    caps.push("high_risk");
  }

  return caps;
}

// ─── Types imported from ToolRegistry to avoid circular dep ─────────

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: import("zod").ZodSchema;
  capabilities?: string[];
  execute: (input: unknown, context: ToolExecutionContext) => Promise<ToolExecutionResult>;
}

interface ToolExecutionContext {
  userId: string;
  chatId: string;
  runId: string;
  isConfirmed?: boolean;
  signal?: AbortSignal;
  [key: string]: unknown;
}

interface ToolExecutionResult {
  success: boolean;
  output: unknown;
  error?: { code: string; message: string; retryable: boolean; details?: unknown };
  metrics?: { durationMs: number; apiCalls?: number };
  artifacts?: unknown[];
  previews?: unknown[];
  logs?: unknown[];
}

export type ConnectorHandlerFactory = {
  execute(
    operationId: string,
    input: Record<string, unknown>,
    credential: ResolvedCredential
  ): Promise<ConnectorOperationResult>;
  healthCheck?(credential?: ResolvedCredential): Promise<{ healthy: boolean; latencyMs: number }>;
};

// ─── Singleton ──────────────────────────────────────────────────────

export const connectorRegistry = new ConnectorRegistry();
