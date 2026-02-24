/**
 * OpenTelemetry Instrumentation for Intent Analysis Pipeline
 *
 * Wraps analysis graph nodes with OTel spans for tracing
 * and latency visibility. Uses the existing telemetry setup
 * from server/lib/telemetry.ts.
 */

import { Logger } from "../../lib/logger";
import type { AnalysisState } from "./analysisGraph";

const LOG_COMPONENT = "AnalysisTracer";

// Try to load OpenTelemetry (graceful fallback if not configured)
let tracer: any = null;
let SpanStatusCode: any = null;

try {
  const otelApi = require("@opentelemetry/api");
  tracer = otelApi.trace.getTracer("intent-analysis", "1.0.0");
  SpanStatusCode = otelApi.SpanStatusCode;
} catch {
  Logger.debug("OpenTelemetry not available, tracing disabled", { component: LOG_COMPONENT });
}

/**
 * Wrap a LangGraph node function with an OTel span.
 * If OTel is not configured, runs the function without tracing.
 */
export function traceAnalysisNode<T extends (state: AnalysisState) => Promise<Partial<AnalysisState>>>(
  nodeName: string,
  fn: T,
): T {
  if (!tracer) return fn;

  return (async (state: AnalysisState): Promise<Partial<AnalysisState>> => {
    return tracer.startActiveSpan(`intent.${nodeName}`, async (span: any) => {
      const startTime = performance.now();
      try {
        span.setAttribute("intent.node", nodeName);
        span.setAttribute("intent.message_length", state.rawMessage?.length ?? 0);
        span.setAttribute("intent.user_id", state.userId ?? "unknown");
        span.setAttribute("intent.chat_id", state.chatId ?? "unknown");

        const result = await fn(state);

        // Add result attributes
        if (result.mergedIntent) {
          span.setAttribute("intent.type", result.mergedIntent.intent);
          span.setAttribute("intent.confidence", result.mergedIntent.confidence);
          span.setAttribute("intent.source", result.mergedIntent.source);
        }
        if (result.brief) {
          span.setAttribute("intent.has_brief", true);
          span.setAttribute("intent.subtask_count", result.brief.subtasks?.length ?? 0);
        }
        if (result.validationResult) {
          span.setAttribute("intent.validation_passed", result.validationResult.isValid);
          span.setAttribute("intent.validation_score", result.validationResult.score);
        }

        span.setAttribute("intent.node_latency_ms", performance.now() - startTime);
        span.setStatus({ code: SpanStatusCode.OK });

        return result;
      } catch (err) {
        span.recordException(err as Error);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: (err as Error).message,
        });
        throw err;
      } finally {
        span.end();
      }
    });
  }) as unknown as T;
}

/**
 * Create a root span for the entire analysis pipeline.
 */
export function traceAnalysisPipeline<T>(
  name: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (!tracer) return fn();

  return tracer.startActiveSpan(`intent.pipeline.${name}`, async (span: any) => {
    try {
      const result = await fn();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw err;
    } finally {
      span.end();
    }
  });
}
