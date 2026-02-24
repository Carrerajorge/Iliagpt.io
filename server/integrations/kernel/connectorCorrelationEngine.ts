/* ------------------------------------------------------------------ *
 *  connectorCorrelationEngine.ts — Distributed tracing, correlation
 *  links, anomaly detection, and timeline generation.
 *  Standalone module — no imports from other kernel files.
 * ------------------------------------------------------------------ */

// ─── Types ──────────────────────────────────────────────────────────

export interface TraceContext {
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  connectorId: string;
  operationName: string;
  baggage: Record<string, string>;
}

export interface SpanEvent {
  name: string;
  timestamp: number;
  attributes: Record<string, string | number | boolean>;
}

export interface Span {
  spanId: string;
  traceId: string;
  parentSpanId: string | null;
  connectorId: string;
  operationName: string;
  startTime: number;
  endTime: number | null;
  durationMs: number | null;
  status: 'OK' | 'ERROR' | 'UNSET';
  error: string | null;
  attributes: Record<string, string | number | boolean>;
  events: SpanEvent[];
  children: string[];
}

export interface Trace {
  traceId: string;
  rootSpanId: string | null;
  connectorId: string;
  operationName: string;
  startTime: number;
  endTime: number | null;
  durationMs: number | null;
  spanCount: number;
  errorCount: number;
  spans: Map<string, Span>;
}

export interface CorrelationLink {
  id: string;
  sourceSpanId: string;
  sourceTraceId: string;
  sourceConnectorId: string;
  targetSpanId: string;
  targetTraceId: string;
  targetConnectorId: string;
  linkType: 'CAUSES' | 'FOLLOWS' | 'DEPENDS_ON' | 'TRIGGERS' | 'PARALLEL';
  strength: number; // 0–1
  metadata: Record<string, string>;
  createdAt: number;
}

export interface TimelineEntry {
  timestamp: number;
  type: 'span_start' | 'span_end' | 'event' | 'error' | 'link';
  connectorId: string;
  spanId: string;
  traceId: string;
  operationName: string;
  detail: string;
  durationMs: number | null;
}

export interface AnomalyDetection {
  type:
    | 'cascading_failure'
    | 'circular_dependency'
    | 'fan_out_explosion'
    | 'slow_chain'
    | 'retry_storm';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  affectedSpans: string[];
  affectedConnectors: string[];
  detectedAt: number;
  metadata: Record<string, string | number>;
}

export interface CorrelationSummary {
  traceId: string;
  totalSpans: number;
  totalErrors: number;
  totalDurationMs: number;
  connectors: string[];
  criticalPath: string[];
  anomalies: AnomalyDetection[];
  links: CorrelationLink[];
  timeline: TimelineEntry[];
}

// ─── Helpers ────────────────────────────────────────────────────────

function generateId(prefix: string = ''): string {
  const hex = () =>
    Math.floor(Math.random() * 0xffffffff)
      .toString(16)
      .padStart(8, '0');
  return prefix ? `${prefix}_${hex()}${hex()}` : `${hex()}${hex()}`;
}

// ─── SpanBuilder ────────────────────────────────────────────────────

export class SpanBuilder {
  private span: Span;
  private store: TraceStore;

  constructor(
    traceId: string,
    connectorId: string,
    operationName: string,
    parentSpanId: string | null,
    store: TraceStore,
  ) {
    this.store = store;
    this.span = {
      spanId: generateId('span'),
      traceId,
      parentSpanId,
      connectorId,
      operationName,
      startTime: Date.now(),
      endTime: null,
      durationMs: null,
      status: 'UNSET',
      error: null,
      attributes: {},
      events: [],
      children: [],
    };
    store.addSpan(this.span);
  }

  getSpanId(): string {
    return this.span.spanId;
  }

  getTraceId(): string {
    return this.span.traceId;
  }

  setAttribute(key: string, value: string | number | boolean): SpanBuilder {
    this.span.attributes[key] = value;
    this.store.updateSpan(this.span.spanId, { attributes: { ...this.span.attributes } });
    return this;
  }

  addEvent(
    name: string,
    attributes: Record<string, string | number | boolean> = {},
  ): SpanBuilder {
    const event: SpanEvent = { name, timestamp: Date.now(), attributes };
    this.span.events.push(event);
    this.store.updateSpan(this.span.spanId, { events: [...this.span.events] });
    return this;
  }

  setError(error: Error | string): SpanBuilder {
    const msg = typeof error === 'string' ? error : error.message;
    this.span.status = 'ERROR';
    this.span.error = msg;
    this.store.updateSpan(this.span.spanId, { status: 'ERROR', error: msg });
    return this;
  }

  end(): Span {
    const now = Date.now();
    this.span.endTime = now;
    this.span.durationMs = now - this.span.startTime;
    if (this.span.status === 'UNSET') {
      this.span.status = 'OK';
    }
    this.store.updateSpan(this.span.spanId, {
      endTime: this.span.endTime,
      durationMs: this.span.durationMs,
      status: this.span.status,
    });
    return { ...this.span };
  }

  toContext(): TraceContext {
    return {
      traceId: this.span.traceId,
      spanId: this.span.spanId,
      parentSpanId: this.span.parentSpanId,
      connectorId: this.span.connectorId,
      operationName: this.span.operationName,
      baggage: {},
    };
  }
}

// ─── TraceStore ─────────────────────────────────────────────────────

const MAX_TRACES = 500;
const MAX_TRACE_AGE_MS = 60 * 60 * 1000; // 1 hr

export class TraceStore {
  private traces: Map<string, Trace> = new Map();
  private spanIndex: Map<string, Span> = new Map();
  private connectorTraces: Map<string, Set<string>> = new Map();
  private pruneTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.pruneTimer = setInterval(() => this.prune(), 60_000);
    if (this.pruneTimer && typeof this.pruneTimer === 'object' && 'unref' in this.pruneTimer) {
      (this.pruneTimer as NodeJS.Timeout).unref();
    }
  }

  /* ── createTrace ──────────────────────────────────────────────── */

  createTrace(connectorId: string, operationName: string): string {
    const traceId = generateId('trace');
    const trace: Trace = {
      traceId,
      rootSpanId: null,
      connectorId,
      operationName,
      startTime: Date.now(),
      endTime: null,
      durationMs: null,
      spanCount: 0,
      errorCount: 0,
      spans: new Map(),
    };
    this.traces.set(traceId, trace);
    this.indexConnector(connectorId, traceId);
    this.enforceMaxTraces();
    return traceId;
  }

  /* ── addSpan ──────────────────────────────────────────────────── */

  addSpan(span: Span): void {
    const trace = this.traces.get(span.traceId);
    if (!trace) return;

    trace.spans.set(span.spanId, span);
    trace.spanCount++;
    this.spanIndex.set(span.spanId, span);

    if (!span.parentSpanId) {
      trace.rootSpanId = span.spanId;
    } else {
      const parent = trace.spans.get(span.parentSpanId);
      if (parent) {
        parent.children.push(span.spanId);
      }
    }

    this.indexConnector(span.connectorId, span.traceId);
  }

  /* ── updateSpan ───────────────────────────────────────────────── */

  updateSpan(spanId: string, updates: Partial<Span>): void {
    const span = this.spanIndex.get(spanId);
    if (!span) return;

    Object.assign(span, updates);

    if (updates.status === 'ERROR') {
      const trace = this.traces.get(span.traceId);
      if (trace) trace.errorCount++;
    }

    if (updates.endTime !== undefined) {
      this.tryFinalizeTrace(span.traceId);
    }
  }

  /* ── getTrace ─────────────────────────────────────────────────── */

  getTrace(traceId: string): Trace | undefined {
    return this.traces.get(traceId);
  }

  /* ── getSpan ──────────────────────────────────────────────────── */

  getSpan(spanId: string): Span | undefined {
    return this.spanIndex.get(spanId);
  }

  /* ── getTraces ────────────────────────────────────────────────── */

  getTraces(limit: number = 100, offset: number = 0): Trace[] {
    const all = Array.from(this.traces.values());
    all.sort((a, b) => b.startTime - a.startTime);
    return all.slice(offset, offset + limit);
  }

  /* ── getTracesForConnector ────────────────────────────────────── */

  getTracesForConnector(
    connectorId: string,
    limit: number = 50,
  ): Trace[] {
    const ids = this.connectorTraces.get(connectorId);
    if (!ids) return [];
    const results: Trace[] = [];
    for (const id of Array.from(ids)) {
      const t = this.traces.get(id);
      if (t) results.push(t);
    }
    results.sort((a, b) => b.startTime - a.startTime);
    return results.slice(0, limit);
  }

  /* ── clear / destroy ──────────────────────────────────────────── */

  clear(): void {
    this.traces.clear();
    this.spanIndex.clear();
    this.connectorTraces.clear();
  }

  destroy(): void {
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer);
      this.pruneTimer = null;
    }
    this.clear();
  }

  /* ── internal ─────────────────────────────────────────────────── */

  private indexConnector(connectorId: string, traceId: string): void {
    let set = this.connectorTraces.get(connectorId);
    if (!set) {
      set = new Set();
      this.connectorTraces.set(connectorId, set);
    }
    set.add(traceId);
  }

  private tryFinalizeTrace(traceId: string): void {
    const trace = this.traces.get(traceId);
    if (!trace) return;
    let allEnded = true;
    let maxEnd = 0;
    for (const span of Array.from(trace.spans.values())) {
      if (span.endTime === null) {
        allEnded = false;
        break;
      }
      if (span.endTime > maxEnd) maxEnd = span.endTime;
    }
    if (allEnded && trace.spanCount > 0) {
      trace.endTime = maxEnd;
      trace.durationMs = maxEnd - trace.startTime;
    }
  }

  private enforceMaxTraces(): void {
    if (this.traces.size <= MAX_TRACES) return;
    const sorted = Array.from(this.traces.entries()).sort(
      (a, b) => a[1].startTime - b[1].startTime,
    );
    const toRemove = sorted.slice(0, sorted.length - MAX_TRACES);
    for (const [id, trace] of toRemove) {
      for (const spanId of Array.from(trace.spans.keys())) {
        this.spanIndex.delete(spanId);
      }
      this.traces.delete(id);
    }
  }

  private prune(): void {
    const cutoff = Date.now() - MAX_TRACE_AGE_MS;
    const toRemove: string[] = [];
    for (const [id, trace] of Array.from(this.traces.entries())) {
      if (trace.startTime < cutoff) {
        toRemove.push(id);
        for (const spanId of Array.from(trace.spans.keys())) {
          this.spanIndex.delete(spanId);
        }
      }
    }
    for (const id of toRemove) {
      this.traces.delete(id);
    }
    // clean connector index
    for (const [cid, set] of Array.from(this.connectorTraces.entries())) {
      for (const tid of Array.from(set)) {
        if (!this.traces.has(tid)) set.delete(tid);
      }
      if (set.size === 0) this.connectorTraces.delete(cid);
    }
  }
}

// ─── CorrelationEngine ──────────────────────────────────────────────

export class CorrelationEngine {
  private links: Map<string, CorrelationLink> = new Map();
  private spanLinks: Map<string, Set<string>> = new Map(); // spanId → link ids

  addLink(
    sourceSpanId: string,
    sourceTraceId: string,
    sourceConnectorId: string,
    targetSpanId: string,
    targetTraceId: string,
    targetConnectorId: string,
    linkType: CorrelationLink['linkType'],
    strength: number = 1,
    metadata: Record<string, string> = {},
  ): CorrelationLink {
    const link: CorrelationLink = {
      id: generateId('link'),
      sourceSpanId,
      sourceTraceId,
      sourceConnectorId,
      targetSpanId,
      targetTraceId,
      targetConnectorId,
      linkType,
      strength: Math.max(0, Math.min(1, strength)),
      metadata,
      createdAt: Date.now(),
    };
    this.links.set(link.id, link);
    this.indexSpanLink(sourceSpanId, link.id);
    this.indexSpanLink(targetSpanId, link.id);
    return link;
  }

  getLinksForSpan(spanId: string): CorrelationLink[] {
    const ids = this.spanLinks.get(spanId);
    if (!ids) return [];
    const results: CorrelationLink[] = [];
    for (const id of Array.from(ids)) {
      const l = this.links.get(id);
      if (l) results.push(l);
    }
    return results;
  }

  getCrossConnectorLinks(): CorrelationLink[] {
    return Array.from(this.links.values()).filter(
      (l) => l.sourceConnectorId !== l.targetConnectorId,
    );
  }

  buildInteractionGraph(): Map<string, Set<string>> {
    const graph: Map<string, Set<string>> = new Map();
    for (const link of Array.from(this.links.values())) {
      let srcSet = graph.get(link.sourceConnectorId);
      if (!srcSet) {
        srcSet = new Set();
        graph.set(link.sourceConnectorId, srcSet);
      }
      srcSet.add(link.targetConnectorId);

      let tgtSet = graph.get(link.targetConnectorId);
      if (!tgtSet) {
        tgtSet = new Set();
        graph.set(link.targetConnectorId, tgtSet);
      }
      tgtSet.add(link.sourceConnectorId);
    }
    return graph;
  }

  getAllLinks(): CorrelationLink[] {
    return Array.from(this.links.values());
  }

  clear(): void {
    this.links.clear();
    this.spanLinks.clear();
  }

  private indexSpanLink(spanId: string, linkId: string): void {
    let set = this.spanLinks.get(spanId);
    if (!set) {
      set = new Set();
      this.spanLinks.set(spanId, set);
    }
    set.add(linkId);
  }
}

// ─── CorrelationAnomalyDetector ─────────────────────────────────────

export class CorrelationAnomalyDetector {
  private readonly slowChainThresholdMs: number;
  private readonly fanOutThreshold: number;
  private readonly retryStormThreshold: number;

  constructor(options?: {
    slowChainThresholdMs?: number;
    fanOutThreshold?: number;
    retryStormThreshold?: number;
  }) {
    this.slowChainThresholdMs = options?.slowChainThresholdMs ?? 10000;
    this.fanOutThreshold = options?.fanOutThreshold ?? 10;
    this.retryStormThreshold = options?.retryStormThreshold ?? 5;
  }

  analyzeTrace(
    trace: Trace,
    links: CorrelationLink[],
  ): AnomalyDetection[] {
    const anomalies: AnomalyDetection[] = [];

    anomalies.push(...this.detectCascadingFailures(trace));
    anomalies.push(...this.detectCircularDeps(links));
    anomalies.push(...this.detectFanOut(trace));
    anomalies.push(...this.detectSlowChains(trace));
    anomalies.push(...this.detectRetryStorms(trace));

    return anomalies;
  }

  private detectCascadingFailures(trace: Trace): AnomalyDetection[] {
    const anomalies: AnomalyDetection[] = [];
    const errorSpans = Array.from(trace.spans.values()).filter(
      (s) => s.status === 'ERROR',
    );
    if (errorSpans.length < 2) return anomalies;

    // Sort by time
    errorSpans.sort((a, b) => a.startTime - b.startTime);

    // Check if errors cascade through parent-child chains
    const visited = new Set<string>();
    for (const span of errorSpans) {
      if (visited.has(span.spanId)) continue;
      const chain = this.findErrorChain(span, trace, visited);
      if (chain.length >= 2) {
        const connectors = [...new Set(chain.map((s) => s.connectorId))];
        anomalies.push({
          type: 'cascading_failure',
          severity: chain.length >= 4 ? 'critical' : chain.length >= 3 ? 'high' : 'medium',
          description: `Cascading failure across ${chain.length} spans involving ${connectors.length} connector(s)`,
          affectedSpans: chain.map((s) => s.spanId),
          affectedConnectors: connectors,
          detectedAt: Date.now(),
          metadata: { chainLength: chain.length, firstError: chain[0].error ?? 'unknown' },
        });
      }
    }

    return anomalies;
  }

  private findErrorChain(
    span: Span,
    trace: Trace,
    visited: Set<string>,
  ): Span[] {
    if (visited.has(span.spanId)) return [];
    visited.add(span.spanId);

    const chain: Span[] = [span];
    for (const childId of span.children) {
      const child = trace.spans.get(childId);
      if (child && child.status === 'ERROR') {
        chain.push(...this.findErrorChain(child, trace, visited));
      }
    }
    return chain;
  }

  private detectCircularDeps(links: CorrelationLink[]): AnomalyDetection[] {
    const anomalies: AnomalyDetection[] = [];
    const graph: Map<string, Set<string>> = new Map();
    for (const link of links) {
      if (link.linkType === 'DEPENDS_ON' || link.linkType === 'TRIGGERS') {
        let set = graph.get(link.sourceConnectorId);
        if (!set) {
          set = new Set();
          graph.set(link.sourceConnectorId, set);
        }
        set.add(link.targetConnectorId);
      }
    }

    // DFS cycle detection
    const allNodes = Array.from(graph.keys());
    const globalVisited = new Set<string>();

    for (const node of allNodes) {
      if (globalVisited.has(node)) continue;
      const path: string[] = [];
      const inPath = new Set<string>();
      const stack: Array<{ node: string; neighborIdx: number }> = [
        { node, neighborIdx: 0 },
      ];
      path.push(node);
      inPath.add(node);

      while (stack.length > 0) {
        const top = stack[stack.length - 1];
        const neighbors = Array.from(graph.get(top.node) ?? []);
        if (top.neighborIdx < neighbors.length) {
          const next = neighbors[top.neighborIdx];
          top.neighborIdx++;
          if (inPath.has(next)) {
            const cycleStart = path.indexOf(next);
            const cycle = path.slice(cycleStart);
            anomalies.push({
              type: 'circular_dependency',
              severity: 'high',
              description: `Circular dependency: ${cycle.join(' → ')} → ${next}`,
              affectedSpans: [],
              affectedConnectors: cycle,
              detectedAt: Date.now(),
              metadata: { cycleLength: cycle.length },
            });
          } else if (!globalVisited.has(next)) {
            path.push(next);
            inPath.add(next);
            stack.push({ node: next, neighborIdx: 0 });
          }
        } else {
          stack.pop();
          const removed = path.pop();
          if (removed) {
            inPath.delete(removed);
            globalVisited.add(removed);
          }
        }
      }
    }

    return anomalies;
  }

  private detectFanOut(trace: Trace): AnomalyDetection[] {
    const anomalies: AnomalyDetection[] = [];
    for (const span of Array.from(trace.spans.values())) {
      if (span.children.length >= this.fanOutThreshold) {
        anomalies.push({
          type: 'fan_out_explosion',
          severity: span.children.length >= this.fanOutThreshold * 2 ? 'high' : 'medium',
          description: `Span "${span.operationName}" fans out to ${span.children.length} children`,
          affectedSpans: [span.spanId, ...span.children],
          affectedConnectors: [span.connectorId],
          detectedAt: Date.now(),
          metadata: { fanOutCount: span.children.length },
        });
      }
    }
    return anomalies;
  }

  private detectSlowChains(trace: Trace): AnomalyDetection[] {
    const anomalies: AnomalyDetection[] = [];
    if (!trace.rootSpanId) return anomalies;

    const root = trace.spans.get(trace.rootSpanId);
    if (!root) return anomalies;

    // Find the critical path (longest duration chain)
    const criticalPath = this.findCriticalPath(root, trace);
    const totalDuration = criticalPath.reduce(
      (sum, s) => sum + (s.durationMs ?? 0),
      0,
    );

    if (totalDuration >= this.slowChainThresholdMs && criticalPath.length >= 2) {
      anomalies.push({
        type: 'slow_chain',
        severity: totalDuration >= this.slowChainThresholdMs * 3 ? 'critical' : totalDuration >= this.slowChainThresholdMs * 2 ? 'high' : 'medium',
        description: `Slow chain of ${criticalPath.length} spans totaling ${totalDuration}ms`,
        affectedSpans: criticalPath.map((s) => s.spanId),
        affectedConnectors: [...new Set(criticalPath.map((s) => s.connectorId))],
        detectedAt: Date.now(),
        metadata: { totalDurationMs: totalDuration, chainLength: criticalPath.length },
      });
    }

    return anomalies;
  }

  private findCriticalPath(span: Span, trace: Trace): Span[] {
    if (span.children.length === 0) return [span];

    let longestChild: Span[] = [];
    for (const childId of span.children) {
      const child = trace.spans.get(childId);
      if (!child) continue;
      const childPath = this.findCriticalPath(child, trace);
      const childDuration = childPath.reduce(
        (sum, s) => sum + (s.durationMs ?? 0),
        0,
      );
      const longestDuration = longestChild.reduce(
        (sum, s) => sum + (s.durationMs ?? 0),
        0,
      );
      if (childDuration > longestDuration) {
        longestChild = childPath;
      }
    }

    return [span, ...longestChild];
  }

  private detectRetryStorms(trace: Trace): AnomalyDetection[] {
    const anomalies: AnomalyDetection[] = [];
    // Group spans by operationName + connectorId
    const groups: Map<string, Span[]> = new Map();
    for (const span of Array.from(trace.spans.values())) {
      const key = `${span.connectorId}::${span.operationName}`;
      let group = groups.get(key);
      if (!group) {
        group = [];
        groups.set(key, group);
      }
      group.push(span);
    }

    for (const [key, spans] of Array.from(groups.entries())) {
      if (spans.length >= this.retryStormThreshold) {
        const errorCount = spans.filter((s) => s.status === 'ERROR').length;
        if (errorCount >= 2) {
          anomalies.push({
            type: 'retry_storm',
            severity: spans.length >= this.retryStormThreshold * 2 ? 'critical' : 'high',
            description: `Retry storm: ${spans.length} calls to "${key}" (${errorCount} errors)`,
            affectedSpans: spans.map((s) => s.spanId),
            affectedConnectors: [spans[0].connectorId],
            detectedAt: Date.now(),
            metadata: {
              retryCount: spans.length,
              errorCount,
              operation: spans[0].operationName,
            },
          });
        }
      }
    }

    return anomalies;
  }
}

// ─── TimelineGenerator ──────────────────────────────────────────────

export class TimelineGenerator {
  generateTimeline(
    trace: Trace,
    links: CorrelationLink[] = [],
  ): TimelineEntry[] {
    const entries: TimelineEntry[] = [];

    for (const span of Array.from(trace.spans.values())) {
      entries.push({
        timestamp: span.startTime,
        type: 'span_start',
        connectorId: span.connectorId,
        spanId: span.spanId,
        traceId: span.traceId,
        operationName: span.operationName,
        detail: `Start: ${span.operationName}`,
        durationMs: null,
      });

      if (span.endTime !== null) {
        entries.push({
          timestamp: span.endTime,
          type: span.status === 'ERROR' ? 'error' : 'span_end',
          connectorId: span.connectorId,
          spanId: span.spanId,
          traceId: span.traceId,
          operationName: span.operationName,
          detail: span.status === 'ERROR'
            ? `Error: ${span.error ?? 'unknown'}`
            : `End: ${span.operationName} (${span.durationMs}ms)`,
          durationMs: span.durationMs,
        });
      }

      for (const evt of span.events) {
        entries.push({
          timestamp: evt.timestamp,
          type: 'event',
          connectorId: span.connectorId,
          spanId: span.spanId,
          traceId: span.traceId,
          operationName: span.operationName,
          detail: `Event: ${evt.name}`,
          durationMs: null,
        });
      }
    }

    for (const link of links) {
      entries.push({
        timestamp: link.createdAt,
        type: 'link',
        connectorId: link.sourceConnectorId,
        spanId: link.sourceSpanId,
        traceId: link.sourceTraceId,
        operationName: `${link.linkType}: ${link.sourceConnectorId} → ${link.targetConnectorId}`,
        detail: `Link (${link.linkType}) strength=${link.strength.toFixed(2)}`,
        durationMs: null,
      });
    }

    entries.sort((a, b) => a.timestamp - b.timestamp);
    return entries;
  }

  buildSummary(
    trace: Trace,
    links: CorrelationLink[],
    anomalies: AnomalyDetection[],
  ): CorrelationSummary {
    const connectors = new Set<string>();
    for (const span of Array.from(trace.spans.values())) {
      connectors.add(span.connectorId);
    }

    // Build critical path
    const criticalPath: string[] = [];
    if (trace.rootSpanId) {
      const root = trace.spans.get(trace.rootSpanId);
      if (root) {
        this.buildCriticalPath(root, trace, criticalPath);
      }
    }

    const timeline = this.generateTimeline(trace, links);

    return {
      traceId: trace.traceId,
      totalSpans: trace.spanCount,
      totalErrors: trace.errorCount,
      totalDurationMs: trace.durationMs ?? 0,
      connectors: Array.from(connectors),
      criticalPath,
      anomalies,
      links,
      timeline,
    };
  }

  private buildCriticalPath(span: Span, trace: Trace, path: string[]): void {
    path.push(span.spanId);
    if (span.children.length === 0) return;

    let slowestChild: Span | null = null;
    let maxDuration = -1;
    for (const childId of span.children) {
      const child = trace.spans.get(childId);
      if (child && (child.durationMs ?? 0) > maxDuration) {
        maxDuration = child.durationMs ?? 0;
        slowestChild = child;
      }
    }
    if (slowestChild) {
      this.buildCriticalPath(slowestChild, trace, path);
    }
  }
}

// ─── CorrelationManager (facade) ────────────────────────────────────

export class CorrelationManager {
  readonly traceStore: TraceStore;
  readonly correlationEngine: CorrelationEngine;
  readonly anomalyDetector: CorrelationAnomalyDetector;
  readonly timelineGenerator: TimelineGenerator;

  constructor(options?: {
    slowChainThresholdMs?: number;
    fanOutThreshold?: number;
    retryStormThreshold?: number;
  }) {
    this.traceStore = new TraceStore();
    this.correlationEngine = new CorrelationEngine();
    this.anomalyDetector = new CorrelationAnomalyDetector(options);
    this.timelineGenerator = new TimelineGenerator();
  }

  /* ── trace lifecycle ──────────────────────────────────────────── */

  startTrace(connectorId: string, operationName: string): string {
    return this.traceStore.createTrace(connectorId, operationName);
  }

  startSpan(
    traceId: string,
    connectorId: string,
    operationName: string,
    parentSpanId: string | null = null,
  ): SpanBuilder {
    return new SpanBuilder(
      traceId,
      connectorId,
      operationName,
      parentSpanId,
      this.traceStore,
    );
  }

  /* ── link management ──────────────────────────────────────────── */

  addLink(
    sourceSpanId: string,
    sourceTraceId: string,
    sourceConnectorId: string,
    targetSpanId: string,
    targetTraceId: string,
    targetConnectorId: string,
    linkType: CorrelationLink['linkType'],
    strength: number = 1,
    metadata: Record<string, string> = {},
  ): CorrelationLink {
    return this.correlationEngine.addLink(
      sourceSpanId, sourceTraceId, sourceConnectorId,
      targetSpanId, targetTraceId, targetConnectorId,
      linkType, strength, metadata,
    );
  }

  /* ── analysis ─────────────────────────────────────────────────── */

  analyzeTrace(traceId: string): CorrelationSummary | null {
    const trace = this.traceStore.getTrace(traceId);
    if (!trace) return null;

    const links = this.correlationEngine.getAllLinks().filter(
      (l) => l.sourceTraceId === traceId || l.targetTraceId === traceId,
    );
    const anomalies = this.anomalyDetector.analyzeTrace(trace, links);
    return this.timelineGenerator.buildSummary(trace, links, anomalies);
  }

  getTracesForConnector(connectorId: string, limit?: number): Trace[] {
    return this.traceStore.getTracesForConnector(connectorId, limit);
  }

  getInteractionGraph(): Map<string, Set<string>> {
    return this.correlationEngine.buildInteractionGraph();
  }

  /* ── cleanup ──────────────────────────────────────────────────── */

  clear(): void {
    this.traceStore.clear();
    this.correlationEngine.clear();
  }

  destroy(): void {
    this.traceStore.destroy();
    this.correlationEngine.clear();
  }
}

// ─── Singleton ──────────────────────────────────────────────────────

export const correlationManager = new CorrelationManager();
