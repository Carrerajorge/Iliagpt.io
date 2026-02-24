import { trace, context, SpanStatusCode, propagation, Span, SpanKind, Context } from '@opentelemetry/api';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { SimpleSpanProcessor, ConsoleSpanExporter, BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { Resource } from '@opentelemetry/resources';
// @opentelemetry/semantic-conventions has broken ESM directory imports — use CJS require
import { createRequire } from 'module';
const _require = createRequire(import.meta.url);
const { ATTR_SERVICE_NAME } = _require('@opentelemetry/semantic-conventions') as any;
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

const SERVICE_NAME = 'ilia-gpt-pare';

let provider: NodeTracerProvider | null = null;
let isInitialized = false;

function initializeTracing(): void {
  if (isInitialized) {
    return;
  }

  try {
    const resource = new Resource({
      [ATTR_SERVICE_NAME]: SERVICE_NAME,
    });

    provider = new NodeTracerProvider({
      resource,
    });

    const contextManager = new AsyncLocalStorageContextManager();
    contextManager.enable();
    context.setGlobalContextManager(contextManager);

    if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
      const otlpExporter = new OTLPTraceExporter({
        url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
      });
      provider.addSpanProcessor(new BatchSpanProcessor(otlpExporter));
    }

    provider.register();
    isInitialized = true;

    setupShutdownHooks();

    console.log(`[pareTracing] OpenTelemetry initialized for service: ${SERVICE_NAME}`);
  } catch (error) {
    console.error('[pareTracing] Failed to initialize OpenTelemetry:', error);
  }
}

function setupShutdownHooks(): void {
  const shutdown = async () => {
    if (provider) {
      try {
        await provider.shutdown();
        console.log('[pareTracing] OpenTelemetry shut down gracefully');
      } catch (error) {
        console.error('[pareTracing] Error during OpenTelemetry shutdown:', error);
      }
    }
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  process.on('beforeExit', shutdown);
}

initializeTracing();

export const tracer = trace.getTracer(SERVICE_NAME, '1.0.0');

export function startSpan(name: string, attributes?: Record<string, unknown>): Span {
  const span = tracer.startSpan(name, {
    kind: SpanKind.INTERNAL,
    attributes: attributes as Record<string, string | number | boolean>,
  });
  return span;
}

export async function withSpan<T>(
  name: string,
  fn: () => Promise<T>,
  attributes?: Record<string, unknown>
): Promise<T> {
  const span = tracer.startSpan(name, {
    kind: SpanKind.INTERNAL,
    attributes: attributes as Record<string, string | number | boolean>,
  });

  const ctx = trace.setSpan(context.active(), span);

  try {
    const result = await context.with(ctx, fn);
    span.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (error) {
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error instanceof Error ? error.message : String(error),
    });
    span.recordException(error instanceof Error ? error : new Error(String(error)));
    throw error;
  } finally {
    span.end();
  }
}

export function getTraceContext(): { traceId: string; spanId: string; traceparent: string } | null {
  const activeSpan = trace.getActiveSpan();
  if (!activeSpan) {
    return null;
  }

  const spanContext = activeSpan.spanContext();
  if (!spanContext || !trace.isSpanContextValid(spanContext)) {
    return null;
  }

  const traceparent = `00-${spanContext.traceId}-${spanContext.spanId}-${(spanContext.traceFlags ?? 0).toString(16).padStart(2, '0')}`;

  return {
    traceId: spanContext.traceId,
    spanId: spanContext.spanId,
    traceparent,
  };
}

export function injectTraceHeaders(headers: Record<string, string>): void {
  propagation.inject(context.active(), headers);
}

export interface TracedRequest extends Request {
  traceContext?: {
    traceId: string;
    spanId: string;
    requestId: string;
  };
  requestSpan?: Span;
}

export function traceMiddleware(req: TracedRequest, res: Response, next: NextFunction): void {
  const requestId = (req.headers['x-request-id'] as string) || randomUUID();

  let parentContext: Context = context.active();
  const traceparent = req.headers['traceparent'] as string | undefined;
  
  if (traceparent) {
    const carrier = { traceparent };
    parentContext = propagation.extract(context.active(), carrier);
  }

  const span = tracer.startSpan(
    `${req.method} ${req.path}`,
    {
      kind: SpanKind.SERVER,
      attributes: {
        'http.method': req.method,
        'http.url': req.url,
        'http.route': req.route?.path || req.path,
        'http.target': req.path,
        'http.host': req.hostname,
        'http.user_agent': req.get('user-agent') || '',
        'http.request_id': requestId,
      },
    },
    parentContext
  );

  const spanContext = span.spanContext();
  
  req.traceContext = {
    traceId: spanContext.traceId,
    spanId: spanContext.spanId,
    requestId,
  };
  req.requestSpan = span;

  res.setHeader('X-Request-ID', requestId);
  res.setHeader('X-Trace-ID', spanContext.traceId);

  const originalEnd = res.end;
  const originalWrite = res.write;

  res.end = function (this: Response, ...args: Parameters<typeof originalEnd>): Response {
    span.setAttribute('http.status_code', res.statusCode);
    
    if (res.statusCode >= 400) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: `HTTP ${res.statusCode}`,
      });
    } else {
      span.setStatus({ code: SpanStatusCode.OK });
    }
    
    span.end();
    return originalEnd.apply(this, args);
  };

  const ctx = trace.setSpan(parentContext, span);
  context.with(ctx, () => {
    next();
  });
}

export function getTraceContextForLogger(): { traceId?: string; spanId?: string } {
  const traceContext = getTraceContext();
  if (!traceContext) {
    return {};
  }
  return {
    traceId: traceContext.traceId,
    spanId: traceContext.spanId,
  };
}

export function createChildSpan(name: string, attributes?: Record<string, unknown>): Span {
  return tracer.startSpan(name, {
    kind: SpanKind.INTERNAL,
    attributes: attributes as Record<string, string | number | boolean>,
  });
}

export function recordSpanError(span: Span, error: Error | string): void {
  const err = error instanceof Error ? error : new Error(String(error));
  span.recordException(err);
  span.setStatus({
    code: SpanStatusCode.ERROR,
    message: err.message,
  });
}

export function addSpanAttributes(span: Span, attributes: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(attributes)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      span.setAttribute(key, value);
    } else if (value !== null && value !== undefined) {
      span.setAttribute(key, String(value));
    }
  }
}

export async function shutdownTracing(): Promise<void> {
  if (provider) {
    try {
      await provider.shutdown();
      isInitialized = false;
      console.log('[pareTracing] OpenTelemetry shut down successfully');
    } catch (error) {
      console.error('[pareTracing] Error shutting down OpenTelemetry:', error);
      throw error;
    }
  }
}

export {
  SpanStatusCode,
  SpanKind,
  Span,
  Context,
};
