import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import {
  BatchSpanProcessor,
  ConsoleSpanExporter,
  SimpleSpanProcessor,
  SpanProcessor,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
  AlwaysOnSampler,
} from "@opentelemetry/sdk-trace-base";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import {
  trace,
  context,
  propagation,
  SpanKind,
  SpanStatusCode,
  Span,
  Context,
  Tracer,
  SpanOptions,
} from "@opentelemetry/api";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { ExpressInstrumentation } from "@opentelemetry/instrumentation-express";
import { PgInstrumentation } from "@opentelemetry/instrumentation-pg";
import { AsyncHooksContextManager } from "@opentelemetry/context-async-hooks";
import { Counter, Histogram, register } from "prom-client";

const SERVICE_NAME = process.env.OTEL_SERVICE_NAME || "iliagpt-server";
const SERVICE_VERSION = process.env.npm_package_version || "1.0.0";
const OTEL_ENDPOINT = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const SAMPLE_RATE = IS_PRODUCTION ? 0.1 : 1.0;

let tracerProvider: NodeTracerProvider | null = null;
let tracer: Tracer | null = null;
let isInitialized = false;

const spansExportedCounter = new Counter({
  name: "otel_spans_exported_total",
  help: "Total number of spans exported",
  labelNames: ["status", "exporter"],
  registers: [],
});

const spanDurationHistogram = new Histogram({
  name: "otel_span_duration_seconds",
  help: "Duration of spans in seconds",
  labelNames: ["span_name", "status"],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [],
});

try {
  register.registerMetric(spansExportedCounter);
  register.registerMetric(spanDurationHistogram);
} catch {
}

export const SPAN_NAMES = {
  LLM_REQUEST: "llm.request",
  DB_QUERY: "db.query",
  AGENT_STEP: "agent.step",
  PIPELINE_STAGE: "pipeline.stage",
  HTTP_REQUEST: "http.request",
  TOOL_EXECUTION: "tool.execution",
  DOCUMENT_GENERATION: "document.generation",
  FILE_PROCESSING: "file.processing",
} as const;

export const SPAN_ATTRIBUTES = {
  USER_ID: "user.id",
  REQUEST_ID: "request.id",
  SESSION_ID: "session.id",
  LLM_MODEL: "llm.model",
  LLM_TOKENS: "llm.tokens",
  LLM_TOKENS_INPUT: "llm.tokens.input",
  LLM_TOKENS_OUTPUT: "llm.tokens.output",
  LLM_DURATION_MS: "llm.duration_ms",
  LLM_PROVIDER: "llm.provider",
  AGENT_RUN_ID: "agent.run_id",
  AGENT_STEP_NAME: "agent.step_name",
  AGENT_TOOL_NAME: "agent.tool_name",
  PIPELINE_NAME: "pipeline.name",
  PIPELINE_STAGE_NAME: "pipeline.stage_name",
  DB_STATEMENT: "db.statement",
  DB_OPERATION: "db.operation",
  DB_TABLE: "db.table",
  ERROR_TYPE: "error.type",
  ERROR_MESSAGE: "error.message",
} as const;

interface TracingConfig {
  serviceName?: string;
  serviceVersion?: string;
  environment?: string;
  sampleRate?: number;
  otlpEndpoint?: string;
  enableConsoleExporter?: boolean;
  enableMetrics?: boolean;
}

interface StartSpanOptions extends SpanOptions {
  userId?: string;
  requestId?: string;
  sessionId?: string;
}

class CountingSpanProcessor implements SpanProcessor {
  private delegate: SpanProcessor;
  private exporterName: string;

  constructor(delegate: SpanProcessor, exporterName: string) {
    this.delegate = delegate;
    this.exporterName = exporterName;
  }

  onStart(span: any, parentContext: Context): void {
    this.delegate.onStart(span, parentContext);
  }

  onEnd(span: any): void {
    const startTime = span.startTime;
    const endTime = span.endTime;
    const durationMs = (endTime[0] - startTime[0]) * 1000 + (endTime[1] - startTime[1]) / 1e6;
    const durationSeconds = durationMs / 1000;

    spanDurationHistogram
      .labels(span.name, span.status?.code === SpanStatusCode.ERROR ? "error" : "ok")
      .observe(durationSeconds);

    spansExportedCounter.labels("pending", this.exporterName).inc();

    this.delegate.onEnd(span);
  }

  async shutdown(): Promise<void> {
    return this.delegate.shutdown();
  }

  async forceFlush(): Promise<void> {
    return this.delegate.forceFlush();
  }
}

export function initTracing(config: TracingConfig = {}): void {
  if (isInitialized) {
    console.log("[Tracing] Already initialized, skipping");
    return;
  }

  const serviceName = config.serviceName || SERVICE_NAME;
  const serviceVersion = config.serviceVersion || SERVICE_VERSION;
  const environment = config.environment || (IS_PRODUCTION ? "production" : "development");
  const sampleRate = config.sampleRate ?? SAMPLE_RATE;
  const otlpEndpoint = config.otlpEndpoint || OTEL_ENDPOINT;
  const enableConsoleExporter = config.enableConsoleExporter ?? !IS_PRODUCTION;

  console.log(`[Tracing] Initializing OpenTelemetry for ${serviceName}@${serviceVersion}`);
  console.log(`[Tracing] Environment: ${environment}, Sample rate: ${sampleRate * 100}%`);

  const contextManager = new AsyncHooksContextManager();
  contextManager.enable();
  context.setGlobalContextManager(contextManager);

  const resource = resourceFromAttributes({
    "service.name": serviceName,
    "service.version": serviceVersion,
    "deployment.environment": environment,
    "host.name": process.env.HOSTNAME || "unknown",
  });

  const sampler = new ParentBasedSampler({
    root: sampleRate >= 1.0
      ? new AlwaysOnSampler()
      : new TraceIdRatioBasedSampler(sampleRate),
  });

  const spanProcessors: SpanProcessor[] = [];

  if (otlpEndpoint) {
    console.log(`[Tracing] OTLP exporter enabled: ${otlpEndpoint}`);
    const otlpExporter = new OTLPTraceExporter({
      url: `${otlpEndpoint}/v1/traces`,
      headers: process.env.OTEL_EXPORTER_OTLP_HEADERS
        ? JSON.parse(process.env.OTEL_EXPORTER_OTLP_HEADERS)
        : undefined,
    });

    const batchProcessor = new BatchSpanProcessor(otlpExporter, {
      maxQueueSize: 2048,
      maxExportBatchSize: 512,
      scheduledDelayMillis: 5000,
      exportTimeoutMillis: 30000,
    });

    spanProcessors.push(new CountingSpanProcessor(batchProcessor, "otlp"));
  }

  if (enableConsoleExporter && IS_PRODUCTION) {
    console.log("[Tracing] Console exporter enabled");
    const consoleExporter = new ConsoleSpanExporter();
    const simpleProcessor = new SimpleSpanProcessor(consoleExporter);
    spanProcessors.push(new CountingSpanProcessor(simpleProcessor, "console"));
  }

  tracerProvider = new NodeTracerProvider({
    resource,
    sampler,
    spanProcessors,
  });

  const httpInstrumentation = new HttpInstrumentation({
    ignoreIncomingRequestHook: (req) => {
      const ignorePaths = ["/health", "/metrics", "/ready", "/live"];
      return ignorePaths.some((path) => req.url?.startsWith(path));
    },
    requestHook: (span, request) => {
      if ("headers" in request && request.headers) {
        const userId = (request.headers as any)["x-user-id"];
        const requestId = (request.headers as any)["x-request-id"];
        if (userId) span.setAttribute(SPAN_ATTRIBUTES.USER_ID, userId);
        if (requestId) span.setAttribute(SPAN_ATTRIBUTES.REQUEST_ID, requestId);
      }
    },
  });

  const expressInstrumentation = new ExpressInstrumentation({
    ignoreLayers: [
      (name: string) => name.includes("cors"),
      (name: string) => name.includes("helmet"),
    ],
    requestHook: (span, info) => {
      span.updateName(`${info.request.method} ${info.route || info.request.path}`);
    },
  });

  const pgInstrumentation = new PgInstrumentation({
    enhancedDatabaseReporting: true,
    addSqlCommenterCommentToQueries: true,
  });

  httpInstrumentation.setTracerProvider(tracerProvider);
  expressInstrumentation.setTracerProvider(tracerProvider);
  pgInstrumentation.setTracerProvider(tracerProvider);

  tracerProvider.register();

  tracer = trace.getTracer(serviceName, serviceVersion);

  isInitialized = true;
  console.log("[Tracing] OpenTelemetry initialized successfully");
}

export function getTracer(): Tracer {
  if (!tracer) {
    initTracing();
  }
  return tracer || trace.getTracer(SERVICE_NAME);
}

export function startSpan(name: string, options: StartSpanOptions = {}): Span {
  const t = getTracer();
  const { userId, requestId, sessionId, ...spanOptions } = options;

  const span = t.startSpan(name, {
    kind: SpanKind.INTERNAL,
    ...spanOptions,
  });

  if (userId) span.setAttribute(SPAN_ATTRIBUTES.USER_ID, userId);
  if (requestId) span.setAttribute(SPAN_ATTRIBUTES.REQUEST_ID, requestId);
  if (sessionId) span.setAttribute(SPAN_ATTRIBUTES.SESSION_ID, sessionId);

  return span;
}

export function getActiveSpan(): Span | undefined {
  return trace.getActiveSpan();
}

export function addAttribute(key: string, value: string | number | boolean): void {
  const span = getActiveSpan();
  if (span) {
    span.setAttribute(key, value);
  }
}

export function addAttributes(attributes: Record<string, string | number | boolean>): void {
  const span = getActiveSpan();
  if (span) {
    span.setAttributes(attributes);
  }
}

export function recordError(error: Error): void {
  const span = getActiveSpan();
  if (span) {
    span.recordException(error);
    span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
  }
}

export async function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T> | T,
  options: StartSpanOptions = {}
): Promise<T> {
  const t = getTracer();
  const { userId, requestId, sessionId, ...spanOptions } = options;

  return t.startActiveSpan(
    name,
    {
      kind: SpanKind.INTERNAL,
      ...spanOptions,
    },
    async (span) => {
      if (userId) span.setAttribute(SPAN_ATTRIBUTES.USER_ID, userId);
      if (requestId) span.setAttribute(SPAN_ATTRIBUTES.REQUEST_ID, requestId);
      if (sessionId) span.setAttribute(SPAN_ATTRIBUTES.SESSION_ID, sessionId);

      try {
        const result = await fn(span);
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (error) {
        span.recordException(error as Error);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: (error as Error).message,
        });
        throw error;
      } finally {
        span.end();
      }
    }
  );
}

export function withSyncSpan<T>(
  name: string,
  fn: (span: Span) => T,
  options: StartSpanOptions = {}
): T {
  const span = startSpan(name, options);
  const ctx = trace.setSpan(context.active(), span);

  return context.with(ctx, () => {
    try {
      const result = fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: (error as Error).message,
      });
      throw error;
    } finally {
      span.end();
    }
  });
}

export function injectTraceContext(headers: Record<string, string>): Record<string, string> {
  const result = { ...headers };
  propagation.inject(context.active(), result);
  return result;
}

export function extractTraceContext(headers: Record<string, string | string[] | undefined>): Context {
  const normalizedHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === "string") {
      normalizedHeaders[key.toLowerCase()] = value;
    } else if (Array.isArray(value) && value.length > 0) {
      normalizedHeaders[key.toLowerCase()] = value[0];
    }
  }
  return propagation.extract(context.active(), normalizedHeaders);
}

export function runWithContext<T>(parentContext: Context, fn: () => T): T {
  return context.with(parentContext, fn);
}

export async function withLLMSpan<T>(
  model: string,
  provider: string,
  fn: (span: Span) => Promise<T>,
  options: StartSpanOptions = {}
): Promise<T> {
  return withSpan(
    SPAN_NAMES.LLM_REQUEST,
    async (span) => {
      span.setAttribute(SPAN_ATTRIBUTES.LLM_MODEL, model);
      span.setAttribute(SPAN_ATTRIBUTES.LLM_PROVIDER, provider);

      const startTime = Date.now();
      try {
        const result = await fn(span);
        const duration = Date.now() - startTime;
        span.setAttribute(SPAN_ATTRIBUTES.LLM_DURATION_MS, duration);
        return result;
      } catch (error) {
        const duration = Date.now() - startTime;
        span.setAttribute(SPAN_ATTRIBUTES.LLM_DURATION_MS, duration);
        throw error;
      }
    },
    { kind: SpanKind.CLIENT, ...options }
  );
}

export async function withDBSpan<T>(
  operation: string,
  table: string,
  fn: (span: Span) => Promise<T>,
  options: StartSpanOptions = {}
): Promise<T> {
  return withSpan(
    SPAN_NAMES.DB_QUERY,
    async (span) => {
      span.setAttribute(SPAN_ATTRIBUTES.DB_OPERATION, operation);
      span.setAttribute(SPAN_ATTRIBUTES.DB_TABLE, table);
      return fn(span);
    },
    { kind: SpanKind.CLIENT, ...options }
  );
}

export async function withAgentSpan<T>(
  runId: string,
  stepName: string,
  fn: (span: Span) => Promise<T>,
  options: StartSpanOptions = {}
): Promise<T> {
  return withSpan(
    SPAN_NAMES.AGENT_STEP,
    async (span) => {
      span.setAttribute(SPAN_ATTRIBUTES.AGENT_RUN_ID, runId);
      span.setAttribute(SPAN_ATTRIBUTES.AGENT_STEP_NAME, stepName);
      return fn(span);
    },
    options
  );
}

export async function withPipelineSpan<T>(
  pipelineName: string,
  stageName: string,
  fn: (span: Span) => Promise<T>,
  options: StartSpanOptions = {}
): Promise<T> {
  return withSpan(
    SPAN_NAMES.PIPELINE_STAGE,
    async (span) => {
      span.setAttribute(SPAN_ATTRIBUTES.PIPELINE_NAME, pipelineName);
      span.setAttribute(SPAN_ATTRIBUTES.PIPELINE_STAGE_NAME, stageName);
      return fn(span);
    },
    options
  );
}

export async function withToolSpan<T>(
  toolName: string,
  fn: (span: Span) => Promise<T>,
  options: StartSpanOptions = {}
): Promise<T> {
  return withSpan(
    SPAN_NAMES.TOOL_EXECUTION,
    async (span) => {
      span.setAttribute(SPAN_ATTRIBUTES.AGENT_TOOL_NAME, toolName);
      return fn(span);
    },
    options
  );
}

export function setLLMTokens(inputTokens: number, outputTokens: number): void {
  const span = getActiveSpan();
  if (span) {
    span.setAttribute(SPAN_ATTRIBUTES.LLM_TOKENS_INPUT, inputTokens);
    span.setAttribute(SPAN_ATTRIBUTES.LLM_TOKENS_OUTPUT, outputTokens);
    span.setAttribute(SPAN_ATTRIBUTES.LLM_TOKENS, inputTokens + outputTokens);
  }
}

export async function shutdownTracing(): Promise<void> {
  if (tracerProvider) {
    console.log("[Tracing] Shutting down OpenTelemetry...");
    await tracerProvider.shutdown();
    tracerProvider = null;
    tracer = null;
    isInitialized = false;
    console.log("[Tracing] OpenTelemetry shutdown complete");
  }
}

export function getTracingMetrics(): {
  isInitialized: boolean;
  serviceName: string;
  sampleRate: number;
  hasOtlpEndpoint: boolean;
} {
  return {
    isInitialized,
    serviceName: SERVICE_NAME,
    sampleRate: SAMPLE_RATE,
    hasOtlpEndpoint: !!OTEL_ENDPOINT,
  };
}
