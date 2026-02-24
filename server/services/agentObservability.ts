/**
 * Agent Observability (#49)
 * Detailed tracing and debugging for agent pipelines
 */

import { EventEmitter } from 'events';
import crypto from 'crypto';

// ============================================
// TYPES
// ============================================

interface AgentSpan {
    id: string;
    parentId: string | null;
    traceId: string;
    agentName: string;
    operation: string;
    startTime: Date;
    endTime?: Date;
    duration?: number;
    status: 'running' | 'success' | 'error';
    input?: any;
    output?: any;
    error?: string;
    metadata: Record<string, any>;
    children: AgentSpan[];
}

interface AgentTrace {
    id: string;
    userId: number;
    sessionId: string;
    startTime: Date;
    endTime?: Date;
    totalDuration?: number;
    status: 'running' | 'success' | 'error' | 'cancelled';
    rootSpan: AgentSpan | null;
    spans: AgentSpan[];
    events: TraceEvent[];
    metrics: TraceMetrics;
}

interface TraceEvent {
    timestamp: Date;
    type: 'decision' | 'tool_call' | 'error' | 'warning' | 'info';
    agentName: string;
    message: string;
    data?: any;
}

interface TraceMetrics {
    totalSpans: number;
    totalTokensIn: number;
    totalTokensOut: number;
    estimatedCost: number;
    toolCalls: number;
    retries: number;
    averageSpanDuration: number;
}

// ============================================
// TRACE CONTEXT
// ============================================

const activeTraces = new Map<string, AgentTrace>();
const traceHistory: AgentTrace[] = [];
const MAX_HISTORY = 100;

export class TraceContext {
    private trace: AgentTrace;
    private spanStack: AgentSpan[] = [];
    private emitter = new EventEmitter();

    constructor(userId: number, sessionId: string) {
        this.trace = {
            id: crypto.randomUUID(),
            userId,
            sessionId,
            startTime: new Date(),
            status: 'running',
            rootSpan: null,
            spans: [],
            events: [],
            metrics: {
                totalSpans: 0,
                totalTokensIn: 0,
                totalTokensOut: 0,
                estimatedCost: 0,
                toolCalls: 0,
                retries: 0,
                averageSpanDuration: 0,
            },
        };

        activeTraces.set(this.trace.id, this.trace);
    }

    get traceId(): string {
        return this.trace.id;
    }

    // Start a new span
    startSpan(agentName: string, operation: string, metadata: Record<string, any> = {}): SpanContext {
        const parentSpan = this.spanStack[this.spanStack.length - 1] || null;

        const span: AgentSpan = {
            id: crypto.randomUUID(),
            parentId: parentSpan?.id || null,
            traceId: this.trace.id,
            agentName,
            operation,
            startTime: new Date(),
            status: 'running',
            metadata,
            children: [],
        };

        if (parentSpan) {
            parentSpan.children.push(span);
        } else {
            this.trace.rootSpan = span;
        }

        this.trace.spans.push(span);
        this.spanStack.push(span);
        this.trace.metrics.totalSpans++;

        this.emitter.emit('span:start', span);

        return new SpanContext(this, span);
    }

    // Internal: end span
    _endSpan(span: AgentSpan, status: 'success' | 'error', output?: any, error?: string): void {
        span.endTime = new Date();
        span.duration = span.endTime.getTime() - span.startTime.getTime();
        span.status = status;
        span.output = output;
        span.error = error;

        // Remove from stack
        const index = this.spanStack.indexOf(span);
        if (index > -1) {
            this.spanStack.splice(index, 1);
        }

        // Update average duration
        const durations = this.trace.spans
            .filter(s => s.duration !== undefined)
            .map(s => s.duration!);
        this.trace.metrics.averageSpanDuration =
            durations.reduce((a, b) => a + b, 0) / durations.length;

        this.emitter.emit('span:end', span);
    }

    // Log event
    logEvent(type: TraceEvent['type'], agentName: string, message: string, data?: any): void {
        const event: TraceEvent = {
            timestamp: new Date(),
            type,
            agentName,
            message,
            data,
        };

        this.trace.events.push(event);
        this.emitter.emit('event', event);
    }

    // Log decision
    logDecision(agentName: string, decision: string, reasoning?: string): void {
        this.logEvent('decision', agentName, decision, { reasoning });
    }

    // Log tool call
    logToolCall(agentName: string, toolName: string, params?: any): void {
        this.trace.metrics.toolCalls++;
        this.logEvent('tool_call', agentName, `Called tool: ${toolName}`, { toolName, params });
    }

    // Update tokens
    addTokens(input: number, output: number, model: string): void {
        this.trace.metrics.totalTokensIn += input;
        this.trace.metrics.totalTokensOut += output;

        // Estimate cost (simplified)
        const costPerMillion = model.includes('grok-3') ? 15 : model.includes('gemini') ? 10 : 15;
        this.trace.metrics.estimatedCost +=
            ((input + output) / 1_000_000) * costPerMillion;
    }

    // Complete trace
    complete(status: 'success' | 'error' | 'cancelled' = 'success'): AgentTrace {
        this.trace.endTime = new Date();
        this.trace.totalDuration = this.trace.endTime.getTime() - this.trace.startTime.getTime();
        this.trace.status = status;

        activeTraces.delete(this.trace.id);
        traceHistory.unshift(this.trace);

        // Limit history
        while (traceHistory.length > MAX_HISTORY) {
            traceHistory.pop();
        }

        this.emitter.emit('trace:complete', this.trace);
        return this.trace;
    }

    // Subscribe to events
    on(event: string, listener: (...args: any[]) => void): void {
        this.emitter.on(event, listener);
    }

    // Get current trace
    getTrace(): AgentTrace {
        return this.trace;
    }
}

// ============================================
// SPAN CONTEXT
// ============================================

export class SpanContext {
    constructor(
        private traceContext: TraceContext,
        private span: AgentSpan
    ) { }

    setInput(input: any): this {
        this.span.input = input;
        return this;
    }

    addMetadata(key: string, value: any): this {
        this.span.metadata[key] = value;
        return this;
    }

    success(output?: any): void {
        this.traceContext._endSpan(this.span, 'success', output);
    }

    error(error: Error | string): void {
        const errorMsg = error instanceof Error ? error.message : error;
        this.traceContext._endSpan(this.span, 'error', undefined, errorMsg);
    }

    // For async blocks
    async wrap<T>(fn: () => Promise<T>): Promise<T> {
        try {
            const result = await fn();
            this.success(result);
            return result;
        } catch (error: any) {
            this.error(error);
            throw error;
        }
    }
}

// ============================================
// GLOBAL FUNCTIONS
// ============================================

export function getActiveTraces(): AgentTrace[] {
    return Array.from(activeTraces.values());
}

export function getTraceHistory(): AgentTrace[] {
    return traceHistory;
}

export function getTrace(traceId: string): AgentTrace | undefined {
    return activeTraces.get(traceId) || traceHistory.find(t => t.id === traceId);
}

export function clearTraceHistory(): void {
    traceHistory.length = 0;
}

// ============================================
// EXPRESS ROUTER
// ============================================

import { Router, Request, Response } from 'express';

export function createObservabilityRouter(): Router {
    const router = Router();

    // Get all active traces
    router.get('/traces/active', (req: Request, res: Response) => {
        const traces = getActiveTraces().map(t => ({
            id: t.id,
            userId: t.userId,
            startTime: t.startTime,
            status: t.status,
            spanCount: t.spans.length,
        }));
        res.json(traces);
    });

    // Get trace history
    router.get('/traces/history', (req: Request, res: Response) => {
        const limit = parseInt(req.query.limit as string) || 20;
        const traces = getTraceHistory().slice(0, limit);
        res.json(traces);
    });

    // Get specific trace
    router.get('/traces/:traceId', (req: Request, res: Response) => {
        const trace = getTrace(req.params.traceId);
        if (!trace) {
            return res.status(404).json({ error: 'Trace not found' });
        }
        res.json(trace);
    });

    // Get trace visualization data
    router.get('/traces/:traceId/timeline', (req: Request, res: Response) => {
        const trace = getTrace(req.params.traceId);
        if (!trace) {
            return res.status(404).json({ error: 'Trace not found' });
        }

        // Build timeline for visualization
        const timeline = trace.spans.map(span => ({
            id: span.id,
            parentId: span.parentId,
            agent: span.agentName,
            operation: span.operation,
            start: span.startTime.getTime() - trace.startTime.getTime(),
            duration: span.duration || 0,
            status: span.status,
        }));

        res.json({ traceId: trace.id, timeline });
    });

    return router;
}
