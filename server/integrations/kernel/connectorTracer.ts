/**
 * ConnectorTracer — OpenTelemetry span wrapping for connector operations.
 * Graceful no-op if OTel is not configured.
 *
 * Usage:
 *   import { withConnectorSpan } from "./connectorTracer";
 *   const result = await withConnectorSpan("google-calendar", "list_events", async () => {
 *     return handler.listEvents(params);
 *   });
 */

let tracer: any = null;
try {
  const { trace } = require("@opentelemetry/api");
  tracer = trace.getTracer("connector-platform", "1.0.0");
} catch {
  // OTel not available — all spans will be no-ops
}

/**
 * Wraps an async function in an OTel span scoped to a specific connector
 * and operation. If OTel is not configured, the function executes directly
 * without any tracing overhead.
 *
 * @param connectorId - The connector identifier (e.g. "google-calendar")
 * @param operationId - The operation name (e.g. "list_events", "create_event")
 * @param fn          - The async function to execute within the span
 * @returns The result of fn()
 */
export async function withConnectorSpan<T>(
  connectorId: string,
  operationId: string,
  fn: () => Promise<T>
): Promise<T> {
  if (!tracer) return fn();

  return tracer.startActiveSpan(
    `connector.${connectorId}.${operationId}`,
    async (span: any) => {
      try {
        span.setAttribute("connector.id", connectorId);
        span.setAttribute("connector.operation", operationId);
        span.setAttribute("connector.timestamp", Date.now());

        const start = performance.now();
        const result = await fn();
        const durationMs = Math.round(performance.now() - start);

        span.setAttribute("connector.duration_ms", durationMs);
        span.setStatus({ code: 1 }); // SpanStatusCode.OK
        return result;
      } catch (err: any) {
        span.setStatus({ code: 2, message: err?.message }); // SpanStatusCode.ERROR
        span.recordException(err);
        throw err;
      } finally {
        span.end();
      }
    }
  );
}

/**
 * Wraps a synchronous function in an OTel span. Useful for quick
 * operations like registry lookups or policy checks.
 */
export function withConnectorSpanSync<T>(
  connectorId: string,
  operationId: string,
  fn: () => T
): T {
  if (!tracer) return fn();

  const span = tracer.startSpan(`connector.${connectorId}.${operationId}`);
  try {
    span.setAttribute("connector.id", connectorId);
    span.setAttribute("connector.operation", operationId);

    const result = fn();

    span.setStatus({ code: 1 });
    return result;
  } catch (err: any) {
    span.setStatus({ code: 2, message: err?.message });
    span.recordException(err);
    throw err;
  } finally {
    span.end();
  }
}
