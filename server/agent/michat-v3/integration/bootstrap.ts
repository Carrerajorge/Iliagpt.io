/**
 * MICHAT v3 Bootstrap
 * 
 * Import this file in server/index.ts or server/services/chatService.ts
 * to enable enterprise features when MICHAT_V3_ENABLED=true
 * 
 * Usage:
 * ```typescript
 * import { bootstrapMichatV3, michatExecuteTool, isMichatEnabled } from './agent/michat-v3/integration/bootstrap';
 * 
 * // At server startup
 * bootstrapMichatV3();
 * 
 * // In tool execution
 * if (isMichatEnabled()) {
 *   const result = await michatExecuteTool(toolName, params, user);
 * }
 * ```
 */

import { getMichatBridge, type LegacyToolConfig } from "./adapter";

const MICHAT_V3_ENABLED = process.env.MICHAT_V3_ENABLED === "true";

let initialized = false;

export function isMichatEnabled(): boolean {
  return MICHAT_V3_ENABLED && initialized;
}

export function bootstrapMichatV3(tools?: LegacyToolConfig[]): void {
  if (!MICHAT_V3_ENABLED) {
    console.log("[MICHAT v3] Enterprise mode disabled (set MICHAT_V3_ENABLED=true to enable)");
    return;
  }

  if (initialized) {
    console.log("[MICHAT v3] Already initialized");
    return;
  }

  console.log("[MICHAT v3] Initializing enterprise architecture...");

  const bridge = getMichatBridge({
    TIMEOUT_MS: 30000,
    MAX_CONCURRENCY: 10,
    ENABLE_AUDIT: true,
    LOG_LEVEL: (process.env.LOG_LEVEL as any) || "info",
  });

  if (tools) {
    for (const tool of tools) {
      try {
        bridge.registerLegacyTool(tool);
      } catch (err) {
        console.error(`[MICHAT v3] Failed to register tool ${tool.name}:`, err);
      }
    }
  }

  initialized = true;
  const toolCount = bridge.tools.list().length;
  console.log(`[MICHAT v3] Enterprise mode active with ${toolCount} registered tools`);
}

export async function michatExecuteTool(
  toolName: string,
  params: Record<string, unknown>,
  user?: { id?: string; email?: string; plan?: string },
  runId?: string
): Promise<unknown> {
  if (!isMichatEnabled()) {
    throw new Error("[MICHAT v3] Not initialized. Call bootstrapMichatV3() first.");
  }

  const bridge = getMichatBridge();
  return bridge.executeTool(toolName, params, user, runId);
}

export async function michatRunWorkflow(
  steps: Array<{ id: string; tool: string; params: unknown; dependsOn?: string[] }>,
  user?: { id?: string; email?: string; plan?: string }
) {
  if (!isMichatEnabled()) {
    throw new Error("[MICHAT v3] Not initialized. Call bootstrapMichatV3() first.");
  }

  const bridge = getMichatBridge();
  return bridge.runWorkflow(steps, user);
}

export function michatRegisterTool(tool: LegacyToolConfig): void {
  if (!isMichatEnabled()) {
    throw new Error("[MICHAT v3] Not initialized. Call bootstrapMichatV3() first.");
  }

  const bridge = getMichatBridge();
  bridge.registerLegacyTool(tool);
}

export function michatGetMetrics() {
  if (!isMichatEnabled()) return null;
  return getMichatBridge().getMetrics();
}

export function michatGetAuditLog(filter?: { actor?: string; resource?: string }, limit?: number) {
  if (!isMichatEnabled()) return [];
  return getMichatBridge().getAuditLog(filter, limit);
}

export function michatGetCircuitState(toolName: string) {
  if (!isMichatEnabled()) return null;
  return getMichatBridge().getCircuitState(toolName);
}
