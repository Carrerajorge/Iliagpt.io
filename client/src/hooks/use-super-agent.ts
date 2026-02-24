import { useState, useCallback, useRef, useEffect } from "react";
import { PhaseNarrator } from "../lib/phaseNarrator";
import { apiFetch } from "@/lib/apiClient";

export type SSEEventType =
  | "contract"
  | "plan"
  | "tool_call"
  | "tool_result"
  | "source_signal"
  | "source_deep"
  | "artifact"
  | "verify"
  | "iterate"
  | "final"
  | "error"
  | "heartbeat"
  | "heartbeat"
  | "progress"
  | "thought";

export type SuperAgentPhase =
  | "idle"
  | "planning"
  | "signals"
  | "deep"
  | "creating"
  | "verifying"
  | "finalizing"
  | "completed"
  | "error";

export interface SuperAgentSource {
  id: string;
  url: string;
  title: string;
  snippet: string;
  domain: string;
  score: number;
  fetched: boolean;
  content?: string;
  claims?: string[];
}

export interface SuperAgentArtifact {
  id: string;
  type: "xlsx" | "docx" | "pptx";
  name: string;
  downloadUrl: string;
  size?: number;
}

export interface SuperAgentPlanStep {
  id: string;
  action: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  tool?: string;
}

export interface SuperAgentContract {
  contract_id: string;
  intent: string;
  requirements: {
    min_sources: number;
    must_create: string[];
    language: string;
  };
  plan: SuperAgentPlanStep[];
  original_prompt: string;
}

export interface SuperAgentProgress {
  phase: SuperAgentPhase;
  status?: string;
  collected?: number;
  target?: number;
  fetched?: number;
  success?: number;
}

export interface SuperAgentToolCall {
  id: string;
  tool: string;
  input: Record<string, unknown>;
}

export interface SuperAgentToolResult {
  tool_call_id: string;
  success: boolean;
  output?: unknown;
  error?: string;
}

export interface SuperAgentVerify {
  passed: boolean;
  checks: Array<{
    id: string;
    condition: string;
    passed?: boolean;
    reason?: string;
  }>;
  blockers: string[];
  warnings: string[];
  report: string;
}

export interface SuperAgentFinal {
  response: string;
  sources_count: number;
  artifacts: SuperAgentArtifact[];
  duration_ms: number;
  iterations: number;
}

export interface SuperAgentThought {
  content: string;
  timestamp: number;
}

export interface SuperAgentState {
  sessionId: string | null;
  runId: string | null;
  isRunning: boolean;
  phase: SuperAgentPhase;
  contract: SuperAgentContract | null;
  sources: SuperAgentSource[];
  sourcesTarget: number;
  artifacts: SuperAgentArtifact[];
  toolCalls: SuperAgentToolCall[];
  toolResults: SuperAgentToolResult[];
  verify: SuperAgentVerify | null;
  final: SuperAgentFinal | null;
  error: string | null;
  iteration: number;
  progress: SuperAgentProgress | null;
  thoughts: SuperAgentThought[];
  narration: string;
}

const initialState: SuperAgentState = {
  sessionId: null,
  runId: null,
  isRunning: false,
  phase: "idle",
  contract: null,
  sources: [],
  sourcesTarget: 100,
  artifacts: [],
  toolCalls: [],
  toolResults: [],
  verify: null,
  final: null,
  error: null,
  iteration: 0,
  progress: null,
  thoughts: [],
  narration: "⚡ Iniciando...",
};

export interface UseSuperAgentReturn {
  state: SuperAgentState;
  execute: (prompt: string, options?: { enforceMinSources?: boolean }) => void;
  cancel: () => void;
  reset: () => void;
}

export function useSuperAgentStream(): UseSuperAgentReturn {
  const [state, setState] = useState<SuperAgentState>(initialState);
  const abortControllerRef = useRef<AbortController | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const narratorRef = useRef<PhaseNarrator | null>(null);

  // Initialize narrator
  if (!narratorRef.current) {
    narratorRef.current = new PhaseNarrator();
  }

  const cleanup = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    narratorRef.current?.reset();
  }, []);

  const handleEvent = useCallback((eventType: SSEEventType, data: unknown) => {
    // Process event through narrator
    const narration = narratorRef.current!.processEvent({
      event_type: eventType as any,
      ...data as any
    });

    setState((prev) => {
      let nextState = { ...prev, narration };

      switch (eventType) {
        case "contract": {
          const contract = data as SuperAgentContract;
          return {
            ...nextState,
            contract,
            sourcesTarget: contract.requirements.min_sources || 100,
            phase: "planning",
          };
        }

        case "plan": {
          return nextState;
        }

        case "progress": {
          const progress = data as SuperAgentProgress;
          return {
            ...nextState,
            phase: progress.phase || nextState.phase,
            progress,
          };
        }

        case "tool_call": {
          const toolCall = data as SuperAgentToolCall;
          return {
            ...nextState,
            toolCalls: [...nextState.toolCalls, toolCall],
          };
        }

        case "tool_result": {
          const toolResult = data as SuperAgentToolResult;
          return {
            ...nextState,
            toolResults: [...nextState.toolResults, toolResult],
          };
        }

        case "source_signal": {
          const source = data as SuperAgentSource;
          const existingIndex = nextState.sources.findIndex((s) => s.id === source.id);
          if (existingIndex >= 0) {
            const newSources = [...nextState.sources];
            newSources[existingIndex] = source;
            return { ...nextState, sources: newSources };
          }
          return {
            ...nextState,
            sources: [...nextState.sources, source],
          };
        }

        case "source_deep": {
          const deepData = data as {
            source_id: string;
            url: string;
            claims_count: number;
            word_count: number;
          };
          const newSources = nextState.sources.map((s) =>
            s.id === deepData.source_id ? { ...s, fetched: true } : s
          );
          return { ...nextState, sources: newSources, phase: "deep" };
        }

        case "artifact": {
          const artifact = data as {
            id: string;
            type: "xlsx" | "docx" | "pptx";
            name: string;
            downloadUrl: string;
            size?: number;
          };
          return {
            ...nextState,
            artifacts: [
              ...nextState.artifacts,
              {
                id: artifact.id,
                type: artifact.type,
                name: artifact.name,
                downloadUrl: artifact.downloadUrl || `/api/super/artifacts/${artifact.id}/download`,
                size: artifact.size,
              },
            ],
            phase: "creating",
          };
        }

        case "verify": {
          const verify = data as SuperAgentVerify;
          return {
            ...nextState,
            verify,
            phase: "verifying",
          };
        }

        case "iterate": {
          const iterateData = data as { iteration: number };
          return {
            ...nextState,
            iteration: iterateData.iteration,
          };
        }

        case "final": {
          const final = data as SuperAgentFinal;
          return {
            ...nextState,
            final,
            phase: "completed",
            isRunning: false,
          };
        }

        case "error": {
          const errorData = data as { message: string; recoverable?: boolean };
          return {
            ...nextState,
            error: errorData.message,
            phase: "error",
            isRunning: false,
          };
        }

        case "heartbeat": {
          return nextState;
        }

        case "thought": {
          const thoughtData = data as { content: string };
          return {
            ...nextState,
            thoughts: [
              ...nextState.thoughts,
              {
                content: thoughtData.content,
                timestamp: Date.now()
              }
            ],
            // Update narration to show thinking status if needed, or keep latest
            narration: "🤔 Razonando..."
          };
        }

        default:
          return nextState;
      }
    });
  }, []);

  const execute = useCallback(
    async (prompt: string, options?: { enforceMinSources?: boolean }) => {
      cleanup();

      setState({
        ...initialState,
        isRunning: true,
        phase: "planning",
      });

      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      try {
        const response = await apiFetch("/api/super/stream", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            prompt,
            options: {
              enforce_min_sources: options?.enforceMinSources ?? true,
            },
          }),
          signal: abortController.signal,
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: "Request failed" }));
          throw new Error(errorData.error || `HTTP ${response.status}`);
        }

        const sessionId = response.headers.get("X-Session-ID");
        const runId = response.headers.get("X-Run-ID");
        console.log("[SuperAgent] Received run_id from backend:", runId);
        setState((prev) => ({ ...prev, sessionId, runId }));

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error("No response body");
        }

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          let currentEventType: SSEEventType | null = null;
          let currentData: string | null = null;

          for (const line of lines) {
            if (line.startsWith("event:")) {
              currentEventType = line.slice(6).trim() as SSEEventType;
            } else if (line.startsWith("data:")) {
              currentData = line.slice(5).trim();
            } else if (line === "" && currentEventType && currentData) {
              try {
                const parsedData = JSON.parse(currentData);
                handleEvent(currentEventType, parsedData);
              } catch (e) {
                console.warn("[SuperAgent] Failed to parse SSE data:", currentData);
              }
              currentEventType = null;
              currentData = null;
            }
          }
        }
      } catch (error: any) {
        if (error.name === "AbortError") {
          setState((prev) => ({
            ...prev,
            isRunning: false,
            phase: prev.phase === "completed" ? "completed" : "idle",
          }));
          return;
        }

        setState((prev) => ({
          ...prev,
          error: error.message || "Unknown error",
          phase: "error",
          isRunning: false,
        }));
      }
    },
    [cleanup, handleEvent]
  );

  const cancel = useCallback(() => {
    cleanup();
    setState((prev) => ({
      ...prev,
      isRunning: false,
      phase: prev.phase === "completed" ? "completed" : "idle",
    }));
  }, [cleanup]);

  const reset = useCallback(() => {
    cleanup();
    setState(initialState);
  }, [cleanup]);

  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  return {
    state,
    execute,
    cancel,
    reset,
  };
}
