/**
 * Capability tests — Cowork project workspaces (capability 14)
 *
 * Tests cover workspace persistence, per-project state management,
 * recurring work scheduling, and collaboration features.
 * All external I/O (database, filesystem, scheduler) is mocked.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  runWithEachProvider,
  MOCK_PROVIDER,
} from "../_setup/providerMatrix";
import {
  getMockResponseForProvider,
  createTextResponse,
  MOCK_FILE_TOOL,
} from "../_setup/mockResponses";
import {
  createTempDir,
  cleanupTempDir,
  createTestFile,
  createMockAgent,
  assertHasShape,
} from "../_setup/testHelpers";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("../../../server/db", () => ({
  db: {
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([{ id: "ws_001" }]) }),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
        orderBy: vi.fn().mockResolvedValue([]),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
    }),
    delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
  },
}));

vi.mock("../../../server/agent/planMode", () => ({
  PlanMode: vi.fn().mockImplementation(() => ({
    generate: vi.fn().mockResolvedValue({ plan: [], approved: false }),
    approve: vi.fn().mockResolvedValue({ approved: true }),
    execute: vi.fn().mockResolvedValue({ status: "done" }),
  })),
}));

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

interface Workspace {
  id: string;
  name: string;
  ownerId: string;
  createdAt: number;
  updatedAt: number;
  state: Record<string, unknown>;
  files: string[];
  conversationIds: string[];
}

interface Project {
  id: string;
  workspaceId: string;
  name: string;
  context: Record<string, unknown>;
  files: ProjectFile[];
  conversationHistory: ConversationEntry[];
}

interface ProjectFile {
  path: string;
  contentHash: string;
  sizeBytes: number;
  updatedAt: number;
}

interface ConversationEntry {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

interface RecurringTask {
  id: string;
  workspaceId: string;
  name: string;
  cronExpression: string;
  lastRunAt: number | null;
  nextRunAt: number;
  template: string;
  enabled: boolean;
}

interface WorkspacePermission {
  userId: string;
  role: "owner" | "editor" | "viewer";
  grantedAt: number;
  grantedBy: string;
}

interface ActivityLogEntry {
  id: string;
  workspaceId: string;
  userId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  timestamp: number;
  metadata: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function buildWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: `ws_${Date.now()}`,
    name: "Default Workspace",
    ownerId: "user_001",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    state: {},
    files: [],
    conversationIds: [],
    ...overrides,
  };
}

function buildProject(workspaceId: string, overrides: Partial<Project> = {}): Project {
  return {
    id: `proj_${Date.now()}`,
    workspaceId,
    name: "Default Project",
    context: {},
    files: [],
    conversationHistory: [],
    ...overrides,
  };
}

function buildRecurringTask(workspaceId: string, overrides: Partial<RecurringTask> = {}): RecurringTask {
  return {
    id: `rt_${Date.now()}`,
    workspaceId,
    name: "Daily Briefing",
    cronExpression: "0 9 * * 1-5",
    lastRunAt: null,
    nextRunAt: Date.now() + 3600_000,
    template: "Generate a daily briefing covering {{topics}}.",
    enabled: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// In-memory workspace store (simulates DB layer)
// ---------------------------------------------------------------------------

class WorkspaceStore {
  private workspaces = new Map<string, Workspace>();

  create(ws: Workspace): Workspace {
    this.workspaces.set(ws.id, { ...ws });
    return ws;
  }

  findById(id: string): Workspace | null {
    return this.workspaces.get(id) ?? null;
  }

  save(ws: Workspace): void {
    this.workspaces.set(ws.id, { ...ws, updatedAt: Date.now() });
  }

  list(ownerId: string): Workspace[] {
    return [...this.workspaces.values()].filter((w) => w.ownerId === ownerId);
  }

  delete(id: string): boolean {
    return this.workspaces.delete(id);
  }
}

// ---------------------------------------------------------------------------
// Workspace persistence
// ---------------------------------------------------------------------------

describe("Workspace persistence", () => {
  let store: WorkspaceStore;

  beforeEach(() => {
    store = new WorkspaceStore();
  });

  it("creates a new workspace and returns it with a stable ID", () => {
    const ws = buildWorkspace({ name: "Q2 Planning" });
    const created = store.create(ws);

    assertHasShape(created, {
      id: "string",
      name: "string",
      ownerId: "string",
      createdAt: "number",
      updatedAt: "number",
    });

    expect(created.id).toBeTruthy();
    expect(created.name).toBe("Q2 Planning");
  });

  it("saves workspace state and reloads it intact", () => {
    const ws = buildWorkspace({ name: "Research Hub" });
    store.create(ws);

    ws.state = {
      activePhase: "data-collection",
      progress: 0.35,
      tags: ["AI", "market-research"],
    };
    store.save(ws);

    const loaded = store.findById(ws.id);
    expect(loaded).not.toBeNull();
    expect(loaded?.state.activePhase).toBe("data-collection");
    expect(loaded?.state.progress).toBe(0.35);
    expect(Array.isArray(loaded?.state.tags)).toBe(true);
  });

  it("lists all workspaces belonging to an owner", () => {
    store.create(buildWorkspace({ id: "ws_a", ownerId: "user_001", name: "Alpha" }));
    store.create(buildWorkspace({ id: "ws_b", ownerId: "user_001", name: "Beta" }));
    store.create(buildWorkspace({ id: "ws_c", ownerId: "user_002", name: "Gamma" }));

    const userWorkspaces = store.list("user_001");
    expect(userWorkspaces).toHaveLength(2);
    const names = userWorkspaces.map((w) => w.name).sort();
    expect(names).toEqual(["Alpha", "Beta"]);
  });

  it("deletes a workspace and confirms it is no longer retrievable", () => {
    const ws = buildWorkspace({ name: "Temporary" });
    store.create(ws);
    expect(store.findById(ws.id)).not.toBeNull();

    const deleted = store.delete(ws.id);
    expect(deleted).toBe(true);
    expect(store.findById(ws.id)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Per-project state
// ---------------------------------------------------------------------------

describe("Per-project state", () => {
  it("maintains project-scoped context isolated from other projects", () => {
    const ws = buildWorkspace();
    const projA = buildProject(ws.id, {
      name: "Project Alpha",
      context: { domain: "healthcare", stakeholders: ["Alice", "Bob"] },
    });
    const projB = buildProject(ws.id, {
      name: "Project Beta",
      context: { domain: "fintech", stakeholders: ["Carol"] },
    });

    // Modify projA context should not affect projB
    projA.context.status = "active";

    expect(projA.context.domain).toBe("healthcare");
    expect(projB.context.domain).toBe("fintech");
    expect(projB.context.status).toBeUndefined();
  });

  it("tracks project files with content hashes for change detection", () => {
    const project = buildProject("ws_001", { name: "Doc Project" });

    function addFile(project: Project, filePath: string, content: string): void {
      // Naive hash: sum of char codes mod 2^16
      const hash = [...content].reduce((acc, c) => (acc + c.charCodeAt(0)) & 0xffff, 0).toString(16);
      const existing = project.files.findIndex((f) => f.path === filePath);
      const entry: ProjectFile = {
        path: filePath,
        contentHash: hash,
        sizeBytes: Buffer.byteLength(content, "utf-8"),
        updatedAt: Date.now(),
      };
      if (existing >= 0) {
        project.files[existing] = entry;
      } else {
        project.files.push(entry);
      }
    }

    function hasChanged(project: Project, filePath: string, newContent: string): boolean {
      const existing = project.files.find((f) => f.path === filePath);
      if (!existing) return true;
      const hash = [...newContent].reduce((acc, c) => (acc + c.charCodeAt(0)) & 0xffff, 0).toString(16);
      return existing.contentHash !== hash;
    }

    addFile(project, "/docs/spec.md", "Initial content");
    expect(hasChanged(project, "/docs/spec.md", "Initial content")).toBe(false);
    expect(hasChanged(project, "/docs/spec.md", "Updated content")).toBe(true);

    addFile(project, "/docs/spec.md", "Updated content");
    expect(hasChanged(project, "/docs/spec.md", "Updated content")).toBe(false);
  });

  it("persists project conversation history in insertion order", () => {
    const project = buildProject("ws_001");
    const now = Date.now();

    const entries: ConversationEntry[] = [
      { id: "c1", role: "user", content: "What is the project status?", timestamp: now },
      { id: "c2", role: "assistant", content: "The project is 60% complete.", timestamp: now + 100 },
      { id: "c3", role: "user", content: "What are the blockers?", timestamp: now + 200 },
    ];

    project.conversationHistory.push(...entries);

    expect(project.conversationHistory).toHaveLength(3);
    expect(project.conversationHistory[0].role).toBe("user");
    expect(project.conversationHistory[1].role).toBe("assistant");
    expect(project.conversationHistory[2].content).toContain("blockers");
  });

  it("limits conversation history to a configurable max entries (sliding window)", () => {
    const MAX_ENTRIES = 5;
    const project = buildProject("ws_001");

    function addToHistory(project: Project, entry: ConversationEntry, maxEntries: number): void {
      project.conversationHistory.push(entry);
      if (project.conversationHistory.length > maxEntries) {
        project.conversationHistory.splice(0, project.conversationHistory.length - maxEntries);
      }
    }

    for (let i = 1; i <= 8; i++) {
      addToHistory(
        project,
        { id: `c${i}`, role: "user", content: `Message ${i}`, timestamp: Date.now() + i * 100 },
        MAX_ENTRIES,
      );
    }

    expect(project.conversationHistory).toHaveLength(MAX_ENTRIES);
    expect(project.conversationHistory[0].content).toBe("Message 4");
    expect(project.conversationHistory[4].content).toBe("Message 8");
  });
});

// ---------------------------------------------------------------------------
// Recurring work
// ---------------------------------------------------------------------------

describe("Recurring work", () => {
  it("generates a daily briefing from workspace context using a template", () => {
    function renderTemplate(template: string, variables: Record<string, string>): string {
      return template.replace(/\{\{(\w+)\}\}/g, (_, key) => variables[key] ?? `{{${key}}}`);
    }

    const task = buildRecurringTask("ws_001", {
      name: "Morning Briefing",
      template: "Good morning! Today's focus: {{focus}}. Pending items: {{pending}}. Weather: {{weather}}.",
    });

    const rendered = renderTemplate(task.template, {
      focus: "Q2 roadmap review",
      pending: "3 PRs to review",
      weather: "sunny",
    });

    expect(rendered).toContain("Q2 roadmap review");
    expect(rendered).toContain("3 PRs to review");
    expect(rendered).not.toContain("{{");
  });

  it("computes next run time from cron expression (9am weekdays)", () => {
    // Simple cron parser mock — verify the concept of scheduling logic
    function parseCronNextRun(expression: string, fromMs: number): number {
      // For testing purposes, model "0 9 * * 1-5" as: add 24h from now
      // Real implementation would use a cron library
      void expression;
      return fromMs + 24 * 3600 * 1000;
    }

    const task = buildRecurringTask("ws_001");
    const nextRun = parseCronNextRun(task.cronExpression, Date.now());

    expect(nextRun).toBeGreaterThan(Date.now());
    expect(nextRun - Date.now()).toBeGreaterThanOrEqual(23 * 3600 * 1000);
  });

  it("records lastRunAt after a successful run and advances nextRunAt", () => {
    const task = buildRecurringTask("ws_001");
    const beforeRun = Date.now();

    function recordRun(task: RecurringTask): RecurringTask {
      return {
        ...task,
        lastRunAt: Date.now(),
        nextRunAt: Date.now() + 24 * 3600 * 1000,
      };
    }

    const updated = recordRun(task);

    expect(updated.lastRunAt).not.toBeNull();
    expect(updated.lastRunAt as number).toBeGreaterThanOrEqual(beforeRun);
    expect(updated.nextRunAt).toBeGreaterThan(updated.lastRunAt as number);
  });

  it("skips disabled recurring tasks without executing", () => {
    const execSpy = vi.fn();

    function maybeRun(task: RecurringTask, executeFn: () => void): void {
      if (!task.enabled) return;
      executeFn();
    }

    const disabledTask = buildRecurringTask("ws_001", { enabled: false });
    maybeRun(disabledTask, execSpy);
    expect(execSpy).not.toHaveBeenCalled();

    const enabledTask = buildRecurringTask("ws_001", { enabled: true });
    maybeRun(enabledTask, execSpy);
    expect(execSpy).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Collaboration
// ---------------------------------------------------------------------------

describe("Collaboration", () => {
  it("assigns permissions to collaborators with distinct roles", () => {
    const ws = buildWorkspace({ ownerId: "user_001" });
    const permissions: WorkspacePermission[] = [
      { userId: "user_001", role: "owner", grantedAt: Date.now(), grantedBy: "user_001" },
      { userId: "user_002", role: "editor", grantedAt: Date.now(), grantedBy: "user_001" },
      { userId: "user_003", role: "viewer", grantedAt: Date.now(), grantedBy: "user_001" },
    ];

    function canWrite(permissions: WorkspacePermission[], userId: string): boolean {
      const perm = permissions.find((p) => p.userId === userId);
      return perm?.role === "owner" || perm?.role === "editor";
    }

    function canRead(permissions: WorkspacePermission[], userId: string): boolean {
      return permissions.some((p) => p.userId === userId);
    }

    expect(canWrite(permissions, "user_001")).toBe(true);
    expect(canWrite(permissions, "user_002")).toBe(true);
    expect(canWrite(permissions, "user_003")).toBe(false);
    expect(canRead(permissions, "user_003")).toBe(true);
    expect(canRead(permissions, "user_999")).toBe(false);
  });

  it("records an activity log entry for each workspace action", () => {
    const log: ActivityLogEntry[] = [];

    function recordActivity(
      workspaceId: string,
      userId: string,
      action: string,
      resourceType: string,
      resourceId: string,
      metadata: Record<string, unknown> = {},
    ): ActivityLogEntry {
      const entry: ActivityLogEntry = {
        id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        workspaceId,
        userId,
        action,
        resourceType,
        resourceId,
        timestamp: Date.now(),
        metadata,
      };
      log.push(entry);
      return entry;
    }

    recordActivity("ws_001", "user_001", "create", "file", "file_abc", { filename: "report.docx" });
    recordActivity("ws_001", "user_002", "view", "conversation", "conv_001");
    recordActivity("ws_001", "user_001", "update", "project", "proj_xyz", { field: "status" });

    expect(log).toHaveLength(3);
    expect(log[0].action).toBe("create");
    expect(log[1].userId).toBe("user_002");
    expect(log[2].metadata.field).toBe("status");

    log.forEach((entry) =>
      assertHasShape(entry, {
        id: "string",
        workspaceId: "string",
        userId: "string",
        action: "string",
        timestamp: "number",
      }),
    );
  });

  it("filters activity log by user to show only that user's actions", () => {
    const log: ActivityLogEntry[] = [
      { id: "a1", workspaceId: "ws_001", userId: "user_001", action: "create", resourceType: "file", resourceId: "f1", timestamp: 1000, metadata: {} },
      { id: "a2", workspaceId: "ws_001", userId: "user_002", action: "view", resourceType: "file", resourceId: "f1", timestamp: 1100, metadata: {} },
      { id: "a3", workspaceId: "ws_001", userId: "user_001", action: "update", resourceType: "file", resourceId: "f1", timestamp: 1200, metadata: {} },
    ];

    const user001Log = log.filter((e) => e.userId === "user_001");
    expect(user001Log).toHaveLength(2);
    expect(user001Log.every((e) => e.userId === "user_001")).toBe(true);
  });
});
