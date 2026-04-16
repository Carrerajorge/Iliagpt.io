/** * OpenTelemetry Tracing Service * * Features: * - Automatic trace propagation * - Span creation for pipeline steps * - Export to Jaeger/Zipkin * - Custom attributes and events */

import { Request, Response, NextFunction } from "express";

// OpenTelemetry configuration
export interface TelemetryConfig {
    serviceName: string;
    serviceVersion: string;
    environment: string;
    exporterType: "jaeger" | "zipkin" | "otlp" | "console" | "none";
    exporterEndpoint?: string;
    sampleRate: number;
    enabled: boolean;
}

const DEFAULT_CONFIG: TelemetryConfig = {
    serviceName: "iliagpt",
    serviceVersion: process.env.APP_VERSION || "1.0.0",
    environment: process.env.NODE_ENV || "development",
    exporterType: "console",
    sampleRate: 0.1,
    enabled: process.env.OTEL_ENABLED === "true",
};

// Span status
type SpanStatus = "OK" | "ERROR" | "UNSET";

// Span interface (simplified)
export interface Span {
    traceId: string;
    spanId: string;
    parentSpanId?: string;
    name: string;
    kind: "INTERNAL" | "SERVER" | "CLIENT" | "PRODUCER" | "CONSUMER";
    startTime: number;
    endTime?: number;
    status: SpanStatus;
    attributes: Record<string, string | number | boolean>;
    events: { name: string; timestamp: number; attributes?: Record<string, any> }[];
}

// Active spans
const activeSpans = new Map<string, Span>();

// Completed spans buffer (for export)
const spanBuffer: Span[] = [];
const MAX_SPAN_BUFFER = 1000;

let config = { ...DEFAULT_CONFIG };
let tracer: any = null;

// Generate IDs
function generateTraceId(): string {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

function generateSpanId(): string {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

// Initialize OpenTelemetry
export async function initTelemetry(customConfig: Partial<TelemetryConfig> = {}): Promise<boolean> {
    config = { ...DEFAULT_CONFIG, ...customConfig };

    if (!config.enabled) {
        console.log("[OpenTelemetry] Disabled");
        return false;
    }

    try {
        // Try to load OpenTelemetry SDK
        const { NodeSDK } = await import("@opentelemetry/sdk-node");
        const { getNodeAutoInstrumentations } = await import("@opentelemetry/auto-instrumentations-node");
        const { resourceFromAttributes } = await import("@opentelemetry/resources");
        const { SemanticResourceAttributes } = await import("@opentelemetry/semantic-conventions");

        // Create exporter based on config
        let exporter: any;

        switch (config.exporterType) {
            case "jaeger":
                const { JaegerExporter } = await import("@opentelemetry/exporter-jaeger");
                exporter = new JaegerExporter({
                    endpoint: config.exporterEndpoint || "http://localhost:14268/api/traces",
                });
                break;

            case "zipkin":
                const { ZipkinExporter } = await import("@opentelemetry/exporter-zipkin");
                exporter = new ZipkinExporter({
                    url: config.exporterEndpoint || "http://localhost:9411/api/v2/spans",
                });
                break;

            case "otlp":
                const { OTLPTraceExporter } = await import("@opentelemetry/exporter-trace-otlp-http");
                exporter = new OTLPTraceExporter({
                    url: config.exporterEndpoint || "http://localhost:4318/v1/traces",
                });
                break;

            case "console":
            default:
                const { ConsoleSpanExporter } = await import("@opentelemetry/sdk-trace-base");
                exporter = new ConsoleSpanExporter();
        }

        const sdk = new NodeSDK({
            resource: resourceFromAttributes({
                [SemanticResourceAttributes.SERVICE_NAME]: config.serviceName,
                [SemanticResourceAttributes.SERVICE_VERSION]: config.serviceVersion,
                [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: config.environment,
            }),
            traceExporter: exporter,
            instrumentations: [getNodeAutoInstrumentations()],
        });

        sdk.start();

        const { trace } = await import("@opentelemetry/api");
        tracer = trace.getTracer(config.serviceName, config.serviceVersion);

        console.log(`[OpenTelemetry] Initialized with ${config.exporterType} exporter`);
        return true;
    } catch (error) {
        console.warn("[OpenTelemetry] SDK not available, using local tracing");
        return false;
    }
}

// Start a new span
export function startSpan(
    name: string,
    options: {
        kind?: Span["kind"];
        parentSpanId?: string;
        traceId?: string;
        attributes?: Record<string, string | number | boolean>;
    } = {}
): Span {
    const span: Span = {
        traceId: options.traceId || generateTraceId(),
        spanId: generateSpanId(),
        parentSpanId: options.parentSpanId,
        name,
        kind: options.kind || "INTERNAL",
        startTime: Date.now(),
        status: "UNSET",
        attributes: {
            "service.name": config.serviceName,
            "service.version": config.serviceVersion,
            ...options.attributes,
        },
        events: [],
    };

    activeSpans.set(span.spanId, span);

    if (tracer) {
        // Use real OpenTelemetry tracer
        // (implementation depends on SDK version)
    }

    return span;
}

// End a span
export function endSpan(
    spanId: string,
    status: SpanStatus = "OK",
    attributes?: Record<string, string | number | boolean>
): void {
    const span = activeSpans.get(spanId);
    if (!span) return;

    span.endTime = Date.now();
    span.status = status;

    if (attributes) {
        Object.assign(span.attributes, attributes);
    }

    activeSpans.delete(spanId);
    bufferSpan(span);

    if (config.enabled && config.exporterType === "console") {
        console.log(`[Trace] ${span.name}`, {
            traceId: span.traceId.slice(0, 8),
            duration: span.endTime - span.startTime,
            status: span.status,
        });
    }
}

// Add event to span
export function addSpanEvent(
    spanId: string,
    name: string,
    attributes?: Record<string, any>
): void {
    const span = activeSpans.get(spanId);
    if (!span) return;

    span.events.push({
        name,
        timestamp: Date.now(),
        attributes,
    });
}

// Set span attributes
export function setSpanAttributes(
    spanId: string,
    attributes: Record<string, string | number | boolean>
): void {
    const span = activeSpans.get(spanId);
    if (!span) return;

    Object.assign(span.attributes, attributes);
}

// Set span error
export function setSpanError(spanId: string, error: Error): void {
    const span = activeSpans.get(spanId);
    if (!span) return;

    span.status = "ERROR";
    span.attributes["error"] = true;
    span.attributes["error.message"] = error.message;
    span.attributes["error.type"] = error.name;

    addSpanEvent(spanId, "exception", {
        message: error.message,
        stack: error.stack,
    });
}

// Buffer completed span
function bufferSpan(span: Span): void {
    if (spanBuffer.length >= MAX_SPAN_BUFFER) {
        spanBuffer.shift();
    }
    spanBuffer.push(span);
}

// Express middleware for automatic tracing
export function traceMiddleware() {
    return (req: Request, res: Response, next: NextFunction) => {
        // Extract trace context from headers
        const traceParent = req.headers["traceparent"] as string;
        let traceId: string | undefined;
        let parentSpanId: string | undefined;

        if (traceParent) {
            const parts = traceParent.split("-");
            if (parts.length >= 3) {
                traceId = parts[1];
                parentSpanId = parts[2];
            }
        }

        // Start request span
        const span = startSpan(`${req.method} ${req.path}`, {
            kind: "SERVER",
            traceId,
            parentSpanId,
            attributes: {
                "http.method": req.method,
                "http.url": req.url,
                "http.target": req.path,
                "http.host": req.hostname,
                "http.user_agent": req.get("user-agent") || "",
            },
        });

        // Attach to request
        (req as any).__span = span;

        // Set response header for trace correlation
        res.setHeader("X-Trace-Id", span.traceId);

        // Capture response
        const originalEnd = res.end.bind(res);
        res.end = function (...args: any[]) {
            setSpanAttributes(span.spanId, {
                "http.status_code": res.statusCode,
            });

            endSpan(
                span.spanId,
                res.statusCode >= 400 ? "ERROR" : "OK"
            );

            return originalEnd(...args);
        };

        next();
    };
}

// Create child span from request
export function createChildSpan(req: Request, name: string): Span {
    const parentSpan = (req as any).__span as Span | undefined;

    return startSpan(name, {
        traceId: parentSpan?.traceId,
        parentSpanId: parentSpan?.spanId,
        kind: "INTERNAL",
    });
}

// Trace a function execution
export function traceFunction<T extends (...args: any[]) => any>(
    name: string,
    fn: T,
    options: { attributes?: Record<string, any> } = {}
): T {
    return ((...args: Parameters<T>): ReturnType<T> => {
        const span = startSpan(name, { attributes: options.attributes });

        try {
            const result = fn(...args);

            if (result instanceof Promise) {
                return result
                    .then((value) => {
                        endSpan(span.spanId, "OK");
                        return value;
                    })
                    .catch((error) => {
                        setSpanError(span.spanId, error);
                        endSpan(span.spanId, "ERROR");
                        throw error;
                    }) as ReturnType<T>;
            }

            endSpan(span.spanId, "OK");
            return result;
        } catch (error) {
            setSpanError(span.spanId, error as Error);
            endSpan(span.spanId, "ERROR");
            throw error;
        }
    }) as T;
}

// Get recent traces (for debugging)
export function getRecentTraces(limit = 100): Span[] {
    return spanBuffer.slice(-limit);
}

// Get trace by ID
export function getTrace(traceId: string): Span[] {
    return spanBuffer.filter(s => s.traceId === traceId);
}

// Shutdown telemetry
export async function shutdownTelemetry(): Promise<void> {
    // Flush any pending spans
    console.log(`[OpenTelemetry] Shutdown - ${spanBuffer.length} spans captured`);
}

export default {
    initTelemetry,
    startSpan,
    endSpan,
    addSpanEvent,
    setSpanAttributes,
    setSpanError,
    traceMiddleware,
    createChildSpan,
    traceFunction,
    getRecentTraces,
    getTrace,
    shutdownTelemetry,
};
