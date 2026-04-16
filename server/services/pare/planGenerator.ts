import { Intent, Entity, ToolCandidate, TaskNode, ExecutionPlan } from "./types";
import { v4 as uuidv4 } from "uuid";

interface DependencyGraph {
  nodes: Map<string, TaskNode>;
  edges: [string, string][];
  adjacency: Map<string, string[]>;
  inDegree: Map<string, number>;
}

export class PlanGenerator {
  async generate(
    objective: string,
    intents: Intent[],
    entities: Entity[],
    toolCandidates: ToolCandidate[],
    context?: Record<string, unknown>
  ): Promise<ExecutionPlan> {
    if (toolCandidates.length === 0) {
      return this.createFallbackPlan(objective);
    }

    try {
      const plan = await this.generateWithLLM(objective, intents, entities, toolCandidates);
      return plan;
    } catch (error) {
      console.warn("[PlanGenerator] LLM planning failed, using heuristic:", error);
      return this.generateHeuristicPlan(objective, toolCandidates, entities);
    }
  }

  private async generateWithLLM(
    objective: string,
    intents: Intent[],
    entities: Entity[],
    toolCandidates: ToolCandidate[]
  ): Promise<ExecutionPlan> {
    const { geminiChat } = await import("../../lib/gemini");

    const toolsInfo = toolCandidates
      .slice(0, 8)
      .map((t) => `- ${t.toolName} (relevancia: ${t.relevanceScore.toFixed(2)})`)
      .join("\n");

    const entitiesInfo = entities
      .slice(0, 10)
      .map((e) => `- ${e.type}: ${e.value}`)
      .join("\n");

    const intentsInfo = intents
      .slice(0, 3)
      .map((i) => `- ${i.category}: ${i.confidence.toFixed(2)}`)
      .join("\n");

    const systemPrompt = `Eres un planificador de tareas. Genera un plan de ejecución óptimo.

REGLAS:
1. Cada tarea tiene: id, tool, inputs, dependencies
2. dependencies son IDs de tareas previas requeridas
3. Minimiza pasos, aprovecha paralelismo
4. Los inputs pueden usar $task_id.field para outputs anteriores

Responde SOLO con JSON:
{"tasks":[{"id":"task_1","tool":"nombre","inputs":{"param":"valor"},"dependencies":[]}],"reasoning":"explicación"}`;

    const userPrompt = `OBJETIVO: ${objective}

INTENCIONES:
${intentsInfo}

ENTIDADES:
${entitiesInfo}

HERRAMIENTAS:
${toolsInfo}

Genera el plan óptimo.`;

    const result = await geminiChat(
      [{ role: "user", parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }],
      { model: "gemini-2.0-flash", maxOutputTokens: 800, temperature: 0.2 }
    );

    const responseText = result.content?.trim() || "";
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      throw new Error("No valid JSON in LLM response");
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const graph = this.buildDependencyGraph(parsed.tasks || []);
    const sortedNodes = this.topologicalSort(graph);
    const parallelGroups = this.getParallelGroups(graph);

    return {
      planId: `plan_${uuidv4().slice(0, 12)}`,
      objective,
      nodes: sortedNodes,
      edges: graph.edges,
      estimatedDurationMs: this.estimateDuration(sortedNodes),
      parallelGroups,
    };
  }

  private generateHeuristicPlan(
    objective: string,
    toolCandidates: ToolCandidate[],
    entities: Entity[]
  ): ExecutionPlan {
    const nodes: TaskNode[] = [];
    const edges: [string, string][] = [];
    let previousTaskId: string | null = null;

    const sortedTools = [...toolCandidates].sort((a, b) => {
      const priorityOrder: Record<string, number> = {
        web_search: 1,
        fetch_url: 2,
        file_read: 2,
        code_execute: 3,
        data_analyze: 4,
        generate_text: 5,
        doc_create: 6,
        message: 10,
      };
      return (priorityOrder[a.toolName] || 5) - (priorityOrder[b.toolName] || 5);
    });

    const topTools = sortedTools.slice(0, 3);

    for (let i = 0; i < topTools.length; i++) {
      const tool = topTools[i];
      const taskId = `task_${i + 1}`;

      const inputs: Record<string, unknown> = { objective };

      for (const entity of entities) {
        if (entity.type === "url" && tool.toolName.includes("url")) {
          inputs.url = entity.normalizedValue || entity.value;
        }
        if (entity.type === "file_path" && tool.toolName.includes("file")) {
          inputs.path = entity.normalizedValue || entity.value;
        }
      }

      if (previousTaskId) {
        inputs.previousResult = `$${previousTaskId}.result`;
      }

      nodes.push({
        id: taskId,
        tool: tool.toolName,
        inputs,
        dependencies: previousTaskId ? [previousTaskId] : [],
        priority: 5,
        canFail: false,
        timeoutMs: 60000,
        retryCount: 2,
      });

      if (previousTaskId) {
        edges.push([previousTaskId, taskId]);
      }

      previousTaskId = taskId;
    }

    const respondTaskId = "task_respond";
    nodes.push({
      id: respondTaskId,
      tool: "message",
      inputs: { content: previousTaskId ? `$${previousTaskId}.result` : objective },
      dependencies: previousTaskId ? [previousTaskId] : [],
      priority: 10,
      canFail: false,
      timeoutMs: 30000,
      retryCount: 1,
    });

    if (previousTaskId) {
      edges.push([previousTaskId, respondTaskId]);
    }

    return {
      planId: `plan_heuristic_${uuidv4().slice(0, 8)}`,
      objective,
      nodes,
      edges,
      estimatedDurationMs: this.estimateDuration(nodes),
      parallelGroups: nodes.map((n) => [n.id]),
    };
  }

  private createFallbackPlan(objective: string): ExecutionPlan {
    return {
      planId: `plan_fallback_${uuidv4().slice(0, 8)}`,
      objective,
      nodes: [
        {
          id: "task_respond",
          tool: "message",
          inputs: { content: objective },
          dependencies: [],
          priority: 10,
          canFail: false,
          timeoutMs: 30000,
          retryCount: 1,
        },
      ],
      edges: [],
      estimatedDurationMs: 30000,
      parallelGroups: [["task_respond"]],
    };
  }

  private buildDependencyGraph(tasks: Array<{
    id: string;
    tool: string;
    inputs?: Record<string, unknown>;
    dependencies?: string[];
  }>): DependencyGraph {
    const nodes = new Map<string, TaskNode>();
    const edges: [string, string][] = [];
    const adjacency = new Map<string, string[]>();
    const inDegree = new Map<string, number>();

    for (const task of tasks) {
      const node: TaskNode = {
        id: task.id,
        tool: task.tool,
        inputs: task.inputs || {},
        dependencies: task.dependencies || [],
        priority: 5,
        canFail: false,
        timeoutMs: 60000,
        retryCount: 2,
      };

      nodes.set(task.id, node);
      adjacency.set(task.id, []);
      inDegree.set(task.id, 0);
    }

    for (const task of tasks) {
      for (const dep of task.dependencies || []) {
        if (nodes.has(dep)) {
          edges.push([dep, task.id]);
          adjacency.get(dep)?.push(task.id);
          inDegree.set(task.id, (inDegree.get(task.id) || 0) + 1);
        }
      }
    }

    return { nodes, edges, adjacency, inDegree };
  }

  private topologicalSort(graph: DependencyGraph): TaskNode[] {
    const result: TaskNode[] = [];
    const inDegree = new Map(graph.inDegree);
    const queue: string[] = [];

    for (const [nodeId, degree] of inDegree) {
      if (degree === 0) {
        queue.push(nodeId);
      }
    }

    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      const node = graph.nodes.get(nodeId);
      if (node) {
        result.push(node);
      }

      for (const neighbor of graph.adjacency.get(nodeId) || []) {
        const newDegree = (inDegree.get(neighbor) || 1) - 1;
        inDegree.set(neighbor, newDegree);
        if (newDegree === 0) {
          queue.push(neighbor);
        }
      }
    }

    if (result.length !== graph.nodes.size) {
      console.warn("[PlanGenerator] Cycle detected in dependency graph");
    }

    return result;
  }

  private getParallelGroups(graph: DependencyGraph): string[][] {
    const groups: string[][] = [];
    const remaining = new Set(graph.nodes.keys());
    const completed = new Set<string>();

    while (remaining.size > 0) {
      const ready: string[] = [];

      for (const nodeId of remaining) {
        const node = graph.nodes.get(nodeId);
        if (!node) continue;

        const allDepsCompleted = node.dependencies.every(
          (dep) => completed.has(dep) || !remaining.has(dep)
        );

        if (allDepsCompleted) {
          ready.push(nodeId);
        }
      }

      if (ready.length === 0) {
        break;
      }

      groups.push(ready);

      for (const nodeId of ready) {
        remaining.delete(nodeId);
        completed.add(nodeId);
      }
    }

    return groups;
  }

  private estimateDuration(nodes: TaskNode[]): number {
    return nodes.reduce((sum, node) => sum + node.timeoutMs, 0);
  }
}
