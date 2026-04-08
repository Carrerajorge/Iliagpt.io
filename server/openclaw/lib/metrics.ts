import { Logger } from "../../lib/logger";

interface ToolMetric {
  toolId: string;
  invocations: number;
  successes: number;
  failures: number;
  totalDurationMs: number;
  lastUsed: number;
}

class OpenClawMetrics {
  private toolMetrics = new Map<string, ToolMetric>();
  private subagentMetrics = { spawned: 0, completed: 0, failed: 0, cancelled: 0 };
  private errorCount = 0;

  recordToolCall(toolId: string, durationMs: number, success: boolean): void {
    let metric = this.toolMetrics.get(toolId);
    if (!metric) {
      metric = {
        toolId,
        invocations: 0,
        successes: 0,
        failures: 0,
        totalDurationMs: 0,
        lastUsed: 0,
      };
      this.toolMetrics.set(toolId, metric);
    }
    metric.invocations++;
    if (success) {
      metric.successes++;
    } else {
      metric.failures++;
    }
    metric.totalDurationMs += durationMs;
    metric.lastUsed = Date.now();
  }

  recordSubagentEvent(event: "spawn" | "complete" | "fail" | "cancel"): void {
    switch (event) {
      case "spawn":
        this.subagentMetrics.spawned++;
        break;
      case "complete":
        this.subagentMetrics.completed++;
        break;
      case "fail":
        this.subagentMetrics.failed++;
        break;
      case "cancel":
        this.subagentMetrics.cancelled++;
        break;
    }
  }

  recordError(): void {
    this.errorCount++;
  }

  getToolStats(): ToolMetric[] {
    return Array.from(this.toolMetrics.values());
  }

  getSubagentStats(): typeof this.subagentMetrics {
    return { ...this.subagentMetrics };
  }

  getSummary(): {
    tools: ToolMetric[];
    subagents: typeof this.subagentMetrics;
    errors: number;
  } {
    return {
      tools: this.getToolStats(),
      subagents: this.getSubagentStats(),
      errors: this.errorCount,
    };
  }

  /** Prometheus text exposition format */
  toPrometheus(): string {
    const lines: string[] = [];

    lines.push("# HELP openclaw_tool_invocations_total Total tool invocations");
    lines.push("# TYPE openclaw_tool_invocations_total counter");
    for (const m of this.toolMetrics.values()) {
      lines.push(
        `openclaw_tool_invocations_total{tool="${m.toolId}"} ${m.invocations}`,
      );
    }

    lines.push("# HELP openclaw_tool_successes_total Successful tool invocations");
    lines.push("# TYPE openclaw_tool_successes_total counter");
    for (const m of this.toolMetrics.values()) {
      lines.push(
        `openclaw_tool_successes_total{tool="${m.toolId}"} ${m.successes}`,
      );
    }

    lines.push("# HELP openclaw_tool_failures_total Failed tool invocations");
    lines.push("# TYPE openclaw_tool_failures_total counter");
    for (const m of this.toolMetrics.values()) {
      lines.push(
        `openclaw_tool_failures_total{tool="${m.toolId}"} ${m.failures}`,
      );
    }

    lines.push(
      "# HELP openclaw_tool_duration_ms_total Total duration of tool calls in milliseconds",
    );
    lines.push("# TYPE openclaw_tool_duration_ms_total counter");
    for (const m of this.toolMetrics.values()) {
      lines.push(
        `openclaw_tool_duration_ms_total{tool="${m.toolId}"} ${m.totalDurationMs.toFixed(1)}`,
      );
    }

    lines.push("# HELP openclaw_subagent_events_total Subagent lifecycle events");
    lines.push("# TYPE openclaw_subagent_events_total counter");
    lines.push(
      `openclaw_subagent_events_total{event="spawn"} ${this.subagentMetrics.spawned}`,
    );
    lines.push(
      `openclaw_subagent_events_total{event="complete"} ${this.subagentMetrics.completed}`,
    );
    lines.push(
      `openclaw_subagent_events_total{event="fail"} ${this.subagentMetrics.failed}`,
    );
    lines.push(
      `openclaw_subagent_events_total{event="cancel"} ${this.subagentMetrics.cancelled}`,
    );

    lines.push("# HELP openclaw_errors_total Total error count");
    lines.push("# TYPE openclaw_errors_total counter");
    lines.push(`openclaw_errors_total ${this.errorCount}`);

    return lines.join("\n");
  }
}

export const openclawMetrics = new OpenClawMetrics();
