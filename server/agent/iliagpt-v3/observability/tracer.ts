import type { Logger, TracerSpan } from "../types";
import { nowISO, uid } from "../config";

export interface SpanContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
}

export class Span implements TracerSpan {
  name: string;
  startTime: number;
  endTime?: number;
  attributes: Record<string, unknown>;
  events: Array<{ name: string; timestamp: number; attributes?: Record<string, unknown> }>;
  
  readonly spanId: string;
  readonly traceId: string;
  readonly parentSpanId?: string;
  
  private logger: Logger;

  constructor(
    name: string,
    logger: Logger,
    traceId: string,
    parentSpanId?: string,
    attributes: Record<string, unknown> = {}
  ) {
    this.name = name;
    this.spanId = uid("span");
    this.traceId = traceId;
    this.parentSpanId = parentSpanId;
    this.startTime = performance.now();
    this.attributes = attributes;
    this.events = [];
    this.logger = logger;
  }

  setAttribute(key: string, value: unknown): void {
    this.attributes[key] = value;
  }

  addEvent(name: string, attributes?: Record<string, unknown>): void {
    this.events.push({
      name,
      timestamp: performance.now(),
      attributes,
    });
  }

  end(status: "ok" | "error" = "ok"): void {
    this.endTime = performance.now();
    this.attributes["status"] = status;
    
    const durationMs = this.endTime - this.startTime;
    
    this.logger.debug(`span:${this.name}`, {
      spanId: this.spanId,
      traceId: this.traceId,
      parentSpanId: this.parentSpanId,
      durationMs,
      status,
      attributes: this.attributes,
      eventCount: this.events.length,
    });
  }

  getContext(): SpanContext {
    return {
      traceId: this.traceId,
      spanId: this.spanId,
      parentSpanId: this.parentSpanId,
    };
  }

  getDurationMs(): number | undefined {
    if (this.endTime === undefined) return undefined;
    return this.endTime - this.startTime;
  }
}

export class Tracer {
  private logger: Logger;
  private activeSpans = new Map<string, Span>();

  constructor(logger: Logger) {
    this.logger = logger;
  }

  startSpan(name: string, traceId: string, parentSpanId?: string, attributes?: Record<string, unknown>): Span {
    const span = new Span(name, this.logger, traceId, parentSpanId, attributes);
    this.activeSpans.set(span.spanId, span);
    return span;
  }

  endSpan(spanId: string, status: "ok" | "error" = "ok"): void {
    const span = this.activeSpans.get(spanId);
    if (span) {
      span.end(status);
      this.activeSpans.delete(spanId);
    }
  }

  async span<T>(
    name: string,
    attributes: Record<string, unknown>,
    fn: () => Promise<T>
  ): Promise<T> {
    const traceId = (attributes.traceId as string) || uid("trace");
    const parentSpanId = attributes.parentSpanId as string | undefined;
    
    const span = this.startSpan(name, traceId, parentSpanId, attributes);
    
    try {
      const result = await fn();
      span.setAttribute("success", true);
      span.end("ok");
      return result;
    } catch (error) {
      span.setAttribute("success", false);
      span.setAttribute("error", error instanceof Error ? error.message : String(error));
      span.end("error");
      throw error;
    }
  }

  getActiveSpans(): Span[] {
    return Array.from(this.activeSpans.values());
  }

  clearActiveSpans(): void {
    for (const span of Array.from(this.activeSpans.values())) {
      span.end("error");
    }
    this.activeSpans.clear();
  }
}
