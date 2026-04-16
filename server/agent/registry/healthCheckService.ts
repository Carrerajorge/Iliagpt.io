import { EventEmitter } from "events";
import { TOOL_CATEGORIES, ToolCategory } from "./toolRegistry";
import { HealthCheckResult, globalHealthManager, CircuitBreaker, getOrCreateCircuitBreaker } from "./resilience";
import { AGENT_REGISTRY } from "../langgraph/agents/types";
import { db } from "../../db";
import fs from "fs";
import path from "path";

export type HealthStatus = "healthy" | "degraded" | "unhealthy" | "unknown";

export interface HealthCheckConfig {
  name: string;
  description?: string;
  timeout: number;
  critical: boolean;
  dependencies: string[];
  category: "tool" | "agent" | "external" | "system";
}

export interface HealthCheckEntry {
  config: HealthCheckConfig;
  checkFn: () => Promise<boolean>;
  lastResult?: HealthCheckResult;
  circuitBreaker: CircuitBreaker;
}

export interface HealthReport {
  timestamp: string;
  overallStatus: HealthStatus;
  healthy: boolean;
  totalChecks: number;
  passedChecks: number;
  failedChecks: number;
  degradedChecks: number;
  checks: Record<string, HealthCheckResult & { status: HealthStatus; dependencies: string[] }>;
  alerts: HealthAlert[];
  metrics: {
    avgLatencyMs: number;
    maxLatencyMs: number;
    minLatencyMs: number;
    checkDurationMs: number;
  };
}

export interface HealthAlert {
  id: string;
  severity: "info" | "warning" | "critical";
  message: string;
  checkName: string;
  timestamp: string;
  acknowledged: boolean;
}

export interface DependencyNode {
  name: string;
  dependencies: string[];
  dependents: string[];
  status: HealthStatus;
  impactScore: number;
}

const SPECIALIZED_AGENT_NAMES = [
  "OrchestratorAgent",
  "ResearchAgent",
  "CodeAgent",
  "DataAgent",
  "ContentAgent",
  "CommunicationAgent",
  "BrowserAgent",
  "DocumentAgent",
  "QAAgent",
  "SecurityAgent",
] as const;

const EXTERNAL_DEPENDENCIES = [
  { name: "database", description: "PostgreSQL database connection", critical: true },
  { name: "filesystem", description: "File system access", critical: true },
  { name: "memory", description: "Memory usage", critical: false },
  { name: "eventLoop", description: "Node.js event loop", critical: true },
  { name: "processHealth", description: "Process health metrics", critical: false },
] as const;

class HealthCheckService extends EventEmitter {
  private checks: Map<string, HealthCheckEntry> = new Map();
  private alerts: HealthAlert[] = [];
  private alertHistory: HealthAlert[] = [];
  private monitoringInterval?: NodeJS.Timeout;
  private isMonitoring = false;
  private lastReport?: HealthReport;
  private alertThresholds = {
    consecutiveFailuresWarning: 2,
    consecutiveFailuresCritical: 5,
    latencyWarningMs: 2000,
    latencyCriticalMs: 5000,
  };

  constructor() {
    super();
    this.initializeDefaultChecks();
  }

  registerCheck(
    name: string,
    checkFn: () => Promise<boolean>,
    options?: Partial<HealthCheckConfig>
  ): void {
    const config: HealthCheckConfig = {
      name,
      description: options?.description ?? `Health check for ${name}`,
      timeout: options?.timeout ?? 5000,
      critical: options?.critical ?? false,
      dependencies: options?.dependencies ?? [],
      category: options?.category ?? "system",
    };

    const circuitBreaker = getOrCreateCircuitBreaker(`health_${name}`, {
      failureThreshold: 3,
      successThreshold: 2,
      resetTimeoutMs: 30000,
    });

    this.checks.set(name, {
      config,
      checkFn,
      circuitBreaker,
    });

    console.log(`[HealthCheckService] Registered check: ${name} (${config.category})`);
  }

  unregisterCheck(name: string): boolean {
    const deleted = this.checks.delete(name);
    if (deleted) {
      console.log(`[HealthCheckService] Unregistered check: ${name}`);
    }
    return deleted;
  }

  async runCheck(name: string): Promise<HealthCheckResult> {
    const entry = this.checks.get(name);
    if (!entry) {
      return {
        healthy: false,
        latencyMs: 0,
        errorMessage: `Health check "${name}" not found`,
        lastCheckedAt: new Date().toISOString(),
        consecutiveFailures: -1,
      };
    }

    const start = Date.now();
    const previousResult = entry.lastResult;

    try {
      if (!entry.circuitBreaker.canExecute()) {
        const result: HealthCheckResult = {
          healthy: false,
          latencyMs: Date.now() - start,
          errorMessage: "Circuit breaker open",
          lastCheckedAt: new Date().toISOString(),
          consecutiveFailures: (previousResult?.consecutiveFailures ?? 0) + 1,
        };
        entry.lastResult = result;
        return result;
      }

      const healthy = await Promise.race([
        entry.checkFn(),
        new Promise<boolean>((_, reject) =>
          setTimeout(() => reject(new Error("Health check timeout")), entry.config.timeout)
        ),
      ]);

      const latencyMs = Date.now() - start;
      const result: HealthCheckResult = {
        healthy,
        latencyMs,
        lastCheckedAt: new Date().toISOString(),
        consecutiveFailures: healthy ? 0 : (previousResult?.consecutiveFailures ?? 0) + 1,
      };

      if (healthy) {
        entry.circuitBreaker.recordSuccess();
      } else {
        entry.circuitBreaker.recordFailure();
      }

      entry.lastResult = result;
      this.checkForAlerts(name, result, entry.config);
      return result;
    } catch (error: any) {
      entry.circuitBreaker.recordFailure();
      const result: HealthCheckResult = {
        healthy: false,
        latencyMs: Date.now() - start,
        errorMessage: error.message,
        lastCheckedAt: new Date().toISOString(),
        consecutiveFailures: (previousResult?.consecutiveFailures ?? 0) + 1,
      };
      entry.lastResult = result;
      this.checkForAlerts(name, result, entry.config);
      return result;
    }
  }

  async runAllChecks(): Promise<HealthReport> {
    const startTime = Date.now();
    const results: Record<string, HealthCheckResult & { status: HealthStatus; dependencies: string[] }> = {};
    const checkPromises: Promise<void>[] = [];

    for (const [name, entry] of this.checks) {
      checkPromises.push(
        this.runCheck(name).then((result) => {
          const status = this.resultToStatus(result);
          results[name] = {
            ...result,
            status,
            dependencies: entry.config.dependencies,
          };
        })
      );
    }

    await Promise.all(checkPromises);

    const latencies = Object.values(results).map((r) => r.latencyMs);
    const passedChecks = Object.values(results).filter((r) => r.healthy).length;
    const failedChecks = Object.values(results).filter((r) => !r.healthy && r.consecutiveFailures >= this.alertThresholds.consecutiveFailuresCritical).length;
    const degradedChecks = Object.values(results).filter((r) => !r.healthy && r.consecutiveFailures > 0 && r.consecutiveFailures < this.alertThresholds.consecutiveFailuresCritical).length;

    const report: HealthReport = {
      timestamp: new Date().toISOString(),
      overallStatus: this.calculateOverallStatus(results),
      healthy: passedChecks === this.checks.size,
      totalChecks: this.checks.size,
      passedChecks,
      failedChecks,
      degradedChecks,
      checks: results,
      alerts: this.getActiveAlerts(),
      metrics: {
        avgLatencyMs: latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0,
        maxLatencyMs: latencies.length > 0 ? Math.max(...latencies) : 0,
        minLatencyMs: latencies.length > 0 ? Math.min(...latencies) : 0,
        checkDurationMs: Date.now() - startTime,
      },
    };

    this.lastReport = report;
    this.emit("healthReport", report);
    return report;
  }

  getHealthStatus(name: string): HealthCheckResult | undefined {
    return this.checks.get(name)?.lastResult;
  }

  getOverallHealth(): { healthy: boolean; unhealthy: string[] } {
    const unhealthy: string[] = [];
    for (const [name, entry] of this.checks) {
      if (entry.lastResult && !entry.lastResult.healthy) {
        unhealthy.push(name);
      }
    }
    return {
      healthy: unhealthy.length === 0,
      unhealthy,
    };
  }

  getDependencyGraph(): Map<string, DependencyNode> {
    const graph = new Map<string, DependencyNode>();

    for (const [name, entry] of this.checks) {
      const dependents: string[] = [];
      for (const [otherName, otherEntry] of this.checks) {
        if (otherEntry.config.dependencies.includes(name)) {
          dependents.push(otherName);
        }
      }

      const status = entry.lastResult
        ? this.resultToStatus(entry.lastResult)
        : "unknown";

      const impactScore = this.calculateImpactScore(name, dependents);

      graph.set(name, {
        name,
        dependencies: entry.config.dependencies,
        dependents,
        status,
        impactScore,
      });
    }

    return graph;
  }

  getFailureImpact(checkName: string): string[] {
    const impacted: Set<string> = new Set();
    const visited: Set<string> = new Set();
    const queue: string[] = [checkName];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);

      for (const [name, entry] of this.checks) {
        if (entry.config.dependencies.includes(current) && !impacted.has(name)) {
          impacted.add(name);
          queue.push(name);
        }
      }
    }

    return Array.from(impacted);
  }

  startMonitoring(intervalMs: number = 60000): void {
    if (this.isMonitoring) {
      console.log("[HealthCheckService] Monitoring already active");
      return;
    }

    this.isMonitoring = true;
    console.log(`[HealthCheckService] Starting periodic monitoring every ${intervalMs}ms`);

    this.runAllChecks().catch(console.error);

    this.monitoringInterval = setInterval(async () => {
      try {
        const report = await this.runAllChecks();
        
        if (!report.healthy) {
          this.emit("unhealthySystem", {
            report,
            criticalFailures: Object.entries(report.checks)
              .filter(([_, check]) => !check.healthy)
              .map(([name]) => name),
          });
        }
      } catch (error) {
        console.error("[HealthCheckService] Monitoring error:", error);
      }
    }, intervalMs);
  }

  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
      this.isMonitoring = false;
      console.log("[HealthCheckService] Stopped periodic monitoring");
    }
  }

  isMonitoringActive(): boolean {
    return this.isMonitoring;
  }

  getLastReport(): HealthReport | undefined {
    return this.lastReport;
  }

  getActiveAlerts(): HealthAlert[] {
    return this.alerts.filter((a) => !a.acknowledged);
  }

  acknowledgeAlert(alertId: string): boolean {
    const alert = this.alerts.find((a) => a.id === alertId);
    if (alert) {
      alert.acknowledged = true;
      return true;
    }
    return false;
  }

  getAlertHistory(limit: number = 100): HealthAlert[] {
    return this.alertHistory.slice(-limit);
  }

  getChecksByCategory(category: HealthCheckConfig["category"]): string[] {
    return Array.from(this.checks.entries())
      .filter(([_, entry]) => entry.config.category === category)
      .map(([name]) => name);
  }

  getStats(): {
    totalChecks: number;
    byCategory: Record<string, number>;
    byStatus: Record<HealthStatus, number>;
    activeAlerts: number;
  } {
    const byCategory: Record<string, number> = {};
    const byStatus: Record<HealthStatus, number> = {
      healthy: 0,
      degraded: 0,
      unhealthy: 0,
      unknown: 0,
    };

    for (const [_, entry] of this.checks) {
      byCategory[entry.config.category] = (byCategory[entry.config.category] || 0) + 1;
      const status = entry.lastResult ? this.resultToStatus(entry.lastResult) : "unknown";
      byStatus[status]++;
    }

    return {
      totalChecks: this.checks.size,
      byCategory,
      byStatus,
      activeAlerts: this.getActiveAlerts().length,
    };
  }

  private initializeDefaultChecks(): void {
    for (const category of TOOL_CATEGORIES) {
      this.registerToolCategoryCheck(category);
    }

    for (const agentName of SPECIALIZED_AGENT_NAMES) {
      this.registerAgentCheck(agentName);
    }

    for (const dep of EXTERNAL_DEPENDENCIES) {
      this.registerExternalDependencyCheck(dep.name, dep.description, dep.critical);
    }
  }

  private registerToolCategoryCheck(category: ToolCategory): void {
    this.registerCheck(
      `tool_category_${category}`,
      async () => {
        return true;
      },
      {
        description: `Health check for ${category} tool category`,
        category: "tool",
        critical: ["Database", "Security", "API"].includes(category),
        dependencies: category === "Orchestration" ? ["tool_category_Reasoning", "tool_category_Memory"] : [],
      }
    );
  }

  private registerAgentCheck(agentName: string): void {
    const agentDependencies: Record<string, string[]> = {
      OrchestratorAgent: ["database", "tool_category_Orchestration"],
      ResearchAgent: ["tool_category_Web", "tool_category_API"],
      CodeAgent: ["tool_category_Development", "filesystem"],
      DataAgent: ["tool_category_Data", "database"],
      ContentAgent: ["tool_category_Generation", "tool_category_Document"],
      CommunicationAgent: ["tool_category_Communication", "tool_category_API"],
      BrowserAgent: ["tool_category_Web"],
      DocumentAgent: ["tool_category_Document", "filesystem"],
      QAAgent: ["tool_category_Development", "tool_category_Monitoring"],
      SecurityAgent: ["tool_category_Security", "database"],
    };

    this.registerCheck(
      `agent_${agentName}`,
      async () => {
        const agent = AGENT_REGISTRY.get(agentName);
        if (!agent) return true;
        const state = agent.getState();
        return state.status !== "failed" && state.status !== "cancelled";
      },
      {
        description: `Health check for ${agentName} specialized agent`,
        category: "agent",
        critical: agentName === "OrchestratorAgent",
        dependencies: agentDependencies[agentName] || [],
      }
    );
  }

  private registerExternalDependencyCheck(name: string, description: string, critical: boolean): void {
    const checkFunctions: Record<string, () => Promise<boolean>> = {
      database: async () => {
        try {
          await db.execute("SELECT 1");
          return true;
        } catch {
          return false;
        }
      },
      filesystem: async () => {
        try {
          const testPath = path.join(process.cwd(), "sandbox_workspace");
          await fs.promises.access(testPath, fs.constants.R_OK | fs.constants.W_OK);
          return true;
        } catch {
          return false;
        }
      },
      memory: async () => {
        const usage = process.memoryUsage();
        const heapUsedPercent = usage.heapUsed / usage.heapTotal;
        return heapUsedPercent < 0.9;
      },
      eventLoop: async () => {
        return new Promise((resolve) => {
          const start = Date.now();
          setImmediate(() => {
            const lag = Date.now() - start;
            resolve(lag < 100);
          });
        });
      },
      processHealth: async () => {
        const uptime = process.uptime();
        return uptime > 0;
      },
    };

    const externalDependencies: Record<string, string[]> = {
      database: [],
      filesystem: [],
      memory: [],
      eventLoop: [],
      processHealth: ["memory", "eventLoop"],
    };

    this.registerCheck(name, checkFunctions[name] || (async () => true), {
      description,
      category: "external",
      critical,
      dependencies: externalDependencies[name] || [],
    });
  }

  private resultToStatus(result: HealthCheckResult): HealthStatus {
    if (result.healthy) return "healthy";
    if (result.consecutiveFailures >= this.alertThresholds.consecutiveFailuresCritical) {
      return "unhealthy";
    }
    if (result.consecutiveFailures >= this.alertThresholds.consecutiveFailuresWarning) {
      return "degraded";
    }
    return "degraded";
  }

  private calculateOverallStatus(
    results: Record<string, HealthCheckResult & { status: HealthStatus }>
  ): HealthStatus {
    const statuses = Object.values(results).map((r) => r.status);
    
    if (statuses.some((s) => s === "unhealthy")) {
      const unhealthyChecks = Object.entries(results).filter(([_, r]) => r.status === "unhealthy");
      const criticalUnhealthy = unhealthyChecks.some(([name]) => 
        this.checks.get(name)?.config.critical
      );
      return criticalUnhealthy ? "unhealthy" : "degraded";
    }
    
    if (statuses.some((s) => s === "degraded")) {
      return "degraded";
    }
    
    if (statuses.some((s) => s === "unknown")) {
      return "degraded";
    }
    
    return "healthy";
  }

  private calculateImpactScore(name: string, dependents: string[]): number {
    if (dependents.length === 0) return 1;

    let score = dependents.length;
    const entry = this.checks.get(name);
    if (entry?.config.critical) score *= 2;

    for (const dependent of dependents) {
      const depEntry = this.checks.get(dependent);
      if (depEntry?.config.critical) score += 2;
      const subDependents = Array.from(this.checks.entries())
        .filter(([_, e]) => e.config.dependencies.includes(dependent))
        .map(([n]) => n);
      score += subDependents.length * 0.5;
    }

    return Math.round(score * 10) / 10;
  }

  private checkForAlerts(name: string, result: HealthCheckResult, config: HealthCheckConfig): void {
    if (!result.healthy) {
      const severity = this.determineAlertSeverity(result, config);
      if (
        result.consecutiveFailures === this.alertThresholds.consecutiveFailuresWarning ||
        result.consecutiveFailures === this.alertThresholds.consecutiveFailuresCritical
      ) {
        this.createAlert(name, severity, result);
      }
    }

    if (result.latencyMs > this.alertThresholds.latencyCriticalMs) {
      this.createAlert(name, "critical", result, `High latency: ${result.latencyMs}ms`);
    } else if (result.latencyMs > this.alertThresholds.latencyWarningMs) {
      this.createAlert(name, "warning", result, `Elevated latency: ${result.latencyMs}ms`);
    }
  }

  private determineAlertSeverity(
    result: HealthCheckResult,
    config: HealthCheckConfig
  ): "info" | "warning" | "critical" {
    if (config.critical && result.consecutiveFailures >= this.alertThresholds.consecutiveFailuresCritical) {
      return "critical";
    }
    if (result.consecutiveFailures >= this.alertThresholds.consecutiveFailuresCritical) {
      return "critical";
    }
    if (result.consecutiveFailures >= this.alertThresholds.consecutiveFailuresWarning) {
      return "warning";
    }
    return "info";
  }

  private createAlert(
    checkName: string,
    severity: "info" | "warning" | "critical",
    result: HealthCheckResult,
    customMessage?: string
  ): void {
    const existingAlert = this.alerts.find(
      (a) => a.checkName === checkName && !a.acknowledged && a.severity === severity
    );
    if (existingAlert) return;

    const alert: HealthAlert = {
      id: `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      severity,
      message: customMessage || `Health check "${checkName}" failed: ${result.errorMessage || "Unknown error"}`,
      checkName,
      timestamp: new Date().toISOString(),
      acknowledged: false,
    };

    this.alerts.push(alert);
    this.alertHistory.push(alert);

    if (this.alertHistory.length > 1000) {
      this.alertHistory = this.alertHistory.slice(-500);
    }

    this.emit("alert", alert);
    console.log(`[HealthCheckService] Alert created: ${severity.toUpperCase()} - ${alert.message}`);
  }
}

export const healthCheckService = new HealthCheckService();

export function createHealthCheckHandler() {
  return async (req: any, res: any) => {
    try {
      const { quick, name, category } = req.query || {};

      if (name) {
        const result = await healthCheckService.runCheck(name);
        return res.json({
          name,
          ...result,
          status: result.healthy ? "healthy" : "unhealthy",
        });
      }

      if (quick === "true") {
        const overall = healthCheckService.getOverallHealth();
        return res.json({
          healthy: overall.healthy,
          unhealthyCount: overall.unhealthy.length,
          timestamp: new Date().toISOString(),
        });
      }

      const report = await healthCheckService.runAllChecks();

      if (category) {
        const categoryChecks = healthCheckService.getChecksByCategory(category);
        const filteredChecks: Record<string, any> = {};
        for (const checkName of categoryChecks) {
          if (report.checks[checkName]) {
            filteredChecks[checkName] = report.checks[checkName];
          }
        }
        return res.json({
          ...report,
          checks: filteredChecks,
          totalChecks: categoryChecks.length,
        });
      }

      return res.json(report);
    } catch (error: any) {
      return res.status(500).json({
        error: "Health check failed",
        message: error.message,
      });
    }
  };
}

export function createDependencyGraphHandler() {
  return async (req: any, res: any) => {
    try {
      const graph = healthCheckService.getDependencyGraph();
      const graphData: Record<string, DependencyNode> = {};
      for (const [name, node] of graph) {
        graphData[name] = node;
      }
      return res.json({
        nodes: graphData,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      return res.status(500).json({
        error: "Failed to get dependency graph",
        message: error.message,
      });
    }
  };
}

export function createAlertHandler() {
  return async (req: any, res: any) => {
    try {
      const { action, alertId } = req.query || {};

      if (action === "acknowledge" && alertId) {
        const acknowledged = healthCheckService.acknowledgeAlert(alertId);
        return res.json({ success: acknowledged });
      }

      if (action === "history") {
        const limit = parseInt(req.query?.limit || "100", 10);
        return res.json(healthCheckService.getAlertHistory(limit));
      }

      return res.json(healthCheckService.getActiveAlerts());
    } catch (error: any) {
      return res.status(500).json({
        error: "Alert operation failed",
        message: error.message,
      });
    }
  };
}

export {
  HealthCheckService,
  SPECIALIZED_AGENT_NAMES,
  EXTERNAL_DEPENDENCIES,
};
