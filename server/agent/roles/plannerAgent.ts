import { z } from "zod";
import { randomUUID } from "crypto";
import {
  AgentPlan,
  AgentPlanSchema,
  PlanStep,
  PlanStepSchema,
  ToolCapability,
} from "../contracts";
import { toolRegistry } from "../toolRegistry";
import { policyEngine } from "../policyEngine";
import { eventLogger, logRunEvent } from "../eventLogger";
import { openai } from "../../lib/openai";

export const PlanningContextSchema = z.object({
  userId: z.string(),
  userPlan: z.enum(["free", "pro", "admin"]),
  chatId: z.string(),
  runId: z.string(),
  correlationId: z.string(),
  conversationHistory: z.array(z.object({
    role: z.enum(["user", "assistant", "system"]),
    content: z.string(),
  })).optional(),
  availableTools: z.array(z.string()).optional(),
  maxSteps: z.number().int().positive().default(10),
  requireCitations: z.boolean().default(true),
  constraints: z.object({
    maxTimeMs: z.number().int().positive().optional(),
    allowedCapabilities: z.array(z.string()).optional(),
    blockedTools: z.array(z.string()).optional(),
  }).optional(),
});
export type PlanningContext = z.infer<typeof PlanningContextSchema>;

export const PlannerConfigSchema = z.object({
  model: z.string().default("grok-3-fast"),
  temperature: z.number().min(0).max(2).default(0.3),
  maxTokens: z.number().int().positive().default(4096),
  systemPrompt: z.string().optional(),
});
export type PlannerConfig = z.infer<typeof PlannerConfigSchema>;

const DEFAULT_SYSTEM_PROMPT = `You are an expert autonomous agent task planner. You break down complex objectives into executable steps organized by phases.

AVAILABLE TOOL CATEGORIES:
- WEB: search_web (web search), web_navigate (visit URLs), extract_content (parse HTML)
- FILES: file_operations (read/write/edit/search files), generate_file (create documents)
- CODE: generate_code (generate code/SQL/diagrams/regex), shell_execute (run commands in sandbox)
- DEVELOPMENT: webdev_scaffold (scaffold React/Vue/Next.js projects)
- PRESENTATIONS: slides_generate (create PowerPoint presentations)
- DATA: transform_data (restructure data), analyze_data (extract insights)
- RESPONSE: respond (generate final response to user)

For each step, you must specify:
1. toolName: The exact tool to use from the available tools list
2. description: Clear description of what this step accomplishes
3. input: The parameters to pass to the tool (must match tool's inputSchema)
4. expectedOutput: What result is expected from this step
5. dependencies: Array of step indices this step depends on (0-indexed)
6. optional: Whether the step can be skipped if it fails
7. phaseId: Which phase this step belongs to

PHASES:
Organize steps into logical phases to structure the work:
- research: Information gathering (search, navigate, extract)
- planning: Preparation and setup
- execution: Main work (generate code, create files, run commands)
- verification: Check and validate results
- delivery: Prepare final response and artifacts

Guidelines:
- Use the most appropriate specialized tool for each task
- For code generation, use generate_code with action: "code"
- For file operations, use file_operations with appropriate action
- For shell commands, use shell_execute (runs in sandbox)
- For presentations, use slides_generate
- For project scaffolding, use webdev_scaffold
- Always end with a respond step to deliver results to user
- Prefer parallel execution where steps have no dependencies

Return a JSON object with this structure:
{
  "objective": "the original objective",
  "phases": [
    { "id": "research", "name": "Research Phase", "description": "Gather information", "stepIndices": [0, 1] },
    { "id": "execution", "name": "Execution Phase", "description": "Generate outputs", "stepIndices": [2, 3] },
    { "id": "delivery", "name": "Delivery Phase", "description": "Final response", "stepIndices": [4] }
  ],
  "steps": [
    { "toolName": "...", "description": "...", "input": {...}, "expectedOutput": "...", "dependencies": [], "phaseId": "research" }
  ],
  "estimatedTimeMs": total estimated time,
  "reasoning": "brief explanation of the plan"
}`;

export class PlannerAgent {
  private config: PlannerConfig;

  constructor(config: Partial<PlannerConfig> = {}) {
    this.config = PlannerConfigSchema.parse({
      ...config,
      systemPrompt: config.systemPrompt || DEFAULT_SYSTEM_PROMPT,
    });
  }

  async generatePlan(
    objective: string,
    context: PlanningContext
  ): Promise<AgentPlan> {
    const startTime = Date.now();
    const validatedContext = PlanningContextSchema.parse(context);

    await logRunEvent(
      validatedContext.runId,
      validatedContext.correlationId,
      "plan_generated",
      { status: "started", objective },
      { startTime }
    );

    try {
      const availableTools = this.getAvailableTools(validatedContext);
      const toolDescriptions = this.formatToolDescriptions(availableTools);

      const userPrompt = this.buildUserPrompt(
        objective,
        toolDescriptions,
        validatedContext
      );

      const response = await openai.chat.completions.create({
        model: this.config.model,
        temperature: this.config.temperature,
        max_tokens: this.config.maxTokens,
        messages: [
          { role: "system", content: this.config.systemPrompt! },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error("No response content from LLM");
      }

      const parsedPlan = this.parsePlanResponse(content, objective);
      const validatedPlan = this.validatePlan(parsedPlan, availableTools, validatedContext);

      await logRunEvent(
        validatedContext.runId,
        validatedContext.correlationId,
        "plan_generated",
        {
          status: "completed",
          stepCount: validatedPlan.steps.length,
          estimatedTimeMs: validatedPlan.estimatedTimeMs,
        },
        { durationMs: Date.now() - startTime }
      );

      return validatedPlan;
    } catch (error: any) {
      await logRunEvent(
        validatedContext.runId,
        validatedContext.correlationId,
        "plan_generated",
        { status: "failed", error: error.message },
        { durationMs: Date.now() - startTime }
      );
      throw error;
    }
  }

  private getAvailableTools(context: PlanningContext): string[] {
    const allTools = toolRegistry.listForPlan(context.userPlan);
    let toolNames = allTools.map((t) => t.name);

    if (context.availableTools && context.availableTools.length > 0) {
      toolNames = toolNames.filter((t) => context.availableTools!.includes(t));
    }

    if (context.constraints?.blockedTools) {
      toolNames = toolNames.filter(
        (t) => !context.constraints!.blockedTools!.includes(t)
      );
    }

    return toolNames;
  }

  private formatToolDescriptions(toolNames: string[]): string {
    const descriptions: string[] = [];

    for (const name of toolNames) {
      const tool = toolRegistry.get(name);
      if (tool) {
        const policy = policyEngine.getPolicy(name);
        const capabilities = policy?.capabilities?.join(", ") || "none";
        descriptions.push(
          `- ${name}: ${tool.description} [capabilities: ${capabilities}]`
        );
      }
    }

    return descriptions.join("\n");
  }

  private buildUserPrompt(
    objective: string,
    toolDescriptions: string,
    context: PlanningContext
  ): string {
    let prompt = `Objective: ${objective}\n\n`;
    prompt += `Available Tools:\n${toolDescriptions}\n\n`;
    prompt += `Constraints:\n`;
    prompt += `- Maximum steps: ${context.maxSteps}\n`;
    prompt += `- User plan: ${context.userPlan}\n`;
    prompt += `- Citations required: ${context.requireCitations}\n`;

    if (context.constraints?.maxTimeMs) {
      prompt += `- Maximum total time: ${context.constraints.maxTimeMs}ms\n`;
    }

    if (context.conversationHistory && context.conversationHistory.length > 0) {
      const recentHistory = context.conversationHistory.slice(-5);
      prompt += `\nRecent conversation context:\n`;
      for (const msg of recentHistory) {
        prompt += `${msg.role}: ${msg.content.slice(0, 200)}...\n`;
      }
    }

    prompt += `\nGenerate an execution plan following the specified JSON structure.`;
    return prompt;
  }

  private parsePlanResponse(content: string, objective: string): AgentPlan {
    let parsed: any;
    try {
      parsed = JSON.parse(content);
    } catch {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("Failed to parse plan response as JSON");
      }
    }

    const steps: PlanStep[] = (parsed.steps || []).map(
      (step: any, index: number) => ({
        index,
        toolName: step.toolName || step.tool_name || "unknown",
        description: step.description || "",
        input: step.input || step.params || {},
        expectedOutput: step.expectedOutput || step.expected_output || "",
        dependencies: step.dependencies || [],
        optional: step.optional || false,
        timeoutMs: step.timeoutMs || step.timeout_ms || 30000,
        phaseId: step.phaseId || step.phase_id || undefined,
      })
    );

    const phases = (parsed.phases || []).map((phase: any) => ({
      id: phase.id,
      name: phase.name,
      description: phase.description || "",
      status: "pending" as const,
      stepIndices: phase.stepIndices || phase.step_indices || [],
    }));

    return {
      objective: parsed.objective || objective,
      steps,
      phases: phases.length > 0 ? phases : this.inferPhasesFromSteps(steps),
      currentPhaseIndex: 0,
      estimatedTimeMs: parsed.estimatedTimeMs || parsed.estimated_time_ms || this.estimateTotalTime(steps),
      reasoning: parsed.reasoning || undefined,
      createdAt: new Date(),
    };
  }

  private inferPhasesFromSteps(steps: PlanStep[]): any[] {
    const phaseGroups: Record<string, number[]> = {};
    
    for (const step of steps) {
      const rawPhaseId = step.phaseId || this.inferPhaseFromTool(step.toolName);
      const phaseId = rawPhaseId && rawPhaseId !== "undefined" ? rawPhaseId : "execution";
      if (!phaseGroups[phaseId]) {
        phaseGroups[phaseId] = [];
      }
      phaseGroups[phaseId].push(step.index);
    }

    const phaseOrder = ["research", "planning", "execution", "verification", "delivery"];
    const phases = [];

    for (const id of phaseOrder) {
      if (phaseGroups[id]) {
        phases.push({
          id,
          name: this.getPhaseDisplayName(id),
          description: this.getPhaseDescription(id),
          status: "pending" as const,
          stepIndices: phaseGroups[id],
        });
      }
    }

    for (const [id, indices] of Object.entries(phaseGroups)) {
      if (!phaseOrder.includes(id)) {
        phases.push({
          id,
          name: id.charAt(0).toUpperCase() + id.slice(1),
          description: "",
          status: "pending" as const,
          stepIndices: indices,
        });
      }
    }

    return phases;
  }

  private inferPhaseFromTool(toolName: string): string {
    const toolPhaseMap: Record<string, string> = {
      search_web: "research",
      web_navigate: "research",
      extract_content: "research",
      generate_code: "execution",
      generate_file: "execution",
      file_operations: "execution",
      shell_execute: "execution",
      webdev_scaffold: "execution",
      slides_generate: "execution",
      transform_data: "execution",
      analyze_data: "verification",
      respond: "delivery",
    };
    return toolPhaseMap[toolName] || "execution";
  }

  private getPhaseDisplayName(phaseId: string): string {
    const names: Record<string, string> = {
      research: "Research & Discovery",
      planning: "Planning",
      execution: "Execution",
      verification: "Verification",
      delivery: "Delivery",
    };
    return names[phaseId] || phaseId;
  }

  private getPhaseDescription(phaseId: string): string {
    const descriptions: Record<string, string> = {
      research: "Gathering information and resources",
      planning: "Preparing and organizing work",
      execution: "Performing main tasks",
      verification: "Validating results",
      delivery: "Preparing final response",
    };
    return descriptions[phaseId] || "";
  }

  private validatePlan(
    plan: AgentPlan,
    availableTools: string[],
    context: PlanningContext
  ): AgentPlan {
    if (plan.steps.length === 0) {
      throw new Error("Plan must have at least one step");
    }

    if (plan.steps.length > context.maxSteps) {
      throw new Error(
        `Plan has ${plan.steps.length} steps, exceeds maximum of ${context.maxSteps}`
      );
    }

    const validatedSteps: PlanStep[] = [];
    for (const step of plan.steps) {
      if (!availableTools.includes(step.toolName)) {
        console.warn(
          `[PlannerAgent] Tool "${step.toolName}" not available, marking step as optional`
        );
        validatedSteps.push({ ...step, optional: true });
        continue;
      }

      for (const dep of step.dependencies) {
        if (dep < 0 || dep >= step.index) {
          throw new Error(
            `Invalid dependency ${dep} for step ${step.index}: dependencies must reference earlier steps`
          );
        }
      }

      validatedSteps.push(PlanStepSchema.parse(step));
    }

    const validatedPlan = AgentPlanSchema.parse({
      ...plan,
      steps: validatedSteps,
    });

    return validatedPlan;
  }

  private estimateTotalTime(steps: PlanStep[]): number {
    let maxParallelTime = 0;
    const stepTimes = new Map<number, number>();

    for (const step of steps) {
      let startTime = 0;
      for (const dep of step.dependencies) {
        const depEndTime = stepTimes.get(dep) || 0;
        startTime = Math.max(startTime, depEndTime);
      }
      const endTime = startTime + (step.timeoutMs || 30000);
      stepTimes.set(step.index, endTime);
      maxParallelTime = Math.max(maxParallelTime, endTime);
    }

    return maxParallelTime;
  }
}

export const plannerAgent = new PlannerAgent();
