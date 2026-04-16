import {
  ExecutionEvent,
  RunState,
  reduceEvent,
  createInitialRunState,
  Step,
  ToolCall,
  Artifact,
  RunStatus,
} from "@shared/executionProtocol";

export type ConnectionMode = "connecting" | "sse_active" | "polling" | "disconnected";

export interface FlatRunState {
  run_id: string;
  status: RunStatus;
  plan: RunState["plan"];
  steps: Step[];
  tool_calls: ToolCall[];
  artifacts: Artifact[];
  events: ExecutionEvent[];
  progress: number;
  current_step_id: string | null;
  error: string | null;
  started_at: number | null;
  completed_at: number | null;
  metrics: RunState["metrics"];
  connectionMode: ConnectionMode;
}

type StateListener = (state: FlatRunState) => void;
type ConnectionModeListener = (mode: ConnectionMode) => void;

export class ExecutionStreamClient {
  private runId: string;
  private eventSource: EventSource | null = null;
  private state: RunState;
  private lastSeq: number = 0;
  private connectionMode: ConnectionMode = "connecting";
  
  private stateListeners: Set<StateListener> = new Set();
  private connectionModeListeners: Set<ConnectionModeListener> = new Set();
  
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 10;
  private baseReconnectDelay: number = 1000;
  
  private sseOpenTimer: NodeJS.Timeout | null = null;
  private firstEventTimer: NodeJS.Timeout | null = null;
  private pollingInterval: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  
  private sseOpened: boolean = false;
  private firstEventReceived: boolean = false;
  private destroyed: boolean = false;

  constructor(runId: string) {
    this.runId = runId;
    this.state = createInitialRunState(runId);
    console.log(`[ExecutionStreamClient] Created for run: ${runId}`);
  }

  connect(): void {
    if (this.destroyed) {
      console.warn(`[ExecutionStreamClient] Cannot connect - client destroyed`);
      return;
    }

    console.log(`[ExecutionStreamClient] Connecting to SSE for run: ${this.runId}`);
    
    this.cleanup();
    this.setConnectionMode("connecting");

    const url = `/api/runs/${this.runId}/stream`;
    console.log(`[ExecutionStreamClient] SSE URL: ${url}`);
    
    this.eventSource = new EventSource(url);
    
    this.sseOpenTimer = setTimeout(() => {
      if (!this.sseOpened && !this.destroyed) {
        console.warn(`[ExecutionStreamClient] SSE onopen timeout (2.5s), activating polling fallback`);
        this.activatePollingFallback();
      }
    }, 2500);
    
    this.firstEventTimer = setTimeout(() => {
      if (!this.firstEventReceived && !this.destroyed) {
        console.warn(`[ExecutionStreamClient] No events received within 3s, activating polling fallback`);
        this.activatePollingFallback();
      }
    }, 3000);
    
    this.eventSource.onopen = () => {
      if (this.destroyed) return;
      
      console.log(`[ExecutionStreamClient] SSE onopen fired`);
      this.sseOpened = true;
      this.reconnectAttempts = 0;
      this.clearTimer("sseOpen");
      this.setConnectionMode("sse_active");
    };

    this.eventSource.onerror = (e) => {
      if (this.destroyed) return;
      
      console.error(`[ExecutionStreamClient] SSE onerror:`, e);
      
      if (!this.sseOpened && !this.pollingInterval) {
        console.log(`[ExecutionStreamClient] SSE failed before open, activating polling`);
        this.activatePollingFallback();
      } else if (this.connectionMode === "sse_active") {
        this.scheduleReconnect();
      }
    };

    this.eventSource.onmessage = (event) => {
      if (this.destroyed) return;
      this.markFirstEventReceived();
      this.handleRawEvent(event.data);
    };

    const eventTypes = [
      "run_started", "run_completed", "run_failed", "run_cancelled",
      "plan_created", "plan_updated",
      "step_started", "step_progress", "step_completed", "step_failed", "step_skipped",
      "tool_call_started", "tool_call_chunk", "tool_call_progress", 
      "tool_call_completed", "tool_call_failed", "tool_call_retry",
      "artifact_declared", "artifact_progress", "artifact_ready", "artifact_failed",
      "warning", "error", "info", "heartbeat",
    ];

    for (const type of eventTypes) {
      this.eventSource.addEventListener(type, (event: MessageEvent) => {
        if (this.destroyed) return;
        this.markFirstEventReceived();
        this.handleRawEvent(event.data);
      });
    }
  }

  private handleRawEvent(data: string): void {
    try {
      const event = JSON.parse(data) as ExecutionEvent;
      console.log(`[ExecutionStreamClient] Event received: ${event.type}`, event);
      
      if (event.seq > this.lastSeq) {
        this.lastSeq = event.seq;
      }
      
      this.state = reduceEvent(this.state, event);
      this.emitState();
    } catch (e) {
      console.error("[ExecutionStreamClient] Parse error:", e, data);
    }
  }

  private markFirstEventReceived(): void {
    if (!this.firstEventReceived) {
      console.log(`[ExecutionStreamClient] First event received`);
      this.firstEventReceived = true;
      this.clearTimer("firstEvent");
    }
  }

  private activatePollingFallback(): void {
    if (this.pollingInterval || this.destroyed) return;
    
    console.log(`[ExecutionStreamClient] Activating polling fallback for run: ${this.runId}`);
    
    this.closeEventSource();
    this.clearTimer("sseOpen");
    this.clearTimer("firstEvent");
    
    this.setConnectionMode("polling");
    
    this.pollEvents();
    this.pollingInterval = setInterval(() => this.pollEvents(), 500);
  }

  private async pollEvents(): Promise<void> {
    if (this.destroyed) return;
    
    try {
      const url = `/api/runs/${this.runId}/events?after=${this.lastSeq}`;
      const response = await fetch(url);
      
      if (!response.ok) {
        console.error(`[ExecutionStreamClient] Poll failed: ${response.status}`);
        return;
      }
      
      const data = await response.json();
      
      if (Array.isArray(data.events)) {
        for (const event of data.events) {
          if (event.seq > this.lastSeq) {
            this.lastSeq = event.seq;
            this.state = reduceEvent(this.state, event);
          }
        }
        this.emitState();
      }
      
      if (this.state.status === "completed" || 
          this.state.status === "failed" || 
          this.state.status === "cancelled") {
        this.stopPolling();
      }
    } catch (e) {
      console.error(`[ExecutionStreamClient] Poll error:`, e);
    }
  }

  private stopPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.destroyed) return;
    
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error("[ExecutionStreamClient] Max reconnect attempts reached, falling back to polling");
      this.activatePollingFallback();
      return;
    }

    const delay = this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts);
    const cappedDelay = Math.min(delay, 30000);
    this.reconnectAttempts++;

    console.log(`[ExecutionStreamClient] Scheduling reconnect in ${cappedDelay}ms (attempt ${this.reconnectAttempts})`);

    this.reconnectTimer = setTimeout(() => {
      if (!this.destroyed && 
          this.state.status !== "completed" && 
          this.state.status !== "failed" &&
          this.state.status !== "cancelled") {
        this.connect();
      }
    }, cappedDelay);
  }

  private setConnectionMode(mode: ConnectionMode): void {
    if (this.connectionMode !== mode) {
      this.connectionMode = mode;
      console.log(`[ExecutionStreamClient] Connection mode changed: ${mode}`);
      
      for (const listener of this.connectionModeListeners) {
        listener(mode);
      }
      
      this.emitState();
    }
  }

  private flattenState(): FlatRunState {
    return {
      run_id: this.state.run_id,
      status: this.state.status,
      plan: this.state.plan,
      steps: Array.from(this.state.steps.values()),
      tool_calls: Array.from(this.state.tool_calls.values()),
      artifacts: Array.from(this.state.artifacts.values()),
      events: this.state.events,
      progress: this.state.progress,
      current_step_id: this.state.current_step_id,
      error: this.state.error,
      started_at: this.state.started_at,
      completed_at: this.state.completed_at,
      metrics: this.state.metrics,
      connectionMode: this.connectionMode,
    };
  }

  private emitState(): void {
    const flatState = this.flattenState();
    for (const listener of this.stateListeners) {
      listener(flatState);
    }
  }

  subscribe(callback: StateListener): () => void {
    this.stateListeners.add(callback);
    callback(this.flattenState());
    
    return () => {
      this.stateListeners.delete(callback);
    };
  }

  onConnectionModeChange(callback: ConnectionModeListener): () => void {
    this.connectionModeListeners.add(callback);
    callback(this.connectionMode);
    
    return () => {
      this.connectionModeListeners.delete(callback);
    };
  }

  getState(): FlatRunState {
    return this.flattenState();
  }

  getConnectionMode(): ConnectionMode {
    return this.connectionMode;
  }

  private closeEventSource(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }

  private clearTimer(type: "sseOpen" | "firstEvent" | "reconnect"): void {
    switch (type) {
      case "sseOpen":
        if (this.sseOpenTimer) {
          clearTimeout(this.sseOpenTimer);
          this.sseOpenTimer = null;
        }
        break;
      case "firstEvent":
        if (this.firstEventTimer) {
          clearTimeout(this.firstEventTimer);
          this.firstEventTimer = null;
        }
        break;
      case "reconnect":
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
        break;
    }
  }

  private cleanup(): void {
    this.closeEventSource();
    this.stopPolling();
    this.clearTimer("sseOpen");
    this.clearTimer("firstEvent");
    this.clearTimer("reconnect");
    this.sseOpened = false;
    this.firstEventReceived = false;
  }

  destroy(): void {
    console.log(`[ExecutionStreamClient] Destroying client for run: ${this.runId}`);
    this.destroyed = true;
    this.cleanup();
    this.setConnectionMode("disconnected");
    this.stateListeners.clear();
    this.connectionModeListeners.clear();
  }
}

export function createExecutionStreamClient(runId: string): ExecutionStreamClient {
  return new ExecutionStreamClient(runId);
}
