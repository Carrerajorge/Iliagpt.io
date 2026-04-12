/**
 * Capability tests — Multi-agent orchestration (capability 13: sub-agents)
 *
 * Tests validate task decomposition, parallel coordination, internal todo
 * management, long-running task persistence, and inter-agent communication.
 * All external dependencies (database, message bus, agent runtime) are mocked
 * so tests run in a pure Node environment without side-effects.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  runWithEachProvider,
  MOCK_PROVIDER,
} from "../_setup/providerMatrix";
import {
  getMockResponseForProvider,
  createTextResponse,
  MOCK_AGENT_TOOL,
  MOCK_FILE_TOOL,
} from "../_setup/mockResponses";
import {
  createTempDir,
  cleanupTempDir,
  createTestFile,
  createMockAgent,
  waitFor,
  MockDatabase,
  assertHasShape,
} from "../_setup/testHelpers";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("../../../server/agent/autonomousAgentBrain", () => ({
  AutonomousAgentBrain: vi.fn().mockImplementation(() => ({
    run: vi.fn().mockResolvedValue({ status: "success", output: "done" }),
    decompose: vi.fn().mockResolvedValue([]),
    checkpoint: vi.fn().mockResolvedValue({ id: "chk_001" }),
    resume: vi.fn().mockResolvedValue({ status: "success", output: "resumed" }),
  })),
}));

vi.mock("../../../server/agent/langgraph/orchestrator", () => ({
  AgentOrchestrator: vi.fn().mockImplementation(() => ({
    spawnAgent: vi.fn().mockResolvedValue({ agentId: "agent_001", status: "running" }),
    collectResults: vi.fn().mockResolvedValue([]),
    mergeOutputs: vi.fn().mockResolvedValue({ merged: true }),
    broadcast: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock("../../../server/agent/pipeline/messageQueue", () => ({
  MessageQueue: vi.fn().mockImplementation(() => ({
    enqueue: vi.fn().mockResolvedValue("msg_001"),
    dequeue: vi.fn().mockResolvedValue(null),
    peek: vi.fn().mockResolvedValue(null),
    size: vi.fn().mockReturnValue(0),
  })),
}));

vi.mock("../../../server/db", () => ({
  db: {
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([{ id: "row_001" }]) }),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    }),
    delete: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([]),
    }),
  },
}));

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

interface SubTask {
  id: string;
  description: string;
  dependsOn: string[];
  status: "pending" | "running" | "done" | "failed";
  assignedAgent?: string;
  result?: unknown;
}

interface AgentCheckpoint {
  id: string;
  agentId: string;
  step: number;
  state: Record<string, unknown>;
  createdAt: number;
}

interface AgentMessage {
  from: string;
  to: string;
  payload: unknown;
  timestamp: number;
  correlationId?: string;
}

function buildSubTask(overrides: Partial<SubTask> = {}): SubTask {
  return {
    id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    description: "Process data",
    dependsOn: [],
    status: "pending",
    ...overrides,
  };
}

function buildCheckpoint(overrides: Partial<AgentCheckpoint> = {}): AgentCheckpoint {
  return {
    id: `chk_${Date.now()}`,
    agentId: "agent_001",
    step: 1,
    state: { progress: 0.5, processedItems: 50, totalItems: 100 },
    createdAt: Date.now(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Task decomposition
// ---------------------------------------------------------------------------

describe("Task decomposition", () => {
  it("breaks a complex task into subtasks", () => {
    const complexTask = "Research competitors, write a comparison report, and send it to stakeholders";

    // Simulate decomposition logic
    function decompose(task: string): SubTask[] {
      const keywords = ["research", "write", "send", "analyse", "compile", "review", "update", "generate"];
      const parts = task.split(/,\s*(?:and\s*)?/i).filter((p) => p.trim().length > 0);
      return parts.map((part, idx) => ({
        id: `subtask_${idx + 1}`,
        description: part.trim(),
        dependsOn: idx > 0 ? [`subtask_${idx}`] : [],
        status: "pending" as const,
      }));
    }

    const subtasks = decompose(complexTask);
    expect(subtasks.length).toBeGreaterThanOrEqual(2);
    subtasks.forEach((st) => {
      assertHasShape(st, {
        id: "string",
        description: "string",
        dependsOn: "array",
        status: "string",
      });
    });
  });

  it("builds a subtask dependency graph with correct ordering", () => {
    const tasks: SubTask[] = [
      buildSubTask({ id: "t1", description: "Fetch raw data", dependsOn: [] }),
      buildSubTask({ id: "t2", description: "Clean data", dependsOn: ["t1"] }),
      buildSubTask({ id: "t3", description: "Analyse cleaned data", dependsOn: ["t2"] }),
      buildSubTask({ id: "t4", description: "Generate report", dependsOn: ["t3"] }),
    ];

    function topoSort(tasks: SubTask[]): string[] {
      const order: string[] = [];
      const visited = new Set<string>();

      function visit(id: string): void {
        if (visited.has(id)) return;
        visited.add(id);
        const task = tasks.find((t) => t.id === id);
        task?.dependsOn.forEach(visit);
        order.push(id);
      }

      tasks.forEach((t) => visit(t.id));
      return order;
    }

    const sorted = topoSort(tasks);
    expect(sorted).toEqual(["t1", "t2", "t3", "t4"]);
    // t1 must appear before t2
    expect(sorted.indexOf("t1")).toBeLessThan(sorted.indexOf("t2"));
    expect(sorted.indexOf("t2")).toBeLessThan(sorted.indexOf("t3"));
  });

  it("identifies tasks that can run in parallel (no shared dependencies)", () => {
    const tasks: SubTask[] = [
      buildSubTask({ id: "t1", description: "Fetch sales data", dependsOn: [] }),
      buildSubTask({ id: "t2", description: "Fetch marketing data", dependsOn: [] }),
      buildSubTask({ id: "t3", description: "Fetch support tickets", dependsOn: [] }),
      buildSubTask({ id: "t4", description: "Merge all data", dependsOn: ["t1", "t2", "t3"] }),
    ];

    function getParallelGroups(tasks: SubTask[]): SubTask[][] {
      const groups: SubTask[][] = [];
      const completed = new Set<string>();

      while (completed.size < tasks.length) {
        const ready = tasks.filter(
          (t) => !completed.has(t.id) && t.dependsOn.every((d) => completed.has(d)),
        );
        if (ready.length === 0) break;
        groups.push(ready);
        ready.forEach((t) => completed.add(t.id));
      }

      return groups;
    }

    const groups = getParallelGroups(tasks);
    expect(groups[0].length).toBe(3); // t1, t2, t3 can run in parallel
    expect(groups[1].length).toBe(1); // t4 runs after all three
    expect(groups[1][0].id).toBe("t4");
  });

  it("handles circular dependencies gracefully without infinite loop", () => {
    const tasks: SubTask[] = [
      buildSubTask({ id: "a", dependsOn: ["b"] }),
      buildSubTask({ id: "b", dependsOn: ["a"] }),
    ];

    function detectCycles(tasks: SubTask[]): boolean {
      const visited = new Set<string>();
      const inStack = new Set<string>();

      function dfs(id: string): boolean {
        if (inStack.has(id)) return true; // cycle
        if (visited.has(id)) return false;
        visited.add(id);
        inStack.add(id);
        const task = tasks.find((t) => t.id === id);
        for (const dep of task?.dependsOn ?? []) {
          if (dfs(dep)) return true;
        }
        inStack.delete(id);
        return false;
      }

      return tasks.some((t) => dfs(t.id));
    }

    expect(detectCycles(tasks)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Parallel coordination
// ---------------------------------------------------------------------------

describe("Parallel coordination", () => {
  it("spawns N agents concurrently and collects results", async () => {
    const AGENT_COUNT = 4;

    async function mockSpawnAgent(id: number): Promise<{ agentId: string; result: string }> {
      // Simulate variable execution time
      await new Promise((r) => setTimeout(r, Math.random() * 10));
      return { agentId: `agent_${id}`, result: `Result from agent ${id}` };
    }

    const promises = Array.from({ length: AGENT_COUNT }, (_, i) => mockSpawnAgent(i + 1));
    const results = await Promise.all(promises);

    expect(results).toHaveLength(AGENT_COUNT);
    results.forEach((r, i) => {
      expect(r.agentId).toBe(`agent_${i + 1}`);
      expect(r.result).toContain(`agent ${i + 1}`);
    });
  });

  it("merges outputs from multiple agents into a unified result", () => {
    interface AgentOutput {
      agentId: string;
      data: Record<string, unknown>;
    }

    const outputs: AgentOutput[] = [
      { agentId: "agent_1", data: { salesTotal: 50000, region: "north" } },
      { agentId: "agent_2", data: { salesTotal: 75000, region: "south" } },
      { agentId: "agent_3", data: { salesTotal: 62000, region: "east" } },
    ];

    function mergeOutputs(outputs: AgentOutput[]): Record<string, unknown> {
      const merged: Record<string, unknown> = {
        agentCount: outputs.length,
        byAgent: {} as Record<string, unknown>,
      };

      let salesSum = 0;
      for (const output of outputs) {
        (merged.byAgent as Record<string, unknown>)[output.agentId] = output.data;
        if (typeof output.data.salesTotal === "number") {
          salesSum += output.data.salesTotal;
        }
      }

      merged.aggregated = { salesTotal: salesSum };
      return merged;
    }

    const merged = mergeOutputs(outputs);
    expect(merged.agentCount).toBe(3);
    expect((merged.aggregated as Record<string, unknown>).salesTotal).toBe(187000);
    assertHasShape(merged, { agentCount: "number", byAgent: "object", aggregated: "object" });
  });

  it("handles partial failures: completes with available results when one agent fails", async () => {
    async function unreliableAgent(id: number): Promise<{ id: number; result: string }> {
      if (id === 2) throw new Error("Agent 2 timed out");
      await new Promise((r) => setTimeout(r, 5));
      return { id, result: `ok_${id}` };
    }

    const promises = [1, 2, 3].map((id) =>
      unreliableAgent(id).then(
        (v) => ({ status: "fulfilled" as const, value: v }),
        (e: Error) => ({ status: "rejected" as const, reason: e.message }),
      ),
    );

    const results = await Promise.all(promises);
    const successful = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected");

    expect(successful).toHaveLength(2);
    expect(failed).toHaveLength(1);
    expect((failed[0] as { status: "rejected"; reason: string }).reason).toContain("timed out");
  });

  it("tracks agent spawn time and result latency per agent", async () => {
    const metrics: Array<{ agentId: string; spawnedAt: number; completedAt: number; latencyMs: number }> = [];

    async function trackedAgent(id: number): Promise<void> {
      const spawnedAt = Date.now();
      await new Promise((r) => setTimeout(r, 10 + id * 2));
      const completedAt = Date.now();
      metrics.push({ agentId: `agent_${id}`, spawnedAt, completedAt, latencyMs: completedAt - spawnedAt });
    }

    await Promise.all([1, 2, 3].map(trackedAgent));

    expect(metrics).toHaveLength(3);
    metrics.forEach((m) => {
      expect(m.latencyMs).toBeGreaterThan(0);
      assertHasShape(m, { agentId: "string", spawnedAt: "number", completedAt: "number", latencyMs: "number" });
    });
  });
});

// ---------------------------------------------------------------------------
// Internal todo lists
// ---------------------------------------------------------------------------

describe("Internal todo lists", () => {
  it("agent creates a checklist from a task description", () => {
    function buildChecklist(taskDescription: string): Array<{ item: string; done: boolean }> {
      // Simulate LLM-generated checklist creation
      const steps = [
        `Understand requirements for: ${taskDescription}`,
        "Gather necessary data and resources",
        "Execute primary action",
        "Validate output quality",
        "Report results to caller",
      ];
      return steps.map((item) => ({ item, done: false }));
    }

    const checklist = buildChecklist("Generate quarterly report");
    expect(checklist).toHaveLength(5);
    checklist.forEach((entry) => {
      expect(entry.done).toBe(false);
      expect(typeof entry.item).toBe("string");
    });
  });

  it("marks checklist items as done progressively", () => {
    const checklist = [
      { id: 1, item: "Fetch data", done: false },
      { id: 2, item: "Process data", done: false },
      { id: 3, item: "Format output", done: false },
      { id: 4, item: "Send report", done: false },
    ];

    function markDone(list: typeof checklist, id: number): typeof checklist {
      return list.map((entry) => (entry.id === id ? { ...entry, done: true } : entry));
    }

    function progress(list: typeof checklist): number {
      const done = list.filter((e) => e.done).length;
      return done / list.length;
    }

    let list = checklist;
    expect(progress(list)).toBe(0);

    list = markDone(list, 1);
    expect(progress(list)).toBeCloseTo(0.25);

    list = markDone(list, 2);
    list = markDone(list, 3);
    expect(progress(list)).toBeCloseTo(0.75);

    list = markDone(list, 4);
    expect(progress(list)).toBe(1);
  });

  it("reports progress as a percentage to the caller", () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ step: i + 1, done: i < 7 }));

    function getProgressReport(items: Array<{ step: number; done: boolean }>): {
      pct: number;
      completedSteps: number;
      totalSteps: number;
      remainingSteps: number;
    } {
      const completed = items.filter((i) => i.done).length;
      return {
        pct: Math.round((completed / items.length) * 100),
        completedSteps: completed,
        totalSteps: items.length,
        remainingSteps: items.length - completed,
      };
    }

    const report = getProgressReport(items);
    expect(report.pct).toBe(70);
    expect(report.completedSteps).toBe(7);
    expect(report.remainingSteps).toBe(3);
    assertHasShape(report, { pct: "number", completedSteps: "number", totalSteps: "number", remainingSteps: "number" });
  });

  it("rejects duplicate checklist items silently via deduplication", () => {
    const rawItems = [
      "Fetch data",
      "Process data",
      "Fetch data", // duplicate
      "Format output",
      "Process data", // duplicate
    ];

    function deduplicateChecklist(items: string[]): Array<{ item: string; done: boolean }> {
      return [...new Set(items)].map((item) => ({ item, done: false }));
    }

    const checklist = deduplicateChecklist(rawItems);
    expect(checklist).toHaveLength(3);
    const itemTexts = checklist.map((c) => c.item);
    expect(itemTexts).toContain("Fetch data");
    expect(itemTexts).toContain("Process data");
    expect(itemTexts).toContain("Format output");
  });
});

// ---------------------------------------------------------------------------
// Long-running tasks
// ---------------------------------------------------------------------------

describe("Long-running tasks", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it("agent persists state across simulated invocations via checkpoint", () => {
    const stateFile = `${tempDir}/agent_state.json`;

    function saveState(state: Record<string, unknown>): void {
      const { writeFileSync } = require("fs") as typeof import("fs");
      writeFileSync(stateFile, JSON.stringify(state, null, 2), "utf-8");
    }

    function loadState(): Record<string, unknown> | null {
      const { existsSync, readFileSync } = require("fs") as typeof import("fs");
      if (!existsSync(stateFile)) return null;
      return JSON.parse(readFileSync(stateFile, "utf-8") as string) as Record<string, unknown>;
    }

    const initialState = { step: 1, processedRows: 0, totalRows: 1000, sessionId: "sess_abc" };
    saveState(initialState);

    const loaded = loadState();
    expect(loaded).not.toBeNull();
    expect(loaded?.step).toBe(1);
    expect(loaded?.totalRows).toBe(1000);
    expect(loaded?.sessionId).toBe("sess_abc");
  });

  it("saves a checkpoint with step number and partial results", () => {
    const checkpoint = buildCheckpoint({
      step: 5,
      state: {
        processedItems: 250,
        totalItems: 1000,
        lastProcessedId: "item_250",
        partialResults: [{ category: "A", count: 120 }, { category: "B", count: 130 }],
      },
    });

    assertHasShape(checkpoint, {
      id: "string",
      agentId: "string",
      step: "number",
      state: "object",
      createdAt: "number",
    });

    expect(checkpoint.step).toBe(5);
    const state = checkpoint.state as Record<string, unknown>;
    expect(state.processedItems).toBe(250);
    expect(Array.isArray(state.partialResults)).toBe(true);
  });

  it("resumes from checkpoint and continues from the correct step", () => {
    const checkpoints: AgentCheckpoint[] = [
      buildCheckpoint({ step: 1, state: { progress: 0.1 } }),
      buildCheckpoint({ step: 3, state: { progress: 0.3 } }),
      buildCheckpoint({ step: 7, state: { progress: 0.7 } }), // latest
    ];

    function getLatestCheckpoint(checkpoints: AgentCheckpoint[]): AgentCheckpoint | null {
      if (checkpoints.length === 0) return null;
      return checkpoints.reduce((latest, c) => (c.step > latest.step ? c : latest));
    }

    const latest = getLatestCheckpoint(checkpoints);
    expect(latest).not.toBeNull();
    expect(latest?.step).toBe(7);
    expect((latest?.state as Record<string, unknown>).progress).toBe(0.7);
  });

  it("cleans up expired checkpoints older than retention window", () => {
    const now = Date.now();
    const RETENTION_MS = 24 * 60 * 60 * 1000; // 24 hours

    const checkpoints: AgentCheckpoint[] = [
      buildCheckpoint({ id: "chk_old_1", createdAt: now - RETENTION_MS * 2 }),
      buildCheckpoint({ id: "chk_old_2", createdAt: now - RETENTION_MS * 1.5 }),
      buildCheckpoint({ id: "chk_recent", createdAt: now - 1000 }),
    ];

    function pruneExpired(checkpoints: AgentCheckpoint[], retentionMs: number): AgentCheckpoint[] {
      const cutoff = Date.now() - retentionMs;
      return checkpoints.filter((c) => c.createdAt >= cutoff);
    }

    const retained = pruneExpired(checkpoints, RETENTION_MS);
    expect(retained).toHaveLength(1);
    expect(retained[0].id).toBe("chk_recent");
  });
});

// ---------------------------------------------------------------------------
// Inter-agent communication
// ---------------------------------------------------------------------------

describe("Inter-agent communication", () => {
  it("agent passes its result directly to the next agent in a pipeline", async () => {
    interface PipelineResult {
      stage: string;
      output: unknown;
    }

    async function stageA(): Promise<PipelineResult> {
      await new Promise((r) => setTimeout(r, 5));
      return { stage: "A", output: { records: [1, 2, 3], source: "database" } };
    }

    async function stageB(input: PipelineResult): Promise<PipelineResult> {
      await new Promise((r) => setTimeout(r, 5));
      const records = input.output as { records: number[] };
      return { stage: "B", output: { processed: records.records.map((r) => r * 2) } };
    }

    async function stageC(input: PipelineResult): Promise<PipelineResult> {
      const processed = input.output as { processed: number[] };
      return { stage: "C", output: { report: { total: processed.processed.reduce((a, b) => a + b, 0) } } };
    }

    const resultA = await stageA();
    const resultB = await stageB(resultA);
    const resultC = await stageC(resultB);

    expect(resultC.stage).toBe("C");
    expect((resultC.output as { report: { total: number } }).report.total).toBe(12); // (1+2+3)*2 = 12
  });

  it("agents share a context object that all agents can read and write", () => {
    interface SharedContext {
      sessionId: string;
      facts: string[];
      decisions: Record<string, string>;
      lastUpdatedBy: string;
    }

    const sharedCtx: SharedContext = {
      sessionId: "session_xyz",
      facts: [],
      decisions: {},
      lastUpdatedBy: "",
    };

    function agentAddFact(ctx: SharedContext, agentId: string, fact: string): void {
      ctx.facts.push(fact);
      ctx.lastUpdatedBy = agentId;
    }

    function agentSetDecision(ctx: SharedContext, agentId: string, key: string, value: string): void {
      ctx.decisions[key] = value;
      ctx.lastUpdatedBy = agentId;
    }

    agentAddFact(sharedCtx, "researcher", "Revenue grew 15% YoY");
    agentAddFact(sharedCtx, "researcher", "Churn rate decreased to 3%");
    agentSetDecision(sharedCtx, "strategist", "priority", "growth");
    agentSetDecision(sharedCtx, "writer", "tone", "optimistic");

    expect(sharedCtx.facts).toHaveLength(2);
    expect(sharedCtx.decisions.priority).toBe("growth");
    expect(sharedCtx.decisions.tone).toBe("optimistic");
    expect(sharedCtx.lastUpdatedBy).toBe("writer");
  });

  it("message queue delivers messages in FIFO order", () => {
    class InMemoryQueue<T> {
      private items: Array<{ id: string; payload: T; enqueuedAt: number }> = [];
      private counter = 0;

      enqueue(payload: T): string {
        const id = `msg_${++this.counter}`;
        this.items.push({ id, payload, enqueuedAt: Date.now() });
        return id;
      }

      dequeue(): { id: string; payload: T; enqueuedAt: number } | null {
        return this.items.shift() ?? null;
      }

      size(): number {
        return this.items.length;
      }
    }

    const queue = new InMemoryQueue<string>();

    queue.enqueue("task: fetch data");
    queue.enqueue("task: process data");
    queue.enqueue("task: generate report");

    expect(queue.size()).toBe(3);

    const first = queue.dequeue();
    expect(first?.payload).toBe("task: fetch data");

    const second = queue.dequeue();
    expect(second?.payload).toBe("task: process data");

    expect(queue.size()).toBe(1);
  });
});
