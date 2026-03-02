import { llmGateway } from "../../lib/llmGateway";
import type { CerebroWorldModel } from "./worldModel";
import { selectToolsForSubtask } from "../capabilityDiscovery";

export interface SubtaskNode {
  id: string;
  label: string;
  description: string;
  toolHint?: string;
  dependsOn: string[];
  priority: number;
  estimatedTokens: number;
}

export interface TaskDAG {
  objective: string;
  subtasks: SubtaskNode[];
  estimatedTotalTokens: number;
}

const PLANNER_SYSTEM_PROMPT = `You are a task planner. Given a user request, decompose it into a structured DAG of subtasks.

Output valid JSON with this exact schema:
{
  "objective": "one-line summary of the overall goal",
  "subtasks": [
    {
      "id": "t1",
      "label": "short name",
      "description": "what this subtask does",
      "toolHint": "suggested tool name or null",
      "dependsOn": [],
      "priority": 1,
      "estimatedTokens": 500
    }
  ]
}

Rules:
- Each subtask must have a unique id (t1, t2, t3...)
- dependsOn lists ids of subtasks that must complete first
- priority: 1=highest, 5=lowest
- toolHint: suggest a tool if relevant (web_search, fetch_url, read_file, write_file, run_code, bash, analyze_data, etc.)
- estimatedTokens: rough estimate of LLM tokens needed for this subtask
- Keep subtasks atomic and actionable
- Maximum 8 subtasks for a single request
- For simple requests, 1-2 subtasks is fine
- Output ONLY the JSON, no explanation`;

export async function planTasks(
  userMessage: string,
  conversationContext: string,
  worldModel: CerebroWorldModel,
): Promise<TaskDAG> {
  const worldSnapshot = worldModel.getSnapshot();

  try {
    const response = await llmGateway.chat(
      [
        { role: "system", content: PLANNER_SYSTEM_PROMPT },
        {
          role: "user",
          content: `Current state:\n${worldSnapshot}\n\nConversation context:\n${conversationContext}\n\nUser request:\n${userMessage}`,
        },
      ],
      {
        temperature: 0.3,
        maxTokens: 2000,
        timeout: 15000,
      },
    );

    const raw = response.content.trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return buildFallbackPlan(userMessage);
    }

    const parsed = JSON.parse(jsonMatch[0]) as TaskDAG;

    if (!parsed.subtasks || !Array.isArray(parsed.subtasks) || parsed.subtasks.length === 0) {
      return buildFallbackPlan(userMessage);
    }

    parsed.estimatedTotalTokens = parsed.subtasks.reduce((sum, t) => sum + (t.estimatedTokens || 500), 0);

    for (const st of parsed.subtasks) {
      if (!st.id) st.id = `t${parsed.subtasks.indexOf(st) + 1}`;
      if (!st.dependsOn) st.dependsOn = [];
      if (!st.priority) st.priority = 3;
      if (!st.estimatedTokens) st.estimatedTokens = 500;

      if (!st.toolHint) {
        const suggestedTools = selectToolsForSubtask(st.description || st.label);
        if (suggestedTools.length > 0) {
          st.toolHint = suggestedTools[0];
        }
      }
    }

    return parsed;
  } catch (err: any) {
    console.warn(`[CerebroPlannerAgent] Planning failed, using fallback:`, err?.message);
    return buildFallbackPlan(userMessage);
  }
}

function buildFallbackPlan(userMessage: string): TaskDAG {
  return {
    objective: userMessage.substring(0, 200),
    subtasks: [
      {
        id: "t1",
        label: "Execute request",
        description: userMessage.substring(0, 500),
        dependsOn: [],
        priority: 1,
        estimatedTokens: 2000,
      },
    ],
    estimatedTotalTokens: 2000,
  };
}

export function getExecutionOrder(dag: TaskDAG): SubtaskNode[][] {
  const completed = new Set<string>();
  const waves: SubtaskNode[][] = [];
  const remaining = [...dag.subtasks];

  let maxIterations = dag.subtasks.length + 1;
  while (remaining.length > 0 && maxIterations-- > 0) {
    const ready = remaining.filter(t =>
      t.dependsOn.every(dep => completed.has(dep))
    );

    if (ready.length === 0) {
      waves.push([...remaining]);
      break;
    }

    ready.sort((a, b) => a.priority - b.priority);
    waves.push(ready);

    for (const t of ready) {
      completed.add(t.id);
      const idx = remaining.indexOf(t);
      if (idx >= 0) remaining.splice(idx, 1);
    }
  }

  return waves;
}
