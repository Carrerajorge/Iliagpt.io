import { EventEmitter } from 'events';
import crypto from 'crypto';

export interface ProgressEvent {
  id: string;
  type: 'started' | 'update' | 'completed' | 'failed';
  taskId: string;
  step: number;
  totalSteps: number;
  message: string;
  progress: number;
  timestamp: number;
}

export class ProgressTracker extends EventEmitter {
  private activeTasks: Map<string, ProgressEvent> = new Map();

  startTask(taskId: string, totalSteps: number, message: string = 'Starting...'): ProgressEvent {
    const event: ProgressEvent = {
      id: crypto.randomUUID(),
      type: 'started',
      taskId,
      step: 0,
      totalSteps,
      message,
      progress: 0,
      timestamp: Date.now()
    };
    this.activeTasks.set(taskId, event);
    this.emit('progress:started', event);
    return event;
  }

  updateProgress(taskId: string, step: number, message: string): ProgressEvent | null {
    const existing = this.activeTasks.get(taskId);
    if (!existing) return null;

    const event: ProgressEvent = {
      ...existing,
      type: 'update',
      step,
      message,
      progress: Math.round((step / existing.totalSteps) * 100),
      timestamp: Date.now()
    };
    this.activeTasks.set(taskId, event);
    this.emit('progress:update', event);
    return event;
  }

  completeTask(taskId: string, message: string = 'Completed'): ProgressEvent | null {
    const existing = this.activeTasks.get(taskId);
    if (!existing) return null;

    const event: ProgressEvent = {
      ...existing,
      type: 'completed',
      step: existing.totalSteps,
      message,
      progress: 100,
      timestamp: Date.now()
    };
    this.activeTasks.delete(taskId);
    this.emit('progress:completed', event);
    return event;
  }

  failTask(taskId: string, error: string): ProgressEvent | null {
    const existing = this.activeTasks.get(taskId);
    if (!existing) return null;

    const event: ProgressEvent = {
      ...existing,
      type: 'failed',
      message: error,
      timestamp: Date.now()
    };
    this.activeTasks.delete(taskId);
    this.emit('progress:failed', event);
    return event;
  }

  getTaskStatus(taskId: string): ProgressEvent | null {
    return this.activeTasks.get(taskId) || null;
  }

  getAllActiveTasks(): ProgressEvent[] {
    return Array.from(this.activeTasks.values());
  }
}

export const progressTracker = new ProgressTracker();
