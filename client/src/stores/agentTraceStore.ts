import { create } from 'zustand';
import type { TraceEvent, TraceEventType } from '@shared/schema';

export type ActivityEventType =
  | 'run_created'
  | 'plan_generated'
  | 'tool_call_started'
  | 'tool_call_succeeded'
  | 'tool_call_failed'
  | 'agent_delegated'
  | 'artifact_created'
  | 'qa_passed'
  | 'qa_failed'
  | 'run_completed'
  | 'run_failed';

export interface ActivityEvent {
  id: string;
  type: ActivityEventType;
  runId: string;
  timestamp: number;
  stepIndex?: number;
  payload: Record<string, any>;
  metadata?: Record<string, any>;
}

export interface TraceCitation {
  source: string;
  text: string;
  page?: number;
  url?: string;
  favicon?: string;
}

export interface TraceProgress {
  current: number;
  total: number;
  percentage?: number;
  message?: string;
}

export interface TraceAgent {
  name: string;
  role?: string;
  status?: string;
}

export interface TraceMemoryEvent {
  type: 'loaded' | 'saved';
  keys?: string[];
  count?: number;
  timestamp: number;
}

export interface TraceVerification {
  passed: boolean;
  message?: string;
  timestamp: number;
}

export interface TraceToolCall {
  toolName: string;
  status: 'started' | 'running' | 'succeeded' | 'failed';
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
  error?: string;
}

export interface TraceStep {
  index: number;
  toolName: string;
  description: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'retrying' | 'cancelled';
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
  output?: string;
  shellOutput?: string;
  error?: string;
  artifacts: TraceArtifact[];
  events: TraceEvent[];
  toolCalls: TraceToolCall[];
  isExpanded: boolean;
}

export interface TraceArtifact {
  type: string;
  name: string;
  url?: string;
  data?: any;
  mimeType?: string;
  size?: number;
}

export interface TracePlan {
  objective: string;
  steps: { index: number; toolName: string; description: string }[];
  estimatedTime?: string;
}

export interface TraceRun {
  runId: string;
  status: 'pending' | 'planning' | 'running' | 'verifying' | 'completed' | 'failed' | 'cancelled';
  phase: 'planning' | 'executing' | 'verifying' | 'completed' | 'failed' | 'cancelled';
  plan: TracePlan | null;
  steps: TraceStep[];
  artifacts: TraceArtifact[];
  events: TraceEvent[];
  citations: TraceCitation[];
  verifications: TraceVerification[];
  memoryEvents: TraceMemoryEvent[];
  activeAgent: TraceAgent | null;
  delegatedAgents: TraceAgent[];
  progress: TraceProgress | null;
  summary?: string;
  error?: string;
  startedAt?: number;
  completedAt?: number;
  currentStepIndex: number;
}

interface AgentTraceState {
  runs: Map<string, TraceRun>;
  activeRunId: string | null;
  eventSources: Map<string, EventSource>;
  isConnected: boolean;
  connectionError: string | null;
  
  subscribeToRun: (runId: string) => void;
  unsubscribeFromRun: (runId: string) => void;
  handleEvent: (event: TraceEvent) => void;
  handleActivityEvent: (event: ActivityEvent) => void;
  toggleStepExpanded: (runId: string, stepIndex: number) => void;
  setActiveRun: (runId: string | null) => void;
  getActiveRun: () => TraceRun | null;
  clearRun: (runId: string) => void;
}

const createEmptyRun = (runId: string): TraceRun => ({
  runId,
  status: 'pending',
  phase: 'planning',
  plan: null,
  steps: [],
  artifacts: [],
  events: [],
  citations: [],
  verifications: [],
  memoryEvents: [],
  activeAgent: null,
  delegatedAgents: [],
  progress: null,
  currentStepIndex: 0,
});

export const useAgentTraceStore = create<AgentTraceState>((set, get) => ({
  runs: new Map(),
  activeRunId: null,
  eventSources: new Map(),
  isConnected: false,
  connectionError: null,

  subscribeToRun: (runId: string) => {
    const { eventSources } = get();
    
    if (eventSources.has(runId)) {
      return;
    }

    const eventSource = new EventSource(`/api/agent/runs/${runId}/stream`, {
      withCredentials: true,
    });

    eventSource.onopen = () => {
      set({ isConnected: true, connectionError: null });
      console.debug(`[TraceStore] Connected to activity stream for run ${runId}`);
    };

    eventSource.onerror = (error) => {
      console.error(`[TraceStore] SSE error for run ${runId}:`, error);
      set({ isConnected: false, connectionError: 'Connection lost' });
    };

    const activityEventTypes = [
      'run_created', 'plan_generated', 
      'tool_call_started', 'tool_call_succeeded', 'tool_call_failed',
      'agent_delegated', 'artifact_created',
      'qa_passed', 'qa_failed',
      'run_completed', 'run_failed',
      'subscribed', 'heartbeat'
    ];

    for (const eventType of activityEventTypes) {
      eventSource.addEventListener(eventType, (e: MessageEvent) => {
        try {
          const activityEvent = JSON.parse(e.data) as ActivityEvent;
          get().handleActivityEvent(activityEvent);
        } catch (err) {
          console.error(`[TraceStore] Failed to parse activity event:`, err);
        }
      });
    }

    set(state => {
      const newEventSources = new Map(state.eventSources);
      newEventSources.set(runId, eventSource);
      
      const newRuns = new Map(state.runs);
      if (!newRuns.has(runId)) {
        newRuns.set(runId, createEmptyRun(runId));
      }
      
      return { 
        eventSources: newEventSources, 
        runs: newRuns,
        activeRunId: runId,
      };
    });
  },

  unsubscribeFromRun: (runId: string) => {
    const { eventSources } = get();
    const eventSource = eventSources.get(runId);
    
    if (eventSource) {
      eventSource.close();
      set(state => {
        const newEventSources = new Map(state.eventSources);
        newEventSources.delete(runId);
        return { eventSources: newEventSources };
      });
      console.debug(`[TraceStore] Disconnected from run ${runId}`);
    }
  },

  handleEvent: (event: TraceEvent) => {
    set(state => {
      const newRuns = new Map(state.runs);
      const run = newRuns.get(event.runId) || createEmptyRun(event.runId);
      
      const updatedRun = { ...run, events: [...run.events, event] };

      switch (event.event_type) {
        case 'task_start':
          updatedRun.status = 'planning';
          updatedRun.phase = 'planning';
          updatedRun.startedAt = event.timestamp;
          break;

        case 'plan_created':
          if (event.plan) {
            updatedRun.plan = event.plan;
            updatedRun.steps = event.plan.steps.map((s, i) => ({
              index: i,
              toolName: s.toolName,
              description: s.description,
              status: 'pending' as const,
              artifacts: [],
              events: [],
              toolCalls: [],
              isExpanded: i === 0,
            }));
          }
          break;

        case 'step_started':
          updatedRun.status = 'running';
          updatedRun.phase = 'executing';
          if (event.stepIndex !== undefined) {
            updatedRun.currentStepIndex = event.stepIndex;
            const step = updatedRun.steps[event.stepIndex];
            if (step) {
              step.status = 'running';
              step.startedAt = event.timestamp;
              step.events.push(event);
            }
          }
          break;

        case 'tool_call':
        case 'tool_output':
        case 'tool_chunk':
        case 'shell_output':
        case 'shell_chunk':
        case 'shell_exit':
          if (event.stepIndex !== undefined) {
            const step = updatedRun.steps[event.stepIndex];
            if (step) {
              step.events.push(event);
              if (event.event_type === 'shell_chunk') {
                const chunk = (event as any).chunk || event.output_snippet || '';
                step.shellOutput = (step.shellOutput || '') + String(chunk);
              }

              if (event.output_snippet) {
                if (event.event_type === 'tool_chunk') {
                  step.output = (step.output || '') + event.output_snippet;
                } else if (event.event_type === 'shell_output') {
                  // Legacy behavior: keep a best-effort preview. Prefer shell_chunk for full output.
                  step.shellOutput = step.shellOutput || event.output_snippet;
                } else {
                  step.output = event.output_snippet;
                }
              }
            }
          }
          break;

        case 'step_completed':
          if (event.stepIndex !== undefined) {
            const step = updatedRun.steps[event.stepIndex];
            if (step) {
              step.status = 'completed';
              step.completedAt = event.timestamp;
              step.events.push(event);
            }
          }
          break;

        case 'step_failed':
          if (event.stepIndex !== undefined) {
            const step = updatedRun.steps[event.stepIndex];
            if (step) {
              step.status = 'failed';
              step.completedAt = event.timestamp;
              step.error = event.error?.message;
              step.events.push(event);
            }
          }
          break;

        case 'step_retried':
          if (event.stepIndex !== undefined) {
            const step = updatedRun.steps[event.stepIndex];
            if (step) {
              step.status = 'retrying';
              step.events.push(event);
            }
          }
          break;

        case 'artifact_created':
          if (event.artifact) {
            const artifact: TraceArtifact = {
              type: event.artifact.type,
              name: event.artifact.name,
              url: event.artifact.url,
              data: event.artifact.data,
            };
            updatedRun.artifacts.push(artifact);
            if (event.stepIndex !== undefined) {
              const step = updatedRun.steps[event.stepIndex];
              if (step) {
                step.artifacts.push(artifact);
              }
            }
          }
          break;

        case 'verification':
          updatedRun.phase = 'verifying';
          updatedRun.status = 'verifying';
          break;

        case 'done':
          updatedRun.status = 'completed';
          updatedRun.phase = 'completed';
          updatedRun.completedAt = event.timestamp;
          updatedRun.summary = event.summary;
          break;

        case 'error':
          if (event.error) {
            updatedRun.error = event.error.message;
          }
          break;

        case 'cancelled':
          updatedRun.status = 'cancelled';
          updatedRun.phase = 'cancelled';
          updatedRun.completedAt = event.timestamp;
          break;

        case 'tool_call_started':
          if (event.stepIndex !== undefined && event.tool_name) {
            const step = updatedRun.steps[event.stepIndex];
            if (step) {
              const toolCall: TraceToolCall = {
                toolName: event.tool_name,
                status: 'started',
                startedAt: event.timestamp,
              };
              step.toolCalls.push(toolCall);
              const MAX_TOOL_CALLS = 50;
              if (step.toolCalls.length > MAX_TOOL_CALLS) {
                step.toolCalls = step.toolCalls.slice(-MAX_TOOL_CALLS);
              }
              step.events.push(event);
            }
          }
          break;

        case 'tool_call_succeeded':
          if (event.stepIndex !== undefined && event.tool_name) {
            const step = updatedRun.steps[event.stepIndex];
            if (step) {
              const toolCall = step.toolCalls.find(
                tc => tc.toolName === event.tool_name && tc.status !== 'succeeded' && tc.status !== 'failed'
              );
              if (toolCall) {
                toolCall.status = 'succeeded';
                toolCall.completedAt = event.timestamp;
                toolCall.durationMs = event.durationMs || (event.timestamp - toolCall.startedAt);
              }
              step.events.push(event);
            }
          }
          break;

        case 'tool_call_failed':
          if (event.stepIndex !== undefined && event.tool_name) {
            const step = updatedRun.steps[event.stepIndex];
            if (step) {
              const toolCall = step.toolCalls.find(
                tc => tc.toolName === event.tool_name && tc.status !== 'succeeded' && tc.status !== 'failed'
              );
              if (toolCall) {
                toolCall.status = 'failed';
                toolCall.completedAt = event.timestamp;
                toolCall.durationMs = event.durationMs || (event.timestamp - toolCall.startedAt);
                toolCall.error = event.error?.message;
              }
              step.events.push(event);
            }
          }
          break;

        case 'artifact_ready':
          if (event.artifact) {
            const artifact: TraceArtifact = {
              type: event.artifact.type,
              name: event.artifact.name,
              url: event.artifact.url,
              data: event.artifact.data,
              mimeType: event.artifact.mimeType,
              size: event.artifact.size,
            };
            const existing = updatedRun.artifacts.find(a => a.name === artifact.name);
            if (!existing) {
              updatedRun.artifacts.push(artifact);
            }
            if (event.stepIndex !== undefined) {
              const step = updatedRun.steps[event.stepIndex];
              if (step) {
                const stepExisting = step.artifacts.find(a => a.name === artifact.name);
                if (!stepExisting) {
                  step.artifacts.push(artifact);
                }
              }
            }
          }
          break;

        case 'citations_added':
          if (event.citations) {
            const newCitations: TraceCitation[] = event.citations.map(c => ({
              source: c.source,
              text: c.text,
              page: c.page,
              url: c.url,
            }));
            updatedRun.citations = [...updatedRun.citations, ...newCitations];
          }
          break;

        case 'verification_passed':
          updatedRun.verifications.push({
            passed: true,
            message: event.content,
            timestamp: event.timestamp,
          });
          break;

        case 'verification_failed':
          updatedRun.verifications.push({
            passed: false,
            message: event.error?.message || event.content,
            timestamp: event.timestamp,
          });
          break;

        case 'agent_delegated':
          if (event.agent) {
            const agent: TraceAgent = {
              name: event.agent.name,
              role: event.agent.role,
              status: 'active',
            };
            updatedRun.activeAgent = agent;
            updatedRun.delegatedAgents.push(agent);
          }
          break;

        case 'agent_completed':
          if (event.agent) {
            const agent = updatedRun.delegatedAgents.find(a => a.name === event.agent?.name);
            if (agent) {
              agent.status = 'completed';
            }
            if (updatedRun.activeAgent?.name === event.agent.name) {
              updatedRun.activeAgent = null;
            }
          }
          break;

        case 'progress_update':
          if (event.progress) {
            updatedRun.progress = {
              current: event.progress.current,
              total: event.progress.total,
              percentage: event.progress.percentage,
              message: event.progress.message,
            };
          }
          break;

        case 'memory_loaded':
          updatedRun.memoryEvents.push({
            type: 'loaded',
            keys: event.memory?.keys,
            count: event.memory?.loaded,
            timestamp: event.timestamp,
          });
          break;

        case 'memory_saved':
          updatedRun.memoryEvents.push({
            type: 'saved',
            keys: event.memory?.keys,
            count: event.memory?.saved,
            timestamp: event.timestamp,
          });
          break;
      }

      newRuns.set(event.runId, updatedRun);
      return { runs: newRuns };
    });
  },

  handleActivityEvent: (event: ActivityEvent) => {
    set(state => {
      const newRuns = new Map(state.runs);
      const run = newRuns.get(event.runId) || createEmptyRun(event.runId);
      const updatedRun = { ...run };

      switch (event.type) {
        case 'run_created':
          updatedRun.status = 'planning';
          updatedRun.phase = 'planning';
          updatedRun.startedAt = event.timestamp;
          break;

        case 'plan_generated': {
          const payload = event.payload as {
            objective: string;
            totalSteps: number;
            steps: { index: number; toolName: string; description: string }[];
          };
          updatedRun.plan = {
            objective: payload.objective,
            steps: payload.steps,
          };
          updatedRun.steps = payload.steps.map((s, i) => ({
            index: s.index ?? i,
            toolName: s.toolName,
            description: s.description,
            status: 'pending' as const,
            artifacts: [],
            events: [],
            toolCalls: [],
            isExpanded: i === 0,
          }));
          updatedRun.progress = {
            current: 0,
            total: payload.totalSteps,
            percentage: 0,
            message: `Plan created with ${payload.totalSteps} steps`,
          };
          break;
        }

        case 'tool_call_started': {
          updatedRun.status = 'running';
          updatedRun.phase = 'executing';
          const payload = event.payload as {
            toolName: string;
            toolCallId?: string;
            status: string;
            stepIndex?: number;
          };
          const stepIndex = event.stepIndex ?? payload.stepIndex ?? updatedRun.currentStepIndex;
          if (stepIndex !== undefined && updatedRun.steps[stepIndex]) {
            const step = updatedRun.steps[stepIndex];
            step.status = 'running';
            step.startedAt = step.startedAt ?? event.timestamp;
            step.toolCalls.push({
              toolName: payload.toolName,
              status: 'started',
              startedAt: event.timestamp,
            });
            const MAX_TOOL_CALLS = 50;
            if (step.toolCalls.length > MAX_TOOL_CALLS) {
              step.toolCalls = step.toolCalls.slice(-MAX_TOOL_CALLS);
            }
            updatedRun.currentStepIndex = stepIndex;
          }
          break;
        }

        case 'tool_call_succeeded': {
          const payload = event.payload as {
            toolName: string;
            toolCallId?: string;
            status: string;
            durationMs?: number;
            stepIndex?: number;
          };
          const stepIndex = event.stepIndex ?? payload.stepIndex ?? updatedRun.currentStepIndex;
          if (stepIndex !== undefined && updatedRun.steps[stepIndex]) {
            const step = updatedRun.steps[stepIndex];
            const toolCall = step.toolCalls.find(
              tc => tc.toolName === payload.toolName && tc.status !== 'succeeded' && tc.status !== 'failed'
            );
            if (toolCall) {
              toolCall.status = 'succeeded';
              toolCall.completedAt = event.timestamp;
              toolCall.durationMs = payload.durationMs || (event.timestamp - toolCall.startedAt);
            }
          }
          break;
        }

        case 'tool_call_failed': {
          const payload = event.payload as {
            toolName: string;
            toolCallId?: string;
            status: string;
            error?: string;
            stepIndex?: number;
          };
          const stepIndex = event.stepIndex ?? payload.stepIndex ?? updatedRun.currentStepIndex;
          if (stepIndex !== undefined && updatedRun.steps[stepIndex]) {
            const step = updatedRun.steps[stepIndex];
            const toolCall = step.toolCalls.find(
              tc => tc.toolName === payload.toolName && tc.status !== 'succeeded' && tc.status !== 'failed'
            );
            if (toolCall) {
              toolCall.status = 'failed';
              toolCall.completedAt = event.timestamp;
              toolCall.error = payload.error;
            }
          }
          break;
        }

        case 'agent_delegated': {
          const payload = event.payload as {
            agentName: string;
            agentRole?: string;
            taskDescription?: string;
            status?: string;
          };
          const agent: TraceAgent = {
            name: payload.agentName,
            role: payload.agentRole,
            status: payload.status || 'active',
          };
          updatedRun.activeAgent = agent;
          if (!updatedRun.delegatedAgents.find(a => a.name === agent.name)) {
            updatedRun.delegatedAgents.push(agent);
          }
          break;
        }

        case 'artifact_created': {
          const payload = event.payload as {
            artifactId: string;
            type: string;
            name: string;
            mimeType?: string;
            sizeBytes?: number;
            downloadUrl?: string;
            previewUrl?: string;
          };
          const artifact: TraceArtifact = {
            type: payload.type,
            name: payload.name,
            url: payload.downloadUrl,
            mimeType: payload.mimeType,
            size: payload.sizeBytes,
          };
          const existing = updatedRun.artifacts.find(a => a.name === artifact.name);
          if (!existing) {
            updatedRun.artifacts.push(artifact);
          }
          const stepIndex = event.stepIndex ?? updatedRun.currentStepIndex;
          if (stepIndex !== undefined && updatedRun.steps[stepIndex]) {
            const step = updatedRun.steps[stepIndex];
            const stepExisting = step.artifacts.find(a => a.name === artifact.name);
            if (!stepExisting) {
              step.artifacts.push(artifact);
            }
          }
          break;
        }

        case 'qa_passed':
          updatedRun.phase = 'verifying';
          updatedRun.status = 'verifying';
          updatedRun.verifications.push({
            passed: true,
            message: (event.payload as { message?: string }).message || 'QA check passed',
            timestamp: event.timestamp,
          });
          break;

        case 'qa_failed':
          updatedRun.phase = 'verifying';
          updatedRun.status = 'verifying';
          updatedRun.verifications.push({
            passed: false,
            message: (event.payload as { message?: string }).message || 'QA check failed',
            timestamp: event.timestamp,
          });
          break;

        case 'run_completed': {
          const payload = event.payload as {
            status: string;
            summary?: string;
            durationMs?: number;
            completedSteps?: number;
            totalSteps?: number;
          };
          updatedRun.status = 'completed';
          updatedRun.phase = 'completed';
          updatedRun.completedAt = event.timestamp;
          updatedRun.summary = payload.summary;
          if (payload.completedSteps !== undefined && payload.totalSteps !== undefined) {
            updatedRun.progress = {
              current: payload.completedSteps,
              total: payload.totalSteps,
              percentage: 100,
              message: payload.summary || 'Run completed successfully',
            };
          }
          break;
        }

        case 'run_failed': {
          const payload = event.payload as {
            status: string;
            error?: string;
            message?: string;
          };
          updatedRun.status = 'failed';
          updatedRun.phase = 'failed';
          updatedRun.completedAt = event.timestamp;
          updatedRun.error = payload.error || payload.message;
          break;
        }
      }

      newRuns.set(event.runId, updatedRun);
      return { runs: newRuns };
    });
  },

  toggleStepExpanded: (runId: string, stepIndex: number) => {
    set(state => {
      const newRuns = new Map(state.runs);
      const run = newRuns.get(runId);
      if (run) {
        const updatedRun = { ...run };
        updatedRun.steps = updatedRun.steps.map((step, i) => 
          i === stepIndex ? { ...step, isExpanded: !step.isExpanded } : step
        );
        newRuns.set(runId, updatedRun);
      }
      return { runs: newRuns };
    });
  },

  setActiveRun: (runId: string | null) => {
    set({ activeRunId: runId });
  },

  getActiveRun: () => {
    const { runs, activeRunId } = get();
    return activeRunId ? runs.get(activeRunId) || null : null;
  },

  clearRun: (runId: string) => {
    const { unsubscribeFromRun } = get();
    unsubscribeFromRun(runId);
    set(state => {
      const newRuns = new Map(state.runs);
      newRuns.delete(runId);
      return { 
        runs: newRuns,
        activeRunId: state.activeRunId === runId ? null : state.activeRunId,
      };
    });
  },
}));
