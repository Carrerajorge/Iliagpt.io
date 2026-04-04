import { EventEmitter } from 'events';

// ─── Signal Types (discriminated union) ──────────────────────────────────────

export interface QueryResultSignal {
  kind: 'query_result';
  taskId: string;
  nodeId: string;
  query: string;
  result: unknown;
}

export interface ToolOutputSignal {
  kind: 'tool_output';
  toolName: string;
  callId: string;
  nodeId: string;
  output: unknown;
}

export interface MemoryRetrievalSignal {
  kind: 'memory_retrieval';
  memoryId: string;
  nodeId: string;
  content: string;
  relevanceScore: number;
}

export interface UserInputSignal {
  kind: 'user_input';
  sessionId: string;
  text: string;
  attachments?: string[];
}

export interface ErrorSignal {
  kind: 'error';
  nodeId: string;
  taskId?: string;
  message: string;
  stack?: string;
}

export type CognitiveSignal =
  | QueryResultSignal
  | ToolOutputSignal
  | MemoryRetrievalSignal
  | UserInputSignal
  | ErrorSignal;

// ─── Attention & Workspace Types ─────────────────────────────────────────────

export interface ScoredSignal {
  signal: CognitiveSignal;
  salience: number;
  enteredWorkspaceAt: number;
  broadcastCount: number;
}

export interface Coalition {
  coalitionId: string;
  taskId: string;
  memberNodeIds: string[];
  signals: ScoredSignal[];
  formedAt: number;
  lastUpdatedAt: number;
}

export interface AttentionSnapshot {
  timestamp: number;
  workspaceSize: number;
  topSignals: Array<{ kind: string; salience: number }>;
  activeCoalitions: number;
  totalBroadcasts: number;
}

// ─── Configuration ────────────────────────────────────────────────────────────

const WORKSPACE_CAPACITY = 7;           // Miller's Law: 7 ± 2
const CONSCIOUSNESS_THRESHOLD = 0.35;   // Minimum salience to enter workspace
const BROADCAST_INTERVAL_MS = 500;      // How often winning signals are broadcast
const SIGNAL_DECAY_RATE = 0.05;         // Salience decay per broadcast cycle
const COALITION_TTL_MS = 60_000;        // Coalitions expire after 60 s

// ─── Salience Scoring ─────────────────────────────────────────────────────────

function computeSalience(signal: CognitiveSignal): number {
  let base = 0;

  switch (signal.kind) {
    case 'user_input':
      // User input is always high salience — it drives the interaction
      base = 0.95;
      if (signal.text.length < 5) base -= 0.1;
      break;

    case 'error':
      // Errors demand attention
      base = 0.85;
      break;

    case 'query_result':
      base = 0.6;
      break;

    case 'tool_output':
      base = 0.55;
      break;

    case 'memory_retrieval':
      // Weight by relevance score from the retrieval system
      base = 0.3 + signal.relevanceScore * 0.4;
      break;
  }

  // Slight jitter to break ties
  return Math.min(1, Math.max(0, base + (Math.random() - 0.5) * 0.05));
}

// ─── Priority Queue (min-heap backed by sorted array for simplicity) ──────────

class SalienceQueue {
  private items: ScoredSignal[] = [];

  push(item: ScoredSignal): void {
    this.items.push(item);
    this.items.sort((a, b) => b.salience - a.salience); // descending
  }

  peek(): ScoredSignal | undefined {
    return this.items[0];
  }

  popBelow(threshold: number): ScoredSignal[] {
    const evicted: ScoredSignal[] = [];
    this.items = this.items.filter((item) => {
      if (item.salience < threshold) {
        evicted.push(item);
        return false;
      }
      return true;
    });
    return evicted;
  }

  top(n: number): ScoredSignal[] {
    return this.items.slice(0, n);
  }

  size(): number {
    return this.items.length;
  }

  applyDecay(rate: number): void {
    for (const item of this.items) {
      item.salience = Math.max(0, item.salience - rate);
    }
  }

  clear(): void {
    this.items = [];
  }
}

// ─── MeshCoordinator ─────────────────────────────────────────────────────────

export class MeshCoordinator extends EventEmitter {
  private readonly coordinatorId: string;
  private readonly globalWorkspace: ScoredSignal[] = [];
  private readonly attentionQueue = new SalienceQueue();
  private readonly coalitions = new Map<string, Coalition>();

  private broadcastTimer?: NodeJS.Timeout;
  private coalitionPruneTimer?: NodeJS.Timeout;
  private totalBroadcasts = 0;
  private isActive = false;

  constructor(coordinatorId: string) {
    super();
    this.coordinatorId = coordinatorId;
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────────────

  start(): void {
    this.isActive = true;
    this.broadcastTimer = setInterval(() => this.broadcastCycle(), BROADCAST_INTERVAL_MS);
    this.coalitionPruneTimer = setInterval(() => this.pruneCoalitions(), 10_000);
    this.emit('coordinator_started', { coordinatorId: this.coordinatorId });
  }

  stop(): void {
    this.isActive = false;
    clearInterval(this.broadcastTimer);
    clearInterval(this.coalitionPruneTimer);
    this.attentionQueue.clear();
    this.globalWorkspace.length = 0;
    this.coalitions.clear();
    this.emit('coordinator_stopped', { coordinatorId: this.coordinatorId });
  }

  // ─── Signal Ingestion ────────────────────────────────────────────────────────

  receiveSignal(signal: CognitiveSignal): void {
    if (!this.isActive) return;

    const salience = computeSalience(signal);
    const scored: ScoredSignal = {
      signal,
      salience,
      enteredWorkspaceAt: 0,
      broadcastCount: 0,
    };

    this.emit('signal_received', { kind: signal.kind, salience, coordinatorId: this.coordinatorId });

    if (salience >= CONSCIOUSNESS_THRESHOLD) {
      this.attentionQueue.push(scored);
      this.tryEnterWorkspace(scored);
    } else {
      this.emit('signal_suppressed', { kind: signal.kind, salience, threshold: CONSCIOUSNESS_THRESHOLD });
    }

    // Automatically form or update coalition if signal carries a taskId
    const taskId = this.extractTaskId(signal);
    const nodeId = this.extractNodeId(signal);
    if (taskId && nodeId) {
      this.updateCoalition(taskId, nodeId, scored);
    }
  }

  // ─── Global Workspace Management ─────────────────────────────────────────────

  private tryEnterWorkspace(scored: ScoredSignal): void {
    if (this.globalWorkspace.length < WORKSPACE_CAPACITY) {
      scored.enteredWorkspaceAt = Date.now();
      this.globalWorkspace.push(scored);
      this.globalWorkspace.sort((a, b) => b.salience - a.salience);
      this.emit('signal_entered_workspace', {
        kind: scored.signal.kind,
        salience: scored.salience,
        workspaceSize: this.globalWorkspace.length,
      });
    } else {
      // Evict lowest-salience item if the new one is more salient
      const lowest = this.globalWorkspace[this.globalWorkspace.length - 1];
      if (scored.salience > lowest.salience) {
        this.globalWorkspace.pop();
        this.emit('signal_evicted', { kind: lowest.signal.kind, salience: lowest.salience });
        scored.enteredWorkspaceAt = Date.now();
        this.globalWorkspace.push(scored);
        this.globalWorkspace.sort((a, b) => b.salience - a.salience);
        this.emit('signal_entered_workspace', {
          kind: scored.signal.kind,
          salience: scored.salience,
          workspaceSize: this.globalWorkspace.length,
        });
      }
    }
  }

  // ─── Broadcast Cycle (GWT) ───────────────────────────────────────────────────

  private broadcastCycle(): void {
    if (this.globalWorkspace.length === 0) return;

    // Apply decay to all workspace signals
    for (const item of this.globalWorkspace) {
      item.salience = Math.max(0, item.salience - SIGNAL_DECAY_RATE);
    }
    this.attentionQueue.applyDecay(SIGNAL_DECAY_RATE);

    // Evict signals that fell below threshold
    const toEvict = this.globalWorkspace.filter((s) => s.salience < CONSCIOUSNESS_THRESHOLD);
    for (const s of toEvict) {
      const idx = this.globalWorkspace.indexOf(s);
      if (idx !== -1) this.globalWorkspace.splice(idx, 1);
      this.emit('signal_decayed_out', { kind: s.signal.kind });
    }

    // Broadcast top-N signals to all listeners
    const winners = this.globalWorkspace.slice(0, WORKSPACE_CAPACITY);
    for (const winner of winners) {
      winner.broadcastCount++;
      this.totalBroadcasts++;
      this.emit('broadcast', {
        signal: winner.signal,
        salience: winner.salience,
        broadcastNumber: winner.broadcastCount,
        coordinatorId: this.coordinatorId,
        timestamp: Date.now(),
      });
    }
  }

  // ─── Coalition Formation ─────────────────────────────────────────────────────

  private updateCoalition(taskId: string, nodeId: string, scored: ScoredSignal): void {
    let coalition = this.coalitions.get(taskId);
    if (!coalition) {
      coalition = {
        coalitionId: `coalition-${taskId}`,
        taskId,
        memberNodeIds: [],
        signals: [],
        formedAt: Date.now(),
        lastUpdatedAt: Date.now(),
      };
      this.coalitions.set(taskId, coalition);
      this.emit('coalition_formed', { coalitionId: coalition.coalitionId, taskId });
    }

    if (!coalition.memberNodeIds.includes(nodeId)) {
      coalition.memberNodeIds.push(nodeId);
      this.emit('coalition_member_joined', { coalitionId: coalition.coalitionId, nodeId });
    }

    coalition.signals.push(scored);
    coalition.lastUpdatedAt = Date.now();
  }

  private pruneCoalitions(): void {
    const now = Date.now();
    for (const [taskId, coalition] of this.coalitions) {
      if (now - coalition.lastUpdatedAt > COALITION_TTL_MS) {
        this.coalitions.delete(taskId);
        this.emit('coalition_dissolved', { coalitionId: coalition.coalitionId, taskId });
      }
    }
  }

  // ─── Introspection ───────────────────────────────────────────────────────────

  getAttentionSnapshot(): AttentionSnapshot {
    return {
      timestamp: Date.now(),
      workspaceSize: this.globalWorkspace.length,
      topSignals: this.globalWorkspace.map((s) => ({ kind: s.signal.kind, salience: s.salience })),
      activeCoalitions: this.coalitions.size,
      totalBroadcasts: this.totalBroadcasts,
    };
  }

  getCoalition(taskId: string): Coalition | undefined {
    return this.coalitions.get(taskId);
  }

  getAllCoalitions(): Coalition[] {
    return [...this.coalitions.values()];
  }

  getWorkspaceContents(): ScoredSignal[] {
    return [...this.globalWorkspace];
  }

  getConsciousnessThreshold(): number {
    return CONSCIOUSNESS_THRESHOLD;
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private extractTaskId(signal: CognitiveSignal): string | null {
    switch (signal.kind) {
      case 'query_result':
        return signal.taskId;
      case 'tool_output':
        return signal.callId;
      case 'error':
        return signal.taskId ?? null;
      default:
        return null;
    }
  }

  private extractNodeId(signal: CognitiveSignal): string | null {
    switch (signal.kind) {
      case 'query_result':
      case 'tool_output':
      case 'memory_retrieval':
      case 'error':
        return signal.nodeId;
      default:
        return null;
    }
  }
}
