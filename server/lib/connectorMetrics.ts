import { createLogger } from "./structuredLogger";

const logger = createLogger("connector-metrics");

export type ConnectorName = "gmail" | "gemini" | "xai" | "openai" | "anthropic" | "deepseek" | "database" | "forms";

export interface HourlyBucket {
  hour: number;
  calls: number;
  successes: number;
  failures: number;
  totalLatencyMs: number;
}

export interface ConnectorStats {
  connector: ConnectorName;
  totalCalls: number;
  successCount: number;
  failureCount: number;
  totalLatencyMs: number;
  averageLatencyMs: number;
  successRate: number;
  lastUsed: Date | null;
  hourlyUsage: HourlyBucket[];
}

interface ConnectorMetricsData {
  totalCalls: number;
  successCount: number;
  failureCount: number;
  totalLatencyMs: number;
  lastUsed: Date | null;
  hourlyBuckets: Map<number, HourlyBucket>;
}

const HOURS_TO_KEEP = 24;

const connectorMetrics: Map<ConnectorName, ConnectorMetricsData> = new Map();

const CONNECTORS: ConnectorName[] = ["gmail", "gemini", "xai", "openai", "anthropic", "deepseek", "database", "forms"];

function initializeConnector(connector: ConnectorName): ConnectorMetricsData {
  return {
    totalCalls: 0,
    successCount: 0,
    failureCount: 0,
    totalLatencyMs: 0,
    lastUsed: null,
    hourlyBuckets: new Map(),
  };
}

for (const connector of CONNECTORS) {
  connectorMetrics.set(connector, initializeConnector(connector));
}

function getCurrentHour(): number {
  return Math.floor(Date.now() / (1000 * 60 * 60));
}

function cleanupOldBuckets(data: ConnectorMetricsData): void {
  const currentHour = getCurrentHour();
  const cutoffHour = currentHour - HOURS_TO_KEEP;
  
  const oldHours = Array.from(data.hourlyBuckets.keys()).filter(h => h < cutoffHour);
  for (const hour of oldHours) {
    data.hourlyBuckets.delete(hour);
  }
}

function getOrCreateHourlyBucket(data: ConnectorMetricsData, hour: number): HourlyBucket {
  let bucket = data.hourlyBuckets.get(hour);
  if (!bucket) {
    bucket = {
      hour,
      calls: 0,
      successes: 0,
      failures: 0,
      totalLatencyMs: 0,
    };
    data.hourlyBuckets.set(hour, bucket);
  }
  return bucket;
}

export function recordConnectorUsage(
  connector: ConnectorName,
  latencyMs: number,
  success: boolean
): void {
  let data = connectorMetrics.get(connector);
  if (!data) {
    data = initializeConnector(connector);
    connectorMetrics.set(connector, data);
  }
  
  const currentHour = getCurrentHour();
  cleanupOldBuckets(data);
  
  data.totalCalls++;
  data.totalLatencyMs += latencyMs;
  data.lastUsed = new Date();
  
  if (success) {
    data.successCount++;
  } else {
    data.failureCount++;
  }
  
  const bucket = getOrCreateHourlyBucket(data, currentHour);
  bucket.calls++;
  bucket.totalLatencyMs += latencyMs;
  if (success) {
    bucket.successes++;
  } else {
    bucket.failures++;
  }
  
  logger.debug(`Connector ${connector} usage recorded`, {
    latencyMs,
    success,
    totalCalls: data.totalCalls,
  });
}

export function getConnectorStats(connector: ConnectorName): ConnectorStats | null {
  const data = connectorMetrics.get(connector);
  if (!data) {
    return null;
  }
  
  cleanupOldBuckets(data);
  
  const hourlyUsage = Array.from(data.hourlyBuckets.values())
    .sort((a, b) => a.hour - b.hour);
  
  return {
    connector,
    totalCalls: data.totalCalls,
    successCount: data.successCount,
    failureCount: data.failureCount,
    totalLatencyMs: data.totalLatencyMs,
    averageLatencyMs: data.totalCalls > 0 ? data.totalLatencyMs / data.totalCalls : 0,
    successRate: data.totalCalls > 0 ? data.successCount / data.totalCalls : 1,
    lastUsed: data.lastUsed,
    hourlyUsage,
  };
}

export function getAllConnectorStats(): ConnectorStats[] {
  const stats: ConnectorStats[] = [];
  
  for (const connector of CONNECTORS) {
    const connectorStats = getConnectorStats(connector);
    if (connectorStats) {
      stats.push(connectorStats);
    }
  }
  
  return stats;
}

export function resetConnectorStats(connector?: ConnectorName): void {
  if (connector) {
    connectorMetrics.set(connector, initializeConnector(connector));
    logger.info(`Reset stats for connector: ${connector}`);
  } else {
    for (const c of CONNECTORS) {
      connectorMetrics.set(c, initializeConnector(c));
    }
    logger.info("Reset stats for all connectors");
  }
}

export function getHourlyAverageUsage(connector: ConnectorName): number {
  const data = connectorMetrics.get(connector);
  if (!data) return 0;
  
  cleanupOldBuckets(data);
  
  const buckets = Array.from(data.hourlyBuckets.values());
  if (buckets.length === 0) return 0;
  
  const totalCalls = buckets.reduce((sum, b) => sum + b.calls, 0);
  return totalCalls / buckets.length;
}

export function getRecentHourUsage(connector: ConnectorName): number {
  const data = connectorMetrics.get(connector);
  if (!data) return 0;
  
  const currentHour = getCurrentHour();
  const bucket = data.hourlyBuckets.get(currentHour);
  return bucket?.calls || 0;
}

export function isValidConnector(name: string): name is ConnectorName {
  return CONNECTORS.includes(name as ConnectorName);
}

setInterval(() => {
  for (const connector of CONNECTORS) {
    const data = connectorMetrics.get(connector);
    if (data) {
      cleanupOldBuckets(data);
    }
  }
}, 60 * 60 * 1000);
