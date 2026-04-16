import { randomUUID } from "crypto";
import { z } from "zod";
import { llmGateway } from "../../lib/llmGateway";

export const MicroTaskSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string(),
  toolHint: z.string().optional(),
  dependsOn: z.array(z.string()).default([]),
  priority: z.number().min(1).max(10).default(5),
  estimatedTokens: z.number().default(500),
  group: z.string().optional(),
  parallelizable: z.boolean().default(true),
  complexity: z.enum(["trivial", "simple", "moderate", "complex"]).default("simple"),
});
export type MicroTask = z.infer<typeof MicroTaskSchema>;

export const TaskDAGSchema = z.object({
  objective: z.string(),
  tasks: z.array(MicroTaskSchema),
  parallelGroups: z.array(z.array(z.string())),
  estimatedTotalTokens: z.number(),
  criticalPathLength: z.number(),
  maxParallelism: z.number(),
});
export type TaskDAG = z.infer<typeof TaskDAGSchema>;

export const DecompositionOptionsSchema = z.object({
  maxTasks: z.number().default(50),
  maxDepth: z.number().default(5),
  preferParallel: z.boolean().default(true),
  granularity: z.enum(["coarse", "medium", "fine"]).default("medium"),
  availableTools: z.array(z.string()).default([]),
});
export type DecompositionOptions = z.infer<typeof DecompositionOptionsSchema>;

const DECOMPOSER_SYSTEM_PROMPT = `You are a task decomposition engine. Break complex goals into atomic micro-tasks organized as a directed acyclic graph (DAG).

Output valid JSON with this schema:
{
  "objective": "overall goal summary",
  "tasks": [
    {
      "id": "t1",
      "label": "short name",
      "description": "detailed description of what to do",
      "toolHint": "suggested tool or null",
      "dependsOn": [],
      "priority": 1,
      "estimatedTokens": 500,
      "group": "group_name",
      "parallelizable": true,
      "complexity": "simple"
    }
  ]
}

Rules:
- Each task has a unique id (t1, t2, t3...).
- dependsOn lists ids of tasks that must finish first.
- Group tasks that can run simultaneously under the same group name.
- priority: 1=highest priority, 10=lowest.
- complexity: trivial (lookup), simple (single tool call), moderate (multi-step), complex (research/reasoning).
- Tasks should be atomic: one clear action per task.
- Maximize parallelism: only add dependencies when output is truly required.
- toolHint: web_search, fetch_url, read_file, write_file, run_code, bash, analyze_data, generate_image, etc.
- Output ONLY valid JSON, no explanation.`;

export class TaskDecomposer {
  async decompose(
    goal: string,
    conversationContext: string,
    options: Partial<DecompositionOptions> = {},
  ): Promise<TaskDAG> {
    const opts = DecompositionOptionsSchema.parse(options);

    const granularityHint =
      opts.granularity === "fine"
        ? "Break into many small atomic tasks (up to 50)."
        : opts.granularity === "coarse"
          ? "Keep tasks high-level (3-8 tasks max)."
          : "Use moderate granularity (5-20 tasks).";

    const toolsHint =
      opts.availableTools.length > 0
        ? `\nAvailable tools: ${opts.availableTools.join(", ")}`
        : "";

    const messages = [
      { role: "system" as const, content: DECOMPOSER_SYSTEM_PROMPT },
      {
        role: "user" as const,
        content: `Goal: ${goal}\n\nContext: ${conversationContext}\n\n${granularityHint}${toolsHint}\nMax tasks: ${opts.maxTasks}`,
      },
    ];

    try {
      const response = await llmGateway.chat(messages, {
        provider: "xai",
        model: "grok-3-mini",
        temperature: 0.3,
        maxTokens: 4096,
      });

      const parsed = this.parseDecomposition(response.content);
      const tasks = parsed.tasks.slice(0, opts.maxTasks);
      this.validateDAG(tasks);
      const parallelGroups = this.computeParallelGroups(tasks);
      const criticalPath = this.computeCriticalPathLength(tasks);

      return TaskDAGSchema.parse({
        objective: parsed.objective,
        tasks,
        parallelGroups,
        estimatedTotalTokens: tasks.reduce((sum, t) => sum + t.estimatedTokens, 0),
        criticalPathLength: criticalPath,
        maxParallelism: Math.max(...parallelGroups.map(g => g.length), 1),
      });
    } catch (error: any) {
      console.error("[TaskDecomposer] LLM decomposition failed, using fallback:", error.message);
      return this.fallbackDecomposition(goal);
    }
  }

  computeParallelGroups(tasks: MicroTask[]): string[][] {
    const completed = new Set<string>();
    const remaining = new Map(tasks.map(t => [t.id, t]));
    const waves: string[][] = [];

    while (remaining.size > 0) {
      const wave: string[] = [];

      for (const [id, task] of remaining) {
        const depsReady = task.dependsOn.every(dep => completed.has(dep));
        if (depsReady) {
          wave.push(id);
        }
      }

      if (wave.length === 0) {
        const stuck = Array.from(remaining.keys());
        console.warn("[TaskDecomposer] Cycle detected, forcing remaining tasks:", stuck);
        waves.push(stuck);
        break;
      }

      for (const id of wave) {
        completed.add(id);
        remaining.delete(id);
      }

      waves.push(wave);
    }

    return waves;
  }

  computeCriticalPathLength(tasks: MicroTask[]): number {
    const taskMap = new Map(tasks.map(t => [t.id, t]));
    const memo = new Map<string, number>();

    const longestPath = (id: string): number => {
      if (memo.has(id)) return memo.get(id)!;

      const task = taskMap.get(id);
      if (!task || task.dependsOn.length === 0) {
        memo.set(id, 1);
        return 1;
      }

      const maxDep = Math.max(...task.dependsOn.map(dep => longestPath(dep)));
      const result = maxDep + 1;
      memo.set(id, result);
      return result;
    };

    let maxPath = 0;
    for (const task of tasks) {
      maxPath = Math.max(maxPath, longestPath(task.id));
    }
    return maxPath;
  }

  computeExecutionOrder(dag: TaskDAG): MicroTask[][] {
    const taskMap = new Map(dag.tasks.map(t => [t.id, t]));
    return dag.parallelGroups.map(group =>
      group
        .map(id => taskMap.get(id))
        .filter((t): t is MicroTask => t !== undefined)
        .sort((a, b) => a.priority - b.priority),
    );
  }

  getParallelizableSubsets(tasks: MicroTask[]): MicroTask[][] {
    const groups = new Map<string, MicroTask[]>();

    for (const task of tasks) {
      const key = task.group || `_auto_${task.dependsOn.sort().join(",")}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(task);
    }

    return Array.from(groups.values()).filter(g => g.length > 1);
  }

  private parseDecomposition(raw: string): { objective: string; tasks: MicroTask[] } {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("No JSON found in decomposition response");
    }

    const parsed = JSON.parse(jsonMatch[0]);

    const tasks: MicroTask[] = (parsed.tasks || []).map((t: any) =>
      MicroTaskSchema.parse({
        id: t.id || `t${randomUUID().slice(0, 4)}`,
        label: t.label || "Untitled task",
        description: t.description || t.label || "",
        toolHint: t.toolHint || undefined,
        dependsOn: Array.isArray(t.dependsOn) ? t.dependsOn : [],
        priority: t.priority || 5,
        estimatedTokens: t.estimatedTokens || 500,
        group: t.group || undefined,
        parallelizable: t.parallelizable !== false,
        complexity: t.complexity || "simple",
      }),
    );

    return { objective: parsed.objective || "Task execution", tasks };
  }

  private validateDAG(tasks: MicroTask[]): void {
    const ids = new Set(tasks.map(t => t.id));
    for (const task of tasks) {
      task.dependsOn = task.dependsOn.filter(dep => ids.has(dep));
    }

    const visited = new Set<string>();
    const stack = new Set<string>();

    const hasCycle = (id: string): boolean => {
      if (stack.has(id)) return true;
      if (visited.has(id)) return false;

      visited.add(id);
      stack.add(id);

      const task = tasks.find(t => t.id === id);
      if (task) {
        for (const dep of task.dependsOn) {
          if (hasCycle(dep)) return true;
        }
      }

      stack.delete(id);
      return false;
    };

    for (const task of tasks) {
      if (hasCycle(task.id)) {
        console.warn(`[TaskDecomposer] Cycle detected involving task ${task.id}, clearing deps`);
        task.dependsOn = [];
      }
    }
  }

  private fallbackDecomposition(goal: string): TaskDAG {
    const singleTask: MicroTask = {
      id: "t1",
      label: "Execute goal",
      description: goal,
      dependsOn: [],
      priority: 1,
      estimatedTokens: 2000,
      parallelizable: false,
      complexity: "moderate",
    };

    return {
      objective: goal,
      tasks: [singleTask],
      parallelGroups: [["t1"]],
      estimatedTotalTokens: 2000,
      criticalPathLength: 1,
      maxParallelism: 1,
    };
  }
}

export const taskDecomposer = new TaskDecomposer();
