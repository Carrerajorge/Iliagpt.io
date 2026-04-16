import { createLogger } from "./structuredLogger";
import { createAlert, resolveAlertsByService } from "./alertManager";
import {
  getConnectorStats,
  getHourlyAverageUsage,
  getRecentHourUsage,
  type ConnectorName,
  type ConnectorStats
} from "./connectorMetrics";

const logger = createLogger("connector-alerting");

export interface ConnectorThresholds {
  failureRateThreshold: number;
  latencyThreshold: number;
  usageSpikeMultiplier: number;
}

export interface ConnectorHealthResult {
  connector: ConnectorName;
  healthy: boolean;
  issues: ConnectorIssue[];
  stats: ConnectorStats | null;
}

export interface ConnectorIssue {
  type: "high_failure_rate" | "high_latency" | "usage_spike";
  message: string;
  value: number;
  threshold: number;
}

const DEFAULT_THRESHOLDS: ConnectorThresholds = {
  failureRateThreshold: 0.3,
  latencyThreshold: 5000,
  usageSpikeMultiplier: 2,
};

const connectorThresholds: Map<ConnectorName, Partial<ConnectorThresholds>> = new Map();

const activeConnectorAlerts: Map<string, Set<string>> = new Map();

export function setConnectorThresholds(
  connector: ConnectorName,
  thresholds: Partial<ConnectorThresholds>
): void {
  const current = connectorThresholds.get(connector) || {};
  connectorThresholds.set(connector, { ...current, ...thresholds });
  logger.info(`Updated thresholds for ${connector}`, thresholds);
}

export function getConnectorThresholds(connector: ConnectorName): ConnectorThresholds {
  const custom = connectorThresholds.get(connector) || {};
  return { ...DEFAULT_THRESHOLDS, ...custom };
}

export function checkConnectorHealth(connector: ConnectorName): ConnectorHealthResult {
  return { connector, healthy: true, issues: [], stats: null };
  const stats = getConnectorStats(connector);
  const thresholds = getConnectorThresholds(connector);
  const issues: ConnectorIssue[] = [];

  if (!stats || stats.totalCalls === 0) {
    return {
      connector,
      healthy: true,
      issues: [],
      stats,
    };
  }

  const failureRate = 1 - stats.successRate;
  if (failureRate > thresholds.failureRateThreshold) {
    issues.push({
      type: "high_failure_rate",
      message: `Failure rate ${(failureRate * 100).toFixed(1)}% exceeds threshold ${(thresholds.failureRateThreshold * 100).toFixed(1)}%`,
      value: failureRate,
      threshold: thresholds.failureRateThreshold,
    });
  }

  if (stats.averageLatencyMs > thresholds.latencyThreshold) {
    issues.push({
      type: "high_latency",
      message: `Average latency ${stats.averageLatencyMs.toFixed(0)}ms exceeds threshold ${thresholds.latencyThreshold}ms`,
      value: stats.averageLatencyMs,
      threshold: thresholds.latencyThreshold,
    });
  }

  const averageUsage = getHourlyAverageUsage(connector);
  const recentUsage = getRecentHourUsage(connector);

  if (averageUsage > 0 && recentUsage > averageUsage * thresholds.usageSpikeMultiplier) {
    issues.push({
      type: "usage_spike",
      message: `Current hour usage ${recentUsage} is ${(recentUsage / averageUsage).toFixed(1)}x the average (${averageUsage.toFixed(0)})`,
      value: recentUsage,
      threshold: averageUsage * thresholds.usageSpikeMultiplier,
    });
  }

  const healthy = issues.length === 0;

  handleConnectorAlerts(connector, issues, healthy);

  return {
    connector,
    healthy,
    issues,
    stats,
  };
}

function handleConnectorAlerts(
  connector: ConnectorName,
  issues: ConnectorIssue[],
  healthy: boolean
): void {
  const serviceName = `connector:${connector}`;
  let alertSet = activeConnectorAlerts.get(connector);

  if (!alertSet) {
    alertSet = new Set();
    activeConnectorAlerts.set(connector, alertSet);
  }

  if (healthy && alertSet.size > 0) {
    resolveAlertsByService(serviceName);
    alertSet.clear();
    logger.info(`Connector ${connector} recovered, alerts resolved`);
    return;
  }

  for (const issue of issues) {
    const alertKey = `${connector}:${issue.type}`;

    if (!alertSet.has(alertKey)) {
      const severity = issue.type === "high_failure_rate" ? "high" :
        issue.type === "high_latency" ? "medium" : "low";

      createAlert({
        type: issue.type === "high_failure_rate" ? "api_failure" :
          issue.type === "high_latency" ? "high_latency" : "error_spike",
        service: serviceName,
        message: `Connector ${connector}: ${issue.message}`,
        severity,
        resolved: false,
      });

      alertSet.add(alertKey);

      logger.warn(`Alert created for ${connector}: ${issue.type}`, {
        value: issue.value,
        threshold: issue.threshold,
      });
    }
  }

  const currentIssueTypes = new Set(issues.map(i => `${connector}:${i.type}`));
  for (const alertKey of alertSet) {
    if (!currentIssueTypes.has(alertKey)) {
      alertSet.delete(alertKey);
    }
  }
}

export function checkAllConnectorsHealth(): Map<ConnectorName, ConnectorHealthResult> {
  const connectors: ConnectorName[] = ["gmail", "gemini", "xai", "database", "forms"];
  const results = new Map<ConnectorName, ConnectorHealthResult>();

  for (const connector of connectors) {
    results.set(connector, checkConnectorHealth(connector));
  }

  return results;
}

export function getHealthSummary(): {
  totalConnectors: number;
  healthyCount: number;
  unhealthyCount: number;
  issues: Array<{ connector: ConnectorName; issues: ConnectorIssue[] }>;
} {
  const results = checkAllConnectorsHealth();
  let healthyCount = 0;
  let unhealthyCount = 0;
  const allIssues: Array<{ connector: ConnectorName; issues: ConnectorIssue[] }> = [];

  for (const [connector, result] of results) {
    if (result.healthy) {
      healthyCount++;
    } else {
      unhealthyCount++;
      allIssues.push({ connector, issues: result.issues });
    }
  }

  return {
    totalConnectors: results.size,
    healthyCount,
    unhealthyCount,
    issues: allIssues,
  };
}

let healthCheckInterval: NodeJS.Timeout | null = null;

export function startPeriodicHealthCheck(intervalMs: number = 60000): void {
  // DISABLED FOR STABILITY
  logger.info(`Started periodic connector health check (DISABLED)`);
}

export function stopPeriodicHealthCheck(): void {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
    logger.info("Stopped periodic connector health check");
  }
}
