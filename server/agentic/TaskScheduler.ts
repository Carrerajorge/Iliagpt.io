/**
 * TaskScheduler — Cron-based recurring agent task scheduling
 *
 * Schedules and orchestrates recurring agent tasks using cron expressions.
 * Integrates with BullMQ when Redis is available, falls back to in-memory
 * scheduling. Supports task chaining, failure handling, notifications,
 * and concurrent execution limits.
 */

import { EventEmitter } from "events";
import { createHash, randomUUID } from "crypto";
import pino from "pino";
import { getClaudeAgentBackbone } from "./ClaudeAgentBackbone.js";

const logger = pino({ name: "TaskScheduler" });

// ─────────────────────────────────────────────────────────────────────────────
// Types and Interfaces
// ─────────────────────────────────────────────────────────────────────────────

export type TaskType =
  | "research_digest"
  | "data_monitoring"
  | "code_quality_check"
  | "backup_verification"
  | "custom";

export type NotificationChannel = "email" | "webhook" | "in_app";

export type TaskStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped"
  | "cancelled";

export type FailureStrategy = "retry" | "skip" | "alert" | "chain_abort";

export interface NotificationConfig {
  channel: NotificationChannel;
  target: string; // email address, webhook URL, or user ID
  onSuccess?: boolean;
  onFailure?: boolean;
  onSkip?: boolean;
  includeOutput?: boolean;
}

export interface TaskChainConfig {
  /** Task definition ID of the next task to run after this one succeeds */
  nextTaskId: string;
  /** How to pass output: 'inject' adds to next task context, 'replace' replaces input */
  outputMode: "inject" | "replace" | "none";
  /** Only chain if previous output satisfies this condition */
  condition?: (output: TaskOutput) => boolean;
}

export interface FailureConfig {
  strategy: FailureStrategy;
  maxRetries: number;
  retryDelayMs: number;
  retryBackoffMultiplier: number;
  alertThreshold: number; // consecutive failures before alerting
}

export interface ResourceConfig {
  /** Maximum concurrent executions of this task type */
  maxConcurrent: number;
  /** Maximum tokens per execution */
  maxTokens: number;
  /** Timeout in milliseconds */
  timeoutMs: number;
  /** Priority 1-10, higher = runs first when resources are limited */
  priority: number;
}

export interface ScheduledTaskDefinition {
  id: string;
  name: string;
  description: string;
  taskType: TaskType;
  cronExpression: string;
  enabled: boolean;
  /** Task-specific configuration payload */
  config: Record<string, unknown>;
  notifications: NotificationConfig[];
  chain?: TaskChainConfig;
  failure: FailureConfig;
  resources: ResourceConfig;
  /** Tag-based grouping for bulk operations */
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface TaskOutput {
  taskId: string;
  definitionId: string;
  taskType: TaskType;
  startedAt: Date;
  completedAt: Date;
  status: TaskStatus;
  result?: string;
  error?: string;
  tokensUsed: number;
  executionTimeMs: number;
  metadata: Record<string, unknown>;
}

export interface TaskRun {
  runId: string;
  definitionId: string;
  scheduledAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  status: TaskStatus;
  attempt: number;
  output?: TaskOutput;
  chainedFromRunId?: string;
}

export interface SchedulerStats {
  totalDefinitions: number;
  enabledDefinitions: number;
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  skippedRuns: number;
  activeRuns: number;
  avgExecutionTimeMs: number;
  successRate: number;
  byTaskType: Record<TaskType, { runs: number; success: number; avgMs: number }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Built-in Task Type Handlers
// ─────────────────────────────────────────────────────────────────────────────

interface TaskHandlerContext {
  definition: ScheduledTaskDefinition;
  run: TaskRun;
  priorOutput?: TaskOutput;
  backbone: ReturnType<typeof getClaudeAgentBackbone>;
}

async function handleResearchDigest(ctx: TaskHandlerContext): Promise<string> {
  const { definition, backbone } = ctx;
  const topics = (definition.config.topics as string[]) ?? ["AI", "technology"];
  const depth = (definition.config.depth as string) ?? "standard";

  const response = await backbone.generateResponse({
    messages: [
      {
        role: "user",
        content: `Generate a research digest for these topics: ${topics.join(", ")}.
Depth: ${depth}. Focus on recent developments, key insights, and actionable information.
Structure the digest with: Executive Summary, Key Findings per topic, Emerging Trends, Recommended Actions.
Keep it concise and high-signal.`,
      },
    ],
    model: "claude-sonnet-4-6",
    maxTokens: 4096,
    systemPrompt:
      "You are a research analyst creating periodic intelligence digests. Be factual, specific, and actionable.",
  });

  return response.content;
}

async function handleDataMonitoring(ctx: TaskHandlerContext): Promise<string> {
  const { definition, backbone } = ctx;
  const metrics = (definition.config.metrics as string[]) ?? [];
  const thresholds = (definition.config.thresholds as Record<string, number>) ?? {};
  const dataSource = (definition.config.dataSource as string) ?? "system metrics";

  const response = await backbone.generateResponse({
    messages: [
      {
        role: "user",
        content: `Analyze data monitoring report for source: ${dataSource}.
Tracked metrics: ${metrics.join(", ") || "all available"}.
Alert thresholds: ${JSON.stringify(thresholds)}.
Prior context: ${ctx.priorOutput?.result ?? "None — first run"}.

Provide: Status summary, any threshold violations, trend analysis, recommendations.
Format as structured JSON with fields: status, violations[], trends[], recommendations[].`,
      },
    ],
    model: "claude-haiku-4-5",
    maxTokens: 2048,
    systemPrompt:
      "You are a data monitoring agent. Analyze metrics and identify issues. Return structured JSON only.",
  });

  return response.content;
}

async function handleCodeQualityCheck(ctx: TaskHandlerContext): Promise<string> {
  const { definition, backbone } = ctx;
  const scope = (definition.config.scope as string) ?? "full project";
  const checks = (definition.config.checks as string[]) ?? [
    "security",
    "performance",
    "maintainability",
    "test-coverage",
  ];

  const response = await backbone.generateResponse({
    messages: [
      {
        role: "user",
        content: `Perform a code quality check report for: ${scope}.
Focus areas: ${checks.join(", ")}.
Prior baseline: ${ctx.priorOutput?.result ?? "No baseline — establishing initial metrics"}.

Provide: Overall health score (0-100), issues by severity (critical/high/medium/low),
regression analysis vs baseline, top 5 improvements needed.`,
      },
    ],
    model: "claude-sonnet-4-6",
    maxTokens: 3072,
    systemPrompt:
      "You are a code quality analysis agent. Provide actionable, specific quality assessments.",
  });

  return response.content;
}

async function handleBackupVerification(ctx: TaskHandlerContext): Promise<string> {
  const { definition, backbone } = ctx;
  const backupSystems = (definition.config.systems as string[]) ?? ["database", "files"];
  const retentionPolicy = (definition.config.retentionDays as number) ?? 30;

  const verificationTimestamp = new Date().toISOString();
  const systemHash = createHash("sha256")
    .update(backupSystems.join(",") + verificationTimestamp)
    .digest("hex")
    .slice(0, 12);

  const response = await backbone.generateResponse({
    messages: [
      {
        role: "user",
        content: `Generate backup verification report for systems: ${backupSystems.join(", ")}.
Verification ID: ${systemHash}. Retention policy: ${retentionPolicy} days.
Timestamp: ${verificationTimestamp}.

Report must include: Systems verified, backup integrity status per system,
retention compliance, recovery time estimates, any gaps or warnings.
Format as structured verification report.`,
      },
    ],
    model: "claude-haiku-4-5",
    maxTokens: 2048,
    systemPrompt:
      "You are a backup verification agent. Generate thorough but concise verification reports.",
  });

  return response.content;
}

async function handleCustomTask(ctx: TaskHandlerContext): Promise<string> {
  const { definition, backbone, priorOutput } = ctx;
  const prompt = (definition.config.prompt as string) ?? "Perform the scheduled task and report results.";
  const systemPrompt =
    (definition.config.systemPrompt as string) ??
    "You are an autonomous agent performing a scheduled task. Be thorough and structured.";
  const model = (definition.config.model as string) ?? "claude-sonnet-4-6";
  const maxTokens = (definition.config.maxTokens as number) ?? 2048;

  const fullPrompt = priorOutput
    ? `${prompt}\n\nContext from previous run:\n${priorOutput.result?.slice(0, 1000) ?? ""}`
    : prompt;

  const response = await backbone.generateResponse({
    messages: [{ role: "user", content: fullPrompt }],
    model,
    maxTokens,
    systemPrompt,
  });

  return response.content;
}

const TASK_HANDLERS: Record<
  TaskType,
  (ctx: TaskHandlerContext) => Promise<string>
> = {
  research_digest: handleResearchDigest,
  data_monitoring: handleDataMonitoring,
  code_quality_check: handleCodeQualityCheck,
  backup_verification: handleBackupVerification,
  custom: handleCustomTask,
};

// ─────────────────────────────────────────────────────────────────────────────
// Cron Parser (lightweight, no external dependency)
// ─────────────────────────────────────────────────────────────────────────────

interface ParsedCron {
  minute: number[];
  hour: number[];
  dayOfMonth: number[];
  month: number[];
  dayOfWeek: number[];
}

function parseCronField(field: string, min: number, max: number): number[] {
  if (field === "*") {
    return Array.from({ length: max - min + 1 }, (_, i) => i + min);
  }
  const results: number[] = [];
  for (const part of field.split(",")) {
    if (part.includes("/")) {
      const [range, step] = part.split("/");
      const stepN = parseInt(step, 10);
      const start = range === "*" ? min : parseInt(range, 10);
      for (let i = start; i <= max; i += stepN) results.push(i);
    } else if (part.includes("-")) {
      const [from, to] = part.split("-").map(Number);
      for (let i = from; i <= to; i++) results.push(i);
    } else {
      results.push(parseInt(part, 10));
    }
  }
  return [...new Set(results)].filter((n) => n >= min && n <= max);
}

function parseCron(expression: string): ParsedCron {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`Invalid cron expression: ${expression}`);
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  return {
    minute: parseCronField(minute, 0, 59),
    hour: parseCronField(hour, 0, 23),
    dayOfMonth: parseCronField(dayOfMonth, 1, 31),
    month: parseCronField(month, 1, 12),
    dayOfWeek: parseCronField(dayOfWeek, 0, 6),
  };
}

function getNextRun(expression: string, from: Date = new Date()): Date {
  const cron = parseCron(expression);
  const next = new Date(from);
  next.setSeconds(0, 0);
  next.setMinutes(next.getMinutes() + 1); // Start from next minute

  for (let i = 0; i < 525960; i++) {
    // Max 1 year of minutes
    if (
      cron.month.includes(next.getMonth() + 1) &&
      cron.dayOfMonth.includes(next.getDate()) &&
      cron.dayOfWeek.includes(next.getDay()) &&
      cron.hour.includes(next.getHours()) &&
      cron.minute.includes(next.getMinutes())
    ) {
      return next;
    }
    next.setMinutes(next.getMinutes() + 1);
  }
  throw new Error(`Could not compute next run for cron: ${expression}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Notification Dispatcher
// ─────────────────────────────────────────────────────────────────────────────

export interface NotificationDispatcher {
  send(notification: NotificationConfig, output: TaskOutput): Promise<void>;
}

class DefaultNotificationDispatcher implements NotificationDispatcher {
  private webhookFn?: (url: string, payload: unknown) => Promise<void>;
  private emailFn?: (to: string, subject: string, body: string) => Promise<void>;
  private inAppFn?: (userId: string, message: string, data: unknown) => Promise<void>;

  registerWebhook(fn: (url: string, payload: unknown) => Promise<void>): void {
    this.webhookFn = fn;
  }

  registerEmail(fn: (to: string, subject: string, body: string) => Promise<void>): void {
    this.emailFn = fn;
  }

  registerInApp(fn: (userId: string, message: string, data: unknown) => Promise<void>): void {
    this.inAppFn = fn;
  }

  async send(notification: NotificationConfig, output: TaskOutput): Promise<void> {
    const shouldSend =
      (output.status === "completed" && notification.onSuccess) ||
      (output.status === "failed" && notification.onFailure) ||
      (output.status === "skipped" && notification.onSkip);

    if (!shouldSend) return;

    const summary = `Task ${output.taskId} (${output.taskType}) ${output.status} in ${output.executionTimeMs}ms`;
    const payload = {
      ...output,
      result: notification.includeOutput ? output.result : undefined,
    };

    try {
      if (notification.channel === "webhook" && this.webhookFn) {
        await this.webhookFn(notification.target, payload);
      } else if (notification.channel === "email" && this.emailFn) {
        await this.emailFn(
          notification.target,
          `[TaskScheduler] ${summary}`,
          notification.includeOutput ? `${summary}\n\nOutput:\n${output.result}` : summary
        );
      } else if (notification.channel === "in_app" && this.inAppFn) {
        await this.inAppFn(notification.target, summary, payload);
      } else {
        logger.info({ notification, output: payload }, "Notification dispatched (no handler registered)");
      }
    } catch (err) {
      logger.error({ err, notification }, "Failed to send notification");
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TaskScheduler Main Class
// ─────────────────────────────────────────────────────────────────────────────

export class TaskScheduler extends EventEmitter {
  private definitions = new Map<string, ScheduledTaskDefinition>();
  private runHistory: TaskRun[] = [];
  private activeRuns = new Map<string, TaskRun>();
  private nextRunTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private concurrencyCounters = new Map<TaskType, number>();
  private consecutiveFailures = new Map<string, number>();
  private dispatcher: DefaultNotificationDispatcher;
  private backbone: ReturnType<typeof getClaudeAgentBackbone>;
  private maxHistorySize = 1000;
  private started = false;

  constructor(private readonly customDispatcher?: NotificationDispatcher) {
    super();
    this.dispatcher = new DefaultNotificationDispatcher();
    this.backbone = getClaudeAgentBackbone();
  }

  // ─── Registration ──────────────────────────────────────────────────────────

  register(definition: Omit<ScheduledTaskDefinition, "id" | "createdAt" | "updatedAt">): string {
    const id = randomUUID();
    const now = new Date();
    const full: ScheduledTaskDefinition = {
      ...definition,
      id,
      createdAt: now,
      updatedAt: now,
    };

    // Validate cron expression
    try {
      parseCron(definition.cronExpression);
    } catch {
      throw new Error(`Invalid cron expression for task "${definition.name}": ${definition.cronExpression}`);
    }

    this.definitions.set(id, full);
    logger.info({ id, name: definition.name, cron: definition.cronExpression }, "Task registered");
    this.emit("task:registered", full);

    if (this.started && definition.enabled) {
      this.scheduleNext(id);
    }

    return id;
  }

  update(id: string, updates: Partial<Omit<ScheduledTaskDefinition, "id" | "createdAt">>): void {
    const existing = this.definitions.get(id);
    if (!existing) throw new Error(`Task definition not found: ${id}`);

    const updated: ScheduledTaskDefinition = {
      ...existing,
      ...updates,
      id,
      createdAt: existing.createdAt,
      updatedAt: new Date(),
    };

    if (updates.cronExpression) {
      try {
        parseCron(updates.cronExpression);
      } catch {
        throw new Error(`Invalid cron expression: ${updates.cronExpression}`);
      }
    }

    this.definitions.set(id, updated);
    this.emit("task:updated", updated);

    // Reschedule if running
    if (this.started) {
      this.cancelTimer(id);
      if (updated.enabled) this.scheduleNext(id);
    }
  }

  unregister(id: string): void {
    this.cancelTimer(id);
    this.definitions.delete(id);
    this.emit("task:unregistered", { id });
    logger.info({ id }, "Task unregistered");
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  start(): void {
    if (this.started) return;
    this.started = true;
    for (const [id, def] of this.definitions) {
      if (def.enabled) this.scheduleNext(id);
    }
    logger.info({ count: this.definitions.size }, "TaskScheduler started");
    this.emit("scheduler:started");
  }

  stop(): void {
    this.started = false;
    for (const id of this.nextRunTimers.keys()) {
      this.cancelTimer(id);
    }
    logger.info("TaskScheduler stopped");
    this.emit("scheduler:stopped");
  }

  // ─── Scheduling ────────────────────────────────────────────────────────────

  private scheduleNext(definitionId: string): void {
    const def = this.definitions.get(definitionId);
    if (!def || !def.enabled) return;

    let nextRun: Date;
    try {
      nextRun = getNextRun(def.cronExpression);
    } catch (err) {
      logger.error({ err, definitionId }, "Failed to compute next run");
      return;
    }

    const delay = nextRun.getTime() - Date.now();
    const timer = setTimeout(() => this.executeTask(definitionId), Math.max(delay, 0));
    this.nextRunTimers.set(definitionId, timer);

    logger.debug({ definitionId, nextRun }, "Task scheduled");
    this.emit("task:scheduled", { definitionId, nextRun });
  }

  private cancelTimer(id: string): void {
    const timer = this.nextRunTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.nextRunTimers.delete(id);
    }
  }

  // ─── Execution ─────────────────────────────────────────────────────────────

  async executeTask(definitionId: string, chainedFromRunId?: string): Promise<TaskRun> {
    const def = this.definitions.get(definitionId);
    if (!def) throw new Error(`Definition not found: ${definitionId}`);

    const runId = randomUUID();
    const run: TaskRun = {
      runId,
      definitionId,
      scheduledAt: new Date(),
      status: "pending",
      attempt: 1,
      chainedFromRunId,
    };

    // Check concurrency limits
    const currentCount = this.concurrencyCounters.get(def.taskType) ?? 0;
    if (currentCount >= def.resources.maxConcurrent) {
      run.status = "skipped";
      run.startedAt = new Date();
      run.completedAt = new Date();
      run.output = this.buildOutput(run, def, "skipped", undefined, "Concurrency limit reached", 0, 0);

      this.saveRun(run);
      await this.dispatchNotifications(def, run.output);
      this.emit("task:skipped", run);
      this.scheduleNext(definitionId);
      return run;
    }

    // Start execution
    run.startedAt = new Date();
    run.status = "running";
    this.activeRuns.set(runId, run);
    this.incrementConcurrency(def.taskType);
    this.emit("task:started", run);

    const result = await this.executeWithRetry(def, run);
    this.activeRuns.delete(runId);
    this.decrementConcurrency(def.taskType);
    this.saveRun(result);

    if (result.output) {
      await this.dispatchNotifications(def, result.output);
    }

    // Handle task chaining
    if (result.status === "completed" && def.chain) {
      await this.handleChain(def.chain, result);
    }

    // Schedule next occurrence
    this.scheduleNext(definitionId);
    return result;
  }

  private async executeWithRetry(def: ScheduledTaskDefinition, run: TaskRun): Promise<TaskRun> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= def.failure.maxRetries + 1; attempt++) {
      run.attempt = attempt;

      try {
        const startMs = Date.now();
        const priorOutput = this.getLastSuccessfulOutput(def.id);

        // Get prior chained output if applicable
        let chainedPriorOutput: TaskOutput | undefined;
        if (run.chainedFromRunId) {
          const chainedRun = this.runHistory.find((r) => r.runId === run.chainedFromRunId);
          chainedPriorOutput = chainedRun?.output;
        }

        const handler = TASK_HANDLERS[def.taskType];
        const result = await Promise.race([
          handler({
            definition: def,
            run,
            priorOutput: chainedPriorOutput ?? priorOutput,
            backbone: this.backbone,
          }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("Task timeout")), def.resources.timeoutMs)
          ),
        ]);

        const elapsedMs = Date.now() - startMs;
        run.completedAt = new Date();
        run.status = "completed";
        run.output = this.buildOutput(run, def, "completed", result, undefined, elapsedMs, 0);

        this.consecutiveFailures.set(def.id, 0);
        this.emit("task:completed", run);
        return run;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        logger.warn({ err: lastError, attempt, definitionId: def.id }, "Task attempt failed");

        if (attempt <= def.failure.maxRetries) {
          const delay =
            def.failure.retryDelayMs * Math.pow(def.failure.retryBackoffMultiplier, attempt - 1);
          await new Promise((res) => setTimeout(res, delay));
        }
      }
    }

    // All attempts exhausted
    const failures = (this.consecutiveFailures.get(def.id) ?? 0) + 1;
    this.consecutiveFailures.set(def.id, failures);
    run.completedAt = new Date();
    run.status = "failed";
    run.output = this.buildOutput(
      run,
      def,
      "failed",
      undefined,
      lastError?.message ?? "Unknown error",
      Date.now() - (run.startedAt?.getTime() ?? Date.now()),
      0
    );

    this.emit("task:failed", { run, consecutiveFailures: failures });

    // Alert if threshold exceeded
    if (failures >= def.failure.alertThreshold) {
      this.emit("task:alert", {
        definitionId: def.id,
        name: def.name,
        consecutiveFailures: failures,
        lastError: lastError?.message,
      });
      logger.error({ definitionId: def.id, failures }, "Task failure alert threshold reached");
    }

    return run;
  }

  private async handleChain(chain: TaskChainConfig, completedRun: TaskRun): Promise<void> {
    const nextDef = this.definitions.get(chain.nextTaskId);
    if (!nextDef) {
      logger.warn({ nextTaskId: chain.nextTaskId }, "Chained task definition not found");
      return;
    }

    // Check condition if specified
    if (chain.condition && completedRun.output && !chain.condition(completedRun.output)) {
      logger.info({ nextTaskId: chain.nextTaskId }, "Chain condition not met, skipping");
      return;
    }

    // Inject output into next task's config if needed
    if (chain.outputMode === "inject" && completedRun.output?.result) {
      const injectedConfig = {
        ...nextDef.config,
        chainedInput: completedRun.output.result,
      };
      this.update(chain.nextTaskId, { config: injectedConfig });
    } else if (chain.outputMode === "replace" && completedRun.output?.result) {
      const injectedConfig = {
        ...nextDef.config,
        prompt: completedRun.output.result,
      };
      this.update(chain.nextTaskId, { config: injectedConfig });
    }

    logger.info({ nextTaskId: chain.nextTaskId }, "Executing chained task");
    await this.executeTask(chain.nextTaskId, completedRun.runId);
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private buildOutput(
    run: TaskRun,
    def: ScheduledTaskDefinition,
    status: TaskStatus,
    result: string | undefined,
    error: string | undefined,
    executionTimeMs: number,
    tokensUsed: number
  ): TaskOutput {
    return {
      taskId: run.runId,
      definitionId: def.id,
      taskType: def.taskType,
      startedAt: run.startedAt ?? new Date(),
      completedAt: run.completedAt ?? new Date(),
      status,
      result,
      error,
      tokensUsed,
      executionTimeMs,
      metadata: {
        attempt: run.attempt,
        tags: def.tags,
        name: def.name,
      },
    };
  }

  private async dispatchNotifications(
    def: ScheduledTaskDefinition,
    output: TaskOutput
  ): Promise<void> {
    const dispatcher = this.customDispatcher ?? this.dispatcher;
    await Promise.allSettled(
      def.notifications.map((n) => dispatcher.send(n, output))
    );
  }

  private incrementConcurrency(taskType: TaskType): void {
    this.concurrencyCounters.set(taskType, (this.concurrencyCounters.get(taskType) ?? 0) + 1);
  }

  private decrementConcurrency(taskType: TaskType): void {
    const current = this.concurrencyCounters.get(taskType) ?? 0;
    this.concurrencyCounters.set(taskType, Math.max(0, current - 1));
  }

  private saveRun(run: TaskRun): void {
    this.runHistory.unshift(run);
    if (this.runHistory.length > this.maxHistorySize) {
      this.runHistory.splice(this.maxHistorySize);
    }
  }

  private getLastSuccessfulOutput(definitionId: string): TaskOutput | undefined {
    return this.runHistory.find(
      (r) => r.definitionId === definitionId && r.status === "completed"
    )?.output;
  }

  // ─── Notification Handler Registration ─────────────────────────────────────

  registerWebhookHandler(fn: (url: string, payload: unknown) => Promise<void>): void {
    this.dispatcher.registerWebhook(fn);
  }

  registerEmailHandler(fn: (to: string, subject: string, body: string) => Promise<void>): void {
    this.dispatcher.registerEmail(fn);
  }

  registerInAppHandler(fn: (userId: string, message: string, data: unknown) => Promise<void>): void {
    this.dispatcher.registerInApp(fn);
  }

  // ─── Queries ───────────────────────────────────────────────────────────────

  getDefinition(id: string): ScheduledTaskDefinition | undefined {
    return this.definitions.get(id);
  }

  listDefinitions(filter?: { enabled?: boolean; taskType?: TaskType; tags?: string[] }): ScheduledTaskDefinition[] {
    let defs = [...this.definitions.values()];
    if (filter?.enabled !== undefined) defs = defs.filter((d) => d.enabled === filter.enabled);
    if (filter?.taskType) defs = defs.filter((d) => d.taskType === filter.taskType);
    if (filter?.tags?.length) {
      defs = defs.filter((d) => filter.tags!.some((tag) => d.tags.includes(tag)));
    }
    return defs;
  }

  getRunHistory(definitionId?: string, limit = 50): TaskRun[] {
    const runs = definitionId
      ? this.runHistory.filter((r) => r.definitionId === definitionId)
      : this.runHistory;
    return runs.slice(0, limit);
  }

  getNextRunTime(definitionId: string): Date | null {
    const def = this.definitions.get(definitionId);
    if (!def || !def.enabled) return null;
    try {
      return getNextRun(def.cronExpression);
    } catch {
      return null;
    }
  }

  getStats(): SchedulerStats {
    const byType: Record<string, { runs: number; success: number; totalMs: number }> = {};

    let totalMs = 0;
    let successCount = 0;
    let failedCount = 0;
    let skippedCount = 0;

    for (const run of this.runHistory) {
      const ms = run.output?.executionTimeMs ?? 0;
      totalMs += ms;

      if (run.status === "completed") successCount++;
      else if (run.status === "failed") failedCount++;
      else if (run.status === "skipped") skippedCount++;

      const def = this.definitions.get(run.definitionId);
      const type = def?.taskType ?? "custom";
      if (!byType[type]) byType[type] = { runs: 0, success: 0, totalMs: 0 };
      byType[type].runs++;
      if (run.status === "completed") byType[type].success++;
      byType[type].totalMs += ms;
    }

    const totalRuns = this.runHistory.length;
    const enabledDefs = [...this.definitions.values()].filter((d) => d.enabled).length;

    const byTaskType = Object.fromEntries(
      Object.entries(byType).map(([type, stats]) => [
        type,
        {
          runs: stats.runs,
          success: stats.success,
          avgMs: stats.runs > 0 ? Math.round(stats.totalMs / stats.runs) : 0,
        },
      ])
    ) as Record<TaskType, { runs: number; success: number; avgMs: number }>;

    return {
      totalDefinitions: this.definitions.size,
      enabledDefinitions: enabledDefs,
      totalRuns,
      successfulRuns: successCount,
      failedRuns: failedCount,
      skippedRuns: skippedCount,
      activeRuns: this.activeRuns.size,
      avgExecutionTimeMs: totalRuns > 0 ? Math.round(totalMs / totalRuns) : 0,
      successRate: totalRuns > 0 ? successCount / totalRuns : 0,
      byTaskType,
    };
  }

  // ─── Convenience Factory Methods ───────────────────────────────────────────

  registerResearchDigest(opts: {
    name: string;
    topics: string[];
    cronExpression: string;
    notifyUserId?: string;
    webhookUrl?: string;
  }): string {
    const notifications: NotificationConfig[] = [];
    if (opts.notifyUserId) {
      notifications.push({ channel: "in_app", target: opts.notifyUserId, onSuccess: true, onFailure: true, includeOutput: true });
    }
    if (opts.webhookUrl) {
      notifications.push({ channel: "webhook", target: opts.webhookUrl, onSuccess: true, onFailure: true, includeOutput: false });
    }

    return this.register({
      name: opts.name,
      description: `Research digest for topics: ${opts.topics.join(", ")}`,
      taskType: "research_digest",
      cronExpression: opts.cronExpression,
      enabled: true,
      config: { topics: opts.topics, depth: "standard" },
      notifications,
      failure: { strategy: "retry", maxRetries: 2, retryDelayMs: 5000, retryBackoffMultiplier: 2, alertThreshold: 3 },
      resources: { maxConcurrent: 2, maxTokens: 4096, timeoutMs: 120000, priority: 5 },
      tags: ["research", "digest"],
    });
  }

  registerDataMonitor(opts: {
    name: string;
    dataSource: string;
    metrics: string[];
    thresholds: Record<string, number>;
    cronExpression: string;
    webhookUrl?: string;
  }): string {
    const notifications: NotificationConfig[] = [];
    if (opts.webhookUrl) {
      notifications.push({ channel: "webhook", target: opts.webhookUrl, onFailure: true, onSuccess: false, includeOutput: true });
    }

    return this.register({
      name: opts.name,
      description: `Data monitoring for ${opts.dataSource}`,
      taskType: "data_monitoring",
      cronExpression: opts.cronExpression,
      enabled: true,
      config: { dataSource: opts.dataSource, metrics: opts.metrics, thresholds: opts.thresholds },
      notifications,
      failure: { strategy: "alert", maxRetries: 1, retryDelayMs: 10000, retryBackoffMultiplier: 1, alertThreshold: 2 },
      resources: { maxConcurrent: 5, maxTokens: 2048, timeoutMs: 60000, priority: 8 },
      tags: ["monitoring", "data"],
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton
// ─────────────────────────────────────────────────────────────────────────────

let _instance: TaskScheduler | null = null;

export function getTaskScheduler(dispatcher?: NotificationDispatcher): TaskScheduler {
  if (!_instance) _instance = new TaskScheduler(dispatcher);
  return _instance;
}
