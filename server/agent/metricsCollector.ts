export interface StepMetrics {
  toolName: string;
  latencyMs: number;
  success: boolean;
  errorCode?: string;
  timestamp: Date;
}

export interface ToolStats {
  latencyP50: number;
  latencyP95: number;
  latencyP99: number;
  latencyAvg: number;
  successRate: number;
  errorRate: number;
  totalCalls: number;
}

export interface ExportedMetrics {
  timestamp: string;
  tools: Record<string, ToolStats>;
  aggregate: {
    totalCalls: number;
    overallSuccessRate: number;
    overallErrorRate: number;
    overallLatencyP50: number;
    overallLatencyP95: number;
    overallLatencyP99: number;
    overallLatencyAvg: number;
  };
}

export interface PhaseMetrics {
  phase: string;
  durationMs: number;
  toolCalls: number;
  success: boolean;
  timestamp: Date;
}

export interface PhaseStats {
  phase: string;
  latencyP50: number;
  latencyP95: number;
  latencyP99: number;
  latencyAvg: number;
  successRate: number;
  totalRuns: number;
}

export interface EventTrace {
  correlationId: string;
  runId: string;
  events: TracedEvent[];
}

export interface TracedEvent {
  timestamp: string;
  type: "step_start" | "step_end" | "tool_call" | "tool_result" | "error" | "state_change";
  stepId?: string;
  toolName?: string;
  durationMs?: number;
  metadata?: Record<string, any>;
}

export class MetricsCollector {
  private metrics: Map<string, StepMetrics[]> = new Map();
  private readonly maxEntriesPerTool: number;
  private readonly retentionMs: number;

  constructor(maxEntriesPerTool: number = 1000, retentionMs: number = 3600000) {
    this.maxEntriesPerTool = maxEntriesPerTool;
    this.retentionMs = retentionMs;
  }

  record(metrics: StepMetrics): void {
    const existing = this.metrics.get(metrics.toolName) || [];
    existing.push(metrics);
    
    if (existing.length > this.maxEntriesPerTool) {
      existing.shift();
    }
    
    this.metrics.set(metrics.toolName, existing);
  }

  pruneOldEntries(): number {
    const cutoff = new Date(Date.now() - this.retentionMs);
    let pruned = 0;
    
    for (const [toolName, entries] of this.metrics.entries()) {
      const originalLength = entries.length;
      const filtered = entries.filter(m => m.timestamp >= cutoff);
      if (filtered.length !== originalLength) {
        pruned += originalLength - filtered.length;
        this.metrics.set(toolName, filtered);
      }
    }
    
    return pruned;
  }

  private getAllMetrics(): StepMetrics[] {
    const allMetrics: StepMetrics[] = [];
    Array.from(this.metrics.values()).forEach(toolMetrics => {
      allMetrics.push(...toolMetrics);
    });
    return allMetrics;
  }

  private getPercentile(latencies: number[], percentile: number): number {
    if (latencies.length === 0) return 0;
    const sorted = [...latencies].sort((a, b) => a - b);
    const index = Math.floor(sorted.length * percentile);
    return sorted[Math.min(index, sorted.length - 1)];
  }

  getLatencyP50(toolName?: string): number {
    const metricsToAnalyze = toolName 
      ? this.metrics.get(toolName) || []
      : this.getAllMetrics();
    return this.getPercentile(metricsToAnalyze.map(m => m.latencyMs), 0.50);
  }

  getLatencyP95(toolName?: string): number {
    const metricsToAnalyze = toolName 
      ? this.metrics.get(toolName) || []
      : this.getAllMetrics();
    return this.getPercentile(metricsToAnalyze.map(m => m.latencyMs), 0.95);
  }

  getLatencyP99(toolName?: string): number {
    const metricsToAnalyze = toolName 
      ? this.metrics.get(toolName) || []
      : this.getAllMetrics();
    return this.getPercentile(metricsToAnalyze.map(m => m.latencyMs), 0.99);
  }

  getLatencyAvg(toolName?: string): number {
    const metricsToAnalyze = toolName 
      ? this.metrics.get(toolName) || []
      : this.getAllMetrics();
    if (metricsToAnalyze.length === 0) return 0;
    const sum = metricsToAnalyze.reduce((acc, m) => acc + m.latencyMs, 0);
    return sum / metricsToAnalyze.length;
  }

  getSuccessRate(toolName?: string): number {
    const metricsToAnalyze = toolName 
      ? this.metrics.get(toolName) || []
      : this.getAllMetrics();
    
    if (metricsToAnalyze.length === 0) {
      return 0;
    }

    const successCount = metricsToAnalyze.filter(m => m.success).length;
    return (successCount / metricsToAnalyze.length) * 100;
  }

  getErrorRate(toolName?: string): number {
    const metricsToAnalyze = toolName 
      ? this.metrics.get(toolName) || []
      : this.getAllMetrics();
    
    if (metricsToAnalyze.length === 0) {
      return 0;
    }

    const errorCount = metricsToAnalyze.filter(m => !m.success).length;
    return (errorCount / metricsToAnalyze.length) * 100;
  }

  getToolStats(): Record<string, ToolStats> {
    const stats: Record<string, ToolStats> = {};

    Array.from(this.metrics.entries()).forEach(([toolName, toolMetrics]) => {
      if (toolMetrics.length === 0) return;

      const latencies = toolMetrics.map(m => m.latencyMs);
      const successCount = toolMetrics.filter(m => m.success).length;
      const errorCount = toolMetrics.filter(m => !m.success).length;
      const sum = latencies.reduce((acc, l) => acc + l, 0);

      stats[toolName] = {
        latencyP50: this.getPercentile(latencies, 0.50),
        latencyP95: this.getPercentile(latencies, 0.95),
        latencyP99: this.getPercentile(latencies, 0.99),
        latencyAvg: sum / latencies.length,
        successRate: (successCount / toolMetrics.length) * 100,
        errorRate: (errorCount / toolMetrics.length) * 100,
        totalCalls: toolMetrics.length,
      };
    });

    return stats;
  }

  exportMetrics(): ExportedMetrics {
    const allMetrics = this.getAllMetrics();
    const toolStats = this.getToolStats();

    return {
      timestamp: new Date().toISOString(),
      tools: toolStats,
      aggregate: {
        totalCalls: allMetrics.length,
        overallSuccessRate: this.getSuccessRate(),
        overallErrorRate: this.getErrorRate(),
        overallLatencyP50: this.getLatencyP50(),
        overallLatencyP95: this.getLatencyP95(),
        overallLatencyP99: this.getLatencyP99(),
        overallLatencyAvg: this.getLatencyAvg(),
      },
    };
  }

  clear(): void {
    this.metrics.clear();
  }
}

export const metricsCollector = new MetricsCollector();

export class PhaseMetricsCollector {
  private phaseMetrics: Map<string, PhaseMetrics[]> = new Map();
  private readonly maxEntriesPerPhase: number = 500;

  record(metrics: PhaseMetrics): void {
    const existing = this.phaseMetrics.get(metrics.phase) || [];
    existing.push(metrics);
    if (existing.length > this.maxEntriesPerPhase) {
      existing.shift();
    }
    this.phaseMetrics.set(metrics.phase, existing);
  }

  getPhaseStats(): Record<string, PhaseStats> {
    const stats: Record<string, PhaseStats> = {};

    Array.from(this.phaseMetrics.entries()).forEach(([phase, metrics]) => {
      if (metrics.length === 0) return;

      const latencies = metrics.map(m => m.durationMs);
      const sorted = [...latencies].sort((a, b) => a - b);
      const successCount = metrics.filter(m => m.success).length;
      const sum = latencies.reduce((acc, l) => acc + l, 0);

      const getPercentile = (arr: number[], p: number) => {
        if (arr.length === 0) return 0;
        const idx = Math.floor(arr.length * p);
        return arr[Math.min(idx, arr.length - 1)];
      };

      stats[phase] = {
        phase,
        latencyP50: getPercentile(sorted, 0.50),
        latencyP95: getPercentile(sorted, 0.95),
        latencyP99: getPercentile(sorted, 0.99),
        latencyAvg: sum / metrics.length,
        successRate: (successCount / metrics.length) * 100,
        totalRuns: metrics.length,
      };
    });

    return stats;
  }

  clear(): void {
    this.phaseMetrics.clear();
  }
}

export const phaseMetricsCollector = new PhaseMetricsCollector();

class EventTracer {
  private traces: Map<string, EventTrace> = new Map();

  startTrace(correlationId: string, runId: string): void {
    this.traces.set(correlationId, { correlationId, runId, events: [] });
  }

  addEvent(correlationId: string, event: Omit<TracedEvent, "timestamp">): void {
    const trace = this.traces.get(correlationId);
    if (trace) {
      trace.events.push({ ...event, timestamp: new Date().toISOString() });
    }
  }

  getTrace(correlationId: string): EventTrace | undefined {
    return this.traces.get(correlationId);
  }

  endTrace(correlationId: string): EventTrace | undefined {
    const trace = this.traces.get(correlationId);
    this.traces.delete(correlationId);
    return trace;
  }
}

export const eventTracer = new EventTracer();
