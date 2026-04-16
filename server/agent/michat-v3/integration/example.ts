/**
 * Example integration of MichatBridge with chatService
 * 
 * This shows how to wire the MICHAT v3 enterprise architecture
 * into the existing IliaGPT tool execution flow.
 * 
 * To enable enterprise features:
 * 1. Set MICHAT_V3_ENABLED=true in environment
 * 2. Initialize the bridge at application startup
 * 3. Route tool execution through the bridge
 */

import { getMichatBridge, LegacyToolConfig, resetMichatBridge } from "./adapter";

// Feature flag for gradual rollout
const MICHAT_V3_ENABLED = process.env.MICHAT_V3_ENABLED === "true";

/**
 * Initialize the MICHAT v3 bridge with optional tools
 */
export function initializeMichatBridge(legacyTools?: LegacyToolConfig[]): void {
  if (!MICHAT_V3_ENABLED) {
    console.log("[MICHAT] Enterprise mode disabled");
    return;
  }

  console.log("[MICHAT] Initializing enterprise mode...");
  
  const bridge = getMichatBridge({
    TIMEOUT_MS: 30000,
    MAX_CONCURRENCY: 10,
    ENABLE_AUDIT: true,
    LOG_LEVEL: "info",
  });

  // Register all legacy tools with the enterprise runner
  if (legacyTools) {
    for (const tool of legacyTools) {
      try {
        bridge.registerLegacyTool(tool);
        console.log(`[MICHAT] Registered tool: ${tool.name}`);
      } catch (error) {
        console.error(`[MICHAT] Failed to register tool ${tool.name}:`, error);
      }
    }
  }

  const toolCount = bridge.tools.list().length;
  console.log(`[MICHAT] Enterprise mode active with ${toolCount} tools`);
}

/**
 * Execute a tool through the enterprise runner (if enabled)
 * Falls back to direct execution if disabled
 */
export async function executeToolEnterprise(
  toolName: string,
  params: Record<string, unknown>,
  user?: { id?: string; email?: string; plan?: string },
  runId?: string
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  if (!MICHAT_V3_ENABLED) {
    return { success: false, error: "Enterprise mode not enabled. Set MICHAT_V3_ENABLED=true" };
  }

  // Use enterprise runner with all resilience features
  const bridge = getMichatBridge();
  
  try {
    const result = await bridge.executeTool(toolName, params, user, runId);
    return { success: true, result };
  } catch (error: any) {
    const errorCode = error.code || "E_UNKNOWN";
    const errorMsg = error.message || String(error);
    
    // Log circuit breaker state for debugging
    const circuitState = bridge.getCircuitState(toolName);
    if (circuitState?.state === "OPEN") {
      console.warn(`[MICHAT] Circuit breaker OPEN for tool: ${toolName}`);
    }
    
    return { 
      success: false, 
      error: `[${errorCode}] ${errorMsg}`,
    };
  }
}

/**
 * Get enterprise observability data
 */
export function getEnterpriseMetrics() {
  if (!MICHAT_V3_ENABLED) {
    return null;
  }
  
  const bridge = getMichatBridge();
  const tools = bridge.tools.list();
  
  return {
    metrics: bridge.getMetrics(),
    circuits: Object.fromEntries(
      tools.map(tool => [
        tool.name,
        bridge.getCircuitState(tool.name),
      ])
    ),
  };
}

/**
 * Get audit log for compliance
 */
export function getEnterpriseAuditLog(
  filter?: { actor?: string; resource?: string },
  limit?: number
) {
  if (!MICHAT_V3_ENABLED) {
    return [];
  }
  
  const bridge = getMichatBridge();
  return bridge.getAuditLog(filter, limit);
}

/**
 * Reset bridge for testing
 */
export function resetEnterprise(): void {
  resetMichatBridge();
}
