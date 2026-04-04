import { EventEmitter } from 'events';
import type { MeshTask, TaskResult } from './CognitiveMesh';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NodeCapabilities {
  maxConcurrentTasks: number;
  supportedModels: string[];
  hasGPU: boolean;
  memoryGB: number;
  specializations: string[];
}

export interface NodeResources {
  cpuPercent: number;
  memoryPercent: number;
  activeTasks: number;
  queuedTasks: number;
  uptimeMs: number;
}

export type NodeState = 'initializing' | 'ready' | 'busy' | 'draining' | 'offline';

export type TaskExecutor = (task: MeshTask) => Promise<unknown>;

interface QueuedTask {
  task: MeshTask;
  resolve: (result: TaskResult) => void;
  reject: (err: Error) => void;
  timeoutHandle?: NodeJS.Timeout;
}

// ─── Simulated resource drift parameters ─────────────────────────────────────

const CPU_BASE_DRIFT = 5;       // percent variance per interval
const MEM_BASE_DRIFT = 3;
const RESOURCE_POLL_INTERVAL_MS = 3_000;
const HEARTBEAT_EMIT_INTERVAL_MS = 4_000;

// ─── MeshNode ─────────────────────────────────────────────────────────────────

export class MeshNode extends EventEmitter {
  readonly nodeId: string;

  private capabilities: NodeCapabilities;
  private resources: NodeResources;
  private state: NodeState = 'initializing';

  private activeTaskCount = 0;
  private taskQueue: QueuedTask[] = [];
  private executor: TaskExecutor;

  private resourcePollTimer?: NodeJS.Timeout;
  private heartbeatTimer?: NodeJS.Timeout;
  private startedAt: number;

  constructor(nodeId: string, capabilities: NodeCapabilities, executor: TaskExecutor) {
    super();
    this.nodeId = nodeId;
    this.capabilities = { ...capabilities };
    this.executor = executor;
    this.startedAt = Date.now();

    // Initialize simulated resources
    this.resources = {
      cpuPercent: 5 + Math.random() * 10,
      memoryPercent: 20 + Math.random() * 15,
      activeTasks: 0,
      queuedTasks: 0,
      uptimeMs: 0,
    };

    this.transitionTo('initializing');
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    // Simulate node startup (e.g., model loading, GPU init)
    await new Promise<void>((res) => setTimeout(res, 100 + Math.random() * 200));

    this.resourcePollTimer = setInterval(() => this.updateSimulatedResources(), RESOURCE_POLL_INTERVAL_MS);
    this.heartbeatTimer = setInterval(() => this.emitHeartbeat(), HEARTBEAT_EMIT_INTERVAL_MS);

    this.transitionTo('ready');
  }

  async drain(): Promise<void> {
    this.transitionTo('draining');
    clearInterval(this.heartbeatTimer);
    clearInterval(this.resourcePollTimer);

    // Reject all queued tasks
    const remaining = [...this.taskQueue];
    this.taskQueue = [];
    for (const q of remaining) {
      clearTimeout(q.timeoutHandle);
      q.reject(new Error(`Node ${this.nodeId} is draining`));
    }

    // Wait for active tasks to complete (up to 30 s)
    const deadline = Date.now() + 30_000;
    while (this.activeTaskCount > 0 && Date.now() < deadline) {
      await new Promise<void>((res) => setTimeout(res, 250));
    }

    this.transitionTo('offline');
  }

  // ─── Task Acceptance & Execution ─────────────────────────────────────────────

  canAccept(task: MeshTask): boolean {
    if (this.state !== 'ready' && this.state !== 'busy') return false;

    const { maxConcurrentTasks } = this.capabilities;
    if (this.activeTaskCount >= maxConcurrentTasks) return false;
    if (this.resources.cpuPercent > 90) return false;
    if (this.resources.memoryPercent > 90) return false;

    // Check capability requirements
    const req = task.requiredCapabilities;
    if (req) {
      if (req.hasGPU && !this.capabilities.hasGPU) return false;
      if (req.memoryGB && this.capabilities.memoryGB < req.memoryGB) return false;
      if (req.specializations && req.specializations.length > 0) {
        const hasAll = req.specializations.every((s) => this.capabilities.specializations.includes(s));
        if (!hasAll) return false;
      }
      if (req.supportedModels && req.supportedModels.length > 0) {
        const hasAll = req.supportedModels.every((m) => this.capabilities.supportedModels.includes(m));
        if (!hasAll) return false;
      }
    }

    return true;
  }

  async executeTask(task: MeshTask, timeoutMs = 30_000): Promise<TaskResult> {
    return new Promise<TaskResult>((resolve, reject) => {
      const queued: QueuedTask = { task, resolve, reject };

      const timeoutHandle = setTimeout(() => {
        const idx = this.taskQueue.indexOf(queued);
        if (idx !== -1) this.taskQueue.splice(idx, 1);
        this.resources.queuedTasks = this.taskQueue.length;
        resolve({
          taskId: task.taskId,
          nodeId: this.nodeId,
          success: false,
          error: `Task timed out after ${timeoutMs}ms`,
          durationMs: timeoutMs,
          completedAt: Date.now(),
        });
      }, timeoutMs);

      queued.timeoutHandle = timeoutHandle;
      this.taskQueue.push(queued);
      this.resources.queuedTasks = this.taskQueue.length;
      this.processQueue();
    });
  }

  private processQueue(): void {
    if (this.state === 'draining' || this.state === 'offline') return;
    if (this.activeTaskCount >= this.capabilities.maxConcurrentTasks) return;
    if (this.taskQueue.length === 0) return;

    // Pick highest-priority task
    this.taskQueue.sort((a, b) => b.task.priority - a.task.priority);
    const queued = this.taskQueue.shift()!;
    this.resources.queuedTasks = this.taskQueue.length;

    clearTimeout(queued.timeoutHandle);
    this.runTask(queued);
  }

  private async runTask(queued: QueuedTask): Promise<void> {
    this.activeTaskCount++;
    this.resources.activeTasks = this.activeTaskCount;
    this.updateState();

    const startedAt = Date.now();

    try {
      const output = await this.executor(queued.task);
      const durationMs = Date.now() - startedAt;
      const result: TaskResult = {
        taskId: queued.task.taskId,
        nodeId: this.nodeId,
        success: true,
        output,
        durationMs,
        completedAt: Date.now(),
      };
      queued.resolve(result);
      this.emit('task_completed', result);
    } catch (err: unknown) {
      const durationMs = Date.now() - startedAt;
      const message = err instanceof Error ? err.message : String(err);
      const result: TaskResult = {
        taskId: queued.task.taskId,
        nodeId: this.nodeId,
        success: false,
        error: message,
        durationMs,
        completedAt: Date.now(),
      };
      queued.resolve(result);
      this.emit('task_failed', result);
    } finally {
      this.activeTaskCount = Math.max(0, this.activeTaskCount - 1);
      this.resources.activeTasks = this.activeTaskCount;
      this.updateState();
      // Continue draining the queue
      setImmediate(() => this.processQueue());
    }
  }

  // ─── Resource Simulation ─────────────────────────────────────────────────────

  private updateSimulatedResources(): void {
    const loadFactor = this.activeTaskCount / Math.max(this.capabilities.maxConcurrentTasks, 1);

    // CPU: base idle + load contribution + random noise
    const targetCpu = 5 + loadFactor * 75 + (Math.random() - 0.5) * CPU_BASE_DRIFT;
    this.resources.cpuPercent = Math.min(100, Math.max(0, targetCpu));

    // Memory: slower-moving, load-aware
    const targetMem = 20 + loadFactor * 60 + (Math.random() - 0.5) * MEM_BASE_DRIFT;
    this.resources.memoryPercent = Math.min(100, Math.max(0, targetMem));

    this.resources.uptimeMs = Date.now() - this.startedAt;

    this.emit('resources_updated', { nodeId: this.nodeId, resources: { ...this.resources } });
  }

  // ─── Heartbeat ───────────────────────────────────────────────────────────────

  private emitHeartbeat(): void {
    if (this.state === 'offline') return;
    this.emit('heartbeat', this.nodeId, {
      state: this.state,
      resources: { ...this.resources },
      capabilities: { ...this.capabilities },
      timestamp: Date.now(),
    });
  }

  receiveCoordinatorPing(timestamp: number): void {
    this.emit('coordinator_ping', { nodeId: this.nodeId, coordinatorTimestamp: timestamp });
  }

  // ─── State Machine ───────────────────────────────────────────────────────────

  private transitionTo(next: NodeState): void {
    const prev = this.state;
    this.state = next;
    this.emit('state_changed', { nodeId: this.nodeId, from: prev, to: next });
  }

  private updateState(): void {
    if (this.state === 'draining' || this.state === 'offline' || this.state === 'initializing') return;
    if (this.activeTaskCount >= this.capabilities.maxConcurrentTasks) {
      if (this.state !== 'busy') this.transitionTo('busy');
    } else {
      if (this.state !== 'ready') this.transitionTo('ready');
    }
  }

  // ─── Accessors ───────────────────────────────────────────────────────────────

  getCapabilities(): Readonly<NodeCapabilities> {
    return { ...this.capabilities };
  }

  getResources(): Readonly<NodeResources> {
    return { ...this.resources };
  }

  getState(): NodeState {
    return this.state;
  }

  updateCapabilities(patch: Partial<NodeCapabilities>): void {
    this.capabilities = { ...this.capabilities, ...patch };
    this.emit('capabilities_updated', { nodeId: this.nodeId, capabilities: { ...this.capabilities } });
  }

  isHealthy(): boolean {
    return this.state !== 'offline' && this.resources.cpuPercent < 95 && this.resources.memoryPercent < 95;
  }

  getQueueDepth(): number {
    return this.taskQueue.length;
  }

  snapshot(): Record<string, unknown> {
    return {
      nodeId: this.nodeId,
      state: this.state,
      capabilities: this.getCapabilities(),
      resources: this.getResources(),
      queueDepth: this.taskQueue.length,
    };
  }
}
