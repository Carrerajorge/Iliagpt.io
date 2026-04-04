/**
 * PROVIDER SYSTEM BOOTSTRAP
 *
 * Initializes the entire Universal LLM Provider system:
 * 1. Discovers API keys from environment
 * 2. Auto-registers all available providers
 * 3. Starts health monitoring
 * 4. Initializes cost tracking
 * 5. Warms up model registry cache
 *
 * Call this once during server startup.
 */

import { providerRegistry } from "./ProviderRegistry";
import { securityVault } from "../../services/llm/SecurityVault";
import { healthMonitor } from "../../services/llm/ProviderHealthMonitor";
import { costEngine } from "../../services/llm/CostOptimizationEngine";
import { pipelineOptimizer } from "../../services/llm/RequestPipelineOptimizer";

export interface BootstrapResult {
  discoveredKeys: string[];
  registeredProviders: string[];
  totalModels: number;
  healthStatus: Record<string, string>;
  startupTimeMs: number;
}

export async function bootstrapProviderSystem(): Promise<BootstrapResult> {
  const start = Date.now();
  console.log("[ProviderSystem] Bootstrapping Universal LLM Provider System...");

  // 1. Discover API keys from environment
  const discoveredKeys = securityVault.discoverFromEnv();
  console.log(`[ProviderSystem] Found ${discoveredKeys.length} API keys: [${discoveredKeys.join(", ")}]`);

  // 2. Auto-discover and register providers
  const registeredProviders = await providerRegistry.autoDiscover();
  console.log(`[ProviderSystem] Registered ${registeredProviders.length} providers: [${registeredProviders.join(", ")}]`);

  // 3. Warm up model registry
  const models = await providerRegistry.getAllModels(true);
  console.log(`[ProviderSystem] Discovered ${models.length} models across all providers`);

  // 4. Initialize health monitoring (30s interval)
  healthMonitor.startMonitoring(30000);

  // 5. Set up cost tracking event listeners
  costEngine.on("budgetAlert", (data) => {
    console.warn(`[CostEngine] Budget alert for user ${data.userId}: ${Math.round(data.monthlyUsed * 100) / 100}/${data.monthlyLimit} monthly`);
  });

  costEngine.on("anomaly", (anomaly) => {
    console.warn(`[CostEngine] Anomaly detected: ${anomaly.message} (severity: ${anomaly.severity})`);
  });

  // 6. Set up circuit breaker alerts
  healthMonitor.on("circuitStateChange", (data) => {
    if (data.to === "open") {
      console.error(`[HealthMonitor] Circuit OPEN for ${data.provider} - requests will be routed to alternatives`);
    } else if (data.to === "closed") {
      console.log(`[HealthMonitor] Circuit CLOSED for ${data.provider} - provider recovered`);
    }
  });

  // 7. Log health summary
  const healthStatus: Record<string, string> = {};
  for (const name of registeredProviders) {
    const provider = providerRegistry.get(name);
    healthStatus[name] = provider?.isConfigured() ? "configured" : "unconfigured";
  }

  const startupTimeMs = Date.now() - start;
  console.log(`[ProviderSystem] Bootstrap complete in ${startupTimeMs}ms`);
  console.log(`[ProviderSystem] Summary: ${registeredProviders.length} providers, ${models.length} models, ${discoveredKeys.length} keys`);

  return {
    discoveredKeys,
    registeredProviders,
    totalModels: models.length,
    healthStatus,
    startupTimeMs,
  };
}

/**
 * Graceful shutdown - cleanup all provider resources.
 */
export function shutdownProviderSystem(): void {
  console.log("[ProviderSystem] Shutting down...");
  healthMonitor.stopMonitoring();
  healthMonitor.destroy();
  costEngine.destroy();
  pipelineOptimizer.destroy();
  providerRegistry.destroy();
  securityVault.destroy();
  console.log("[ProviderSystem] Shutdown complete");
}
