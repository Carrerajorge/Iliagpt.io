import type { Request, Response, NextFunction } from "express";
import crypto from "crypto";

// ── Metrics Store ──────────────────────────────────────────────────────────

export const metricsCollector = {
  httpRequests: new Map<string, number>(),
  httpDurations: [] as { path: string; duration: number }[],
  llmTokens: new Map<string, { input: number; output: number }>(),
  activeConnections: { sse: 0, ws: 0 },
  documentGenerations: new Map<string, number>(),
  toolExecutions: new Map<string, number>(),

  recordRequest(method: string, path: string, status: number) {
    const key = `${method}:${path}:${status}`;
    this.httpRequests.set(key, (this.httpRequests.get(key) ?? 0) + 1);
  },

  recordDuration(path: string, duration: number) {
    this.httpDurations.push({ path, duration });
    if (this.httpDurations.length > 10_000) {
      this.httpDurations = this.httpDurations.slice(-10_000);
    }
  },

  recordLlmTokens(provider: string, model: string, input: number, output: number) {
    const key = `${provider}:${model}`;
    const prev = this.llmTokens.get(key) ?? { input: 0, output: 0 };
    this.llmTokens.set(key, { input: prev.input + input, output: prev.output + output });
  },

  recordDocGen(type: string) {
    this.documentGenerations.set(type, (this.documentGenerations.get(type) ?? 0) + 1);
  },

  recordToolExec(tool: string) {
    this.toolExecutions.set(tool, (this.toolExecutions.get(tool) ?? 0) + 1);
  },
};

// ── Request Logger Middleware ───────────────────────────────────────────────

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();
  const correlationId = (req.headers["x-correlation-id"] as string) ?? crypto.randomUUID();
  res.setHeader("X-Correlation-Id", correlationId);

  const originalEnd = res.end.bind(res);
  res.end = function (...args: any[]) {
    const duration = Date.now() - start;
    const status = res.statusCode;
    const userId = (req as any).user?.id?.toString()
      ?? (req.headers["x-anonymous-user-id"] as string)
      ?? "anon";

    const normalizedPath = req.route?.path ?? req.path.replace(/\/[a-f0-9-]{36}/g, "/:id");

    metricsCollector.recordRequest(req.method, normalizedPath, status);
    metricsCollector.recordDuration(normalizedPath, duration);

    const level = status >= 500 ? "error" : status >= 400 ? "warn" : "info";
    const entry = JSON.stringify({
      level,
      method: req.method,
      path: req.path,
      status,
      duration,
      userId,
      correlationId,
      ts: new Date().toISOString(),
    });
    console.log(entry);

    return originalEnd(...args);
  } as any;

  next();
}

// ── Prometheus Metrics Endpoint ────────────────────────────────────────────

export function metricsEndpoint(_req: Request, res: Response) {
  const lines: string[] = [];

  lines.push("# HELP http_requests_total Total HTTP requests");
  lines.push("# TYPE http_requests_total counter");
  for (const [key, count] of metricsCollector.httpRequests) {
    const [method, path, status] = key.split(":");
    lines.push(`http_requests_total{method="${method}",path="${path}",status="${status}"} ${count}`);
  }

  lines.push("# HELP http_request_duration_ms HTTP request duration in ms");
  lines.push("# TYPE http_request_duration_ms summary");
  const byPath = new Map<string, number[]>();
  for (const d of metricsCollector.httpDurations) {
    const arr = byPath.get(d.path) ?? [];
    arr.push(d.duration);
    byPath.set(d.path, arr);
  }
  for (const [path, durations] of byPath) {
    const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
    lines.push(`http_request_duration_ms{path="${path}",quantile="avg"} ${avg.toFixed(1)}`);
  }

  lines.push("# HELP llm_tokens_total LLM tokens consumed");
  lines.push("# TYPE llm_tokens_total counter");
  for (const [key, tokens] of metricsCollector.llmTokens) {
    const [provider, model] = key.split(":");
    lines.push(`llm_tokens_total{provider="${provider}",model="${model}",dir="input"} ${tokens.input}`);
    lines.push(`llm_tokens_total{provider="${provider}",model="${model}",dir="output"} ${tokens.output}`);
  }

  lines.push("# HELP active_connections Current active connections");
  lines.push("# TYPE active_connections gauge");
  lines.push(`active_connections{type="sse"} ${metricsCollector.activeConnections.sse}`);
  lines.push(`active_connections{type="ws"} ${metricsCollector.activeConnections.ws}`);

  lines.push("# HELP document_generations_total Document generations");
  lines.push("# TYPE document_generations_total counter");
  for (const [type, count] of metricsCollector.documentGenerations) {
    lines.push(`document_generations_total{type="${type}"} ${count}`);
  }

  lines.push("# HELP tool_executions_total Tool executions");
  lines.push("# TYPE tool_executions_total counter");
  for (const [tool, count] of metricsCollector.toolExecutions) {
    lines.push(`tool_executions_total{tool="${tool}"} ${count}`);
  }

  res.setHeader("Content-Type", "text/plain; version=0.0.4");
  res.send(lines.join("\n") + "\n");
}

// ── Health Endpoint ────────────────────────────────────────────────────────

const startTime = Date.now();

export function healthEndpoint(_req: Request, res: Response) {
  const mem = process.memoryUsage();
  res.json({
    status: "ok",
    uptime: Math.floor((Date.now() - startTime) / 1000),
    memory: { rss: mem.rss, heapUsed: mem.heapUsed },
    timestamp: new Date().toISOString(),
  });
}
