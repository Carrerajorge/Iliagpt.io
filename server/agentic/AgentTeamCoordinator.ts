import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import pino from "pino";
import {
  getClaudeAgentBackbone,
  CLAUDE_MODELS,
  type AgentMessage,
  type ToolDefinition,
} from "./ClaudeAgentBackbone.js";

const logger = pino({ name: "AgentTeamCoordinator" });

// ─── Types ────────────────────────────────────────────────────────────────────

export type TeamRole = "leader" | "researcher" | "developer" | "reviewer" | "writer";

export type AgentStatus = "idle" | "working" | "waiting" | "done" | "failed";

export type MessageType =
  | "task_assignment"
  | "finding"
  | "question"
  | "answer"
  | "conflict"
  | "vote"
  | "status_update"
  | "completion";

export interface TeamAgent {
  agentId: string;
  role: TeamRole;
  name: string;
  status: AgentStatus;
  currentTaskId?: string;
  expertise: string[];
  workload: number; // 0-1
  completedTasks: number;
  model: string;
  systemPrompt: string;
}

export interface TeamMessage {
  messageId: string;
  fromAgentId: string;
  toAgentId?: string; // null = broadcast
  type: MessageType;
  content: string;
  data?: Record<string, unknown>;
  timestamp: number;
  threadId?: string; // for conversation threading
}

export interface TeamTask {
  taskId: string;
  title: string;
  description: string;
  assignedTo?: string; // agentId
  role: TeamRole; // which role should handle this
  status: "pending" | "assigned" | "in_progress" | "review" | "done" | "failed";
  dependencies: string[]; // taskIds
  result?: string;
  reviewNotes?: string;
  createdAt: number;
  completedAt?: number;
  priority: number; // 0-10
}

export interface ConflictResolution {
  conflictId: string;
  topic: string;
  positions: Array<{ agentId: string; position: string; reasoning: string }>;
  resolution: string;
  resolvedBy: "vote" | "leader" | "escalated";
  votes?: Record<string, string>; // agentId → chosen position
  timestamp: number;
}

export interface TeamProgress {
  teamId: string;
  goal: string;
  totalTasks: number;
  completedTasks: number;
  inProgressTasks: number;
  failedTasks: number;
  percentComplete: number;
  agentStatuses: Record<string, AgentStatus>;
  recentMessages: TeamMessage[];
  conflicts: ConflictResolution[];
  startedAt: number;
  estimatedCompletionMs?: number;
}

export interface SharedContext {
  teamId: string;
  goal: string;
  findings: Array<{ agentId: string; finding: string; timestamp: number }>;
  decisions: Array<{ decision: string; madeBy: string; timestamp: number }>;
  sharedMemory: Record<string, unknown>;
  artifacts: Array<{ name: string; type: string; content: string; createdBy: string }>;
}

// ─── Role system prompts ──────────────────────────────────────────────────────

const ROLE_CONFIGS: Record<
  TeamRole,
  { model: string; systemPrompt: string; expertise: string[] }
> = {
  leader: {
    model: CLAUDE_MODELS.OPUS,
    systemPrompt: `You are the Team Leader agent. Your responsibilities:
1. Decompose the main goal into specific sub-tasks
2. Assign tasks to the right team members based on their roles
3. Monitor progress and unblock team members
4. Resolve conflicts when team members disagree
5. Aggregate results into a coherent final output
6. Escalate to humans when the team is stuck

Always output structured JSON for task assignments and status updates.`,
    expertise: ["planning", "coordination", "synthesis", "decision-making"],
  },
  researcher: {
    model: CLAUDE_MODELS.SONNET,
    systemPrompt: `You are the Researcher agent. Your responsibilities:
1. Gather information from available sources
2. Evaluate source quality and credibility
3. Extract key facts and insights
4. Identify gaps in knowledge
5. Present findings in a structured, citable format
6. Flag contradictions between sources

Always cite your sources and rate your confidence level.`,
    expertise: ["research", "analysis", "fact-checking", "synthesis"],
  },
  developer: {
    model: CLAUDE_MODELS.SONNET,
    systemPrompt: `You are the Developer agent. Your responsibilities:
1. Write clean, functional code based on specifications
2. Debug and fix errors in existing code
3. Optimize for performance and readability
4. Write tests for your implementations
5. Document your code with clear comments
6. Follow established patterns and conventions

Always provide complete, working code — no placeholders.`,
    expertise: ["coding", "debugging", "testing", "architecture"],
  },
  reviewer: {
    model: CLAUDE_MODELS.SONNET,
    systemPrompt: `You are the Reviewer agent. Your responsibilities:
1. Check work produced by other agents for quality and correctness
2. Identify logical errors, gaps, or inconsistencies
3. Suggest specific improvements (not vague feedback)
4. Verify that output matches the original requirements
5. Rate quality on a 0-10 scale with justification
6. Approve or request revision

Be constructive and specific. Focus on what matters most.`,
    expertise: ["quality assurance", "validation", "feedback", "standards"],
  },
  writer: {
    model: CLAUDE_MODELS.SONNET,
    systemPrompt: `You are the Writer agent. Your responsibilities:
1. Transform technical findings into clear, readable content
2. Structure information logically for the target audience
3. Create documentation, reports, and summaries
4. Ensure consistent voice and style
5. Format output appropriately (markdown, structured docs)
6. Adapt complexity to match the audience

Make complex things simple. Make simple things clear.`,
    expertise: ["writing", "documentation", "communication", "formatting"],
  },
};

// ─── AgentTeamCoordinator ─────────────────────────────────────────────────────

export class AgentTeamCoordinator extends EventEmitter {
  private teams = new Map<string, {
    agents: Map<string, TeamAgent>;
    tasks: Map<string, TeamTask>;
    messages: TeamMessage[];
    conflicts: ConflictResolution[];
    sharedContext: SharedContext;
    goal: string;
    startedAt: number;
  }>();

  constructor(
    private readonly backbone = getClaudeAgentBackbone()
  ) {
    super();
    logger.info("[AgentTeamCoordinator] Initialized");
  }

  // ── Team creation ─────────────────────────────────────────────────────────────

  createTeam(goal: string, roles: TeamRole[] = ["leader", "researcher", "developer", "reviewer", "writer"]): string {
    const teamId = randomUUID();
    const agents = new Map<string, TeamAgent>();

    for (const role of roles) {
      const config = ROLE_CONFIGS[role];
      const agent: TeamAgent = {
        agentId: randomUUID(),
        role,
        name: `${role.charAt(0).toUpperCase() + role.slice(1)} Agent`,
        status: "idle",
        expertise: config.expertise,
        workload: 0,
        completedTasks: 0,
        model: config.model,
        systemPrompt: config.systemPrompt,
      };
      agents.set(agent.agentId, agent);
    }

    this.teams.set(teamId, {
      agents,
      tasks: new Map(),
      messages: [],
      conflicts: [],
      sharedContext: {
        teamId,
        goal,
        findings: [],
        decisions: [],
        sharedMemory: {},
        artifacts: [],
      },
      goal,
      startedAt: Date.now(),
    });

    logger.info({ teamId, goal: goal.slice(0, 60), roles }, "[AgentTeamCoordinator] Team created");
    this.emit("team:created", { teamId, goal, roles });
    return teamId;
  }

  // ── Main orchestration ────────────────────────────────────────────────────────

  async executeGoal(
    teamId: string,
    availableTools: ToolDefinition[] = []
  ): Promise<SharedContext> {
    const team = this.teams.get(teamId);
    if (!team) throw new Error(`Team '${teamId}' not found`);

    const leader = this.getAgentByRole(teamId, "leader");
    if (!leader) throw new Error("No leader agent in team");

    logger.info({ teamId, goal: team.goal.slice(0, 60) }, "[AgentTeamCoordinator] Executing goal");
    this.emit("team:execution_started", { teamId });

    // Step 1: Leader decomposes the goal into tasks
    const tasks = await this.decomposeGoal(teamId, team.goal, leader, availableTools);
    for (const task of tasks) {
      team.tasks.set(task.taskId, task);
    }

    this.emit("team:tasks_created", { teamId, taskCount: tasks.length });

    // Step 2: Execute tasks in dependency order
    await this.executeTasks(teamId, availableTools);

    // Step 3: Leader synthesizes results
    const synthesis = await this.synthesizeResults(teamId, leader);
    team.sharedContext.artifacts.push({
      name: "final_synthesis",
      type: "markdown",
      content: synthesis,
      createdBy: leader.agentId,
    });

    this.emit("team:completed", { teamId, artifactCount: team.sharedContext.artifacts.length });
    return team.sharedContext;
  }

  // ── Goal decomposition ────────────────────────────────────────────────────────

  private async decomposeGoal(
    teamId: string,
    goal: string,
    leader: TeamAgent,
    tools: ToolDefinition[]
  ): Promise<TeamTask[]> {
    const team = this.teams.get(teamId)!;
    const availableRoles = Array.from(team.agents.values()).map((a) => a.role);
    const toolList = tools.map((t) => `- ${t.name}: ${t.description}`).join("\n");

    const messages: AgentMessage[] = [
      {
        role: "user",
        content: `Decompose this goal into specific tasks for the team.

GOAL: ${goal}

AVAILABLE ROLES: ${availableRoles.join(", ")}
${toolList ? `\nAVAILABLE TOOLS:\n${toolList}` : ""}

Create 3-8 tasks that collectively achieve the goal. Each task should be assignable to one role.

Output JSON array:
[{
  "title": "short task name",
  "description": "detailed description of what to do",
  "role": "researcher|developer|reviewer|writer",
  "priority": 1-10,
  "dependencies": ["title of prerequisite task"]
}]

Return ONLY valid JSON array.`,
      },
    ];

    const response = await this.backbone.call(messages, {
      model: leader.model,
      maxTokens: 2048,
      system: leader.systemPrompt,
    });

    const tasks: TeamTask[] = [];
    try {
      const jsonMatch = response.text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as Array<{
          title?: string;
          description?: string;
          role?: TeamRole;
          priority?: number;
          dependencies?: string[];
        }>;

        const titleToId = new Map<string, string>();

        for (const t of parsed) {
          if (!t.title || !t.description) continue;
          const taskId = randomUUID();
          titleToId.set(t.title, taskId);

          const task: TeamTask = {
            taskId,
            title: t.title,
            description: t.description,
            role: (t.role ?? "researcher") as TeamRole,
            status: "pending",
            dependencies: [], // resolve after all tasks created
            priority: t.priority ?? 5,
            createdAt: Date.now(),
          };
          tasks.push(task);
        }

        // Resolve dependencies by title
        for (let i = 0; i < tasks.length; i++) {
          const raw = parsed[i];
          tasks[i].dependencies = (raw.dependencies ?? [])
            .map((dep) => titleToId.get(dep))
            .filter(Boolean) as string[];
        }
      }
    } catch (err) {
      logger.error({ err }, "[AgentTeamCoordinator] Failed to parse tasks");
    }

    // Broadcast task creation
    this.broadcast(teamId, leader.agentId, "task_assignment", `Team goal decomposed into ${tasks.length} tasks`);
    return tasks;
  }

  // ── Task execution ────────────────────────────────────────────────────────────

  private async executeTasks(teamId: string, tools: ToolDefinition[]): Promise<void> {
    const team = this.teams.get(teamId)!;
    const completed = new Set<string>();
    const inFlight = new Set<string>();

    const getReady = (): TeamTask[] =>
      Array.from(team.tasks.values()).filter(
        (t) =>
          t.status === "pending" &&
          !inFlight.has(t.taskId) &&
          t.dependencies.every((d) => completed.has(d))
      );

    while (completed.size + (Array.from(team.tasks.values()).filter((t) => t.status === "failed").length) < team.tasks.size) {
      const ready = getReady();
      if (ready.length === 0 && inFlight.size === 0) break;

      // Execute ready tasks in parallel
      const batch = ready.slice(0, 3); // max 3 concurrent
      for (const task of batch) {
        inFlight.add(task.taskId);
        task.status = "assigned";
      }

      await Promise.allSettled(
        batch.map(async (task) => {
          const agent = this.getAvailableAgentForRole(teamId, task.role);
          if (!agent) {
            task.status = "failed";
            inFlight.delete(task.taskId);
            return;
          }

          task.assignedTo = agent.agentId;
          task.status = "in_progress";
          agent.status = "working";
          agent.currentTaskId = task.taskId;
          agent.workload = 1;

          try {
            const result = await this.executeTask(teamId, task, agent, tools);
            task.result = result;
            task.status = "done";
            task.completedAt = Date.now();
            agent.completedTasks++;
            completed.add(task.taskId);

            // Add finding to shared context
            team.sharedContext.findings.push({
              agentId: agent.agentId,
              finding: result.slice(0, 500),
              timestamp: Date.now(),
            });
          } catch (err) {
            task.status = "failed";
            logger.error({ taskId: task.taskId, err }, "[AgentTeamCoordinator] Task failed");
          } finally {
            agent.status = "idle";
            agent.workload = 0;
            agent.currentTaskId = undefined;
            inFlight.delete(task.taskId);
          }
        })
      );
    }
  }

  private async executeTask(
    teamId: string,
    task: TeamTask,
    agent: TeamAgent,
    tools: ToolDefinition[]
  ): Promise<string> {
    const team = this.teams.get(teamId)!;

    // Build context from prior findings
    const relevantFindings = team.sharedContext.findings
      .slice(-5)
      .map((f) => f.finding)
      .join("\n\n");

    const messages: AgentMessage[] = [
      {
        role: "user",
        content: `Complete this task as part of a team effort.

TEAM GOAL: ${team.goal}

YOUR TASK: ${task.title}
DESCRIPTION: ${task.description}

${relevantFindings ? `CONTEXT FROM TEAM:\n${relevantFindings}\n` : ""}

Produce a complete, high-quality result. Be thorough and specific.`,
      },
    ];

    const response = await this.backbone.call(messages, {
      model: agent.model,
      maxTokens: 3072,
      system: agent.systemPrompt,
      tools: tools.length > 0 ? tools : undefined,
    });

    this.broadcast(
      teamId,
      agent.agentId,
      "finding",
      `Completed: ${task.title}`,
      { taskId: task.taskId, resultPreview: response.text.slice(0, 200) }
    );

    return response.text;
  }

  // ── Conflict resolution ───────────────────────────────────────────────────────

  async resolveConflict(
    teamId: string,
    topic: string,
    positions: Array<{ agentId: string; position: string; reasoning: string }>
  ): Promise<ConflictResolution> {
    const team = this.teams.get(teamId)!;
    const leader = this.getAgentByRole(teamId, "leader");

    const conflictId = randomUUID();

    // First try voting
    const votes: Record<string, string> = {};
    for (const agent of team.agents.values()) {
      if (agent.role !== "leader") {
        // Each non-leader votes on the best position
        const messages: AgentMessage[] = [
          {
            role: "user",
            content: `Vote on the best approach for: ${topic}

OPTIONS:
${positions.map((p, i) => `${i + 1}. ${p.position} — Reasoning: ${p.reasoning}`).join("\n")}

Which option number is best? Reply with just the number.`,
          },
        ];

        const response = await this.backbone.call(messages, {
          model: agent.model,
          maxTokens: 10,
          system: agent.systemPrompt,
        });

        const vote = response.text.trim().match(/\d+/)?.[0];
        if (vote) {
          const idx = parseInt(vote, 10) - 1;
          if (idx >= 0 && idx < positions.length) {
            votes[agent.agentId] = positions[idx].position;
          }
        }
      }
    }

    // Count votes
    const voteCounts = new Map<string, number>();
    for (const pos of Object.values(votes)) {
      voteCounts.set(pos, (voteCounts.get(pos) ?? 0) + 1);
    }

    const winner = [...voteCounts.entries()].sort((a, b) => b[1] - a[1])[0];
    const majority = winner && winner[1] > positions.length / 2;

    let resolution: string;
    let resolvedBy: ConflictResolution["resolvedBy"];

    if (majority) {
      resolution = winner[0];
      resolvedBy = "vote";
    } else if (leader) {
      // Leader decides
      const messages: AgentMessage[] = [
        {
          role: "user",
          content: `Decide between these conflicting positions on: ${topic}

${positions.map((p) => `Position: ${p.position}\nReasoning: ${p.reasoning}`).join("\n\n")}

Choose the best approach and briefly explain why.`,
        },
      ];

      const response = await this.backbone.call(messages, {
        model: leader.model,
        maxTokens: 512,
        system: leader.systemPrompt,
      });

      resolution = response.text;
      resolvedBy = "leader";
    } else {
      resolution = "Conflict escalated — requires human input";
      resolvedBy = "escalated";
    }

    const conflict: ConflictResolution = {
      conflictId,
      topic,
      positions,
      resolution,
      resolvedBy,
      votes: Object.keys(votes).length > 0 ? votes : undefined,
      timestamp: Date.now(),
    };

    team.conflicts.push(conflict);
    this.emit("conflict:resolved", { teamId, conflict });
    return conflict;
  }

  // ── Synthesis ─────────────────────────────────────────────────────────────────

  private async synthesizeResults(
    teamId: string,
    leader: TeamAgent
  ): Promise<string> {
    const team = this.teams.get(teamId)!;

    const taskResults = Array.from(team.tasks.values())
      .filter((t) => t.status === "done" && t.result)
      .map((t) => `## ${t.title}\n${t.result}`)
      .join("\n\n");

    const messages: AgentMessage[] = [
      {
        role: "user",
        content: `Synthesize the team's work into a final, coherent deliverable.

GOAL: ${team.goal}

TEAM RESULTS:
${taskResults.slice(0, 8000)}

Create a unified final output that addresses the original goal completely.`,
      },
    ];

    const response = await this.backbone.call(messages, {
      model: leader.model,
      maxTokens: 4096,
      system: leader.systemPrompt,
    });

    return response.text;
  }

  // ── Communication ─────────────────────────────────────────────────────────────

  private broadcast(
    teamId: string,
    fromAgentId: string,
    type: MessageType,
    content: string,
    data?: Record<string, unknown>
  ): void {
    const team = this.teams.get(teamId);
    if (!team) return;

    const message: TeamMessage = {
      messageId: randomUUID(),
      fromAgentId,
      type,
      content,
      data,
      timestamp: Date.now(),
    };

    team.messages.push(message);
    if (team.messages.length > 500) team.messages.shift();

    this.emit("team:message", { teamId, message });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  private getAgentByRole(teamId: string, role: TeamRole): TeamAgent | null {
    const team = this.teams.get(teamId);
    if (!team) return null;
    for (const agent of team.agents.values()) {
      if (agent.role === role) return agent;
    }
    return null;
  }

  private getAvailableAgentForRole(teamId: string, role: TeamRole): TeamAgent | null {
    const team = this.teams.get(teamId);
    if (!team) return null;

    for (const agent of team.agents.values()) {
      if (agent.role === role && agent.status === "idle") return agent;
    }

    // Fall back to leader if no specific role available
    const leader = this.getAgentByRole(teamId, "leader");
    if (leader?.status === "idle") return leader;

    return null;
  }

  // ── Queries ───────────────────────────────────────────────────────────────────

  getProgress(teamId: string): TeamProgress | null {
    const team = this.teams.get(teamId);
    if (!team) return null;

    const allTasks = Array.from(team.tasks.values());
    const completed = allTasks.filter((t) => t.status === "done").length;
    const inProgress = allTasks.filter((t) => t.status === "in_progress").length;
    const failed = allTasks.filter((t) => t.status === "failed").length;

    return {
      teamId,
      goal: team.goal,
      totalTasks: allTasks.length,
      completedTasks: completed,
      inProgressTasks: inProgress,
      failedTasks: failed,
      percentComplete: allTasks.length > 0 ? Math.round((completed / allTasks.length) * 100) : 0,
      agentStatuses: Object.fromEntries(
        Array.from(team.agents.entries()).map(([id, a]) => [id, a.status])
      ),
      recentMessages: team.messages.slice(-10),
      conflicts: team.conflicts,
      startedAt: team.startedAt,
    };
  }

  getSharedContext(teamId: string): SharedContext | null {
    return this.teams.get(teamId)?.sharedContext ?? null;
  }
}

// ─── Singleton ─────────────────────────────────────────────────────────────────

let _instance: AgentTeamCoordinator | null = null;

export function getAgentTeamCoordinator(): AgentTeamCoordinator {
  if (!_instance) _instance = new AgentTeamCoordinator();
  return _instance;
}
