import { Logger } from '../../../lib/logger';

export interface BackgroundTask {
  id: string;
  sessionId: string;
  title: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  agentId?: string;
  createdAt: number;
  updatedAt: number;
  result?: string;
  error?: string;
  progress?: number;
  metadata?: Record<string, unknown>;
}

class TaskBoard {
  private tasks: Map<string, BackgroundTask> = new Map();
  private sessionIndex: Map<string, Set<string>> = new Map();
  private maxTasksPerSession = 50;
  private gcIntervalMs = 300_000;
  private gcTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.gcTimer = setInterval(() => this.gc(), this.gcIntervalMs);
  }

  createTask(sessionId: string, title: string, agentId?: string): BackgroundTask {
    const id = `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();
    const task: BackgroundTask = {
      id,
      sessionId,
      title,
      status: 'pending',
      agentId,
      createdAt: now,
      updatedAt: now,
    };

    this.tasks.set(id, task);
    if (!this.sessionIndex.has(sessionId)) {
      this.sessionIndex.set(sessionId, new Set());
    }
    this.sessionIndex.get(sessionId)!.add(id);

    const sessionTasks = this.sessionIndex.get(sessionId)!;
    if (sessionTasks.size > this.maxTasksPerSession) {
      this.evictOldest(sessionId);
    }

    return task;
  }

  updateTask(taskId: string, updates: Partial<Pick<BackgroundTask, 'status' | 'result' | 'error' | 'progress' | 'metadata'>>): BackgroundTask | null {
    const task = this.tasks.get(taskId);
    if (!task) return null;

    Object.assign(task, updates, { updatedAt: Date.now() });
    return task;
  }

  getTask(taskId: string): BackgroundTask | null {
    return this.tasks.get(taskId) || null;
  }

  getSessionTasks(sessionId: string): BackgroundTask[] {
    const taskIds = this.sessionIndex.get(sessionId);
    if (!taskIds) return [];

    return Array.from(taskIds)
      .map(id => this.tasks.get(id)!)
      .filter(Boolean)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  getRecentTasks(sessionId: string, limit = 10): BackgroundTask[] {
    return this.getSessionTasks(sessionId).slice(0, limit);
  }

  getAgentFallbackCount(sessionId: string): number {
    const tasks = this.getSessionTasks(sessionId);
    return tasks.filter(t => !t.agentId && (t.status === 'completed' || t.status === 'running')).length;
  }

  cancelTask(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task || task.status === 'completed' || task.status === 'failed') return false;

    task.status = 'cancelled';
    task.updatedAt = Date.now();
    return true;
  }

  private evictOldest(sessionId: string): void {
    const tasks = this.getSessionTasks(sessionId);
    const completedTasks = tasks.filter(t => t.status === 'completed' || t.status === 'failed' || t.status === 'cancelled');
    if (completedTasks.length > 0) {
      const oldest = completedTasks[completedTasks.length - 1];
      this.tasks.delete(oldest.id);
      this.sessionIndex.get(sessionId)?.delete(oldest.id);
    }
  }

  private gc(): void {
    const cutoff = Date.now() - 3600_000;
    let removed = 0;
    for (const [id, task] of this.tasks) {
      if (task.updatedAt < cutoff && (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled')) {
        this.tasks.delete(id);
        this.sessionIndex.get(task.sessionId)?.delete(id);
        removed++;
      }
    }
    if (removed > 0) {
      Logger.info(`[TaskBoard] GC removed ${removed} stale tasks`);
    }
  }

  destroy(): void {
    if (this.gcTimer) {
      clearInterval(this.gcTimer);
      this.gcTimer = null;
    }
  }

  getStats(): { total: number; active: number; sessions: number } {
    let active = 0;
    for (const task of this.tasks.values()) {
      if (task.status === 'pending' || task.status === 'running') active++;
    }
    return { total: this.tasks.size, active, sessions: this.sessionIndex.size };
  }
}

let taskBoardInstance: TaskBoard | null = null;

export function getTaskBoard(): TaskBoard {
  if (!taskBoardInstance) {
    taskBoardInstance = new TaskBoard();
  }
  return taskBoardInstance;
}

export function initTaskBoard(): void {
  getTaskBoard();
  Logger.info('[OpenClaw:TaskBoard] Chat-native background task board initialized');
}
