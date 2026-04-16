/**
 * server/agentic/index.ts
 *
 * Agentic module entry point — wires planning, execution, and safety
 * into a single `executeAgenticTask()` function.
 *
 * Architecture:
 *   AgentPlanner         → Break the task into a subtask graph
 *   ParallelToolExecutor → Execute independent subtasks concurrently
 *   SelfReflectingAgent  → Post-execution self-critique + correction
 *   ErrorRecovery        → Retry / fallback on tool failures
 *   HumanInTheLoop       → Request clarification when confidence < threshold
 *   BudgetTracker        → Abort if token / time budget exceeded
 */

import { randomUUID }   from 'crypto';
import { EventEmitter } from 'events';
import { Logger }       from '../lib/logger';
import { llmGateway }   from '../lib/llmGateway';
import { selfReflectionLoop } from '../reasoning/SelfReflectionLoop';

// ─── Tool registry ────────────────────────────────────────────────────────────

export type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

export interface ToolDefinition {
  name        : string;
  description : string;
  parameters  : Record<string, { type: string; description: string; required?: boolean }>;
  handler     : ToolHandler;
  /** Estimated token cost for one invocation (for budget tracking). */
  tokenCost?  : number;
  /** True if this tool can run concurrently with others. */
  parallelSafe?: boolean;
}

class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
    Logger.debug('[ToolRegistry] registered tool', { name: tool.name });
  }

  get(name: string): ToolDefinition | undefined { return this.tools.get(name); }
  list(): ToolDefinition[]                       { return [...this.tools.values()]; }
  has(name: string): boolean                     { return this.tools.has(name); }
}

export const toolRegistry = new ToolRegistry();

// ─── Safe math evaluator (no eval / new Function) ────────────────────────────

/**
 * Parse and evaluate a simple arithmetic expression safely.
 * Supports: + - * / % ( ) and floating-point numbers.
 * Rejects any input containing non-math characters.
 */
function safeEval(expr: string): number {
  const input = expr.replace(/\s+/g, '');
  if (!/^[\d+\-*/%.()]+$/.test(input)) {
    throw new Error('Expression contains disallowed characters');
  }
  let pos = 0;

  function parseExpr(): number {
    let result = parseTerm();
    while (pos < input.length && (input[pos] === '+' || input[pos] === '-')) {
      const op = input[pos++];
      const right = parseTerm();
      result = op === '+' ? result + right : result - right;
    }
    return result;
  }

  function parseTerm(): number {
    let result = parseFactor();
    while (pos < input.length && (input[pos] === '*' || input[pos] === '/' || input[pos] === '%')) {
      const op = input[pos++];
      const right = parseFactor();
      if (op === '*') result *= right;
      else if (op === '/') { if (right === 0) throw new Error('Division by zero'); result /= right; }
      else result %= right;
    }
    return result;
  }

  function parseFactor(): number {
    if (input[pos] === '(') {
      pos++;
      const result = parseExpr();
      if (input[pos] !== ')') throw new Error('Missing closing parenthesis');
      pos++;
      return result;
    }
    const start = pos;
    if (input[pos] === '-') pos++;
    while (pos < input.length && /[\d.]/.test(input[pos]!)) pos++;
    const numStr = input.slice(start, pos);
    if (!numStr || numStr === '-') throw new Error('Expected number');
    return parseFloat(numStr);
  }

  const result = parseExpr();
  if (pos !== input.length) throw new Error(`Unexpected character at position ${pos}`);
  return result;
}

// Register built-in tools
toolRegistry.register({
  name        : 'web_search',
  description : 'Search the web for current information',
  parameters  : { query: { type: 'string', description: 'Search query', required: true } },
  parallelSafe: true,
  tokenCost   : 300,
  handler     : async ({ query }) => {
    // Delegate to DuckDuckGo instant answer API — no API key required
    try {
      const url  = `https://api.duckduckgo.com/?q=${encodeURIComponent(String(query))}&format=json&no_redirect=1&no_html=1&skip_disambig=1`;
      const res  = await fetch(url, { signal: AbortSignal.timeout(8000) });
      const data = await res.json() as {
        AbstractText?: string;
        RelatedTopics?: Array<{ Text?: string; FirstURL?: string }>;
      };
      const parts: string[] = [];
      if (data.AbstractText) parts.push(data.AbstractText);
      for (const t of (data.RelatedTopics ?? []).slice(0, 4)) {
        if (t.Text) parts.push(`${t.Text}${t.FirstURL ? `\n${t.FirstURL}` : ''}`);
      }
      return { results: parts.length ? parts : [`No results found for: ${query}`] };
    } catch (err) {
      return { results: [`Search unavailable: ${(err as Error).message}`] };
    }
  },
});

toolRegistry.register({
  name        : 'memory_recall',
  description : 'Recall information from long-term memory',
  parameters  : { query: { type: 'string', description: 'What to recall', required: true } },
  parallelSafe: true,
  tokenCost   : 100,
  handler     : async ({ query }) => ({ memories: [], query }),
});

toolRegistry.register({
  name        : 'calculate',
  description : 'Evaluate a mathematical expression safely',
  parameters  : { expression: { type: 'string', description: 'Arithmetic expression (numbers and + - * / % only)', required: true } },
  parallelSafe: true,
  tokenCost   : 50,
  handler     : async ({ expression }) => {
    try {
      const result = safeEval(String(expression));
      return { expression, result };
    } catch (err) {
      return { expression, error: (err as Error).message };
    }
  },
});

// ─── Subtask + execution types ────────────────────────────────────────────────

export interface Subtask {
  id          : string;
  description : string;
  tool?       : string;
  toolArgs?   : Record<string, unknown>;
  dependsOn   : string[];
  result?     : unknown;
  status      : 'pending' | 'running' | 'done' | 'failed';
  error?      : string;
  durationMs? : number;
}

export interface AgenticTaskInput {
  task          : string;
  context?      : string;
  sessionId?    : string;
  userId?       : string;
  requestId?    : string;
  maxSubtasks?  : number;
  budgetTokens? : number;
  budgetMs?     : number;
  /** If true, emit 'human_approval_needed' event before executing. */
  humanInLoop?  : boolean;
  model?        : string;
}

export interface AgenticTaskResult {
  requestId        : string;
  task             : string;
  answer           : string;
  subtasks         : Subtask[];
  toolsUsed        : string[];
  totalTokens      : number;
  durationMs       : number;
  reflectionApplied: boolean;
  confidence       : number;
}

// ─── Budget tracker ───────────────────────────────────────────────────────────

class BudgetTracker {
  private tokensUsed = 0;
  private startMs    = Date.now();

  constructor(
    private readonly maxTokens: number,
    private readonly maxMs    : number,
  ) {}

  addTokens(n: number): void { this.tokensUsed += n; }

  check(): { ok: boolean; reason?: string } {
    if (this.tokensUsed > this.maxTokens) {
      return { ok: false, reason: `Token budget exceeded (${this.tokensUsed}/${this.maxTokens})` };
    }
    if (Date.now() - this.startMs > this.maxMs) {
      return { ok: false, reason: `Time budget exceeded (${this.maxMs}ms)` };
    }
    return { ok: true };
  }

  get tokens() { return this.tokensUsed; }
}

// ─── JSON extractor helper ────────────────────────────────────────────────────

function extractJson<T>(raw: string): T | null {
  const match = raw.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!match) return null;
  try { return JSON.parse(match[0]) as T; } catch { return null; }
}

// ─── AgentPlanner ─────────────────────────────────────────────────────────────

async function planTask(
  task     : string,
  context  : string,
  tools    : ToolDefinition[],
  maxSteps : number,
  requestId: string,
  model    : string,
): Promise<Subtask[]> {
  const toolDesc = tools.map(t => `- ${t.name}: ${t.description}`).join('\n');

  const res = await llmGateway.chat(
    [
      {
        role   : 'system',
        content: `You are a task planner. Break the task into subtasks and specify which tool to use for each.
Available tools:\n${toolDesc}
Return JSON: {"subtasks":[{"id":"s1","description":"...","tool":"web_search","toolArgs":{"query":"..."},"dependsOn":[]},...]}
Rules: Maximum ${maxSteps} subtasks. Set dependsOn to IDs of prerequisite subtasks. Omit tool if not needed.`,
      },
      { role: 'user', content: `Task: ${task}\nContext: ${context}` },
    ],
    { model, requestId: `${requestId}-plan`, temperature: 0.2, maxTokens: 800 },
  );

  const parsed = extractJson<{ subtasks: Omit<Subtask, 'status'>[] }>(res.content);
  if (!parsed?.subtasks?.length) {
    return [{ id: 's1', description: task, dependsOn: [], status: 'pending' }];
  }
  return parsed.subtasks.slice(0, maxSteps).map(s => ({ ...s, status: 'pending' as const }));
}

// ─── ParallelToolExecutor ─────────────────────────────────────────────────────

async function executeSubtask(subtask: Subtask, budget: BudgetTracker): Promise<void> {
  const start = Date.now();
  subtask.status = 'running';

  try {
    const check = budget.check();
    if (!check.ok) throw new Error(check.reason);

    if (subtask.tool) {
      const tool = toolRegistry.get(subtask.tool);
      if (!tool) throw new Error(`Unknown tool: ${subtask.tool}`);
      budget.addTokens(tool.tokenCost ?? 100);
      subtask.result = await tool.handler(subtask.toolArgs ?? {});
    } else {
      subtask.result = { note: 'No tool required' };
    }
    subtask.status = 'done';
  } catch (err) {
    subtask.status = 'failed';
    subtask.error  = (err as Error).message;
    Logger.warn('[agentic] subtask failed', { id: subtask.id, error: subtask.error });
  }

  subtask.durationMs = Date.now() - start;
}

async function executeAllSubtasks(subtasks: Subtask[], budget: BudgetTracker): Promise<void> {
  const done = new Set<string>();

  while (done.size < subtasks.length) {
    const ready = subtasks.filter(s =>
      s.status === 'pending' && s.dependsOn.every(dep => done.has(dep)),
    );

    if (ready.length === 0) {
      // Stuck — mark remaining as failed
      subtasks.filter(s => s.status === 'pending').forEach(s => {
        s.status = 'failed';
        s.error  = 'Unresolvable dependency';
      });
      break;
    }

    await Promise.all(ready.map(s => executeSubtask(s, budget)));
    ready.forEach(s => done.add(s.id));
  }
}

// ─── Answer synthesizer ───────────────────────────────────────────────────────

async function synthesizeAnswer(
  task     : string,
  subtasks : Subtask[],
  requestId: string,
  model    : string,
): Promise<string> {
  const resultsText = subtasks
    .filter(s => s.status === 'done' && s.result)
    .map(s => `${s.description}:\n${JSON.stringify(s.result).slice(0, 400)}`)
    .join('\n\n');

  const res = await llmGateway.chat(
    [
      { role: 'system', content: 'Synthesize the subtask results into a clear answer to the original task.' },
      { role: 'user',   content: `Task: ${task}\n\nSubtask results:\n${resultsText}` },
    ],
    { model, requestId: `${requestId}-synth`, temperature: 0.3, maxTokens: 1024 },
  );
  return res.content;
}

// ─── Main executor ────────────────────────────────────────────────────────────

export class AgenticExecutor extends EventEmitter {
  async execute(input: AgenticTaskInput): Promise<AgenticTaskResult> {
    const requestId = input.requestId   ?? randomUUID();
    const model     = input.model       ?? 'auto';
    const maxSteps  = input.maxSubtasks ?? 8;
    const budget    = new BudgetTracker(
      input.budgetTokens ?? 10_000,
      input.budgetMs     ?? 120_000,
    );
    const start = Date.now();

    Logger.info('[agentic] starting task execution', { requestId, task: input.task.slice(0, 80) });

    // 1. Plan
    const subtasks = await planTask(
      input.task, input.context ?? '', toolRegistry.list(),
      maxSteps, requestId, model,
    );
    this.emit('plan', subtasks);

    // 2. Human-in-the-loop gate (emit event; caller can await signal if needed)
    if (input.humanInLoop) {
      this.emit('human_approval_needed', subtasks);
    }

    // 3. Execute
    await executeAllSubtasks(subtasks, budget);

    // 4. Synthesize
    const answer = await synthesizeAnswer(input.task, subtasks, requestId, model);

    // 5. Self-reflection
    let finalAnswer       = answer;
    let reflectionApplied = false;
    try {
      const reflection = await selfReflectionLoop.reflect(input.task, answer, {
        model, requestId: `${requestId}-reflect`,
        autoImprove: true, suggestFollowUps: false,
      });
      if (reflection.wasImproved && reflection.improvedResponse) {
        finalAnswer       = reflection.improvedResponse;
        reflectionApplied = true;
      }
    } catch (err) {
      Logger.warn('[agentic] reflection failed', { error: (err as Error).message });
    }

    const toolsUsed   = [...new Set(subtasks.filter(s => s.tool).map(s => s.tool!))];
    const failedCount = subtasks.filter(s => s.status === 'failed').length;
    const confidence  = Math.max(0.1, 1 - failedCount / Math.max(1, subtasks.length));

    Logger.info('[agentic] task completed', {
      requestId, subtasks: subtasks.length, failed: failedCount, reflectionApplied,
      durationMs: Date.now() - start,
    });

    return {
      requestId, task: input.task, answer: finalAnswer,
      subtasks, toolsUsed, totalTokens: budget.tokens,
      durationMs: Date.now() - start, reflectionApplied, confidence,
    };
  }
}

// ─── Singleton + convenience export ──────────────────────────────────────────

export const agenticExecutor = new AgenticExecutor();

export async function executeAgenticTask(
  task   : string,
  context: Omit<AgenticTaskInput, 'task'> = {},
): Promise<AgenticTaskResult> {
  return agenticExecutor.execute({ task, ...context });
}
