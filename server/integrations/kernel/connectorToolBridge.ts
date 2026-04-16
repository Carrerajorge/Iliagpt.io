/**
 * ConnectorToolBridge — Glue between ConnectorRegistry and the main ToolRegistry.
 *
 * Called once at server startup after manifests are loaded.
 * Registers each connector capability as a ToolDefinition in the main
 * ToolRegistry so they flow through existing policy, concurrency, audit.
 */

import { connectorRegistry } from "./connectorRegistry";
import { connectorExecutor } from "./connectorExecutor";
import { credentialVault } from "./credentialVault";
import type { GeminiFunctionDeclaration } from "./types";

/** Mount all connector tools into the main ToolRegistry.
 *  Call this once at startup after initializeConnectorManifests(). */
export async function mountConnectorTools(): Promise<number> {
  const { toolRegistry } = await import("../../agent/toolRegistry");
  const { policyEngine } = await import("../../agent/policyEngine");

  let count = 0;

  for (const manifest of connectorRegistry.listEnabled()) {
    const toolDefs = connectorRegistry.toToolDefinitions(
      manifest.connectorId,
      credentialVault,
      connectorExecutor
    );

    for (const toolDef of toolDefs) {
      // Ensure every connector tool has a policy entry; ToolRegistry will deny tools with no policy.
      // Only register if missing to avoid clobbering any custom/admin policies.
      if (!policyEngine.getPolicy(toolDef.name)) {
        const cap = manifest.capabilities.find((c) => c.operationId === toolDef.name);
        const requiresConfirmation = Boolean(
          cap?.confirmationRequired ||
            cap?.dataAccessLevel === "write" ||
            cap?.dataAccessLevel === "admin"
        );

        // Connector tools touch external systems: keep them Pro+ by default.
        policyEngine.registerPolicy({
          toolName: toolDef.name,
          capabilities: (toolDef.capabilities as any) || [],
          allowedPlans: ["pro", "admin"],
          requiresConfirmation,
          maxExecutionTimeMs: 60_000,
          maxRetries: 2,
          deniedByDefault: false,
        });
      }

      // Only register if not already present (idempotent)
      if (!toolRegistry.get(toolDef.name)) {
        try {
          toolRegistry.register(toolDef);
          count++;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`[ConnectorToolBridge] Failed to register tool "${toolDef.name}": ${msg}`);
        }
      }
    }
  }

  console.log(`[ConnectorToolBridge] Mounted ${count} connector tools into ToolRegistry`);
  return count;
}

/** Get Gemini FunctionDeclarations for a user's enabled connectors.
 *  Called by agentExecutor.getToolsForIntent() to inject connector tools. */
export async function getConnectorDeclarationsForUser(
  userId: string
): Promise<GeminiFunctionDeclaration[]> {
  try {
    const { getIntegrationPolicyCached } = await import("../../services/integrationPolicyCache");
    const policy = await getIntegrationPolicyCached(userId);

    const enabledApps = policy?.enabledApps as string[] | null;
    const enabledTools = policy?.enabledTools as string[] | null;
    const disabledTools = new Set((policy?.disabledTools as string[] | null) || []);

    const decls: GeminiFunctionDeclaration[] = [];

    for (const manifest of connectorRegistry.listEnabled()) {
      // If user has enabledApps whitelist, skip connectors not in it
      if (enabledApps && enabledApps.length > 0 && !enabledApps.includes(manifest.connectorId)) {
        continue;
      }

      for (const cap of manifest.capabilities) {
        // Skip disabled tools
        if (disabledTools.has(cap.operationId)) continue;

        // If enabledTools whitelist exists, respect it
        if (enabledTools && enabledTools.length > 0 && !enabledTools.includes(cap.operationId)) {
          continue;
        }

        decls.push(
          ...connectorRegistry.toGeminiFunctionDeclarations(manifest.connectorId, [cap.operationId])
        );
      }
    }

    return decls;
  } catch (err: unknown) {
    // If policy lookup fails, return empty — don't block the agent
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[ConnectorToolBridge] Failed to get connector declarations for user: ${msg}`);
    return [];
  }
}

/** Check if a user has any connected integration accounts */
export async function hasAnyConnectedApps(userId: string): Promise<boolean> {
  try {
    const { db } = await import("../../db");
    const { integrationAccounts } = await import("../../../shared/schema/integration");
    const { eq, and } = await import("drizzle-orm");

    const accounts = await db
      .select({ id: integrationAccounts.id })
      .from(integrationAccounts)
      .where(
        and(
          eq(integrationAccounts.userId, userId),
          eq(integrationAccounts.status, "active")
        )
      )
      .limit(1);

    return accounts.length > 0;
  } catch {
    return false;
  }
}
