import { Logger } from '../../../lib/logger';

export interface ModelSwitchRequest {
  id: string;
  sessionId: string;
  fromModel: string;
  toModel: string;
  requestedAt: number;
  appliedAt?: number;
  status: 'queued' | 'applied' | 'expired';
}

class ModelSwitchQueue {
  private queues: Map<string, ModelSwitchRequest[]> = new Map();
  private busyRuns: Set<string> = new Set();

  markRunBusy(sessionId: string): void {
    this.busyRuns.add(sessionId);
  }

  markRunIdle(sessionId: string): string | null {
    this.busyRuns.delete(sessionId);
    return this.applyNextQueued(sessionId);
  }

  isRunBusy(sessionId: string): boolean {
    return this.busyRuns.has(sessionId);
  }

  queueModelSwitch(sessionId: string, fromModel: string, toModel: string): ModelSwitchRequest {
    const request: ModelSwitchRequest = {
      id: `msq_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      sessionId,
      fromModel,
      toModel,
      requestedAt: Date.now(),
      status: 'queued',
    };

    if (!this.queues.has(sessionId)) {
      this.queues.set(sessionId, []);
    }

    const queue = this.queues.get(sessionId)!;
    const existing = queue.findIndex(r => r.status === 'queued');
    if (existing !== -1) {
      queue[existing].status = 'expired';
    }
    queue.push(request);

    if (!this.isRunBusy(sessionId)) {
      return this.applySwitch(request) ? request : request;
    }

    Logger.info(`[ModelSwitchQueue] Queued model switch for session ${sessionId}: ${fromModel} → ${toModel}`);
    return request;
  }

  private applyNextQueued(sessionId: string): string | null {
    const queue = this.queues.get(sessionId);
    if (!queue) return null;

    const pending = queue.filter(r => r.status === 'queued');
    if (pending.length === 0) return null;

    const latest = pending[pending.length - 1];
    for (const r of pending) {
      if (r !== latest) r.status = 'expired';
    }

    this.applySwitch(latest);
    return latest.toModel;
  }

  private applySwitch(request: ModelSwitchRequest): boolean {
    request.status = 'applied';
    request.appliedAt = Date.now();
    Logger.info(`[ModelSwitchQueue] Applied model switch: ${request.fromModel} → ${request.toModel}`);
    return true;
  }

  getQueuedSwitches(sessionId: string): ModelSwitchRequest[] {
    return (this.queues.get(sessionId) || []).filter(r => r.status === 'queued');
  }

  getEffectiveModel(sessionId: string, currentModel: string): string {
    const queue = this.queues.get(sessionId);
    if (!queue) return currentModel;

    const applied = queue.filter(r => r.status === 'applied').sort((a, b) => b.appliedAt! - a.appliedAt!);
    return applied.length > 0 ? applied[0].toModel : currentModel;
  }

  cleanup(sessionId: string): void {
    this.queues.delete(sessionId);
    this.busyRuns.delete(sessionId);
  }
}

let queueInstance: ModelSwitchQueue | null = null;

export function getModelSwitchQueue(): ModelSwitchQueue {
  if (!queueInstance) {
    queueInstance = new ModelSwitchQueue();
  }
  return queueInstance;
}

export function initModelSwitchQueue(): void {
  getModelSwitchQueue();
  Logger.info('[OpenClaw:ModelSwitchQueue] Model switch queueing initialized');
}
