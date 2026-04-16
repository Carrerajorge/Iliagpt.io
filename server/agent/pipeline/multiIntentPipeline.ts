import {
  TaskPlan,
  ExecutionResult,
  PipelineError,
  PipelineResponse,
  AggregateSummary,
  TaskStatus,
  MAX_PARALLEL_TASKS,
  DEFAULT_TASK_TIMEOUT
} from "../../../shared/schemas/multiIntent";
import { multiIntentManager } from "./multiIntentManager";
import { runPipeline, getAvailableTools } from "./index";
import type { ProgressUpdate, PipelineResult } from "./types";
import { geminiChat, GEMINI_MODELS } from "../../lib/gemini";

interface PipelineContext {
  userId?: string;
  conversationId?: string;
  messages: Array<{ role: string; content: string }>;
  onProgress?: (update: ProgressUpdate) => void;
}

interface DecomposedTask {
  plan: TaskPlan;
  prompt: string;
  context: string[];
}

export class MultiIntentPipeline {
  private readonly planningPrompt = `You are a task planner. Analyze the user's message and decompose it into individual tasks.
Return a JSON array of tasks with this structure:
[{
  "id": "task_1",
  "title": "Brief task title",
  "intentType": "search|analyze|generate|transform|summarize|extract|navigate|chat",
  "description": "Detailed description of what to do",
  "dependencies": ["task_id if this depends on another task"],
  "executionMode": "sequential|parallel"
}]

Rules:
- Each task should be atomic and focused
- Identify dependencies between tasks
- Mark tasks as parallel if they can run independently
- Use sequential for tasks that need previous results

User message: `;

  async execute(
    message: string,
    context: PipelineContext
  ): Promise<PipelineResponse> {
    const startTime = Date.now();
    const errors: PipelineError[] = [];
    const results: ExecutionResult[] = [];
    
    try {
      context.onProgress?.({
        runId: context.conversationId || "default",
        stepId: "planning",
        status: "started",
        message: "Analyzing multi-intent request..."
      });
      
      const plan = await this.plan(message, context);
      
      if (plan.length === 0) {
        return this.createFailedResponse("No tasks could be identified", startTime);
      }
      
      context.onProgress?.({
        runId: context.conversationId || "default",
        stepId: "planning",
        status: "completed",
        message: `Identified ${plan.length} tasks`
      });
      
      const decomposed = await this.decompose(plan, message, context);
      
      context.onProgress?.({
        runId: context.conversationId || "default",
        stepId: "execution",
        status: "started",
        message: "Executing tasks..."
      });
      
      const executionResults = await this.executeAll(decomposed, context, errors);
      results.push(...executionResults);
      
      const aggregate = this.aggregate(plan, results, errors, startTime);
      
      context.onProgress?.({
        runId: context.conversationId || "default",
        stepId: "aggregation",
        status: "completed",
        message: aggregate.summary
      });
      
      return {
        plan,
        results,
        errors,
        aggregate
      };
      
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      errors.push({
        taskId: "pipeline",
        code: "PIPELINE_ERROR",
        message: errorMsg,
        recoverable: false,
        timestamp: Date.now()
      });
      
      return this.createFailedResponse(errorMsg, startTime, errors);
    }
  }
  
  private async plan(message: string, context: PipelineContext): Promise<TaskPlan[]> {
    const detection = await multiIntentManager.detectMultiIntent(message, {
      messages: context.messages as any,
      userPreferences: {}
    });
    
    if (detection.suggestedPlan && detection.suggestedPlan.length > 0) {
      return detection.suggestedPlan;
    }
    
    const planningResponse = await geminiChat(
      [
        { role: "user", parts: [{ text: this.planningPrompt + message }] }
      ],
      { model: GEMINI_MODELS.FLASH_PREVIEW }
    );
    
    try {
      const jsonMatch = planningResponse.content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return parsed.map((task: any, index: number) => ({
          id: task.id || `task_${index + 1}`,
          title: task.title || `Task ${index + 1}`,
          intentType: task.intentType || "chat",
          description: task.description || task.title,
          requiredContext: task.dependencies || [],
          executionMode: task.executionMode || "sequential",
          dependencies: task.dependencies || [],
          priority: parsed.length - index
        }));
      }
    } catch (e) {
      console.error("Failed to parse planning response:", e);
    }
    
    return [{
      id: "task_1",
      title: "Process request",
      intentType: "chat",
      description: message,
      requiredContext: [],
      executionMode: "sequential",
      dependencies: [],
      priority: 1
    }];
  }
  
  private async decompose(
    plan: TaskPlan[],
    originalMessage: string,
    context: PipelineContext
  ): Promise<DecomposedTask[]> {
    return plan.map(task => ({
      plan: task,
      prompt: this.buildTaskPrompt(task, originalMessage),
      context: task.requiredContext
    }));
  }
  
  private buildTaskPrompt(task: TaskPlan, originalMessage: string): string {
    return task.description;
  }
  
  private getTaskSystemInstruction(task: TaskPlan): string {
    return `Eres un asistente que responde a UNA sola solicitud.
Tu única tarea es: "${task.title}"
NO respondas a ninguna otra solicitud. NO menciones otras tareas.
Responde de forma completa y directa solo a esta tarea.`;
  }
  
  private async executeAll(
    tasks: DecomposedTask[],
    context: PipelineContext,
    errors: PipelineError[]
  ): Promise<ExecutionResult[]> {
    const results: ExecutionResult[] = [];
    const completedTasks = new Map<string, ExecutionResult>();
    
    const sequentialTasks = tasks.filter(t => 
      t.plan.executionMode === "sequential" || t.plan.dependencies.length > 0
    );
    const parallelTasks = tasks.filter(t => 
      t.plan.executionMode === "parallel" && t.plan.dependencies.length === 0
    );
    
    if (parallelTasks.length > 0) {
      const parallelResults = await this.executeParallel(
        parallelTasks, 
        context, 
        completedTasks, 
        errors
      );
      results.push(...parallelResults);
      parallelResults.forEach(r => completedTasks.set(r.taskId, r));
    }
    
    for (const task of sequentialTasks) {
      const canExecute = task.plan.dependencies.every(dep => {
        const depResult = completedTasks.get(dep);
        return depResult && depResult.status === "completed";
      });
      
      if (!canExecute && task.plan.dependencies.length > 0) {
        const result: ExecutionResult = {
          taskId: task.plan.id,
          status: "skipped",
          error: "Dependencies not met",
          artifacts: [],
          retryCount: 0
        };
        results.push(result);
        completedTasks.set(task.plan.id, result);
        continue;
      }
      
      const result = await this.executeSingleTask(task, context, completedTasks, errors);
      results.push(result);
      completedTasks.set(result.taskId, result);
    }
    
    return results;
  }
  
  private async executeParallel(
    tasks: DecomposedTask[],
    context: PipelineContext,
    completedTasks: Map<string, ExecutionResult>,
    errors: PipelineError[]
  ): Promise<ExecutionResult[]> {
    const chunks: DecomposedTask[][] = [];
    for (let i = 0; i < tasks.length; i += MAX_PARALLEL_TASKS) {
      chunks.push(tasks.slice(i, i + MAX_PARALLEL_TASKS));
    }
    
    const allResults: ExecutionResult[] = [];
    
    for (const chunk of chunks) {
      const promises = chunk.map(task => 
        this.executeSingleTask(task, context, completedTasks, errors)
      );
      
      const results = await Promise.allSettled(promises);
      
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (result.status === "fulfilled") {
          allResults.push(result.value);
        } else {
          const errorResult: ExecutionResult = {
            taskId: chunk[i].plan.id,
            status: "failed",
            error: result.reason?.message || "Execution failed",
            artifacts: [],
            retryCount: 0
          };
          allResults.push(errorResult);
          errors.push({
            taskId: chunk[i].plan.id,
            code: "EXECUTION_ERROR",
            message: result.reason?.message || "Unknown error",
            recoverable: true,
            timestamp: Date.now()
          });
        }
      }
    }
    
    return allResults;
  }
  
  private async executeSingleTask(
    task: DecomposedTask,
    context: PipelineContext,
    completedTasks: Map<string, ExecutionResult>,
    errors: PipelineError[]
  ): Promise<ExecutionResult> {
    const startTime = Date.now();
    const maxRetries = task.plan.retryPolicy?.maxRetries ?? 2;
    let retryCount = 0;
    
    context.onProgress?.({
      runId: context.conversationId || "default",
      stepId: task.plan.id,
      status: "started",
      message: `Executing: ${task.plan.title}`
    });
    
    while (retryCount <= maxRetries) {
      try {
        let contextFromDeps = "";
        for (const depId of task.plan.dependencies) {
          const depResult = completedTasks.get(depId);
          if (depResult?.output) {
            contextFromDeps += `\n\nResult from ${depId}: ${JSON.stringify(depResult.output)}`;
          }
        }
        
        const fullPrompt = task.prompt + contextFromDeps;
        const systemInstruction = this.getTaskSystemInstruction(task.plan);
        
        const response = await geminiChat(
          [{ role: "user", parts: [{ text: fullPrompt }] }],
          { model: GEMINI_MODELS.FLASH_PREVIEW, systemInstruction }
        );
        
        context.onProgress?.({
          runId: context.conversationId || "default",
          stepId: task.plan.id,
          status: "completed",
          message: `Completed: ${task.plan.title}`
        });
        
        return {
          taskId: task.plan.id,
          status: "completed",
          output: response.content,
          artifacts: [],
          duration: Date.now() - startTime,
          retryCount
        };
        
      } catch (error) {
        retryCount++;
        
        if (retryCount > maxRetries) {
          const errorMsg = error instanceof Error ? error.message : "Unknown error";
          errors.push({
            taskId: task.plan.id,
            code: "TASK_FAILED",
            message: errorMsg,
            recoverable: false,
            timestamp: Date.now()
          });
          
          context.onProgress?.({
            runId: context.conversationId || "default",
            stepId: task.plan.id,
            status: "failed",
            message: `Failed: ${task.plan.title}`
          });
          
          return {
            taskId: task.plan.id,
            status: "failed",
            error: errorMsg,
            artifacts: [],
            duration: Date.now() - startTime,
            retryCount: retryCount - 1
          };
        }
        
        const delay = task.plan.retryPolicy?.delayMs ?? 1000;
        await new Promise(resolve => setTimeout(resolve, delay * retryCount));
      }
    }
    
    return {
      taskId: task.plan.id,
      status: "failed",
      error: "Max retries exceeded",
      artifacts: [],
      duration: Date.now() - startTime,
      retryCount: maxRetries
    };
  }
  
  private aggregate(
    plan: TaskPlan[],
    results: ExecutionResult[],
    errors: PipelineError[],
    startTime: number
  ): AggregateSummary {
    const completedTasks = results.filter(r => r.status === "completed").length;
    const failedTasks = results.filter(r => r.status === "failed").length;
    const skippedTasks = results.filter(r => r.status === "skipped").length;
    const totalTasks = plan.length;
    
    const resultTaskIds = new Set(results.map(r => r.taskId));
    const missingTasks = plan
      .filter(p => !resultTaskIds.has(p.id))
      .map(p => p.id);
    
    let completionStatus: "complete" | "partial" | "failed";
    if (completedTasks === totalTasks) {
      completionStatus = "complete";
    } else if (completedTasks > 0) {
      completionStatus = "partial";
    } else {
      completionStatus = "failed";
    }
    
    const summary = this.generateSummary(results, completionStatus);
    
    return {
      completionStatus,
      summary,
      totalTasks,
      completedTasks,
      failedTasks,
      skippedTasks,
      missingTasks,
      duration: Date.now() - startTime
    };
  }
  
  private generateSummary(
    results: ExecutionResult[],
    status: "complete" | "partial" | "failed"
  ): string {
    const completedResults = results
      .filter(r => r.status === "completed" && r.output);
    
    if (completedResults.length === 0) {
      return "No tasks were completed successfully.";
    }
    
    if (completedResults.length === 1) {
      return String(completedResults[0].output);
    }
    
    return completedResults
      .map(r => String(r.output))
      .join("\n\n---\n\n");
  }
  
  private createFailedResponse(
    message: string,
    startTime: number,
    errors: PipelineError[] = []
  ): PipelineResponse {
    return {
      plan: [],
      results: [],
      errors: errors.length > 0 ? errors : [{
        taskId: "pipeline",
        code: "INIT_FAILED",
        message,
        recoverable: false,
        timestamp: Date.now()
      }],
      aggregate: {
        completionStatus: "failed",
        summary: message,
        totalTasks: 0,
        completedTasks: 0,
        failedTasks: 1,
        skippedTasks: 0,
        missingTasks: [],
        duration: Date.now() - startTime
      }
    };
  }
}

export const multiIntentPipeline = new MultiIntentPipeline();
