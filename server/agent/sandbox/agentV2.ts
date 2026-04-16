import {
  AgentConfig,
  AgentConfigSchema,
  AgentState,
  AgentStatus,
  IAgentV2,
  TaskPlan,
  ToolResult,
  Phase,
  Step,
  calculateProgress,
  getNextStep,
  isPlanComplete,
} from "./agentTypes";
import { TaskPlanner } from "./taskPlanner";
import { ToolRegistry, createDefaultToolRegistry } from "./tools";

interface ExecutionHistoryEntry {
  timestamp: Date;
  action: string;
  toolName?: string;
  params?: Record<string, any>;
  result?: ToolResult;
  error?: string;
  durationMs?: number;
}

export class AgentV2 implements IAgentV2 {
  private config: AgentConfig;
  private state: AgentState = "idle";
  private toolRegistry: ToolRegistry;
  private planner: TaskPlanner;
  private currentPlan: TaskPlan | undefined;
  private executionHistory: ExecutionHistoryEntry[] = [];
  private iterations: number = 0;
  private filesCreated: string[] = [];

  constructor(config?: Partial<AgentConfig>) {
    this.config = AgentConfigSchema.parse(config || {});
    this.toolRegistry = createDefaultToolRegistry();
    this.planner = new TaskPlanner();
    this.log("AgentV2 initialized", { config: this.config });
  }

  async run(userInput: string): Promise<string> {
    const startTime = Date.now();
    this.iterations = 0;
    this.filesCreated = [];
    this.executionHistory = [];

    try {
      this.setState("analyzing");
      this.log(`Processing input: "${userInput.substring(0, 100)}..."`);

      this.setState("planning");
      this.currentPlan = await this.planner.createPlan(userInput);
      this.log(`Plan created with ${this.currentPlan.phases.length} phases`, {
        taskId: this.currentPlan.taskId,
        objective: this.currentPlan.objective,
      });

      this.setState("executing");
      await this.executePlan();

      this.setState("delivering");
      const response = this.buildResponse();

      this.setState("idle");
      const totalTime = Date.now() - startTime;
      this.log(`Execution completed in ${totalTime}ms`);

      return response;
    } catch (error) {
      this.setState("error");
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logError(`Execution failed: ${errorMessage}`);
      this.addHistoryEntry("error", { error: errorMessage });

      return this.buildErrorResponse(errorMessage);
    }
  }

  async executeDirectTool(toolName: string, params: Record<string, any>): Promise<ToolResult> {
    const startTime = Date.now();
    this.log(`Direct tool execution: ${toolName}`, params);

    try {
      const result = await this.toolRegistry.execute(toolName, params);
      
      this.addHistoryEntry("direct_tool", {
        toolName,
        params,
        result,
        durationMs: Date.now() - startTime,
      });

      if (result.filesCreated && result.filesCreated.length > 0) {
        this.filesCreated.push(...result.filesCreated);
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        toolName,
        message: "",
        error: errorMessage,
        executionTimeMs: Date.now() - startTime,
        filesCreated: [],
      };
    }
  }

  getStatus(): AgentStatus {
    return {
      name: this.config.name,
      state: this.state,
      iterations: this.iterations,
      toolsAvailable: this.toolRegistry.listTools(),
      historyCount: this.executionHistory.length,
      currentPlan: this.currentPlan,
      progress: this.currentPlan ? calculateProgress(this.currentPlan) : 0,
    };
  }

  getAvailableTools(): string[] {
    return this.toolRegistry.listTools();
  }

  private async executePlan(): Promise<void> {
    if (!this.currentPlan) {
      throw new Error("No plan to execute");
    }

    for (const phase of this.currentPlan.phases) {
      if (this.iterations >= this.config.maxIterations) {
        this.log(`Max iterations (${this.config.maxIterations}) reached, stopping execution`);
        break;
      }

      await this.executePhase(phase);
    }
  }

  private async executePhase(phase: Phase): Promise<void> {
    this.log(`Starting phase: ${phase.name} (${phase.icon})`, { phaseId: phase.id });
    phase.status = "in_progress";

    try {
      for (const step of phase.steps) {
        if (this.iterations >= this.config.maxIterations) {
          step.status = "skipped";
          continue;
        }

        await this.executeStep(step, phase);
        this.iterations++;
      }

      const allCompleted = phase.steps.every(
        (s) => s.status === "completed" || s.status === "skipped"
      );
      const anyFailed = phase.steps.some((s) => s.status === "failed");

      phase.status = anyFailed ? "failed" : allCompleted ? "completed" : "pending";
      this.log(`Phase ${phase.name} completed with status: ${phase.status}`);
    } catch (error) {
      phase.status = "failed";
      throw error;
    }
  }

  private async executeStep(step: Step, phase: Phase): Promise<void> {
    this.log(`Executing step: ${step.description}`, {
      stepId: step.id,
      tool: step.tool,
    });

    step.status = "in_progress";
    step.startedAt = new Date();
    const startTime = Date.now();

    try {
      const result = await this.toolRegistry.execute(step.tool, step.params);

      step.completedAt = new Date();
      step.executionTimeMs = Date.now() - startTime;
      step.result = result;

      if (result.success) {
        step.status = "completed";
        this.log(`Step completed successfully: ${step.description}`, {
          executionTimeMs: step.executionTimeMs,
        });

        if (result.filesCreated && result.filesCreated.length > 0) {
          this.filesCreated.push(...result.filesCreated);
        }
      } else {
        step.status = "failed";
        step.error = result.error;
        this.logError(`Step failed: ${step.description}`, { error: result.error });
      }

      this.addHistoryEntry("step_execution", {
        toolName: step.tool,
        params: step.params,
        result,
        durationMs: step.executionTimeMs,
      });

      if (this.currentPlan) {
        this.currentPlan.updatedAt = new Date();
      }
    } catch (error) {
      step.status = "failed";
      step.completedAt = new Date();
      step.executionTimeMs = Date.now() - startTime;
      step.error = error instanceof Error ? error.message : String(error);

      this.addHistoryEntry("step_error", {
        toolName: step.tool,
        error: step.error,
        durationMs: step.executionTimeMs,
      });

      this.logError(`Step execution error: ${step.description}`, { error: step.error });
    }
  }

  private buildResponse(): string {
    if (!this.currentPlan) {
      return "No plan was executed.";
    }

    const lines: string[] = [];

    lines.push(`## ✅ Task Completed`);
    lines.push("");
    lines.push(`**Objective:** ${this.currentPlan.objective}`);
    lines.push("");

    if (this.filesCreated.length > 0) {
      lines.push(`### 📁 Files Created`);
      for (const file of this.filesCreated) {
        lines.push(`- \`${file}\``);
      }
      lines.push("");
    }

    lines.push(`### 📊 Execution Summary`);
    lines.push("");

    for (const phase of this.currentPlan.phases) {
      const statusEmoji = this.getStatusEmoji(phase.status);
      lines.push(`**${phase.icon} ${phase.name}** ${statusEmoji}`);
      
      for (const step of phase.steps) {
        const stepStatusEmoji = this.getStatusEmoji(step.status);
        const timeInfo = step.executionTimeMs ? ` (${step.executionTimeMs}ms)` : "";
        lines.push(`  - ${stepStatusEmoji} ${step.description}${timeInfo}`);
        
        if (step.status === "failed" && step.error) {
          lines.push(`    ⚠️ Error: ${step.error}`);
        }
      }
      lines.push("");
    }

    const progress = calculateProgress(this.currentPlan);
    const isComplete = isPlanComplete(this.currentPlan);

    lines.push(`### 📈 Progress`);
    lines.push(`- Completion: ${progress.toFixed(1)}%`);
    lines.push(`- Iterations: ${this.iterations}`);
    lines.push(`- Status: ${isComplete ? "✅ Complete" : "⏳ Partial"}`);

    const results = this.collectResults();
    if (results.length > 0) {
      lines.push("");
      lines.push(`### 📋 Results`);
      for (const result of results) {
        if (result.message) {
          lines.push(`- ${result.message}`);
        }
      }
    }

    return lines.join("\n");
  }

  private buildErrorResponse(errorMessage: string): string {
    const lines: string[] = [];

    lines.push(`## ❌ Task Failed`);
    lines.push("");
    
    if (this.currentPlan) {
      lines.push(`**Objective:** ${this.currentPlan.objective}`);
      lines.push("");
    }

    lines.push(`### Error`);
    lines.push(`\`\`\``);
    lines.push(errorMessage);
    lines.push(`\`\`\``);
    lines.push("");

    if (this.filesCreated.length > 0) {
      lines.push(`### 📁 Files Created Before Failure`);
      for (const file of this.filesCreated) {
        lines.push(`- \`${file}\``);
      }
      lines.push("");
    }

    lines.push(`### Execution Info`);
    lines.push(`- Iterations completed: ${this.iterations}`);
    lines.push(`- History entries: ${this.executionHistory.length}`);

    return lines.join("\n");
  }

  private collectResults(): ToolResult[] {
    const results: ToolResult[] = [];
    
    if (this.currentPlan) {
      for (const phase of this.currentPlan.phases) {
        for (const step of phase.steps) {
          if (step.result && step.result.success) {
            results.push(step.result);
          }
        }
      }
    }

    return results;
  }

  private getStatusEmoji(status: string): string {
    switch (status) {
      case "completed":
        return "✅";
      case "failed":
        return "❌";
      case "in_progress":
        return "🔄";
      case "skipped":
        return "⏭️";
      case "pending":
      default:
        return "⏳";
    }
  }

  private setState(state: AgentState): void {
    const previousState = this.state;
    this.state = state;
    this.log(`State transition: ${previousState} → ${state}`);
  }

  private addHistoryEntry(action: string, data: Partial<ExecutionHistoryEntry>): void {
    this.executionHistory.push({
      timestamp: new Date(),
      action,
      ...data,
    });
  }

  private log(message: string, data?: Record<string, any>): void {
    if (this.config.verbose) {
      const timestamp = new Date().toISOString();
      const dataStr = data ? ` ${JSON.stringify(data)}` : "";
      console.log(`[${timestamp}] [AgentV2] ${message}${dataStr}`);
    }
  }

  private logError(message: string, data?: Record<string, any>): void {
    const timestamp = new Date().toISOString();
    const dataStr = data ? ` ${JSON.stringify(data)}` : "";
    console.error(`[${timestamp}] [AgentV2] ERROR: ${message}${dataStr}`);
  }
}

export const agentV2 = new AgentV2();
