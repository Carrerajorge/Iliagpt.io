import { randomUUID } from "crypto";
import type { ToolArtifact, ToolResult } from "../toolRegistry";
import type {
  RuntimeExecutionResult,
  RuntimeExecutorHooks,
  RuntimeSnapshot,
  RuntimeStatus,
  RuntimeTaskGraph,
  RuntimeTaskNode,
  RuntimeTaskState,
  RuntimeTaskStatus,
  RuntimeValidationResult,
  TaskValidationRule,
} from "./types";

function isOutputPresent(output: any): boolean {
  if (output === null || output === undefined) return false;
  if (typeof output === "string") return output.trim().length > 0;
  if (Array.isArray(output)) return output.length > 0;
  if (typeof output === "object") return Object.keys(output).length > 0;
  return true;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("Run cancelled"));
      return;
    }
    const timeout = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timeout);
      reject(new Error("Run cancelled"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function eventPhase(status: RuntimeStatus): "planning" | "executing" | "verifying" | "completed" | "failed" | "cancelled" {
  if (status === "planning") return "planning";
  if (status === "running") return "executing";
  if (status === "verifying") return "verifying";
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  return "cancelled";
}

export class ConcurrentTaskExecutor {
  private readonly hooks: RuntimeExecutorHooks;
  private readonly taskStates = new Map<string, RuntimeTaskState>();
  private readonly queue: string[] = [];
  private readonly queued = new Set<string>();
  private readonly artifacts: ToolArtifact[] = [];
  private readonly validations: RuntimeValidationResult[] = [];
  private status: RuntimeStatus = "planning";

  constructor(hooks: RuntimeExecutorHooks) {
    this.hooks = hooks;
  }

  async execute(graph: RuntimeTaskGraph): Promise<RuntimeExecutionResult> {
    const startedAt = Date.now();
    const workers = Math.max(1, this.hooks.maxWorkers ?? graph.maxConcurrency ?? 2);

    for (const task of graph.tasks) {
      this.taskStates.set(task.id, {
        taskId: task.id,
        index: task.index,
        status: "pending",
        attempt: 0,
      });
    }

    try {
      await this.emitSkillLifecycle(graph);
      await this.emitTaskCreated(graph);
      await this.persistSnapshot(graph);

      this.status = "running";
      await this.persistSnapshot(graph);

      await this.runQueue(graph, workers);

      if (this.hooks.signal.aborted) {
        this.status = "cancelled";
        await this.hooks.emitTraceEvent("cancelled", {
          phase: "cancelled",
          status: "cancelled",
          summary: "Agent runtime cancelled",
        });
        await this.persistSnapshot(graph);
        return {
          success: false,
          status: "cancelled",
          taskStates: Array.from(this.taskStates.values()),
          artifacts: [...this.artifacts],
          validations: [...this.validations],
          deliveryPack: {
            artifactPaths: [],
            artifacts: [],
            executionCommands: [],
            automatedChecks: [],
            reproductionSteps: [],
          },
          summary: "Execution cancelled by user.",
          error: "Run cancelled",
        };
      }

      const failedTasks = Array.from(this.taskStates.values()).filter((task) =>
        task.status === "failed" || task.status === "cancelled"
      );

      if (failedTasks.length > 0) {
        this.status = "failed";
        const failedIds = failedTasks.map((task) => task.taskId).join(", ");
        await this.persistSnapshot(graph);
        return {
          success: false,
          status: "failed",
          taskStates: Array.from(this.taskStates.values()),
          artifacts: [...this.artifacts],
          validations: [...this.validations],
          deliveryPack: {
            artifactPaths: this.artifacts.map((artifact) => artifact.url || "").filter(Boolean),
            artifacts: this.artifacts.map((artifact) => ({
              name: artifact.name,
              type: artifact.type,
              url: artifact.url,
              mimeType: artifact.mimeType,
              size: artifact.size,
            })),
            executionCommands: [],
            automatedChecks: [...this.validations],
            reproductionSteps: [
              "1. Revisar los eventos del runtime para ubicar la primera tarea fallida.",
              "2. Corregir el input o dependencia de esa tarea.",
              "3. Reintentar la ejecución desde el mismo objetivo.",
            ],
          },
          summary: "Execution ended with task failures.",
          error: `Failed tasks: ${failedIds}`,
        };
      }

      this.status = "verifying";
      await this.persistSnapshot(graph);
      const globalValidationPassed = await this.runGlobalValidations(graph);
      if (!globalValidationPassed) {
        this.status = "failed";
        await this.persistSnapshot(graph);
        return {
          success: false,
          status: "failed",
          taskStates: Array.from(this.taskStates.values()),
          artifacts: [...this.artifacts],
          validations: [...this.validations],
          deliveryPack: {
            artifactPaths: this.artifacts.map((artifact) => artifact.url || "").filter(Boolean),
            artifacts: this.artifacts.map((artifact) => ({
              name: artifact.name,
              type: artifact.type,
              url: artifact.url,
              mimeType: artifact.mimeType,
              size: artifact.size,
            })),
            executionCommands: graph.globalValidations
              .filter((rule) => rule.type === "command_exit_zero" && rule.command)
              .map((rule) => rule.command as string),
            automatedChecks: [...this.validations],
            reproductionSteps: [
              "1. Ejecutar los comandos de verificación del pack.",
              "2. Corregir las fallas de lint/test/smoke.",
              "3. Volver a lanzar el agente.",
            ],
          },
          summary: "Execution stopped because DoD validation failed.",
          error: "Global validation failed",
        };
      }

      const deliveryPack = this.buildDeliveryPack(graph);
      const requiredArtifacts = graph.tasks.flatMap((task) =>
        (task.expectedArtifacts || []).filter((artifact) => artifact.required)
      );
      const missingRequired = requiredArtifacts.filter((expected) => {
        return !this.artifacts.some((artifact) => {
          if (expected.name && artifact.name === expected.name) return true;
          if (expected.type && artifact.type === expected.type) return true;
          return false;
        });
      });

      const deliveryValidation: RuntimeValidationResult = {
        id: "global-delivery-pack",
        name: "Delivery pack assembled",
        type: "output_present",
        passed: missingRequired.length === 0,
        message: missingRequired.length === 0
          ? "Delivery pack assembled with required artifacts."
          : `Missing required artifacts: ${missingRequired.map((item) => item.name).join(", ")}`,
      };
      this.validations.push(deliveryValidation);

      if (!deliveryValidation.passed) {
        await this.hooks.emitTraceEvent("validation_failed", {
          phase: "verifying",
          status: "failed",
          summary: deliveryValidation.message,
          metadata: deliveryValidation,
        });
        this.status = "failed";
        await this.persistSnapshot(graph);
        return {
          success: false,
          status: "failed",
          taskStates: Array.from(this.taskStates.values()),
          artifacts: [...this.artifacts],
          validations: [...this.validations],
          deliveryPack,
          summary: "Delivery pack validation failed.",
          error: deliveryValidation.message,
        };
      }

      await this.hooks.emitTraceEvent("validation_passed", {
        phase: "verifying",
        status: "completed",
        summary: deliveryValidation.message,
        metadata: deliveryValidation,
      });

      this.status = "completed";
      const completedTasks = Array.from(this.taskStates.values()).filter((task) => task.status === "completed").length;
      const summary = `Execution completed (${completedTasks}/${graph.tasks.length} tasks).`;

      await this.hooks.emitTraceEvent("final_ready", {
        phase: "completed",
        status: "completed",
        summary,
        metadata: {
          totalTasks: graph.tasks.length,
          completedTasks,
          validations: this.validations,
          deliveryPack,
          durationMs: Date.now() - startedAt,
        },
      });

      await this.persistSnapshot(graph);

      return {
        success: true,
        status: "completed",
        taskStates: Array.from(this.taskStates.values()),
        artifacts: [...this.artifacts],
        validations: [...this.validations],
        deliveryPack,
        summary,
      };
    } catch (error: any) {
      this.status = this.hooks.signal.aborted ? "cancelled" : "failed";
      await this.persistSnapshot(graph);
      return {
        success: false,
        status: this.status,
        taskStates: Array.from(this.taskStates.values()),
        artifacts: [...this.artifacts],
        validations: [...this.validations],
        deliveryPack: {
          artifactPaths: [],
          artifacts: [],
          executionCommands: [],
          automatedChecks: [...this.validations],
          reproductionSteps: [],
        },
        summary: "Execution failed unexpectedly.",
        error: error?.message || "Unknown runtime error",
      };
    }
  }

  private async emitSkillLifecycle(graph: RuntimeTaskGraph): Promise<void> {
    const uniqueTools = Array.from(new Set(graph.tasks.map((task) => task.toolName).filter(Boolean)));
    for (const toolName of uniqueTools) {
      await this.hooks.emitTraceEvent("skill_load_started", {
        phase: "planning",
        status: "running",
        tool_name: toolName,
        summary: `Loading skill ${toolName}`,
        metadata: { skill: toolName },
      });
      await this.hooks.emitTraceEvent("skill_load_done", {
        phase: "planning",
        status: "completed",
        tool_name: toolName,
        summary: `Skill ready: ${toolName}`,
        metadata: { skill: toolName },
      });
    }
  }

  private async emitTaskCreated(graph: RuntimeTaskGraph): Promise<void> {
    for (const task of graph.tasks) {
      await this.hooks.emitTraceEvent("task_created", {
        stepIndex: task.index,
        stepId: task.id,
        phase: "planning",
        status: "pending",
        tool_name: task.toolName,
        summary: task.description,
        metadata: {
          dependencies: task.dependencies,
          successCriteria: task.successCriteria,
          definitionOfDone: task.definitionOfDone,
          validations: task.validations,
          expectedArtifacts: task.expectedArtifacts,
          retryPolicy: task.retryPolicy,
        },
      });
    }
  }

  private async runQueue(graph: RuntimeTaskGraph, workers: number): Promise<void> {
    const running = new Set<Promise<void>>();

    while (true) {
      if (this.hooks.signal.aborted) return;

      this.enqueueReadyTasks(graph);

      while (running.size < workers && this.queue.length > 0) {
        const taskId = this.queue.shift();
        if (!taskId) break;
        this.queued.delete(taskId);
        const runner = this.runTaskWithRetry(graph, taskId).finally(() => running.delete(runner));
        running.add(runner);
      }

      if (running.size === 0) {
        const unfinished = Array.from(this.taskStates.values()).filter((task) =>
          ["pending", "ready", "running", "retry_scheduled"].includes(task.status)
        );
        if (unfinished.length === 0) {
          return;
        }

        // Dependency deadlock or blocked tasks after failure.
        for (const task of unfinished) {
          const from = task.status;
          task.status = "skipped";
          task.completedAt = Date.now();
          this.emitTransition(task, from, "skipped", task.attempt, undefined, "Skipped due to unresolved dependencies");
        }
        await this.persistSnapshot(graph);
        return;
      }

      await Promise.race(running);
    }
  }

  private enqueueReadyTasks(graph: RuntimeTaskGraph): void {
    for (const task of graph.tasks) {
      const state = this.taskStates.get(task.id);
      if (!state) continue;
      if (state.status !== "pending") continue;

      const depStates = task.dependencies
        .map((dep) => this.taskStates.get(dep))
        .filter((dep): dep is RuntimeTaskState => Boolean(dep));

      if (depStates.some((dep) => dep.status === "failed" || dep.status === "cancelled" || dep.status === "skipped")) {
        const from = state.status;
        state.status = "skipped";
        state.completedAt = Date.now();
        this.emitTransition(state, from, "skipped", state.attempt, undefined, "Skipped because dependency failed");
        continue;
      }

      const allDone = depStates.every((dep) => dep.status === "completed");
      if (!allDone) continue;

      const from = state.status;
      state.status = "ready";
      this.emitTransition(state, from, "ready", state.attempt);

      if (!this.queued.has(task.id)) {
        this.queue.push(task.id);
        this.queued.add(task.id);
      }
    }
  }

  private async runTaskWithRetry(graph: RuntimeTaskGraph, taskId: string): Promise<void> {
    const task = graph.tasks.find((item) => item.id === taskId);
    const state = this.taskStates.get(taskId);
    if (!task || !state) return;

    const maxAttempts = Math.max(1, task.retryPolicy.maxAttempts || 1);
    let lastError = "Unknown error";

    for (let attempt = state.attempt + 1; attempt <= maxAttempts; attempt++) {
      if (this.hooks.signal.aborted) {
        const from = state.status;
        state.status = "cancelled";
        this.emitTransition(state, from, "cancelled", attempt, undefined, "Run cancelled");
        return;
      }

      state.attempt = attempt;
      const from = state.status;
      state.status = "running";
      if (!state.startedAt) state.startedAt = Date.now();
      this.emitTransition(state, from, "running", attempt);

      await this.hooks.emitTraceEvent("task_started", {
        stepIndex: task.index,
        stepId: task.id,
        phase: "executing",
        status: "running",
        tool_name: task.toolName,
        summary: task.description,
        metadata: {
          attempt,
          dependencies: task.dependencies,
          successCriteria: task.successCriteria,
          definitionOfDone: task.definitionOfDone,
        },
      });

      const correlationId = randomUUID();

      await this.hooks.emitTraceEvent("tool_call_started", {
        stepIndex: task.index,
        stepId: task.id,
        phase: "executing",
        status: "running",
        tool_name: task.toolName,
        command: JSON.stringify(task.input).slice(0, 500),
        metadata: {
          attempt,
          correlationId,
          taskId: task.id,
        },
      });

      let chunkSequence = 0;
      const result = await this.hooks.executeTool(task.toolName, task.input, {
        stepIndex: task.index,
        correlationId,
        onStream: (evt) => {
          chunkSequence += 1;
          const chunk = String(evt.chunk || "");
          void this.hooks.emitTraceEvent("tool_call_delta", {
            stepIndex: task.index,
            stepId: task.id,
            phase: "executing",
            status: "running",
            tool_name: task.toolName,
            output_snippet: chunk.slice(0, 1200),
            chunk_sequence: chunkSequence,
            metadata: {
              stream: evt.stream,
              correlationId,
              isTruncated: chunk.length > 1200,
            },
          });
        },
      });

      await this.hooks.emitTraceEvent("tool_call_done", {
        stepIndex: task.index,
        stepId: task.id,
        phase: "executing",
        status: result.success ? "completed" : "failed",
        tool_name: task.toolName,
        output_snippet: isOutputPresent(result.output)
          ? JSON.stringify(result.output).slice(0, 500)
          : undefined,
        error: result.success
          ? undefined
          : {
              code: result.error?.code,
              message: result.error?.message || "Tool execution failed",
              retryable: result.error?.retryable,
            },
        metadata: {
          attempt,
          correlationId,
          artifactCount: result.artifacts?.length || 0,
        },
      });

      const failedValidations = await this.runTaskValidations(task, result);
      if ((result.artifacts || []).length > 0) {
        await this.emitArtifacts(task, result.artifacts || []);
      }

      if (result.success && failedValidations.length === 0) {
        state.result = result;
        state.completedAt = Date.now();
        const fromStatus = state.status;
        state.status = "completed";
        this.emitTransition(state, fromStatus, "completed", attempt, result);
        await this.persistSnapshot(graph);
        return;
      }

      lastError = result.error?.message || failedValidations[0]?.message || "Task validation failed";
      state.lastError = lastError;

      if (attempt < maxAttempts) {
        const fromStatus = state.status;
        state.status = "retry_scheduled";
        this.emitTransition(state, fromStatus, "retry_scheduled", attempt, result, lastError);
        await this.hooks.emitTraceEvent("retry_scheduled", {
          stepIndex: task.index,
          stepId: task.id,
          phase: "executing",
          status: "retrying",
          summary: `Retry scheduled for task ${task.id}`,
          metadata: {
            attempt,
            nextAttempt: attempt + 1,
            maxAttempts,
            delayMs: task.retryPolicy.backoffMs,
            reason: lastError,
          },
        });
        await this.persistSnapshot(graph);
        await sleep(task.retryPolicy.backoffMs, this.hooks.signal);
        continue;
      }

      state.completedAt = Date.now();
      const fromStatus = state.status;
      state.status = "failed";
      this.emitTransition(state, fromStatus, "failed", attempt, result, lastError);
      await this.persistSnapshot(graph);
      return;
    }
  }

  private async runTaskValidations(task: RuntimeTaskNode, result: ToolResult): Promise<RuntimeValidationResult[]> {
    const failed: RuntimeValidationResult[] = [];

    for (const rule of task.validations) {
      const validation = this.evaluateValidationRule(rule, task, result);
      this.validations.push(validation);
      const eventType = validation.passed ? "validation_passed" : "validation_failed";
      await this.hooks.emitTraceEvent(eventType, {
        stepIndex: task.index,
        stepId: task.id,
        phase: "verifying",
        status: validation.passed ? "completed" : "failed",
        summary: validation.message,
        metadata: validation,
      });

      if (!validation.passed && rule.required) {
        failed.push(validation);
      }
    }

    return failed;
  }

  private evaluateValidationRule(
    rule: TaskValidationRule,
    task: RuntimeTaskNode,
    result: ToolResult
  ): RuntimeValidationResult {
    if (rule.type === "tool_success") {
      const passed = Boolean(result.success);
      return {
        id: rule.id,
        name: rule.name,
        type: rule.type,
        passed,
        message: passed ? `${task.id}: tool execution succeeded` : `${task.id}: tool execution failed`,
        taskId: task.id,
        taskIndex: task.index,
      };
    }

    if (rule.type === "output_present") {
      const passed = isOutputPresent(result.output);
      return {
        id: rule.id,
        name: rule.name,
        type: rule.type,
        passed,
        message: passed ? `${task.id}: output captured` : `${task.id}: output missing`,
        taskId: task.id,
        taskIndex: task.index,
      };
    }

    if (rule.type === "artifact_present") {
      const artifacts = result.artifacts || [];
      const passed = artifacts.some((artifact) => {
        if (rule.artifactName && artifact.name === rule.artifactName) return true;
        if (rule.artifactType && artifact.type === rule.artifactType) return true;
        return false;
      });
      return {
        id: rule.id,
        name: rule.name,
        type: rule.type,
        passed,
        message: passed
          ? `${task.id}: expected artifact generated`
          : `${task.id}: expected artifact not generated`,
        taskId: task.id,
        taskIndex: task.index,
      };
    }

    return {
      id: rule.id,
      name: rule.name,
      type: rule.type,
      passed: true,
      message: `${task.id}: validation ${rule.name} skipped`,
      taskId: task.id,
      taskIndex: task.index,
    };
  }

  private async emitArtifacts(task: RuntimeTaskNode, artifacts: ToolArtifact[]): Promise<void> {
    for (const artifact of artifacts) {
      this.artifacts.push(artifact);
      await this.hooks.emitTraceEvent("artifact_written", {
        stepIndex: task.index,
        stepId: task.id,
        phase: "executing",
        status: "completed",
        artifact: {
          type: artifact.type,
          name: artifact.name,
          url: artifact.url,
          data: artifact.data,
        },
        summary: `Artifact written: ${artifact.name}`,
      });
    }
  }

  private async runGlobalValidations(graph: RuntimeTaskGraph): Promise<boolean> {
    let allPassed = true;
    const commandRules = graph.globalValidations.filter((rule) => rule.type === "command_exit_zero");

    for (const rule of commandRules) {
      const command = rule.command || "";
      const startedAt = Date.now();
      const validationStepIndex = graph.tasks.length + this.validations.length;
      await this.hooks.emitTraceEvent("tool_call_started", {
        stepIndex: validationStepIndex,
        stepId: `validation-${rule.id}`,
        phase: "verifying",
        status: "running",
        tool_name: "shell_command",
        command,
        summary: `Running validation command: ${command}`,
      });

      const result = await this.hooks.executeTool("shell_command", { command, timeout: 120000 }, {
        stepIndex: validationStepIndex,
        correlationId: randomUUID(),
        onStream: (evt) => {
          void this.hooks.emitTraceEvent("tool_call_delta", {
            stepIndex: validationStepIndex,
            stepId: `validation-${rule.id}`,
            phase: "verifying",
            status: "running",
            tool_name: "shell_command",
            output_snippet: String(evt.chunk || "").slice(0, 1200),
            metadata: {
              stream: evt.stream,
            },
          });
        },
      });

      await this.hooks.emitTraceEvent("tool_call_done", {
        stepIndex: validationStepIndex,
        stepId: `validation-${rule.id}`,
        phase: "verifying",
        status: result.success ? "completed" : "failed",
        tool_name: "shell_command",
        command,
        output_snippet: isOutputPresent(result.output) ? JSON.stringify(result.output).slice(0, 500) : undefined,
        error: result.success
          ? undefined
          : {
              code: result.error?.code,
              message: result.error?.message || "Validation command failed",
              retryable: false,
            },
      });

      const passed = Boolean(result.success);
      const validation: RuntimeValidationResult = {
        id: rule.id,
        name: rule.name,
        type: rule.type,
        passed,
        message: passed ? `${rule.name} passed` : `${rule.name} failed`,
        command,
        durationMs: Date.now() - startedAt,
      };
      this.validations.push(validation);
      await this.hooks.emitTraceEvent(passed ? "validation_passed" : "validation_failed", {
        phase: "verifying",
        status: passed ? "completed" : "failed",
        summary: validation.message,
        metadata: validation,
      });

      if (!passed && rule.required) {
        allPassed = false;
      }
    }

    return allPassed;
  }

  private buildDeliveryPack(graph: RuntimeTaskGraph) {
    const commandChecks = graph.globalValidations
      .filter((rule) => rule.type === "command_exit_zero" && rule.command)
      .map((rule) => rule.command as string);

    const artifactList = this.artifacts.map((artifact) => ({
      name: artifact.name,
      type: artifact.type,
      url: artifact.url,
      mimeType: artifact.mimeType,
      size: artifact.size,
    }));

    const artifactPaths = artifactList.map((artifact) => artifact.url || "").filter(Boolean);

    return {
      artifactPaths,
      artifacts: artifactList,
      executionCommands: commandChecks,
      automatedChecks: this.validations.filter((validation) =>
        validation.type === "command_exit_zero" || validation.taskId !== undefined
      ),
      reproductionSteps: [
        "1. Revisar el bloque de artefactos y abrir cada ruta/url generada.",
        "2. Ejecutar los comandos en \"executionCommands\" desde la raíz del proyecto.",
        "3. Verificar que todos los checks en \"automatedChecks\" estén en estado passed.",
      ],
    };
  }

  private emitTransition(
    state: RuntimeTaskState,
    from: RuntimeTaskStatus,
    to: RuntimeTaskStatus,
    attempt: number,
    result?: ToolResult,
    error?: string
  ): void {
    this.hooks.onTransition?.({
      taskId: state.taskId,
      taskIndex: state.index,
      from,
      to,
      attempt,
      result,
      error,
    });
  }

  private async persistSnapshot(graph: RuntimeTaskGraph): Promise<void> {
    if (!this.hooks.persistSnapshot) return;

    const snapshot: RuntimeSnapshot = {
      runId: this.hooks.runId,
      graphId: graph.graphId,
      status: this.status,
      updatedAt: Date.now(),
      queueDepth: this.queue.length,
      activeTasks: Array.from(this.taskStates.values())
        .filter((task) => task.status === "running")
        .map((task) => task.taskId),
      tasks: Array.from(this.taskStates.values()).map((task) => ({
        taskId: task.taskId,
        index: task.index,
        status: task.status,
        attempt: task.attempt,
        startedAt: task.startedAt,
        completedAt: task.completedAt,
        lastError: task.lastError,
      })),
      validations: [...this.validations],
      artifacts: this.artifacts.map((artifact) => ({
        id: artifact.id,
        name: artifact.name,
        type: artifact.type,
        url: artifact.url,
      })),
    };

    await this.hooks.persistSnapshot(snapshot);

    await this.hooks.emitTraceEvent("progress_update", {
      phase: eventPhase(this.status),
      status: this.status === "running"
        ? "running"
        : this.status === "planning"
          ? "pending"
          : this.status === "verifying"
            ? "running"
            : this.status === "completed"
              ? "completed"
              : this.status === "cancelled"
                ? "cancelled"
                : "failed",
      summary: `Snapshot persisted (${snapshot.tasks.length} tasks)`,
      metadata: {
        snapshot: {
          graphId: snapshot.graphId,
          status: snapshot.status,
          updatedAt: snapshot.updatedAt,
          queueDepth: snapshot.queueDepth,
          activeTasks: snapshot.activeTasks,
          tasks: snapshot.tasks,
        },
      },
    });
  }
}
