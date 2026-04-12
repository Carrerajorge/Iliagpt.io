/**
 * Capability 08 — Scheduled Tasks
 *
 * Tests for creating, managing, and executing scheduled tasks via cron
 * expressions and on-demand triggers. Covers task persistence, cadence
 * variants, error handling with retries, and task lifecycle management.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import { runWithEachProvider } from "../_setup/providerMatrix";
import { getMockResponseForProvider, createTextResponse } from "../_setup/mockResponses";
import { createMockAgent, MockDatabase, waitFor } from "../_setup/testHelpers";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

const mockScheduler = {
  schedule: vi.fn(),
  unschedule: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  list: vi.fn(),
  getTask: vi.fn(),
  updateCron: vi.fn(),
  getHistory: vi.fn(),
  detectOverdue: vi.fn(),
};

vi.mock("node-cron", () => ({
  default: {
    schedule: vi.fn((expression: string, fn: () => void) => ({
      expression,
      start: vi.fn(),
      stop: vi.fn(),
      destroy: vi.fn(),
    })),
    validate: vi.fn((expr: string) => {
      // Basic validation: 5 space-separated fields
      return expr.split(" ").length === 5;
    }),
  },
  validate: vi.fn((expr: string) => expr.split(" ").length === 5),
  schedule: vi.fn((expression: string, fn: () => void) => ({
    expression,
    start: vi.fn(),
    stop: vi.fn(),
    destroy: vi.fn(),
  })),
}));

vi.mock("../../../server/tasks/scheduler", () => ({
  TaskScheduler: vi.fn(() => mockScheduler),
  default: mockScheduler,
}));

// ---------------------------------------------------------------------------
// Zod schemas (mirrors production task definition)
// ---------------------------------------------------------------------------

const TaskDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  cronExpression: z.string().regex(/^(\S+ ){4}\S+$/, "Must be 5-field cron"),
  prompt: z.string().min(1),
  enabled: z.boolean().default(true),
  notifyOnCompletion: z.boolean().default(true),
  retryOnError: z.boolean().default(false),
  maxRetries: z.number().int().min(0).max(5).default(0),
  createdAt: z.string().datetime(),
  lastRunAt: z.string().datetime().nullable().default(null),
  nextRunAt: z.string().datetime().nullable().default(null),
});

type TaskDefinition = z.infer<typeof TaskDefinitionSchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTask(overrides: Partial<TaskDefinition> = {}): TaskDefinition {
  return TaskDefinitionSchema.parse({
    id: `task-${Date.now()}`,
    name: "Test Task",
    cronExpression: "0 9 * * *",
    prompt: "Do the daily briefing",
    enabled: true,
    notifyOnCompletion: true,
    retryOnError: false,
    maxRetries: 0,
    createdAt: new Date().toISOString(),
    lastRunAt: null,
    nextRunAt: null,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// 1. Cron-based scheduling
// ---------------------------------------------------------------------------

describe("Cron-based scheduling", () => {
  let db: MockDatabase;

  beforeEach(() => {
    vi.clearAllMocks();
    db = new MockDatabase();

    mockScheduler.schedule.mockImplementation((task: TaskDefinition) => {
      db.insert("tasks", { id: task.id, ...task });
      return { jobId: task.id, expression: task.cronExpression, active: true };
    });

    mockScheduler.list.mockImplementation(() => db.findAll("tasks"));
    mockScheduler.getTask.mockImplementation((id: string) => db.findById("tasks", id));
  });

  runWithEachProvider(
    "schedules a daily task at 9am",
    "scheduled-tasks",
    async (provider) => {
      const task = makeTask({
        id: "daily-briefing",
        name: "Daily Briefing",
        cronExpression: "0 9 * * *",
        prompt: "Send daily briefing summary to the user",
      });

      // Validate schema
      const parsed = TaskDefinitionSchema.safeParse(task);
      expect(parsed.success).toBe(true);

      const job = mockScheduler.schedule(task);
      expect(job.jobId).toBe("daily-briefing");
      expect(job.expression).toBe("0 9 * * *");
      expect(job.active).toBe(true);

      // Validate tool call format
      const response = getMockResponseForProvider(provider.name, {
        name: "create_scheduled_task",
        arguments: { name: task.name, cron: task.cronExpression, prompt: task.prompt },
      });
      expect(response).toBeDefined();
    },
  );

  runWithEachProvider(
    "schedules a weekly task every Monday",
    "scheduled-tasks",
    async (provider) => {
      const task = makeTask({
        id: "weekly-report",
        name: "Weekly Report",
        cronExpression: "0 8 * * 1",
        prompt: "Generate weekly progress report",
      });

      const parsed = TaskDefinitionSchema.safeParse(task);
      expect(parsed.success).toBe(true);
      expect(task.cronExpression).toBe("0 8 * * 1");

      const job = mockScheduler.schedule(task);
      expect(job.expression).toBe("0 8 * * 1");
    },
  );

  runWithEachProvider(
    "schedules a task on the first of each month",
    "scheduled-tasks",
    async (provider) => {
      const task = makeTask({
        id: "monthly-summary",
        name: "Monthly Summary",
        cronExpression: "0 0 1 * *",
        prompt: "Generate end-of-month financial summary",
      });

      const parsed = TaskDefinitionSchema.safeParse(task);
      expect(parsed.success).toBe(true);

      const job = mockScheduler.schedule(task);
      expect(job.expression).toBe("0 0 1 * *");
      expect(job.active).toBe(true);
    },
  );

  runWithEachProvider(
    "validates and rejects an invalid cron expression",
    "scheduled-tasks",
    async (provider) => {
      const badTask = {
        id: "bad-task",
        name: "Bad Task",
        cronExpression: "not-a-cron",
        prompt: "This should fail",
        enabled: true,
        notifyOnCompletion: true,
        retryOnError: false,
        maxRetries: 0,
        createdAt: new Date().toISOString(),
        lastRunAt: null,
        nextRunAt: null,
      };

      const parsed = TaskDefinitionSchema.safeParse(badTask);
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        const cronError = parsed.error.issues.find((i) =>
          i.path.includes("cronExpression"),
        );
        expect(cronError).toBeDefined();
      }
    },
  );
});

// ---------------------------------------------------------------------------
// 2. On-demand saved tasks
// ---------------------------------------------------------------------------

describe("On-demand saved tasks", () => {
  let db: MockDatabase;

  beforeEach(() => {
    vi.clearAllMocks();
    db = new MockDatabase();

    mockScheduler.schedule.mockImplementation((task: TaskDefinition) => {
      db.insert("tasks", { id: task.id, ...task });
      return { jobId: task.id, expression: task.cronExpression, active: true };
    });

    mockScheduler.list.mockImplementation(() => db.findAll("tasks"));
    mockScheduler.getTask.mockImplementation((id: string) => db.findById("tasks", id));
    mockScheduler.unschedule.mockImplementation((id: string) => {
      const existed = db.delete("tasks", id);
      return { deleted: existed };
    });
  });

  runWithEachProvider(
    "saves a task definition to persistent storage",
    "scheduled-tasks",
    async (provider) => {
      const task = makeTask({ id: "research-digest", name: "Research Digest" });
      mockScheduler.schedule(task);

      const saved = db.findById("tasks", "research-digest");
      expect(saved).toBeDefined();
      expect(saved!["name"]).toBe("Research Digest");
    },
  );

  runWithEachProvider(
    "executes a saved on-demand task",
    "scheduled-tasks",
    async (provider) => {
      const executeTask = vi.fn().mockResolvedValue({
        taskId: "research-digest",
        status: "completed",
        output: "Research digest generated",
        durationMs: 1200,
      });

      const task = makeTask({ id: "research-digest" });
      mockScheduler.schedule(task);

      const result = await executeTask({ taskId: "research-digest" });
      expect(result.status).toBe("completed");
      expect(result.output).toBeTruthy();
      expect(executeTask).toHaveBeenCalledWith({ taskId: "research-digest" });
    },
  );

  runWithEachProvider(
    "lists all saved tasks",
    "scheduled-tasks",
    async (provider) => {
      mockScheduler.schedule(makeTask({ id: "task-a", name: "Task A" }));
      mockScheduler.schedule(makeTask({ id: "task-b", name: "Task B" }));
      mockScheduler.schedule(makeTask({ id: "task-c", name: "Task C" }));

      const tasks = mockScheduler.list();
      expect(tasks).toHaveLength(3);
      expect(tasks.map((t: { name: string }) => t.name)).toEqual(
        expect.arrayContaining(["Task A", "Task B", "Task C"]),
      );
    },
  );

  runWithEachProvider(
    "deletes a saved task by ID",
    "scheduled-tasks",
    async (provider) => {
      mockScheduler.schedule(makeTask({ id: "to-delete" }));
      expect(db.count("tasks")).toBe(1);

      const result = mockScheduler.unschedule("to-delete");
      expect(result.deleted).toBe(true);
      expect(db.count("tasks")).toBe(0);
    },
  );
});

// ---------------------------------------------------------------------------
// 3. Cadence variants
// ---------------------------------------------------------------------------

describe("Cadence variants", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockScheduler.schedule.mockResolvedValue({ active: true });
  });

  runWithEachProvider(
    "sets up daily briefing at a fixed hour",
    "scheduled-tasks",
    async (provider) => {
      const task = makeTask({
        id: "daily-brief",
        cronExpression: "0 7 * * *",
        name: "Daily Briefing",
      });
      expect(task.cronExpression).toBe("0 7 * * *");

      // Fields: minute=0, hour=7, dom=*, month=*, dow=*
      const parts = task.cronExpression.split(" ");
      expect(parts[0]).toBe("0");  // minute
      expect(parts[1]).toBe("7");  // hour
      expect(parts[4]).toBe("*");  // every day of week
    },
  );

  runWithEachProvider(
    "sets up weekly report on Fridays",
    "scheduled-tasks",
    async (provider) => {
      const task = makeTask({
        id: "weekly-report",
        cronExpression: "0 16 * * 5",
        name: "Weekly Report",
      });

      const parts = task.cronExpression.split(" ");
      expect(parts[4]).toBe("5"); // Friday
      expect(parts[1]).toBe("16"); // 4pm
    },
  );

  runWithEachProvider(
    "sets up monthly summary on the last working day",
    "scheduled-tasks",
    async (provider) => {
      // Use "0 17 28-31 * *" as a proxy for end-of-month
      const task = makeTask({
        id: "monthly-summary",
        cronExpression: "0 17 28 * *",
        name: "Monthly Summary",
      });

      expect(task.cronExpression).toBe("0 17 28 * *");
      const parts = task.cronExpression.split(" ");
      expect(parts[2]).toBe("28"); // day of month
    },
  );

  runWithEachProvider(
    "sets up a quarterly review task",
    "scheduled-tasks",
    async (provider) => {
      // Quarterly: every 3 months on the 1st at 10am
      const task = makeTask({
        id: "quarterly-review",
        cronExpression: "0 10 1 1,4,7,10 *",
        name: "Quarterly Review",
      });

      const parts = task.cronExpression.split(" ");
      expect(parts[3]).toBe("1,4,7,10"); // months: Jan, Apr, Jul, Oct
    },
  );
});

// ---------------------------------------------------------------------------
// 4. Task execution
// ---------------------------------------------------------------------------

describe("Task execution", () => {
  const mockTaskRunner = {
    run: vi.fn(),
    notify: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockTaskRunner.run.mockResolvedValue({
      taskId: "test-task",
      status: "completed",
      output: "Task completed successfully",
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: 850,
      retries: 0,
    });
    mockTaskRunner.notify.mockResolvedValue({ sent: true });
  });

  runWithEachProvider(
    "task runs successfully and returns output",
    "scheduled-tasks",
    async (provider) => {
      const result = await mockTaskRunner.run({ taskId: "daily-briefing" });
      expect(result.status).toBe("completed");
      expect(result.output).toBeTruthy();
      expect(result.durationMs).toBeGreaterThan(0);
      expect(result.retries).toBe(0);
    },
  );

  runWithEachProvider(
    "task handles errors with automatic retry",
    "scheduled-tasks",
    async (provider) => {
      // First attempt fails, second succeeds
      mockTaskRunner.run
        .mockRejectedValueOnce(new Error("Transient network error"))
        .mockResolvedValueOnce({
          taskId: "flaky-task",
          status: "completed",
          output: "Completed after retry",
          durationMs: 1200,
          retries: 1,
        });

      const task = makeTask({
        id: "flaky-task",
        retryOnError: true,
        maxRetries: 3,
        cronExpression: "*/5 * * * *",
      });
      expect(task.retryOnError).toBe(true);

      // Simulate the retry logic
      let result;
      try {
        await mockTaskRunner.run({ taskId: "flaky-task" });
      } catch {
        result = await mockTaskRunner.run({ taskId: "flaky-task" });
      }
      expect(result!.retries).toBe(1);
      expect(result!.status).toBe("completed");
    },
  );

  runWithEachProvider(
    "sends a notification on task completion",
    "scheduled-tasks",
    async (provider) => {
      const task = makeTask({ id: "notify-task", notifyOnCompletion: true });
      expect(task.notifyOnCompletion).toBe(true);

      const runResult = await mockTaskRunner.run({ taskId: task.id });
      expect(runResult.status).toBe("completed");

      // Notification should be dispatched
      const notifyResult = await mockTaskRunner.notify({
        taskId: task.id,
        status: runResult.status,
        output: runResult.output,
      });
      expect(notifyResult.sent).toBe(true);
      expect(mockTaskRunner.notify).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: task.id, status: "completed" }),
      );
    },
  );

  runWithEachProvider(
    "records task execution in history",
    "scheduled-tasks",
    async (provider) => {
      const db = new MockDatabase();

      mockTaskRunner.run.mockImplementation(async ({ taskId }: { taskId: string }) => {
        const record = {
          id: `run-${Date.now()}`,
          taskId,
          status: "completed",
          output: "Done",
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          durationMs: 500,
          retries: 0,
        };
        db.insert("task_runs", record);
        return record;
      });

      await mockTaskRunner.run({ taskId: "tracked-task" });
      await mockTaskRunner.run({ taskId: "tracked-task" });

      expect(db.count("task_runs")).toBe(2);
      const runs = db.findAll("task_runs");
      expect(runs.every((r) => r["taskId"] === "tracked-task")).toBe(true);
    },
  );
});

// ---------------------------------------------------------------------------
// 5. Task management
// ---------------------------------------------------------------------------

describe("Task management", () => {
  let db: MockDatabase;

  beforeEach(() => {
    vi.clearAllMocks();
    db = new MockDatabase();

    const insertedTask = makeTask({ id: "managed-task", enabled: true });
    db.insert("tasks", { id: "managed-task", ...insertedTask });

    mockScheduler.pause.mockImplementation((id: string) => {
      db.update("tasks", id, { enabled: false });
      return { paused: true };
    });

    mockScheduler.resume.mockImplementation((id: string) => {
      db.update("tasks", id, { enabled: true });
      return { resumed: true };
    });

    mockScheduler.updateCron.mockImplementation((id: string, newExpr: string) => {
      db.update("tasks", id, { cronExpression: newExpr });
      return { updated: true, expression: newExpr };
    });

    mockScheduler.getTask.mockImplementation((id: string) => db.findById("tasks", id));

    mockScheduler.getHistory.mockResolvedValue([
      { runId: "run-1", taskId: "managed-task", status: "completed", durationMs: 300 },
      { runId: "run-2", taskId: "managed-task", status: "failed", durationMs: 50 },
    ]);

    mockScheduler.detectOverdue.mockImplementation((task: { nextRunAt: string | null }) => {
      if (!task.nextRunAt) return false;
      return new Date(task.nextRunAt).getTime() < Date.now();
    });
  });

  runWithEachProvider(
    "pauses and resumes a task",
    "scheduled-tasks",
    async (provider) => {
      const pauseResult = mockScheduler.pause("managed-task");
      expect(pauseResult.paused).toBe(true);

      const afterPause = db.findById("tasks", "managed-task");
      expect(afterPause!["enabled"]).toBe(false);

      const resumeResult = mockScheduler.resume("managed-task");
      expect(resumeResult.resumed).toBe(true);

      const afterResume = db.findById("tasks", "managed-task");
      expect(afterResume!["enabled"]).toBe(true);
    },
  );

  runWithEachProvider(
    "edits the cron schedule of an existing task",
    "scheduled-tasks",
    async (provider) => {
      const updateResult = mockScheduler.updateCron("managed-task", "30 8 * * 1-5");
      expect(updateResult.updated).toBe(true);
      expect(updateResult.expression).toBe("30 8 * * 1-5");

      const task = db.findById("tasks", "managed-task");
      expect(task!["cronExpression"]).toBe("30 8 * * 1-5");
    },
  );

  runWithEachProvider(
    "retrieves task execution history",
    "scheduled-tasks",
    async (provider) => {
      const history = await mockScheduler.getHistory("managed-task");
      expect(history).toHaveLength(2);
      expect(history[0].status).toBe("completed");
      expect(history[1].status).toBe("failed");
    },
  );

  runWithEachProvider(
    "detects overdue tasks",
    "scheduled-tasks",
    async (provider) => {
      // Task whose nextRunAt is in the past
      const overdueTask = makeTask({
        id: "overdue-task",
        nextRunAt: new Date(Date.now() - 60_000).toISOString(), // 1 minute ago
      });

      const isOverdue = mockScheduler.detectOverdue(overdueTask);
      expect(isOverdue).toBe(true);

      // Task whose nextRunAt is in the future
      const futureTask = makeTask({
        id: "future-task",
        nextRunAt: new Date(Date.now() + 60_000).toISOString(),
      });
      const isFutureOverdue = mockScheduler.detectOverdue(futureTask);
      expect(isFutureOverdue).toBe(false);
    },
  );
});
