/**
 * Workflow Automation Engine
 *
 * Chainable task execution system with:
 * - Sequential and parallel step execution
 * - Conditional branching (if/else)
 * - Loop iterations (for each, while)
 * - Variable management with data passing between steps
 * - Error handling and retry policies
 * - Browser + terminal tool integration
 * - Execution history and replay
 * - Progress tracking with event emission
 */

import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import { universalBrowserController } from "./universalBrowserController";
import { terminalController } from "./terminalController";

// ============================================
// Types
// ============================================

export interface WorkflowDefinition {
  id?: string;
  name: string;
  description?: string;
  variables?: Record<string, any>;
  steps: WorkflowStep[];
  onError?: "abort" | "continue" | "retry";
  maxRetries?: number;
  timeout?: number;
}

export type WorkflowStep =
  | ActionStep
  | ConditionStep
  | LoopStep
  | ParallelStep
  | SubworkflowStep
  | WaitStep;

export interface ActionStep {
  type: "action";
  id?: string;
  name: string;
  tool: "browser" | "terminal" | "http" | "transform" | "notify";
  action: string;
  params: Record<string, any>;
  saveResultAs?: string;
  timeout?: number;
  retries?: number;
  continueOnError?: boolean;
}

export interface ConditionStep {
  type: "condition";
  id?: string;
  name: string;
  condition: {
    variable: string;
    operator: "equals" | "not_equals" | "contains" | "not_contains" | "greater" | "less" | "exists" | "not_exists" | "matches";
    value: any;
  };
  then: WorkflowStep[];
  else?: WorkflowStep[];
}

export interface LoopStep {
  type: "loop";
  id?: string;
  name: string;
  mode: "forEach" | "while" | "times";
  collection?: string;    // variable name containing array (forEach)
  condition?: {            // while condition
    variable: string;
    operator: string;
    value: any;
  };
  count?: number;          // times count
  iteratorVariable?: string;
  indexVariable?: string;
  maxIterations?: number;
  steps: WorkflowStep[];
}

export interface ParallelStep {
  type: "parallel";
  id?: string;
  name: string;
  branches: WorkflowStep[][];
  failFast?: boolean;
}

export interface SubworkflowStep {
  type: "subworkflow";
  id?: string;
  name: string;
  workflowId: string;
  inputVariables?: Record<string, string>;
}

export interface WaitStep {
  type: "wait";
  id?: string;
  name: string;
  duration: number;
}

export interface StepResult {
  stepId: string;
  stepName: string;
  stepType: string;
  success: boolean;
  data?: any;
  error?: string;
  duration: number;
  timestamp: number;
}

export interface WorkflowExecution {
  id: string;
  workflowId: string;
  workflowName: string;
  status: "running" | "completed" | "failed" | "cancelled";
  variables: Record<string, any>;
  stepResults: StepResult[];
  startTime: number;
  endTime?: number;
  error?: string;
  progress: number;
  totalSteps: number;
  completedSteps: number;
}

// ============================================
// Workflow Engine
// ============================================

export class WorkflowEngine extends EventEmitter {
  private workflows: Map<string, WorkflowDefinition> = new Map();
  private executions: Map<string, WorkflowExecution> = new Map();
  private cancelTokens: Set<string> = new Set();

  // ============================================
  // Workflow Management
  // ============================================

  registerWorkflow(workflow: WorkflowDefinition): string {
    const id = workflow.id || randomUUID();
    workflow.id = id;
    this.workflows.set(id, workflow);
    return id;
  }

  getWorkflow(id: string): WorkflowDefinition | null {
    return this.workflows.get(id) || null;
  }

  listWorkflows(): Array<{ id: string; name: string; description?: string; stepCount: number }> {
    return Array.from(this.workflows.values()).map((w) => ({
      id: w.id!,
      name: w.name,
      description: w.description,
      stepCount: this.countSteps(w.steps),
    }));
  }

  deleteWorkflow(id: string): boolean {
    return this.workflows.delete(id);
  }

  // ============================================
  // Execution
  // ============================================

  async executeWorkflow(
    workflow: WorkflowDefinition,
    inputVariables?: Record<string, any>
  ): Promise<WorkflowExecution> {
    const executionId = randomUUID();
    const totalSteps = this.countSteps(workflow.steps);

    const execution: WorkflowExecution = {
      id: executionId,
      workflowId: workflow.id || "inline",
      workflowName: workflow.name,
      status: "running",
      variables: { ...workflow.variables, ...inputVariables },
      stepResults: [],
      startTime: Date.now(),
      progress: 0,
      totalSteps,
      completedSteps: 0,
    };

    this.executions.set(executionId, execution);
    this.emit("workflow:started", { executionId, workflowName: workflow.name });

    try {
      await this.executeSteps(execution, workflow.steps, workflow);
      execution.status = "completed";
      execution.endTime = Date.now();
      execution.progress = 100;
      this.emit("workflow:completed", { executionId, duration: execution.endTime - execution.startTime });
    } catch (error: any) {
      execution.status = "failed";
      execution.error = error.message;
      execution.endTime = Date.now();
      this.emit("workflow:failed", { executionId, error: error.message });
    }

    return execution;
  }

  cancelExecution(executionId: string): boolean {
    const execution = this.executions.get(executionId);
    if (!execution || execution.status !== "running") return false;

    this.cancelTokens.add(executionId);
    execution.status = "cancelled";
    execution.endTime = Date.now();
    this.emit("workflow:cancelled", { executionId });
    return true;
  }

  getExecution(executionId: string): WorkflowExecution | null {
    return this.executions.get(executionId) || null;
  }

  listExecutions(): WorkflowExecution[] {
    return Array.from(this.executions.values());
  }

  // ============================================
  // Step Execution
  // ============================================

  private async executeSteps(
    execution: WorkflowExecution,
    steps: WorkflowStep[],
    workflow: WorkflowDefinition
  ): Promise<void> {
    for (const step of steps) {
      if (this.cancelTokens.has(execution.id)) {
        this.cancelTokens.delete(execution.id);
        throw new Error("Workflow cancelled");
      }

      const stepId = (step as any).id || randomUUID();
      const stepName = (step as any).name || step.type;
      const startTime = Date.now();

      try {
        switch (step.type) {
          case "action":
            await this.executeActionStep(execution, step, workflow);
            break;
          case "condition":
            await this.executeConditionStep(execution, step, workflow);
            break;
          case "loop":
            await this.executeLoopStep(execution, step, workflow);
            break;
          case "parallel":
            await this.executeParallelStep(execution, step, workflow);
            break;
          case "subworkflow":
            await this.executeSubworkflowStep(execution, step);
            break;
          case "wait":
            await new Promise((resolve) => setTimeout(resolve, step.duration));
            break;
        }

        execution.completedSteps++;
        execution.progress = Math.round((execution.completedSteps / execution.totalSteps) * 100);
        this.emit("step:completed", {
          executionId: execution.id,
          stepId,
          stepName,
          progress: execution.progress,
        });
      } catch (error: any) {
        const result: StepResult = {
          stepId,
          stepName,
          stepType: step.type,
          success: false,
          error: error.message,
          duration: Date.now() - startTime,
          timestamp: Date.now(),
        };
        execution.stepResults.push(result);

        if (step.type === "action" && step.continueOnError) {
          continue;
        }

        if (workflow.onError === "continue") {
          continue;
        }

        throw error;
      }
    }
  }

  private async executeActionStep(
    execution: WorkflowExecution,
    step: ActionStep,
    workflow: WorkflowDefinition
  ): Promise<void> {
    const resolvedParams = this.resolveVariables(step.params, execution.variables);
    const startTime = Date.now();
    let result: any;
    let retries = step.retries || 0;

    while (retries >= 0) {
      try {
        result = await this.executeToolAction(step.tool, step.action, resolvedParams, execution);
        break;
      } catch (error: any) {
        if (retries > 0) {
          retries--;
          await new Promise((r) => setTimeout(r, 1000));
        } else {
          throw error;
        }
      }
    }

    if (step.saveResultAs && result !== undefined) {
      execution.variables[step.saveResultAs] = result;
    }

    execution.stepResults.push({
      stepId: step.id || randomUUID(),
      stepName: step.name,
      stepType: "action",
      success: true,
      data: result,
      duration: Date.now() - startTime,
      timestamp: Date.now(),
    });
  }

  private async executeToolAction(
    tool: string,
    action: string,
    params: Record<string, any>,
    execution: WorkflowExecution
  ): Promise<any> {
    switch (tool) {
      case "browser": {
        const sid = params.sessionId || execution.variables._browserSessionId;
        if (!sid) throw new Error("No browser session ID available");

        switch (action) {
          case "navigate": return universalBrowserController.navigate(sid, params.url, params.options);
          case "click": return universalBrowserController.click(sid, params.selector, params.options);
          case "type": return universalBrowserController.type(sid, params.selector, params.text, params.options);
          case "scroll": return universalBrowserController.scroll(sid, params);
          case "select": return universalBrowserController.select(sid, params.selector, params.values);
          case "extract": return universalBrowserController.extract(sid, params.rules);
          case "extractStructured": return universalBrowserController.extractStructured(sid, params.description);
          case "screenshot": return universalBrowserController.screenshot(sid, params);
          case "createSession": {
            const newSid = await universalBrowserController.createSession(params.profileId || "chrome-desktop");
            execution.variables._browserSessionId = newSid;
            return newSid;
          }
          case "closeSession": return universalBrowserController.closeSession(sid);
          default: throw new Error(`Unknown browser action: ${action}`);
        }
      }

      case "terminal": {
        let sid = params.sessionId || execution.variables._terminalSessionId;
        if (!sid) {
          sid = terminalController.createSession(params.cwd);
          execution.variables._terminalSessionId = sid;
        }

        switch (action) {
          case "execute": return terminalController.executeCommand(sid, { command: params.command, timeout: params.timeout });
          case "script": return terminalController.executeScript(sid, params.language, params.code, params.options);
          case "fileOp": return terminalController.fileOperation(sid, params);
          case "systemInfo": return terminalController.getSystemInfo();
          case "processes": return terminalController.listProcesses(params.filter);
          case "ports": return terminalController.listPorts();
          case "installPackage": return terminalController.installPackage(sid, params.manager, params.packages);
          default: throw new Error(`Unknown terminal action: ${action}`);
        }
      }

      case "http": {
        // Validate URL to prevent SSRF (CodeQL: server-side-request-forgery)
        const rawUrl = typeof params.url === "string" ? params.url : "";
        const parsedUrl = new URL(rawUrl);
        if (!["http:", "https:"].includes(parsedUrl.protocol)) {
          throw new Error("Only HTTP/HTTPS URLs are allowed");
        }
        const blockedHosts = ["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"];
        const hostname = parsedUrl.hostname.toLowerCase();
        if (
          blockedHosts.includes(hostname) ||
          hostname.endsWith(".local") ||
          hostname.endsWith(".internal") ||
          /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(hostname)
        ) {
          throw new Error("Requests to internal/private addresses are blocked");
        }

        const allowedMethods = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
        const method = (typeof params.method === "string" ? params.method : "GET").toUpperCase();
        if (!allowedMethods.includes(method)) {
          throw new Error(`HTTP method not allowed: ${method}`);
        }

        const response = await fetch(parsedUrl.href, {
          method,
          headers: params.headers || { "Content-Type": "application/json" },
          body: params.body ? JSON.stringify(params.body) : undefined,
          redirect: "manual",
        });
        const data = await response.json().catch(() => response.text());
        return { status: response.status, data };
      }

      case "transform": {
        switch (action) {
          case "set": return (execution.variables[params.variable] = params.value);
          case "append": {
            const arr = execution.variables[params.variable] || [];
            arr.push(params.value);
            execution.variables[params.variable] = arr;
            return arr;
          }
          case "merge": return Object.assign(execution.variables, params.data);
          case "filter": {
            const source = execution.variables[params.source] || [];
            return source.filter((item: any) =>
              params.field ? item[params.field]?.toString().includes(params.match) : true
            );
          }
          case "map": {
            const src = execution.variables[params.source] || [];
            return src.map((item: any) => params.field ? item[params.field] : item);
          }
          case "jsonParse": return JSON.parse(params.data);
          case "template": return this.resolveTemplate(params.template, execution.variables);
          default: throw new Error(`Unknown transform action: ${action}`);
        }
      }

      case "notify": {
        this.emit("workflow:notification", {
          executionId: execution.id,
          message: params.message,
          level: params.level || "info",
          data: params.data,
        });
        return { notified: true };
      }

      default:
        throw new Error(`Unknown tool: ${tool}`);
    }
  }

  private async executeConditionStep(
    execution: WorkflowExecution,
    step: ConditionStep,
    workflow: WorkflowDefinition
  ): Promise<void> {
    const value = this.resolveVariable(step.condition.variable, execution.variables);
    const condMet = this.evaluateCondition(value, step.condition.operator, step.condition.value);

    if (condMet) {
      await this.executeSteps(execution, step.then, workflow);
    } else if (step.else) {
      await this.executeSteps(execution, step.else, workflow);
    }
  }

  private async executeLoopStep(
    execution: WorkflowExecution,
    step: LoopStep,
    workflow: WorkflowDefinition
  ): Promise<void> {
    const maxIter = step.maxIterations || 100;

    if (step.mode === "forEach" && step.collection) {
      const collection = this.resolveVariable(step.collection, execution.variables);
      if (!Array.isArray(collection)) throw new Error(`${step.collection} is not an array`);

      for (let i = 0; i < Math.min(collection.length, maxIter); i++) {
        if (this.cancelTokens.has(execution.id)) throw new Error("Workflow cancelled");

        if (step.iteratorVariable) execution.variables[step.iteratorVariable] = collection[i];
        if (step.indexVariable) execution.variables[step.indexVariable] = i;

        await this.executeSteps(execution, step.steps, workflow);
      }
    } else if (step.mode === "while" && step.condition) {
      let iter = 0;
      while (iter < maxIter) {
        if (this.cancelTokens.has(execution.id)) throw new Error("Workflow cancelled");

        const value = this.resolveVariable(step.condition.variable, execution.variables);
        if (!this.evaluateCondition(value, step.condition.operator, step.condition.value)) break;

        if (step.indexVariable) execution.variables[step.indexVariable] = iter;
        await this.executeSteps(execution, step.steps, workflow);
        iter++;
      }
    } else if (step.mode === "times" && step.count) {
      for (let i = 0; i < Math.min(step.count, maxIter); i++) {
        if (this.cancelTokens.has(execution.id)) throw new Error("Workflow cancelled");

        if (step.indexVariable) execution.variables[step.indexVariable] = i;
        await this.executeSteps(execution, step.steps, workflow);
      }
    }
  }

  private async executeParallelStep(
    execution: WorkflowExecution,
    step: ParallelStep,
    workflow: WorkflowDefinition
  ): Promise<void> {
    const promises = step.branches.map((branch) =>
      this.executeSteps(execution, branch, workflow)
    );

    if (step.failFast) {
      await Promise.all(promises);
    } else {
      await Promise.allSettled(promises);
    }
  }

  private async executeSubworkflowStep(
    execution: WorkflowExecution,
    step: SubworkflowStep
  ): Promise<void> {
    const subWorkflow = this.workflows.get(step.workflowId);
    if (!subWorkflow) throw new Error(`Subworkflow not found: ${step.workflowId}`);

    const inputVars: Record<string, any> = {};
    if (step.inputVariables) {
      for (const [key, varName] of Object.entries(step.inputVariables)) {
        inputVars[key] = this.resolveVariable(varName, execution.variables);
      }
    }

    const subExecution = await this.executeWorkflow(subWorkflow, {
      ...execution.variables,
      ...inputVars,
    });

    // Merge sub-execution variables back
    Object.assign(execution.variables, subExecution.variables);
  }

  // ============================================
  // Helpers
  // ============================================

  private evaluateCondition(value: any, operator: string, target: any): boolean {
    switch (operator) {
      case "equals": return value === target;
      case "not_equals": return value !== target;
      case "contains": return String(value).includes(String(target));
      case "not_contains": return !String(value).includes(String(target));
      case "greater": return Number(value) > Number(target);
      case "less": return Number(value) < Number(target);
      case "exists": return value !== undefined && value !== null;
      case "not_exists": return value === undefined || value === null;
      case "matches": return new RegExp(String(target)).test(String(value));
      default: return false;
    }
  }

  private resolveVariables(params: Record<string, any>, variables: Record<string, any>): Record<string, any> {
    const resolved: Record<string, any> = {};
    for (const [key, value] of Object.entries(params)) {
      if (typeof value === "string") {
        resolved[key] = this.resolveTemplate(value, variables);
      } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        resolved[key] = this.resolveVariables(value, variables);
      } else {
        resolved[key] = value;
      }
    }
    return resolved;
  }

  private resolveVariable(path: string, variables: Record<string, any>): any {
    const parts = path.split(".");
    let current: any = variables;
    for (const part of parts) {
      if (current === undefined || current === null) return undefined;
      current = current[part];
    }
    return current;
  }

  private resolveTemplate(template: string, variables: Record<string, any>): string {
    return template.replace(/\{\{([\w.]+)\}\}/g, (_, path) => {
      const value = this.resolveVariable(path, variables);
      return value !== undefined ? String(value) : `{{${path}}}`;
    });
  }

  private countSteps(steps: WorkflowStep[]): number {
    let count = 0;
    for (const step of steps) {
      count++;
      if (step.type === "condition") {
        count += this.countSteps(step.then);
        if (step.else) count += this.countSteps(step.else);
      } else if (step.type === "loop") {
        count += this.countSteps(step.steps);
      } else if (step.type === "parallel") {
        for (const branch of step.branches) {
          count += this.countSteps(branch);
        }
      }
    }
    return count;
  }
}

export const workflowEngine = new WorkflowEngine();
