import pino from 'pino';
import { type CognitiveTask, type MeshNodeInfo } from './CognitiveMesh.js';
import { type CognitiveTaskResult } from './MeshNode.js';

const logger = pino({ name: 'MeshCoordinator', level: process.env.LOG_LEVEL ?? 'info' });

export interface WorkspaceMessage {
  id: string;
  type: string;
  content: unknown;
  sourceNodeId: string;
  priority: number;
  timestamp: number;
  recipients?: string[];
}

interface AttentionRecord {
  nodeId: string;
  messageId: string;
  timestamp: number;
}

const WORKSPACE_BUFFER_SIZE = 100;
const BROADCAST_TIMEOUT_MS = 5_000;
const TASK_EXECUTION_TIMEOUT_MS = 30_000;

export class MeshCoordinator {
  public globalWorkspace: WorkspaceMessage[] = [];

  private attendanceMap: Map<string, Set<string>> = new Map(); // messageId -> Set<nodeId>
  private currentAttention: WorkspaceMessage | null = null;
  private attendanceLog: AttentionRecord[] = [];
  private getNodes: () => Map<string, MeshNodeInfo>;
  private selectNodeForTask: (task: CognitiveTask) => MeshNodeInfo | null;

  constructor(options: {
    getNodes: () => Map<string, MeshNodeInfo>;
    selectNodeForTask: (task: CognitiveTask) => MeshNodeInfo | null;
  }) {
    this.getNodes = options.getNodes;
    this.selectNodeForTask = options.selectNodeForTask;
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  async broadcast(message: WorkspaceMessage): Promise<void> {
    // Add to ring buffer
    this.pushToWorkspace(message);

    const nodes = this.getNodes();
    const targetNodeIds = message.recipients ?? Array.from(nodes.keys());

    logger.info(
      { messageId: message.id, type: message.type, priority: message.priority, targets: targetNodeIds.length },
      'Broadcasting workspace message',
    );

    const broadcastPromises = targetNodeIds.map(async (nodeId) => {
      const node = nodes.get(nodeId);
      if (!node || !node.healthy || nodeId === message.sourceNodeId) return;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), BROADCAST_TIMEOUT_MS);

      try {
        const response = await fetch(`${node.url}/workspace/message`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(message),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          logger.warn(
            { nodeId, messageId: message.id, status: response.status },
            'Broadcast to node returned non-OK status',
          );
        } else {
          logger.debug({ nodeId, messageId: message.id }, 'Broadcast delivered');
        }
      } catch (err) {
        clearTimeout(timeoutId);
        logger.warn({ nodeId, messageId: message.id, err }, 'Broadcast to node failed');
      }
    });

    await Promise.allSettled(broadcastPromises);
  }

  compete(messages: WorkspaceMessage[]): WorkspaceMessage {
    if (messages.length === 0) {
      throw new Error('Cannot compete with empty message list');
    }

    // Sort by priority descending, then by recency for ties
    const sorted = [...messages].sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return b.timestamp - a.timestamp;
    });

    const winner = sorted[0];
    logger.debug(
      { winnerId: winner.id, priority: winner.priority, candidates: messages.length },
      'Attention competition resolved',
    );
    return winner;
  }

  attend(nodeId: string, messageId: string): void {
    let attendees = this.attendanceMap.get(messageId);
    if (!attendees) {
      attendees = new Set();
      this.attendanceMap.set(messageId, attendees);
    }
    attendees.add(nodeId);

    this.attendanceLog.push({ nodeId, messageId, timestamp: Date.now() });

    // Check if this message should take over attention
    const message = this.globalWorkspace.find((m) => m.id === messageId);
    if (!message) {
      logger.warn({ nodeId, messageId }, 'Attend called for unknown message');
      return;
    }

    // Higher priority displaces current attention
    if (!this.currentAttention || message.priority > this.currentAttention.priority) {
      const previous = this.currentAttention?.id;
      this.currentAttention = message;
      logger.info(
        { nodeId, messageId, priority: message.priority, displacedMessage: previous },
        'Attention shifted to higher priority message',
      );
    }
  }

  getAttention(): WorkspaceMessage | null {
    return this.currentAttention;
  }

  getAttendeeCount(messageId: string): number {
    return this.attendanceMap.get(messageId)?.size ?? 0;
  }

  async routeTask(task: CognitiveTask): Promise<CognitiveTaskResult> {
    const targetNode = this.selectNodeForTask(task);

    if (!targetNode) {
      logger.error({ taskId: task.id, type: task.type }, 'No capable node available for task routing');
      return {
        taskId: task.id,
        nodeId: 'coordinator',
        result: null,
        duration: 0,
        error: `No capable healthy node available for capability: ${task.type}`,
      };
    }

    logger.info(
      { taskId: task.id, type: task.type, targetNode: targetNode.id, nodeUrl: targetNode.url },
      'Routing task to node',
    );

    const start = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TASK_EXECUTION_TIMEOUT_MS);

    try {
      const response = await fetch(`${targetNode.url}/node/task`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(task),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const duration = Date.now() - start;

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        logger.warn({ taskId: task.id, targetNode: targetNode.id, status: response.status, errorBody }, 'Task routing failed');
        return {
          taskId: task.id,
          nodeId: targetNode.id,
          result: null,
          duration,
          error: `Node returned status ${response.status}: ${errorBody}`,
        };
      }

      const result = (await response.json()) as CognitiveTaskResult;
      logger.info({ taskId: task.id, targetNode: targetNode.id, duration }, 'Task routed and completed');

      // Broadcast task completion as workspace message
      const completionMsg: WorkspaceMessage = {
        id: this.generateId(),
        type: 'TASK_COMPLETE',
        content: { taskId: task.id, result: result.result, duration },
        sourceNodeId: targetNode.id,
        priority: task.priority,
        timestamp: Date.now(),
      };
      // Fire-and-forget broadcast of completion
      this.broadcast(completionMsg).catch((err) => logger.warn({ err }, 'Completion broadcast failed'));

      return result;
    } catch (err) {
      clearTimeout(timeoutId);
      const duration = Date.now() - start;
      const errorMsg = err instanceof Error ? err.message : String(err);

      logger.error({ taskId: task.id, targetNode: targetNode.id, err, duration }, 'Task routing threw exception');

      return {
        taskId: task.id,
        nodeId: targetNode.id,
        result: null,
        duration,
        error: errorMsg,
      };
    }
  }

  getWorkspaceSnapshot(): WorkspaceMessage[] {
    return this.globalWorkspace.slice(-10);
  }

  private pushToWorkspace(message: WorkspaceMessage): void {
    this.globalWorkspace.push(message);

    // Ring buffer: keep last WORKSPACE_BUFFER_SIZE messages
    if (this.globalWorkspace.length > WORKSPACE_BUFFER_SIZE) {
      const removed = this.globalWorkspace.splice(0, this.globalWorkspace.length - WORKSPACE_BUFFER_SIZE);

      // If we removed the current attention message, reset attention to the next highest priority
      if (this.currentAttention && removed.some((m) => m.id === this.currentAttention!.id)) {
        if (this.globalWorkspace.length > 0) {
          this.currentAttention = this.compete(this.globalWorkspace);
          logger.debug({ newAttention: this.currentAttention.id }, 'Attention reset after workspace buffer trim');
        } else {
          this.currentAttention = null;
        }
      }
    }
  }

  publishToWorkspace(message: Omit<WorkspaceMessage, 'id' | 'timestamp'>): WorkspaceMessage {
    const full: WorkspaceMessage = {
      ...message,
      id: this.generateId(),
      timestamp: Date.now(),
    };

    this.pushToWorkspace(full);

    logger.debug(
      { messageId: full.id, type: full.type, priority: full.priority, sourceNodeId: full.sourceNodeId },
      'Message published to global workspace',
    );

    return full;
  }

  getWorkspaceStats(): {
    totalMessages: number;
    currentAttentionId: string | null;
    topPriority: number;
    messageTypes: Record<string, number>;
  } {
    const typeCounts: Record<string, number> = {};
    let topPriority = -Infinity;

    for (const msg of this.globalWorkspace) {
      typeCounts[msg.type] = (typeCounts[msg.type] ?? 0) + 1;
      if (msg.priority > topPriority) topPriority = msg.priority;
    }

    return {
      totalMessages: this.globalWorkspace.length,
      currentAttentionId: this.currentAttention?.id ?? null,
      topPriority: isFinite(topPriority) ? topPriority : 0,
      messageTypes: typeCounts,
    };
  }
}
