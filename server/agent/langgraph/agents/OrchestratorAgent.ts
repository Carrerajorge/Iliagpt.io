import { z } from "zod";
import OpenAI from "openai";
import { BaseAgent, BaseAgentConfig, AgentTask, AgentResult, AgentCapability, AGENT_REGISTRY } from "./types";

const xaiClient = new OpenAI({
  baseURL: "https://api.x.ai/v1",
  apiKey: process.env.XAI_API_KEY || "missing",
});

const DEFAULT_MODEL = "grok-4-1-fast-non-reasoning";

export class OrchestratorAgent extends BaseAgent {
  constructor() {
    const config: BaseAgentConfig = {
      name: "OrchestratorAgent",
      description: "Super agent that coordinates and delegates tasks to specialized agents. Analyzes requests, creates execution plans, and orchestrates multi-agent workflows.",
      model: DEFAULT_MODEL,
      temperature: 0.3,
      maxTokens: 4096,
      systemPrompt: `You are the OrchestratorAgent - a super-intelligent coordinator for a multi-agent system.

Your responsibilities:
1. Analyze complex user requests and break them into subtasks
2. Route tasks to the most appropriate specialized agents
3. Coordinate multi-agent workflows and handle dependencies
4. Aggregate results from multiple agents
5. Handle errors and implement retry strategies
6. Optimize execution order for efficiency

Available specialized agents:
- ResearchAssistantAgent: Web research, information gathering, fact-checking
- CodeAgent: Code generation, review, refactoring, debugging
- DataAnalystAgent: Data analysis, transformation, visualization
- ContentAgent: Content creation, document generation
- CommunicationAgent: Email, notifications, messaging
- BrowserAgent: Autonomous web navigation and interaction
- DocumentAgent: Document processing and manipulation
- QAAgent: Testing, validation, quality assurance
- SecurityAgent: Security audits, encryption, compliance

You also have access to the \`physical_desktop_control\` tool line (via the Mac/Windows bridges) to physically control the host OS if the user explicitly asks for system-level GUI interaction (mouse, typing, screenshots).

When delegating tasks, provide clear instructions and context. Monitor progress and handle failures gracefully.`,
      tools: ["plan", "orchestrate", "decide", "reflect"],
      timeout: 300000,
      maxIterations: 50,
    };
    super(config);
  }

  async execute(task: AgentTask): Promise<AgentResult> {
    const startTime = Date.now();
    this.updateState({ status: "running", currentTask: task.description, startedAt: new Date().toISOString() });

    try {
      const plan = await this.createPlan(task);
      const results = await this.executePlan(plan);
      const aggregatedResult = await this.aggregateResults(results);

      this.updateState({ status: "completed", progress: 100, completedAt: new Date().toISOString() });

      return {
        taskId: task.id,
        agentId: this.state.id,
        success: true,
        output: aggregatedResult,
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

  private async createPlan(task: AgentTask): Promise<ExecutionPlan> {
    const response = await xaiClient.chat.completions.create({
      model: this.config.model,
      messages: [
        { role: "system", content: this.config.systemPrompt },
        {
          role: "user",
          content: `Create an execution plan for this task:
${JSON.stringify(task, null, 2)}

Return a JSON plan with:
{
  "analysis": "Brief analysis of the request",
  "steps": [
    {
      "id": "step_1",
      "agent": "AgentName",
      "action": "what to do",
      "input": {},
      "dependencies": [],
      "priority": "high|medium|low"
    }
  ],
  "parallelGroups": [["step_1", "step_2"], ["step_3"]],
  "estimatedDuration": "time estimate",
  "fallbackStrategy": "what to do if steps fail"
}`,
        },
      ],
      temperature: this.config.temperature,
    });

    const content = response.choices[0].message.content || "{}";
    const jsonMatch = content.match(/\{[\s\S]*\}/);

    console.log("[OrchestratorAgent] Raw LLM Plan Content: ", content);

    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as ExecutionPlan;
      console.log("[OrchestratorAgent] Parsed Plan: ", JSON.stringify(parsed, null, 2));
      return parsed;
    }

    console.warn("[OrchestratorAgent] Failed to parse JSON plan, falling back to direct execution.");
    return {
      analysis: "Direct execution",
      steps: [{
        id: "step_1",
        agent: "OrchestratorAgent",
        action: task.description,
        input: task.input,
        dependencies: [],
        priority: "high",
      }],
      parallelGroups: [["step_1"]],
      estimatedDuration: "unknown",
      fallbackStrategy: "retry with alternative approach",
    };
  }

  private async executePlan(plan: ExecutionPlan): Promise<StepResult[]> {
    const results: StepResult[] = [];
    const completedSteps = new Set<string>();
    const failedSteps = new Set<string>();

    // Safeguard: If the LLM generates steps but fails to put them into parallelGroups, 
    // we create a sequential group structure automatically.
    let groupsToExecute = plan.parallelGroups;
    if (!groupsToExecute || groupsToExecute.length === 0) {
      groupsToExecute = plan.steps.map(s => [s.id]);
    }

    for (const group of groupsToExecute) {
      const groupSteps = plan.steps.filter(s => group.includes(s.id));

      const groupPromises = groupSteps.map(async (step) => {
        // Check that all dependencies completed successfully (not just completed)
        const unmetDeps = step.dependencies.filter(d => !completedSteps.has(d));
        const failedDeps = step.dependencies.filter(d => failedSteps.has(d));
        if (unmetDeps.length > 0 || failedDeps.length > 0) {
          failedSteps.add(step.id);
          return { stepId: step.id, success: false, error: failedDeps.length > 0 ? "Upstream dependency failed" : "Dependencies not met" };
        }

        // Prevent infinite recursion: never delegate to OrchestratorAgent itself
        if (step.agent === "OrchestratorAgent") {
          const directResult = await this.executeDirectly(step);
          if (directResult.success) {
            completedSteps.add(step.id);
          } else {
            failedSteps.add(step.id);
          }
          return directResult;
        }

        const agent = AGENT_REGISTRY.get(step.agent);
        if (agent) {
          // NEW: Inject output from dependencies into the step input so downstream agents have context
          const dependencyOutputs: any[] = [];
          for (const depId of step.dependencies) {
            const depResult = results.find(r => r.stepId === depId);
            if (depResult && depResult.success) {
              dependencyOutputs.push({
                sourceStep: depId,
                output: depResult.output
              });
            }
          }

          const enhancedInput = {
            ...step.input,
            _upstream_context: dependencyOutputs.length > 0 ? JSON.stringify(dependencyOutputs, null, 2) : undefined
          };

          const result = await agent.execute({
            id: step.id,
            type: step.action,
            description: `${step.action}\n\n[CONTEXT FROM PREVIOUS STEPS]:\n${enhancedInput._upstream_context || 'None'}`,
            input: enhancedInput,
            priority: step.priority as any,
            retries: 0,
            maxRetries: 3,
          });

          // NEW: Critic Verification Loop
          let finalSuccess = result.success;
          let finalOutput = result.output;
          let finalError = result.error;

          if (result.success && step.agent !== "CriticAgent" && step.agent !== "OrchestratorAgent") {
            const critic = AGENT_REGISTRY.get("CriticAgent");
            if (critic) {
              const criticResult = await critic.execute({
                id: `verify_${step.id}`,
                type: "verify_output",
                description: `Verify output of ${step.agent}`,
                input: {
                  originalPrompt: step.action,
                  workerOutput: result.output,
                  workerType: step.agent
                },
                priority: "high",
                retries: 0,
                maxRetries: 1,
              });

              if (criticResult.success && criticResult.output?.verdict === "FAIL") {
                // The critic failed the output.
                finalSuccess = false;
                finalError = `Critic Verification Failed: ${criticResult.output.critique} | Fix instructions: ${criticResult.output.feedback_for_worker}`;
              }
            }
          }

          // Only mark as completed if actually successful AND passed critic
          if (finalSuccess) {
            completedSteps.add(step.id);
          } else {
            failedSteps.add(step.id);
          }
          return { stepId: step.id, success: finalSuccess, output: finalOutput, error: finalError };
        }

        const directResult = await this.executeDirectly(step);
        if (directResult.success) {
          completedSteps.add(step.id);
        } else {
          failedSteps.add(step.id);
        }
        return directResult;
      });

      const groupResults = await Promise.all(groupPromises);
      results.push(...groupResults);

      this.updateState({ progress: Math.round((completedSteps.size / plan.steps.length) * 100) });
    }

    return results;
  }

  private async executeDirectly(step: PlanStep): Promise<StepResult> {
    const response = await xaiClient.chat.completions.create({
      model: this.config.model,
      messages: [
        { role: "system", content: "Execute this task directly and provide a detailed result." },
        { role: "user", content: `Task: ${step.action}\nInput: ${JSON.stringify(step.input)}` },
      ],
      temperature: 0.2,
    });

    return {
      stepId: step.id,
      success: true,
      output: response.choices[0].message.content,
    };
  }

  private async aggregateResults(results: StepResult[]): Promise<any> {
    const successfulResults = results.filter(r => r.success);
    const failedResults = results.filter(r => !r.success);

    if (failedResults.length > 0 && successfulResults.length === 0) {
      throw new Error(`All steps failed: ${failedResults.map(r => r.error).join(", ")}`);
    }

    const response = await xaiClient.chat.completions.create({
      model: this.config.model,
      messages: [
        {
          role: "system",
          content: "Aggregate and synthesize the results from multiple agent executions into a coherent final output.",
        },
        {
          role: "user",
          content: `Aggregate these results:
${JSON.stringify(results, null, 2)}

Provide a unified response that combines all successful outputs.`,
        },
      ],
      temperature: 0.2,
    });

    return {
      aggregatedOutput: response.choices[0].message.content,
      stepResults: results,
      summary: {
        total: results.length,
        successful: successfulResults.length,
        failed: failedResults.length,
      },
    };
  }

  getCapabilities(): AgentCapability[] {
    return [
      {
        name: "plan_execution",
        description: "Create and execute multi-step plans",
        inputSchema: z.object({ task: z.string(), context: z.record(z.any()).optional() }),
        outputSchema: z.object({ plan: z.any(), results: z.array(z.any()) }),
      },
      {
        name: "delegate_task",
        description: "Delegate tasks to specialized agents",
        inputSchema: z.object({ agent: z.string(), task: z.any() }),
        outputSchema: z.object({ result: z.any() }),
      },
      {
        name: "coordinate_workflow",
        description: "Coordinate complex multi-agent workflows",
        inputSchema: z.object({ workflow: z.any() }),
        outputSchema: z.object({ results: z.array(z.any()) }),
      },
    ];
  }
}

interface PlanStep {
  id: string;
  agent: string;
  action: string;
  input: Record<string, any>;
  dependencies: string[];
  priority: string;
}

interface ExecutionPlan {
  analysis: string;
  steps: PlanStep[];
  parallelGroups: string[][];
  estimatedDuration: string;
  fallbackStrategy: string;
}

interface StepResult {
  stepId: string;
  success: boolean;
  output?: any;
  error?: string;
}

export const orchestratorAgent = new OrchestratorAgent();
