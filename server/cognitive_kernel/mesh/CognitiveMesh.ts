import { EventEmitter } from 'events';
import { MeshNode, NodeCapabilities, NodeResources, NodeState } from './MeshNode';

// ─── Types ────────────────────────────────────────────────────────────────────

export type LoadBalancingStrategy = 'round-robin' | 'least-loaded' | 'capability-match';

export interface TaskRequest {
  taskId: string;
  type: string;
  payload: unknown;
  requiredCapabilities?: Partial<NodeCapabilities>;
  priority: number; // 0 (lowest) – 10 (highest)
  timeoutMs?: number;
  submittedAt: number;
}

export interface MeshTask extends TaskRequest {
  assignedNodeId: string;
  routedAt: number;
}

export interface TaskResult {
  taskId: string;
  nodeId: string;
  success: boolean;
  output?: unknown;
  error?: string;
  durationMs: number;
  completedAt: number;
}

export interface MeshNodeEntry {
  node: MeshNode;
  lastHeartbeat: number;
  healthy: boolean;
  tasksRouted: number;
}

export interface MeshStats {
  totalNodes: number;
  healthyNodes: number;
  totalTasksRouted: number;
  totalTasksCompleted: number;
  averageLatencyMs: number;
  topology: 'peer-to-peer' | 'coordinator';
}

// ─── Constants ────────────────────────────────────────────────────────────────

const HEARTBEAT_INTERVAL_MS = 5_000;
const HEARTBEAT_TIMEOUT_MS = 15_000;
const HEALTH_CHECK_INTERVAL_MS = 8_000;
const ROUND_ROBIN_POINTER_KEY = '__rr_pointer__';

// ─── CognitiveMesh ────────────────────────────────────────────────────────────

export class CognitiveMesh extends EventEmitter {
  private readonly nodeRegistry = new Map<string, MeshNodeEntry>();
  private readonly coordinatorId: string;
  private strategy: LoadBalancingStrategy;
  private roundRobinPointer = 0;
  private heartbeatTimer?: NodeJS.Timeout;
  private healthCheckTimer?: NodeJS.Timeout;
  private taskLatencies: number[] = [];
  private totalTasksCompleted = 0;
  private isShuttingDown = false;

  constructor(coordinatorId: string, strategy: LoadBalancingStrategy = 'least-loaded') {
    super();
    this.coordinatorId = coordinatorId;
    this.strategy = strategy;
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  start(): void {
    this.heartbeatTimer = setInterval(() => this.broadcastHeartbeat(), HEARTBEAT_INTERVAL_MS);
    this.healthCheckTimer = setInterval(() => this.runHealthCheck(), HEALTH_CHECK_INTERVAL_MS);
    this.emit('mesh_started', { coordinatorId: this.coordinatorId, strategy: this.strategy });
  }

  async shutdown(): Promise<void> {
    this.isShuttingDown = true;
    clearInterval(this.heartbeatTimer);
    clearInterval(this.healthCheckTimer);

    const drainPromises: Promise<void>[] = [];
    for (const [nodeId, entry] of this.nodeRegistry) {
      drainPromises.push(entry.node.drain());
      this.emit('node_left', { nodeId, reason: 'mesh_shutdown' });
    }

    await Promise.all(drainPromises);
    this.nodeRegistry.clear();
    this.emit('mesh_stopped', { coordinatorId: this.coordinatorId });
  }

  // ─── Node Management ────────────────────────────────────────────────────────

  registerNode(node: MeshNode): void {
    if (this.isShuttingDown) {
      throw new Error('Cannot register nodes during shutdown');
    }

    const existing = this.nodeRegistry.get(node.nodeId);
    if (existing) {
      existing.lastHeartbeat = Date.now();
      existing.healthy = true;
      return;
    }

    const entry: MeshNodeEntry = {
      node,
      lastHeartbeat: Date.now(),
      healthy: true,
      tasksRouted: 0,
    };

    this.nodeRegistry.set(node.nodeId, entry);

    // Listen for heartbeats from this node
    node.on('heartbeat', (nodeId: string) => {
      const e = this.nodeRegistry.get(nodeId);
      if (e) {
        e.lastHeartbeat = Date.now();
        e.healthy = true;
      }
    });

    // Listen for task completions
    node.on('task_completed', (result: TaskResult) => {
      const e = this.nodeRegistry.get(result.nodeId);
      if (e) {
        e.tasksRouted = Math.max(0, e.tasksRouted - 1);
      }
      this.totalTasksCompleted++;
      this.taskLatencies.push(result.durationMs);
      if (this.taskLatencies.length > 1000) this.taskLatencies.shift();
      this.emit('task_completed', result);
    });

    this.emit('node_joined', {
      nodeId: node.nodeId,
      capabilities: node.getCapabilities(),
      registeredAt: Date.now(),
    });
  }

  deregisterNode(nodeId: string): void {
    const entry = this.nodeRegistry.get(nodeId);
    if (!entry) return;
    this.nodeRegistry.delete(nodeId);
    this.emit('node_left', { nodeId, reason: 'deregistered' });
  }

  // ─── Task Routing ────────────────────────────────────────────────────────────

  async routeTask(task: TaskRequest): Promise<TaskResult> {
    if (this.isShuttingDown) {
      return this.makeError(task, 'no_node', 'Mesh is shutting down', 0);
    }

    const candidateNode = this.selectNode(task);
    if (!candidateNode) {
      return this.makeError(task, 'no_node', 'No healthy node available for task', 0);
    }

    const meshTask: MeshTask = {
      ...task,
      assignedNodeId: candidateNode.node.nodeId,
      routedAt: Date.now(),
    };

    candidateNode.tasksRouted++;
    this.emit('task_routed', { task: meshTask, nodeId: candidateNode.node.nodeId });

    try {
      const result = await candidateNode.node.executeTask(meshTask, task.timeoutMs);
      return result;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return this.makeError(task, candidateNode.node.nodeId, msg, Date.now() - meshTask.routedAt);
    }
  }

  // ─── Load Balancing Strategies ──────────────────────────────────────────────

  private selectNode(task: TaskRequest): MeshNodeEntry | null {
    const healthy = this.getHealthyNodes();
    if (healthy.length === 0) return null;

    switch (this.strategy) {
      case 'round-robin':
        return this.roundRobin(healthy);
      case 'least-loaded':
        return this.leastLoaded(healthy);
      case 'capability-match':
        return this.capabilityMatch(healthy, task);
      default:
        return this.leastLoaded(healthy);
    }
  }

  private roundRobin(nodes: MeshNodeEntry[]): MeshNodeEntry {
    const idx = this.roundRobinPointer % nodes.length;
    this.roundRobinPointer = (this.roundRobinPointer + 1) % nodes.length;
    return nodes[idx];
  }

  private leastLoaded(nodes: MeshNodeEntry[]): MeshNodeEntry {
    return nodes.reduce((best, entry) => {
      const bestLoad = best.node.getResources().activeTasks + best.node.getResources().queuedTasks;
      const entryLoad = entry.node.getResources().activeTasks + entry.node.getResources().queuedTasks;
      return entryLoad < bestLoad ? entry : best;
    });
  }

  private capabilityMatch(nodes: MeshNodeEntry[], task: TaskRequest): MeshNodeEntry {
    if (!task.requiredCapabilities) return this.leastLoaded(nodes);

    const req = task.requiredCapabilities;

    const scored = nodes
      .filter((e) => e.node.canAccept(task as MeshTask))
      .map((e) => {
        const cap = e.node.getCapabilities();
        let score = 0;

        if (req.hasGPU !== undefined && cap.hasGPU === req.hasGPU) score += 3;
        if (req.memoryGB !== undefined && cap.memoryGB >= (req.memoryGB ?? 0)) score += 2;
        if (req.maxConcurrentTasks !== undefined && cap.maxConcurrentTasks >= (req.maxConcurrentTasks ?? 0)) score += 1;
        if (req.specializations && req.specializations.length > 0) {
          const overlap = (req.specializations ?? []).filter((s) => cap.specializations.includes(s));
          score += overlap.length * 2;
        }

        // Penalise heavily loaded nodes
        const res = e.node.getResources();
        const loadRatio = res.activeTasks / Math.max(cap.maxConcurrentTasks, 1);
        score -= loadRatio * 2;

        return { entry: e, score };
      })
      .sort((a, b) => b.score - a.score);

    return scored.length > 0 ? scored[0].entry : this.leastLoaded(nodes);
  }

  // ─── Health Monitoring ──────────────────────────────────────────────────────

  private runHealthCheck(): void {
    const now = Date.now();
    for (const [nodeId, entry] of this.nodeRegistry) {
      const elapsed = now - entry.lastHeartbeat;
      if (elapsed > HEARTBEAT_TIMEOUT_MS && entry.healthy) {
        entry.healthy = false;
        this.emit('node_unhealthy', { nodeId, lastSeen: entry.lastHeartbeat, elapsed });
      } else if (elapsed <= HEARTBEAT_TIMEOUT_MS && !entry.healthy) {
        entry.healthy = true;
        this.emit('node_recovered', { nodeId });
      }
    }
  }

  private broadcastHeartbeat(): void {
    const now = Date.now();
    for (const [, entry] of this.nodeRegistry) {
      if (entry.healthy) {
        entry.node.receiveCoordinatorPing(now);
      }
    }
  }

  // ─── Introspection ──────────────────────────────────────────────────────────

  getStats(): MeshStats {
    const healthy = this.getHealthyNodes();
    const avg =
      this.taskLatencies.length > 0
        ? this.taskLatencies.reduce((a, b) => a + b, 0) / this.taskLatencies.length
        : 0;
    const totalRouted = [...this.nodeRegistry.values()].reduce((s, e) => s + e.tasksRouted, 0);

    return {
      totalNodes: this.nodeRegistry.size,
      healthyNodes: healthy.length,
      totalTasksRouted: totalRouted,
      totalTasksCompleted: this.totalTasksCompleted,
      averageLatencyMs: Math.round(avg),
      topology: 'peer-to-peer',
    };
  }

  getNodeIds(): string[] {
    return [...this.nodeRegistry.keys()];
  }

  getNode(nodeId: string): MeshNode | undefined {
    return this.nodeRegistry.get(nodeId)?.node;
  }

  setStrategy(strategy: LoadBalancingStrategy): void {
    this.strategy = strategy;
    this.roundRobinPointer = 0;
    this.emit('strategy_changed', { strategy });
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private getHealthyNodes(): MeshNodeEntry[] {
    return [...this.nodeRegistry.values()].filter((e) => e.healthy && e.node.getState() !== 'offline');
  }

  private makeError(task: TaskRequest, nodeId: string, error: string, durationMs: number): TaskResult {
    return {
      taskId: task.taskId,
      nodeId,
      success: false,
      error,
      durationMs,
      completedAt: Date.now(),
    };
  }
}
