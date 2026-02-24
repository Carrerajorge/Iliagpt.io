/**
 * ILIAGPT v3 Bootstrap
 * 
 * Import this file in server/index.ts or server/services/chatService.ts
 * to enable enterprise features when ILIAGPT_V3_ENABLED=true
 * 
 * Usage:
 * ```typescript
 * import { bootstrapIliagptV3, iliagptExecuteTool, isIliagptEnabled } from './agent/iliagpt-v3/integration/bootstrap';
 * 
 * // At server startup
 * bootstrapIliagptV3();
 * 
 * // In tool execution
 * if (isIliagptEnabled()) {
 *   const result = await iliagptExecuteTool(toolName, params, user);
 * }
 * ```
 */

import { getIliagptBridge, type LegacyToolConfig } from "./adapter";

const ILIAGPT_V3_ENABLED = process.env.ILIAGPT_V3_ENABLED === "true";

let initialized = false;

export function isIliagptEnabled(): boolean {
  return ILIAGPT_V3_ENABLED && initialized;
}

export function bootstrapIliagptV3(tools?: LegacyToolConfig[]): void {
  if (!ILIAGPT_V3_ENABLED) {
    console.log("[ILIAGPT v3] Enterprise mode disabled (set ILIAGPT_V3_ENABLED=true to enable)");
    return;
  }

  if (initialized) {
    console.log("[ILIAGPT v3] Already initialized");
    return;
  }

  console.log("[ILIAGPT v3] Initializing enterprise architecture...");

  const bridge = getIliagptBridge({
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
        console.error(`[ILIAGPT v3] Failed to register tool ${tool.name}:`, err);
      }
    }
  }

  initialized = true;
  const toolCount = bridge.tools.list().length;
  console.log(`[ILIAGPT v3] Enterprise mode active with ${toolCount} registered tools`);
}

export async function iliagptExecuteTool(
  toolName: string,
  params: Record<string, unknown>,
  user?: { id?: string; email?: string; plan?: string },
  runId?: string
): Promise<unknown> {
  if (!isIliagptEnabled()) {
    throw new Error("[ILIAGPT v3] Not initialized. Call bootstrapIliagptV3() first.");
  }

  const bridge = getIliagptBridge();
  return bridge.executeTool(toolName, params, user, runId);
}

export async function iliagptRunWorkflow(
  steps: Array<{ id: string; tool: string; params: unknown; dependsOn?: string[] }>,
  user?: { id?: string; email?: string; plan?: string }
) {
  if (!isIliagptEnabled()) {
    throw new Error("[ILIAGPT v3] Not initialized. Call bootstrapIliagptV3() first.");
  }

  const bridge = getIliagptBridge();
  return bridge.runWorkflow(steps, user);
}

export function iliagptRegisterTool(tool: LegacyToolConfig): void {
  if (!isIliagptEnabled()) {
    throw new Error("[ILIAGPT v3] Not initialized. Call bootstrapIliagptV3() first.");
  }

  const bridge = getIliagptBridge();
  bridge.registerLegacyTool(tool);
}

export function iliagptGetMetrics() {
  if (!isIliagptEnabled()) return null;
  return getIliagptBridge().getMetrics();
}

export function iliagptGetAuditLog(filter?: { actor?: string; resource?: string }, limit?: number) {
  if (!isIliagptEnabled()) return [];
  return getIliagptBridge().getAuditLog(filter, limit);
}

export function iliagptGetCircuitState(toolName: string) {
  if (!isIliagptEnabled()) return null;
  return getIliagptBridge().getCircuitState(toolName);
}
