import type { Response } from "express";

export interface ToolExecutionResult {
  toolName: string;
  args: Record<string, any>;
  result: any;
  artifact?: { type: string; url: string; name: string };
  durationMs: number;
  error?: string;
  errorCategory?: "retryable" | "fatal" | "auth" | "timeout" | "rate_limit" | "input_error";
  retryable: boolean;
  truncated: boolean;
}

export interface ToolHealthEntry {
  successes: number;
  failures: number;
  totalDurationMs: number;
  lastError?: string;
  lastUsed: number;
  avgDurationMs: number;
  consecutiveFailures: number;
}

const ADAPTIVE_TIMEOUTS: Record<string, number> = {
  bash: 60000,
  run_code: 60000,
  web_search: 15000,
  web_fetch: 20000,
  fetch_url: 20000,
  browse_and_act: 180000,
  read_file: 10000,
  write_file: 10000,
  edit_file: 10000,
  list_files: 10000,
  grep_search: 15000,
  analyze_data: 30000,
  generate_chart: 30000,
  create_presentation: 45000,
  create_document: 45000,
  create_spreadsheet: 30000,
  process_list: 10000,
  port_check: 10000,
  memory_search: 10000,
  openclaw_rag_search: 15000,
  rag_index_document: 30000,
};

const DEFAULT_TIMEOUT = 30000;

export class ToolHealthTracker {
  private health: Map<string, ToolHealthEntry> = new Map();

  record(toolName: string, durationMs: number, success: boolean, error?: string): void {
    const entry = this.health.get(toolName) || {
      successes: 0,
      failures: 0,
      totalDurationMs: 0,
      lastUsed: 0,
      avgDurationMs: 0,
      consecutiveFailures: 0,
    };

    if (success) {
      entry.successes++;
      entry.consecutiveFailures = 0;
    } else {
      entry.failures++;
      entry.consecutiveFailures++;
      entry.lastError = error;
    }

    entry.totalDurationMs += durationMs;
    entry.lastUsed = Date.now();
    const totalCalls = entry.successes + entry.failures;
    entry.avgDurationMs = Math.round(entry.totalDurationMs / totalCalls);

    this.health.set(toolName, entry);
  }

  getHealth(toolName: string): ToolHealthEntry | undefined {
    return this.health.get(toolName);
  }

  isDegraded(toolName: string): boolean {
    const entry = this.health.get(toolName);
    if (!entry) return false;
    const total = entry.successes + entry.failures;
    if (total < 3) return false;
    const failRate = entry.failures / total;
    return failRate > 0.5 || entry.consecutiveFailures >= 3;
  }

  getAdaptiveTimeout(toolName: string): number {
    const baseTimeout = ADAPTIVE_TIMEOUTS[toolName] || DEFAULT_TIMEOUT;
    const entry = this.health.get(toolName);
    if (!entry || entry.successes === 0) return baseTimeout;
    const p95Duration = entry.avgDurationMs * 2.5;
    return Math.max(baseTimeout, Math.min(p95Duration, baseTimeout * 3));
  }

  getSummary(): Record<string, { success_rate: string; avg_ms: number; degraded: boolean }> {
    const summary: Record<string, { success_rate: string; avg_ms: number; degraded: boolean }> = {};
    for (const [name, entry] of this.health) {
      const total = entry.successes + entry.failures;
      summary[name] = {
        success_rate: `${Math.round((entry.successes / total) * 100)}%`,
        avg_ms: entry.avgDurationMs,
        degraded: this.isDegraded(name),
      };
    }
    return summary;
  }
}

export function categorizeError(error: any): { category: ToolExecutionResult["errorCategory"]; retryable: boolean; message: string } {
  const msg = String(error?.message || error || "").toLowerCase();

  if (msg.includes("timeout") || msg.includes("timed out") || msg.includes("etimedout")) {
    return { category: "timeout", retryable: true, message: `Timeout: ${msg.slice(0, 200)}` };
  }
  if (msg.includes("rate limit") || msg.includes("429") || msg.includes("too many requests")) {
    return { category: "rate_limit", retryable: true, message: `Rate limited: ${msg.slice(0, 200)}` };
  }
  if (msg.includes("unauthorized") || msg.includes("403") || msg.includes("permission denied") || msg.includes("access denied")) {
    return { category: "auth", retryable: false, message: `Auth error: ${msg.slice(0, 200)}` };
  }
  if (msg.includes("not found") || msg.includes("no such file") || msg.includes("enoent")) {
    return { category: "input_error", retryable: false, message: `Not found: ${msg.slice(0, 200)}` };
  }
  if (msg.includes("invalid") || msg.includes("bad request") || msg.includes("validation")) {
    return { category: "input_error", retryable: false, message: `Invalid input: ${msg.slice(0, 200)}` };
  }
  if (msg.includes("econnreset") || msg.includes("econnrefused") || msg.includes("network") || msg.includes("502") || msg.includes("503")) {
    return { category: "retryable", retryable: true, message: `Network error: ${msg.slice(0, 200)}` };
  }

  return { category: "fatal", retryable: false, message: msg.slice(0, 200) };
}

export function smartTruncate(result: any, maxLength = 2000): { text: string; truncated: boolean } {
  if (result === null || result === undefined) {
    return { text: "null", truncated: false };
  }

  const raw = typeof result === "string" ? result : JSON.stringify(result);

  if (raw.length <= maxLength) {
    return { text: raw, truncated: false };
  }

  if (typeof result === "object" && result !== null) {
    if (Array.isArray(result)) {
      const itemCount = result.length;
      const preview = result.slice(0, 5);
      const previewStr = JSON.stringify(preview);
      if (previewStr.length <= maxLength - 100) {
        return {
          text: JSON.stringify({
            _truncated: true,
            _totalItems: itemCount,
            _showing: Math.min(5, itemCount),
            items: preview,
          }),
          truncated: true,
        };
      }
    }

    if (result.error) {
      return { text: JSON.stringify({ error: String(result.error).slice(0, maxLength - 50) }), truncated: false };
    }

    const keys = Object.keys(result);
    const preserved: Record<string, any> = {};
    let currentLength = 0;
    const priorityKeys = ["success", "status", "error", "message", "result", "output", "data", "count", "total"];

    for (const key of priorityKeys) {
      if (key in result) {
        const val = typeof result[key] === "string" ? result[key].slice(0, 500) : result[key];
        const entry = JSON.stringify({ [key]: val });
        if (currentLength + entry.length < maxLength - 100) {
          preserved[key] = val;
          currentLength += entry.length;
        }
      }
    }

    for (const key of keys) {
      if (key in preserved) continue;
      const val = typeof result[key] === "string" ? result[key].slice(0, 300) : result[key];
      const entry = JSON.stringify({ [key]: val });
      if (currentLength + entry.length < maxLength - 100) {
        preserved[key] = val;
        currentLength += entry.length;
      }
    }

    preserved._truncated = true;
    preserved._originalKeys = keys.length;
    return { text: JSON.stringify(preserved), truncated: true };
  }

  const head = raw.slice(0, Math.floor(maxLength * 0.7));
  const tail = raw.slice(-Math.floor(maxLength * 0.2));
  return {
    text: `${head}\n... [truncated ${raw.length - maxLength} chars] ...\n${tail}`,
    truncated: true,
  };
}

export function buildToolProgressMessage(toolName: string, args: Record<string, any>): string {
  switch (toolName) {
    case "bash":
      return `Ejecutando: \`${String(args.command || "").slice(0, 80)}\``;
    case "web_search":
      return `Buscando: "${String(args.query || "").slice(0, 60)}"`;
    case "fetch_url":
    case "web_fetch":
      return `Obteniendo: ${String(args.url || "").slice(0, 60)}`;
    case "read_file":
      return `Leyendo: ${String(args.file_path || args.filepath || "").slice(0, 60)}`;
    case "write_file":
      return `Escribiendo: ${String(args.file_path || args.filepath || "").slice(0, 60)}`;
    case "edit_file":
      return `Editando: ${String(args.file_path || args.filepath || "").slice(0, 60)}`;
    case "list_files":
      return `Listando: ${String(args.directory || ".").slice(0, 60)}`;
    case "run_code":
      return `Ejecutando código ${args.language || ""}`;
    case "grep_search":
      return `Buscando patrón: "${String(args.pattern || "").slice(0, 50)}"`;
    case "browse_and_act":
      return `Navegando: ${String(args.url || "").slice(0, 50)}`;
    case "analyze_data":
      return `Analizando datos...`;
    case "generate_chart":
      return `Generando gráfico ${args.chartType || ""}`;
    case "process_list":
      return `Listando procesos${args.filter ? ` (${args.filter})` : ""}`;
    case "port_check":
      return `Verificando puerto${args.port ? ` ${args.port}` : "s"}`;
    default:
      return `Ejecutando ${toolName}...`;
  }
}

export function detectToolDependencies(
  toolCalls: Array<{ name: string; args: Record<string, any> }>
): { parallel: number[][]; reason: string } {
  const n = toolCalls.length;
  if (n <= 1) return { parallel: [[0]], reason: "single_tool" };

  const deps = new Map<number, Set<number>>();
  for (let i = 0; i < n; i++) deps.set(i, new Set());

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = toolCalls[i];
      const b = toolCalls[j];

      const aWritesFile = (a.name === "write_file" || a.name === "edit_file") && (a.args.file_path || a.args.filepath);
      const bReadsFile = (b.name === "read_file") && (b.args.file_path || b.args.filepath);
      const bWritesFile = (b.name === "write_file" || b.name === "edit_file") && (b.args.file_path || b.args.filepath);

      if (aWritesFile && bReadsFile && (a.args.file_path || a.args.filepath) === (b.args.file_path || b.args.filepath)) {
        deps.get(j)!.add(i);
      }
      if (aWritesFile && bWritesFile && (a.args.file_path || a.args.filepath) === (b.args.file_path || b.args.filepath)) {
        deps.get(j)!.add(i);
      }
    }
  }

  const waves: number[][] = [];
  const completed = new Set<number>();

  while (completed.size < n) {
    const wave: number[] = [];
    for (let i = 0; i < n; i++) {
      if (completed.has(i)) continue;
      const allDepsMet = [...deps.get(i)!].every(d => completed.has(d));
      if (allDepsMet) wave.push(i);
    }
    if (wave.length === 0) {
      for (let i = 0; i < n; i++) {
        if (!completed.has(i)) wave.push(i);
      }
    }
    waves.push(wave);
    wave.forEach(i => completed.add(i));
  }

  return {
    parallel: waves,
    reason: waves.length === 1 ? "all_independent" : `${waves.length}_dependency_waves`,
  };
}

export function buildContextPruningStrategy(
  messages: Array<{ role: string; content: string; tool_calls?: any; tool_call_id?: string }>,
  maxTokenEstimate: number = 100000
): { pruned: typeof messages; removed: number } {
  const estimateTokens = (text: string) => Math.ceil(text.length / 4);

  let totalTokens = 0;
  for (const m of messages) {
    totalTokens += estimateTokens(typeof m.content === "string" ? m.content : JSON.stringify(m.content || ""));
  }

  if (totalTokens <= maxTokenEstimate) {
    return { pruned: messages, removed: 0 };
  }

  const pruned = [...messages];
  let removed = 0;

  for (let i = pruned.length - 1; i >= 0; i--) {
    if (totalTokens <= maxTokenEstimate * 0.8) break;

    const msg = pruned[i] as any;
    if (msg.role === "tool" && typeof msg.content === "string" && msg.content.length > 1000) {
      const original = msg.content;
      const summarized = original.slice(0, 500) + `\n... [pruned ${original.length - 500} chars for context window]`;
      pruned[i] = { ...msg, content: summarized };
      totalTokens -= estimateTokens(original) - estimateTokens(summarized);
      removed++;
    }
  }

  if (totalTokens > maxTokenEstimate) {
    const systemMsgs = pruned.filter(m => m.role === "system");
    const lastN = 10;
    const recentMsgs = pruned.filter(m => m.role !== "system").slice(-lastN);
    const finalPruned = [...systemMsgs, ...recentMsgs];
    removed += pruned.length - finalPruned.length;
    return { pruned: finalPruned, removed };
  }

  return { pruned, removed };
}
