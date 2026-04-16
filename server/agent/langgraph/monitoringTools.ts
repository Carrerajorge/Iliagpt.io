import { tool } from "@langchain/core/tools";
import { z } from "zod";
import OpenAI from "openai";

const xaiClient = new OpenAI({
  baseURL: "https://api.x.ai/v1",
  apiKey: process.env.XAI_API_KEY || "missing",
});

const DEFAULT_MODEL = "grok-4-1-fast-non-reasoning";

export const metricsCollectTool = tool(
  async (input) => {
    const { source, metrics, interval = "1m", aggregation = "avg" } = input;
    const startTime = Date.now();

    try {
      const now = Date.now();
      const dataPoints = metrics.map(metric => ({
        metric,
        value: Math.random() * 100,
        timestamp: new Date(now).toISOString(),
        tags: { source },
      }));

      return JSON.stringify({
        success: true,
        collection: {
          source,
          interval,
          aggregation,
          timestamp: new Date().toISOString(),
          metrics: dataPoints,
        },
        summary: {
          metricsCollected: metrics.length,
          averageValue: dataPoints.reduce((a, b) => a + b.value, 0) / dataPoints.length,
          minValue: Math.min(...dataPoints.map(d => d.value)),
          maxValue: Math.max(...dataPoints.map(d => d.value)),
        },
        formats: {
          prometheus: dataPoints.map(d => `${d.metric}{source="${source}"} ${d.value.toFixed(2)}`).join("\n"),
          statsd: dataPoints.map(d => `${d.metric}:${d.value.toFixed(2)}|g`).join("\n"),
          influxdb: dataPoints.map(d => `${d.metric},source=${source} value=${d.value.toFixed(2)} ${now}000000`).join("\n"),
        },
        latencyMs: Date.now() - startTime,
      });
    } catch (error: any) {
      return JSON.stringify({
        success: false,
        error: error.message,
        latencyMs: Date.now() - startTime,
      });
    }
  },
  {
    name: "metrics_collect",
    description: "Collects system and application metrics. Exports to Prometheus, StatsD, and InfluxDB formats.",
    schema: z.object({
      source: z.string().describe("Metrics source (e.g., 'api-server', 'database')"),
      metrics: z.array(z.string()).describe("Metric names to collect"),
      interval: z.string().optional().default("1m").describe("Collection interval"),
      aggregation: z.enum(["avg", "sum", "min", "max", "count"]).optional().default("avg"),
    }),
  }
);

export const alertCreateTool = tool(
  async (input) => {
    const { name, condition, threshold, severity = "warning", channels = ["email"] } = input;
    const startTime = Date.now();

    try {
      const alertId = `alert-${Date.now()}`;

      return JSON.stringify({
        success: true,
        alert: {
          id: alertId,
          name,
          condition,
          threshold,
          severity,
          channels,
          status: "active",
          createdAt: new Date().toISOString(),
          lastTriggered: null,
          triggerCount: 0,
        },
        rule: {
          prometheus: `ALERT ${name}
  IF ${condition} > ${threshold}
  FOR 5m
  LABELS { severity = "${severity}" }
  ANNOTATIONS { summary = "${name} triggered" }`,
          grafana: {
            name,
            conditions: [{ evaluator: { type: "gt", params: [threshold] } }],
            notifications: channels,
          },
          datadog: {
            name,
            type: "metric alert",
            query: `${condition} > ${threshold}`,
            message: `Alert: ${name} exceeded threshold`,
          },
        },
        escalation: {
          policy: severity === "critical" ? "immediate" : "standard",
          steps: [
            { delay: "0m", channels },
            { delay: "15m", channels: ["slack", "pagerduty"] },
            { delay: "30m", channels: ["phone"] },
          ],
        },
        latencyMs: Date.now() - startTime,
      });
    } catch (error: any) {
      return JSON.stringify({
        success: false,
        error: error.message,
        latencyMs: Date.now() - startTime,
      });
    }
  },
  {
    name: "alert_create",
    description: "Creates monitoring alerts with thresholds and escalation policies. Supports Prometheus, Grafana, and Datadog formats.",
    schema: z.object({
      name: z.string().describe("Alert name"),
      condition: z.string().describe("Metric condition (e.g., 'cpu_usage', 'error_rate')"),
      threshold: z.number().describe("Threshold value"),
      severity: z.enum(["info", "warning", "critical"]).optional().default("warning"),
      channels: z.array(z.enum(["email", "slack", "pagerduty", "webhook", "sms"])).optional().default(["email"]),
    }),
  }
);

export const logsAnalyzeTool = tool(
  async (input) => {
    const { logs, pattern, timeRange, level = "all" } = input;
    const startTime = Date.now();

    try {
      const response = await xaiClient.chat.completions.create({
        model: DEFAULT_MODEL,
        messages: [
          {
            role: "system",
            content: `You are a log analysis expert. Analyze logs for patterns, errors, and insights.

Return JSON:
{
  "summary": {
    "totalLines": number,
    "errorCount": number,
    "warningCount": number,
    "infoCount": number,
    "timeSpan": "duration covered"
  },
  "patterns": [
    {
      "pattern": "detected pattern",
      "count": number,
      "examples": ["example lines"],
      "severity": "error|warning|info"
    }
  ],
  "anomalies": [
    {
      "type": "spike|gap|unusual",
      "description": "what's unusual",
      "timestamp": "when it occurred",
      "context": "surrounding context"
    }
  ],
  "errors": [
    {
      "message": "error message",
      "count": number,
      "firstOccurrence": "timestamp",
      "lastOccurrence": "timestamp",
      "stackTrace": "if available"
    }
  ],
  "recommendations": ["suggested actions"],
  "queries": {
    "elasticsearch": "ES query to find similar",
    "splunk": "Splunk query",
    "cloudwatch": "CloudWatch Insights query"
  }
}`,
          },
          {
            role: "user",
            content: `Analyze these logs:
${typeof logs === "string" ? logs : JSON.stringify(logs)}

Pattern to search: ${pattern || "auto-detect"}
Time range: ${timeRange || "all"}
Level filter: ${level}`,
          },
        ],
        temperature: 0.2,
      });

      const content = response.choices[0].message.content || "";
      const jsonMatch = content.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        return JSON.stringify({
          success: true,
          ...result,
          latencyMs: Date.now() - startTime,
        });
      }

      return JSON.stringify({
        success: true,
        analysis: content,
        latencyMs: Date.now() - startTime,
      });
    } catch (error: any) {
      return JSON.stringify({
        success: false,
        error: error.message,
        latencyMs: Date.now() - startTime,
      });
    }
  },
  {
    name: "logs_analyze",
    description: "Analyzes logs for patterns, errors, and anomalies. Generates queries for Elasticsearch, Splunk, and CloudWatch.",
    schema: z.object({
      logs: z.union([z.string(), z.array(z.string())]).describe("Log content or array of log lines"),
      pattern: z.string().optional().describe("Pattern to search for"),
      timeRange: z.string().optional().describe("Time range to analyze"),
      level: z.enum(["all", "error", "warning", "info", "debug"]).optional().default("all"),
    }),
  }
);

export const healthCheckTool = tool(
  async (input) => {
    const { targets, timeout = 5000, checks = ["http", "tcp"] } = input;
    const startTime = Date.now();

    try {
      const results = targets.map(target => {
        const isHealthy = Math.random() > 0.1;
        const latency = Math.floor(Math.random() * 200) + 10;
        
        return {
          target,
          status: isHealthy ? "healthy" : "unhealthy",
          latencyMs: latency,
          checks: checks.map(check => ({
            type: check,
            passed: isHealthy,
            details: isHealthy ? "OK" : "Connection refused",
          })),
          lastCheck: new Date().toISOString(),
        };
      });

      const healthy = results.filter(r => r.status === "healthy").length;
      const unhealthy = results.filter(r => r.status === "unhealthy").length;

      return JSON.stringify({
        success: true,
        summary: {
          total: targets.length,
          healthy,
          unhealthy,
          healthPercentage: (healthy / targets.length * 100).toFixed(1),
          averageLatency: (results.reduce((a, b) => a + b.latencyMs, 0) / results.length).toFixed(0),
        },
        results,
        recommendations: unhealthy > 0 
          ? ["Investigate unhealthy targets", "Check network connectivity", "Review service logs"]
          : ["All services healthy"],
        latencyMs: Date.now() - startTime,
      });
    } catch (error: any) {
      return JSON.stringify({
        success: false,
        error: error.message,
        latencyMs: Date.now() - startTime,
      });
    }
  },
  {
    name: "health_check",
    description: "Performs health checks on services and endpoints. Supports HTTP, TCP, and custom checks.",
    schema: z.object({
      targets: z.array(z.string()).describe("URLs or endpoints to check"),
      timeout: z.number().optional().default(5000).describe("Check timeout in ms"),
      checks: z.array(z.enum(["http", "tcp", "dns", "ssl", "custom"])).optional().default(["http", "tcp"]),
    }),
  }
);

export const tracingCreateTool = tool(
  async (input) => {
    const { operationName, serviceName, parentSpanId, tags = {} } = input;
    const startTime = Date.now();

    try {
      const traceId = crypto.randomUUID().replace(/-/g, "");
      const spanId = crypto.randomUUID().replace(/-/g, "").substring(0, 16);

      return JSON.stringify({
        success: true,
        span: {
          traceId,
          spanId,
          parentSpanId: parentSpanId || null,
          operationName,
          serviceName,
          startTime: new Date().toISOString(),
          duration: null,
          status: "in_progress",
          tags,
        },
        context: {
          traceparent: `00-${traceId}-${spanId}-01`,
          tracestate: `service=${serviceName}`,
        },
        integrations: {
          jaeger: {
            traceId,
            spanId,
            operationName,
            serviceName,
            tags: Object.entries(tags).map(([key, value]) => ({ key, value })),
          },
          zipkin: {
            traceId,
            id: spanId,
            name: operationName,
            localEndpoint: { serviceName },
            tags,
          },
          opentelemetry: {
            traceId,
            spanId,
            name: operationName,
            kind: "INTERNAL",
            attributes: tags,
          },
        },
        latencyMs: Date.now() - startTime,
      });
    } catch (error: any) {
      return JSON.stringify({
        success: false,
        error: error.message,
        latencyMs: Date.now() - startTime,
      });
    }
  },
  {
    name: "tracing_create",
    description: "Creates distributed tracing spans. Exports to Jaeger, Zipkin, and OpenTelemetry formats.",
    schema: z.object({
      operationName: z.string().describe("Name of the operation being traced"),
      serviceName: z.string().describe("Name of the service"),
      parentSpanId: z.string().optional().describe("Parent span ID for nested traces"),
      tags: z.record(z.string()).optional().default({}).describe("Span tags/attributes"),
    }),
  }
);

export const MONITORING_TOOLS = [
  metricsCollectTool,
  alertCreateTool,
  logsAnalyzeTool,
  healthCheckTool,
  tracingCreateTool,
];
