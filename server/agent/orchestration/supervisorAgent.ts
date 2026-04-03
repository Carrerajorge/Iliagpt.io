import { z } from "zod";
import OpenAI from "openai";
import crypto from "crypto";
import {
  BaseAgent,
  BaseAgentConfig,
  AgentTask,
  AgentResult,
  AgentCapability,
  AGENT_REGISTRY,
  AgentState
} from "../langgraph/agents/types";
import { toolRegistry, ToolExecutionResult } from "../registry/toolRegistry";
import { activityStreamPublisher } from "./activityStream";
import { agentEventBus } from "../eventBus";

function createLlmClient(): OpenAI {
  const apiKey = process.env.OPENROUTER_API_KEY || process.env.XAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "[SupervisorAgent] OPENROUTER_API_KEY or XAI_API_KEY environment variable is required but not set."
    );
  }
  const baseURL = process.env.OPENROUTER_API_KEY
    ? "https://openrouter.ai/api/v1"
    : (process.env.XAI_BASE_URL || "https://api.x.ai/v1");
  return new OpenAI({ baseURL, apiKey });
}

let xaiClient: OpenAI | null = null;

function getXaiClient(): OpenAI {
  if (!xaiClient) {
    xaiClient = createLlmClient();
  }
  return xaiClient;
}

const DEFAULT_MODEL = process.env.OPENROUTER_API_KEY
  ? "openai/gpt-oss-120b:free"
  : "grok-4-1-fast-non-reasoning";

export const PlanStepSchema = z.object({
  id: z.string(),
  agent: z.string(),
  action: z.string(),
  tool: z.string().optional(),
  input: z.record(z.any()),
  dependencies: z.array(z.string()),
  priority: z.enum(["high", "medium", "low"]),
  expectedOutput: z.string(),
});
export type PlanStep = z.infer<typeof PlanStepSchema>;

export const ExecutionPlanSchema = z.object({
  id: z.string(),
  objective: z.string(),
  analysis: z.string(),
  steps: z.array(PlanStepSchema),
  parallelGroups: z.array(z.array(z.string())),
  estimatedDuration: z.string(),
  fallbackStrategy: z.string(),
});
export type ExecutionPlan = z.infer<typeof ExecutionPlanSchema>;

export const StepResultSchema = z.object({
  stepId: z.string(),
  agent: z.string(),
  success: z.boolean(),
  output: z.any().optional(),
  error: z.string().optional(),
  durationMs: z.number(),
  retryCount: z.number().default(0),
  artifacts: z.array(z.string()).default([]),
});
export type StepResult = z.infer<typeof StepResultSchema>;

export const ExecutionContextSchema = z.object({
  runId: z.string(),
  parentRunId: z.string().optional(),
  userId: z.string().optional(),
  chatId: z.string().optional(),
  previousResults: z.record(z.any()),
  sharedMemory: z.record(z.any()),
  maxRetries: z.number().default(3),
  timeoutMs: z.number().default(300000),
});
export type ExecutionContext = z.infer<typeof ExecutionContextSchema>;

export const AggregatedOutputSchema = z.object({
  success: z.boolean(),
  summary: z.string(),
  stepResults: z.array(StepResultSchema),
  artifacts: z.array(z.string()),
  metrics: z.object({
    totalSteps: z.number(),
    completedSteps: z.number(),
    failedSteps: z.number(),
    skippedSteps: z.number(),
    totalDurationMs: z.number(),
    replans: z.number(),
  }),
  replanEvents: z.array(z.string()),
});
export type AggregatedOutput = z.infer<typeof AggregatedOutputSchema>;

export const AgentSelectionSchema = z.object({
  name: z.string(),
  role: z.string().optional(),
  reason: z.string(),
  priority: z.enum(["high", "medium", "low"]).default("medium"),
});
export type AgentSelection = z.infer<typeof AgentSelectionSchema>;

export const AnalysisResultSchema = z.object({
  query: z.string(),
  intent: z.string(),
  complexity: z.enum(["simple", "moderate", "complex"]),
  entities: z.array(z.string()).optional(),
  context: z.record(z.any()).optional(),
});
export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;

export const RouteDecisionSchema = z.object({
  selectedAgents: z.array(AgentSelectionSchema),
  suggestedTools: z.array(z.string()),
  executionMode: z.enum(["sequential", "parallel", "hybrid"]),
  estimatedComplexity: z.number().min(1).max(10),
});
export type RouteDecision = z.infer<typeof RouteDecisionSchema>;

export const OrchestrationResultSchema = z.object({
  runId: z.string(),
  success: z.boolean(),
  plan: ExecutionPlanSchema,
  aggregatedOutput: AggregatedOutputSchema,
  durationMs: z.number(),
});
export type OrchestrationResult = z.infer<typeof OrchestrationResultSchema>;

interface WorkerAdapter {
  name: string;
  agent: BaseAgent;
  invoke: (task: AgentTask) => Promise<AgentResult>;
}

export class SupervisorAgent extends BaseAgent {
  private workerAdapters: Map<string, WorkerAdapter> = new Map();
  private activeExecutions: Map<string, ExecutionContext> = new Map();
  private replanEvents: Map<string, string[]> = new Map();

  constructor() {
    const config: BaseAgentConfig = {
      name: "SupervisorAgent",
      description: "LangGraph-style central orchestrator that coordinates specialized worker agents using the supervisor pattern. Creates execution plans, delegates tasks, and aggregates results.",
      model: DEFAULT_MODEL,
      temperature: 0.2,
      maxTokens: 8192,
      systemPrompt: `You are the SupervisorAgent - the central orchestrator in a multi-agent system following the LangGraph supervisor pattern.

Your responsibilities:
1. Create detailed execution plans with parallelizable step groups
2. Route tasks to the most appropriate specialized worker agents
3. Coordinate multi-agent workflows with dependency management
4. Aggregate results from worker agents into coherent outputs
5. Handle failures with retry strategies and graceful degradation
6. Track progress and emit real-time events for UI updates

Available worker agents:
- ResearchAssistantAgent: Web research, information gathering, fact-checking
- CodeAgent: Code generation, review, refactoring, debugging
- DataAnalystAgent: Data analysis, transformation, visualization
- ContentAgent: Content creation, document generation
- CommunicationAgent: Email, notifications, messaging
- BrowserAgent: Autonomous web navigation and interaction
- DocumentAgent: Document processing and manipulation
- QAAgent: Testing, validation, quality assurance
- SecurityAgent: Security audits, encryption, compliance

When creating plans:
- Identify tasks that can run in parallel for efficiency
- Set clear dependencies between steps
- Assign priority levels based on criticality
- Define expected outputs for verification
- Include fallback strategies for error recovery

Use the Command pattern: each step is a command that can be executed, retried, or rolled back.`,
      tools: ["delegate", "plan", "aggregate", "route", "replan"],
      timeout: 600000,
      maxIterations: 100,
    };
    super(config);
    this.initializeWorkerAdapters();
  }

  private initializeWorkerAdapters(): void {
    for (const [name, agent] of AGENT_REGISTRY) {
      if (name !== "SupervisorAgent" && name !== "OrchestratorAgent") {
        const adapter: WorkerAdapter = {
          name,
          agent,
          invoke: async (task: AgentTask) => {
            return await agent.execute(task);
          },
        };
        this.workerAdapters.set(name, adapter);
      }
    }
    console.log(`[SupervisorAgent] Initialized ${this.workerAdapters.size} worker adapters`);
  }

  async execute(task: AgentTask): Promise<AgentResult> {
    const startTime = Date.now();
    const runId = crypto.randomUUID();

    this.updateState({
      status: "running",
      currentTask: task.description,
      startedAt: new Date().toISOString()
    });

    try {
      const analysis: AnalysisResult = {
        query: task.description,
        intent: task.type,
        complexity: this.estimateComplexity(task.description),
        context: task.input,
      };

      const route = await this.analyzeAndRoute(analysis);
      const result = await this.orchestrate(analysis, route);

      this.updateState({
        status: "completed",
        progress: 100,
        completedAt: new Date().toISOString()
      });

      return {
        taskId: task.id,
        agentId: this.state.id,
        success: result.success,
        output: result.aggregatedOutput,
        duration: Date.now() - startTime,
      };
    } catch (error: any) {
      this.updateState({ status: "failed", error: error.message });
      return {
        taskId: task.id,
        agentId: this.state.id,
        success: false,
        error: error.message,
        duration: Date.now() - startTime,
      };
    }
  }

  private estimateComplexity(query: string): "simple" | "moderate" | "complex" {
    const wordCount = query.split(/\s+/).length;
    const hasMultipleTasks = /and|then|after|also|additionally|furthermore/i.test(query);
    const hasComplexKeywords = /integrate|coordinate|orchestrate|analyze.*and.*generate|multi-step/i.test(query);

    if (wordCount > 50 || hasComplexKeywords || (hasMultipleTasks && wordCount > 30)) {
      return "complex";
    }
    if (wordCount > 20 || hasMultipleTasks) {
      return "moderate";
    }
    return "simple";
  }

  private async analyzeAndRoute(analysis: AnalysisResult): Promise<RouteDecision> {
    const response = await getXaiClient().chat.completions.create({
      model: this.config.model,
      messages: [
        {
          role: "system",
          content: `You are a routing specialist. Analyze the query and determine which agents should handle it.
Available agents: ${Array.from(this.workerAdapters.keys()).join(", ")}

Return a JSON object with:
{
  "selectedAgents": [{ "name": "AgentName", "role": "what they do", "reason": "why selected", "priority": "high|medium|low" }],
  "suggestedTools": ["tool1", "tool2"],
  "executionMode": "sequential|parallel|hybrid",
  "estimatedComplexity": 1-10
}`
        },
        { role: "user", content: `Query: ${analysis.query}\nIntent: ${analysis.intent}\nComplexity: ${analysis.complexity}` },
      ],
      temperature: 0.1,
    });

    const content = response.choices[0].message.content || "{}";
    const jsonMatch = content.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        return RouteDecisionSchema.parse(parsed);
      } catch { }
    }

    return {
      selectedAgents: [{ name: "ContentAgent", reason: "Default fallback", priority: "medium" }],
      suggestedTools: [],
      executionMode: "sequential",
      estimatedComplexity: 5,
    };
  }

  async orchestrate(analysis: AnalysisResult, route: RouteDecision): Promise<OrchestrationResult> {
    const providedRunId = (analysis as any)?.context?.runId;
    const runId =
      typeof providedRunId === "string" && providedRunId.trim()
        ? providedRunId.trim()
        : crypto.randomUUID();
    const startTime = Date.now();

    activityStreamPublisher.publishRunCreated(runId, {
      status: "running",
      message: `Orchestrating: ${analysis.query}`,
    });

    await agentEventBus.emit(runId, "task_start", {
      summary: `SupervisorAgent orchestrating: ${analysis.query}`,
      metadata: { intent: analysis.intent, complexity: analysis.complexity },
    });

    const plan = await this.createPlan(analysis.query, route.selectedAgents);

    activityStreamPublisher.publishPlanGenerated(runId, {
      objective: plan.objective,
      totalSteps: plan.steps.length,
      steps: plan.steps.map((s, i) => ({
        index: i,
        toolName: s.tool || s.agent,
        description: s.action,
      })),
    });

    await agentEventBus.emit(runId, "plan_created", {
      plan: {
        objective: plan.objective,
        steps: plan.steps.map((s, i) => ({
          index: i,
          toolName: s.tool || s.agent,
          description: s.action,
        })),
      },
    });

    const contextUserId =
      typeof (analysis as any)?.context?.userId === "string" ? String((analysis as any).context.userId).trim() : undefined;
    const contextChatId =
      typeof (analysis as any)?.context?.chatId === "string" ? String((analysis as any).context.chatId).trim() : undefined;

    const context: ExecutionContext = {
      runId,
      userId: contextUserId || undefined,
      chatId: contextChatId || undefined,
      previousResults: {},
      sharedMemory: {},
      maxRetries: 3,
      timeoutMs: this.config.timeout,
    };
    this.activeExecutions.set(runId, context);
    this.replanEvents.set(runId, []);

    const stepResults: StepResult[] = [];
    const completedSteps = new Set<string>();

    try {
      for (const group of plan.parallelGroups) {
        const groupSteps = plan.steps.filter(s => group.includes(s.id));

        const groupPromises = groupSteps.map(async (step) => {
          const canExecute = step.dependencies.every(d => completedSteps.has(d));
          if (!canExecute) {
            return {
              stepId: step.id,
              agent: step.agent,
              success: false,
              error: "Dependencies not met",
              durationMs: 0,
              retryCount: 0,
              artifacts: [],
            } as StepResult;
          }

          const result = await this.executeStep(step, context);
          if (result.success) {
            completedSteps.add(step.id);
            context.previousResults[step.id] = result.output;
          }
          return result;
        });

        const groupResults = await Promise.all(groupPromises);
        stepResults.push(...groupResults);

        const progress = Math.round((completedSteps.size / plan.steps.length) * 100);
        this.updateState({ progress });
      }

      const aggregatedOutput = await this.aggregateResults(stepResults);

      const success = aggregatedOutput.metrics.failedSteps === 0;

      if (success) {
        activityStreamPublisher.publishRunCompleted(runId, {
          status: "completed",
          summary: aggregatedOutput.summary,
          durationMs: Date.now() - startTime,
          completedSteps: aggregatedOutput.metrics.completedSteps,
          totalSteps: aggregatedOutput.metrics.totalSteps,
          artifactsCount: aggregatedOutput.artifacts.length,
        });
      } else {
        activityStreamPublisher.publishRunFailed(runId, {
          status: "failed",
          error: `${aggregatedOutput.metrics.failedSteps} steps failed`,
          message: aggregatedOutput.summary,
        });
      }

      await agentEventBus.emit(runId, success ? "done" : "error", {
        summary: aggregatedOutput.summary,
        metadata: {
          durationMs: Date.now() - startTime,
          completedSteps: aggregatedOutput.metrics.completedSteps,
          totalSteps: aggregatedOutput.metrics.totalSteps,
        },
      });

      this.activeExecutions.delete(runId);
      this.replanEvents.delete(runId);

      return {
        runId,
        success,
        plan,
        aggregatedOutput,
        durationMs: Date.now() - startTime,
      };
    } catch (error: any) {
      activityStreamPublisher.publishRunFailed(runId, {
        status: "failed",
        error: error.message,
      });
      throw error;
    }
  }

  async createPlan(objective: string, agents: AgentSelection[]): Promise<ExecutionPlan> {
    const planId = crypto.randomUUID();

    const response = await getXaiClient().chat.completions.create({
      model: this.config.model,
      messages: [
        {
          role: "system",
          content: `You are a planning specialist. Create a detailed execution plan with parallelizable steps.

Return a JSON plan with this exact structure:
{
  "analysis": "Brief analysis of the objective",
  "steps": [
    {
      "id": "step_1",
      "agent": "AgentName",
      "action": "What to do",
      "tool": "optional_tool_name",
      "input": {},
      "dependencies": [],
      "priority": "high|medium|low",
      "expectedOutput": "What this step produces"
    }
  ],
  "parallelGroups": [["step_1", "step_2"], ["step_3"]],
  "estimatedDuration": "time estimate",
  "fallbackStrategy": "what to do if steps fail"
}

Group steps that can run in parallel. Steps in the same group run concurrently.
Steps in later groups wait for earlier groups to complete.`
        },
        {
          role: "user",
          content: `Objective: ${objective}\n\nAssigned Agents:\n${agents.map(a => `- ${a.name}: ${a.reason}`).join("\n")}`
        },
      ],
      temperature: this.config.temperature,
    });

    const content = response.choices[0].message.content || "{}";
    const jsonMatch = content.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          id: planId,
          objective,
          analysis: parsed.analysis || "Direct execution",
          steps: (parsed.steps || []).map((s: any, i: number) => ({
            id: s.id || `step_${i + 1}`,
            agent: s.agent || agents[0]?.name || "ContentAgent",
            action: s.action || objective,
            tool: s.tool,
            input: s.input || {},
            dependencies: s.dependencies || [],
            priority: s.priority || "medium",
            expectedOutput: s.expectedOutput || "Task output",
          })),
          parallelGroups: parsed.parallelGroups || [parsed.steps?.map((s: any, i: number) => s.id || `step_${i + 1}`) || ["step_1"]],
          estimatedDuration: parsed.estimatedDuration || "unknown",
          fallbackStrategy: parsed.fallbackStrategy || "retry with alternative approach",
        };
      } catch (e) {
        console.error("[SupervisorAgent] Failed to parse plan:", e);
      }
    }

    const defaultStepId = "step_1";
    return {
      id: planId,
      objective,
      analysis: "Direct execution - single step plan",
      steps: [{
        id: defaultStepId,
        agent: agents[0]?.name || "ContentAgent",
        action: objective,
        input: {},
        dependencies: [],
        priority: "high",
        expectedOutput: "Task completion",
      }],
      parallelGroups: [[defaultStepId]],
      estimatedDuration: "unknown",
      fallbackStrategy: "retry with alternative approach",
    };
  }

  async executeStep(step: PlanStep, context: ExecutionContext): Promise<StepResult> {
    const startTime = Date.now();
    let retryCount = 0;
    const maxRetries = context.maxRetries;

    activityStreamPublisher.publishToolCallStarted(context.runId, {
      toolName: step.tool || step.agent,
      toolCallId: step.id,
      inputPreview: JSON.stringify(step.input).slice(0, 200),
      status: "started",
      stepIndex: parseInt(step.id.replace("step_", "")) || 0,
    });

    await agentEventBus.emit(context.runId, "tool_call_started", {
      stepId: step.id,
      tool_name: step.tool || step.agent,
      tool_input: step.input,
      stepIndex: parseInt(step.id.replace("step_", "")) || 0,
    });

    while (retryCount <= maxRetries) {
      try {
        let result: any;

        if (step.tool && toolRegistry.has(step.tool)) {
          const toolResult = await toolRegistry.execute(
            step.tool,
            {
              ...step.input,
              previousResults: context.previousResults,
            },
            {
              context: {
                userId: context.userId,
                chatId: context.chatId,
                runId: context.runId,
                providerId: "agentic_engine",
              },
            }
          );
          result = toolResult.success ? toolResult.data : { error: toolResult.error };
        } else {
          result = await this.delegateToAgent(step.agent, {
            id: step.id,
            type: step.action,
            description: step.action,
            input: {
              ...step.input,
              previousResults: context.previousResults,
              sharedMemory: context.sharedMemory,
            },
            priority: step.priority,
            retries: 0,
            maxRetries: 3,
          });
        }

        const durationMs = Date.now() - startTime;
        const success = result.success !== false && !result.error;

        if (success) {
          activityStreamPublisher.publishToolCallSucceeded(context.runId, {
            toolName: step.tool || step.agent,
            toolCallId: step.id,
            status: "succeeded",
            outputPreview: JSON.stringify(result.output || result).slice(0, 200),
            durationMs,
            stepIndex: parseInt(step.id.replace("step_", "")) || 0,
          });

          await agentEventBus.emit(context.runId, "tool_call_succeeded", {
            stepId: step.id,
            tool_name: step.tool || step.agent,
            output_snippet: JSON.stringify(result.output || result).slice(0, 500),
            metadata: { durationMs },
            stepIndex: parseInt(step.id.replace("step_", "")) || 0,
          });

          return {
            stepId: step.id,
            agent: step.agent,
            success: true,
            output: result.output || result,
            durationMs,
            retryCount,
            artifacts: result.artifacts || [],
          };
        }

        throw new Error(result.error || "Step execution failed");
      } catch (error: any) {
        retryCount++;

        if (retryCount <= maxRetries) {
          const replanEvent = `Step ${step.id} failed (attempt ${retryCount}/${maxRetries}): ${error.message}. Retrying...`;
          this.replanEvents.get(context.runId)?.push(replanEvent);

          activityStreamPublisher.publishToolCallFailed(context.runId, {
            toolName: step.tool || step.agent,
            toolCallId: step.id,
            status: "retrying",
            error: error.message,
            willRetry: true,
            retryCount,
            stepIndex: parseInt(step.id.replace("step_", "")) || 0,
          });

          await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
          continue;
        }

        const durationMs = Date.now() - startTime;

        activityStreamPublisher.publishToolCallFailed(context.runId, {
          toolName: step.tool || step.agent,
          toolCallId: step.id,
          status: "failed",
          error: error.message,
          willRetry: false,
          retryCount,
          durationMs,
          stepIndex: parseInt(step.id.replace("step_", "")) || 0,
        });

        await agentEventBus.emit(context.runId, "tool_call_failed", {
          stepId: step.id,
          tool_name: step.tool || step.agent,
          error: { message: error.message, retryable: false },
          metadata: { durationMs, retryCount },
          stepIndex: parseInt(step.id.replace("step_", "")) || 0,
        });

        return {
          stepId: step.id,
          agent: step.agent,
          success: false,
          error: error.message,
          durationMs,
          retryCount,
          artifacts: [],
        };
      }
    }

    return {
      stepId: step.id,
      agent: step.agent,
      success: false,
      error: "Max retries exceeded",
      durationMs: Date.now() - startTime,
      retryCount,
      artifacts: [],
    };
  }

  async delegateToAgent(agentName: string, task: AgentTask): Promise<AgentResult> {
    const adapter = this.workerAdapters.get(agentName);

    if (!adapter) {
      const fallbackAdapter = this.workerAdapters.get("ContentAgent");
      if (fallbackAdapter) {
        console.warn(`[SupervisorAgent] Agent "${agentName}" not found, using ContentAgent as fallback`);
        return await fallbackAdapter.invoke(task);
      }

      return {
        taskId: task.id,
        agentId: "unknown",
        success: false,
        error: `Agent "${agentName}" not found and no fallback available`,
        duration: 0,
      };
    }

    activityStreamPublisher.publishAgentDelegated(task.id, {
      agentName,
      agentRole: adapter.agent.getDescription(),
      taskDescription: task.description,
      status: "started",
    });

    try {
      const result = await adapter.invoke(task);

      activityStreamPublisher.publishAgentDelegated(task.id, {
        agentName,
        status: result.success ? "completed" : "failed",
      });

      return result;
    } catch (error: any) {
      activityStreamPublisher.publishAgentDelegated(task.id, {
        agentName,
        status: "failed",
      });

      return {
        taskId: task.id,
        agentId: adapter.agent.getState().id,
        success: false,
        error: error.message,
        duration: 0,
      };
    }
  }

  async aggregateResults(results: StepResult[]): Promise<AggregatedOutput> {
    const successfulResults = results.filter(r => r.success);
    const failedResults = results.filter(r => !r.success);
    const allArtifacts = results.flatMap(r => r.artifacts || []);
    const totalDurationMs = results.reduce((sum, r) => sum + r.durationMs, 0);
    const totalReplans = Array.from(this.replanEvents.values()).flat().length;

    let summary: string;

    if (results.length === 0) {
      summary = "No steps were executed.";
    } else if (failedResults.length === 0) {
      summary = await this.generateSummary(successfulResults);
    } else if (successfulResults.length === 0) {
      summary = `All ${failedResults.length} steps failed. Errors: ${failedResults.map(r => r.error).join("; ")}`;
    } else {
      const partialSummary = await this.generateSummary(successfulResults);
      summary = `Partial completion: ${partialSummary}. ${failedResults.length} step(s) failed.`;
    }

    return {
      success: failedResults.length === 0,
      summary,
      stepResults: results,
      artifacts: allArtifacts,
      metrics: {
        totalSteps: results.length,
        completedSteps: successfulResults.length,
        failedSteps: failedResults.length,
        skippedSteps: 0,
        totalDurationMs,
        replans: totalReplans,
      },
      replanEvents: Array.from(this.replanEvents.values()).flat(),
    };
  }

  private async generateSummary(results: StepResult[]): Promise<string> {
    if (results.length === 0) {
      return "No results to summarize.";
    }

    if (results.length === 1) {
      const output = results[0].output;
      if (typeof output === "string") {
        return output.slice(0, 500);
      }
      return `Step ${results[0].stepId} completed successfully.`;
    }

    try {
      const response = await getXaiClient().chat.completions.create({
        model: this.config.model,
        messages: [
          {
            role: "system",
            content: "Summarize the results from multiple agent executions into a coherent, concise summary (2-3 sentences).",
          },
          {
            role: "user",
            content: `Summarize these results:\n${results.map(r => `- ${r.stepId} (${r.agent}): ${JSON.stringify(r.output).slice(0, 200)}`).join("\n")}`,
          },
        ],
        temperature: 0.2,
        max_tokens: 300,
      });

      return response.choices[0].message.content || "Results aggregated successfully.";
    } catch {
      return `${results.length} steps completed successfully.`;
    }
  }

  getCapabilities(): AgentCapability[] {
    return [
      {
        name: "orchestrate",
        description: "Orchestrate multi-agent workflows with parallel execution support",
        inputSchema: z.object({
          analysis: AnalysisResultSchema,
          route: RouteDecisionSchema,
        }),
        outputSchema: OrchestrationResultSchema,
      },
      {
        name: "create_plan",
        description: "Create detailed execution plans with dependency management",
        inputSchema: z.object({
          objective: z.string(),
          agents: z.array(AgentSelectionSchema),
        }),
        outputSchema: ExecutionPlanSchema,
      },
      {
        name: "delegate_task",
        description: "Delegate a task to a specialized worker agent",
        inputSchema: z.object({
          agentName: z.string(),
          task: z.object({
            id: z.string(),
            type: z.string(),
            description: z.string(),
            input: z.record(z.any()),
            priority: z.enum(["low", "medium", "high", "critical"]),
          }),
        }),
        outputSchema: z.object({
          taskId: z.string(),
          agentId: z.string(),
          success: z.boolean(),
          output: z.any().optional(),
          error: z.string().optional(),
          duration: z.number(),
        }),
      },
      {
        name: "aggregate_results",
        description: "Aggregate results from multiple step executions",
        inputSchema: z.object({
          results: z.array(StepResultSchema),
        }),
        outputSchema: AggregatedOutputSchema,
      },
    ];
  }

  getWorkerAdapters(): Map<string, WorkerAdapter> {
    return new Map(this.workerAdapters);
  }

  getActiveExecutions(): Map<string, ExecutionContext> {
    return new Map(this.activeExecutions);
  }

  refreshWorkerAdapters(): void {
    this.workerAdapters.clear();
    this.initializeWorkerAdapters();
  }
}

export const supervisorAgent = new SupervisorAgent();
