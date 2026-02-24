import { useAgentStore } from '@/stores/agent-store';

interface EventHandler {
  type: string;
  handler: (event: MessageEvent) => void;
}

interface StreamingInstance {
  runId: string;
  messageId: string;
  eventSource: EventSource | null;
  abortController: AbortController | null;
  intervalRef: NodeJS.Timeout | null;
  currentInterval: number;
  retryCount: number;
  lastEventCount: number;
  isUsingSSE: boolean;
  reconnectAttempts: number;
  eventHandlers: EventHandler[]; // Track handlers for cleanup
}

interface PollingManagerOptions {
  initialInterval: number;
  maxInterval: number;
  backoffMultiplier: number;
  maxRetries: number;
  maxReconnectAttempts: number;
  sseReconnectBaseDelay: number;
}

const DEFAULT_OPTIONS: PollingManagerOptions = {
  initialInterval: 500,
  maxInterval: 5000,
  backoffMultiplier: 1.5,
  maxRetries: 3,
  maxReconnectAttempts: 5,
  sseReconnectBaseDelay: 1000,
};

const TERMINAL_EVENT_TYPES = ['done', 'cancelled', 'error'];

class PollingManager {
  private instances: Map<string, StreamingInstance> = new Map();
  private options: PollingManagerOptions;

  constructor(options: Partial<PollingManagerOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  start(messageId: string, runId: string): void {
    if (this.instances.has(runId)) {
      return;
    }

    const instance: StreamingInstance = {
      runId,
      messageId,
      eventSource: null,
      abortController: null,
      intervalRef: null,
      currentInterval: this.options.initialInterval,
      retryCount: 0,
      lastEventCount: 0,
      isUsingSSE: false,
      reconnectAttempts: 0,
      eventHandlers: [],
    };

    this.instances.set(runId, instance);
    useAgentStore.getState().startPolling(messageId);
    
    this.connectSSE(runId);
  }

  stop(runId: string): void {
    const instance = this.instances.get(runId);
    if (!instance) return;

    this.clearInstance(instance);
    this.instances.delete(runId);
    useAgentStore.getState().stopPolling(instance.messageId);
  }

  cancel(runId: string): void {
    const instance = this.instances.get(runId);
    if (instance) {
      if (instance.eventSource) {
        instance.eventSource.close();
      }
      if (instance.abortController) {
        instance.abortController.abort();
      }
    }
    this.stop(runId);
  }

  isPolling(runId: string): boolean {
    return this.instances.has(runId);
  }

  cancelAll(): void {
    const runIds = Array.from(this.instances.keys());
    for (const runId of runIds) {
      this.cancel(runId);
    }
  }

  handleHydratedRun(messageId: string, runId: string, status: string): void {
    if (['starting', 'queued', 'planning', 'running', 'verifying'].includes(status)) {
      this.start(messageId, runId);
    }
  }

  private clearInstance(instance: StreamingInstance): void {
    // Remove all event listeners before closing EventSource
    if (instance.eventSource && instance.eventHandlers.length > 0) {
      for (const { type, handler } of instance.eventHandlers) {
        instance.eventSource.removeEventListener(type, handler);
      }
      instance.eventHandlers = [];
    }
    if (instance.eventSource) {
      instance.eventSource.close();
      instance.eventSource = null;
    }
    if (instance.intervalRef) {
      clearTimeout(instance.intervalRef);
      instance.intervalRef = null;
    }
    if (instance.abortController) {
      instance.abortController.abort();
      instance.abortController = null;
    }
  }

  private connectSSE(runId: string): void {
    const instance = this.instances.get(runId);
    if (!instance) return;

    // Clean up existing handlers and EventSource before reconnecting
    if (instance.eventSource) {
      for (const { type, handler } of instance.eventHandlers) {
        instance.eventSource.removeEventListener(type, handler);
      }
      instance.eventSource.close();
      instance.eventHandlers = [];
    }

    try {
      const url = `/api/agent/runs/${runId}/events/stream`;
      const eventSource = new EventSource(url, { withCredentials: true });
      instance.eventSource = eventSource;
      instance.isUsingSSE = true;

      eventSource.onopen = () => {
        console.log(`[PollingManager] SSE connected for run ${runId}`);
        instance.reconnectAttempts = 0;
      };

      eventSource.onmessage = (event) => {
        this.handleSSEMessage(runId, event);
      };

      eventSource.onerror = () => {
        this.handleSSEError(runId);
      };

      const eventTypes = [
        'task_start', 'plan_created', 'plan_step', 'step_started',
        'tool_call', 'tool_output', 'tool_chunk', 'observation',
        'verification', 'step_completed', 'step_failed', 'step_retried',
        'replan', 'thinking', 'shell_output', 'shell_chunk', 'shell_exit', 'artifact_created',
        'error', 'done', 'cancelled', 'heartbeat'
      ];

      // Store handlers for cleanup
      for (const eventType of eventTypes) {
        const handler = (event: MessageEvent) => {
          this.handleSSEMessage(runId, event, eventType);
        };
        eventSource.addEventListener(eventType, handler);
        instance.eventHandlers.push({ type: eventType, handler });
      }

    } catch (error) {
      console.warn(`[PollingManager] SSE not supported, falling back to polling for run ${runId}`);
      this.fallbackToPolling(runId);
    }
  }

  private handleSSEMessage(runId: string, event: MessageEvent, eventType?: string): void {
    const instance = this.instances.get(runId);
    if (!instance) return;

    try {
      const data = JSON.parse(event.data);
      const effectiveEventType = eventType || data.event_type;
      
      if (effectiveEventType === 'heartbeat') {
        return;
      }

      const store = useAgentStore.getState();
      const currentRun = store.runs[instance.messageId];
      const existingEventStream = currentRun?.eventStream || [];
      const existingSteps = currentRun?.steps || [];
      
      const agentEvent = this.mapSSEDataToAgentEvent(data, effectiveEventType);
      const newEventStream = [...existingEventStream, agentEvent];
      
      const updates = this.mapEventToStoreUpdate(data);
      updates.eventStream = newEventStream;
      
      const updatedSteps = this.updateStepsFromEvent(existingSteps, data, effectiveEventType);
      if (updatedSteps) {
        updates.steps = updatedSteps;
      }
      
      store.updateRun(instance.messageId, updates);

      if (TERMINAL_EVENT_TYPES.includes(effectiveEventType)) {
        this.handleTerminalEvent(instance, data);
      }

    } catch (error) {
      console.error(`[PollingManager] Error parsing SSE message for run ${runId}:`, error);
    }
  }

  private mapSSEDataToAgentEvent(data: any, eventType: string): { type: 'action' | 'observation' | 'error' | 'thinking'; content: any; timestamp: number } {
    let type: 'action' | 'observation' | 'error' | 'thinking' = 'observation';
    
    if (['tool_call', 'step_started', 'task_start'].includes(eventType)) {
      type = 'action';
    } else if (['error', 'step_failed'].includes(eventType)) {
      type = 'error';
    } else if (['thinking', 'plan_created', 'replan'].includes(eventType)) {
      type = 'thinking';
    }
    
    return {
      type,
      content: {
        event_type: eventType,
        ...data,
      },
      timestamp: data.timestamp || Date.now(),
    };
  }

  private mapEventToStoreUpdate(event: any): Record<string, any> {
    const updates: Record<string, any> = {};

    if (event.phase) {
      const statusMap: Record<string, string> = {
        'planning': 'planning',
        'executing': 'running',
        'verifying': 'verifying',
        'completed': 'completed',
        'failed': 'failed',
        'cancelled': 'cancelled',
      };
      if (statusMap[event.phase]) {
        updates.status = statusMap[event.phase];
      }
    }

    switch (event.event_type) {
      case 'task_start':
        updates.status = 'planning';
        break;
        
      case 'plan_created':
        updates.status = 'running';
        break;
        
      case 'step_started':
        updates.status = 'running';
        break;
        
      case 'step_completed':
        break;
        
      case 'step_failed':
        if (event.error) {
          updates.error = typeof event.error === 'string' ? event.error : event.error.message || 'Step failed';
        }
        break;
        
      case 'done':
        updates.status = 'completed';
        if (event.summary) {
          updates.summary = event.summary;
        }
        break;
        
      case 'error':
        updates.status = 'failed';
        if (event.error) {
          updates.error = typeof event.error === 'string' ? event.error : event.error.message || 'Unknown error';
        }
        break;
        
      case 'cancelled':
        updates.status = 'cancelled';
        break;
        
      case 'replan':
        updates.status = 'planning';
        break;
        
      case 'verification':
        updates.status = 'verifying';
        break;
    }

    return updates;
  }

  private updateStepsFromEvent(
    existingSteps: Array<{ stepIndex: number; toolName: string; status: string; output?: any; error?: string; startedAt?: string; completedAt?: string }>,
    event: any,
    eventType: string
  ): Array<{ stepIndex: number; toolName: string; status: string; output?: any; error?: string; startedAt?: string; completedAt?: string }> | null {
    const stepIndex = event.stepIndex ?? event.step_index;
    const toolName = event.toolName ?? event.tool_name ?? event.tool ?? '';

    switch (eventType) {
      case 'step_started': {
        if (stepIndex === undefined) return null;
        const existingIndex = existingSteps.findIndex(s => s.stepIndex === stepIndex);
        if (existingIndex >= 0) {
          const updatedSteps = [...existingSteps];
          updatedSteps[existingIndex] = {
            ...updatedSteps[existingIndex],
            status: 'running',
            toolName: toolName || updatedSteps[existingIndex].toolName,
            startedAt: event.timestamp ? new Date(event.timestamp).toISOString() : new Date().toISOString(),
          };
          return updatedSteps;
        } else {
          return [
            ...existingSteps,
            {
              stepIndex,
              toolName,
              status: 'running',
              startedAt: event.timestamp ? new Date(event.timestamp).toISOString() : new Date().toISOString(),
            },
          ];
        }
      }

      case 'step_completed': {
        if (stepIndex === undefined) return null;
        const existingIndex = existingSteps.findIndex(s => s.stepIndex === stepIndex);
        if (existingIndex >= 0) {
          const updatedSteps = [...existingSteps];
          updatedSteps[existingIndex] = {
            ...updatedSteps[existingIndex],
            status: 'succeeded',
            output: event.output ?? event.result,
            completedAt: event.timestamp ? new Date(event.timestamp).toISOString() : new Date().toISOString(),
          };
          return updatedSteps;
        } else {
          return [
            ...existingSteps,
            {
              stepIndex,
              toolName,
              status: 'succeeded',
              output: event.output ?? event.result,
              completedAt: event.timestamp ? new Date(event.timestamp).toISOString() : new Date().toISOString(),
            },
          ];
        }
      }

      case 'step_failed': {
        if (stepIndex === undefined) return null;
        const errorMessage = typeof event.error === 'string' 
          ? event.error 
          : event.error?.message || 'Step failed';
        const existingIndex = existingSteps.findIndex(s => s.stepIndex === stepIndex);
        if (existingIndex >= 0) {
          const updatedSteps = [...existingSteps];
          updatedSteps[existingIndex] = {
            ...updatedSteps[existingIndex],
            status: 'failed',
            error: errorMessage,
            completedAt: event.timestamp ? new Date(event.timestamp).toISOString() : new Date().toISOString(),
          };
          return updatedSteps;
        } else {
          return [
            ...existingSteps,
            {
              stepIndex,
              toolName,
              status: 'failed',
              error: errorMessage,
              completedAt: event.timestamp ? new Date(event.timestamp).toISOString() : new Date().toISOString(),
            },
          ];
        }
      }

      default:
        return null;
    }
  }

  private handleTerminalEvent(instance: StreamingInstance, data: any): void {
    const store = useAgentStore.getState();
    
    switch (data.event_type) {
      case 'done':
        store.updateRun(instance.messageId, {
          status: 'completed',
          summary: data.summary || '',
        });
        break;
      case 'error':
        store.updateRun(instance.messageId, {
          status: 'failed',
          error: data.error?.message || 'Unknown error',
        });
        break;
      case 'cancelled':
        store.updateRun(instance.messageId, {
          status: 'cancelled',
        });
        break;
    }
    
    this.stop(instance.runId);
  }

  private handleSSEError(runId: string): void {
    const instance = this.instances.get(runId);
    if (!instance) return;

    console.warn(`[PollingManager] SSE error for run ${runId}`);

    if (instance.eventSource) {
      instance.eventSource.close();
      instance.eventSource = null;
    }

    instance.reconnectAttempts++;

    if (instance.reconnectAttempts > this.options.maxReconnectAttempts) {
      console.log(`[PollingManager] Max SSE reconnect attempts reached for run ${runId}, falling back to polling`);
      this.fallbackToPolling(runId);
      return;
    }

    const delay = this.calculateReconnectDelay(instance.reconnectAttempts);
    console.log(`[PollingManager] Reconnecting SSE for run ${runId} in ${delay}ms (attempt ${instance.reconnectAttempts})`);

    instance.intervalRef = setTimeout(() => {
      if (this.instances.has(runId)) {
        this.connectSSE(runId);
      }
    }, delay);
  }

  private calculateReconnectDelay(attempts: number): number {
    const baseDelay = this.options.sseReconnectBaseDelay;
    const delay = baseDelay * Math.pow(this.options.backoffMultiplier, attempts - 1);
    const jitter = Math.random() * 500;
    return Math.min(delay + jitter, this.options.maxInterval);
  }

  private fallbackToPolling(runId: string): void {
    const instance = this.instances.get(runId);
    if (!instance) return;

    console.log(`[PollingManager] Falling back to HTTP polling for run ${runId}`);
    instance.isUsingSSE = false;
    instance.reconnectAttempts = 0;
    instance.currentInterval = this.options.initialInterval;
    
    this.poll(runId);
  }

  private async poll(runId: string): Promise<void> {
    const instance = this.instances.get(runId);
    if (!instance || instance.isUsingSSE) return;

    instance.abortController = new AbortController();

    try {
      const response = await fetch(`/api/agent/runs/${runId}`, {
        signal: instance.abortController.signal,
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      const store = useAgentStore.getState();

      if (data.status === 'completed') {
        let summary = data.summary || data.result || '';
        
        if (!summary && data.eventStream?.length > 0) {
          const events = data.eventStream;
          
          const completionEvent = events.find((e: any) => 
            e.type === 'done' || e.type === 'run_completed' ||
            e.kind === 'result' || e.kind === 'done' ||
            e.content?.type === 'run_completed'
          );
          if (completionEvent?.summary) {
            summary = completionEvent.summary;
          }
          
          if (!summary) {
            const planEvent = events.find((e: any) => e.kind === 'plan' || e.type === 'plan');
            if (planEvent?.content?.conversationalResponse) {
              summary = planEvent.content.conversationalResponse;
            }
          }
          
          if (!summary) {
            const observationEvents = events.filter((e: any) => e.kind === 'observation' || e.type === 'observation');
            const lastObs = observationEvents[observationEvents.length - 1];
            if (lastObs?.summary) {
              summary = lastObs.summary;
            }
          }
        }
        
        store.updateRun(instance.messageId, {
          status: 'completed',
          eventStream: data.eventStream || [],
          summary: summary,
        });
        store.stopPolling(instance.messageId);
        this.stop(runId);
        return;
      }

      if (data.status === 'failed' || data.status === 'cancelled') {
        store.updateRun(instance.messageId, {
          status: data.status,
          eventStream: data.eventStream || [],
          error: data.error || 'Run ended',
        });
        store.stopPolling(instance.messageId);
        this.stop(runId);
        return;
      }

      store.updateRun(instance.messageId, {
        status: data.status,
        eventStream: data.eventStream || [],
        steps: data.steps || [],
        summary: data.summary,
      });

      const newEventCount = data.eventStream?.length || 0;
      if (newEventCount > instance.lastEventCount) {
        instance.currentInterval = this.options.initialInterval;
        instance.lastEventCount = newEventCount;
      } else {
        instance.currentInterval = Math.min(
          instance.currentInterval * this.options.backoffMultiplier,
          this.options.maxInterval
        );
      }

      instance.retryCount = 0;
      this.scheduleNext(runId, instance.currentInterval);

    } catch (error: any) {
      if (error.name === 'AbortError') {
        return;
      }

      instance.retryCount++;
      if (instance.retryCount >= this.options.maxRetries) {
        const store = useAgentStore.getState();
        store.updateRun(instance.messageId, {
          status: 'failed',
          error: 'Polling failed after max retries',
        });
        this.stop(runId);
        return;
      }

      const backoffDelay = instance.currentInterval * Math.pow(this.options.backoffMultiplier, instance.retryCount);
      this.scheduleNext(runId, Math.min(backoffDelay, this.options.maxInterval));
    }
  }

  private scheduleNext(runId: string, delay: number): void {
    const instance = this.instances.get(runId);
    if (!instance || instance.isUsingSSE) return;

    instance.intervalRef = setTimeout(() => {
      this.poll(runId);
    }, delay);
  }
}

export const pollingManager = new PollingManager();
