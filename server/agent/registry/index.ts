export * from "./toolRegistry";
export * from "./agentRegistry";
export * from "./orchestrator";
export * from "./capabilitiesReport";
export { registerAllTools } from "./registerTools";
export { registerAllAgents } from "./registerAgents";

import { registerAllTools } from "./registerTools";
import { registerAllAgents } from "./registerAgents";
import { capabilitiesReportRunner } from "./capabilitiesReport";
import { toolRegistry } from "./toolRegistry";
import { agentRegistry } from "./agentRegistry";

let initialized = false;

export async function initializeAgentSystem(options?: {
  runSmokeTest?: boolean;
  verbose?: boolean;
}): Promise<{
  toolCount: number;
  agentCount: number;
  smokeTestPassed?: boolean;
  report?: any;
}> {
  if (initialized) {
    console.log("[AgentSystem] Already initialized, skipping...");
    return {
      toolCount: toolRegistry.getStats().totalTools,
      agentCount: agentRegistry.getStats().totalAgents,
    };
  }

  console.log("\n" + "=".repeat(60));
  console.log("AGENT SYSTEM INITIALIZATION");
  console.log("=".repeat(60) + "\n");

  registerAllTools();
  registerAllAgents();

  const toolStats = toolRegistry.getStats();
  const agentStats = agentRegistry.getStats();

  console.log(`\nInitialization complete:`);
  console.log(`  Tools: ${toolStats.totalTools} across ${Object.keys(toolStats.byCategory).length} categories`);
  console.log(`  Agents: ${agentStats.totalAgents} across ${Object.keys(agentStats.byRole).length} roles`);

  initialized = true;

  let report;
  let smokeTestPassed;

  if (options?.runSmokeTest) {
    console.log("\nRunning smoke test...\n");
    report = await capabilitiesReportRunner.runQuickSmokeTest();
    smokeTestPassed = report.summary.overallStatus === "PASS";
  }

  return {
    toolCount: toolStats.totalTools,
    agentCount: agentStats.totalAgents,
    smokeTestPassed,
    report,
  };
}

export function isInitialized(): boolean {
  return initialized;
}

export function getSystemStatus(): {
  initialized: boolean;
  tools: ReturnType<typeof toolRegistry.getStats>;
  agents: ReturnType<typeof agentRegistry.getStats>;
} {
  return {
    initialized,
    tools: toolRegistry.getStats(),
    agents: agentRegistry.getStats(),
  };
}
